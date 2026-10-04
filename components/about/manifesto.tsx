"use client";

/**
 * Manifesto bento on /about. Each card rises in (500 ms, 100 ms apart within
 * its row), then its mini-visual comes alive: wires draw, a diff types, the
 * permission LEDs switch, bars grow, the number counts up. Cards carry the
 * pointer spotlight on desktop. Mini-visuals are UI primitives, aria-hidden —
 * the card text says the same thing.
 *
 * The grid adapts to 3–5 principles: with four the last row is one full-width
 * card, with three it disappears.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GhostText } from "./ghost-text";
import { finePointerDesktop, reducedMotion, useReveal } from "./motion";
import { cn } from "@/lib/utils";

export type VisualKind = "hub" | "diff" | "permissions" | "bars" | "count";

export interface Principle {
  title: string;
  body: string;
  visual: VisualKind;
}

/** 02 — a real change from the catalogue (or the first stored version when nothing changed yet). */
export interface DiffPreview {
  header: string;
  lines: Array<{ mark: " " | "+" | "−"; text: string }>;
}

/** 03 — one real entry's permissions and where each came from. */
export interface PermissionsPreview {
  name: string;
  rows: Array<{ id: string; on: boolean; via: string | null }>;
}

export interface VisualData {
  targets: string[];
  diff: DiffPreview | null;
  permissions: PermissionsPreview | null;
  permissionsPending: string;
  requested: string;
  denied: string;
  bars: number[];
  barsCaption: string;
  installs: number;
  installsLabel: string;
  installsWeek: string;
  installsNote: string;
  numberLocale: string;
}

/** Desktop placement (12 columns) for 5 / 4 / 3 cards; tablets: first card full width, then two columns. */
function placement(index: number, total: number) {
  const layouts: Record<number, string[]> = {
    5: ["xl:col-span-7 xl:row-span-2", "xl:col-span-5", "xl:col-span-5", "xl:col-span-5", "xl:col-span-7"],
    4: ["xl:col-span-7 xl:row-span-2", "xl:col-span-5", "xl:col-span-5", "xl:col-span-12"],
    3: ["xl:col-span-7 xl:row-span-2", "xl:col-span-5", "xl:col-span-5"],
  };
  const desktop = layouts[total]?.[index] ?? "xl:col-span-6";
  const tablet = index === 0 || (total === 4 && index === 3) ? "md:col-span-2" : "";
  return cn(tablet, desktop);
}

/** Stagger inside a visual row: 01 | 02 03 | 04 05. */
const ROW_DELAY = [0, 100, 200, 0, 100];

export function Manifesto({ principles, data }: { principles: Principle[]; data: VisualData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-6">
      {principles.map((p, i) => (
        <PrincipleCard key={p.visual} index={i} principle={p} data={data} className={placement(i, principles.length)} />
      ))}
    </div>
  );
}

function PrincipleCard({ index, principle, data, className }: { index: number; principle: Principle; data: VisualData; className?: string }) {
  const [ref, shown] = useReveal<HTMLElement>();
  const [live, setLive] = useState(false);
  const delay = ROW_DELAY[index] ?? 0;

  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setLive(true), reducedMotion() ? 0 : delay + 400);
    return () => window.clearTimeout(id);
  }, [shown, delay]);

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!finePointerDesktop()) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const big = index === 0;
  return (
    <article
      ref={ref}
      onPointerMove={onMove}
      className={cn("about-card about-rise spot flex flex-col p-6 md:p-8", big ? "min-h-[420px] xl:min-h-[560px]" : "min-h-[320px]", shown && "is-in", className)}
      style={{ transitionDelay: shown ? `${delay}ms, ${delay}ms, 0ms` : undefined }}
    >
      <span className="about-mono absolute right-6 top-6 text-[var(--text-2)] md:right-8 md:top-8">{String(index + 1).padStart(2, "0")}</span>
      <GhostText as="h3" text={principle.title} start={shown} delay={delay + 100} className="about-h3 max-w-[22ch] pr-10" />
      <p className="about-body mt-3 max-w-[46ch] text-[15px] md:text-base">{principle.body}</p>
      <div aria-hidden={principle.visual === "count" ? undefined : true} className={cn("mt-auto pt-8", big && "flex flex-1 flex-col justify-center", live && "viz-on")}>
        <Visual kind={principle.visual} data={data} live={live} big={big} />
      </div>
    </article>
  );
}

