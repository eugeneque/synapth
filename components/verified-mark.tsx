"use client";

/** The account check mark next to a verified developer's name. */

import { BadgeCheck } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";

const SIZES = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-6 w-6" } as const;

export function VerifiedMark({ size = "md", className }: { size?: keyof typeof SIZES; className?: string }) {
  const { t } = useI18n();
  return (
    <span role="img" aria-label={t("verify.mark")} title={t("verify.mark")} className={cn("group/mark relative inline-flex shrink-0 animate-pop-in items-center justify-center text-synapse", className)}>
      <BadgeCheck className={cn(SIZES[size], "fill-synapse/15 drop-shadow-[0_0_6px_hsl(var(--synapse)/0.55)] transition-transform duration-300 group-hover/mark:rotate-12 group-hover/mark:scale-110")} />
    </span>
  );
}
