"use client";

/**
 * FlashQuote — the scroll-linked transition between the first screen and the
 * manifesto. The section is ~150vh of scroll with a pinned viewport:
 *   0–40%   a lime card — the question and the problems behind it — grows
 *           to fill the screen (radius 20 → 0);
 *   40–60%  the answer (quote, lead, CLI line), in accent-ink, sharpens out of a blur;
 *   60–100% the screen folds back into the front card of a stack of three
 *           (perspective 1200px, the two behind tilted and lifted), the dark
 *           background returns.
 * Everything is derived from the scroll position, so scrolling up plays it
 * backwards. Phones skip the 3D stack; reduced motion gets a plain section.
 * Styles are written straight to the DOM from one rAF per scroll event.
 */

import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";
import { rich } from "@/lib/i18n/rich";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface FlashQuoteCopy {
  /** The question on the resting card. */
  eyebrow: string;
  /** The problems listed under it, one line each. */
  reasons: string[];
  quote: string;
  lead: string;
  /** A terminal line shown under the lead. */
  command: string;
}

export function FlashQuote({ eyebrow, reasons, quote, lead, command }: FlashQuoteCopy) {
  const sectionRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const quoteRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const backRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    if (reducedMotion()) {
      setPlain(true);
      return;
    }
    const section = sectionRef.current;
    if (!section) return;
    const mobile = window.matchMedia("(max-width: 767px)");
    let raf = 0;

    function paint() {
      raf = 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = section!.getBoundingClientRect();
      const p = clamp01(-rect.top / Math.max(1, rect.height - vh));

      // Card geometry: the resting card, the full screen, the front card of the stack.
      const startW = Math.min(420, vw * 0.7);
      const startH = Math.min(260, vh * 0.34);
      const endW = Math.min(920, vw - 32);
      const endH = Math.min(440, vh * 0.62);
      const grow = ease(clamp01(p / 0.4));
      const fold = ease(clamp01((p - 0.6) / 0.4));
      const w = fold > 0 ? mix(vw, endW, fold) : mix(startW, vw, grow);
      const h = fold > 0 ? mix(vh, endH, fold) : mix(startH, vh, grow);
      const r = fold > 0 ? mix(0, 20, fold) : mix(20, 0, grow);
      const insetX = (vw - w) / 2;
      const insetY = (vh - h) / 2;
      fillRef.current!.style.clipPath = `inset(${insetY}px ${insetX}px round ${r}px)`;

      // The small label on the resting card fades as it grows.
      labelRef.current!.style.opacity = String(1 - clamp01(p / 0.15));

      // Quote: from blur to sharp between 40% and 60%.
      const q = ease(clamp01((p - 0.4) / 0.2));
      quoteRef.current!.style.opacity = String(q);
      quoteRef.current!.style.filter = `blur(${((1 - q) * 16).toFixed(1)}px)`;
      quoteRef.current!.style.transform = `scale(${mix(1.04, 1, q) * mix(1, 0.94, fold)})`;

      // The stack behind the front card.
      const flat = mobile.matches;
      backRefs.current.forEach((el, i) => {
        if (!el) return;
        const depth = i + 1;
        el.style.width = `${endW}px`;
        el.style.height = `${endH}px`;
        el.style.opacity = flat ? "0" : String(fold * (depth === 1 ? 0.55 : 0.28));
        el.style.transform = `translate(-50%, -50%) translateY(${-16 * depth * fold}px) rotateX(${10 * fold}deg) scale(${1 - 0.05 * depth})`;
      });
    }

    const request = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    let active = false;
    const io = new IntersectionObserver(([entry]) => {
      active = Boolean(entry?.isIntersecting);
      if (active) request();
    });
    io.observe(section);
    const onScroll = () => {
      if (active) request();
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", request);
    };
  }, []);

  const text = rich(quote, { codeClassName: "font-mono" });
  const answer = (
    <>
      <blockquote className="about-h2">{text}</blockquote>
      <p className="mx-auto mt-6 max-w-[56ch] text-[15px] leading-relaxed opacity-80 md:text-[17px]">{rich(lead, { codeClassName: "font-mono" })}</p>
      <code className="about-mono mt-7 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--synapse-foreground)/0.25)] px-4 py-2">
        <span className="opacity-50">$</span> {command}
      </code>
    </>
  );
  const problems = (
    <ul className="mt-5 space-y-2">
      {reasons.map((r, i) => (
        <li key={r} className="about-mono flex gap-3 text-left">
          <span className="opacity-45">{String(i + 1).padStart(2, "0")}</span>
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );

  if (plain) {
    return (
      <section className="about-section container">
        <figure className="mx-auto max-w-4xl rounded-[20px] bg-[var(--accent)] px-6 py-16 text-center text-[var(--accent-ink)] md:px-16 md:py-24">
          <p className="about-mono opacity-70">● {eyebrow}</p>
          <div className="mx-auto mb-10 w-fit">{problems}</div>
          {answer}
        </figure>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="relative h-[250vh]">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden [perspective:1200px]">
        {[1, 0].map((i) => (
          <div
            key={i}
            ref={(el) => {
              backRefs.current[i] = el;
            }}
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 rounded-[20px] bg-[var(--accent)] opacity-0 [transform-origin:50%_0%] will-change-transform"
          />
        ))}
        <div ref={fillRef} className="absolute inset-0 bg-[var(--accent)] will-change-[clip-path]" style={{ clipPath: "inset(40% 40% round 20px)" }} />
        {/* The resting card: the question and what is broken today; screen readers read it before the answer. */}
        <div ref={labelRef} aria-hidden="true" className="pointer-events-none absolute w-[min(420px,70vw)] px-6 text-[var(--accent-ink)] md:px-8">
          <p className="about-mono">● {eyebrow}</p>
          {problems}
        </div>
        <div ref={quoteRef} className="relative mx-auto max-w-[820px] px-8 text-center text-[var(--accent-ink)] opacity-0 will-change-[filter,opacity,transform]">
          <p className="sr-only">
            {eyebrow} {reasons.join("; ")}
          </p>
          {answer}
        </div>
      </div>
    </section>
  );
}
