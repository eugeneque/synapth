"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Loader2, MonitorSmartphone, Rows3, SearchX, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { CategoryPills } from "@/components/category-pills";
import { SortControl } from "@/components/sort-control";
import { SkillCard } from "@/components/skill-card";
import { FacetGroup } from "@/components/facet-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { axon, type SearchResponse } from "@/axon/client";
import { INSTALL_TARGETS } from "@/axon/install";
import { useI18n } from "@/axon/i18n";
import { rich } from "@/lib/i18n/rich";
import { cn } from "@/lib/utils";
import { SECURITY_LEVELS, type SecurityLevel, type SkillCategory, type SortMode } from "@/types/skill";

interface Props {
  initial: SearchResponse;
  initialSort: SortMode;
  initialCategory: SkillCategory | null;
  initialQuery: string;
  initialLanguage: string | null;
  initialAuthor: string | null;
  initialLevel: SecurityLevel | null;
  autoFocus?: boolean;
}

const PAGE = 24;

/** Operators the query parser understands; one click appends them to the search line. */
const OPERATORS = ["category:MCP", "is:verified", "lang:python", "stars:>100"];

const LEVEL_VARIANT: Record<SecurityLevel, "verified" | "community" | "sandbox"> = { Verified: "verified", Community: "community", Sandbox: "sandbox" };

/**
 * Client half of the registry. The server renders the first page; every
 * change afterwards hits `/api/v1/search` through Axon and mirrors the state
 * into the URL so any view is shareable.
 */
