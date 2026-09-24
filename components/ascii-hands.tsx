"use client";

/**
 * AsciiHands — the hero illustration.
 *
 * Two dot-matrix hands (the Creation of Adam detail) reach for each other
 * across the viewport. The artwork is a halftone: `/hero-hands.png` — the
 * hands of Michelangelo's fresco (Wikimedia Commons, public domain), skin
 * segmented and shaded on black — is sampled once into a cell grid where
 * each cell's luminance becomes the dot radius, so the painting's shading
 * turns into a row-screen of dots. A dithered
 * "dust" halo scatters around the silhouette. Every frame the cells inside
 * the pointer's spotlight turn into ASCII glyphs from a density ramp and
 * brighten; the hands drift a few pixels toward the cursor, and when it nears
 * the gap a pixel "synapse" arcs between the fingertips.
 *
 * Nothing is drawn until the artwork has loaded; the canvas then fades in.
 * The hands span the full viewport width (slightly bleeding off the edges)
 * and sit on the hero's bottom edge.
 */

import { useEffect, useRef } from "react";

const CELL = 10; // square grid: round dots align in rows like the reference
const RAMP = " .:-=+*#%@";
const LIGHT_RADIUS = 220;
const SPARK_RADIUS = 300;
const ACCENT = [198, 255, 51] as const;
const DIM = [92, 106, 78] as const;
const MID = [168, 196, 120] as const;
const ART_SRC = "/hero-hands.png";
/** Space between the hands and the hero's bottom edge (the "move the cursor" hint lives there). */
const BOTTOM_GAP = 56;

interface Geometry {
  cols: number;
  rows: number;
  /** 0..1 dot weight per cell (halftone). */
  lum: Float32Array;
  /** 0..1 scattered dust around the silhouette. */
  dust: Float32Array;
  left: { x: number; y: number };
  right: { x: number; y: number };
}

