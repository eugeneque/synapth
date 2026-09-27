import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { getPayment } from "@/cortex/payments";
import { PROVIDERS } from "@/cortex/payment-providers";
import { Panel } from "@/components/panel";
import { MockCheckout } from "@/components/mock-checkout";
import { formatMinor } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Local stand-in for a provider's hosted checkout (mock provider only). */
export default async function MockCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user) redirect(`/signin?callbackUrl=/dashboard/billing/checkout/${encodeURIComponent(id)}`);
  const [{ t, locale }, payment] = await Promise.all([getI18n(), getPayment(session.user.id, id)]);
  if (!payment || payment.provider !== "mock" || !PROVIDERS.mock.configured()) notFound();
  if (payment.status !== "pending") redirect(`/dashboard/billing/return?payment=${encodeURIComponent(id)}`);
  return (
    <div className="mx-auto max-w-lg">
      <Panel title={t("billing.mock.title")} icon={<FlaskConical className="h-4 w-4 shrink-0 text-warn" />} corners bodyClassName="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{t("billing.mock.lead")}</p>
        <div className="space-y-1 rounded-lg border border-border bg-muted p-3">
          <p className="text-sm">{payment.description}</p>
          <p className="stat-value">{formatMinor(payment.amount, payment.currency, locale)}</p>
          <p className="label-mono-sm">{t(`billing.method.${payment.method}`)}</p>
        </div>
        <MockCheckout paymentId={payment.id} />
      </Panel>
    </div>
  );
}
