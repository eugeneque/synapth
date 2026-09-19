"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FacetOption {
  value: string;
  label?: ReactNode;
  count?: number;
  /** Trailing badge instead of a count. */
  tag?: ReactNode;
}

interface Props {
  title: string;
  icon?: ReactNode;
  options: FacetOption[];
  active: string | null;
  onToggle: (value: string | null) => void;
  mono?: boolean;
  /** Text under the title, e.g. "1 selected". */
  note?: ReactNode;
}

/** Sidebar facet: square 14px checkboxes, one active value per group, counts on the right. */
export function FacetGroup({ title, icon, options, active, onToggle, mono, note }: Props) {
  if (!options.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="label-mono font-semibold text-foreground">{title}</span>
        {note ?? (icon && <span className="text-muted-foreground">{icon}</span>)}
      </div>
      <ul className="flex flex-col gap-1.5">
        {options.map((o) => {
          const isActive = active?.toLowerCase() === o.value.toLowerCase();
          return (
            <li key={o.value}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isActive}
                onClick={() => onToggle(isActive ? null : o.value)}
                className="group flex w-full items-center justify-between gap-3 text-left text-sm text-foreground"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-md border transition-colors", isActive ? "border-synapse bg-synapse text-synapse-foreground" : "border-border bg-muted group-hover:border-foreground/40")}>
                    {isActive && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className={cn("truncate transition-colors group-hover:text-synapse", mono && "font-mono text-xs", isActive && "text-foreground")}>{o.label ?? o.value}</span>
                </span>
                {o.tag ?? (typeof o.count === "number" && <span className="label-mono-sm shrink-0">{o.count.toLocaleString("en")}</span>)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
