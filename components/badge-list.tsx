import { Activity, CloudLightning, Crown, Heart, Hexagon, Hourglass, Layers, MessageSquare, Rocket, Sprout, Users, Zap } from "lucide-react";
import type { Translator, UiKey } from "@/lib/i18n";
import type { AwardedBadge } from "@/cortex/badges";
import { BADGES, type BadgeDefinition, type BadgeTier } from "@/types/badges";
import { cn } from "@/lib/utils";

const ICONS: Record<BadgeDefinition["icon"], typeof Rocket> = { rocket: Rocket, "message-square": MessageSquare, layers: Layers, heart: Heart, sprout: Sprout, crown: Crown, hourglass: Hourglass, users: Users, hexagon: Hexagon, zap: Zap, activity: Activity, "cloud-lightning": CloudLightning };

/** Medal ring (gradient border), glyph colour and card wash per tier. */
const TIER: Record<BadgeTier, { ring: string; glyph: string; card: string }> = {
  bronze: {
    ring: "from-[hsl(28_55%_62%)] via-[hsl(24_40%_38%)] to-[hsl(30_60%_68%)]",
    glyph: "text-[hsl(26_55%_58%)]",
    card: "border-border bg-surface/60",
  },
  silver: {
    ring: "from-[hsl(220_12%_86%)] via-[hsl(220_8%_52%)] to-[hsl(220_14%_80%)]",
    glyph: "text-foreground/80",
    card: "border-foreground/15 bg-surface/60",
  },
  gold: {
    ring: "from-warn via-[hsl(38_70%_38%)] to-warn",
    glyph: "text-warn",
    card: "border-warn/30 bg-gradient-to-br from-warn/[0.07] to-transparent",
  },
  signal: {
    ring: "from-synapse via-synapse-dim to-synapse",
    glyph: "text-synapse",
    card: "border-synapse/35 bg-gradient-to-br from-synapse/[0.08] to-transparent",
  },
  astra: {
    ring: "from-synapse via-warn to-synapse",
    glyph: "text-warn",
    card: "border-warn/40 bg-gradient-to-r from-synapse/[0.12] via-surface/60 to-warn/[0.12] shadow-[0_0_18px_hsl(var(--warn)/0.18)]",
  },
};

/** Round badge artwork in a tier-coloured ring; falls back to the Lucide glyph until `def.image` exists. */
export function BadgeMedal({ def, size = "md", className }: { def: BadgeDefinition; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = ICONS[def.icon];
  const tier = TIER[def.tier];
  return (
    <span className={cn("relative grid shrink-0 place-items-center rounded-full bg-gradient-to-br p-[2px]", tier.ring, size === "sm" ? "h-8 w-8" : size === "md" ? "h-12 w-12" : "h-16 w-16", className)}>
      <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-surface-lowest">
        {def.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- static artwork from /public, no optimisation needed
          <img src={def.image} alt="" className="h-full w-full object-contain p-[12%]" draggable={false} />
        ) : (
          <Icon className={cn(tier.glyph, size === "sm" ? "h-4 w-4" : size === "md" ? "h-5 w-5" : "h-7 w-7")} strokeWidth={1.75} />
        )}
      </span>
    </span>
  );
}

const order = (b: AwardedBadge) => BADGES.findIndex((d) => d.id === b.badgeId);

/** Achievement cards, in catalogue order; server component, so it takes the translator and locale explicitly. */
export function BadgeList({ badges, t, locale, className }: { badges: AwardedBadge[]; t: Translator<UiKey>["t"]; locale: string; className?: string }) {
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <ul className={cn("grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {[...badges].sort((a, b) => order(a) - order(b)).map((b) => {
        const title = t(`badge.${b.badgeId}.title` as UiKey);
        const body = t(`badge.${b.badgeId}.body` as UiKey);
        const earned = t("profile.badge.earned", { date: date.format(new Date(b.awardedAt)) });
        const tier = TIER[b.def.tier];
        if (b.def.motto) {
          return (
            <li key={b.badgeId} className={cn("lift relative flex items-center gap-4 overflow-hidden rounded-xl border p-4 sm:col-span-2 xl:col-span-3", tier.card)}>
              <BadgeMedal def={b.def} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 font-display text-sm italic text-muted-foreground">{body}</p>
              </div>
              <span className="label-mono-sm hidden shrink-0 normal-case tracking-normal sm:block">{earned}</span>
            </li>
          );
        }
        return (
          <li key={b.badgeId} title={earned} className={cn("lift relative flex items-center gap-3 rounded-xl border p-3", tier.card)}>
            <BadgeMedal def={b.def} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{body}</p>
              <p className="label-mono-sm mt-1 normal-case tracking-normal">{earned}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
