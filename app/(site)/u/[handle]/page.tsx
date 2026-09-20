import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Award, Bolt, Briefcase, Building2, Calendar, Code2, Github, Globe, Layers, MapPin, MessageSquare, Pencil, Plus, Search, ShieldCheck } from "lucide-react";
import { skillRepository } from "@/cortex/repository";
import { auth } from "@/cortex/auth";
import { getAuthorRef, getProfileByHandle } from "@/cortex/account";
import { evaluateBadges, listBadges } from "@/cortex/badges";
import { impulseSummary, listComments, listPosts } from "@/cortex/social";
import { getI18n } from "@/cortex/locale";
import { ActivityHeatmap, HeatmapLegend, bucketActivity } from "@/components/activity-heatmap";
import { BadgeList } from "@/components/badge-list";
import { ImpulseButton } from "@/components/impulse-button";
import { Panel } from "@/components/panel";
import { PostFeed } from "@/components/post-feed";
import { SkillCard } from "@/components/skill-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCompact } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Comment } from "@/types/social";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [{ handle }, { t }] = await Promise.all([params, getI18n()]);
  const profile = await getProfileByHandle(decodeURIComponent(handle));
  if (!profile) return { title: t("nf.label") };
  return { title: t("meta.profile.title", { name: profile.name || profile.handle, handle: profile.handle }), description: profile.bio || undefined };
}

