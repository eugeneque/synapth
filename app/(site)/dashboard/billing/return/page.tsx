import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { refreshPayment } from "@/cortex/payments";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { LiveRefresh } from "@/components/live-refresh";
import { formatMinor } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Where providers send the browser back: re-reads the payment instead of waiting for the webhook. */
export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/billing");
  const { payment: id } = await searchParams;
  const [{ t, locale }, payment] = await Promise.all([getI18n(), id ? refreshPayment(session.user.id, id).catch(() => null) : Promise.resolve(null)]);
  if (!payment) redirect("/dashboard/billing");
  const ok = payment.status === "succeeded";
  const waiting = payment.status === "pending";
  const Icon = ok ? CheckCircle2 : waiting ? Clock : XCircle;
  return (
    <div className="mx-auto max-w-lg">
      {waiting && <LiveRefresh seconds={4} />}
      <Panel title={t("billing.return.title")} icon={<Icon className={ok ? "h-4 w-4 text-synapse" : waiting ? "h-4 w-4 text-warn" : "h-4 w-4 text-danger"} />} corners bodyClassName="space-y-4 p-5">
        <p className="text-lg font-medium">{t(ok ? "billing.return.ok" : waiting ? "billing.return.pending" : "billing.return.failed")}</p>
        <p className="text-sm text-muted-foreground">
          {payment.description} · {formatMinor(payment.amount, payment.currency, locale)}
        </p>
        {payment.failureReason && <p className="text-xs text-muted-foreground">{payment.failureReason}</p>}
        <Button asChild variant="mono">
          <Link href="/dashboard/billing">{t("billing.return.back")}</Link>
        </Button>
      </Panel>
    </div>
  );
}
