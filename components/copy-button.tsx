"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  label?: string;
  doneLabel?: string;
  className?: string;
  /** Icon-only, for tight rows. */
  compact?: boolean;
}

/** Copies `text` to the clipboard and flashes a mono "COPIED" confirmation. */
export function CopyButton({ text, label = "Copy", doneLabel = "Copied", className, compact }: Props) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      aria-label={compact ? label : undefined}
      className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground", done && "text-synapse hover:text-synapse", className)}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {!compact && (done ? doneLabel : label)}
    </button>
  );
}

/** `$ command` chip with a trailing copy glyph — the hero quick-start line. */
export function CommandChip({ command, className }: { command: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* ignore */
    }
  };
  return (
    <button type="button" onClick={copy} className={cn("group inline-flex h-11 w-full min-w-0 max-w-full items-center gap-2 rounded-md sm:w-auto border border-border bg-surface/80 px-4 font-mono text-xs text-foreground backdrop-blur-sm transition-colors hover:border-foreground/25", className)}>
      <span className="select-none text-synapse">$</span>
      <span className="min-w-0 flex-1 truncate text-left sm:flex-none">{command}</span>
      {done ? <Check className="h-4 w-4 shrink-0 text-synapse" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />}
      <span className={cn("label-mono-sm text-synapse transition-opacity", done ? "opacity-100" : "hidden")}>Copied</span>
    </button>
  );
}
