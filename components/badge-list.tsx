import { Award, Bolt, Eye, Flag, Github, Layers, MessageSquare, MessagesSquare, Radio, ShieldCheck, Sparkles, Wrench, Zap } from "lucide-react";
import type { Translator, UiKey } from "@/lib/i18n";
import type { AwardedBadge } from "@/cortex/badges";
import type { BadgeDefinition, BadgeTier } from "@/types/badges";
import { cn } from "@/lib/utils";

const ICONS: Record<BadgeDefinition["icon"], typeof Award> = { layers: Layers, "shield-check": ShieldCheck, bolt: Bolt, sparkles: Sparkles, wrench: Wrench, github: Github, "message-square": MessageSquare, "messages-square": MessagesSquare, zap: Zap, radio: Radio, eye: Eye, award: Award, flag: Flag };

const TIER: Record<BadgeTier, string> = {
  bronze: "border-border bg-surface text-muted-foreground",
  silver: "border-foreground/25 bg-surface text-foreground",
  gold: "border-warn/40 bg-warn/10 text-warn",
  signal: "border-synapse/40 bg-synapse/10 text-synapse",
};

/** Achievement chips; server component, so it takes the translator explicitly. */
export function BadgeList({ badges, t, className }: { badges: AwardedBadge[]; t: Translator<UiKey>["t"]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {badges.map((b) => {
        const Icon = ICONS[b.def.icon];
        return (
          <span key={b.badgeId} title={t(`badge.${b.badgeId}.body` as UiKey)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px]", TIER[b.def.tier])}>
            <Icon className="h-3.5 w-3.5" /> {t(`badge.${b.badgeId}.title` as UiKey)}
          </span>
        );
      })}
    </div>
  );
}