/** Deterministic per-cell noise so the dust does not flicker between frames. */
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Luminance of the artwork per pixel plus the bounding box of the lit area. */
function analyse(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width,
    y0 = c.height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * (d[i + 3] / 255);
      if (l > 60) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return { canvas: c, box: { x: 0, y: 0, w: c.width, h: c.height } };
  return { canvas: c, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

function buildGeometry(w: number, h: number, art: ReturnType<typeof analyse>): Geometry {
  const cols = Math.ceil(w / CELL) + 1;
  const rows = Math.ceil(h / CELL) + 1;
  const mobile = w < 768;

  // Supersample 2× then box-average so the reference's own dot screen does not moiré with ours.
  const ss = 2;
  const off = document.createElement("canvas");
  off.width = cols * ss;
  off.height = rows * ss;
  const g = off.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.scale(ss / CELL, ss / CELL);

  const { canvas, box } = art;
  // Edge to edge: the forearms run off both sides of the viewport.
  const targetW = w * (mobile ? 1.15 : 1.06);
  const s = targetW / box.w;
  const dw = box.w * s;
  const dh = box.h * s;
  // Rest on the bottom edge, leaving room for the hint line under the hands.
  const bottom = h - (mobile ? 16 : BOTTOM_GAP);
  g.drawImage(canvas, box.x, box.y, box.w, box.h, w / 2 - dw / 2, bottom - dh, dw, dh);

  const d = g.getImageData(0, 0, off.width, off.height).data;
  const lum = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      for (let yy = 0; yy < ss; yy++) {
        for (let xx = 0; xx < ss; xx++) {
          const i = ((y * ss + yy) * off.width + (x * ss + xx)) * 4;
          sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * (d[i + 3] / 255);
        }
      }
      const l = sum / (ss * ss) / 255;
      lum[y * cols + x] = l < 0.08 ? 0 : Math.min(1, l ** 0.85);
    }
  }

  // Dust: sparse dots scattered around the silhouette, denser near it (the dithered-cloud look).
  const dust = new Float32Array(cols * rows);
  const R = 7;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (lum[i] > 0) continue;
      let near = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) continue;
          const l = lum[yy * cols + xx];
          if (l <= 0) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > R) continue;
          near = Math.max(near, l * (1 - dist / R));
        }
      }
      if (near <= 0) continue;
      const p = near * near * 0.55;
      const r = hash(x, y);
      if (r < p) dust[i] = 0.25 + 0.75 * (1 - r / p) * near;
    }
  }

  // Fingertips: the lit cell closest to the centre line on each side.
  const tip = (side: -1 | 1) => {
    let best = { x: side < 0 ? -1 : cols, y: 0 };
    let ys: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (lum[y * cols + x] < 0.3) continue;
        if (side < 0 && x <= cols / 2 && x > best.x) {
          best = { x, y };
          ys = [y];
        } else if (side > 0 && x >= cols / 2 && x < best.x) {
          best = { x, y };
          ys = [y];
        } else if (x === best.x) ys.push(y);
      }
    }
    ys.sort((a, b) => a - b);
    const y = ys.length ? ys[Math.floor(ys.length / 2)] : rows * 0.8;
    const bx = best.x < 0 || best.x >= cols ? (side < 0 ? cols * 0.42 : cols * 0.58) : best.x;
    return { x: bx * CELL + CELL / 2, y: y * CELL + CELL / 2 };
  };

  return { cols, rows, lum, dust, left: tip(-1), right: tip(1) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AsciiHands({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const monoFamily = getComputedStyle(document.body).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";
    let art: ReturnType<typeof analyse> | null = null;
    let geo: Geometry | null = null;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let frame = 0;
    let rect = canvas.getBoundingClientRect();
    const mouse = { x: -1e4, y: -1e4 };
    const drift = { x: 0, y: 0 };
    const jitter = new Float32Array(32);
    const LEVELS = 12;
    const paths: Path2D[] = [];

    function resize() {
      rect = canvas!.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      geo = art ? buildGeometry(w, h, art) : null;
      if (reduced) draw();
    }

    function draw() {
      if (!geo) {
        // Nothing to draw until the artwork has loaded; release the loop so `kick()` can restart it.
        raf = 0;
        return;
      }
      frame++;
      const t = performance.now() / 1000;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);

      // Hands lean toward the pointer.
      const tx = Math.max(-1, Math.min(1, (mouse.x - w / 2) / (w / 2))) * 10;
      const ty = Math.max(-1, Math.min(1, (mouse.y - h / 2) / (h / 2))) * 6;
      drift.x += (tx - drift.x) * 0.06;
      drift.y += (ty - drift.y) * 0.06;

      const { cols, rows, lum, dust } = geo;
      const r2 = LIGHT_RADIUS * LIGHT_RADIUS;
      for (let i = 0; i < LEVELS; i++) paths[i] = new Path2D();
      const glyphs: Array<{ ch: string; x: number; y: number; color: string }> = [];

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const l = lum[i];
          const du = dust[i];
          if (l <= 0 && du <= 0) continue;
          const cx = x * CELL + CELL / 2 + drift.x;
          const cy = y * CELL + CELL / 2 + drift.y;
          const dx = cx - mouse.x;
          const dy = cy - mouse.y;
          const d2 = dx * dx + dy * dy;
          const light = d2 < r2 ? (1 - Math.sqrt(d2) / LIGHT_RADIUS) ** 2 : 0;

          if (l <= 0) {
            // Dust: 1px specks, brighter and slightly larger inside the spotlight.
            const level = Math.min(LEVELS - 1, Math.floor((du * 0.35 + light * 0.6) * (LEVELS - 1)));
            const s = 1 + light * 1.5;
            paths[level].rect(cx - s / 2, cy - s / 2, s, s);
            continue;
          }

          const shimmer = 0.5 + 0.5 * Math.sin(t * 1.3 + x * 0.29 + y * 0.23);
          const v = Math.min(1, l * (0.82 + shimmer * 0.18) + light * 0.6);

          if (light > 0.06) {
            // Inside the spotlight the dot becomes a character.
            const mix = Math.min(1, v * 1.1);
            const hot = Math.max(0, (light - 0.7) / 0.3);
            const r = DIM[0] + (ACCENT[0] - DIM[0]) * mix;
            const g = DIM[1] + (ACCENT[1] - DIM[1]) * mix;
            const b = DIM[2] + (ACCENT[2] - DIM[2]) * mix;
            glyphs.push({
              ch: RAMP[Math.min(RAMP.length - 1, Math.floor(v * (RAMP.length - 1)))],
              x: cx,
              y: cy,
              color: `rgba(${r + (255 - r) * hot},${g + (255 - g) * hot},${b + (255 - b) * hot},${0.6 + light * 0.4})`,
            });
          } else {
            const level = Math.min(LEVELS - 1, Math.floor(v * (LEVELS - 1)));
            const radius = 0.8 + v * 3.2;
            paths[level].moveTo(cx + radius, cy);
            paths[level].arc(cx, cy, radius, 0, Math.PI * 2);
          }
        }
      }

      // One fill per brightness level instead of one per dot.
      // Dark moss → pale green → acid only at the very top of the ramp.
      for (let i = 0; i < LEVELS; i++) {
        const v = i / (LEVELS - 1);
        const [c0, c1, k] = v < 0.7 ? [DIM, MID, v / 0.7] : [MID, ACCENT, (v - 0.7) / 0.3];
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * k);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * k);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * k);
        ctx!.fillStyle = `rgba(${r},${g},${b},${0.4 + v * 0.6})`;
        ctx!.fill(paths[i]);
      }

      if (glyphs.length) {
        ctx!.font = `600 11px ${monoFamily}`;
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        for (const gl of glyphs) {
          ctx!.fillStyle = gl.color;
          ctx!.fillText(gl.ch, gl.x, gl.y);
        }
      }

      drawSpark(t);
      if (!reduced && visible) raf = requestAnimationFrame(draw);
      else raf = 0;
    }

    function drawSpark(t: number) {
      if (!geo) return;
      const L = { x: geo.left.x + drift.x, y: geo.left.y + drift.y };
      const R = { x: geo.right.x + drift.x, y: geo.right.y + drift.y };
      const mx = (L.x + R.x) / 2;
      const my = (L.y + R.y) / 2;
      const d = Math.hypot(mouse.x - mx, mouse.y - my);
      const near = d < SPARK_RADIUS ? (1 - d / SPARK_RADIUS) ** 2 : 0;
      const ambient = 0.08 + 0.06 * Math.sin(t * 2.2);
      const I = Math.min(1, ambient + near);
      if (I < 0.05) return;

      if (frame % 3 === 0 || reduced) for (let i = 0; i < jitter.length; i++) jitter[i] = (Math.random() - 0.5) * 2;

      const gapLen = Math.max(1, Math.hypot(R.x - L.x, R.y - L.y));
      const n = 26;
      const nx = -(R.y - L.y) / gapLen;
      const ny = (R.x - L.x) / gapLen;
      ctx!.fillStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${0.25 + I * 0.75})`;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const env = Math.sin(k * Math.PI); // no jitter at the fingertips
        const j = jitter[i % jitter.length] * env * gapLen * 0.12 * I;
        const px = L.x + (R.x - L.x) * k + nx * j;
        const py = L.y + (R.y - L.y) * k + ny * j;
        const s = 2 + I * 2.5 * env;
        ctx!.fillRect(px - s / 2, py - s / 2, s, s);
      }

      for (const p of [L, R]) {
        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, 28 + I * 30);
        grad.addColorStop(0, `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${0.35 * I})`);
        grad.addColorStop(1, "rgba(198,255,51,0)");
        ctx!.fillStyle = grad;
        ctx!.fillRect(p.x - 60, p.y - 60, 120, 120);
      }
    }

    function kick() {
      if (!raf && !reduced && visible) raf = requestAnimationFrame(draw);
    }

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onScroll = () => {
      rect = canvas!.getBoundingClientRect();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    });

    // The artwork arrives asynchronously; the canvas stays empty until then and fades in.
    const img = new Image();
    img.onload = () => {
      art = analyse(img);
      resize();
      canvas.style.opacity = "1";
      kick();
    };
    img.src = ART_SRC;

    document.fonts?.ready.then(() => resize());

    resize();
    io.observe(canvas);
    kick();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      img.onload = null;
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} style={{ opacity: 0, transition: "opacity 600ms ease-out" }} />;
}
