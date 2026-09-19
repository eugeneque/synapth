import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

interface Line {
  text: string;
  tone?: "comment" | "command" | "accent" | "output";
}

const TONE: Record<NonNullable<Line["tone"]>, string> = {
  comment: "text-muted-foreground",
  command: "text-foreground",
  accent: "text-synapse font-medium",
  output: "text-muted-foreground",
};

/** Faux terminal window: traffic lights, title, mono lines, optional copy strip. */
export function TerminalCard({ title, lines, copy, className, footer }: { title: string; lines: Line[]; copy?: string; className?: string; footer?: ReactNode }) {
  return (
    <div className={cn("border border-border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-synapse/80" />
        </span>
        <span className="label-mono-sm">{title}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-6">
        {lines.map((l, i) => (
          <div key={i} className={TONE[l.tone ?? "command"]}>
            {l.text}
          </div>
        ))}
      </pre>
      {(copy || footer) && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-low/60 px-4 py-2">
          {footer ?? <span />}
          {copy && <CopyButton text={copy} label="Copy install command" />}
        </div>
      )}
    </div>
  );
}
