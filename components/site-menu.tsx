"use client";

/**
 * Header menu: one mega panel under the header instead of a row of nav links.
 * The "Menu" button, a focus on the search bar or ⌘K / Ctrl+K opens it.
 *
 * - Empty query, no filter: site sections as cards, link columns (developers,
 *   account, language) and a "popular right now" strip.
 * - A query or a filter chip (kind: all / people / skills / skillsets, source:
 *   GitHub / On Synapth): results from `GET /api/v1/search/global` right in the
 *   panel; the last row opens the full `/search` page with the same filters.
 *
 * Arrows + Enter walk the results, Escape and a click outside close the panel,
 * and so does navigation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Blocks, ChevronDown, Github, Heart, Home, Layers, Loader2, LogOut, Menu, Newspaper, Search, Users, X, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { SkillsetAvatar } from "@/components/skillset-avatar";
import { VerifiedMark } from "@/components/verified-mark";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { SEARCH_TABS, type GlobalHit, type GlobalSearchResponse, type SearchTab } from "@/types/search";
import { SKILL_SOURCES, type SkillSource } from "@/types/skill";

const hrefOf = (h: GlobalHit) => (h.kind === "user" ? `/u/${h.person.handle}` : h.kind === "skill" ? `/skills/${h.slug}` : `/skillsets/${h.slug}`);

/** The full search page for the panel's query and filters. */
export function searchPageHref(q: string, tab: SearchTab = "all", source: SkillSource | null = null) {
  const sp = new URLSearchParams();
  if (tab !== "all") sp.set("tab", tab);
  if (q.trim()) sp.set("q", q.trim());
  if (source) sp.set("source", source);
  const qs = sp.toString();
  return qs ? `/search?${qs}` : "/search";
}

const SECTIONS: { key: string; href: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { key: "overview", href: "/", icon: Home, match: (p) => p === "/" },
  { key: "feed", href: "/feed", icon: Newspaper, match: (p) => p.startsWith("/feed") },
  { key: "skills", href: "/search?tab=skills", icon: Blocks, match: (p) => p.startsWith("/skills") },
  { key: "skillsets", href: "/search?tab=skillsets", icon: Layers, match: (p) => p.startsWith("/skillsets") },
  { key: "people", href: "/search?tab=people", icon: Users, match: (p) => p.startsWith("/u/") || p.startsWith("/authors") },
  { key: "favorites", href: "/favorites", icon: Heart, match: (p) => p.startsWith("/favorites") },
  { key: "docs", href: "/faq", icon: BookOpen, match: (p) => p.startsWith("/faq") },
];

const DEVELOPER_LINKS: { key: UiKey; href: string }[] = [
  { key: "footer.publish", href: "/dashboard/developer#publish" },
  { key: "footer.keys", href: "/dashboard/developer#keys" },
  { key: "footer.api", href: "/faq#agents" },
  { key: "footer.manifest", href: "/faq#publish-manifest" },
];

export interface MenuViewer {
  handle: string | null;
}

