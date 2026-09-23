import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Gavel, ListChecks, Phone, Route, X } from "lucide-react";
import { auth } from "@/cortex/auth";
import { hasPermission } from "@/cortex/roles";
import { checkEligibility, getVerificationRequest } from "@/cortex/verification";
import { getI18n } from "@/cortex/locale";
import { Avatar } from "@/components/avatar";
import { LiveRefresh } from "@/components/live-refresh";
import { Panel } from "@/components/panel";
import { VerificationReview } from "@/components/verification-review";
import { VerificationStepper } from "@/components/verification-stepper";
import { VerifiedMark } from "@/components/verified-mark";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EligibilityCheck } from "@/types/verification";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("verify.admin.meta") };
}
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** One verification request: who, the phone, the stage timeline, requirements then vs now, and the verdict controls. */
export default async function VerificationRequestPage({ params }: Props) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user) redirect(`/signin?callbackUrl=/dashboard/admin/verification/${id}`);
  if (!(await hasPermission(session.user.id, "users.verify"))) notFound();
  const [request, i18n] = await Promise.all([getVerificationRequest(session.user.id, id), getI18n()]);
  if (!request) notFound();
  const { t } = i18n;
  // The live picture next to the snapshot: impulses move, skills get republished.
  const now = request.status === "pending" ? await checkEligibility(request.user.id, request.phone) : null;

  const describe = (c: EligibilityCheck) =>
    c.id === "age" ? t("verify.check.ageValue", { n: c.value, required: c.required }) : c.id === "impulses" ? t("verify.check.impulsesValue", { n: c.value, required: c.required }) : c.id === "skills" ? (c.ok ? t("verify.check.skillsCleanShort") : t("verify.check.skillsFlagged", { n: c.value })) : c.ok ? t("verify.check.phoneOk") : "—";

  return (
    <div className="space-y-6">
      {request.status === "pending" && <LiveRefresh seconds={15} />}
      <Link href="/dashboard/admin/verification" className="label-mono-sm inline-flex items-center gap-1.5 transition-colors hover:text-synapse">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("verify.admin.back")}
      </Link>

      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar author={request.user} size="lg" />
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-2 font-display text-2xl font-medium tracking-tight">
              {request.user.name || request.user.handle}
              {request.user.verified && <VerifiedMark size="md" />}
            </p>
            <p className="label-mono-sm normal-case tracking-normal">
              @{request.user.handle} · {t("verify.admin.filed", { date: new Date(request.createdAt).toLocaleString(i18n.locale) })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`tel:${request.phone}`} className="pill h-8 gap-2 text-foreground transition-colors hover:border-synapse/40 hover:text-synapse">
            <Phone className="h-3.5 w-3.5 text-synapse" /> {request.phone}
          </a>
          <Link href={`/u/${request.user.handle}`} className="pill h-8 transition-colors hover:border-synapse/40 hover:text-synapse">
            {t("verify.admin.profile")} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Badge variant={request.status === "approved" ? "synapse" : request.status === "rejected" ? "danger" : request.status === "pending" ? "sandbox" : "chip"} className="h-8 px-3">
            {t(`verify.status.${request.status}`)}
          </Badge>
        </div>
      </section>

      <Panel title={t("verify.admin.stages")} icon={<Route className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-5" corners>
        <VerificationStepper request={request} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("verify.admin.requirements")} meta={now ? t("verify.admin.snapshotVsNow") : t("verify.admin.snapshot")} icon={<ListChecks className="h-4 w-4 shrink-0 text-synapse" />}>
          <ul className="stagger divide-y divide-border">
            {request.eligibility.checks.map((c) => {
              const live = now?.checks.find((x) => x.id === c.id);
              return (
                <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium tracking-tight">{t(`verify.check.${c.id}`)}</p>
                    <p className="label-mono-sm mt-0.5 normal-case tracking-normal">
                      {describe(c)}
                      {live && describe(live) !== describe(c) && <span className="text-foreground"> → {describe(live)}</span>}
                    </p>
                  </div>
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border", (live ?? c).ok ? "border-synapse/40 bg-synapse/10 text-synapse" : "border-danger/40 bg-danger/10 text-danger")}>{(live ?? c).ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span>
                </li>
              );
            })}
          </ul>
          {(now ?? request.eligibility).flaggedSkills.length > 0 && (
            <div className="border-t border-border p-4">
              <p className="label-mono-sm mb-2 text-warn">{t("verify.flaggedLead")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {(now ?? request.eligibility).flaggedSkills.map((s) => (
                  <li key={s.id}>
                    <Link href={`/skills/${s.slug}`} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-warn/30 px-2 font-mono text-[11px] transition-colors hover:border-warn">
                      {s.name} <span className="text-warn">· {s.findings}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title={t("verify.admin.decision")} icon={<Gavel className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-5">
          <VerificationReview request={request} viewerId={session.user.id} />
          {request.decisionNote && request.status !== "pending" && <p className="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-surface-lowest p-3 text-sm text-foreground/90">{request.decisionNote}</p>}
        </Panel>
      </div>
    </div>
  );
}
