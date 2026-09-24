"use client";

/**
 * ToastStack — renders `useToast()` cards top-right under the header.
 * Each toast is one row: tone glyph (or the actor's avatar), title + body,
 * and a button on the right — the toast's action, or "Got it" to dismiss.
 * The tone tints the glass; the button's backdrop drains over `duration`.
 */

import Link from "next/link";
import { AlertTriangle, Check, Info, Undo2, X, Zap } from "lucide-react";
import { useToastStack, type Toast, type ToastTone } from "@/axon/toast";
import { useI18n } from "@/axon/i18n";
import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/utils";

const SURFACE: Record<ToastTone, string> = {
  success: "border-synapse/25 [--toast-alpha:0.1] [--toast-tint:var(--synapse)]",
  social: "border-border",
  info: "border-border",
  warn: "border-warn/30 [--toast-alpha:0.12] [--toast-tint:var(--warn)]",
  danger: "border-danger/30 [--toast-alpha:0.16] [--toast-tint:var(--danger)]",
  undo: "border-border",
};

export function ToastStack() {
  const { toasts, dismiss } = useToastStack();
  const { t } = useI18n();
  if (!toasts.length) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[calc(100vw-2rem)] max-w-md flex-col gap-3">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} dismissLabel={t("toast.dismiss")} okLabel={t("toast.ok")} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss, dismissLabel, okLabel }: { toast: Toast; onDismiss: () => void; dismissLabel: string; okLabel: string }) {
  const { tone } = toast;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("toast-surface group pointer-events-auto relative flex items-center gap-3.5 rounded-2xl border py-3.5 pl-4 pr-3.5 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.9),inset_0_1px_0_hsl(var(--foreground)/0.05)] backdrop-blur-md animate-toast-in", SURFACE[tone])}>
      <ToneGlyph toast={toast} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-[15px] font-semibold leading-snug tracking-tight text-foreground">{toast.title}</span>
          {toast.tag && <span className={cn("label-mono-sm", tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger/80" : "text-synapse")}>{toast.tag}</span>}
        </div>
        {toast.body && <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{toast.body}</p>}
      </div>
      <ActionButton toast={toast} onDismiss={onDismiss} okLabel={okLabel} />
      {/* The action button leaves no other way out of a sticky toast — keep a close control reachable. */}
      {toast.action && (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-high text-muted-foreground opacity-0 shadow-lg transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function ToneGlyph({ toast }: { toast: Toast }) {
  switch (toast.tone) {
    case "social":
      return toast.actor ? (
        <span className="relative shrink-0">
          <Avatar author={toast.actor} size="md" className="rounded-full" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-surface-high">
            <Zap className="h-2.5 w-2.5 text-synapse" />
          </span>
        </span>
      ) : (
        <Zap className="h-6 w-6 shrink-0 text-synapse" />
      );
    case "success":
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-synapse text-synapse-foreground shadow-glow">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      );
    case "danger":
      return <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-danger text-sm font-bold text-white [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)]">!</span>;
    case "warn":
      return <AlertTriangle className="h-6 w-6 shrink-0 text-warn" />;
    case "undo":
      return <Undo2 className="h-6 w-6 shrink-0 text-muted-foreground" />;
    default:
      return <Info className="h-6 w-6 shrink-0 text-foreground" />;
  }
}

function ActionButton({ toast, onDismiss, okLabel }: { toast: Toast; onDismiss: () => void; okLabel: string }) {
  const className = cn(
    "relative inline-flex h-9 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-xl bg-foreground/[0.06] px-3.5 text-sm font-medium transition-colors hover:bg-foreground/[0.12]",
    toast.tone === "undo" ? "text-synapse" : "text-foreground",
  );
  // Lifetime indicator: a lighter wash inside the button that recedes to the left.
  const drain = toast.duration > 0 && <span aria-hidden className="absolute inset-y-0 left-0 bg-foreground/[0.06] animate-toast-drain" style={{ animationDuration: `${toast.duration}ms` }} />;
  const label = <span className="relative">{toast.action?.label ?? okLabel}</span>;

  if (toast.action?.href) {
    return (
      <Link href={toast.action.href} onClick={onDismiss} className={className}>
        {drain}
        {label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        toast.action?.onClick?.();
        onDismiss();
      }}
      className={className}
    >
      {drain}
      {label}
    </button>
  );
}
