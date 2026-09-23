"use client";

/**
 * PixelField — the site-wide reactive background.
 *
 * A fixed canvas draws a dim dot grid. A soft diagonal wave rolls across it,
 * shading the dots from near-black to grey. Inside glow zones (elements marked
 * `data-pixel-glow`, i.e. the home hero) the wave rests and the pointer takes
 * over instead: nearby cells charge up, turn synapse-green and fade out with a
 * trailing decay.
 *
 * The dot grid is rasterised once per resize as an alpha mask; each frame a
 * banded gradient is painted and masked by it (two blits, no per-dot work),
 * then only the energised cells are repainted on top.
 */

import { useEffect, useRef } from "react";

const CELL = 14;
const DOT = 1.5;
const RADIUS = 240;
const DECAY = 0.9;
const ACCENT = [198, 255, 51] as const; // hsl(76 100% 60%)
const DOT_RGB = "235, 238, 230";
const REST_ALPHA = 0.07;
/** Wave: dots swing between these alphas — dark to grey, never bright. */
const WAVE_MIN = 0.045;
const WAVE_MAX = 0.17;
const WAVELENGTH = 720;
const WAVE_SPEED = 90; // px/s along the wave direction
const WAVE_ANGLE = Math.PI / 5;
const FRAME_MS = 1000 / 30; // the wave alone is slow; 30 fps is plenty

function glowZones(): DOMRect[] {
  return Array.from(document.querySelectorAll("[data-pixel-glow]"), (el) => el.getBoundingClientRect()).filter(
    (r) => r.bottom > 0 && r.top < window.innerHeight && r.width > 0,
  );
}

function inside(r: DOMRect, x: number, y: number) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

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
    let mask: HTMLCanvasElement | null = null;
    let last = 0;
    /** Glow in flight: run at full rate so the decay trail keeps its timing. */
    let hot = false;
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

      // Static layer: the dot grid as an opaque mask; colour and alpha come per frame.
      mask = document.createElement("canvas");
      mask.width = canvas!.width;
      mask.height = canvas!.height;
      const b = mask.getContext("2d")!;
      b.scale(dpr, dpr);
      b.fillStyle = "#fff";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          b.fillRect(x * CELL - DOT / 2, y * CELL - DOT / 2, DOT, DOT);
        }
      }
      // Repaint now; cancel the pending frame so the loop does not fork.
      cancelAnimationFrame(raf);
      last = 0;
      draw();
    }

    /** Banded gradient along WAVE_ANGLE, shifted by time; one stop every 1/8 wavelength. */
    function waveFill(w: number, h: number, t: number) {
      const cos = Math.cos(WAVE_ANGLE);
      const sin = Math.sin(WAVE_ANGLE);
      const span = w * cos + h * sin;
      const grad = ctx!.createLinearGradient(0, 0, span * cos, span * sin);
      const shift = (t * WAVE_SPEED) % WAVELENGTH;
      const steps = Math.ceil((span / WAVELENGTH) * 8);
      for (let k = 0; k <= steps; k++) {
        const s = (k / steps) * span;
        const phase = ((s - shift) / WAVELENGTH) * Math.PI * 2;
        // Squared cosine: a narrow grey crest over a long dark trough.
        const crest = ((1 + Math.cos(phase)) / 2) ** 2;
        const a = reduced ? REST_ALPHA : WAVE_MIN + (WAVE_MAX - WAVE_MIN) * crest;
        grad.addColorStop(k / steps, `rgba(${DOT_RGB},${a.toFixed(3)})`);
      }
      return grad;
    }

    function draw(now = performance.now()) {
      if (!mask || mask.width === 0 || mask.height === 0) return;
      if (!reduced && !hot && now - last < FRAME_MS) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = now;
      const ctx2 = ctx!;
      const w = canvas!.width / dpr;
      const h = canvas!.height / dpr;
      const zones = glowZones();

      // Wave layer, flat inside glow zones, cut to the dot grid.
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.globalCompositeOperation = "source-over";
      ctx2.clearRect(0, 0, w, h);
      ctx2.fillStyle = waveFill(w, h, now / 1000);
      ctx2.fillRect(0, 0, w, h);
      ctx2.fillStyle = `rgba(${DOT_RGB},${REST_ALPHA})`;
      for (const z of zones) {
        ctx2.clearRect(z.left, z.top, z.width, z.height);
        ctx2.fillRect(z.left, z.top, z.width, z.height);
      }
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      ctx2.globalCompositeOperation = "destination-in";
      ctx2.drawImage(mask, 0, 0);
      ctx2.globalCompositeOperation = "source-over";
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

      const t = performance.now() / 1000;
      const r2 = RADIUS * RADIUS;
      const x0 = Math.max(0, Math.floor((mouse.x - RADIUS) / CELL));
      const x1 = Math.min(cols - 1, Math.ceil((mouse.x + RADIUS) / CELL));
      const y0 = Math.max(0, Math.floor((mouse.y - RADIUS) / CELL));
      const y1 = Math.min(rows - 1, Math.ceil((mouse.y + RADIUS) / CELL));

      // Charge cells inside the spotlight — only within the glow zone under the pointer.
      const zone = mouse.active ? zones.find((z) => inside(z, mouse.x, mouse.y)) : undefined;
      if (zone) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (!inside(zone, x * CELL, y * CELL)) continue;
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

      hot = alive || Boolean(zone);
      // The wave keeps the loop running; with reduced motion only the glow decay does.
      raf = reduced ? (alive || zone ? requestAnimationFrame(draw) : 0) : requestAnimationFrame(draw);
    }

    function kick() {
      if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
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
    // Glow zones move with the page; with the loop idle (reduced motion) repaint on scroll.
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" />;
}
