import type { Metadata } from "next";
import { Building2, Landmark, ShieldCheck } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { currentPlanId } from "@/cortex/payments";
import { rich } from "@/lib/i18n/rich";
import { formatMinor } from "@/lib/money";
import { PricingPlans } from "@/components/pricing-plans";
import { Panel } from "@/components/panel";
import { REVIEW_SERVICES } from "@/types/billing";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("pro.meta.title"), description: t("pro.meta.description") };
}

export const dynamic = "force-dynamic";

/** On-prem price list (ТЗ §4.2), RUB minor units; starting hypotheses. */
const ONPREM = [
  { key: "pro.onprem.pilot", price: 300_000_00, unit: "pro.onprem.unit.once" },
  { key: "pro.onprem.standard", price: 1_200_000_00, unit: "pro.onprem.unit.year" },
  { key: "pro.onprem.users", price: 6_000_00, unit: "pro.onprem.unit.userYear" },
  { key: "pro.onprem.gov", price: 600_000_00, unit: "pro.onprem.unit.year" },
  { key: "pro.onprem.support", price: null, unit: "pro.onprem.unit.support" },
  { key: "pro.onprem.rollout", price: 150_000_00, unit: "pro.onprem.unit.from" },
] as const;

/** Synapth Pro: SaaS plans, one-off reviews and On-prem licences. */
export default async function ProPage() {
  const [{ t, locale }, session] = await Promise.all([getI18n(), auth()]);
  const current = session?.user?.id ? await currentPlanId(session.user.id) : null;

  return (
    <div className="container space-y-14 py-10 md:py-16">
      <header className="mx-auto max-w-2xl space-y-3 text-center">
        <p className="label-mono text-synapse">Synapth Pro</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("pro.title")}</h1>
        <p className="text-muted-foreground">{t("pro.lead")}</p>
      </header>

      <PricingPlans current={current} signedIn={Boolean(session?.user)} />

      <p className="text-center text-xs text-muted-foreground">{rich(t("pro.note"))}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel className="min-w-0" title={t("pro.services.title")} icon={<ShieldCheck className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">{t("pro.services.lead")}</p>
          <ul className="divide-y divide-border">
            {REVIEW_SERVICES.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span>{t(`pro.services.${s.id}`)}</span>
                <span className="font-mono">{formatMinor(s.price, "RUB", locale)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("pro.services.note")}</p>
        </Panel>

        <Panel className="min-w-0" title={t("pro.onprem.title")} icon={<Landmark className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">{t("pro.onprem.lead")}</p>
          <ul className="divide-y divide-border">
            {ONPREM.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span>{t(row.key)}</span>
                <span className="text-right font-mono">
                  {row.price !== null && formatMinor(row.price, "RUB", locale)} <span className="text-xs text-muted-foreground">{t(row.unit)}</span>
                </span>
              </li>
            ))}
          </ul>
          <a href="mailto:sales@synapth.dev?subject=Synapth%20On-prem" className="inline-flex items-center gap-2 text-sm text-synapse hover:underline">
            <Building2 className="h-4 w-4" /> {t("pro.onprem.cta")}
          </a>
        </Panel>
      </div>

      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-3">
        {(["pay", "cancel", "vat"] as const).map((k) => (
          <div key={k} className="space-y-1.5">
            <h3 className="label-mono text-foreground">{t(`pro.faq.${k}.q`)}</h3>
            <p className="text-sm text-muted-foreground">{t(`pro.faq.${k}.a`)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
