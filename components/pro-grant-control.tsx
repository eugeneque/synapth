"use client";

/**
 * ProGrantControl — the admin's per-row Synapth Pro switch in
 * /dashboard/admin/users: grant for a number of months, extend a live grant,
 * or end it. Paid subscriptions are shown but never touched from here.
 */

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Crown, Loader2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { changeProGrant } from "@/app/(site)/moderation-actions";
import { formatSince } from "@/components/pro-mark";
import { cn } from "@/lib/utils";
import { PRO_GRANT_MONTHS, type ProGrantMonths } from "@/types/billing";
import type { ProGrantState } from "@/cortex/pro-grants";

export function ProGrantControl({ userId, handle, initial }: { userId: string; handle: string; initial: ProGrantState }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<ProGrantMonths>(12);
  const [pending, start] = useTransition();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const paid = state.active && !state.granted;

  // The panel is portalled to <body> with fixed positioning: the users table
  // card clips overflow, so an absolutely positioned panel got cut off.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const btn = trigger.current?.getBoundingClientRect();
      if (!btn) return;
      const gap = 8;
      const width = panel.current?.offsetWidth ?? 288;
      const height = panel.current?.offsetHeight ?? 0;
      const up = btn.bottom + gap + height > window.innerHeight && btn.top - gap - height > 0;
      const left = Math.min(Math.max(gap, btn.right - width), window.innerWidth - width - gap);
      setPos({ top: up ? btn.top - gap - height : btn.bottom + gap, left });
    };
    place();
    // Second pass once the panel has its real height.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, state, pending]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function apply(next: ProGrantMonths | null) {
    if (next === null && !window.confirm(t("users.pro.revokeConfirm", { handle }))) return;
    start(async () => {
      const res = await changeProGrant(userId, handle, next);
      if (!res.ok) {
        toast({ tone: "danger", title: t("users.failed"), body: res.error });
        return;
      }
      setState(res.data);
      setOpen(false);
      toast({ tone: "success", title: res.data.active && res.data.until ? t("users.pro.granted", { handle, date: formatSince(res.data.until, locale) }) : t("users.pro.revoked", { handle }) });
    });
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={open ? undefined : t("users.pro.hint")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-all active:scale-[0.97] disabled:opacity-50",
          state.active ? "border-synapse bg-synapse text-synapse-foreground shadow-glow hover:brightness-110" : "border-border bg-muted text-muted-foreground hover:border-synapse/40 hover:text-synapse",
        )}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
        {t("pro.mark")}
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={t("users.pro.title", { handle })}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="fixed z-50 w-72 animate-pop-in space-y-3 rounded-xl border border-border bg-card p-4 shadow-[0_20px_50px_-20px_hsl(var(--synapse)/0.35)]">
          <div className="space-y-1">
            <p className="label-mono text-foreground">{t("users.pro.title", { handle })}</p>
            <p className="text-xs text-muted-foreground">
              {!state.active
                ? t("users.pro.none")
                : paid
                  ? t("users.pro.paid", { plan: t(`pro.plan.${state.plan ?? "pro"}`), date: formatSince(state.until!, locale) })
                  : t("users.pro.grantedUntil", { date: formatSince(state.until!, locale) })}
            </p>
            {state.active && state.since && <p className="text-xs text-muted-foreground">{t("pro.mark.since", { date: formatSince(state.since, locale) })}</p>}
          </div>

          {!paid && (
            <>
              <div role="radiogroup" aria-label={t("users.pro.length")} className="grid grid-cols-5 gap-1">
                {PRO_GRANT_MONTHS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={months === m}
                    onClick={() => setMonths(m)}
                    className={cn("rounded-md border py-1.5 font-mono text-[11px] transition-colors", months === m ? "border-synapse bg-synapse/15 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}
                  >
                    {t("users.pro.monthsShort", { n: m })}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => apply(months)} disabled={pending} className="h-8 flex-1 rounded-lg bg-synapse font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-synapse-foreground transition-[filter] hover:brightness-110 disabled:opacity-50">
                  {state.granted ? t("users.pro.extend") : t("users.pro.grant")}
                </button>
                {state.granted && (
                  <button type="button" onClick={() => apply(null)} disabled={pending} className="h-8 rounded-lg border border-danger/40 px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-danger hover:bg-danger/10 disabled:opacity-50">
                    {t("users.pro.revoke")}
                  </button>
                )}
              </div>
            </>
          )}
          </div>,
          document.body,
        )}
    </div>
  );
}
