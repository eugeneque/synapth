"use client";

/** CheckMarkToggle — admin's per-row "grant / revoke check mark" in /dashboard/admin/users (no request needed). */

import { useState, useTransition } from "react";
import { BadgeCheck, BadgeX, Loader2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { setUserCheckMark } from "@/app/(site)/verification-actions";
import { cn } from "@/lib/utils";

export function CheckMarkToggle({ userId, handle, initial, self }: { userId: string; handle: string; initial: boolean; self: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [verified, setVerified] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !verified;
    const note = window.prompt(t(next ? "verify.admin.grantPrompt" : "verify.admin.revokePrompt", { handle }), "");
    if (note === null) return;
    start(async () => {
      const res = await setUserCheckMark(userId, handle, next, note);
      if (!res.ok) {
        toast({ tone: "danger", title: t("verify.failed"), body: res.error });
        return;
      }
      setVerified(res.data.verified);
      toast({ tone: "success", title: t(next ? "verify.admin.granted" : "verify.admin.revoked", { handle }) });
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending || self}
      title={self ? t("users.selfLocked") : undefined}
      aria-pressed={verified}
      className={cn(
        "group/cm inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-all active:scale-[0.97] disabled:opacity-50",
        verified ? "border-synapse/40 bg-synapse/10 text-synapse hover:border-danger/40 hover:bg-danger/10 hover:text-danger" : "border-border bg-muted text-muted-foreground hover:border-synapse/40 hover:text-synapse",
      )}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : verified ? (
        <>
          <BadgeCheck className="h-3.5 w-3.5 group-hover/cm:hidden" />
          <BadgeX className="hidden h-3.5 w-3.5 group-hover/cm:block" />
        </>
      ) : (
        <BadgeCheck className="h-3.5 w-3.5" />
      )}
      <span className="group-hover/cm:hidden">{t(verified ? "verify.admin.on" : "verify.admin.grant")}</span>
      <span className="hidden group-hover/cm:inline">{t(verified ? "verify.admin.revoke" : "verify.admin.grant")}</span>
    </button>
  );
}
