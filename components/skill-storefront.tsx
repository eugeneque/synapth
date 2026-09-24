"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileDown, LayoutGrid, Loader2, Rows3, SearchX, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { CategoryPills } from "@/components/category-pills";
import { SortControl } from "@/components/sort-control";
import { SkillCard } from "@/components/skill-card";
import { FacetGroup } from "@/components/facet-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { axon, type SearchResponse } from "@/axon/client";
import { useI18n } from "@/axon/i18n";
import { rich } from "@/lib/i18n/rich";
import { cn } from "@/lib/utils";
import { SECURITY_LEVELS, type SecurityLevel, type SkillCategory, type SkillSource, type SortMode } from "@/types/skill";

interface Props {
  initial: SearchResponse;
  initialSort: SortMode;
  initialCategory: SkillCategory | null;
  initialQuery: string;
  initialLanguage: string | null;
  initialAuthor: string | null;
  initialLevel: SecurityLevel | null;
  autoFocus?: boolean;
  /** GitHub-only / Synapth-only entries; set by the search page's source filter. */
  source?: SkillSource | null;
  /** The search page owns the query line; the storefront then only reads `initialQuery`. */
  hideSearch?: boolean;
  /** Shown above the results while nothing narrows the view (the catalogue puts community skillsets here). */
  spotlight?: ReactNode;
}

const PAGE = 24;

/** Operators the query parser understands; one click appends them to the search line. */
const OPERATORS = ["category:MCP", "is:verified", "lang:python", "stars:>100"];

const LEVEL_VARIANT: Record<SecurityLevel, "verified" | "community" | "sandbox"> = { Verified: "verified", Community: "community", Sandbox: "sandbox" };

/**
 * Client half of the catalogue: one search line, category segments, and
 * everything else (security, language, publisher, tags) folded behind a
 * "Filters" toggle so the grid gets the room. The server renders the first page; every
 * change afterwards hits `/api/v1/search` through Axon and mirrors the state
 * into the URL so any view is shareable.
 */
