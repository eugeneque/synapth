import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, BookOpen, CalendarClock, CalendarPlus, Layers, Pencil } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { getRole } from "@/cortex/roles";
import { hydratePrompt } from "@/cortex/repository";
import { favoriteSummary, getSkillset, skillsetHistory, skillsetSkills } from "@/cortex/skillsets";
import { INSTALL_TARGETS, skillsetInstall, type InstallTarget, type SkillsetInstallPlan } from "@/axon/install";
import { can } from "@/types/auth";
import { SKILL_CATEGORIES } from "@/types/skill";
import { SKILLSET_IMAGE_PATH } from "@/types/skillset";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Corners } from "@/components/corners";
import { CategoryIcon } from "@/components/category-icon";
import { FavoriteButton } from "@/components/favorite-button";
import { Markdown } from "@/components/markdown";
import { Panel } from "@/components/panel";
import { SecurityBadge } from "@/components/security-badge";
import { SkillsetAvatar } from "@/components/skillset-avatar";
import { SkillsetHistory } from "@/components/skillset-history";
import { SkillsetInstallPanel } from "@/components/skillset-install-panel";
import { SkillsetVerifyControl } from "@/components/skillset-verify-control";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const LOCAL_IMAGES = [SKILLSET_IMAGE_PATH] as const;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [set, { t }] = await Promise.all([getSkillset(slug), getI18n()]);
  return { title: set?.name ?? t("skillsets.meta"), description: set?.summary || undefined };
}

