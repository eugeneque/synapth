"use client";

/** Final CTA plate on /about: grows from 0.96 to 1, then one sheen sweeps across it. */

import Link from "next/link";
import { GhostText } from "./ghost-text";
import { useReveal } from "./motion";
import { cn } from "@/lib/utils";

export function AboutCta({ title, primary, secondary }: { title: string; primary: string; secondary: string }) {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("about-cta-panel px-6 py-14 text-center md:px-16 md:py-20", shown && "is-in")}>
      <GhostText as="h2" text={title} start={shown} delay={200} className="about-h2 mx-auto max-w-[18ch]" />
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link href="/search?tab=skills" className="about-btn about-btn-ink">
          {primary}
        </Link>
        <Link href="/dashboard/developer#publish" className="about-btn about-btn-ink-outline">
          {secondary}
        </Link>
      </div>
    </div>
  );
}
