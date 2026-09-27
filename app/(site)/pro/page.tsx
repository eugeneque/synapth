import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import { ArrowRight, Cpu, FileOutput, KeyRound, Landmark, Lock, PackageCheck, ShieldCheck } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { currentPlanId } from "@/cortex/payments";
import { rich } from "@/lib/i18n/rich";
import { formatMinor } from "@/lib/money";
import { PricingPlans } from "@/components/pricing-plans";
import { TrustedMarquee } from "@/components/pricing/trusted-marquee";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { REVIEW_SERVICES } from "@/types/billing";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("pro.meta.title"), description: t("pro.meta.description") };
}

export const dynamic = "force-dynamic";

// The serif accent word in the titles, as on the home page. Italic only, Latin + Cyrillic.
const serif = Playfair_Display({ subsets: ["latin", "cyrillic"], weight: "400", style: "italic", variable: "--font-serif", display: "swap" });

/** On-prem price list (ТЗ §4.2), RUB minor units; starting hypotheses. */
const ONPREM = [
  { key: "pro.onprem.pilot", price: 300_000_00, unit: "pro.onprem.unit.once" },
  { key: "pro.onprem.standard", price: 1_200_000_00, unit: "pro.onprem.unit.year" },
  { key: "pro.onprem.users", price: 6_000_00, unit: "pro.onprem.unit.userYear" },
  { key: "pro.onprem.gov", price: 600_000_00, unit: "pro.onprem.unit.year" },
  { key: "pro.onprem.support", price: null, unit: "pro.onprem.unit.support" },
  { key: "pro.onprem.rollout", price: 150_000_00, unit: "pro.onprem.unit.from" },
] as const;

const ONPREM_FEATURES = [
  { key: "pro.onprem.feature.bundles", icon: PackageCheck },
  { key: "pro.onprem.feature.gov", icon: Landmark },
  { key: "pro.onprem.feature.perimeter", icon: Lock },
  { key: "pro.onprem.feature.ldap", icon: KeyRound },
  { key: "pro.onprem.feature.siem", icon: FileOutput },
  { key: "pro.onprem.feature.llm", icon: Cpu },
] as const;

/** Synapth Pro: SaaS plans, one-off reviews, then On-Premise with the «Trusted by» strip. */
export default async function ProPage() {
  const [{ t, locale }, session] = await Promise.all([getI18n(), auth()]);
  const current = session?.user?.id ? await currentPlanId(session.user.id) : null;

  return (
    <div className={serif.variable}>
      <div className="container space-y-10 py-10 md:py-16">
        <PricingPlans current={current} signedIn={Boolean(session?.user)} />
        <p className="text-center text-xs text-muted-foreground">{rich(t("pro.note"))}</p>
      </div>

      <section className="container grid grid-cols-1 gap-6 pb-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
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

        <div className="grid content-start gap-6 sm:grid-cols-1">
          {(["pay", "cancel", "vat"] as const).map((k) => (
            <div key={k} className="space-y-1.5 border-l-2 border-synapse/40 pl-4">
              <h3 className="label-mono text-foreground">{t(`pro.faq.${k}.q`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`pro.faq.${k}.a`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* On-Premise: its own band below the SaaS plans, closed by the «Trusted by» strip. */}
      <section id="on-premise" className="relative scroll-mt-20 overflow-hidden border-y border-border bg-card/60">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_80%_at_20%_20%,#000,transparent)]" aria-hidden />
        <div className="container relative grid grid-cols-1 gap-10 py-16 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="label-mono flex items-center gap-2 text-synapse">
                <Landmark className="h-4 w-4" /> {t("pro.onprem.eyebrow")}
              </p>
              <h2 className="pro-title font-display text-4xl font-medium leading-[1] tracking-[-0.03em] sm:text-5xl lg:text-6xl">{rich(t("pro.onprem.title"))}</h2>
              <p className="max-w-xl text-muted-foreground">{t("pro.onprem.lead")}</p>
            </div>

            <ul className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ONPREM_FEATURES.map(({ key, icon: Icon }) => (
                <li key={key} className="lift flex items-center gap-3 rounded-xl border border-border bg-background/60 px-4 py-3 text-sm">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-synapse/10 text-synapse ring-1 ring-synapse/25">
                    <Icon className="h-4 w-4" />
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>

            <Button asChild size="hero">
              <a href="mailto:sales@synapth.dev?subject=Synapth%20On-Premise">
                {t("pro.onprem.cta")} <ArrowRight />
              </a>
            </Button>
          </div>

          <div className="self-start rounded-2xl border border-border bg-background/80 p-6 backdrop-blur-sm">
            <p className="label-mono mb-3 text-foreground">{t("pro.onprem.prices")}</p>
            <ul className="divide-y divide-border">
              {ONPREM.map((row) => (
                <li key={row.key} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                  <span>{t(row.key)}</span>
                  <span className="shrink-0 text-right font-mono">
                    {row.price !== null && formatMinor(row.price, "RUB", locale)} <span className="block text-[11px] text-muted-foreground">{t(row.unit)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative border-t border-border py-10">
          <div className="container mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="label-mono text-foreground">{t("pro.trusted.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("pro.trusted.lead")}</p>
          </div>
          <TrustedMarquee label={t("pro.trusted.title")} />
        </div>
      </section>
    </div>
  );
}
