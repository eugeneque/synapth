import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, Gavel, Hourglass, Users } from "lucide-react";
import { auth } from "@/cortex/auth";
import { hasPermission } from "@/cortex/roles";
import { listVerificationRequests } from "@/cortex/verification";
import { getI18n } from "@/cortex/locale";
import { timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/avatar";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VerificationRequest } from "@/types/verification";
import type { Translator, UiKey } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("verify.admin.meta") };
}
export const dynamic = "force-dynamic";

/** Staff section · verification queue: open requests (oldest first) and recent decisions. Manual grants live in Users. */
export default async function VerificationQueuePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/verification");
  if (!(await hasPermission(session.user.id, "users.verify"))) notFound();
  const [open, closed, i18n] = await Promise.all([listVerificationRequests(session.user.id, "open"), listVerificationRequests(session.user.id, "closed", 30), getI18n()]);
  const { t } = i18n;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("verify.admin.lead")}</p>
        <Button asChild variant="mono" size="sm" className="shrink-0 self-start">
          <Link href="/dashboard/admin/users">
            <Users className="text-synapse" /> {t("verify.admin.manual")}
          </Link>
        </Button>
      </div>

      <Panel title={t("verify.admin.open")} meta={String(open.length)} icon={<Hourglass className="h-4 w-4 shrink-0 text-warn" />} corners>
        <RequestList requests={open} empty={t("verify.admin.emptyOpen")} i18n={i18n} />
      </Panel>

      <Panel title={t("verify.admin.closed")} meta={String(closed.length)} icon={<Gavel className="h-4 w-4 shrink-0 text-synapse" />} corners>
        <RequestList requests={closed} empty={t("verify.admin.emptyClosed")} i18n={i18n} />
      </Panel>
    </div>
  );
}

const STATUS_VARIANT = { pending: "sandbox", approved: "synapse", rejected: "danger", withdrawn: "chip" } as const;

function RequestList({ requests, empty, i18n }: { requests: VerificationRequest[]; empty: string; i18n: Translator<UiKey> }) {
  const { t } = i18n;
  if (requests.length === 0) return <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="stagger divide-y divide-border">
      {requests.map((r) => (
        <li key={r.id}>
          <Link href={`/dashboard/verification/${r.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-accent/40">
            <Avatar author={r.user} size="md" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium transition-colors group-hover:text-synapse">
                {r.user.name || r.user.handle} <span className="font-mono text-xs text-muted-foreground">@{r.user.handle}</span>
              </p>
              <p className="label-mono-sm truncate normal-case tracking-normal">
                {r.status === "pending" ? (r.reviewer ? t("verify.admin.inReview", { name: r.reviewer.name || r.reviewer.handle }) : t("verify.admin.queued")) : t(`verify.status.${r.status}`)} · {timeAgo(r.status === "pending" ? r.createdAt : (r.decidedAt ?? r.updatedAt), i18n)}
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[r.status]} className="shrink-0">
              {t(`verify.stage.${r.stage}`)}
            </Badge>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-synapse" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
