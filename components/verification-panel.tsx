"use client";

/**
 * VerificationPanel — "Verification" section of /dashboard/settings.
 *
 * Three faces: verified (the mark and when it was given), a request in
 * progress (live stepper, polled every few seconds and refetched at once on
 * any new notification), or the checklist + phone form to file a request.
 * A closed request (rejected / withdrawn) stays visible above the form.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Check, Loader2, Phone, ScanSearch, Send, Undo2, X, Zap } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { useNotifications } from "@/axon/notifications";
import { applyForVerification, withdrawVerificationRequest } from "@/app/(site)/verification-actions";
import { VerificationStepper } from "@/components/verification-stepper";
import { VerifiedMark } from "@/components/verified-mark";
import { cn } from "@/lib/utils";
import { normalizePhone, type EligibilityCheck, type VerificationState } from "@/types/verification";
import type { UiKey } from "@/lib/i18n";

const POLL_MS = 8000;

const CHECK_ICON: Record<EligibilityCheck["id"], typeof Phone> = { phone: Phone, age: CalendarClock, impulses: Zap, skills: ScanSearch };

export function VerificationPanel({ initial }: { initial: VerificationState }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { toast } = useToast();
  const { version } = useNotifications();
  const [state, setState] = useState(initial);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const live = state.request?.status === "pending";

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/account/verification", { cache: "no-store" });
      if (!res.ok) return;
      setState((await res.json()) as VerificationState);
      setSyncedAt(Date.now());
    } catch {
      // Offline for a moment: the next tick retries.
    }
  }, []);

  // Live tracking while a request is open: poll, refetch on focus and on any new notification.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      window.removeEventListener("focus", refresh);
    };
  }, [live, refresh]);
  useEffect(() => {
    if (version > 0) void refresh();
  }, [version, refresh]);

  const normalized = normalizePhone(phone);
  const checks = state.eligibility.checks.map((c) => (c.id === "phone" ? { ...c, ok: Boolean(normalized), value: normalized ? 1 : 0 } : c));
  const canApply = checks.filter((c) => c.id !== "skills").every((c) => c.ok);

  function apply() {
    start(async () => {
      const res = await applyForVerification(phone);
      if (!res.ok) {
        toast({ tone: "danger", title: t("verify.failed"), body: res.code ? t(`verify.err.${res.code}` as UiKey) : res.error });
        return;
      }
      setPhone("");
      await refresh();
      toast({ tone: res.data.status === "rejected" ? "danger" : "success", title: t(res.data.status === "rejected" ? "verify.toast.scanFailed" : "verify.toast.submitted") });
    });
  }

  function withdraw() {
    if (!window.confirm(t("verify.withdrawConfirm"))) return;
    start(async () => {
      const res = await withdrawVerificationRequest();
      if (!res.ok) {
        toast({ tone: "danger", title: t("verify.failed"), body: res.error });
        return;
      }
      await refresh();
    });
  }

  if (state.verified) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-synapse/30 bg-synapse/[0.06] p-5">
        <div aria-hidden className="absolute -right-10 -top-16 h-40 w-40 rounded-full bg-synapse/20 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-synapse/40 bg-card">
            <VerifiedMark size="lg" />
          </span>
          <div className="space-y-1">
            <p className="font-display text-lg font-medium tracking-tight">{t("verify.verified.title")}</p>
            <p className="text-sm text-muted-foreground">{t(state.verified.via === "manual" ? "verify.verified.manual" : "verify.verified.request", { date: new Date(state.verified.verifiedAt).toLocaleDateString(i18n.locale, { day: "numeric", month: "long", year: "numeric" }) })}</p>
          </div>
        </div>
      </div>
    );
  }

  const request = state.request;
  return (
    <div className="space-y-5">
      {request && (
        <div className={cn("space-y-4 rounded-xl border p-4", live ? "border-synapse/30 bg-synapse/[0.03]" : request.status === "rejected" ? "border-danger/30 bg-danger/[0.04]" : "border-border bg-surface-lowest")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {live ? <span className="dot-live animate-pulse-dot" /> : request.status === "rejected" ? <X className="h-4 w-4 text-danger" /> : <Undo2 className="h-4 w-4 text-muted-foreground" />}
              <p className="label-mono text-foreground">{t(`verify.status.${request.status}`)}</p>
              <span className="label-mono-sm normal-case tracking-normal">
                {t("verify.phoneMasked", { phone: request.phone })} · {new Date(request.createdAt).toLocaleDateString(i18n.locale)}
              </span>
            </div>
            {live && (
              <div className="flex items-center gap-3">
                <span className="label-mono-sm normal-case tracking-normal">{t("verify.synced", { n: Math.max(0, Math.round((now - syncedAt) / 1000)) })}</span>
                <button type="button" onClick={withdraw} disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50">
                  <Undo2 className="h-3.5 w-3.5" /> {t("verify.withdraw")}
                </button>
              </div>
            )}
          </div>
          <VerificationStepper request={request} log={live} />
          {request.status === "rejected" && request.decisionNote && (
            <p className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-foreground/90">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span className="whitespace-pre-wrap">{request.decisionNote}</span>
            </p>
          )}
        </div>
      )}

      {!live && (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("verify.lead")}</p>
          <ul className="stagger grid gap-2 sm:grid-cols-2">
            {checks.map((c) => {
              const Icon = CHECK_ICON[c.id];
              const progress = c.id === "age" || c.id === "impulses" ? Math.min(1, c.value / c.required) : c.ok ? 1 : 0;
              return (
                <li key={c.id} className={cn("relative overflow-hidden rounded-lg border p-3 transition-colors duration-300", c.ok ? "border-synapse/30 bg-synapse/[0.04]" : "border-border bg-surface-lowest")}>
                  <div className="flex items-start gap-3">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors duration-300", c.ok ? "border-synapse/40 text-synapse" : "border-border text-muted-foreground")}>
                      {c.ok ? <Check key="ok" className="h-4 w-4 animate-pop-in" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium tracking-tight">{t(`verify.check.${c.id}`)}</p>
                      <p className="label-mono-sm mt-0.5 normal-case tracking-normal">
                        {c.id === "age"
                          ? t("verify.check.ageValue", { n: c.value, required: c.required })
                          : c.id === "impulses"
                            ? t("verify.check.impulsesValue", { n: c.value, required: c.required })
                            : c.id === "skills"
                              ? c.ok
                                ? t("verify.check.skillsClean", { n: state.eligibility.skillsScanned })
                                : t("verify.check.skillsFlagged", { n: c.value })
                              : t(c.ok ? "verify.check.phoneOk" : "verify.check.phoneHint")}
                      </p>
                    </div>
                  </div>
                  {(c.id === "age" || c.id === "impulses") && (
                    <span className="mt-3 block h-1 overflow-hidden rounded-full bg-surface-high">
                      <span className={cn("block h-full origin-left rounded-full transition-transform duration-700 ease-out", c.ok ? "bg-synapse" : "bg-synapse/50")} style={{ transform: `scaleX(${progress})` }} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {state.eligibility.flaggedSkills.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs">
              <p className="mb-2 flex items-center gap-2 font-medium text-warn">
                <AlertTriangle className="h-3.5 w-3.5" /> {t("verify.flaggedLead")}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {state.eligibility.flaggedSkills.map((s) => (
                  <li key={s.id}>
                    <Link href={`/skills/${s.slug}`} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-warn/30 px-2 font-mono text-[11px] text-foreground transition-colors hover:border-warn">
                      {s.name} <span className="text-warn">· {s.findings}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="label-mono-sm mb-1.5 flex items-center justify-between">
                <span className="text-foreground/80">{t("verify.phone")}</span>
                <span className={cn(phone && !normalized ? "text-danger" : "text-muted-foreground/70")}>{phone && !normalized ? t("verify.err.phone_invalid") : t("verify.phonePrivacy")}</span>
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 999 123-45-67"
                maxLength={24}
                className="h-9 w-full rounded-lg border border-border bg-muted px-3 font-mono text-[13px] text-foreground transition-colors placeholder:text-muted-foreground/50 focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25"
              />
            </label>
            <button type="button" onClick={apply} disabled={!canApply || pending} title={canApply ? undefined : t("verify.notEligible")} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-synapse px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-synapse-foreground shadow-glow transition-all hover:-translate-y-px hover:shadow-glow-lg active:scale-[0.97] disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("verify.apply")}
            </button>
          </div>
          {!canApply && <p className="label-mono-sm normal-case tracking-normal">{t("verify.notEligible")}</p>}
        </>
      )}
    </div>
  );
}