export function SkillStorefront({ initial, initialSort, initialCategory, initialQuery, initialLanguage, initialAuthor, initialLevel, autoFocus }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { t, n } = useI18n();
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState<SkillCategory | null>(initialCategory);
  const [language, setLanguage] = useState<string | null>(initialLanguage);
  const [author, setAuthor] = useState<string | null>(initialAuthor);
  const [level, setLevel] = useState<SecurityLevel | null>(initialLevel);
  const [sort, setSort] = useState<SortMode>(initialSort);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const first = useRef(true);
  const requestId = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        document.getElementById("registry-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasQuery = q.trim().length > 0;
  const apiSort = sort === "hidden-gems" ? "relevance" : sort === "trending" && hasQuery ? "relevance" : sort === "relevance" && !hasQuery ? "trending" : sort;
  const filters = { category: category ?? undefined, language: language ?? undefined, author: author ?? undefined, securityLevel: level ?? undefined };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = ++requestId.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axon.search.query({ q, ...filters, sort: apiSort, limit: PAGE });
        if (id === requestId.current) setResult(res);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
      const next = new URLSearchParams(params.toString());
      const set = (k: string, v: string | null) => (v ? next.set(k, v) : next.delete(k));
      set("q", q);
      set("category", category);
      set("lang", language);
      set("author", author);
      set("level", level);
      set("sort", sort !== "trending" ? sort : null);
      next.delete("focus");
      startTransition(() => router.replace(`/explore?${next.toString()}`, { scroll: false }));
    }, 220);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, language, author, level, sort]);

  async function loadMore() {
    setLoading(true);
    try {
      const res = await axon.search.query({ q, ...filters, sort: apiSort, limit: PAGE, offset: result.hits.length });
      setResult((r) => ({ ...res, hits: [...r.hits, ...res.hits] }));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setQ("");
    setCategory(null);
    setLanguage(null);
    setAuthor(null);
    setLevel(null);
    setSort("trending");
  }

  const counts = Object.fromEntries(result.facets.category.map((b) => [b.value, b.count])) as Partial<Record<SkillCategory, number>>;
  const levelCounts = Object.fromEntries(result.facets.securityLevel.map((b) => [b.value, b.count])) as Partial<Record<SecurityLevel, number>>;
  const visibleHits = sort === "hidden-gems" ? result.hits.filter((h) => h.skill.securityLevel === "Verified" && h.skill.downloadsCount <= 5000 && h.skill.stats.retentionRate >= 0.6) : result.hits;
  const activeFilters = [category, language, author, level].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Search line + operator chips. */}
      <div className="space-y-2">
        <SearchBar value={q} onChange={setQ} autoFocus={autoFocus} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="label-mono-sm mr-1">{t("sf.operators")}</span>
          {OPERATORS.map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => setQ((cur) => (cur.includes(op) ? cur : `${cur.trim()} ${op}`.trim()))}
              className="label-mono-sm inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 normal-case tracking-normal text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground"
            >
              <span className="text-synapse">+</span>
              {op}
            </button>
          ))}
        </div>
      </div>

      {/* Category segments · sort · view. */}
      <div className="flex flex-col gap-3 rounded-md bg-surface-low/40 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <CategoryPills value={category} onChange={setCategory} counts={counts} total={result.total} />
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <SortControl value={sort} onChange={setSort} showRelevance={hasQuery} />
          <div className="flex items-center gap-0.5 rounded-md bg-surface p-0.5">
            <button type="button" aria-label={t("sf.gridView")} aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("flex h-7 w-7 items-center justify-center rounded-md", view === "grid" ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button type="button" aria-label={t("sf.listView")} aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex h-7 w-7 items-center justify-center rounded-md", view === "list" ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Rows3 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-6 lg:flex-row">
        {/* Faceted sidebar. */}
        <aside className="flex w-full shrink-0 flex-col gap-6 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-20 lg:w-72">
          <div className="-mx-4 -mt-4 flex items-center justify-between rounded-t-[inherit] border-b border-border bg-surface-lowest px-4 py-3">
            <span className="label-mono inline-flex items-center gap-2 font-semibold text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-synapse" /> {t("sf.facets")}
            </span>
            <button type="button" onClick={reset} className="label-mono-sm transition-colors hover:text-synapse">
              {t("sf.resetAll")}
            </button>
          </div>

          <FacetGroup
            title={t("sf.securityGrade")}
            icon={<ShieldCheck className="h-4 w-4" />}
            options={[...SECURITY_LEVELS].reverse().map((l) => ({ value: l, label: t(`level.${l}.label`), tag: <Badge variant={LEVEL_VARIANT[l]}>{levelCounts[l] ?? 0}</Badge> }))}
            active={level}
            onToggle={(v) => setLevel((v as SecurityLevel) ?? null)}
          />
          <div className="h-px w-full bg-border" />
          <FacetGroup title={t("sf.language")} options={result.facets.language.slice(0, 8)} active={language} onToggle={setLanguage} note={language ? <span className="label-mono-sm text-synapse">{t("sf.selected")}</span> : undefined} />
          <div className="h-px w-full bg-border" />
          <FacetGroup title={t("sf.publisher")} options={result.facets.author.slice(0, 8)} active={author} onToggle={setAuthor} mono note={author ? <span className="label-mono-sm text-synapse">{t("sf.selected")}</span> : undefined} />
          <div className="h-px w-full bg-border" />
          <div className="flex flex-col gap-3">
            <span className="label-mono font-semibold text-foreground">{t("sf.tags")}</span>
            <div className="flex flex-wrap gap-1.5">
              {result.facets.tags.slice(0, 12).map((t) => (
                <button key={t.value} type="button" onClick={() => setQ((cur) => `${cur.trim()} tag:${t.value}`.trim())} className="label-mono-sm rounded-md bg-surface px-2 py-1 normal-case tracking-normal text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground">
                  {t.value} <span className="opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="h-px w-full bg-border" />
          <div className="flex flex-col gap-3">
            <span className="label-mono inline-flex items-center justify-between font-semibold text-foreground">
              {t("sf.targetClient")} <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            </span>
            <div className="grid grid-cols-2 gap-2">
              {INSTALL_TARGETS.map((target) => (
                <span key={target.id} className="label-mono-sm inline-flex items-center justify-center gap-1.5 rounded-md bg-surface px-2 py-2 text-foreground">
                  <span className="dot-live" /> {t(`install.target.${target.id}`)}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-md bg-surface p-3">
            <div className="label-mono-sm flex justify-between">
              <span>{t("sf.indexed", { n: result.total.toLocaleString("en") })}</span>
              <span className="font-semibold text-foreground">{t("sf.filters", { n: activeFilters })}</span>
            </div>
          </div>
        </aside>

        {/* Results. */}
        <section className="flex w-full min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="label-mono flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground">
              {loading ? <Loader2 className="h-3 w-3 animate-spin text-synapse" /> : <span className="dot-live animate-pulse-dot" />}
              <span>{t("sf.activeMatches")}</span>
              <span className="label-mono-sm rounded-md bg-surface-high px-2 py-0.5 normal-case tracking-normal">
                {n("sf.matching", result.total, { n: result.total.toLocaleString("en") })}
                {hasQuery && ` · ${result.tookMs} ms`}
              </span>
              {result.corrections.length > 0 && (
                <span className="label-mono-sm inline-flex items-center gap-1 normal-case tracking-normal">
                  <Sparkles className="h-3 w-3 text-synapse" /> {t("sf.didYouMean")}{" "}
                  {result.corrections.map((c) => (
                    <button key={c.from} type="button" className="text-synapse hover:underline" onClick={() => setQ(q.replace(new RegExp(c.from, "i"), c.to))}>
                      {c.to}
                    </button>
                  ))}
                  ?
                </span>
              )}
              {sort === "hidden-gems" && <span className="label-mono-sm normal-case tracking-normal">{t("sf.gemsNote")}</span>}
            </div>
          </div>

          {visibleHits.length === 0 ? (
            <div className="hatch flex flex-col items-center gap-3 border border-border py-20 text-center">
              <SearchX className="h-6 w-6 text-muted-foreground" />
              <p className="label-mono">{t("sf.noMatch")}</p>
              <Button variant="mono" size="sm" onClick={reset}>
                {t("sf.resetFilters")}
              </Button>
            </div>
          ) : (
            <div className={cn("grid gap-4", view === "grid" ? "md:grid-cols-2" : "grid-cols-1")}>
              {visibleHits.map((h) => (
                <SkillCard key={h.skill.id} skill={h.skill} highlights={h.highlights} layout={view} />
              ))}
            </div>
          )}

          <div className="flex flex-col items-center justify-between gap-4 rounded-xl border border-border bg-surface-low/40 p-4 sm:flex-row">
            <span className="label-mono-sm inline-flex items-center gap-2">
              <span className="dot-live" /> <span className="[&_strong]:text-foreground">{rich(t("sf.showing", { shown: visibleHits.length, total: result.total.toLocaleString("en") }))}</span>
            </span>
            {result.hits.length < result.total && sort !== "hidden-gems" ? (
              <Button variant="mono" size="sm" onClick={loadMore} disabled={loading}>
                {loading && <Loader2 className="animate-spin" />} {t("sf.loadNext", { n: Math.min(PAGE, result.total - result.hits.length) })}
              </Button>
            ) : (
              <span className="label-mono-sm">{t("sf.endOfIndex")}</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
