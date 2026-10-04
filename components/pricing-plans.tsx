"use client";

/**
 * Synapth Pro plans (ТЗ §4.1): the period switch, the Pro showcase and the
 * other plans. Every card opens on click — the details grow out of it with
 * a height + stagger animation — so the grid stays short until someone asks
 * «what's inside». Pro is the loud one: the full-width card on an aurora
 * frame with its own «Free → Pro» comparison.
 */

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from "motion/react";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Crown,
  FileOutput,
  Fingerprint,
  Gauge,
  GitPullRequest,
  KeyRound,
  Library,
  LogIn,
  PackageOpen,
  Receipt,
  Scale,
  ScrollText,
  Server,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMinor } from "@/lib/money";
import { rich } from "@/lib/i18n/rich";
import { cn } from "@/lib/utils";
import { isUnlimited, PLANS, type BillingPeriod, type PlanId, type PlanLimits } from "@/types/billing";
import type { UiKey } from "@/lib/i18n";

/** Advantages each card reveals; copy lives under `pro.why.<plan>.<id>.title|body`. */
const DETAILS: Record<PlanId, { id: string; icon: LucideIcon }[]> = {
  pro: [
    { id: "keys", icon: KeyRound },
    { id: "requests", icon: Gauge },
    { id: "packs", icon: PackageOpen },
    { id: "ci", icon: GitPullRequest },
    { id: "audit", icon: ScrollText },
    { id: "mark", icon: Crown },
  ],
  free: [
    { id: "catalog", icon: Library },
    { id: "publish", icon: ShieldCheck },
    { id: "key", icon: KeyRound },
    { id: "audit", icon: ScrollText },
  ],
  team: [
    { id: "org", icon: Users },
    { id: "policies", icon: Scale },
    { id: "approvals", icon: ClipboardCheck },
    { id: "sso", icon: LogIn },
  ],
  business: [
    { id: "dedicated", icon: Server },
    { id: "sla", icon: Activity },
    { id: "saml", icon: Fingerprint },
    { id: "siem", icon: FileOutput },
  ],
};

const EXTRA: Record<PlanId, UiKey[]> = {
  free: ["pro.f.catalog", "pro.f.publish"],
  pro: ["pro.f.policies", "pro.f.ci"],
  team: ["pro.f.org", "pro.f.orgPolicies", "pro.f.approvals", "pro.f.sso"],
  business: ["pro.f.dedicated", "pro.f.sla", "pro.f.saml", "pro.f.siem", "pro.f.priority"],
};

const OTHERS: PlanId[] = ["free", "team", "business"];
const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Clicks on links and buttons inside a card do their own thing; anywhere else toggles it. */
const fromControl = (e: MouseEvent) => Boolean((e.target as HTMLElement).closest("a, button, input, select, label"));

interface Props {
  current: PlanId | null;
  signedIn: boolean;
}

