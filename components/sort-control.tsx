"use client";

import { ChevronDown } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import { SORT_MODES } from "@/cortex/ranking";
import type { SortMode } from "@/types/skill";

interface Props {
  value: SortMode;
  onChange: (mode: SortMode) => void;
  className?: string;
  /** Show the Relevance option (only meaningful with a query). */
  showRelevance?: boolean;
}

/** Storefront sort as a mono select: Trending · Hidden Gems · Recently Added (+ Relevance with a query). */
export function SortControl({ value, onChange, className, showRelevance }: Props) {
  const { t } = useI18n();
  const modes: SortMode[] = showRelevance ? ["relevance", ...SORT_MODES.map((m) => m.value)] : SORT_MODES.map((m) => m.value);
  return (
    <label className={cn("inline-flex items-center gap-2", className)}>
      <span className="label-mono-sm hidden sm:inline">{t("sort.label")}</span>
      <span className="relative">
        <select
          aria-label={t("sort.aria")}
          value={value}
          onChange={(e) => onChange(e.target.value as SortMode)}
          className="h-8 appearance-none rounded-md border border-border bg-surface pl-2.5 pr-7 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground focus:bg-surface-high focus:outline-none"
        >
          {modes.map((m) => (
            <option key={m} value={m} title={t(`sort.hint.${m}`)}>
              {t(`sort.${m}`)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}
