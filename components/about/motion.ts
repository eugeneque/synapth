"use client";

/** Shared motion helpers for the /about islands. */

import { useEffect, useRef, useState } from "react";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Desktop with a real pointer: tilt and spotlight only run here (≥ 1280 px). */
export function finePointerDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1280px) and (hover: hover) and (pointer: fine)").matches;
}

/** `true` once the element is 20% inside the viewport; fires once. */
export function useReveal<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, shown] as const;
}

/** `{name}` interpolation for dictionary strings handed down as props. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
