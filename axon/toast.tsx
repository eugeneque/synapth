"use client";

/**
 * Axon · HUD toasts
 *
 * Transient cards stacked top-right under the header, after the Stitch
 * "Notification Design & Toast System" spec: a synapse stripe on top for
 * success, a warn / danger stripe on the left, an avatar for social pings,
 * a compact undo bar, and a progress rule that drains while the toast lives.
 * `useToast()` is the only API; the stack renders itself inside the provider.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AuthorRef } from "@/types/social";

export type ToastTone = "success" | "social" | "info" | "warn" | "danger" | "undo";

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  body?: ReactNode;
  /** Small mono tag next to the title (`LIVE`, `ERR_504`, `85% CAP`). */
  tag?: string;
  /** Social toasts show the actor's avatar instead of a tone icon. */
  actor?: AuthorRef | null;
  action?: { label: string; onClick?: () => void; href?: string };
  /** ms; 0 keeps the toast until dismissed. */
  duration?: number;
}

export interface Toast extends ToastInput {
  id: number;
  tone: ToastTone;
  duration: number;
  createdAt: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastTone, number> = { success: 5000, social: 7000, info: 6000, warn: 8000, danger: 0, undo: 6000 };
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      const tone = input.tone ?? "info";
      const duration = input.duration ?? DEFAULT_DURATION[tone];
      setToasts((list) => [...list, { ...input, id, tone, duration, createdAt: Date.now() }].slice(-MAX_VISIBLE));
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): Pick<ToastContextValue, "toast" | "dismiss"> {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used inside <ToastProvider>");
  return ctx;
}

/** Read access for the stack component. */
export function useToastStack(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToastStack() must be used inside <ToastProvider>");
  return ctx;
}
