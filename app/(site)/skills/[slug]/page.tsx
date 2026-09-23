import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, Code2, Eye, ExternalLink, KeyRound, Plus, ShieldQuestion, Terminal } from "lucide-react";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { auth } from "@/cortex/auth";
import { getAuthorRef } from "@/cortex/account";
import { listComments, watchSummary } from "@/cortex/social";
import { getI18n } from "@/cortex/locale";
import { scanManifest } from "@/lib/sandbox-scanner";
import { formatCompact, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SecurityBadge } from "@/components/security-badge";
import { InstallButton } from "@/components/install-button";
import { InstallPanel } from "@/components/install-panel";
import { PromptVisualizer } from "@/components/prompt-visualizer";
import { ScanReportView } from "@/components/scan-report";
import { ToolSpec } from "@/components/tool-spec";
import { Markdown } from "@/components/markdown";
import { RepoCard } from "@/components/repo-card";
import { SkillCard } from "@/components/skill-card";
import { Panel } from "@/components/panel";
import { Corners } from "@/components/corners";
import { SkillDiscussion } from "@/components/skill-discussion";
import { WatchButton } from "@/components/watch-button";
import { ModerationRequestButton } from "@/components/moderation-request-button";
import { pendingRequestFor } from "@/cortex/moderation";
import { getRole } from "@/cortex/roles";
import { can } from "@/types/auth";
import { safeExternalHref } from "@/lib/url-safety";
import { listSkillsets } from "@/cortex/skillsets";
import { SkillsetAvatar } from "@/components/skillset-avatar";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [skill, { t }] = await Promise.all([skillRepository.bySlug(slug), getI18n()]);
  return { title: skill?.name ?? t("meta.skill.fallback"), description: skill?.description };
}

