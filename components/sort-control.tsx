"use client";

import { ChevronDown } from "lucide-react";
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

const LABELS: Record<SortMode, string> = {
  trending: "Trending (velocity × stars)",
  "hidden-gems": "Hidden gems (verified, retained)",
  recent: "Recently added",
  relevance: "Relevance (best match)",
};

/** Storefront sort as a mono select: Trending · Hidden Gems · Recently Added (+ Relevance with a query). */
export function SortControl({ value, onChange, className, showRelevance }: Props) {
  const modes = showRelevance ? [{ value: "relevance" as const, label: "Relevance", hint: "Best match for your query" }, ...SORT_MODES] : SORT_MODES;
  return (
    <label className={cn("inline-flex items-center gap-2", className)}>
      <span className="label-mono-sm">Sort:</span>
      <span className="relative">
        <select
          aria-label="Sort skills"
          value={value}
          onChange={(e) => onChange(e.target.value as SortMode)}
          className="h-8 appearance-none rounded-md border border-border bg-surface pl-2.5 pr-7 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground focus:bg-surface-high focus:outline-none"
        >
          {modes.map((m) => (
            <option key={m.value} value={m.value} title={m.hint}>
              {LABELS[m.value]}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}
