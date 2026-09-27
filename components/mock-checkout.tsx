"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { Button } from "@/components/ui/button";
import { settleMockAction } from "@/app/(site)/dashboard/billing/actions";

/** Buttons of the local test checkout: what a provider's hosted page would do. */
export function MockCheckout({ paymentId }: { paymentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const settle = (outcome: "succeeded" | "failed") =>
    start(async () => {
      const res = await settleMockAction(paymentId, outcome);
      if (!res.ok) return setError(res.error ?? null);
      router.push(`/dashboard/billing/return?payment=${encodeURIComponent(paymentId)}`);
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => settle("succeeded")} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("billing.mock.pay")}
        </Button>
        <Button variant="destructive" onClick={() => settle("failed")} disabled={pending}>
          <X className="h-4 w-4" /> {t("billing.mock.decline")}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
