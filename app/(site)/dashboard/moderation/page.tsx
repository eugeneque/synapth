import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, BadgeCheck, Gavel, Hourglass } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getRole } from "@/cortex/roles";
import { listModerationRequests, moderationQueue } from "@/cortex/moderation";
import { getI18n } from "@/cortex/locale";
import { can } from "@/types/auth";
import { formatCompact, timeAgo } from "@/lib/utils";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { SecurityBadge } from "@/components/security-badge";
import { VerifyControl } from "@/components/verify-control";
import { ModerationStatusChip } from "@/components/moderation-status";
import type { ModerationRequest } from "@/types/moderation";
import type { Translator, UiKey } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("moderation.meta") };
}
export const dynamic = "force-dynamic";

/** Staff queue: open review requests (oldest first), recent verdicts, and the verified entries (revocable). */
export default async function ModerationPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/moderation");
  // 404 rather than 403: the console does not advertise staff pages.
  if (!can(await getRole(session.user.id), "catalog.moderate")) notFound();
  const [pending, decided, queue, i18n] = await Promise.all([listModerationRequests("pending"), listModerationRequests("decided", 20), moderationQueue(), getI18n()]);
  const { t } = i18n;

  return (
    <div className="space-y-8">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
          <span className="text-synapse">{t("moderation.crumb")}</span>
          <span className="text-border">/</span>
          <span>{t("moderation.sandboxed", { n: queue.sandboxed })}</span>
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("moderation.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("moderation.lead")}</p>
      </header>

      <Panel title={t("moderation.requests")} meta={String(pending.length)} icon={<Hourglass className="h-4 w-4 shrink-0 text-warn" />} corners>
        <RequestList requests={pending} empty={t("moderation.emptyRequests")} i18n={i18n} />
      </Panel>

      <Panel title={t("moderation.decided")} meta={String(decided.length)} icon={<Gavel className="h-4 w-4 shrink-0 text-synapse" />} corners>
        <RequestList requests={decided} empty={t("moderation.emptyDecided")} i18n={i18n} />
      </Panel>

      <Panel title={t("moderation.verifiedList")} meta={String(queue.verified.length)} icon={<BadgeCheck className="h-4 w-4 shrink-0 text-synapse" />} corners>
        {queue.verified.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t("moderation.emptyVerified")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {queue.verified.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SecurityBadge level={s.securityLevel} />
                    <Badge variant="chip">{s.category}</Badge>
                    <Badge variant="chip">v{s.version}</Badge>
                  </div>
                  <Link href={`/skills/${s.slug}`} className="block truncate font-medium hover:text-synapse">
                    {s.name}
                  </Link>
                  <p className="label-mono-sm truncate normal-case tracking-normal">
                    {s.authorName} · {t("moderation.reach", { installs: formatCompact(s.downloadsCount), stars: formatCompact(s.githubStars) })}
                  </p>
                </div>
                <VerifyControl skillId={s.id} name={s.name} level={s.securityLevel} size="sm" className="shrink-0 self-start sm:self-center" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RequestList({ requests, empty, i18n }: { requests: ModerationRequest[]; empty: string; i18n: Translator<UiKey> }) {
  const { t } = i18n;
  if (!requests.length) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {requests.map((r) => (
        <li key={r.id}>
          <Link href={`/dashboard/moderation/${r.id}`} className="group flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-surface-low/60 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {r.skill && <SecurityBadge level={r.skill.securityLevel} />}
                <ModerationStatusChip status={r.status} t={t} />
              </div>
              <p className="truncate font-medium group-hover:text-synapse">{r.skill?.name ?? t("moderation.entryGone")}</p>
              <p className="label-mono-sm truncate normal-case tracking-normal">
                {t("moderation.requestedBy", { name: r.requester ? `@${r.requester.handle}` : "—", ago: timeAgo(r.createdAt, i18n) })}
                {r.reviewer && ` · ${t("moderation.reviewedBy", { name: `@${r.reviewer.handle}` })}`}
              </p>
              {r.note && <p className="line-clamp-2 text-xs text-muted-foreground">“{r.note}”</p>}
            </div>
            <span className="label-mono-sm inline-flex shrink-0 items-center gap-1 text-synapse">
              {t(r.status === "pending" ? "moderation.open" : "moderation.details")} <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
