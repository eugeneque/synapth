"use client";

/**
 * PixelField — the site-wide reactive background.
 *
 * A fixed canvas draws a dim dot grid; cells near the pointer charge up,
 * turn synapse-green and fade out with a trailing decay, so the background
 * "remembers" where the cursor has been. The static grid is rasterised once
 * per resize; every frame only the energised cells are repainted.
 */

import { useEffect, useRef } from "react";

const CELL = 14;
const DOT = 1.5;
const RADIUS = 240;
const DECAY = 0.9;
const ACCENT = [198, 255, 51] as const; // hsl(76 100% 60%)

export function PixelField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0;
    let rows = 0;
    let energy = new Float32Array(0);
    let base: HTMLCanvasElement | null = null;
    let raf = 0;
    let dpr = 1;
    const mouse = { x: -1e4, y: -1e4, active: false };

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // A hidden pane can report 0×0; a zero-sized canvas cannot be drawn.
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL) + 1;
      energy = new Float32Array(cols * rows);

      // Static layer: the resting grid.
      base = document.createElement("canvas");
      base.width = canvas!.width;
      base.height = canvas!.height;
      const b = base.getContext("2d")!;
      b.scale(dpr, dpr);
      b.fillStyle = "rgba(235, 238, 230, 0.07)";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          b.fillRect(x * CELL - DOT / 2, y * CELL - DOT / 2, DOT, DOT);
        }
      }
      draw();
    }

    function draw() {
      if (!base || base.width === 0 || base.height === 0) return;
      const ctx2 = ctx!;
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      ctx2.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx2.drawImage(base, 0, 0);
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

      const t = performance.now() / 1000;
      const r2 = RADIUS * RADIUS;
      const x0 = Math.max(0, Math.floor((mouse.x - RADIUS) / CELL));
      const x1 = Math.min(cols - 1, Math.ceil((mouse.x + RADIUS) / CELL));
      const y0 = Math.max(0, Math.floor((mouse.y - RADIUS) / CELL));
      const y1 = Math.min(rows - 1, Math.ceil((mouse.y + RADIUS) / CELL));

      // Charge cells inside the spotlight.
      if (mouse.active) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x * CELL - mouse.x;
            const dy = y * CELL - mouse.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const k = 1 - Math.sqrt(d2) / RADIUS;
            const v = k * k * (0.85 + 0.15 * Math.sin(t * 3 + x * 0.7 + y * 0.5));
            const i = y * cols + x;
            if (v > energy[i]) energy[i] = v;
          }
        }
      }

      // Paint and decay every energised cell.
      let alive = false;
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i];
        if (e < 0.015) {
          energy[i] = 0;
          continue;
        }
        alive = true;
        const x = (i % cols) * CELL;
        const y = Math.floor(i / cols) * CELL;
        const size = DOT + e * 3.5;
        const mix = Math.min(1, e * 1.4);
        const r = Math.round(235 + (ACCENT[0] - 235) * mix);
        const g = Math.round(238 + (ACCENT[1] - 238) * mix);
        const b = Math.round(230 + (ACCENT[2] - 230) * mix);
        ctx2.fillStyle = `rgba(${r},${g},${b},${0.08 + e * 0.9})`;
        ctx2.fillRect(x - size / 2, y - size / 2, size, size);
        energy[i] = e * DECAY;
      }

      if (!reduced && (alive || mouse.active)) raf = requestAnimationFrame(draw);
      else raf = 0;
    }

    function kick() {
      if (!raf && !reduced) raf = requestAnimationFrame(draw);
    }

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      kick();
    };
    const onLeave = () => {
      mouse.active = false;
      kick();
    };
    const onVisibility = () => {
      if (document.hidden && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else kick();
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" />;
}
