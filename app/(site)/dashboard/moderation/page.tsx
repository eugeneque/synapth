import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BadgeCheck, Hourglass } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getRole } from "@/cortex/roles";
import { moderationQueue } from "@/cortex/moderation";
import { getI18n } from "@/cortex/locale";
import { can } from "@/types/auth";
import { formatCompact } from "@/lib/utils";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { SecurityBadge } from "@/components/security-badge";
import { VerifyControl } from "@/components/verify-control";
import type { Skill } from "@/types/skill";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("moderation.meta") };
}
export const dynamic = "force-dynamic";

/** Review queue for moderators and admins: clean-scan entries awaiting `Verified`, and the ones already verified. */
export default async function ModerationPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/moderation");
  // 404 rather than 403: the console does not advertise staff pages.
  if (!can(await getRole(session.user.id), "catalog.moderate")) notFound();
  const [queue, { t }] = await Promise.all([moderationQueue(), getI18n()]);

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

      <Panel title={t("moderation.pending")} meta={String(queue.pending.length)} icon={<Hourglass className="h-4 w-4 shrink-0 text-warn" />} corners>
        <EntryList skills={queue.pending} empty={t("moderation.emptyPending")} reach={(s) => t("moderation.reach", { installs: formatCompact(s.downloadsCount), stars: formatCompact(s.githubStars) })} />
      </Panel>

      <Panel title={t("moderation.verifiedList")} meta={String(queue.verified.length)} icon={<BadgeCheck className="h-4 w-4 shrink-0 text-synapse" />} corners>
        <EntryList skills={queue.verified} empty={t("moderation.emptyVerified")} reach={(s) => t("moderation.reach", { installs: formatCompact(s.downloadsCount), stars: formatCompact(s.githubStars) })} />
      </Panel>
    </div>
  );
}

function EntryList({ skills, empty, reach }: { skills: Skill[]; empty: string; reach: (s: Skill) => string }) {
  if (!skills.length) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {skills.map((s) => (
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
              {s.authorName} · {reach(s)}
            </p>
          </div>
          <VerifyControl skillId={s.id} name={s.name} level={s.securityLevel} size="sm" className="shrink-0 self-start sm:self-center" />
        </li>
      ))}
    </ul>
  );
}
