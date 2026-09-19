import type { ReactNode } from "react";
import { Corners } from "@/components/corners";
import { cn } from "@/lib/utils";

interface Props {
  title?: ReactNode;
  /** Small mono note next to the title (`cortex/billing.ts`, counts …). */
  meta?: ReactNode;
  /** Right-aligned header content. */
  actions?: ReactNode;
  /** Leading glyph in the header: a live dot by default, or a lucide icon. */
  icon?: ReactNode;
  corners?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Optional recessed footer strip. */
  footer?: ReactNode;
  id?: string;
  children: ReactNode;
}

/** Bordered surface with a recessed mono title strip. The building block of every page. */
export function Panel({ title, meta, actions, icon, corners = false, className, bodyClassName, footer, id, children }: Props) {
  return (
    <section id={id} className={cn("group relative flex flex-col border border-border bg-card", className)}>
      {corners && <Corners hover />}
      {(title || actions) && (
        <header className="panel-head">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon === undefined ? <span className="dot-live shrink-0" /> : icon}
            {title && <h3 className="label-mono truncate text-foreground">{title}</h3>}
            {meta && <span className="label-mono-sm hidden normal-case tracking-normal sm:inline">{meta}</span>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
      {footer && <footer className="label-mono-sm flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-low/60 px-4 py-2">{footer}</footer>}
    </section>
  );
}

/** Key figure with a blinking cursor, used in rows separated by `divide-x`. */
export function StatTile({ label, value, hint, unit, tag, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; unit?: ReactNode; tag?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-accent/40", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="label-mono">{label}</span>
        {tag}
      </div>
      <span className="flex items-baseline gap-1.5">
        <span className="cursor stat-value">{value}</span>
        {unit && <span className="label-mono text-synapse">{unit}</span>}
      </span>
      {hint && <span className="label-mono-sm">{hint}</span>}
    </div>
  );
}
