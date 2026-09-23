"use client";

/**
 * VerifyControl — the moderator's switch on a catalogue entry: grant or
 * revoke `Verified`. Rendered only for holders of `catalog.verify`; the
 * server re-checks the permission and re-runs the scanner either way.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2, ShieldOff } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { verifySkill } from "@/app/(site)/moderation-actions";
import type { SecurityLevel } from "@/types/skill";
import { cn } from "@/lib/utils";

interface Props {
  skillId: string;
  name: string;
  level: SecurityLevel;
  size?: "sm" | "lg";
  className?: string;
}

export function VerifyControl({ skillId, name, level: initial, size = "lg", className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [level, setLevel] = useState(initial);
  const [pending, start] = useTransition();
  const verified = level === "Verified";
  // The scanner blocks Sandbox entries; the button says why instead of failing on click.
  const blocked = level === "Sandbox";

  function toggle() {
    start(async () => {
      const res = await verifySkill(skillId, !verified);
      if (!res.ok) {
        toast({ tone: "danger", title: t("moderation.failed"), body: res.error });
        return;
      }
      setLevel(res.data.securityLevel);
      toast({ tone: "success", title: res.data.securityLevel === "Verified" ? t("moderation.verified", { name }) : t("moderation.revoked", { name }) });
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending || blocked}
      title={blocked ? t("moderation.blocked") : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border font-mono uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:opacity-50",
        size === "lg" ? "h-11 px-5 text-[11px]" : "h-8 px-3 text-[10px]",
        verified ? "border-border bg-muted text-foreground hover:border-danger/50 hover:text-danger" : "border-synapse/50 bg-synapse/10 text-synapse hover:bg-synapse/20",
        className,
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : verified ? <ShieldOff className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
      {verified ? t("moderation.revoke") : t("moderation.verify")}
    </button>
  );
}