export function SkillStorefront({ initial, initialSort, initialCategory, initialQuery, initialLanguage, initialAuthor, initialLevel, autoFocus, source = null, hideSearch = false, spotlight }: Props) {
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
  const [filtersOpen, setFiltersOpen] = useState(Boolean(initialLanguage || initialAuthor || initialLevel));
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
  const filters = { category: category ?? undefined, language: language ?? undefined, author: author ?? undefined, securityLevel: level ?? undefined, source: source ?? undefined };

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
      // The page re-renders on every URL change; skip the round trip when nothing moved.
      if (next.toString() !== params.toString()) startTransition(() => router.replace(`/search?${next.toString()}`, { scroll: false }));
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

  const chips = [
    level && { key: "level", label: t(`level.${level}.label`), clear: () => setLevel(null) },
    language && { key: "lang", label: language, clear: () => setLanguage(null) },
    author && { key: "author", label: `@${author}`, clear: () => setAuthor(null) },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;
  const quiet = !hasQuery && activeFilters === 0 && sort === "trending";
  const exportHref = `/api/v1/skills?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}${source ? `&source=${source}` : ""}`;

  return (
    <div className="space-y-6">
      {!hideSearch && <SearchBar value={q} onChange={setQ} autoFocus={autoFocus} />}

      {/* Category segments · filters toggle · sort · view. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <CategoryPills value={category} onChange={setCategory} counts={counts} total={result.total} />
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-xs font-medium transition-colors", filtersOpen || chips.length ? "border-foreground/25 bg-surface-high/60 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t("sf.facets")}
            {chips.length > 0 && <span className="rounded-full bg-synapse px-1.5 text-[10px] font-semibold leading-4 text-synapse-foreground">{chips.length}</span>}
          </button>
          <SortControl value={sort} onChange={setSort} showRelevance={hasQuery} />
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            <button type="button" aria-label={t("sf.gridView")} aria-pressed={view === "grid"} onClick={() => setView("grid")} className={cn("flex h-7 w-7 items-center justify-center rounded-full", view === "grid" ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label={t("sf.listView")} aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex h-7 w-7 items-center justify-center rounded-full", view === "list" ? "bg-surface-high text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Rows3 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Folded facets. */}
      {filtersOpen && (
        <div className="animate-rise rounded-2xl border border-border bg-card/60 p-5">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FacetGroup
              title={t("sf.securityGrade")}
              icon={<ShieldCheck className="h-4 w-4" />}
              options={[...SECURITY_LEVELS].reverse().map((l) => ({ value: l, label: t(`level.${l}.label`), tag: <Badge variant={LEVEL_VARIANT[l]}>{levelCounts[l] ?? 0}</Badge> }))}
              active={level}
              onToggle={(v) => setLevel((v as SecurityLevel) ?? null)}
            />
            <FacetGroup title={t("sf.language")} options={result.facets.language.slice(0, 6)} active={language} onToggle={setLanguage} />
            <FacetGroup title={t("sf.publisher")} options={result.facets.author.slice(0, 6)} active={author} onToggle={setAuthor} mono />
            <div className="flex flex-col gap-3">
              <span className="label-mono font-semibold text-foreground">{t("sf.tags")}</span>
              <div className="flex flex-wrap gap-1.5">
                {result.facets.tags.slice(0, 12).map((tag) => (
                  <button key={tag.value} type="button" onClick={() => setQ((cur) => `${cur.trim()} tag:${tag.value}`.trim())} className="rounded-full bg-surface px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground">
                    #{tag.value} <span className="opacity-60">{tag.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">{t("sf.operators")}</span>
              {OPERATORS.map((op) => (
                <button key={op} type="button" onClick={() => setQ((cur) => (cur.includes(op) ? cur : `${cur.trim()} ${op}`.trim()))} className="rounded-full bg-surface px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground">
                  <span className="text-synapse">+</span> {op}
                </button>
              ))}
            </div>
            <button type="button" onClick={reset} className="text-xs text-muted-foreground transition-colors hover:text-synapse">
              {t("sf.resetAll")}
            </button>
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={c.clear} className="inline-flex items-center gap-1.5 rounded-full border border-synapse/30 bg-synapse/10 py-1 pl-3 pr-2 text-xs text-synapse transition-colors hover:border-synapse/60">
              {c.label} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {quiet && spotlight}

      {/* Results. */}
      <section className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-synapse" />}
            <span>
              {n("sf.matching", result.total, { n: result.total.toLocaleString("en") })}
              {hasQuery && <span className="opacity-60"> · {result.tookMs} ms</span>}
            </span>
            {result.corrections.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-synapse" /> {t("sf.didYouMean")}{" "}
                {result.corrections.map((c) => (
                  <button key={c.from} type="button" className="text-synapse hover:underline" onClick={() => setQ(q.replace(new RegExp(c.from, "i"), c.to))}>
                    {c.to}
                  </button>
                ))}
                ?
              </span>
            )}
            {sort === "hidden-gems" && <span className="text-xs">{t("sf.gemsNote")}</span>}
          </span>
          <a href={exportHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs transition-colors hover:text-foreground">
            <FileDown className="h-3.5 w-3.5" /> {t("explore.export")}
          </a>
        </div>

        {visibleHits.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
            <SearchX className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("sf.noMatch")}</p>
            <Button variant="outline" size="sm" className="rounded-full" onClick={reset}>
              {t("sf.resetFilters")}
            </Button>
          </div>
        ) : (
          <div className={cn("stagger grid gap-5", view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1")}>
            {visibleHits.map((h) => (
              <SkillCard key={h.skill.id} skill={h.skill} highlights={h.highlights} layout={view} />
            ))}
          </div>
        )}

        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <span className="text-xs text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">{rich(t("sf.showing", { shown: visibleHits.length, total: result.total.toLocaleString("en") }))}</span>
          {result.hits.length < result.total && sort !== "hidden-gems" ? (
            <Button variant="outline" onClick={loadMore} disabled={loading} className="rounded-full px-6">
              {loading && <Loader2 className="animate-spin" />} {t("sf.loadNext", { n: Math.min(PAGE, result.total - result.hits.length) })}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground/70">{t("sf.endOfIndex")}</span>
          )}
        </div>
      </section>
    </div>
  );
}
