"use client";

/**
 * Dashboard billing controls: change plan (upgrade now / downgrade at period
 * end), cancel or resume, top up the wallet. A checkout redirects the browser
 * to the provider's hosted page; the provider sends it back to
 * /dashboard/billing/return.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, QrCode, Wallet } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelAction, checkoutAction, resumeAction } from "@/app/(site)/dashboard/billing/actions";
import { formatMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PLANS, TOPUP_MAX_USD, TOPUP_MIN_USD, TOPUP_PRESETS_USD, planPrice, type BillingPeriod, type PaymentMethod, type PaymentProviderId, type PlanId } from "@/types/billing";

export interface ProviderOption {
  id: PaymentProviderId;
  methods: PaymentMethod[];
}

interface Props {
  currentPlan: PlanId;
  /** Null without a live subscription. */
  subscription: { period: BillingPeriod; seats: number; cancelAtPeriodEnd: boolean; pendingPlan: PlanId | null } | null;
  rubProviders: ProviderOption[];
  usdProviders: ProviderOption[];
  initialPlan: PlanId | null;
  initialPeriod: BillingPeriod | null;
}

const SELF_SERVE: PlanId[] = ["pro", "team"];

function MethodPicker({ providers, method, setMethod, provider, setProvider }: { providers: ProviderOption[]; method: PaymentMethod; setMethod: (m: PaymentMethod) => void; provider: PaymentProviderId | undefined; setProvider: (p: PaymentProviderId) => void }) {
  const { t } = useI18n();
  const methods = [...new Set(providers.flatMap((p) => p.methods))].filter((m) => m !== "invoice");
  const forMethod = providers.filter((p) => p.methods.includes(method));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {methods.map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)} className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs", method === m ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}>
            {m === "sbp" ? <QrCode className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
            {t(`billing.method.${m}`)}
          </button>
        ))}
      </div>
      {forMethod.length > 1 && (
        <select aria-label={t("billing.provider")} value={provider ?? forMethod[0].id} onChange={(e) => setProvider(e.target.value as PaymentProviderId)} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
          {forMethod.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`billing.provider.${p.id}`)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function BillingPanel({ currentPlan, subscription, rubProviders, usdProviders, initialPlan, initialPeriod }: Props) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [plan, setPlan] = useState<PlanId>(initialPlan && SELF_SERVE.includes(initialPlan) ? initialPlan : currentPlan === "free" ? "pro" : currentPlan === "pro" ? "team" : currentPlan);
  const [period, setPeriod] = useState<BillingPeriod>(initialPeriod ?? subscription?.period ?? "year");
  const [seats, setSeats] = useState<number>(Math.max(subscription?.seats ?? 3, PLANS.team.minSeats));
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [provider, setProvider] = useState<PaymentProviderId | undefined>(undefined);
  const [topup, setTopup] = useState<number>(20);
  const [topMethod, setTopMethod] = useState<PaymentMethod>("card");
  const [topProvider, setTopProvider] = useState<PaymentProviderId | undefined>(undefined);

  const spec = PLANS[plan];
  const total = planPrice(spec, period, seats) ?? 0;

  function go(run: () => ReturnType<typeof checkoutAction>) {
    setError(null);
    startTransition(async () => {
      const res = await run();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.outcome.kind === "redirect") {
        window.location.assign(res.outcome.url);
        return;
      }
      toast({ tone: "success", title: res.outcome.kind === "scheduled" ? t("billing.scheduled", { date: new Date(res.outcome.effective).toLocaleDateString(locale) }) : t("billing.applied") });
      router.refresh();
    });
  }

  function toggleCancel() {
    startTransition(async () => {
      const res = subscription?.cancelAtPeriodEnd ? await resumeAction() : await cancelAction();
      if (!res.ok) setError(res.error ?? null);
      else toast({ tone: "success", title: subscription?.cancelAtPeriodEnd ? t("billing.resumed") : t("billing.canceled") });
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section id="change" className="scroll-mt-24 space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="label-mono text-foreground">{t("billing.change.title")}</h2>
        {!rubProviders.length ? (
          <p className="text-sm text-muted-foreground">{t("billing.noProvider")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {SELF_SERVE.map((id) => (
                <button key={id} type="button" onClick={() => setPlan(id)} className={cn("rounded-lg border p-3 text-left", plan === id ? "border-synapse/50 bg-synapse/5" : "border-border hover:border-foreground/30")}>
                  <span className="label-mono text-foreground">{t(`pro.plan.${id}`)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t(`pro.plan.${id}.for`)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>{t("pro.period")}</Label>
                <div className="flex gap-1">
                  {(["month", "year"] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPeriod(p)} className={cn("rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase", period === p ? "border-synapse/50 text-synapse" : "border-border text-muted-foreground")}>
                      {t(`pro.period.${p}`)}
                    </button>
                  ))}
                </div>
              </div>
              {spec.perSeat && (
                <div className="w-28 space-y-1.5">
                  <Label htmlFor="seats">{t("billing.seats")}</Label>
                  <Input id="seats" type="number" min={spec.minSeats} max={1000} value={seats} onChange={(e) => setSeats(Math.max(spec.minSeats, Number(e.target.value) || spec.minSeats))} className="h-8 font-mono text-xs" />
                </div>
              )}
            </div>
            <MethodPicker providers={rubProviders} method={method} setMethod={setMethod} provider={provider} setProvider={setProvider} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-sm">
                {t("billing.total")} <span className="font-semibold">{formatMinor(total, "RUB", locale)}</span> <span className="text-xs text-muted-foreground">/ {t(`pro.period.${period}`)}</span>
              </p>
              <Button onClick={() => go(() => checkoutAction({ kind: "subscription", plan, period, seats, method, provider }))} disabled={pending || (plan === currentPlan && subscription?.period === period && (!spec.perSeat || subscription.seats === seats))}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {t("billing.pay")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("billing.change.note")}</p>
          </>
        )}
        {subscription && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>{subscription.cancelAtPeriodEnd ? t("billing.willEnd") : subscription.pendingPlan ? t("billing.pendingPlan", { plan: t(`pro.plan.${subscription.pendingPlan}`) }) : t("billing.autoRenew")}</span>
            <Button size="sm" variant={subscription.cancelAtPeriodEnd ? "mono" : "destructive"} onClick={toggleCancel} disabled={pending}>
              {subscription.cancelAtPeriodEnd ? t("billing.resume") : t("billing.cancel")}
            </Button>
          </div>
        )}
      </section>

      <section id="topup" className="scroll-mt-24 space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="label-mono flex items-center gap-2 text-foreground">
          <Wallet className="h-4 w-4 text-synapse" /> {t("billing.topup.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("billing.topup.lead")}</p>
        {!usdProviders.length ? (
          <p className="text-sm text-muted-foreground">{t("billing.noProvider")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {TOPUP_PRESETS_USD.map((v) => (
                <button key={v} type="button" onClick={() => setTopup(v)} className={cn("rounded-md border px-3 py-1.5 font-mono text-xs", topup === v ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border text-muted-foreground")}>
                  ${v}
                </button>
              ))}
              <Input aria-label={t("billing.topup.amount")} type="number" min={TOPUP_MIN_USD} max={TOPUP_MAX_USD} step="1" value={topup} onChange={(e) => setTopup(Number(e.target.value))} className="h-8 w-24 font-mono text-xs" />
            </div>
            <MethodPicker providers={usdProviders} method={topMethod} setMethod={setTopMethod} provider={topProvider} setProvider={setTopProvider} />
            <div className="flex justify-end border-t border-border pt-3">
              <Button onClick={() => go(() => checkoutAction({ kind: "topup", amountUsd: topup, method: topMethod, provider: topProvider }))} disabled={pending || !(topup >= TOPUP_MIN_USD && topup <= TOPUP_MAX_USD)}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />} {t("billing.topup.cta", { amount: `$${topup}` })}
              </Button>
            </div>
          </>
        )}
      </section>
      {error && <p className="text-xs text-danger lg:col-span-2">{error}</p>}
    </div>
  );
}