function Visual({ kind, data, live, big }: { kind: VisualKind; data: VisualData; live: boolean; big: boolean }) {
  switch (kind) {
    case "hub":
      return <HubVisual targets={data.targets} big={big} />;
    case "diff":
      return data.diff ? <DiffVisual diff={data.diff} /> : null;
    case "permissions":
      return data.permissions ? <PermissionsVisual preview={data.permissions} requested={data.requested} denied={data.denied} /> : <p className="about-mono text-[var(--text-2)]">{data.permissionsPending}</p>;
    case "bars":
      return <BarsVisual bars={data.bars} caption={data.barsCaption} locale={data.numberLocale} />;
    case "count":
      return <CountVisual live={live} value={data.installs} label={data.installsLabel} week={data.installsWeek} note={data.installsNote} locale={data.numberLocale} />;
  }
}

/** 01 — a lime hub wired to the agents and environments a skill installs into. */
function HubVisual({ targets, big }: { targets: string[]; big: boolean }) {
  const labels = targets.slice(0, 6);
  const left = labels.filter((_, i) => i % 2 === 0);
  const right = labels.filter((_, i) => i % 2 === 1);
  const H = big ? 320 : 200;
  const y = (i: number, n: number) => (H / (n + 1)) * (i + 1);
  const column = (items: string[], side: "l" | "r") =>
    items.map((label, i) => (
      <span
        key={label}
        className={cn("viz-pop about-mono absolute -translate-y-1/2 whitespace-nowrap rounded-full border border-[var(--line)] bg-[hsl(var(--card)/0.9)] px-2.5 py-1 text-[11px] text-[var(--text)]", side === "l" ? "left-0" : "right-0")}
        style={{ top: y(i, items.length), transitionDelay: `${400 + i * 120}ms` }}
      >
        {label}
      </span>
    ));
  return (
    <div className="relative" style={{ height: H }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
        {left.map((_, i) => (
          <path key={`l${i}`} className="viz-wire" pathLength={1} d={`M 50 ${H / 2} C 38 ${H / 2}, 30 ${y(i, left.length)}, 18 ${y(i, left.length)}`} fill="none" stroke="rgba(255,255,255,0.18)" vectorEffect="non-scaling-stroke" style={{ transitionDelay: `${i * 120}ms` }} />
        ))}
        {right.map((_, i) => (
          <path key={`r${i}`} className="viz-wire" pathLength={1} d={`M 50 ${H / 2} C 62 ${H / 2}, 70 ${y(i, right.length)}, 82 ${y(i, right.length)}`} fill="none" stroke="rgba(255,255,255,0.18)" vectorEffect="non-scaling-stroke" style={{ transitionDelay: `${60 + i * 120}ms` }} />
        ))}
      </svg>
      {column(left, "l")}
      {column(right, "r")}
      <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[14px] bg-[var(--accent)] shadow-[0_0_28px_hsl(var(--synapse)/0.35)]">
        <span className="h-6 w-6 bg-[var(--accent-ink)]" style={{ maskImage: "url(/logo-mark.png)", WebkitMaskImage: "url(/logo-mark.png)", maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }} />
      </div>
    </div>
  );
}

/** 02 — the latest real manifest change in the catalogue, typing itself in. */
function DiffVisual({ diff }: { diff: DiffPreview }) {
  let at = 250;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[hsl(var(--background)/0.6)] p-4 font-mono text-[12px] leading-6">
      <div className="viz-pop mb-2 truncate text-[var(--text-2)]">{diff.header}</div>
      {diff.lines.map((l, i) => {
        const n = l.text.length + 2;
        const dur = n * 22;
        const style = { "--n": n, "--dur": `${dur}ms`, "--dl": `${at}ms` } as CSSProperties;
        at += dur + 120;
        return (
          <span key={`${i}${l.text}`} className={cn("viz-type", l.mark === " " ? "text-[var(--text-2)]" : "text-[var(--text)]")} style={style}>
            <span className={l.mark === "+" ? "text-[var(--accent)]" : l.mark === "−" ? "text-[hsl(var(--danger))]" : undefined}>{l.mark}</span> {l.text}
          </span>
        );
      })}
    </div>
  );
}