/** Public developer profile: identity from settings plus everything Cortex indexed under this handle. */
export default async function UserProfilePage({ params }: Params) {
  const handle = decodeURIComponent((await params).handle).toLowerCase();
  const profile = await getProfileByHandle(handle);
  if (!profile) notFound();

  const [all, i18n, session] = await Promise.all([skillRepository.all(), getI18n(), auth()]);
  const { t, n, locale } = i18n;
  const name = profile.name || profile.handle;
  const viewerId = session?.user?.id ?? null;
  const isOwner = viewerId === profile.id;

  // Social layer: impulses, posts with their threads, achievements (evaluated lazily so seeded data catches up).
  await evaluateBadges(profile.id);
  const [impulses, posts, badges, viewer] = await Promise.all([impulseSummary(profile.id, viewerId), listPosts(profile.id), listBadges(profile.id), viewerId ? getAuthorRef(viewerId) : Promise.resolve(null)]);
  const threads: Record<string, Comment[]> = Object.fromEntries(await Promise.all(posts.map(async (p) => [p.id, await listComments("post", p.id)] as const)));

  // A registered developer may also be a crawled GitHub owner under the same handle: merge both.
  const skills = all.filter((s) => s.authorId === profile.id || s.source?.owner.toLowerCase() === profile.handle.toLowerCase());
  const sorted = [...skills].sort((a, b) => b.githubStars - a.githubStars || a.name.localeCompare(b.name));
  const githubOwner = skills.find((s) => s.source)?.source?.owner ?? null;
  // The explore `author:` filter matches `authorName` / GitHub owner, not the handle.
  const searchAuthor = githubOwner ?? skills[0]?.authorName ?? profile.handle;
  const repos = [...new Set(skills.map((s) => s.source?.fullName).filter(Boolean))] as string[];
  const stars = skills.reduce((max, s) => Math.max(max, s.githubStars), 0);
  const installs = skills.reduce((sum, s) => sum + s.downloadsCount, 0);
  const verified = skills.filter((s) => s.securityLevel === "Verified").length;
  const byCategory = skills.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.category]: (acc[s.category] ?? 0) + 1 }), {});
  const languages = [...new Set(skills.map((s) => s.source?.language).filter(Boolean))] as string[];
  const activity = bucketActivity(skills.flatMap((s) => [s.createdAt, s.updatedAt, ...(s.source?.pushedAt ? [s.source.pushedAt] : [])]));
  const avatar = profile.image ?? skills.find((s) => s.source?.avatarUrl)?.source?.avatarUrl ?? null;
  const joined = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(new Date(profile.createdAt));

  return (
    <div className="container space-y-6 py-8">
      <p className="label-mono flex flex-wrap items-center gap-2">
        <span className="text-synapse">/</span>
        <Link href="/explore" className="hover:text-foreground">{t("profile.crumb.community")}</Link>
        <span className="text-border">/</span>
        <span>{t("profile.crumb.members")}</span>
        <span className="text-border">/</span>
        <span className="font-medium text-synapse">@{profile.handle}</span>
      </p>

      {/* Cover + identity header. */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-card">
        <div className={cn("relative h-48 w-full overflow-hidden sm:h-56", !profile.coverImage && "bg-gradient-to-r from-surface-lowest via-surface-low to-surface-lowest")}>
          {profile.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="dot-matrix absolute inset-0 opacity-60" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
          <div className="absolute right-4 top-4 flex items-center gap-2">
            {repos.length > 0 && (
              <Badge variant="chip" className="h-7 gap-2 bg-surface-lowest/70 px-3 backdrop-blur">
                <Layers className="h-3.5 w-3.5 text-synapse" /> {n("author.reposIndexed", repos.length)}
              </Badge>
            )}
            {isOwner && (
              <Button asChild variant="mono" size="sm" className="h-7 bg-surface-lowest/70 backdrop-blur">
                <Link href="/dashboard/settings#identity">
                  <Pencil className="text-synapse" /> {t("profile.editCover")}
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="relative z-10 -mt-14 px-6 pb-6 sm:-mt-16">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border-2 border-foreground/20 bg-surface-lowest sm:h-28 sm:w-28">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="font-display flex h-full w-full items-center justify-center bg-muted text-3xl font-medium">{name[0]?.toUpperCase()}</div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{name}</h1>
                  {verified > 0 && <ShieldCheck className="h-5 w-5 text-synapse" aria-label={t("author.verifiedCreator")} />}
                  {profile.occupation && (
                    <Badge variant="synapse" className="h-6 gap-1.5 px-2.5">
                      <Briefcase className="h-3 w-3" /> {t(`occupation.${profile.occupation}`)}
                    </Badge>
                  )}
                  <span className="font-mono text-sm text-muted-foreground">@{profile.handle}</span>
                </div>
                <p className={cn("max-w-2xl text-base leading-relaxed", profile.bio ? "text-foreground/90" : "text-muted-foreground")}>{profile.bio || t("profile.bioEmpty")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <ImpulseButton toId={profile.id} handle={profile.handle} name={name} initial={impulses} viewerId={viewerId} />
              {isOwner && (
                <Button asChild variant="mono">
                  <Link href="/dashboard/settings">
                    <Pencil className="text-synapse" /> {t("author.editProfile")}
                  </Link>
                </Button>
              )}
              {githubOwner && (
                <Button asChild variant="mono">
                  <a href={`https://github.com/${githubOwner}`} target="_blank" rel="noreferrer">
                    <Github className="text-synapse" /> {t("author.githubProfile")}
                  </a>
                </Button>
              )}
              {skills.length > 0 && (
                <Button asChild className="font-mono text-[11px] uppercase tracking-[0.14em]">
                  <Link href={`/explore?author=${encodeURIComponent(searchAuthor)}`}>
                    <Search /> {t("author.searchPublisher")}
                  </Link>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col justify-between gap-4 border-t border-border pt-5 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground">
              {profile.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" /> {profile.location}
                </span>
              )}
              {profile.organization && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" /> {profile.organization}
                </span>
              )}
              {profile.website && (
                <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-synapse hover:underline">
                  <Globe className="h-4 w-4" /> {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
              {githubOwner && (
                <a href={`https://github.com/${githubOwner}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Code2 className="h-4 w-4" /> github/{githubOwner}
                </a>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-synapse" /> {t("profile.memberSince", { date: joined })}
              </span>
            </div>
            <div className="grid w-full grid-cols-5 divide-x divide-border rounded-lg border border-border bg-surface-lowest/80 py-3 lg:w-auto">
              <Stat value={String(impulses.total)} label={t("profile.stats.impulses")} accent />
              <Stat value={String(skills.length)} label={t("profile.stats.skills")} />
              <Stat value={formatCompact(installs)} label={t("profile.stats.installs")} />
              <Stat value={formatCompact(stars)} label={t("profile.stats.stars")} />
              <Stat value={String(verified)} label={t("profile.stats.verified")} />
            </div>
          </div>
        </div>
      </section>

      {/* Tabs row. */}
      <div className="flex items-center justify-between gap-4 overflow-x-auto border-b border-border">
        <nav className="flex shrink-0 items-center gap-6">
          <span className="tab-line" data-active="true">
            <Layers className="h-4 w-4 text-synapse" /> {t("profile.tab.overview")}
          </span>
          <a href="#posts" className="tab-line">
            <MessageSquare className="h-4 w-4" /> {t("profile.tab.posts", { n: posts.length })}
          </a>
          <a href="#activity" className="tab-line">
            <Activity className="h-4 w-4" /> {t("profile.tab.activity", { n: activity.stats.total })}
          </a>
        </nav>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Skills + activity. */}
        <div className="min-w-0 space-y-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="h-5 w-5 text-synapse" />
              <h2 className="text-lg font-semibold tracking-tight">{t("profile.skills.title")}</h2>
              <Badge variant="chip">{n("author.skillsCount", skills.length)}</Badge>
            </div>
            {skills.length > 0 && (
              <Link href={`/explore?author=${encodeURIComponent(searchAuthor)}`} className="label-mono-sm text-synapse hover:underline">
                {t("profile.skills.all")}
              </Link>
            )}
          </div>

          {skills.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {sorted.map((s) => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </div>
          ) : (
            <div className="hatch flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
                <Layers className="h-5 w-5" />
              </span>
              <span className="text-lg font-semibold tracking-tight">{t("profile.skills.empty")}</span>
              <span className="max-w-sm text-sm text-muted-foreground">{isOwner ? t("author.publishNewLead") : t("profile.skills.emptyLead")}</span>
              {isOwner && (
                <Button asChild variant="mono" size="sm" className="mt-1">
                  <Link href="/dashboard#publish">
                    <Plus className="text-synapse" /> {t("author.publishNewCta")}
                  </Link>
                </Button>
              )}
            </div>
          )}

          <section id="posts" className="scroll-mt-24 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-synapse" />
                <h2 className="text-lg font-semibold tracking-tight">{t("posts.title")}</h2>
              </div>
              <span className="label-mono-sm normal-case tracking-normal">{t("posts.meta", { handle: profile.handle })}</span>
            </div>
            <PostFeed handle={profile.handle} ownerId={profile.id} viewer={viewer} initialPosts={posts} initialComments={threads} />
          </section>

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

        {/* About / focus / badges rail. */}
        <div className="min-w-0 space-y-6 lg:col-span-4">
          <Panel title={t("profile.about.title")} icon={<Briefcase className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-4">
            <dl className="grid gap-y-2 font-mono text-xs">
              <Row k={t("profile.about.occupation")} v={profile.occupation ? t(`occupation.${profile.occupation}`) : "—"} />
              <Row k={t("profile.about.role")} v={t(`settings.role.${profile.role}`)} />
              {profile.organization && <Row k={t("profile.about.organization")} v={profile.organization} />}
              {profile.location && <Row k={t("profile.about.location")} v={profile.location} />}
              {profile.website && <Row k={t("profile.about.website")} v={profile.website.replace(/^https?:\/\//, "")} href={profile.website} />}
              {githubOwner && <Row k={t("profile.about.github")} v={`@${githubOwner}`} href={`https://github.com/${githubOwner}`} />}
              <Row k={t("profile.about.joined")} v={joined} />
            </dl>
          </Panel>

          <Panel title={t("profile.focus.title")} meta={t("profile.focus.meta")} icon={<Bolt className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-4">
            {skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(byCategory).map(([c, count]) => (
                  <Badge key={c} variant="synapse">
                    {count} {c}
                  </Badge>
                ))}
                {languages.map((l) => (
                  <Badge key={l} variant="chip" className="text-moss">
                    {l}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("profile.skills.empty")}</p>
            )}
          </Panel>

          <Panel id="badges" title={t("profile.badges.title")} meta={n("profile.badges.count", badges.length)} icon={<Award className="h-4 w-4 shrink-0 text-synapse" />} className="scroll-mt-24" bodyClassName="p-4">
            {badges.length > 0 ? <BadgeList badges={badges} t={t} /> : <p className="text-xs leading-relaxed text-muted-foreground">{t("profile.badge.none")}</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0 px-2 text-center sm:px-4">
      <div className={cn("font-display text-2xl font-medium leading-none tracking-tight", accent ? "text-synapse" : "text-foreground")}>{value}</div>
      <div className="label-mono-sm mt-1 leading-tight">{label}</div>
    </div>
  );
}

function Row({ k, v, href }: { k: string; v: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-foreground">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-synapse hover:underline">
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}
