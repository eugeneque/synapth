import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, Layers, PlusCircle, Sparkles } from "lucide-react";
import { SkillStorefront } from "@/components/skill-storefront";
import { SkillsetBrowser, SKILLSET_SORTS } from "@/components/skillset-browser";
import { SkillsetCard } from "@/components/skillset-card";
import { Button } from "@/components/ui/button";
import { skillRepository } from "@/cortex/repository";
import { listSkillsets } from "@/cortex/skillsets";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { cn, formatCompact } from "@/lib/utils";
import { SECURITY_LEVELS, SKILL_CATEGORIES, type SecurityLevel, type SkillCategory, type SortMode } from "@/types/skill";
import type { SkillsetSort, SkillsetSummary } from "@/types/skillset";
import type { SearchResponse } from "@/axon/client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.explore.title"), description: t("meta.explore.description") };
}
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function pick(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The catalogue: skills / MCP servers / tools and community skillsets under
 * one roof, switched by `?tab=skillsets`. Skills are the client storefront;
 * skillsets are a server-rendered grid with GET filters.
 */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tab = pick(sp.tab) === "skillsets" ? "skillsets" : "skills";
  const q = (pick(sp.q) ?? "").slice(0, 200);
  const [session, { t }, total, setCount] = await Promise.all([auth(), getI18n(), skillRepository.all().then((s) => s.length), listSkillsets({ limit: 200 }).then((s) => s.length)]);
  const createSet = session?.user ? "/skillsets/new" : "/signin?callbackUrl=/skillsets/new";

  const tabs = [
    { id: "skills", href: "/explore", label: t("explore.tab.skills"), icon: Layers, count: total },
    { id: "skillsets", href: "/explore?tab=skillsets", label: t("explore.tab.skillsets"), icon: Boxes, count: setCount },
  ] as const;

  return (
    <div className="container space-y-8 py-12 md:py-16">
      <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-2xl space-y-3">
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{t("explore.heading")}</h1>
          <p className="text-base leading-relaxed text-muted-foreground">{t("explore.leadSocial")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild variant="outline" className="rounded-full">
            <Link href={createSet}>
              <Boxes className="text-synapse" /> {t("skillsets.create")}
            </Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/dashboard#publish">
              <PlusCircle /> {t("explore.register")}
            </Link>
          </Button>
        </div>
      </header>

      <nav aria-label={t("explore.heading")} className="flex items-center gap-1 border-b border-border">
        {tabs.map((x) => (
          <Link key={x.id} href={x.href} aria-current={tab === x.id ? "page" : undefined} className={cn("relative -mb-px inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors", tab === x.id ? "border-synapse text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <x.icon className={cn("h-4 w-4", tab === x.id && "text-synapse")} /> {x.label}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === x.id ? "bg-synapse/15 text-synapse" : "bg-surface text-muted-foreground")}>{formatCompact(x.count)}</span>
          </Link>
        ))}
      </nav>

      {tab === "skillsets" ? <SkillsetsTab sp={sp} q={q} createHref={createSet} /> : <SkillsTab sp={sp} q={q} />}
    </div>
  );
}

async function SkillsTab({ sp, q }: { sp: Search; q: string }) {
  const rawCategory = pick(sp.category);
  const category = (SKILL_CATEGORIES as readonly string[]).includes(rawCategory ?? "") ? (rawCategory as SkillCategory) : null;
  const rawLevel = pick(sp.level);
  const level = (SECURITY_LEVELS as readonly string[]).includes(rawLevel ?? "") ? (rawLevel as SecurityLevel) : null;
  const rawSort = pick(sp.sort);
  const sort: SortMode = rawSort === "hidden-gems" || rawSort === "recent" || rawSort === "relevance" ? rawSort : q ? "relevance" : "trending";
  const language = pick(sp.lang) ?? null;
  const author = pick(sp.author) ?? null;
  const focus = pick(sp.focus) === "1";

  const [res, featured, { t }] = await Promise.all([
    skillRepository.search(q, { category: category ?? undefined, language: language ?? undefined, author: author ?? undefined, securityLevel: level ?? undefined, sort: sort === "recent" ? "recent" : q ? "relevance" : "trending", limit: 24 }),
    listSkillsets({ sort: "popular", limit: 3 }),
    getI18n(),
  ]);
  const page: SearchResponse = {
    hits: res.hits.map((h) => ({ skill: h.skill, score: h.score, matched: h.matched, highlights: h.highlights })),
    total: res.total,
    limit: res.limit,
    offset: res.offset,
    facets: res.facets,
    corrections: res.corrections,
    filters: res.parsed.filters,
    tookMs: res.tookMs,
  };

  // Community skillsets ride along on the untouched catalogue view.
  const spotlight = featured.length ? <CommunitySpotlight sets={featured} title={t("explore.spotlight.title")} lead={t("explore.spotlight.lead")} all={t("explore.spotlight.all")} /> : null;

  return (
    <Suspense>
      <SkillStorefront initial={page} initialSort={sort} initialCategory={category} initialQuery={q} initialLanguage={language} initialAuthor={author} initialLevel={level} autoFocus={focus} spotlight={spotlight} />
    </Suspense>
  );
}

function CommunitySpotlight({ sets, title, lead, all }: { sets: SkillsetSummary[]; title: string; lead: string; all: string }) {
  return (
    <section className="space-y-4 rounded-3xl border border-border bg-surface-lowest/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Sparkles className="h-4 w-4 text-synapse" /> {title}
          </h2>
          <p className="text-sm text-muted-foreground">{lead}</p>
        </div>
        <Link href="/explore?tab=skillsets&sort=popular" className="group inline-flex items-center gap-1.5 text-sm text-synapse">
          {all} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {sets.map((set) => (
          <SkillsetCard key={set.id} set={set} className="bg-card" />
        ))}
      </div>
    </section>
  );
}

function SkillsetsTab({ sp, q, createHref }: { sp: Search; q: string; createHref: string }) {
  const rawSort = pick(sp.sort) as SkillsetSort | undefined;
  const sort: SkillsetSort = rawSort && SKILLSET_SORTS.includes(rawSort) ? rawSort : "recent";
  return <SkillsetBrowser q={q} verifiedOnly={pick(sp.verified) === "1"} sort={sort} createHref={createHref} />;
}
