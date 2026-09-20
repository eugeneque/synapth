import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Activity, Bolt, Calendar, Code2, Download, Github, Layers, Plus, Search, ShieldCheck, Star } from "lucide-react";
import { skillRepository } from "@/cortex/repository";
import { getProfile, getProfileByHandle } from "@/cortex/account";
import { ActivityHeatmap, HeatmapLegend, bucketActivity } from "@/components/activity-heatmap";
import { Panel } from "@/components/panel";
import { getI18n } from "@/cortex/locale";
import { SkillCard } from "@/components/skill-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCompact, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [{ owner }, { t }] = await Promise.all([params, getI18n()]);
  return { title: t("meta.author.title", { owner: decodeURIComponent(owner) }) };
}

/**
 * GitHub-owner page: every skill Cortex crawled from this publisher. A registered
 * developer with the same handle has a full profile at `/u/[handle]` instead.
 */
export default async function AuthorPage({ params }: Params) {
  const owner = decodeURIComponent((await params).owner).toLowerCase();
  const skills = (await skillRepository.all()).filter((s) => s.source?.owner.toLowerCase() === owner || s.authorName.toLowerCase() === owner);
  if (!skills.length) notFound();

  const name = skills[0].source?.owner ?? skills[0].authorName;
  const handle = name.toLowerCase().replace(/\s+/g, "-");
  // Registered developers (not the `gh:` shadow accounts crawled content is filed under) live at /u/[handle].
  const authorId = skills.every((s) => s.authorId === skills[0].authorId) && !skills[0].authorId.startsWith("gh:") ? skills[0].authorId : null;
  const profile = (await getProfileByHandle(handle)) ?? (authorId ? await getProfile(authorId) : null);
  if (profile) redirect(`/u/${profile.handle}`);

  const i18n = await getI18n();
  const { t, n } = i18n;
  const activity = bucketActivity(skills.flatMap((s) => [s.createdAt, s.updatedAt, ...(s.source?.pushedAt ? [s.source.pushedAt] : [])]));
  const avatar = skills.find((s) => s.source?.avatarUrl)?.source?.avatarUrl ?? null;
  const repos = [...new Set(skills.map((s) => s.source?.fullName).filter(Boolean))] as string[];
  const stars = Math.max(...skills.map((s) => s.githubStars));
  const installs = skills.reduce((n, s) => n + s.downloadsCount, 0);
  const verified = skills.filter((s) => s.securityLevel === "Verified").length;
  const byCategory = skills.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.category]: (acc[s.category] ?? 0) + 1 }), {});
  const languages = [...new Set(skills.map((s) => s.source?.language).filter(Boolean))] as string[];
  const firstSeen = skills.map((s) => s.createdAt).sort()[0];
  const onGithub = repos.length > 0;
  const sorted = [...skills].sort((a, b) => b.githubStars - a.githubStars || a.name.localeCompare(b.name));

  return (
    <div className="container space-y-6 py-8">
      <p className="label-mono flex flex-wrap items-center gap-2">
        <span className="text-synapse">/</span>
        <Link href="/explore" className="hover:text-foreground">{t("author.catalogue")}</Link>
        <span className="text-border">/</span>
        <span>{t("author.publishers")}</span>
        <span className="text-border">/</span>
        <span className="font-medium text-synapse">{name}</span>
      </p>

      {/* Cover canvas + identity. */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-card">
        <div className="relative h-44 w-full overflow-hidden bg-gradient-to-r from-surface-lowest via-surface-low to-surface-lowest sm:h-52">
          <div className="dot-matrix absolute inset-0 opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
          <div className="absolute right-4 top-4">
            <Badge variant="chip" className="h-7 gap-2 px-3 backdrop-blur">
              <Layers className="h-3.5 w-3.5 text-synapse" /> {n("author.reposIndexed", repos.length)}
            </Badge>
          </div>
        </div>

        <div className="relative z-10 -mt-14 px-6 pb-6 sm:-mt-16">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
              <div className="relative h-24 w-24 shrink-0 rounded-lg border-2 border-foreground/20 bg-surface-lowest p-1 sm:h-28 sm:w-28">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="font-display flex h-full w-full items-center justify-center bg-muted text-3xl font-medium">{name[0]?.toUpperCase()}</div>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface-lowest">
                  <span className="h-2.5 w-2.5 rounded-full bg-synapse animate-pulse-dot" />
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{name}</h1>
                  <span className="font-mono text-sm text-synapse">@{handle}</span>
                  {verified > 0 && (
                    <Badge variant="synapse">
                      <ShieldCheck className="h-3 w-3" /> {t("author.verifiedCreator")}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(byCategory).map(([c, n]) => (
                    <Badge key={c} variant="chip">
                      {n} {c}
                    </Badge>
                  ))}
                  {languages.slice(0, 3).map((l) => (
                    <Badge key={l} variant="chip" className="text-moss">
                      {l}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {onGithub && (
                <Button asChild variant="mono">
                  <a href={`https://github.com/${name}`} target="_blank" rel="noreferrer">
                    <Github className="text-synapse" /> {t("author.githubProfile")}
                  </a>
                </Button>
              )}
              <Button asChild className="font-mono text-[11px] uppercase tracking-[0.14em]">
                <Link href={`/explore?author=${encodeURIComponent(name)}`}>
                  <Search /> {t("author.searchPublisher")}
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 border-t border-border pt-6 lg:grid-cols-12">
            <p className="text-base leading-relaxed text-foreground/90 lg:col-span-8">
              {t("author.summary", { skills: n("author.skillsCount", skills.length), source: onGithub ? n("author.fromRepos", repos.length) : t("author.manual"), breakdown: Object.entries(byCategory).map(([c, count]) => `${count} ${c}`).join(", ") })}
              {verified > 0 && ` ${t("author.reviewed", { n: verified })}`}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground lg:col-span-4 lg:justify-end">
              {onGithub && (
                <a href={`https://github.com/${name}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Code2 className="h-4 w-4" /> github/{name}
                </a>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" /> {t("author.firstSeen", { ago: timeAgo(firstSeen, i18n) })}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Stat tiles. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t("author.publishedSkills")} icon={<Layers className="h-4 w-4 text-synapse" />} value={String(skills.length)} unit={t("author.verifiedUnit", { n: verified })} hint={t("author.communitySandbox", { n: skills.length - verified })} />
        <Tile label={t("author.installs")} icon={<Download className="h-4 w-4 text-moss" />} value={formatCompact(installs)} unit={t("author.viaSynapth")} hint={n("author.reposIndexed", repos.length)} />
        <Tile label={t("author.topStars")} icon={<Star className="h-4 w-4 text-synapse" />} value={formatCompact(stars)} unit="GitHub" hint={repos[0] ?? t("author.manualPublisher")} accent />
        <Tile label={t("author.verificationRate")} icon={<ShieldCheck className="h-4 w-4 text-synapse" />} value={`${Math.round((verified / skills.length) * 100)}%`} unit={t("author.reviewedUnit")} hint={t("author.scannerNever")} />
      </section>

      {/* Tabs row + grid. */}
      <div className="flex items-center justify-between gap-4 overflow-x-auto border-b border-border">
        <nav className="flex shrink-0 items-center gap-6">
          <span className="tab-line" data-active="true">
            <Layers className="h-4 w-4" /> {t("author.tabSkills", { n: skills.length })}
          </span>
          {repos.length > 1 && (
            <span className="tab-line">
              <Code2 className="h-4 w-4" /> {t("author.tabRepos", { n: repos.length })}
            </span>
          )}
          <a href="#activity" className="tab-line">
            <Activity className="h-4 w-4" /> {t("author.tabActivity", { n: activity.stats.total })}
          </a>
        </nav>
        <span className="label-mono-sm hidden shrink-0 items-center gap-2 pb-3 sm:flex">
          {t("author.sort")} <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-foreground">{t("author.sortStars")}</span>
        </span>
      </div>

      {repos.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {repos.map((r) => (
            <Link key={r} href={`/explore?author=${encodeURIComponent(name)}&q=${encodeURIComponent(r.split("/")[1])}`} className="label-mono-sm inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 normal-case tracking-normal text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
              <Bolt className="h-3 w-3 text-synapse" /> {r}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((s) => (
          <SkillCard key={s.id} skill={s} />
        ))}
        <Link href="/dashboard#publish" className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-6 text-center transition-colors hover:border-synapse/50 hover:bg-card">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors group-hover:border-synapse/40 group-hover:text-synapse">
            <Plus className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{t("author.publishNew")}</span>
          <span className="max-w-xs text-sm text-muted-foreground">{t("author.publishNewLead")}</span>
          <span className="label-mono-sm mt-1 rounded-md border border-border bg-surface px-2.5 py-1 text-foreground transition-colors group-hover:border-synapse/40">{t("author.publishNewCta")}</span>
        </Link>
      </div>

      {/* Publishing activity, bucketed from real timestamps. */}
      <Panel
        id="activity"
        title={t("author.activity.title")}
        meta={t("author.activity.meta", { n: activity.stats.total })}
        icon={<Activity className="h-4 w-4 shrink-0 text-synapse" />}
        actions={<HeatmapLegend less={t("author.activity.less")} more={t("author.activity.more")} />}
        className="scroll-mt-24"
        bodyClassName="p-5"
        footer={
          <>
            <span>
              {t("author.activity.current")} <span className="text-synapse">{n("author.activity.days", activity.stats.currentStreak)}</span>
            </span>
            <span>
              {t("author.activity.longest")} <span className="text-foreground">{n("author.activity.days", activity.stats.longestStreak)}</span>
              <span className="mx-3 text-border">·</span>
              {t("author.activity.active")} <span className="text-foreground">{n("author.activity.days", activity.stats.activeDays)}</span>
            </span>
          </>
        }
      >
        <ActivityHeatmap cells={activity.cells} months={activity.months} />
      </Panel>
    </div>
  );
}

function Tile({ label, icon, value, unit, hint, accent }: { label: string; icon: React.ReactNode; value: string; unit?: string; hint?: string; accent?: boolean }) {
  return (
    <div className="group relative rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/25">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-mono">{label}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`stat-value ${accent ? "text-synapse" : ""}`}>{value}</span>
        {unit && <span className="label-mono-sm text-synapse">{unit}</span>}
      </div>
      {hint && <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
