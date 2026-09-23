"use client";

/** Staff control on a skillset page: set or revoke `verified` (holders of `catalog.verify`). */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2, ShieldOff } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { verifySkillset } from "@/app/(site)/skillset-actions";
import { Button } from "@/components/ui/button";

export function SkillsetVerifyControl({ skillsetId, name, verified: initial, empty }: { skillsetId: string; name: string; verified: boolean; empty: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [verified, setVerified] = useState(initial);
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      const res = await verifySkillset(skillsetId, !verified);
      if (!res.ok) {
        toast({ tone: "danger", title: t("skillset.verify.failed"), body: res.error });
        return;
      }
      setVerified(res.data.verified);
      toast({ tone: "success", title: t(res.data.verified ? "skillset.verify.done" : "skillset.verify.revoked", { name }) });
      router.refresh();
    });
  }

  return (
    <Button type="button" variant={verified ? "destructive" : "outline"} size="sm" onClick={toggle} disabled={pending || (!verified && empty)} title={!verified && empty ? t("skillset.verify.empty") : undefined}>
      {pending ? <Loader2 className="animate-spin" /> : verified ? <ShieldOff /> : <BadgeCheck />}
      {t(verified ? "skillset.verify.revoke" : "skillset.verify.set")}
    </Button>
  );
}
