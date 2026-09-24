import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, Github, Layers, PlusCircle, Search as SearchIcon, UserPlus, Users } from "lucide-react";
import { SkillStorefront } from "@/components/skill-storefront";
import { SkillsetBrowser, SKILLSET_SORTS } from "@/components/skillset-browser";
import { SkillsetCard } from "@/components/skillset-card";
import { SkillCard } from "@/components/skill-card";
import { FeaturedSlider, type FeaturedItem } from "@/components/featured-slider";
import { FriendTile, PersonCard } from "@/components/person-card";
import { SearchPageInput } from "@/components/search-page-input";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { skillRepository } from "@/cortex/repository";
import { listSkillsets } from "@/cortex/skillsets";
import { listRequests, searchPeople } from "@/cortex/friends";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { cn } from "@/lib/utils";
import { SECURITY_LEVELS, SKILL_CATEGORIES, SKILL_SOURCES, skillSource, type SecurityLevel, type Skill, type SkillCategory, type SkillSource, type SortMode } from "@/types/skill";
import { SEARCH_TABS, type SearchTab } from "@/types/search";
import type { SkillsetSort } from "@/types/skillset";
import type { SearchResponse } from "@/axon/client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("search.meta"), description: t("search.lead") };
}
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The full search page — also home of the catalogue and the people directory
 * (`/explore` and `/people` redirect here). One query line over four tabs;
 * the source filter (GitHub / On Synapth) applies to catalogue entries, and
 * on "All" it also drops people and skillsets under GitHub (both live only on
 * Synapth).
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const rawTab = pick(sp.tab);
  const tab: SearchTab = (SEARCH_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as SearchTab) : "all";
  const q = (pick(sp.q) ?? "").slice(0, 200);
  const rawSource = pick(sp.source);
  const source = (SKILL_SOURCES as readonly string[]).includes(rawSource ?? "") ? (rawSource as SkillSource) : null;
  const [session, { t }] = await Promise.all([auth(), getI18n()]);
  const viewerId = session?.user?.id ?? null;

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = { tab: tab === "all" ? null : tab, q: q || null, source, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/search?${s}` : "/search";
  };
  // Switching tabs keeps the query and the source; catalogue-only filters are dropped.
  const tabs = [
    { id: "all", label: t("search.tab.all"), icon: SearchIcon },
    { id: "people", label: t("search.tab.people"), icon: Users },
    { id: "skills", label: t("search.tab.skills"), icon: Layers },
    { id: "skillsets", label: t("search.tab.skillsets"), icon: Boxes },
  ] as const;
  const showSource = tab === "all" || tab === "skills";
  const sources = [
    { id: null, label: t("search.source.any"), icon: null },
    { id: "github", label: t("search.source.github"), icon: <Github className="h-3.5 w-3.5" /> },
    { id: "synapth", label: t("search.source.synapth"), icon: <Logo className="h-3.5 w-3.5" /> },
  ] as const;

  return (
    <div className="container space-y-7 py-12 md:py-16">
      <header className="space-y-5">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl space-y-3">
            <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{t("search.title")}</h1>
            <p className="text-base leading-relaxed text-muted-foreground">{t("search.lead")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button asChild variant="outline" className="rounded-full">
              <Link href={session?.user ? "/skillsets/new" : "/signin?callbackUrl=/skillsets/new"}>
                <Boxes className="text-synapse" /> {t("skillsets.create")}
              </Link>
            </Button>
            <Button asChild className="rounded-full">
              <Link href="/dashboard/developer#publish">
                <PlusCircle /> {t("explore.register")}
              </Link>
            </Button>
          </div>
        </div>
        <Suspense>
          <SearchPageInput placeholder={t(`search.placeholder.${tab}`)} />
        </Suspense>
      </header>

      <div className="flex flex-col gap-3 border-b border-border md:flex-row md:items-end md:justify-between">
        <nav aria-label={t("search.title")} className="no-scrollbar -mb-px flex items-center gap-1 overflow-x-auto">
          {tabs.map((x) => (
            <Link key={x.id} href={href({ tab: x.id === "all" ? null : x.id, source: x.id === "all" || x.id === "skills" ? source : null })} aria-current={tab === x.id ? "page" : undefined} className={cn("inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors", tab === x.id ? "border-synapse text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <x.icon className={cn("h-4 w-4", tab === x.id && "text-synapse")} /> {x.label}
            </Link>
          ))}
        </nav>
        {showSource && (
          <div className="flex items-center gap-1 pb-2" role="group" aria-label={t("search.source.label")}>
            {sources.map((s) => (
              <Link key={s.id ?? "any"} href={href({ source: s.id })} aria-pressed={source === s.id} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors", source === s.id ? "border-synapse/40 bg-synapse/10 text-synapse" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {s.icon} {s.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {tab === "all" && <AllTab q={q} source={source} viewerId={viewerId} href={href} />}
      {tab === "people" && <PeopleTab q={q} viewerId={viewerId} />}
      {tab === "skills" && <SkillsTab sp={sp} q={q} source={source} />}
      {tab === "skillsets" && <SkillsetsTab sp={sp} q={q} createHref={session?.user ? "/skillsets/new" : "/signin?callbackUrl=/skillsets/new"} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

async function AllTab({ q, source, viewerId, href }: { q: string; source: SkillSource | null; viewerId: string | null; href: (patch: Record<string, string | null>) => string }) {
  const { t, n } = await getI18n();
  const synapthSide = source !== "github";
  const [people, skills, sets] = await Promise.all([
    synapthSide ? searchPeople(q.replace(/^@+/, ""), viewerId, 6) : Promise.resolve([]),
    skillRepository.search(q, { limit: 6, sort: q ? "relevance" : "trending", source: source ?? undefined }),
    synapthSide ? listSkillsets({ q, sort: "popular", limit: 3 }) : Promise.resolve([]),
  ]);
  const empty = !people.length && !skills.hits.length && !sets.length;

  if (empty) return <Empty text={t("search.none")} />;
  return (
    <div className="space-y-12">
      {people.length > 0 && (
        <Section title={t("search.tab.people")} icon={<Users className="h-4 w-4 text-synapse" />} more={{ href: href({ tab: "people", source: null }), label: t("search.more") }}>
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        </Section>
      )}
      {skills.hits.length > 0 && (
        <Section title={t("search.tab.skills")} icon={<Layers className="h-4 w-4 text-synapse" />} meta={n("sf.matching", skills.total, { n: skills.total.toLocaleString("en") })} more={{ href: href({ tab: "skills" }), label: t("search.more") }}>
          <div className="stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {skills.hits.map((h) => (
              <SkillCard key={h.skill.id} skill={h.skill} highlights={h.highlights} />
            ))}
          </div>
        </Section>
      )}
      {sets.length > 0 && (
        <Section title={t("search.tab.skillsets")} icon={<Boxes className="h-4 w-4 text-synapse" />} more={{ href: href({ tab: "skillsets", source: null }), label: t("search.more") }}>
          <div className="stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {sets.map((s) => (
              <SkillsetCard key={s.id} set={s} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

async function PeopleTab({ q, viewerId }: { q: string; viewerId: string | null }) {
  const { t, n } = await getI18n();
  const needle = q.replace(/^@+/, "");
  const [people, requests] = await Promise.all([searchPeople(needle, viewerId, 60), viewerId && !needle ? listRequests(viewerId) : Promise.resolve(null)]);
  return (
    <div className="space-y-10">
      {requests && requests.incoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4 text-synapse" /> {t("people.requests")}
            <span className="rounded-full bg-synapse/15 px-2 py-px text-xs tabular-nums text-synapse">{requests.incoming.length}</span>
          </h2>
          <div className="stagger grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {requests.incoming.map((p) => (
              <FriendTile key={p.id} person={p} state="incoming" />
            ))}
          </div>
        </section>
      )}
      <section className="space-y-4">
        <p className="text-sm text-muted-foreground">{needle ? n("people.found", people.length, { q: needle }) : t("people.newest")}</p>
        {people.length ? (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        ) : (
          <Empty text={t("people.none")} />
        )}
      </section>
    </div>
  );
}

/** The most installed entries, round-robin over kinds so MCP, skills and plugins all get a slide. */
function featuredSkills(all: Skill[], source: SkillSource | null, perKind = 2): Skill[] {
  const pool = [...all].filter((s) => !source || skillSource(s) === source).sort((a, b) => b.downloadsCount - a.downloadsCount || b.githubStars - a.githubStars);
  const byKind = SKILL_CATEGORIES.map((c) => pool.filter((s) => s.category === c).slice(0, perKind));
  const out: Skill[] = [];
  for (let i = 0; i < perKind; i++) for (const list of byKind) if (list[i]) out.push(list[i]);
  return out;
}

async function SkillsTab({ sp, q, source }: { sp: Search; q: string; source: SkillSource | null }) {
  const rawCategory = pick(sp.category);
  const category = (SKILL_CATEGORIES as readonly string[]).includes(rawCategory ?? "") ? (rawCategory as SkillCategory) : null;
  const rawLevel = pick(sp.level);
  const level = (SECURITY_LEVELS as readonly string[]).includes(rawLevel ?? "") ? (rawLevel as SecurityLevel) : null;
  const rawSort = pick(sp.sort);
  const sort: SortMode = rawSort === "hidden-gems" || rawSort === "recent" || rawSort === "relevance" ? rawSort : q ? "relevance" : "trending";
  const language = pick(sp.lang) ?? null;
  const author = pick(sp.author) ?? null;
  const untouched = !q && !category && !level && !language && !author;

  const [res, all, { t }] = await Promise.all([
    skillRepository.search(q, { category: category ?? undefined, language: language ?? undefined, author: author ?? undefined, securityLevel: level ?? undefined, source: source ?? undefined, sort: sort === "recent" ? "recent" : q ? "relevance" : "trending", limit: 24 }),
    untouched ? skillRepository.all() : Promise.resolve([]),
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
  const slides: FeaturedItem[] = featuredSkills(all, source).map((skill) => ({ kind: "skill", skill }));

  return (
    <div className="space-y-8">
      {slides.length > 0 && <FeaturedSlider items={slides} title={t("slider.title.skills")} />}
      <Suspense>
        {/* Remounted per query / source: the server page already fetched that view. */}
        <SkillStorefront key={`${q}|${source ?? ""}`} initial={page} initialSort={sort} initialCategory={category} initialQuery={q} initialLanguage={language} initialAuthor={author} initialLevel={level} source={source} hideSearch />
      </Suspense>
    </div>
  );
}

async function SkillsetsTab({ sp, q, createHref }: { sp: Search; q: string; createHref: string }) {
  const rawSort = pick(sp.sort) as SkillsetSort | undefined;
  const sort: SkillsetSort = rawSort && SKILLSET_SORTS.includes(rawSort) ? rawSort : "recent";
  const verifiedOnly = pick(sp.verified) === "1";
  const [popular, { t }] = await Promise.all([!q && !verifiedOnly ? listSkillsets({ sort: "popular", limit: 6 }) : Promise.resolve([]), getI18n()]);
  const slides: FeaturedItem[] = popular.map((set) => ({ kind: "skillset", set }));
  return (
    <div className="space-y-8">
      {slides.length > 0 && <FeaturedSlider items={slides} title={t("slider.title.skillsets")} />}
      <SkillsetBrowser q={q} verifiedOnly={verifiedOnly} sort={sort} createHref={createHref} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Section({ title, icon, meta, more, children }: { title: string; icon: React.ReactNode; meta?: string; more: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {icon} {title}
          {meta && <span className="text-sm font-normal text-muted-foreground">· {meta}</span>}
        </h2>
        <Link href={more.href} className="group inline-flex items-center gap-1.5 text-sm text-synapse">
          {more.label} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <SearchIcon className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