export function PricingPlans({ current, signedIn }: Props) {
  const { t, n, locale } = useI18n();
  const reduced = useReducedMotion();
  const [period, setPeriod] = useState<BillingPeriod>("year");
  const [open, setOpen] = useState<PlanId | null>(null);
  const toggle = (id: PlanId) => setOpen((v) => (v === id ? null : id));
  const fmt = (v: number) => new Intl.NumberFormat(locale).format(v);

  const reveal: Transition = reduced ? { duration: 0 } : { duration: 0.5, ease: EASE };
  const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : 0.06, delayChildren: reduced ? 0 : 0.12 } } };
  const item: Variants = reduced
    ? { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 14, filter: "blur(4px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.4, ease: EASE } } };

  const href = (id: PlanId) => {
    const p = PLANS[id].price[period] === null ? "month" : period;
    if (id === "free") return signedIn ? "/dashboard/billing" : "/signup";
    return signedIn ? `/dashboard/billing?plan=${id}&period=${p}#change` : `/signin?callbackUrl=${encodeURIComponent(`/dashboard/billing?plan=${id}&period=${p}`)}`;
  };

  const priceOf = (id: PlanId) => PLANS[id].price[period] ?? PLANS[id].price.month ?? 0;
  const unitOf = (id: PlanId) => {
    const plan = PLANS[id];
    if (priceOf(id) === 0) return t("pro.forever");
    if (plan.perSeat) return t(`pro.perSeat.${period}`, { n: plan.minSeats });
    if (id === "business") return t("pro.perMonth");
    return t(`pro.per.${period}`);
  };

  const featureList = (id: PlanId): ReactNode[] => {
    const l = PLANS[id].limits;
    return [
      n("pro.f.keys", l.keys),
      isUnlimited(l.requestsPerDay) ? t("pro.f.requestsUnlimited") : t("pro.f.requests", { n: fmt(l.requestsPerDay), r: fmt(l.resolvePerDay) }),
      l.privatePacks === null ? t("pro.f.packsUnlimited") : n("pro.f.packs", l.privatePacks),
      ...(l.ciRepos > 0 ? [isUnlimited(l.ciRepos) ? t("pro.f.ciUnlimited") : n("pro.f.ciRepos", l.ciRepos)] : []),
      n("pro.f.audit", l.auditDays),
      isUnlimited(l.cliInstallsPerDay) ? t("pro.f.cliUnlimited") : t(l.cliBulk ? "pro.f.cliBulk" : "pro.f.cli", { d: fmt(l.cliDevices), n: fmt(l.cliInstallsPerDay) }),
      ...EXTRA[id].map((key) => t(key)),
    ];
  };

  const detailParams = (l: PlanLimits) => {
    const free = PLANS.free.limits;
    return {
      keys: l.keys,
      requests: fmt(l.requestsPerDay),
      resolve: fmt(l.resolvePerDay),
      packs: l.privatePacks ?? "∞",
      ci: l.ciRepos,
      audit: l.auditDays,
      freeRequests: fmt(free.requestsPerDay),
      freeAudit: free.auditDays,
      x: Math.round(l.requestsPerDay / free.requestsPerDay),
    };
  };

  const details = (id: PlanId, className: string, cardClassName: string) => {
    const params = detailParams(PLANS[id].limits);
    return (
      <motion.ul variants={list} initial="hidden" animate="shown" className={className}>
        {DETAILS[id].map(({ id: key, icon: Icon }) => (
          <motion.li key={key} variants={item} className={cn("flex gap-3 rounded-xl border p-4", cardClassName)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-synapse/15 text-synapse ring-1 ring-synapse/30">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-semibold tracking-tight text-foreground">{t(`pro.why.${id}.${key}.title` as UiKey, params)}</span>
              <span className="block text-[13px] leading-relaxed text-muted-foreground">{t(`pro.why.${id}.${key}.body` as UiKey, params)}</span>
            </span>
          </motion.li>
        ))}
      </motion.ul>
    );
  };

  const pro = PLANS.pro;
  const proPrice = priceOf("pro");
  const proOpen = open === "pro";

  return (
    <div className="space-y-12">
      <header className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl space-y-4">
          <p className="label-mono text-synapse">{t("pro.eyebrow")}</p>
          <h1 className="pro-title font-display text-5xl font-medium leading-[0.95] tracking-[-0.035em] sm:text-6xl lg:text-7xl">{rich(t("pro.title"))}</h1>
          <p className="max-w-xl text-muted-foreground">{t("pro.lead")}</p>
        </div>
        <PeriodSwitch period={period} setPeriod={setPeriod} label={t("pro.period")} labels={{ month: t("pro.period.month"), year: t("pro.period.year") }} save={t("pro.yearSave")} />
      </header>

      {/* ---------------------------------------------------------------- Pro */}
      <section
        onClick={(e) => !fromControl(e) && toggle("pro")}
        className={cn("pro-aurora group relative cursor-pointer overflow-hidden rounded-3xl p-2 sm:p-3", proOpen && "pro-aurora-open")}
        aria-labelledby="plan-pro-title"
      >
        <div className="relative grid gap-6 rounded-[18px] border border-white/5 bg-background/85 p-6 backdrop-blur-sm sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-7">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="plan-pro-title" className="pro-mark inline-flex h-7 items-center rounded-md px-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.16em]">
                {t("pro.plan.pro")}
              </h2>
              {current === "pro" ? <Badge variant="chip">{t("pro.current")}</Badge> : <Badge variant="synapse">{t("pro.popular")}</Badge>}
            </div>

            <p className="max-w-xl font-display text-3xl font-medium leading-[1.1] tracking-tight sm:text-4xl">
              <span className="text-muted-foreground">{t("pro.hero.kicker")}</span>
              <br />
              {t("pro.hero.for")}
            </p>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div>
                <p className="flex items-baseline gap-2">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={period}
                      initial={reduced ? false : { y: 18, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={reduced ? undefined : { y: -18, opacity: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="font-display text-5xl font-medium tracking-tight tabular-nums sm:text-6xl"
                    >
                      {formatMinor(proPrice, "RUB", locale)}
                    </motion.span>
                  </AnimatePresence>
                  <span className="text-sm text-muted-foreground">/ {unitOf("pro")}</span>
                </p>
                {period === "year" && pro.price.year !== null && <p className="mt-1 font-mono text-xs text-synapse">{t("pro.hero.monthly", { price: formatMinor(Math.round(pro.price.year / 12 / 100) * 100, "RUB", locale) })}</p>}
              </div>
              {current === "pro" ? (
                <Button size="hero" variant="mono" disabled>
                  {t("pro.current")}
                </Button>
              ) : (
                <Button asChild size="hero" className="shadow-[0_18px_40px_-14px_hsl(var(--synapse)/0.8)]">
                  <Link href={href("pro")}>
                    {t("pro.cta.buy", { plan: t("pro.plan.pro") })} <ArrowRight />
                  </Link>
                </Button>
              )}
            </div>
          </div>

          <aside className="flex flex-col justify-between gap-4 rounded-2xl border border-border bg-muted/60 p-5">
            <div className="space-y-2">
              <Receipt className="h-5 w-5 text-synapse" />
              <p className="text-sm font-semibold">{t("pro.hero.invoice.title")}</p>
              <p className="text-[13px] text-muted-foreground">{t("pro.hero.invoice.body")}</p>
            </div>
            <Button asChild variant="mono" className="w-full">
              <a href="mailto:sales@synapth.dev?subject=Synapth%20Pro%20invoice">{t("pro.hero.invoice.cta")}</a>
            </Button>
          </aside>
        </div>

        <div className="relative px-4 pb-3 pt-6 sm:px-6">
          <ul className="grid grid-cols-1 gap-x-10 gap-y-3 text-[14px] text-foreground/90 sm:grid-cols-2 lg:grid-cols-3">
            {featureList("pro").map((f, i) => (
              <li key={i} className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />
                {f}
              </li>
            ))}
          </ul>

          <AnimatePresence initial={false}>
            {proOpen && (
              <motion.div key="pro-details" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reveal} className="overflow-hidden">
                <div className="grid gap-6 pt-8 lg:grid-cols-[minmax(0,1fr)_340px]">
                  {details("pro", "grid grid-cols-1 gap-3 sm:grid-cols-2", "border-white/10 bg-background/70 backdrop-blur-sm")}
                  <Compare reduced={Boolean(reduced)} fmt={fmt} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => toggle("pro")}
              aria-expanded={proOpen}
              className="inline-flex items-center gap-2 rounded-full border border-synapse/40 bg-background/70 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-synapse backdrop-blur-sm transition-colors hover:bg-synapse hover:text-synapse-foreground"
            >
              {proOpen ? t("pro.hero.less") : t("pro.hero.more")}
              <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", proOpen && "rotate-180")} />
            </button>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Others */}
      <section className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label-mono text-foreground">{t("pro.others")}</h2>
          <p className="text-xs text-muted-foreground">{t("pro.others.lead")}</p>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
          {OTHERS.map((id) => {
            const plan = PLANS[id];
            const price = priceOf(id);
            const isOpen = open === id;
            const features = featureList(id);
            return (
              <motion.article
                key={id}
                onClick={(e) => !fromControl(e) && toggle(id)}
                whileHover={reduced || isOpen ? undefined : { y: -3 }}
                transition={{ duration: 0.25, ease: EASE }}
                className={cn("flex cursor-pointer flex-col gap-5 rounded-2xl border bg-card p-5 transition-[border-color,box-shadow] duration-300", isOpen ? "border-synapse/50 shadow-[0_24px_60px_-28px_hsl(var(--synapse)/0.6)]" : "border-border hover:border-foreground/20")}
                aria-labelledby={`plan-${id}-title`}
              >
                <header className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`plan-${id}-title`} className="label-mono text-foreground">
                      {t(`pro.plan.${id}`)}
                    </h3>
                    {current === id && <Badge variant="chip">{t("pro.current")}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{t(`pro.plan.${id}.for`)}</p>
                </header>

                <div className="space-y-1">
                  <p className="flex items-baseline gap-1.5">
                    {id === "business" && <span className="text-sm text-muted-foreground">{t("pro.from")}</span>}
                    <span className="stat-value">{price === 0 ? t("common.free") : formatMinor(price, "RUB", locale)}</span>
                  </p>
                  <p className="label-mono-sm normal-case tracking-normal">{unitOf(id)}</p>
                </div>

                <ul className="flex flex-col gap-2 text-[13px]">
                  {(isOpen ? features : features.slice(0, 3)).map((f, i) => (
                    <motion.li key={i} initial={i >= 3 && !reduced ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />
                      {f}
                    </motion.li>
                  ))}
                </ul>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div key="details" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reveal} className="overflow-hidden">
                      {details(id, "space-y-2.5", "border-border bg-muted/50")}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="mt-auto flex items-center gap-2">
                  {current === id ? (
                    <Button variant="mono" disabled className="flex-1">
                      {t("pro.current")}
                    </Button>
                  ) : plan.selfServe ? (
                    <Button asChild variant="mono" className="flex-1">
                      <Link href={href(id)}>{id === "free" ? t("pro.cta.free") : t("pro.cta.buy", { plan: t(`pro.plan.${id}`) })}</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="mono" className="flex-1">
                      <a href="mailto:sales@synapth.dev?subject=Synapth%20Business">{t("pro.cta.sales")}</a>
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? t("pro.details.hide") : t("pro.details")}
                    title={isOpen ? t("pro.details.hide") : t("pro.details")}
                    className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors", isOpen ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", isOpen && "rotate-180")} />
                  </button>
                </div>
              </motion.article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Month / year pill; the highlight slides between the options. */
function PeriodSwitch({ period, setPeriod, label, labels, save }: { period: BillingPeriod; setPeriod: (p: BillingPeriod) => void; label: string; labels: Record<BillingPeriod, string>; save: string }) {
  return (
    <div role="tablist" aria-label={label} className="relative inline-flex self-start rounded-xl border border-border bg-muted p-1 md:self-auto">
      {(["month", "year"] as const).map((p) => (
        <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={cn("relative z-10 rounded-lg px-5 py-2 text-sm transition-colors", period === p ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {period === p && <motion.span layoutId="period-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 -z-10 rounded-lg border border-border bg-card shadow-sm" />}
          {labels[p]}
          {p === "year" && <span className="ml-2 font-mono text-[11px] text-synapse">{save}</span>}
        </button>
      ))}
    </div>
  );
}

/** «Free → Pro»: each limit as two bars, Pro's filling to the edge. */
function Compare({ reduced, fmt }: { reduced: boolean; fmt: (v: number) => string }) {
  const { t } = useI18n();
  const free = PLANS.free.limits;
  const pro = PLANS.pro.limits;
  const rows: { key: UiKey; from: number | null; to: number | null }[] = [
    { key: "pro.compare.keys", from: free.keys, to: pro.keys },
    { key: "pro.compare.requests", from: free.requestsPerDay, to: pro.requestsPerDay },
    { key: "pro.compare.resolve", from: free.resolvePerDay, to: pro.resolvePerDay },
    { key: "pro.compare.packs", from: free.privatePacks, to: pro.privatePacks },
    { key: "pro.compare.ci", from: free.ciRepos, to: pro.ciRepos },
    { key: "pro.compare.audit", from: free.auditDays, to: pro.auditDays },
    { key: "pro.compare.cli", from: free.cliInstallsPerDay, to: pro.cliInstallsPerDay },
  ];
  const show = (v: number | null) => (v === null || isUnlimited(v) ? "∞" : fmt(v));
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: reduced ? 0 : 0.2, ease: EASE }}
      className="space-y-4 rounded-2xl border border-white/10 bg-background/70 p-5 backdrop-blur-sm"
    >
      <p className="label-mono text-foreground">{t("pro.compare.title")}</p>
      <ul className="space-y-3.5">
        {rows.map((r, i) => {
          const ratio = r.to === null || r.from === null ? (r.from === null ? 1 : 0.08) : Math.max(0.04, r.from / r.to);
          return (
            <li key={r.key} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{t(r.key)}</span>
                <span className="font-mono tabular-nums">
                  <span className="text-muted-foreground">{show(r.from)}</span>
                  <span className="mx-1.5 text-muted-foreground/60">→</span>
                  <span className="font-semibold text-synapse">{show(r.to)}</span>
                </span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full bg-synapse shadow-[0_0_10px_hsl(var(--synapse)/0.7)]"
                  initial={reduced ? false : { width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 0.8, delay: reduced ? 0 : 0.3 + i * 0.07, ease: EASE }}
                />
                <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/60" style={{ width: `${ratio * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}
