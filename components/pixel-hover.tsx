"use client";

/**
 * PixelHover — a pixel grid that grows out from the centre of its parent card
 * on hover / keyboard focus and shimmers while the pointer stays, then folds
 * back. Algorithm after React Bits `PixelCard` (reactbits.dev, MIT + Commons
 * Clause), reduced to an overlay so existing cards keep their markup, and
 * painted in the Signal tones only (design.md §1: the live pixel reacts to
 * the cursor). The mask keeps the middle clear so text stays readable.
 *
 * Drop it as the first child of a `relative isolate` card: it sits at
 * `-z-10`, above the card background and under the content. Idle cards run
 * no frames; reduced motion and touch-only devices get nothing.
 */

import { useEffect, useRef } from "react";

const COLORS = ["hsl(76 100% 60% / 0.55)", "hsl(76 100% 42% / 0.45)", "hsl(88 24% 73% / 0.35)"];
const GAP = 6;
const SPEED = 0.03;

interface Pixel {
  x: number;
  y: number;
  color: string;
  speed: number;
  size: number;
  step: number;
  max: number;
  delay: number;
  counter: number;
  counterStep: number;
  shimmer: boolean;
  reverse: boolean;
}

const rand = (min: number, max: number) => Math.random() * (max - min) + min;

function buildPixels(width: number, height: number): Pixel[] {
  const pixels: Pixel[] = [];
  for (let x = 0; x < width; x += GAP) {
    for (let y = 0; y < height; y += GAP) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      pixels.push({
        x,
        y,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        speed: rand(0.1, 0.9) * SPEED,
        size: 0,
        step: Math.random() * 0.4,
        max: rand(0.5, 2),
        delay: Math.sqrt(dx * dx + dy * dy),
        counter: 0,
        counterStep: Math.random() * 4 + (width + height) * 0.01,
        shimmer: false,
        reverse: false,
      });
    }
  }
  return pixels;
}

export function PixelHover() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover)").matches) return;

    let pixels: Pixel[] = [];
    let raf = 0;
    let mode: "appear" | "disappear" = "disappear";

    const resize = () => {
      const rect = host.getBoundingClientRect();
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
      pixels = buildPixels(canvas.width, canvas.height);
    };

    const frame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let idle = true;
      for (const p of pixels) {
        if (mode === "appear") {
          idle = false;
          if (p.counter <= p.delay) {
            p.counter += p.counterStep;
            continue;
          }
          if (p.size >= p.max) p.shimmer = true;
          if (p.shimmer) {
            if (p.size >= p.max) p.reverse = true;
            else if (p.size <= 0.5) p.reverse = false;
            p.size += p.reverse ? -p.speed : p.speed;
          } else {
            p.size += p.step;
          }
        } else {
          p.shimmer = false;
          p.counter = 0;
          if (p.size <= 0) continue;
          p.size = Math.max(0, p.size - 0.1);
          idle = false;
        }
        const offset = 1 - p.size / 2;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x + offset, p.y + offset, p.size, p.size);
      }
      raf = idle ? 0 : requestAnimationFrame(frame);
    };

    const run = (next: typeof mode) => {
      if (next === "appear" && !pixels.length) resize();
      mode = next;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const enter = () => run("appear");
    const leave = () => run("disappear");
    const focusOut = (e: FocusEvent) => {
      if (!host.contains(e.relatedTarget as Node | null)) leave();
    };

    const ro = new ResizeObserver(() => {
      if (pixels.length) resize();
    });
    ro.observe(host);
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("focusin", enter);
    host.addEventListener("focusout", focusOut);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("focusin", enter);
      host.removeEventListener("focusout", focusOut);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full rounded-[inherit] [mask-image:radial-gradient(farthest-side,transparent_45%,black)]" />;
}