export default async function SkillPage({ params }: Params) {
  const { slug } = await params;
  const skill = (await skillRepository.bySlug(slug)) ?? (await skillRepository.byId(slug));
  if (!skill) notFound();
  const [i18n, session] = await Promise.all([getI18n(), auth()]);
  const { t } = i18n;
  const viewerId = session?.user?.id ?? null;
  const [watch, comments, viewer, role, review, inSkillsets] = await Promise.all([
    watchSummary(skill.id, viewerId),
    listComments("skill", skill.id),
    viewerId ? getAuthorRef(viewerId) : Promise.resolve(null),
    viewerId ? getRole(viewerId) : Promise.resolve(null),
    pendingRequestFor(skill.id),
    listSkillsets({ skillId: skill.id, sort: "popular", limit: 6 }),
  ]);

  const scan = scanManifest(skill.manifest, { reviewed: skill.securityLevel === "Verified" });
  const ep = skill.manifest.entrypoint;
  const readme = await skillRepository.readme(skill.id);
  const full = await hydratePrompt(skill);
  const siblings = skill.source
    ? (await skillRepository.all()).filter((s) => s.id !== skill.id && s.source?.fullName === skill.source?.fullName).slice(0, 4)
    : [];
  const readmeBase = skill.source ? `https://github.com/${skill.source.fullName}/blob/${skill.source.defaultBranch}/${skill.source.manifestPath.split("/").slice(0, -1).join("/")}` : null;
  const owner = skill.source?.owner ?? skill.authorName;
  // Catalogue rows predate URL validation and the crawler trusts repo metadata: re-check the scheme here.
  const repoHref = safeExternalHref(skill.repoUrl);

  return (
    <div className="container space-y-6 py-8">
      {/* Breadcrumb + context chips. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label-mono flex flex-wrap items-center gap-2">
          <span className="text-synapse">/</span>
          <Link href="/explore" className="hover:text-foreground">{t("skill.catalogue")}</Link>
          <span className="text-border">/</span>
          <Link href={`/explore?category=${skill.category}`} className="hover:text-foreground">{skill.category}</Link>
          <span className="text-border">/</span>
          <Link href={`/authors/${encodeURIComponent(owner)}`} className="hover:text-foreground">{owner}</Link>
          <span className="text-border">/</span>
          <span className="font-medium text-synapse">{skill.slug}</span>
        </p>
        <Badge variant="chip">{t("skill.origin", { origin: skill.origin })}</Badge>
      </div>

      {/* Hero card. */}
      <header className="group relative rounded-xl border border-border bg-card p-6">
        <Corners />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <SecurityBadge level={skill.securityLevel} solid />
              <Badge variant="chip" className="text-moss">v{skill.version}</Badge>
              <Badge variant="chip">{skill.category}</Badge>
              {skill.source?.license && <Badge variant="chip">{t("skill.license", { license: skill.source.license })}</Badge>}
              {repoHref && (
                <a href={repoHref} target="_blank" rel="noreferrer nofollow" className="label-mono-sm ml-1 inline-flex items-center gap-1 normal-case tracking-normal transition-colors hover:text-synapse">
                  <Code2 className="h-3.5 w-3.5" /> {repoHref.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            <h1 className="font-display mt-1 flex items-center gap-3 text-3xl font-medium tracking-tight sm:text-4xl">
              {skill.name}
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-synapse animate-pulse-dot" />
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{skill.description}</p>
            <p className="label-mono-sm mt-1 normal-case tracking-normal">
              {t("skill.by")}{" "}
              <Link href={`/authors/${encodeURIComponent(owner)}`} className="text-foreground hover:text-synapse">
                {skill.authorName}
              </Link>{" "}
              {t("skill.updated", { ago: timeAgo(skill.source?.pushedAt ?? skill.updatedAt, i18n) })}
              {skill.origin === "github" && ` ${t("skill.imported")}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
            <InstallButton skill={full} size="lg" label={t("install.toAgent")} className="h-11 px-6 text-base font-semibold normal-case tracking-tight" />
            <WatchButton skillId={skill.id} slug={skill.slug} name={skill.name} initial={watch} signedIn={Boolean(viewerId)} />
            {/* Verification goes through a review request; Verified entries have nothing left to request. */}
            {skill.securityLevel !== "Verified" && <ModerationRequestButton skillId={skill.id} slug={skill.slug} name={skill.name} pendingId={review?.id ?? null} signedIn={Boolean(viewerId)} canReview={can(role, "catalog.moderate")} />}
            <Button asChild variant="mono" size="icon" className="h-11 w-11" aria-label={t("skill.viewDiff")}>
              <a href="#pipeline">
                <Eye />
              </a>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 bg-surface-low/60 p-4 sm:grid-cols-4">
          <Stat label={t("skill.installs")} value={formatCompact(skill.downloadsCount)} unit={`+${formatCompact(skill.stats.installVelocity7d)}/7d`} />
          <Stat label={t("skill.sandboxScore")} value={String(scan.score)} unit="/100" muted />
          <Stat label={t("skill.retention")} value={String(Math.round(skill.stats.retentionRate * 100))} unit="%" />
          <Stat label={t("skill.githubStars")} value={formatCompact(skill.githubStars)} muted />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Main column. */}
        <div className="flex flex-col gap-6 lg:col-span-8">
          <div id="pipeline" className="scroll-mt-20">
            <PromptVisualizer skill={full} />
          </div>

          <ToolSpec skill={skill} />

          {readme && (
            <Panel title={skill.source?.manifestFile === "SKILL.md" ? "SKILL.md" : "README"} icon={<Code2 className="h-4 w-4 shrink-0 text-moss" />} actions={readmeBase ? <a href={readmeBase} target="_blank" rel="noreferrer" className="label-mono-sm hover:text-foreground">{t("skill.viewOnGithub")}</a> : undefined} corners>
              <Markdown source={readme.slice(0, 60_000)} baseUrl={readmeBase} className="px-5 py-4 text-sm text-foreground/90" />
            </Panel>
          )}

          <SkillDiscussion skillId={skill.id} slug={skill.slug} initial={comments} viewer={viewer} canModerate={can(role, "content.moderate")} />

          {siblings.length > 0 && (
            <section className="space-y-3">
              <h3 className="label-mono">
                <span className="mr-1.5 text-synapse/70">/</span>{t("skill.moreFrom", { repo: skill.source?.fullName ?? "" })}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {siblings.map((s) => (
                  <SkillCard key={s.id} skill={s} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Side column. */}
        <aside className="flex flex-col gap-6 lg:col-span-4">
          <ScanReportView report={scan} />

          <InstallPanel skill={full} />

          <Panel title={t("skill.entryPoint")} icon={<Terminal className="h-4 w-4 shrink-0 text-synapse" />} corners bodyClassName="p-4 text-sm">
            <code className="well block break-all p-2 font-mono text-xs">
              {ep.type === "mcp-stdio" ? `${ep.command} ${(ep.args ?? []).join(" ")}` : ep.type === "prompt" ? t("skill.promptOnly") : ep.url}
            </code>
            <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5"><ShieldQuestion className="h-3.5 w-3.5" /> {t("skill.permissions", { list: skill.manifest.permissions?.length ? skill.manifest.permissions.join(", ") : t("common.none") })}</p>
              {skill.manifest.requiredEnv?.length ? (
                <p className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> {t("skill.env", { list: skill.manifest.requiredEnv.join(", ") })}</p>
              ) : null}
            </div>
            {repoHref && (
              <a href={repoHref} target="_blank" rel="noreferrer nofollow" className="mt-3 inline-flex items-center gap-1 text-xs text-synapse hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> {t("skill.sourceRepo")}
              </a>
            )}
          </Panel>

          <Panel title={t("skill.skillsets")} meta={inSkillsets.length ? String(inSkillsets.length) : undefined} icon={<Boxes className="h-4 w-4 shrink-0 text-synapse" />} corners>
            {inSkillsets.length > 0 && (
              <ul className="divide-y divide-border">
                {inSkillsets.map((set) => (
                  <li key={set.id}>
                    <Link href={`/skillsets/${set.slug}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-low/60">
                      <SkillsetAvatar name={set.name} avatar={set.avatar} size="sm" className="h-8 w-8 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{set.name}</span>
                        <span className="label-mono-sm block truncate normal-case tracking-normal">@{set.author.handle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className={inSkillsets.length ? "border-t border-border p-3" : "p-4"}>
              {!inSkillsets.length && <p className="mb-3 text-xs text-muted-foreground">{t("skill.skillsetsEmpty")}</p>}
              <Link href={`/skillsets/new?skill=${encodeURIComponent(skill.slug)}`} className="label-mono-sm inline-flex items-center gap-1.5 text-synapse hover:underline">
                <Plus className="h-3.5 w-3.5" /> {t("skill.skillsetsCreate")}
              </Link>
            </div>
          </Panel>

          {skill.source && <RepoCard source={skill.source} />}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, muted }: { label: string; value: string; unit?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="label-mono-sm">{label}</span>
      <span className="stat-value mt-0.5">
        {value}
        {unit && <span className={`label-mono ml-1 ${muted ? "text-muted-foreground" : "text-synapse"}`}>{unit}</span>}
      </span>
    </div>
  );
}
