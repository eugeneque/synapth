import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Rectangular mono badges — see design.md §6. `verified` is the accent, `community` stays neutral. */
const badgeVariants = cva("inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[10px] font-medium uppercase leading-4 tracking-[0.08em] transition-colors", {
  variants: {
    variant: {
      default: "border-transparent bg-surface-high/60 text-secondary-foreground",
      outline: "border-border text-muted-foreground",
      /* Neutral chip on a recessed surface: `TARGET: CORTEX-R6`. */
      chip: "border-transparent bg-surface text-muted-foreground",
      synapse: "border-synapse/30 bg-synapse/10 text-synapse",
      /* Solid signal — the one loud badge, e.g. "VERIFIED AGENT KERNEL". */
      solid: "border-synapse bg-synapse text-synapse-foreground font-semibold",
      verified: "border-synapse/30 bg-synapse/10 text-synapse",
      community: "border-border bg-muted text-info",
      sandbox: "border-warn/30 bg-warn/10 text-warn",
      danger: "border-danger/30 bg-danger/10 text-danger",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
