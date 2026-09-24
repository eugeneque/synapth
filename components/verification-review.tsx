"use client";

/**
 * VerificationReview — the admin's controls on /dashboard/verification/[id]:
 * take the request into review (the applicant sees it live), then approve or
 * reject with a reason. Approval re-runs the skills scan on the server.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Hand, Loader2, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { claimVerificationRequest, decideVerificationRequest } from "@/app/(site)/verification-actions";
import { cn } from "@/lib/utils";
import { VERIFICATION_NOTE_MAX, type VerificationRequest } from "@/types/verification";

export function VerificationReview({ request, viewerId }: { request: VerificationRequest; viewerId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"claim" | "approve" | "reject" | null>(null);
  const own = request.user.id === viewerId;
  const claimedByMe = request.reviewer?.id === viewerId;

  function act(kind: "claim" | "approve" | "reject") {
    if (kind === "reject" && !note.trim()) {
      toast({ tone: "danger", title: t("verify.admin.noteRequired") });
      return;
    }
    setBusy(kind);
    start(async () => {
      const res = kind === "claim" ? await claimVerificationRequest(request.id) : await decideVerificationRequest(request.id, kind, note);
      setBusy(null);
      if (!res.ok) {
        toast({ tone: "danger", title: t("verify.failed"), body: res.error });
        return;
      }
      toast({ tone: kind === "reject" ? "info" : "success", title: t(`verify.admin.done.${kind}`, { handle: request.user.handle }) });
      router.refresh();
    });
  }

  if (request.status !== "pending") {
    return <p className="text-sm text-muted-foreground">{t("verify.admin.closedHint")}</p>;
  }
  if (own) return <p className="text-sm text-muted-foreground">{t("verify.admin.ownRequest")}</p>;

  return (
    <div className="space-y-4">
      {!claimedByMe && (
        <div className="flex flex-col gap-3 rounded-lg border border-warn/30 bg-warn/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground/90">{request.reviewer ? t("verify.admin.claimedBy", { name: request.reviewer.name || request.reviewer.handle }) : t("verify.admin.claimHint")}</p>
          <button type="button" onClick={() => act("claim")} disabled={pending} className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-warn/40 px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-warn transition-all hover:bg-warn/10 active:scale-[0.97] disabled:opacity-50">
            {busy === "claim" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hand className="h-3.5 w-3.5" />} {t("verify.admin.claim")}
          </button>
        </div>
      )}
      <label className="block">
        <span className="label-mono-sm mb-1.5 flex items-center justify-between">
          <span className="text-foreground/80">{t("verify.admin.note")}</span>
          <span className="text-muted-foreground/70">
            {note.length}/{VERIFICATION_NOTE_MAX}
          </span>
        </span>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, VERIFICATION_NOTE_MAX))} rows={3} placeholder={t("verify.admin.notePlaceholder")} className="w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => act("approve")} disabled={pending} className="inline-flex h-9 items-center gap-2 rounded-lg bg-synapse px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-synapse-foreground shadow-glow transition-all hover:-translate-y-px hover:shadow-glow-lg active:scale-[0.97] disabled:opacity-50">
          {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />} {t("verify.admin.approve")}
        </button>
        <button type="button" onClick={() => act("reject")} disabled={pending} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border border-danger/30 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-danger transition-all hover:bg-danger/10 active:scale-[0.97] disabled:opacity-50")}>
          {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} {t("verify.admin.reject")}
        </button>
      </div>
    </div>
  );
}
