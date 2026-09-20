"use client";

/**
 * ImpulseButton — Synapth's like. One impulse per viewer, toggled; signed-out
 * visitors get sent to the sign-in gate, owners see a passive counter.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Zap } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { sendImpulse } from "@/app/(site)/social-actions";
import type { ImpulseSummary } from "@/cortex/social";
import { cn } from "@/lib/utils";

interface Props {
  toId: string;
  handle: string;
  name: string;
  initial: ImpulseSummary;
  /** null → not signed in; equal to `toId` → own profile. */
  viewerId: string | null;
}

export function ImpulseButton({ toId, handle, name, initial, viewerId }: Props) {
  const { t, n } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  const self = viewerId === toId;

  const label = n("impulse.count", state.total);
  const base = "inline-flex h-9 items-center gap-2 rounded-lg border px-4 font-mono text-[11px] uppercase tracking-[0.14em] transition-all";

  if (self) {
    return (
      <span className={cn(base, "border-border bg-muted text-muted-foreground")} title={t("impulse.selfHint")}>
        <Zap className="h-4 w-4 text-synapse" /> {label}
      </span>
    );
  }
  if (!viewerId) {
    return (
      <Link href={`/signin?callbackUrl=/u/${handle}`} className={cn(base, "border-border bg-muted text-foreground hover:border-foreground/30")}>
        <Zap className="h-4 w-4 text-synapse" /> {t("impulse.send")} <span className="text-muted-foreground">· {state.total}</span>
      </Link>
    );
  }

  function toggle() {
    start(async () => {
      const res = await sendImpulse(toId, handle);
      if (!res.ok) {
        toast({ tone: "danger", title: t("impulse.failed"), body: res.error });
        return;
      }
      setState(res.data);
      if (res.data.active) toast({ tone: "success", title: t("impulse.sentTitle"), body: t("impulse.sentBody", { name }) });
    });
  }

  return (
    <button type="button" onClick={toggle} disabled={pending} aria-pressed={state.active} className={cn(base, state.active ? "border-synapse/50 bg-synapse/10 text-synapse shadow-glow" : "border-border bg-muted text-foreground hover:border-synapse/40 hover:text-synapse")}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className={cn("h-4 w-4", state.active && "fill-current")} />}
      {state.active ? t("impulse.sent") : t("impulse.send")}
      <span className={cn(state.active ? "text-synapse/80" : "text-muted-foreground")}>· {state.total}</span>
    </button>
  );
}
