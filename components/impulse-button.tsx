"use client";

/**
 * ImpulseButton — Synapth's like, drawn as a charge cell: a round core with
 * the bolt, the running total next to it. Firing an impulse fills the core,
 * throws a ring + sparks outwards and rolls the counter; withdrawing drains it.
 * Signed-out visitors are sent to the sign-in gate; on your own profile it is
 * a passive readout.
 *
 * `size="sm"` is the compact chip used on the avatar hover card.
 */

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Zap } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { sendImpulse } from "@/app/(site)/social-actions";
import type { ImpulseSummary } from "@/cortex/social";
import { cn, formatCompact } from "@/lib/utils";
import type { ImpulseViewer } from "@/types/social";

interface Props {
  toId: string;
  handle: string;
  name: string;
  initial: ImpulseSummary;
  viewer: ImpulseViewer;
  size?: "lg" | "sm";
  onChange?: (next: ImpulseSummary) => void;
  className?: string;
}

const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];

export function ImpulseButton({ toId, handle, name, initial, viewer, size = "lg", onChange, className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  // Bumped on every successful toggle: re-keys the burst and the counter so their animations replay.
  const [pulse, setPulse] = useState(0);
  const direction = useRef<"up" | "down">("up");
  const sm = size === "sm";

  const caption = viewer === "self" ? t("profile.stats.impulses") : state.active ? t("impulse.sent") : t("impulse.send");

  function toggle() {
    start(async () => {
      const res = await sendImpulse(toId, handle);
      if (!res.ok) {
        toast({ tone: "danger", title: t("impulse.failed"), body: res.error });
        return;
      }
      direction.current = res.data.total >= state.total ? "up" : "down";
      setState(res.data);
      setPulse((p) => p + 1);
      onChange?.(res.data);
      if (res.data.active) toast({ tone: "success", title: t("impulse.sentTitle"), body: t("impulse.sentBody", { name }) });
    });
  }

  const lit = state.active;
  const body = (
    <>
      <span className={cn("relative flex shrink-0 items-center justify-center rounded-full border transition-all duration-300", sm ? "h-6 w-6" : "h-11 w-11", lit ? "border-synapse bg-synapse text-synapse-foreground shadow-glow" : "border-border bg-surface-lowest text-synapse group-hover/impulse:border-synapse/60 group-hover/impulse:shadow-glow")}>
        {/* Idle charge: a dashed ring that spins up on hover. */}
        {!lit && viewer !== "self" && <span aria-hidden className={cn("absolute rounded-full border border-dashed border-synapse/40 opacity-0 transition-opacity duration-300 group-hover/impulse:animate-[spin_3s_linear_infinite] group-hover/impulse:opacity-100", sm ? "-inset-[3px]" : "-inset-[5px]")} />}
        {/* Resting halo while the viewer's impulse is live. */}
        {lit && !sm && <span aria-hidden className="absolute inset-0 animate-impulse-halo rounded-full bg-synapse/40" />}
        {pulse > 0 && (
          <span key={pulse} aria-hidden className="pointer-events-none absolute inset-0">
            <span className="absolute inset-0 animate-impulse-ring rounded-full border-2 border-synapse" />
            {lit &&
              SPARKS.map((a) => (
                <span key={a} className="absolute left-1/2 top-1/2 h-px w-2 origin-left animate-impulse-spark bg-synapse" style={{ "--a": `${a}deg`, "--d": sm ? "16px" : "28px" } as React.CSSProperties} />
              ))}
          </span>
        )}
        {pending ? <Loader2 className={cn("relative animate-spin", sm ? "h-3 w-3" : "h-5 w-5")} /> : <Zap className={cn("relative transition-transform duration-300", sm ? "h-3 w-3" : "h-5 w-5", lit && "fill-current", "group-hover/impulse:scale-110 group-active/impulse:scale-90")} />}
      </span>
      <span className={cn("flex min-w-0 flex-col items-start", sm && "flex-row items-center gap-1.5")}>
        <span className={cn("relative overflow-hidden font-display font-medium leading-none tracking-tight tabular-nums", sm ? "text-sm" : "h-8 text-[28px] leading-8", lit ? "text-synapse" : "text-foreground")}>
          <span key={pulse} className={cn("inline-block", pulse > 0 && (direction.current === "up" ? "animate-count-up" : "animate-count-down"))}>
            {formatCompact(state.total)}
          </span>
        </span>
        <span className={cn("label-mono-sm whitespace-nowrap transition-colors", !sm && "mt-1", lit ? "text-synapse/80" : "group-hover/impulse:text-foreground")}>{caption}</span>
      </span>
    </>
  );

  const shell = cn(
    "group/impulse relative inline-flex select-none items-center rounded-xl border transition-all duration-200",
    sm ? "h-8 gap-2 rounded-full py-1 pl-1 pr-3 backdrop-blur" : "h-16 gap-3.5 py-2.5 pl-2.5 pr-5",
    lit ? (sm ? "border-synapse/50 bg-card/90" : "border-synapse/40 bg-synapse/[0.07]") : sm ? "border-border bg-card/85" : "border-border bg-surface-lowest/80",
    viewer !== "self" && "hover:-translate-y-px hover:border-synapse/40 active:translate-y-0 active:scale-[0.98]",
    className,
  );

  if (viewer === "self") {
    return (
      <span className={shell} title={t("impulse.selfHint")}>
        {body}
      </span>
    );
  }
  if (viewer === "anonymous") {
    return (
      <Link href={`/signin?callbackUrl=/u/${handle}`} className={shell}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={toggle} disabled={pending} aria-pressed={lit} aria-label={`${caption} · ${state.total}`} className={shell}>
      {body}
    </button>
  );
}
