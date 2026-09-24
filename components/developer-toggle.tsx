"use client";

/** DeveloperToggle — admin's per-row "platform developer" switch in /dashboard/admin/users; the unique badge follows it. */

import { useState, useTransition } from "react";
import { Loader2, Rocket } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { changeDeveloper } from "@/app/(site)/moderation-actions";
import { cn } from "@/lib/utils";

export function DeveloperToggle({ userId, handle, initial }: { userId: string; handle: string; initial: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [developer, setDeveloper] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !developer;
    if (!window.confirm(t(next ? "users.developer.grantConfirm" : "users.developer.revokeConfirm", { handle }))) return;
    start(async () => {
      const res = await changeDeveloper(userId, next);
      if (!res.ok) {
        toast({ tone: "danger", title: t("users.failed"), body: res.error });
        return;
      }
      setDeveloper(res.data.developer);
      toast({ tone: "success", title: t(res.data.developer ? "users.developer.granted" : "users.developer.revoked", { handle }) });
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={developer}
      title={t("users.developer.hint")}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-all active:scale-[0.97] disabled:opacity-50",
        developer ? "border-synapse/40 bg-synapse/10 text-synapse hover:border-danger/40 hover:bg-danger/10 hover:text-danger" : "border-border bg-muted text-muted-foreground hover:border-synapse/40 hover:text-synapse",
      )}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
      {t("settings.role.developer")}
    </button>
  );
}
