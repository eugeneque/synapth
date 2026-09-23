"use client";

/**
 * ModerationRequestButton — "Send for moderation" on an entry page. Opens a
 * small form for an optional note to the reviewer; staff are notified and
 * review it on /dashboard/moderation. While a request is open the button
 * turns into an "Under review" chip (staff get a link to the request).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Hourglass, Loader2, Send, ShieldCheck } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { submitForModeration } from "@/app/(site)/moderation-actions";
import { MODERATION_NOTE_MAX } from "@/types/moderation";
import { cn } from "@/lib/utils";

interface Props {
  skillId: string;
  slug: string;
  name: string;
  /** Id of the open request, if any. */
  pendingId: string | null;
  signedIn: boolean;
  /** Staff see a link to the open request. */
  canReview: boolean;
  className?: string;
}

const base = "inline-flex h-11 items-center gap-2 rounded-lg border px-5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all";

export function ModerationRequestButton({ skillId, slug, name, pendingId: initialPending, signedIn, canReview, className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [pendingId, setPendingId] = useState(initialPending);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (pendingId) {
    return canReview ? (
      <Link href={`/dashboard/moderation/${pendingId}`} className={cn(base, "border-warn/40 bg-warn/10 text-warn hover:bg-warn/20", className)}>
        <Hourglass className="h-4 w-4" /> {t("modreq.review")} <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    ) : (
      <span className={cn(base, "cursor-default border-warn/40 bg-warn/10 text-warn", className)} title={t("modreq.pendingHint")}>
        <Hourglass className="h-4 w-4" /> {t("modreq.pending")}
      </span>
    );
  }

  if (!signedIn) {
    return (
      <Link href={`/signin?callbackUrl=/skills/${slug}`} className={cn(base, "border-border bg-muted text-foreground hover:border-synapse/40 hover:text-synapse", className)}>
        <ShieldCheck className="h-4 w-4 text-synapse" /> {t("modreq.submit")}
      </Link>
    );
  }

  function submit() {
    start(async () => {
      const res = await submitForModeration(skillId, note);
      if (!res.ok) {
        toast({ tone: "danger", title: t("modreq.failed"), body: res.error });
        return;
      }
      setPendingId(res.data.requestId);
      setOpen(false);
      setNote("");
      toast({ tone: "success", title: t("modreq.sentTitle"), body: t("modreq.sentBody", { name }) });
      router.refresh();
    });
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn(base, "border-border bg-muted text-foreground hover:border-synapse/40 hover:text-synapse", open && "border-synapse/50 text-synapse")}>
        <ShieldCheck className="h-4 w-4" /> {t("modreq.submit")}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-border bg-card p-4 shadow-xl">
          <p className="text-sm text-muted-foreground">{t("modreq.lead")}</p>
          <label className="block space-y-1">
            <span className="label-mono-sm">{t("modreq.noteLabel")}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MODERATION_NOTE_MAX))}
              rows={3}
              placeholder={t("modreq.notePlaceholder")}
              className="w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 text-sm focus:border-synapse focus:outline-none"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
              {t("modreq.cancel")}
            </button>
            <button type="button" onClick={submit} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-synapse/50 bg-synapse/10 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-synapse hover:bg-synapse/20 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("modreq.send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
