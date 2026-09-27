import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard, Gauge, Receipt } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { billing } from "@/cortex/billing";
import { availableProviders } from "@/cortex/payment-providers";
import { effectiveStatus, getSubscriptionRow, listPayments } from "@/cortex/payments";
import { currentPlan, usageToday } from "@/cortex/plans";
import { Panel, StatTile } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { BillingPanel } from "@/components/billing-panel";
import { formatMinor, formatUsd } from "@/lib/money";
import { microsToUsd } from "@/types/economy";
import { BILLING_PERIODS, isUnlimited, PLAN_IDS, type BillingPeriod, type PlanId } from "@/types/billing";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("billing.meta.title") };
}
export const dynamic = "force-dynamic";

const STATUS_VARIANT = { pending: "chip", succeeded: "community", failed: "danger", canceled: "chip", refunded: "sandbox" } as const;

type Search = { searchParams: Promise<{ plan?: string; period?: string }> };

/** Plan, usage against quotas, checkout, wallet top-up and the payment history. */
export default async function BillingPage({ searchParams }: Search) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/billing");
  const userId = session.user.id;
  const sp = await searchParams;
  const [{ t, n, locale }, sub, plan, payments, wallet] = await Promise.all([getI18n(), getSubscriptionRow(userId), currentPlan(userId), listPayments(userId, 50), billing.getWallet(userId)]);
  const status = sub ? effectiveStatus(sub) : null;
  const live = sub && status !== "canceled" ? sub : null;
  const used = usageToday(userId);
  const fmt = (v: number) => new Intl.NumberFormat(locale).format(v);
  const providerOptions = (currency: "RUB" | "USD") => availableProviders(currency).map((p) => ({ id: p.id, methods: [...p.methods] }));

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-3 border-b border-border pb-4 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <span className="label-mono text-synapse">{t("dash.console")}</span>
          <span className="label-mono">/</span>
          <h1 className="label-mono font-semibold text-foreground">{t("billing.title")}</h1>
        </div>
        <Link href="/pro" className="label-mono-sm text-synapse hover:underline">
          {t("billing.comparePlans")} →
        </Link>
      </header>

      <section className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatTile
          label={t("billing.plan")}
          value={t(`pro.plan.${plan.id}`)}
          tag={status && status !== "active" ? <Badge variant={status === "canceled" ? "chip" : "sandbox"}>{t(`billing.status.${status}`)}</Badge> : undefined}
          hint={live ? t(live.cancelAtPeriodEnd ? "billing.endsOn" : "billing.renewsOn", { date: new Date(live.currentPeriodEnd).toLocaleDateString(locale) }) : t("billing.freeHint")}
        />
        <StatTile label={t("billing.usage")} value={fmt(used.request)} unit={isUnlimited(plan.limits.requestsPerDay) ? "∞" : `/ ${fmt(plan.limits.requestsPerDay)}`} hint={t("billing.usageHint", { n: fmt(used.resolve), max: isUnlimited(plan.limits.resolvePerDay) ? "∞" : fmt(plan.limits.resolvePerDay) })} />
        <StatTile label={t("billing.wallet")} value={formatUsd(microsToUsd(wallet.balanceMicros), locale)} hint={t("billing.walletHint")} />
      </section>

      {status === "grace" && <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{t("billing.graceBanner")}</p>}

      <BillingPanel
        currentPlan={plan.id}
        subscription={live ? { period: live.period, seats: live.seats, cancelAtPeriodEnd: live.cancelAtPeriodEnd, pendingPlan: live.pendingPlan } : null}
        rubProviders={providerOptions("RUB")}
        usdProviders={providerOptions("USD")}
        initialPlan={(PLAN_IDS as readonly string[]).includes(sp.plan ?? "") ? (sp.plan as PlanId) : null}
        initialPeriod={(BILLING_PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as BillingPeriod) : null}
      />

      <Panel id="history" title={t("billing.history")} icon={<Receipt className="h-4 w-4 shrink-0 text-synapse" />} meta={n("billing.historyCount", payments.length)} className="scroll-mt-24" bodyClassName="p-0">
        {payments.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{t("billing.historyEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="label-mono-sm border-b border-border bg-surface-low/60">
                <tr>
                  <th className="px-4 py-2 font-normal">{t("billing.col.date")}</th>
                  <th className="px-4 py-2 font-normal">{t("billing.col.what")}</th>
                  <th className="px-4 py-2 font-normal">{t("billing.col.method")}</th>
                  <th className="px-4 py-2 text-right font-normal">{t("billing.col.amount")}</th>
                  <th className="px-4 py-2 font-normal">{t("billing.col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-4 py-2">
                      {p.kind === "topup" ? t("billing.kind.topup") : t("billing.kind.subscription", { plan: t(`pro.plan.${p.plan ?? "pro"}`), period: t(`pro.period.${p.period ?? "month"}`) })}
                      <div className="font-mono text-[10px] text-muted-foreground">{p.id}</div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {t(`billing.method.${p.method}`)} · {t(`billing.provider.${p.provider}`)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{formatMinor(p.amount, p.currency, locale)}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[p.status]}>{t(`billing.pay.${p.status}`)}</Badge>
                      {p.status === "pending" && p.confirmationUrl && (
                        <a href={p.confirmationUrl} className="ml-2 text-synapse hover:underline">
                          {t("billing.continue")}
                        </a>
                      )}
                      {p.failureReason && <div className="mt-1 text-[10px] text-muted-foreground">{p.failureReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="label-mono-sm flex flex-col items-center justify-between gap-2 rounded-xl border border-border bg-muted p-4 normal-case tracking-normal md:flex-row">
        <span className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-synapse" /> {t("billing.foot.providers")}
        </span>
        <span className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-synapse" /> {t("billing.foot.quotas")}
        </span>
      </div>
    </div>
  );
}
