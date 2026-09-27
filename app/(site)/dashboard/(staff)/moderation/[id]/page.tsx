import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Code2, ExternalLink, FileJson, Gavel, KeyRound, MessageSquareQuote, ShieldQuestion, Terminal } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getRole } from "@/cortex/roles";
import { getModerationRequest } from "@/cortex/moderation";
import { skillRepository } from "@/cortex/repository";
import { getI18n } from "@/cortex/locale";
import { can } from "@/types/auth";
import { scanSkill } from "@/lib/sandbox-scanner";
import { safeExternalHref } from "@/lib/url-safety";
import { timeAgo } from "@/lib/utils";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { SecurityBadge } from "@/components/security-badge";
import { ToolSpec } from "@/components/tool-spec";
import { Markdown } from "@/components/markdown";
import { ReviewScanner } from "@/components/review-scanner";
import { VerdictForm } from "@/components/verdict-form";
import { ModerationStatusChip } from "@/components/moderation-status";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const [request, { t }] = await Promise.all([getModerationRequest(id), getI18n()]);
  return { title: request?.skill ? t("review.meta", { name: request.skill.name }) : t("moderation.meta") };
}
export const dynamic = "force-dynamic";

/** One review: the entry in full (manifest, tools, entry point, README), the scanner, and the verdict. */
export default async function ReviewPage({ params }: Params) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=/dashboard/moderation/${encodeURIComponent(id)}`);
  const role = await getRole(session.user.id);
  if (!can(role, "catalog.moderate")) notFound();
  const request = await getModerationRequest(id);
  if (!request) notFound();
  const i18n = await getI18n();
  const { t } = i18n;
  const skill = request.skill ? await skillRepository.byId(request.skill.id) : null;

  const back = (
    <Link href="/dashboard/moderation" className="label-mono-sm inline-flex items-center gap-1.5 hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> {t("review.back")}
    </Link>
  );
  if (!skill) {
    return (
      <div className="space-y-6">
        {back}
        <p className="text-sm text-muted-foreground">{t("moderation.entryGone")}</p>
      </div>
    );
  }

  const readme = await skillRepository.readme(skill.id);
  const report = scanSkill(skill, { reviewed: false, gov: false });
  const verifiable = report.verifiable;
  const ep = skill.manifest.entrypoint;
  const repoHref = safeExternalHref(skill.repoUrl);

  return (
    <div className="space-y-6">
      {back}
      <header className="space-y-3 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <ModerationStatusChip status={request.status} t={t} />
          <SecurityBadge level={skill.securityLevel} />
          <Badge variant="chip">{skill.category}</Badge>
          <Badge variant="chip">v{skill.version}</Badge>
          <Badge variant="chip">{t("skill.origin", { origin: skill.origin })}</Badge>
        </div>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{skill.name}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{skill.description}</p>
        <div className="label-mono-sm flex flex-wrap items-center gap-x-4 gap-y-1 normal-case tracking-normal">
          <span>
            {t("skill.by")} <span className="text-foreground">{skill.authorName}</span>
          </span>
          <Link href={`/skills/${skill.slug}`} className="inline-flex items-center gap-1 text-synapse hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> {t("review.openEntry")}
          </Link>
          {repoHref && (
            <a href={repoHref} target="_blank" rel="noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-foreground">
              <Code2 className="h-3.5 w-3.5" /> {repoHref.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <Panel title={t("review.request")} icon={<MessageSquareQuote className="h-4 w-4 shrink-0 text-synapse" />} corners bodyClassName="space-y-2 p-5 text-sm">
            <p className="label-mono-sm normal-case tracking-normal">
              {t("moderation.requestedBy", { name: request.requester ? `@${request.requester.handle}` : "—", ago: timeAgo(request.createdAt, i18n) })}
            </p>
            <p className={request.note ? "text-foreground" : "text-muted-foreground"}>{request.note ?? t("review.noNote")}</p>
          </Panel>

          <Panel title={t("skill.entryPoint")} icon={<Terminal className="h-4 w-4 shrink-0 text-synapse" />} corners bodyClassName="space-y-3 p-5 text-sm">
            <code className="well block break-all p-2 font-mono text-xs">
              {ep.type === "mcp-stdio" ? `${ep.command} ${(ep.args ?? []).join(" ")}` : ep.type === "prompt" ? t("skill.promptOnly") : ep.url}
            </code>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <ShieldQuestion className="h-3.5 w-3.5" /> {t("skill.permissions", { list: skill.manifest.permissions?.length ? skill.manifest.permissions.join(", ") : t("common.none") })}
              </p>
              {skill.manifest.requiredEnv?.length ? (
                <p className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" /> {t("skill.env", { list: skill.manifest.requiredEnv.join(", ") })}
                </p>
              ) : null}
            </div>
          </Panel>

          <ToolSpec skill={skill} />

          <Panel title={t("review.manifest")} icon={<FileJson className="h-4 w-4 shrink-0 text-synapse" />} corners>
            <pre className="max-h-[32rem] overflow-auto p-5 font-mono text-[11px] leading-relaxed text-foreground/90">{JSON.stringify(skill.manifest, null, 2)}</pre>
          </Panel>

          {readme && (
            <Panel title={skill.source?.manifestFile === "SKILL.md" ? "SKILL.md" : "README"} icon={<Code2 className="h-4 w-4 shrink-0 text-moss" />} corners>
              <Markdown source={readme.slice(0, 60_000)} className="max-h-[40rem] overflow-auto px-5 py-4 text-sm text-foreground/90" />
            </Panel>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <Panel title={t("review.verdict")} icon={<Gavel className="h-4 w-4 shrink-0 text-synapse" />} corners>
            {request.status === "pending" ? (
              can(role, "catalog.verify") ? (
                <VerdictForm requestId={request.id} name={skill.name} verifiable={verifiable} />
              ) : (
                <p className="p-5 text-sm text-muted-foreground">{t("review.noVerifyRight")}</p>
              )
            ) : (
              <div className="space-y-2 p-5 text-sm">
                <ModerationStatusChip status={request.status} t={t} />
                <p className="label-mono-sm normal-case tracking-normal">
                  {t("moderation.reviewedBy", { name: request.reviewer ? `@${request.reviewer.handle}` : "—" })}
                  {request.decidedAt && ` · ${timeAgo(request.decidedAt, i18n)}`}
                </p>
                {request.verdictNote && <p className="text-foreground">{request.verdictNote}</p>}
              </div>
            )}
          </Panel>

          <ReviewScanner skillId={skill.id} initial={{ report, verifiable, scannedAt: new Date().toISOString() }} />
        </aside>
      </div>
    </div>
  );
}