export default async function SkillsetPage({ params }: Params) {
  const { slug } = await params;
  const set = await getSkillset(slug);
  if (!set) notFound();
  const [i18n, session] = await Promise.all([getI18n(), auth()]);
  const { t, n, locale } = i18n;
  const viewerId = session?.user?.id ?? null;
  const [favorite, history, role, skills] = await Promise.all([favoriteSummary(set.id, viewerId), skillsetHistory(set.id), viewerId ? getRole(viewerId) : Promise.resolve(null), skillsetSkills(set).then((list) => Promise.all(list.map(hydratePrompt)))]);

  const plans = Object.fromEntries(INSTALL_TARGETS.map((it) => [it.id, skillsetInstall(set, skills, it.id)])) as Record<InstallTarget, SkillsetInstallPlan>;
  const isAuthor = viewerId === set.author.id;
  const canVerify = can(role, "catalog.verify");
  const counts = Object.fromEntries(SKILL_CATEGORIES.map((c) => [c, set.items.filter((i) => i.skill?.category === c).length]));
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="container space-y-6 py-8">
      <p className="label-mono flex flex-wrap items-center gap-2">
        <span className="text-synapse">/</span>
        <Link href="/search?tab=skillsets" className="hover:text-foreground">
          {t("skillsets.crumb")}
        </Link>
        <span className="text-border">/</span>
        <Link href={`/u/${set.author.handle}`} className="hover:text-foreground">
          {set.author.handle}
        </Link>
        <span className="text-border">/</span>
        <span className="font-medium text-synapse">{set.slug}</span>
      </p>

      <header className="group relative rounded-xl border border-border bg-card p-6">
        <Corners />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-start gap-5">
            <SkillsetAvatar name={set.name} avatar={set.avatar} size="lg" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {set.verified ? (
                  <Badge variant="solid" title={t("skillset.verified.title")}>
                    <BadgeCheck className="h-3 w-3" /> {t("skillset.verified")}
                  </Badge>
                ) : (
                  <Badge variant="outline" title={t("skillset.unverified.title")}>
                    {t("skillset.unverified")}
                  </Badge>
                )}
                <Badge variant="chip">{n("skillset.entries", set.items.length)}</Badge>
                {SKILL_CATEGORIES.filter((c) => counts[c]).map((c) => (
                  <Badge key={c} variant="chip" className="gap-1.5">
                    <CategoryIcon category={c} className="h-3 w-3" /> {counts[c]} · {t(`skillset.kind.${c}`)}
                  </Badge>
                ))}
              </div>
              <h1 className="font-display mt-1 text-3xl font-medium tracking-tight sm:text-4xl">{set.name}</h1>
              {set.summary && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{set.summary}</p>}
              <div className="label-mono-sm mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 normal-case tracking-normal">
                <span className="flex items-center gap-1.5">
                  <Avatar author={set.author} size="xs" link />
                  {t("skillset.author")}{" "}
                  <Link href={`/u/${set.author.handle}`} className="text-foreground hover:text-synapse">
                    {set.author.name || set.author.handle}
                  </Link>
                </span>
                <span className="flex items-center gap-1.5" title={set.createdAt}>
                  <CalendarPlus className="h-3.5 w-3.5" /> {t("skillset.createdAt", { date: date(set.createdAt) })}
                </span>
                <span className="flex items-center gap-1.5" title={set.updatedAt}>
                  <CalendarClock className="h-3.5 w-3.5" /> {t("skillset.updatedAt", { date: date(set.updatedAt) })}
                </span>
                {set.verified && set.verifiedBy && set.verifiedAt && (
                  <span className="flex items-center gap-1.5 text-synapse">
                    <BadgeCheck className="h-3.5 w-3.5" /> {t("skillset.verifiedBy", { name: set.verifiedBy.name || set.verifiedBy.handle, date: date(set.verifiedAt) })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
            <Button asChild size="lg" className="h-11 px-6 text-base font-semibold normal-case tracking-tight">
              <a href="#install">{t("skillset.installAll")}</a>
            </Button>
            <FavoriteButton skillsetId={set.id} slug={set.slug} name={set.name} initial={favorite} signedIn={Boolean(viewerId)} />
            {isAuthor && (
              <Button asChild variant="mono" className="h-11">
                <Link href={`/skillsets/${set.slug}/edit`}>
                  <Pencil className="text-synapse" /> {t("skillset.edit")}
                </Link>
              </Button>
            )}
          </div>
        </div>
        {canVerify && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-surface-low/60 px-4 py-3">
            <p className="label-mono-sm normal-case tracking-normal">{t("skillset.verify.staffHint")}</p>
            <SkillsetVerifyControl skillsetId={set.id} name={set.name} verified={set.verified} empty={set.items.length === 0} />
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
          <Panel title={t("skillset.composition")} meta={n("skillset.entries", set.items.length)} icon={<Layers className="h-4 w-4 shrink-0 text-synapse" />} corners>
            {set.items.length ? (
              <ol className="divide-y divide-border">
                {set.items.map((item, i) => (
                  <li key={item.skillId} className="flex items-center gap-4 px-4 py-3">
                    <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                    {item.skill ? (
                      <>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-synapse">
                          <CategoryIcon category={item.skill.category} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/skills/${item.skill.slug}`} className="truncate text-sm font-medium hover:text-synapse">
                              {item.skill.name}
                            </Link>
                            <SecurityBadge level={item.skill.securityLevel} />
                            <Badge variant="chip">{t(`skillset.kind.${item.skill.category}`)}</Badge>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">
                              {item.skill.authorName} · v{item.skill.version}
                            </span>{" "}
                            — {item.skill.description}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="flex-1 text-sm text-muted-foreground">{t("skillset.itemGone")}</p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t("skillset.emptyComposition")}</p>
            )}
          </Panel>

          <Panel title={t("skillset.description")} icon={<BookOpen className="h-4 w-4 shrink-0 text-moss" />} corners>
            {set.description.trim() ? <Markdown source={set.description} localImagePrefixes={LOCAL_IMAGES} className="px-5 py-4 text-sm text-foreground/90" /> : <p className="px-5 py-4 text-sm text-muted-foreground">{t("skillset.noDescription")}</p>}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4">
          <SkillsetInstallPanel plans={plans} />
          <SkillsetHistory changes={history} i18n={i18n} />
        </aside>
      </div>
    </div>
  );
}
