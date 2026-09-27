"use client";

/** Synapth Pro plan grid with a month / year switch (ТЗ §4.1). */

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { isUnlimited, PLAN_IDS, PLANS, type BillingPeriod, type PlanId } from "@/types/billing";
import type { UiKey } from "@/lib/i18n";

const EXTRA: Record<PlanId, UiKey[]> = {
  free: ["pro.f.catalog", "pro.f.publish"],
  pro: ["pro.f.policies", "pro.f.ci"],
  team: ["pro.f.org", "pro.f.orgPolicies", "pro.f.approvals", "pro.f.sso"],
  business: ["pro.f.dedicated", "pro.f.sla", "pro.f.saml", "pro.f.siem", "pro.f.priority"],
};

export function PricingPlans({ current, signedIn }: { current: PlanId | null; signedIn: boolean }) {
  const { t, n, locale } = useI18n();
  const [period, setPeriod] = useState<BillingPeriod>("year");
  const fmt = (v: number) => new Intl.NumberFormat(locale).format(v);

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div role="tablist" aria-label={t("pro.period")} className="inline-flex rounded-lg border border-border bg-muted p-1">
          {(["month", "year"] as const).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cn("rounded-md px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors", period === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t(`pro.period.${p}`)}
              {p === "year" && <span className="ml-2 text-synapse">{t("pro.yearSave")}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const price = plan.price[period] ?? plan.price.month;
          const featured = id === "pro";
          const l = plan.limits;
          const target = signedIn ? `/dashboard/billing?plan=${id}&period=${plan.price[period] === null ? "month" : period}#change` : `/signin?callbackUrl=${encodeURIComponent(`/dashboard/billing?plan=${id}&period=${period}`)}`;
          return (
            <section key={id} className={cn("relative flex flex-col gap-5 rounded-xl border bg-card p-5", featured ? "border-synapse/50 shadow-glow" : "border-border")}>
              <header className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="label-mono text-foreground">{t(`pro.plan.${id}`)}</h2>
                  {featured && <Badge variant="synapse">{t("pro.popular")}</Badge>}
                  {current === id && <Badge variant="chip">{t("pro.current")}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{t(`pro.plan.${id}.for`)}</p>
              </header>

              <div className="space-y-1">
                <p className="flex items-baseline gap-1.5">
                  {id === "business" && <span className="text-sm text-muted-foreground">{t("pro.from")}</span>}
                  <span className="stat-value">{price === 0 ? t("common.free") : formatMinor(price ?? 0, "RUB", locale)}</span>
                </p>
                <p className="label-mono-sm normal-case tracking-normal">
                  {price === 0 ? t("pro.forever") : plan.perSeat ? t(`pro.perSeat.${period}`, { n: plan.minSeats }) : id === "business" ? t("pro.perMonth") : t(`pro.per.${period}`)}
                </p>
              </div>

              <ul className="flex flex-1 flex-col gap-2 text-[13px]">
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />{n("pro.f.keys", l.keys)}</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />{isUnlimited(l.requestsPerDay) ? t("pro.f.requestsUnlimited") : t("pro.f.requests", { n: fmt(l.requestsPerDay), r: fmt(l.resolvePerDay) })}</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />{l.privatePacks === null ? t("pro.f.packsUnlimited") : n("pro.f.packs", l.privatePacks)}</li>
                {l.ciRepos > 0 && <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />{isUnlimited(l.ciRepos) ? t("pro.f.ciUnlimited") : n("pro.f.ciRepos", l.ciRepos)}</li>}
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />{n("pro.f.audit", l.auditDays)}</li>
                {EXTRA[id].map((key) => (
                  <li key={key} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />{t(key)}</li>
                ))}
              </ul>

              {current === id ? (
                <Button variant="mono" disabled>{t("pro.current")}</Button>
              ) : plan.selfServe ? (
                <Button asChild variant={featured ? "default" : "mono"}>
                  <Link href={id === "free" ? (signedIn ? "/dashboard/billing" : "/signup") : target}>{id === "free" ? t("pro.cta.free") : t("pro.cta.buy", { plan: t(`pro.plan.${id}`) })}</Link>
                </Button>
              ) : (
                <Button asChild variant="mono">
                  <a href="mailto:sales@synapth.dev?subject=Synapth%20Business">{t("pro.cta.sales")}</a>
                </Button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
