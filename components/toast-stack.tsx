"use client";

/**
 * ToastStack — renders `useToast()` cards top-right under the header.
 * Tone decides the stripe / icon; the progress rule drains over `duration`.
 */

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Undo2, X, XCircle, Zap } from "lucide-react";
import { useToastStack, type Toast, type ToastTone } from "@/axon/toast";
import { useI18n } from "@/axon/i18n";
import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/utils";

const ICONS: Record<Exclude<ToastTone, "social" | "undo">, typeof Info> = { success: CheckCircle2, info: Info, warn: AlertTriangle, danger: XCircle };
const TITLE_TONE: Record<ToastTone, string> = { success: "text-foreground", social: "text-foreground", info: "text-foreground", warn: "text-warn", danger: "text-danger", undo: "text-foreground" };

export function ToastStack() {
  const { toasts, dismiss } = useToastStack();
  const { t } = useI18n();
  if (!toasts.length) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} dismissLabel={t("toast.dismiss")} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss, dismissLabel }: { toast: Toast; onDismiss: () => void; dismissLabel: string }) {
  const { tone } = toast;

  if (tone === "undo") {
    return (
      <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-high/95 px-4 py-3 shadow-2xl backdrop-blur-md animate-toast-in">
        <p className="flex min-w-0 items-center gap-2.5 text-xs text-foreground">
          <Undo2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{toast.title}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {toast.action && <ActionButton toast={toast} onDismiss={onDismiss} className="label-mono text-synapse hover:underline" />}
          <DismissButton onClick={onDismiss} label={dismissLabel} />
        </div>
      </div>
    );
  }

  const Icon = tone === "social" ? Zap : ICONS[tone];
  return (
    <div className={cn("pointer-events-auto relative overflow-hidden rounded-xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur-md animate-toast-in", tone === "success" && "border-synapse/30")}>
      {tone === "success" && <span className="absolute inset-x-0 top-0 h-1 bg-synapse" />}
      {tone === "warn" && <span className="absolute inset-y-0 left-0 w-1 bg-warn" />}
      {tone === "danger" && <span className="absolute inset-y-0 left-0 w-1 bg-danger" />}
      <div className={cn("flex items-start justify-between gap-3", tone === "success" && "pt-1")}>
        <div className="flex min-w-0 items-start gap-3">
          {tone === "social" && toast.actor ? (
            <span className="relative shrink-0">
              <Avatar author={toast.actor} size="sm" />
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface-lowest">
                <Zap className="h-2.5 w-2.5 text-synapse" />
              </span>
            </span>
          ) : (
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", tone === "success" || tone === "social" ? "bg-synapse/15 text-synapse" : tone === "warn" ? "bg-warn/15 text-warn" : tone === "danger" ? "bg-danger/15 text-danger" : "bg-surface-high text-muted-foreground")}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("text-sm font-semibold tracking-tight", TITLE_TONE[tone])}>{toast.title}</span>
              {toast.tag && <span className={cn("label-mono-sm", tone === "warn" ? "rounded bg-warn/10 px-1.5 text-warn" : tone === "danger" ? "text-danger/80" : "text-synapse")}>{toast.tag}</span>}
            </div>
            {toast.body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{toast.body}</p>}
          </div>
        </div>
        <DismissButton onClick={onDismiss} label={dismissLabel} />
      </div>
      {toast.action && (
        <div className="mt-3 flex items-center justify-end pl-10">
          <ActionButton toast={toast} onDismiss={onDismiss} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors", tone === "danger" ? "border-danger/30 text-danger hover:bg-danger/10" : "border-border bg-surface text-foreground hover:border-foreground/40")} />
        </div>
      )}
      {toast.duration > 0 && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-high">
          <div className={cn("h-full rounded-full animate-toast-drain", tone === "warn" ? "bg-warn" : tone === "danger" ? "bg-danger" : "bg-synapse")} style={{ animationDuration: `${toast.duration}ms` }} />
        </div>
      )}
    </div>
  );
}

function ActionButton({ toast, onDismiss, className }: { toast: Toast; onDismiss: () => void; className: string }) {
  const action = toast.action!;
  if (action.href) {
    return (
      <Link href={action.href} onClick={onDismiss} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        action.onClick?.();
        onDismiss();
      }}
      className={className}
    >
      {action.label}
    </button>
  );
}

function DismissButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
      <X className="h-4 w-4" />
    </button>
  );
}