/** 03 — what one real entry asks for: lime = requested (with where it was found), grey = not. */
function PermissionsVisual({ preview, requested, denied }: { preview: PermissionsPreview; requested: string; denied: string }) {
  return (
    <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[hsl(var(--background)/0.6)] font-mono text-[12px]">
      <li className="viz-pop truncate px-4 py-2 text-[11px] text-[var(--text-2)]">{preview.name}</li>
      {preview.rows.map((p, i) => (
        <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <span className="flex items-center gap-3 text-[var(--text)]">
            <span className="viz-led" data-on={p.on} style={{ transitionDelay: `${200 + i * 220}ms` }} />
            {p.id}
          </span>
          <span className={cn("viz-pop lowercase", p.on ? "text-[var(--text)]" : "text-[var(--text-2)]")} style={{ transitionDelay: `${260 + i * 220}ms` }}>
            {p.on ? (p.via ? `${requested} · ${p.via}` : requested) : denied}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 04 — twelve thin bars, one per week; the current week is lime. */
function BarsVisual({ bars, caption, locale }: { bars: number[]; caption: string; locale: string }) {
  const max = Math.max(1, ...bars);
  const peak = bars.indexOf(max);
  return (
    <div>
      <div className="flex h-32 items-end gap-2 pt-5">
        {bars.map((v, i) => (
          <div key={i} className="relative flex h-full flex-1 items-end">
            {/* The peak carries its number, so the scale reads without an axis. */}
            {i === peak && v > 0 && (
              <span className={cn("viz-pop absolute -top-5 font-mono text-[11px] text-[var(--text-2)] [font-variant-numeric:tabular-nums]", i === bars.length - 1 ? "right-0" : "left-0")} style={{ transitionDelay: "700ms" }}>
                {new Intl.NumberFormat(locale).format(v)}
              </span>
            )}
            <div
              className={cn("viz-bar w-full max-w-[10px] rounded-[2px]", i === bars.length - 1 ? "bg-[var(--accent)]" : "bg-white/20")}
              style={{ height: `${Math.max(3, (v / max) * 100)}%`, transitionDelay: `${i * 60}ms` }}
            />
          </div>
        ))}
      </div>
      <p className="about-mono mt-3 text-[11px] text-[var(--text-2)] md:text-[12px]">{caption}</p>
    </div>
  );
}

/** 05 — the honest number, counted up on reveal. */
function CountVisual({ live, value, label, week, note, locale }: { live: boolean; value: number; label: string; week: string; note: string; locale: string }) {
  const [shown, setShown] = useState(value);
  const started = useRef(false);
  useEffect(() => {
    if (!live || started.current || reducedMotion()) return;
    started.current = true;
    let frame = 0;
    const begin = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - begin) / 1200);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, value]);

  const format = (n: number) => new Intl.NumberFormat(locale).format(n);
  return (
    <div>
      <p className="about-mono text-[var(--text-2)]">{label}</p>
      <p className="mt-1 font-mono text-[44px] font-medium leading-none tracking-[-0.03em] text-[var(--text)] [font-variant-numeric:tabular-nums] md:text-[64px]">
        {format(shown)}
        <span className="text-[var(--accent)]">*</span>
      </p>
      <p className="about-mono mt-2 text-[var(--accent)]">{week}</p>
      <p className="about-mono mt-3 text-[11px] text-[var(--text-2)]">{note}</p>
    </div>
  );
}

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("about-fade", shown && "is-in", className)}>
      {children}
    </div>
  );
}
