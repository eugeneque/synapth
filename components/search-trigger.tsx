"use client";

/**
 * Global search box in the header. Focus it (or ⌘K / Ctrl+K) and a dropdown
 * shows 10 mixed results — people, skills / MCP / tools, skillsets — from
 * `GET /api/v1/search/global`; a handle finds the person, `@` searches people
 * only. The list scrolls, arrows + Enter navigate, and the last row, "Open
 * search", leads to the full search page (`/search`), which is also where the
 * catalogue and people directory live.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Github, Loader2, Search, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { SkillsetAvatar } from "@/components/skillset-avatar";
import { VerifiedMark } from "@/components/verified-mark";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { GlobalHit, GlobalSearchResponse } from "@/types/search";

const hrefOf = (h: GlobalHit) => (h.kind === "user" ? `/u/${h.person.handle}` : h.kind === "skill" ? `/skills/${h.slug}` : `/skillsets/${h.slug}`);
export const searchPageHref = (q: string) => (q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");

export function SearchTrigger() {
  const router = useRouter();
  const pathname = usePathname();
  const { t, n } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<GlobalHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, GlobalHit[]>());

  const openBox = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  // ⌘K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openBox();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBox]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  useEffect(close, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const key = q.trim();
    const hit = cache.current.get(key);
    if (hit) {
      setItems(hit);
      setActive(-1);
      return;
    }
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search/global?q=${encodeURIComponent(key)}`, { signal: ctrl.signal });
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
    }, key ? 160 : 0);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [q, open]);

  const rows = items ?? [];
  // The "Open search" row is the last keyboard stop.
  const stops = rows.length + 1;
  const go = (href: string) => {
    close();
    router.push(href);
  };

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
      input.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % stops);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? stops - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(active >= 0 && active < rows.length ? hrefOf(rows[active]) : searchPageHref(q));
    }
  }

  return (
    <div ref={root} className="relative">
      {/* Phones: an icon that opens the box; md+: the box itself. */}
      <button type="button" onClick={openBox} aria-label={t("header.searchAria")} className={cn("flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-low text-muted-foreground transition-colors hover:text-foreground md:hidden", open && "invisible")}>
        <Search className="h-4 w-4" />
      </button>
      <div
        className={cn(
          "items-center gap-2 rounded-full border bg-surface-low px-3 transition-all duration-200",
          open ? "fixed inset-x-4 top-3.5 z-50 flex h-10 border-synapse/50 bg-card md:static md:w-80 lg:w-96" : "hidden h-9 border-border hover:border-foreground/25 md:flex md:w-56 lg:w-64",
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-synapse" /> : <Search className={cn("h-4 w-4 shrink-0", open ? "text-synapse" : "text-muted-foreground")} />}
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
          aria-controls="global-search-list"
          aria-activedescendant={active >= 0 ? `gs-${active}` : undefined}
          aria-label={t("header.searchAria")}
          placeholder={t("gsearch.placeholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
        {q ? (
          <button type="button" onClick={() => (setQ(""), input.current?.focus())} aria-label={t("people.clear")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          !open && <kbd className="rounded-md border border-border bg-surface-high px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
        )}
      </div>

      {open && (
        <div className="fixed inset-x-4 top-[3.75rem] z-50 animate-rise overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/50 md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[26rem]">
          <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">{q.trim() ? t("gsearch.results") : t("gsearch.popular")}</p>
          <div ref={list} id="global-search-list" role="listbox" className="max-h-[min(24rem,65vh)] overflow-y-auto overscroll-contain p-1.5">
            {items === null ? (
              <div className="space-y-1.5 p-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-12 rounded-xl" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("gsearch.none")}</p>
            ) : (
              rows.map((h, i) => (
                <Link
                  key={`${h.kind}:${h.id}`}
                  id={`gs-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={active === i}
                  href={hrefOf(h)}
                  onClick={close}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors", active === i ? "bg-surface-high/70" : "hover:bg-surface")}
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
              ))
            )}
            {/* Last row after everything scrolled by: the full search page. */}
            <Link
              href={searchPageHref(q)}
              id={`gs-${rows.length}`}
              data-index={rows.length}
              onClick={close}
              onMouseEnter={() => setActive(rows.length)}
              className={cn("mt-1.5 flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-medium transition-colors", active === rows.length ? "border-synapse/50 bg-synapse/10 text-synapse" : "hover:border-foreground/25")}
            >
              <Search className="h-4 w-4" /> {t("gsearch.open")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
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
