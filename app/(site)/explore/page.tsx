import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, PlusCircle } from "lucide-react";
import { SkillStorefront } from "@/components/skill-storefront";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { skillRepository } from "@/cortex/repository";
import { getI18n } from "@/cortex/locale";
import { rich } from "@/lib/i18n/rich";
import { formatCompact } from "@/lib/utils";
import { SECURITY_LEVELS, SKILL_CATEGORIES, type SecurityLevel, type SkillCategory, type SortMode } from "@/types/skill";
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

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = pick(sp.q) ?? "";
  const rawCategory = pick(sp.category);
  const category = (SKILL_CATEGORIES as readonly string[]).includes(rawCategory ?? "") ? (rawCategory as SkillCategory) : null;
  const rawLevel = pick(sp.level);
  const level = (SECURITY_LEVELS as readonly string[]).includes(rawLevel ?? "") ? (rawLevel as SecurityLevel) : null;
  const rawSort = pick(sp.sort);
  const sort: SortMode = rawSort === "hidden-gems" || rawSort === "recent" || rawSort === "relevance" ? rawSort : q ? "relevance" : "trending";
  const language = pick(sp.lang) ?? null;
  const author = pick(sp.author) ?? null;
  const focus = pick(sp.focus) === "1";

  const [res, total, { t }] = await Promise.all([
    skillRepository.search(q, { category: category ?? undefined, language: language ?? undefined, author: author ?? undefined, securityLevel: level ?? undefined, sort: sort === "recent" ? "recent" : q ? "relevance" : "trending", limit: 24 }),
    skillRepository.all().then((s) => s.length),
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

  return (
    <>
      <div className="border-b border-border bg-surface-lowest/70">
        <div className="container flex flex-col justify-between gap-4 py-8 md:flex-row md:items-end md:py-12">
          <div className="flex flex-col gap-2">
            <span className="label-mono text-synapse">{t("explore.index", { n: formatCompact(total) })}</span>
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("explore.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("explore.lead")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
            <Button asChild variant="mono">
              <a href={`/api/v1/skills?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`} target="_blank" rel="noreferrer">
                <FileDown className="text-synapse" /> {t("explore.export")}
              </a>
            </Button>
            <Button asChild className="font-mono text-[11px] uppercase tracking-[0.14em]">
              <Link href="/dashboard#publish">
                <PlusCircle /> {t("explore.register")}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <section id="catalogue" className="container scroll-mt-16 py-8">
        <Suspense>
          <SkillStorefront initial={page} initialSort={sort} initialCategory={category} initialQuery={q} initialLanguage={language} initialAuthor={author} initialLevel={level} autoFocus={focus} />
        </Suspense>
      </section>

      <section className="container pb-4">
        <div className="flex flex-col items-center justify-between gap-6 rounded-xl border border-border bg-surface-low/40 p-6 md:flex-row">
          <div className="flex max-w-xl flex-col gap-2">
            <Badge variant="synapse" className="self-start">
              {t("explore.schema")}
            </Badge>
            <h4 className="text-lg font-semibold tracking-tight">{t("explore.building")}</h4>
            <p className="text-sm text-muted-foreground">{rich(t("explore.buildingLead"))}</p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row">
            <Button asChild variant="mono">
              <Link href="/faq#publish">{t("explore.readSpec")}</Link>
            </Button>
            <Button asChild className="font-mono text-[11px] uppercase tracking-[0.14em]">
              <Link href="/dashboard#publish">{t("explore.submit")}</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
