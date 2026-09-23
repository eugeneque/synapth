"use client";

/**
 * VerificationStepper — the four stages of an account verification request
 * (submitted → scan → review → decision) with the state of each, and an
 * optional event log underneath. Shared by the applicant's settings panel and
 * the admin review page; a stage that changes between polls animates in.
 */

import { Check, Clock, Loader2, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn, timeAgo } from "@/lib/utils";
import { VERIFICATION_STAGES, stageStates, type VerificationRequest, type VerificationStageState } from "@/types/verification";
import type { UiKey } from "@/lib/i18n";

const DOT: Record<VerificationStageState | "idle", string> = {
  idle: "border-border bg-surface-lowest text-muted-foreground/50",
  waiting: "border-warn/50 bg-warn/10 text-warn",
  active: "border-synapse/60 bg-synapse/10 text-synapse shadow-glow",
  done: "border-synapse bg-synapse text-synapse-foreground",
  failed: "border-danger/60 bg-danger/15 text-danger",
};

export function VerificationStepper({ request, log = true, className }: { request: VerificationRequest; log?: boolean; className?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const states = stageStates(request.events);
  const last = (stage: string) => [...request.events].reverse().find((e) => e.stage === stage);

  return (
    <div className={cn("space-y-5", className)}>
      <ol className="grid gap-3 sm:grid-cols-4 sm:gap-0">
        {VERIFICATION_STAGES.map((stage, i) => {
          // A closed request leaves unfinished stages behind: grey them out instead of "still waiting".
          const raw = states[stage];
          const state = raw && !(request.status !== "pending" && (raw === "waiting" || raw === "active")) ? raw : "idle";
          const ev = last(stage);
          const nextState = states[VERIFICATION_STAGES[i + 1]] ?? null;
          return (
            <li key={stage} className="relative flex gap-3 sm:flex-col sm:gap-2.5 sm:pr-4">
              {/* Connector to the next stage: fills once this one is done. */}
              {i < VERIFICATION_STAGES.length - 1 && (
                <span aria-hidden className="absolute left-4 top-9 h-[calc(100%-1.5rem)] w-px bg-border sm:left-9 sm:right-0 sm:top-4 sm:h-px sm:w-auto">
                  <span className={cn("absolute inset-0 origin-top bg-synapse transition-transform duration-700 ease-out sm:origin-left", state === "done" && nextState ? "scale-100" : "scale-0")} />
                </span>
              )}
              <span key={`${stage}-${state}`} className={cn("relative z-10 flex h-8 w-8 shrink-0 animate-pop-in items-center justify-center rounded-full border transition-colors duration-300", DOT[state])}>
                {state === "active" && <span aria-hidden className="absolute inset-0 animate-impulse-halo rounded-full bg-synapse/30" />}
                {state === "done" ? <Check className="h-4 w-4" /> : state === "failed" ? <X className="h-4 w-4" /> : state === "active" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "waiting" ? <Clock className="h-4 w-4 animate-pulse" /> : <span className="font-mono text-[11px]">{i + 1}</span>}
              </span>
              <div className="min-w-0 pb-2 sm:pb-0">
                <p className={cn("label-mono", state === "idle" ? "text-muted-foreground/60" : "text-foreground")}>{t(`verify.stage.${stage}`)}</p>
                <p className={cn("mt-0.5 text-xs", state === "failed" ? "text-danger" : state === "waiting" ? "text-warn" : "text-muted-foreground")}>{ev && state !== "idle" ? t(`verify.code.${ev.code}` as UiKey, { name: ev.actor?.name || ev.actor?.handle || "", n: ev.note ?? "" }) : t("verify.stage.idle")}</p>
                {ev && state !== "idle" && <p className="label-mono-sm mt-0.5 normal-case tracking-normal">{timeAgo(ev.at, i18n)}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {log && request.events.length > 0 && (
        <div className="well">
          <p className="label-mono-sm border-b border-border px-3 py-2">{t("verify.log")}</p>
          <ul className="stagger divide-y divide-border/60">
            {[...request.events].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-start gap-3 px-3 py-2 font-mono text-[11px]">
                <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", e.state === "failed" ? "bg-danger" : e.state === "waiting" ? "bg-warn" : "bg-synapse")} />
                <span className="w-20 shrink-0 text-muted-foreground">{new Date(e.at).toLocaleString(i18n.locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 text-foreground/90">
                  <span className="text-muted-foreground">{t(`verify.stage.${e.stage}`)} · </span>
                  {t(`verify.code.${e.code}` as UiKey, { name: e.actor?.name || e.actor?.handle || "", n: e.note ?? "" })}
                  {e.note && (e.code === "rejected" || e.code === "granted" || e.code === "approved") && <span className="block whitespace-pre-wrap text-muted-foreground">“{e.note}”</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