export function SiteMenu({ viewer }: { viewer: MenuViewer | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [source, setSource] = useState<SkillSource | null>(null);
  const [items, setItems] = useState<GlobalHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, GlobalHit[]>());

  const searching = Boolean(q.trim()) || tab !== "all" || source !== null;

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);
  const focusSearch = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  // ⌘K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  useEffect(close, [pathname, close]);

  // Results (or, with nothing typed and no filter, the "popular" strip) follow the query and the chips.
  useEffect(() => {
    if (!open) return;
    const key = new URLSearchParams({ q: q.trim(), tab, ...(source ? { source } : {}) }).toString();
    const hit = cache.current.get(key);
    if (hit) {
      setItems(hit);
      setActive(-1);
      return;
    }
    setItems(null);
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search/global?${key}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as GlobalSearchResponse;
        cache.current.set(key, body.items);
        setItems(body.items);
        setActive(-1);
      } catch {
        if (!ctrl.signal.aborted) setItems([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, q.trim() ? 160 : 0);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [q, tab, source, open]);

  const rows = searching ? (items ?? []) : [];
  // The "Open search" row is the last keyboard stop.
  const stops = rows.length + 1;
  const fullSearch = searchPageHref(q, tab, source);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
      input.current?.blur();
    } else if (e.key === "ArrowDown" && searching) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % stops);
    } else if (e.key === "ArrowUp" && searching) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? stops - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      close();
      router.push(active >= 0 && active < rows.length ? hrefOf(rows[active]) : fullSearch);
    }
  }

  const resetFilters = () => {
    setQ("");
    setTab("all");
    setSource(null);
    input.current?.focus();
  };

  return (
    <div ref={root} className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        className={cn("group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors sm:px-3", open ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border bg-surface-low text-muted-foreground hover:border-foreground/30 hover:text-foreground")}
      >
        {open ? <X className="h-4 w-4 sm:hidden" /> : <Menu className="h-4 w-4 sm:hidden" />}
        <span className="hidden sm:inline">{t("menu.label")}</span>
        <ChevronDown className={cn("hidden h-3.5 w-3.5 transition-transform duration-200 sm:block", open && "rotate-180")} />
      </button>

      <div className={cn("flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border bg-surface-low px-3 transition-colors duration-200", open ? "border-synapse/50 bg-card" : "border-border hover:border-foreground/25")}>
        {loading && searching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-synapse" /> : <Search className={cn("h-4 w-4 shrink-0", open ? "text-synapse" : "text-muted-foreground")} />}
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="site-menu-panel"
          aria-activedescendant={searching && active >= 0 ? `gs-${active}` : undefined}
          aria-label={t("header.searchAria")}
          placeholder={t("gsearch.placeholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
        {searching ? (
          <button type="button" onClick={resetFilters} aria-label={t("people.clear")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="hidden rounded-md border border-border bg-surface-high px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">⌘K</kbd>
        )}
      </div>

      {open && (
        <div id="site-menu-panel" className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain pb-4 pt-2">
          <div className="container">
            <div className="animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/60">
              {/* Filter chips: any of them turns the panel into a results view. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
                <span className="label-mono-sm">{t("menu.searchIn")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {SEARCH_TABS.map((k) => (
                    <Chip key={k} active={tab === k} onClick={() => (setTab(k), input.current?.focus())}>
                      {t(`search.tab.${k}`)}
                    </Chip>
                  ))}
                </div>
                <span className="hidden h-4 w-px bg-border sm:block" />
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={source === null} onClick={() => (setSource(null), input.current?.focus())}>
                    {t("search.source.any")}
                  </Chip>
                  {SKILL_SOURCES.map((s) => (
                    <Chip key={s} active={source === s} onClick={() => (setSource(s), input.current?.focus())}>
                      {s === "github" && <Github className="h-3 w-3" />} {t(`search.source.${s}`)}
                    </Chip>
                  ))}
                </div>
              </div>

              {searching ? (
                <div className="p-2 sm:p-3">
                  <p className="px-2 pb-2 pt-1 text-xs text-muted-foreground">{q.trim() ? t("gsearch.results") : t("gsearch.popular")}</p>
                  <div ref={list} role="listbox" className="grid gap-1 md:grid-cols-2">
                    {items === null ? (
                      [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)
                    ) : rows.length === 0 ? (
                      <p className="px-3 py-10 text-center text-sm text-muted-foreground md:col-span-2">{t("gsearch.none")}</p>
                    ) : (
                      rows.map((h, i) => <HitRow key={`${h.kind}:${h.id}`} hit={h} index={i} active={active === i} onHover={() => setActive(i)} onPick={close} />)
                    )}
                  </div>
                  <Link
                    href={fullSearch}
                    id={`gs-${rows.length}`}
                    data-index={rows.length}
                    onClick={close}
                    onMouseEnter={() => setActive(rows.length)}
                    className={cn("mt-2 flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-medium transition-colors", active === rows.length ? "border-synapse/50 bg-synapse/10 text-synapse" : "hover:border-foreground/25")}
                  >
                    <Search className="h-4 w-4" /> {t("gsearch.open")} <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                  {/* Left: the site's sections as cards. */}
                  <div className="p-4 sm:p-6">
                    <p className="mb-4 text-sm font-medium">{t("menu.sections")}</p>
                    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      {SECTIONS.map((s) => {
                        const Icon = s.icon;
                        const current = s.match(pathname);
                        return (
                          <Link key={s.key} href={s.href} onClick={close} aria-current={current ? "page" : undefined} className="group flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-surface">
                            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors", current ? "bg-synapse text-synapse-foreground" : "bg-foreground text-background group-hover:bg-synapse group-hover:text-synapse-foreground")}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{t(`menu.section.${s.key}` as UiKey)}</span>
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{t(`menu.section.${s.key}.body` as UiKey)}</span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: link columns and the popular strip. */}
                  <div className="border-t border-border bg-surface-lowest/60 p-4 sm:p-6 lg:border-l lg:border-t-0">
                    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
                      <LinkColumn title={t("footer.group.developers")}>
                        {DEVELOPER_LINKS.map((l) => (
                          <MenuLink key={l.href} href={l.href} onClick={close}>
                            {t(l.key)}
                          </MenuLink>
                        ))}
                      </LinkColumn>
                      <LinkColumn title={t("menu.account")}>
                        {viewer ? (
                          <>
                            <MenuLink href={viewer.handle ? `/u/${viewer.handle}` : "/dashboard/settings"} onClick={close}>
                              {t("console.nav.profile")}
                            </MenuLink>
                            <MenuLink href="/dashboard/settings" onClick={close}>
                              {t("menu.settings")}
                            </MenuLink>
                            <MenuLink href="/dashboard/notifications" onClick={close}>
                              {t("console.nav.notifications")}
                            </MenuLink>
                            <SignOutButton label={t("header.signOut")} className="inline-flex w-fit items-center gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
                              <LogOut className="h-3.5 w-3.5" /> {t("header.signOut")}
                            </SignOutButton>
                          </>
                        ) : (
                          <>
                            <MenuLink href="/signin" onClick={close}>
                              {t("header.signIn")}
                            </MenuLink>
                            <MenuLink href="/signup" onClick={close}>
                              {t("header.getStarted")}
                            </MenuLink>
                          </>
                        )}
                      </LinkColumn>
                      <LinkColumn title={t("menu.language")}>
                        <LocaleSwitcher variant="segments" className="flex-wrap" />
                      </LinkColumn>
                    </div>

                    <div className="mt-6 rounded-xl border border-border bg-card p-3">
                      <p className="mb-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
                        {t("gsearch.popular")}
                        <button type="button" onClick={focusSearch} className="label-mono-sm transition-colors hover:text-synapse">
                          ⌘K
                        </button>
                      </p>
                      <PopularStrip items={items} onPick={close} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs transition-colors", active ? "border-synapse/60 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground")}>
      {children}
    </button>
  );
}

function LinkColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <span className="label-mono-sm">{title}</span>
      {children}
    </div>
  );
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className="w-fit text-sm text-foreground/85 transition-colors hover:text-synapse">
      {children}
    </Link>
  );
}

/** Three popular entries under the link columns — what an empty query returns. */
function PopularStrip({ items, onPick }: { items: GlobalHit[] | null; onPick: () => void }) {
  if (items === null)
    return (
      <div className="space-y-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-12 rounded-lg" />
        ))}
      </div>
    );
  return (
    <div className="space-y-0.5">
      {items.slice(0, 3).map((h, i) => (
        <HitRow key={`${h.kind}:${h.id}`} hit={h} index={i} active={false} onPick={onPick} compact />
      ))}
    </div>
  );
}

function HitRow({ hit: h, index, active, onHover, onPick, compact }: { hit: GlobalHit; index: number; active: boolean; onHover?: () => void; onPick: () => void; compact?: boolean }) {
  const { t, n } = useI18n();
  return (
    <Link
      id={compact ? undefined : `gs-${index}`}
      data-index={compact ? undefined : index}
      role={compact ? undefined : "option"}
      aria-selected={compact ? undefined : active}
      href={hrefOf(h)}
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors", active ? "bg-surface-high/70" : "hover:bg-surface")}
    >
      <HitIcon hit={h} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{h.kind === "user" ? h.person.name || h.person.handle : h.name}</span>
          {h.kind === "user" && h.person.verified && <VerifiedMark size="sm" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {h.kind === "user" ? `@${h.person.handle}${h.bio ? ` · ${h.bio}` : ""}` : h.kind === "skill" ? h.authorName : `${h.author.name || h.author.handle} · ${n("skillset.entries", h.entries)}`}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        {h.kind === "skill" && h.source === "github" && <Github className="h-3.5 w-3.5" aria-label="GitHub" />}
        <span className="rounded-full bg-surface px-2 py-0.5">{h.kind === "user" ? t("gsearch.kind.user") : h.kind === "skillset" ? t("gsearch.kind.skillset") : t(`gsearch.kind.${h.category}`)}</span>
      </span>
    </Link>
  );
}

function HitIcon({ hit }: { hit: GlobalHit }) {
  if (hit.kind === "user") return <Avatar author={hit.person} size="md" className="h-9 w-9 rounded-full" />;
  if (hit.kind === "skillset") return <SkillsetAvatar name={hit.name} avatar={hit.avatar} size="sm" className="h-9 w-9 rounded-xl" />;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-synapse/10 text-synapse ring-1 ring-inset ring-synapse/20">
      <CategoryIcon category={hit.category} className="h-4 w-4" />
    </span>
  );
}
