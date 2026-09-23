"use client";

/**
 * VerdictForm — closes a moderation request: Verify (re-runs the scanner with
 * the review flag, may still be refused) or Reject (a reason is required, it
 * is sent to the requester and the author).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2, XCircle } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { decideRequest } from "@/app/(site)/moderation-actions";
import { MODERATION_NOTE_MAX, type ModerationVerdict } from "@/types/moderation";
import { cn } from "@/lib/utils";

export function VerdictForm({ requestId, name, verifiable }: { requestId: string; name: string; verifiable: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ModerationVerdict | null>(null);
  const [, start] = useTransition();

  function decide(verdict: ModerationVerdict) {
    if (verdict === "reject" && !note.trim()) {
      toast({ tone: "warn", title: t("review.reasonRequired") });
      return;
    }
    setBusy(verdict);
    start(async () => {
      const res = await decideRequest(requestId, verdict, note);
      setBusy(null);
      if (!res.ok) {
        toast({ tone: "danger", title: t("moderation.failed"), body: res.error });
        return;
      }
      toast({ tone: "success", title: res.data.status === "approved" ? t("moderation.verified", { name }) : t("review.rejected", { name }) });
      router.refresh();
    });
  }

  const btn = "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border font-mono text-[11px] uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-3 p-5">
      <label className="block space-y-1">
        <span className="label-mono-sm">{t("review.noteLabel")}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MODERATION_NOTE_MAX))}
          rows={4}
          placeholder={t("review.notePlaceholder")}
          className="w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 text-sm focus:border-synapse focus:outline-none"
        />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={() => decide("approve")} disabled={busy !== null || !verifiable} title={verifiable ? undefined : t("moderation.blocked")} className={cn(btn, "border-synapse/50 bg-synapse/10 text-synapse hover:bg-synapse/20")}>
          {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} {t("review.approve")}
        </button>
        <button type="button" onClick={() => decide("reject")} disabled={busy !== null} className={cn(btn, "border-danger/40 bg-danger/10 text-danger hover:bg-danger/20")}>
          {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {t("review.reject")}
        </button>
      </div>
      <p className="label-mono-sm normal-case leading-relaxed tracking-normal">{t("review.verdictHint")}</p>
    </div>
  );
}
