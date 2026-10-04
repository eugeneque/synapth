"use client";

/**
 * The Pro mark next to a subscriber's name: a solid lime chip that stands out
 * from everything else in a row. Hover shows «Pro subscriber since …»
 * in a portal, so `truncate` parents never clip it.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

const SIZES = {
  sm: "h-[15px] px-1 text-[8.5px] tracking-[0.12em]",
  md: "h-[18px] px-1.5 text-[10px] tracking-[0.14em]",
  lg: "h-6 px-2 text-[12px] tracking-[0.16em]",
} as const;

/** «21 января 2022»: the message adds «года» / «року» itself, so the locale's short year suffix is dropped. */
export function formatSince(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(iso))
    .replace(/\s?(г\.|р\.)$/, "");
}

export function ProMark({ since, size = "md", className }: { since: string; size?: keyof typeof SIZES; className?: string }) {
  const { t, locale } = useI18n();
  const label = t("pro.mark.since", { date: formatSince(since, locale) });
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean; align: "start" | "center" | "end" } | null>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 56;
    // Near an edge the tooltip hangs from the mark's side instead of its centre.
    const align = r.left < 160 ? "start" : r.right > window.innerWidth - 160 ? "end" : "center";
    const x = align === "start" ? r.left : align === "end" ? r.right : r.left + r.width / 2;
    setTip({ x, y: below ? r.bottom + 8 : r.top - 8, below, align });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [tip, hide]);

  return (
    <>
      <span
        ref={ref}
        role="img"
        aria-label={label}
        aria-describedby={tip ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        className={cn(
          "pro-mark relative inline-flex shrink-0 select-none items-center justify-center rounded-[4px] font-mono font-bold uppercase leading-none",
          SIZES[size],
          className,
        )}
      >
        Pro
      </span>
      {tip &&
        createPortal(
          <span
            id={tipId}
            role="tooltip"
            style={{ left: tip.x, top: tip.y }}
            className={cn("pointer-events-none fixed z-[100]", tip.align === "center" && "-translate-x-1/2", tip.align === "end" && "-translate-x-full", !tip.below && "-translate-y-full")}
          >
            {/* The entrance animation sets `transform`, so it lives on an inner box and cannot undo the positioning above. */}
            <span className="block animate-pop-in whitespace-nowrap rounded-md border border-synapse/40 bg-card px-2.5 py-1.5 text-xs text-foreground shadow-[0_8px_30px_-8px_hsl(var(--synapse)/0.45)]">
              <span className="mr-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-synapse">Pro</span>
              {label}
            </span>
          </span>,
          document.body,
        )}
    </>
  );
}
