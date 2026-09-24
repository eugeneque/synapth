import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Award, Bolt, Briefcase, Building2, Calendar, Code2, Github, Globe, Layers, MapPin, MessageSquare, Pencil, Plus, ShieldCheck } from "lucide-react";
import { skillRepository } from "@/cortex/repository";
import { auth } from "@/cortex/auth";
import { hasPermission } from "@/cortex/roles";
import { getAuthorRef, getProfileByHandle } from "@/cortex/account";
import { evaluateBadges, listBadges } from "@/cortex/badges";
import { impulseSummary, listComments, listPosts } from "@/cortex/social";
import { friendState, friendStates, listFriends, listRequests } from "@/cortex/friends";
import { getI18n } from "@/cortex/locale";
import { ActivityHeatmap, HeatmapLegend, bucketActivity } from "@/components/activity-heatmap";
import { BadgeList } from "@/components/badge-list";
import { publicRole } from "@/types/auth";
import { ImpulseButton } from "@/components/impulse-button";
import { FriendButton } from "@/components/friend-button";
import { FriendsCard } from "@/components/friends-card";
import { ProfileMoreMenu, type ProfileMoreItem } from "@/components/profile-more-menu";
import { CountUp } from "@/components/count-up";
import { VerifiedMark } from "@/components/verified-mark";
import { ProfileDetails } from "@/components/profile-details";
import { Panel } from "@/components/panel";
import { PostFeed } from "@/components/post-feed";
import { SkillCard } from "@/components/skill-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCompact } from "@/lib/utils";
import type { Comment } from "@/types/social";
import { safeExternalHref, safeImageSrc } from "@/lib/url-safety";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const [{ handle }, { t }] = await Promise.all([params, getI18n()]);
  const profile = await getProfileByHandle(decodeURIComponent(handle));
  if (!profile) return { title: t("nf.label") };
  return {
    title: t("meta.profile.title", {
      name: profile.name || profile.handle,
      handle: profile.handle,
    }),
    description: profile.bio || undefined,
  };
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
  const [impulses, posts, badges, viewer, canModerate, friends, relation, requests] = await Promise.all([
    impulseSummary(profile.id, viewerId),
    listPosts(profile.id, { viewerId }),
    listBadges(profile.id),
    viewerId ? getAuthorRef(viewerId) : Promise.resolve(null),
    hasPermission(viewerId, "content.moderate"),
    listFriends(profile.id),
    friendState(profile.id, viewerId),
    // Pending requests are the owner's business only; the friend list itself is public.
    isOwner ? listRequests(profile.id) : Promise.resolve(null),
  ]);
  // Each friend row carries the viewer's own relation to that person (the owner sees "friends" everywhere).
  const states = await friendStates(
    friends.map((f) => f.id),
    viewerId,
  );
  const friendRows = friends.map((f) => ({ ...f, state: states[f.id] }));
  const threads: Record<string, Comment[]> = Object.fromEntries(await Promise.all(posts.map(async (p) => [p.id, await listComments("post", p.id)] as const)));

  // A registered developer may also be a crawled GitHub owner under the same handle: merge both.
  const skills = all.filter((s) => s.authorId === profile.id || s.source?.owner.toLowerCase() === profile.handle.toLowerCase());
  const sorted = [...skills].sort((a, b) => b.githubStars - a.githubStars || a.name.localeCompare(b.name));
  const githubOwner = skills.find((s) => s.source)?.source?.owner ?? null;
  // Rows stored before URL validation landed may hold a non-http scheme; drop those targets.
  const website = safeExternalHref(profile.website);
  const cover = safeImageSrc(profile.coverImage);
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
  // Admins pass as plain users here; the developer flag is shown next to (or instead of) "user".
  const shownRole = publicRole(profile.role);
  const roleLabel = [shownRole !== "user" || !profile.developer ? t(`settings.role.${shownRole}`) : null, profile.developer ? t("settings.role.developer") : null].filter(Boolean).join(" · ");
  const joined = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  }).format(new Date(profile.createdAt));
  const headline = [profile.occupation ? t(`occupation.${profile.occupation}`) : null, profile.organization].filter(Boolean).join(" · ");
  const links = [
    profile.organization ? { key: "org", icon: <Building2 />, label: profile.organization } : null,
    website
      ? {
          key: "site",
          icon: <Globe />,
          label: website.replace(/^https?:\/\//, "").replace(/\/$/, ""),
          href: website,
        }
      : null,
    githubOwner
      ? {
          key: "gh",
          icon: <Github />,
          label: `github.com/${githubOwner}`,
          href: `https://github.com/${githubOwner}`,
        }
      : null,
    repos.length > 0
      ? {
          key: "repos",
          icon: <Layers />,
          label: n("author.reposIndexed", repos.length),
        }
      : null,
  ].filter((l) => l !== null);
  const moreItems: ProfileMoreItem[] = [
    ...(isOwner
      ? [
          {
            href: "/dashboard/settings#identity",
            label: t("profile.editCover"),
            icon: "edit" as const,
          },
        ]
      : []),
    ...(githubOwner
      ? [
          {
            href: `https://github.com/${githubOwner}`,
            label: t("author.githubProfile"),
            icon: "github" as const,
            external: true,
          },
        ]
      : []),
    ...(skills.length > 0
      ? [
          {
            href: `/search?tab=skills&author=${encodeURIComponent(searchAuthor)}`,
            label: t("author.searchPublisher"),
            icon: "search" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="container space-y-6 py-8">
      <p className="label-mono flex flex-wrap items-center gap-2">
        <span className="text-synapse">/</span>
        <Link href="/search?tab=skills" className="hover:text-foreground">
          {t("profile.crumb.community")}
        </Link>
        <span className="text-border">/</span>
        <span>{t("profile.crumb.members")}</span>
        <span className="text-border">/</span>
        <span className="font-medium text-synapse">@{profile.handle}</span>
      </p>

      {/* Cover + identity header. */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-card">
        <div className={cn("relative h-44 w-full overflow-hidden sm:h-52", !cover && "bg-gradient-to-r from-surface-lowest via-surface-low to-surface-lowest")}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="dot-matrix absolute inset-0 opacity-60" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent" />
          {isOwner && (
            <Button asChild variant="mono" size="sm" className="absolute right-4 top-4 h-7 bg-surface-lowest/70 backdrop-blur">
              <Link href="/dashboard/settings#identity">
                <Pencil className="text-synapse" /> {t("profile.editCover")}
              </Link>
            </Button>
          )}
        </div>

        <div className="relative z-10 -mt-16 px-6 pb-6 sm:-mt-20">
          <div className="h-28 w-28 overflow-hidden rounded-xl border-4 border-card bg-surface-lowest shadow-xl sm:h-32 sm:w-32">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="font-display flex h-full w-full items-center justify-center bg-muted text-4xl font-medium">{name[0]?.toUpperCase()}</div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 max-w-3xl space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{name}</h1>
                  {profile.verified && <VerifiedMark size="lg" />}
                  {verified > 0 && <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-label={t("author.verifiedCreator")} />}
                </div>
                {headline && <p className="mt-1.5 text-base text-foreground/90">{headline}</p>}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="font-mono">@{profile.handle}</span>
                  {profile.location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {profile.location}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> {t("profile.memberSince", { date: joined })}
                  </span>
                </p>
              </div>

              <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <Count href="#friends" value={friends.length} label={n("profile.count.friends", friends.length)} />
                <Count href="#posts" value={posts.length} label={n("profile.count.posts", posts.length)} />
                <Count value={skills.length} label={n("profile.count.skills", skills.length)} />
              </p>

              <p className={cn("text-[15px] leading-relaxed", profile.bio ? "text-foreground/85" : "text-muted-foreground")}>{profile.bio || t("profile.bioEmpty")}</p>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {isOwner ? (
                  <Link href="/dashboard/settings" className="inline-flex h-10 items-center gap-2 rounded-full border border-synapse bg-synapse px-5 text-sm font-medium text-synapse-foreground shadow-glow transition-all duration-200 hover:-translate-y-px hover:shadow-glow-lg">
                    <Pencil className="h-4 w-4" /> {t("author.editProfile")}
                  </Link>
                ) : (
                  <FriendButton toId={profile.id} handle={profile.handle} name={name} initial={relation} />
                )}
                <ProfileMoreMenu items={moreItems} profilePath={`/u/${profile.handle}`} />
              </div>
            </div>

            {links.length > 0 && (
              <ul className="stagger flex shrink-0 flex-col gap-3 lg:min-w-52 lg:pt-2">
                {links.map((l) => (
                  <li key={l.key}>
                    <LinkRow {...l} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-stretch">
            <ImpulseButton toId={profile.id} handle={profile.handle} name={name} initial={impulses} viewer={!viewerId ? "anonymous" : isOwner ? "self" : "member"} className="h-auto min-h-16 shrink-0" />
            <div className="grid flex-1 grid-cols-4 divide-x divide-border rounded-xl border border-border bg-surface-lowest/80 py-3">
              <Stat value={skills.length} label={t("profile.stats.skills")} />
              <Stat value={installs} label={t("profile.stats.installs")} />
              <Stat value={stars} label={t("profile.stats.stars")} />
              <Stat value={verified} label={t("profile.stats.verified")} />
            </div>
          </div>

          <ProfileDetails
            className="mt-5"
            tabs={[
              {
                id: "about",
                label: t("profile.about.title"),
                icon: <Briefcase className="h-3.5 w-3.5 text-synapse" />,
                content: (
                  <dl className="stagger grid gap-x-6 gap-y-2.5 font-mono text-xs sm:grid-cols-2 lg:grid-cols-3">
                    <Fact icon={<Briefcase />} k={t("profile.about.occupation")} v={profile.occupation ? t(`occupation.${profile.occupation}`) : "—"} />
                    <Fact icon={<ShieldCheck />} k={t("profile.about.role")} v={roleLabel} />
                    {profile.organization && <Fact icon={<Building2 />} k={t("profile.about.organization")} v={profile.organization} />}
                    {profile.location && <Fact icon={<MapPin />} k={t("profile.about.location")} v={profile.location} />}
                    {website && <Fact icon={<Globe />} k={t("profile.about.website")} v={website.replace(/^https?:\/\//, "").replace(/\/$/, "")} href={website} />}
                    {githubOwner && <Fact icon={<Code2 />} k={t("profile.about.github")} v={`@${githubOwner}`} href={`https://github.com/${githubOwner}`} />}
                    <Fact icon={<Calendar />} k={t("profile.about.joined")} v={joined} />
                  </dl>
                ),
              },
              {
                id: "focus",
                label: t("profile.focus.title"),
                icon: <Bolt className="h-3.5 w-3.5 text-synapse" />,
                count: Object.keys(byCategory).length + languages.length,
                content:
                  skills.length > 0 ? (
                    <div className="stagger flex flex-wrap gap-1.5">
                      {Object.entries(byCategory).map(([c, count]) => (
                        <Badge key={c} variant="synapse" className="h-6 px-2 transition-transform hover:-translate-y-px">
                          {count} {c}
                        </Badge>
                      ))}
                      {languages.map((l) => (
                        <Badge key={l} variant="chip" className="h-6 px-2 text-moss transition-transform hover:-translate-y-px">
                          {l}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("profile.skills.empty")}</p>
                  ),
              },
              {
                id: "badges",
                label: t("profile.badges.title"),
                icon: <Award className="h-3.5 w-3.5 text-synapse" />,
                count: badges.length,
                content: badges.length > 0 ? <BadgeList badges={badges} t={t} className="stagger" /> : <p className="text-xs leading-relaxed text-muted-foreground">{t("profile.badge.none")}</p>,
              },
            ]}
          />
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

      {/* Skills, posts, activity + the friends card on the side. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="h-5 w-5 text-synapse" />
              <h2 className="text-lg font-semibold tracking-tight">{t("profile.skills.title")}</h2>
              <Badge variant="chip">{n("author.skillsCount", skills.length)}</Badge>
            </div>
            {skills.length > 0 && (
              <Link href={`/search?tab=skills&author=${encodeURIComponent(searchAuthor)}`} className="label-mono-sm text-synapse hover:underline">
                {t("profile.skills.all")}
              </Link>
            )}
          </div>

          {skills.length > 0 ? (
            <div className="stagger grid gap-4 md:grid-cols-2">
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
                  <Link href="/dashboard/developer#publish">
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
            <PostFeed handle={profile.handle} ownerId={profile.id} viewer={viewer} canModerate={canModerate} initialPosts={posts} initialComments={threads} />
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
        <aside className="lg:sticky lg:top-24">
          <FriendsCard friends={friendRows} incoming={requests?.incoming} outgoing={requests?.outgoing} isOwner={isOwner} name={name} />
        </aside>
      </div>
    </div>
  );
}

function Count({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <span className="font-semibold tabular-nums text-synapse">{formatCompact(value)}</span> <span className="text-muted-foreground">{label}</span>
    </>
  );
  return href ? (
    <a href={href} className="transition-opacity hover:opacity-80">
      {body}
    </a>
  ) : (
    <span>{body}</span>
  );
}

/** Right-hand identity links in the header: organization, site, GitHub, indexed repos. */
function LinkRow({ icon, label, href }: { icon: React.ReactNode; label: string; href?: string }) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-lowest text-synapse transition-colors group-hover/link:border-synapse/40 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="truncate text-sm font-medium">{label}</span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer nofollow" className="group/link flex min-w-0 items-center gap-3 transition-colors hover:text-synapse">
      {inner}
    </a>
  ) : (
    <span className="group/link flex min-w-0 items-center gap-3">{inner}</span>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="group/stat min-w-0 px-2 text-center sm:px-4">
      <CountUp value={value} className="block font-display text-2xl font-medium leading-none tracking-tight text-foreground tabular-nums transition-colors group-hover/stat:text-synapse" />
      <div className="label-mono-sm mt-1.5 truncate leading-tight">{label}</div>
    </div>
  );
}

function Fact({ icon, k, v, href }: { icon: React.ReactNode; k: string; v: string; href?: string }) {
  return (
    <div className="group/fact flex min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-surface-lowest/60">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-lowest text-muted-foreground transition-colors group-hover/fact:text-synapse [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      <div className="min-w-0">
        <dt className="label-mono-sm">{k}</dt>
        <dd className="truncate text-foreground">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer nofollow" className="text-synapse hover:underline">
              {v}
            </a>
          ) : (
            v
          )}
        </dd>
      </div>
    </div>
  );
}
