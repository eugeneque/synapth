"use client";

/**
 * Scramble — mono text that settles left to right out of random characters.
 * Random glyphs match the script of the character they stand in for (Latin,
 * Cyrillic or CJK), so a Russian label never flickers through Latin and the
 * mono width never jumps. Runs once on reveal (400–600 ms) and again, shorter,
 * whenever the text changes (locale switch).
 */

import { useEffect, useRef, useState } from "react";
import { reducedMotion, useReveal } from "./motion";
import { cn } from "@/lib/utils";

const LATIN = "abcdefghijklmnopqrstuvwxyz0123456789/_-";
const CYRILLIC = "абвгдежзийклмнопрстуфхцчшщыэюяіїє0123456789/_-";
const HAN = "的一是在不了有人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经";

function randomFor(ch: string): string {
  if (ch === " " || ch === " " || ch === "·" || ch === ":" || ch === "." || ch === ",") return ch;
  const set = /[　-鿿]/.test(ch) ? HAN : /[Ѐ-ӿ]/.test(ch) ? CYRILLIC : LATIN;
  return set[Math.floor(Math.random() * set.length)];
}

export function scrambleFrame(text: string, progress: number): string {
  const chars = Array.from(text);
  const fixed = Math.floor(progress * chars.length);
  return chars.map((ch, i) => (i < fixed ? ch : randomFor(ch))).join("");
}

interface Props {
  text: string;
  className?: string;
  /** First-run duration, ms. */
  duration?: number;
  delay?: number;
  /** Controlled start; defaults to the element's own visibility. */
  start?: boolean;
}

export function Scramble({ text, className, duration = 500, delay = 0, start }: Props) {
  const [ref, visible] = useReveal<HTMLSpanElement>();
  const go = start ?? visible;
  const [shown, setShown] = useState(text);
  const [on, setOn] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!go) return;
    const first = !ran.current;
    ran.current = true;
    if (reducedMotion()) {
      setShown(text);
      setOn(true);
      return;
    }
    const total = first ? duration : 300;
    let frame = 0;
    let begin = 0;
    const timer = window.setTimeout(
      () => {
        setShown(scrambleFrame(text, 0));
        setOn(true);
        const tick = (now: number) => {
          if (!begin) begin = now;
          const p = Math.min(1, (now - begin) / total);
          setShown(p >= 1 ? text : scrambleFrame(text, p));
          if (p < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      first ? delay : 0,
    );
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [go, text, duration, delay]);

  return (
    <span ref={ref} className={cn("scr", on && "is-in", className)}>
      <span className="sr-only">{text}</span>
      {/* Until the first run the prop is the source of truth (it may change while off-screen). */}
      <span aria-hidden="true">{on ? shown : text}</span>
    </span>
  );
}
