"use client";

/**
 * GhostText — the /about title treatment. The string is split into letters;
 * each rises out of a 12px blur while two 30% copies above and below converge
 * into it (CSS in `app/(site)/about/about.css`). `*word*` marks the one serif
 * accent word. Screen readers get the plain sentence; the letters are hidden.
 * A later text change (locale switch) swaps with a short blur instead of
 * replaying the entrance.
 */

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useReveal } from "./motion";
import { cn } from "@/lib/utils";

const CJK = /[　-鿿＀-￯]/;
/** Longer titles would take seconds to settle; later letters share the last delay. */
const MAX_STAGGER = 40;

interface Char {
  ch: string;
  em: boolean;
}

/** Words split on regular spaces only (NBSP keeps short words glued); CJK characters are words of their own. */
function words(text: string): Char[][] {
  const out: Char[][] = [];
  let word: Char[] = [];
  let em = false;
  const flush = () => {
    if (word.length) out.push(word);
    word = [];
  };
  for (const ch of text) {
    if (ch === "*") {
      em = !em;
      continue;
    }
    if (ch === " ") {
      flush();
      out.push([]); // space marker
      continue;
    }
    if (CJK.test(ch)) {
      flush();
      out.push([{ ch, em }]);
      continue;
    }
    word.push({ ch, em });
  }
  flush();
  return out;
}

export function plain(text: string) {
  return text.replace(/\*/g, "");
}

interface Props {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "blockquote";
  className?: string;
  /** Extra delay before the first letter, ms. */
  delay?: number;
  /** Controlled start (e.g. the parent card's reveal); defaults to the element's own visibility. */
  start?: boolean;
}

export function GhostText({ text, as = "h2", className, delay = 0, start }: Props) {
  const [ref, visible] = useReveal<HTMLElement>();
  const go = start ?? visible;
  const [mode, setMode] = useState<"idle" | "in" | "swap">("idle");
  const first = useRef(text);

  useEffect(() => {
    if (go) setMode((m) => (m === "idle" ? "in" : m));
  }, [go]);

  useEffect(() => {
    if (text === first.current) return;
    first.current = text;
    setMode((m) => (m === "idle" ? m : "swap"));
  }, [text]);

  let i = 0;
  const nodes: ReactNode[] = words(text).map((word, w) => {
    if (!word.length) return " ";
    // Group consecutive letters by the em flag so the serif word stays one <em>.
    const groups: { em: boolean; chars: string[] }[] = [];
    for (const c of word) {
      const last = groups[groups.length - 1];
      if (last && last.em === c.em) last.chars.push(c.ch);
      else groups.push({ em: c.em, chars: [c.ch] });
    }
    return (
      <span key={w} className="ghost-w">
        {groups.map((g, gi) => {
          const letters = g.chars.map((ch) => {
            const idx = Math.min(i++, MAX_STAGGER);
            return (
              <span key={i} className="gl" data-c={ch} style={{ "--i": idx } as CSSProperties}>
                {ch}
              </span>
            );
          });
          return g.em ? <em key={gi}>{letters}</em> : <span key={gi}>{letters}</span>;
        })}
      </span>
    );
  });

  return createElement(
    as,
    { ref, className: cn("ghost", mode === "in" && "is-in", mode === "swap" && "is-swap", className), style: { "--d": `${delay}ms` } as CSSProperties },
    <span className="sr-only">{plain(text)}</span>,
    <span aria-hidden="true" key={mode === "swap" ? text : "in"}>
      {nodes}
    </span>,
  );
}
