"use client";

/**
 * SynapseGraph — the first-screen card on /about: an agent chip in the centre,
 * skills (round) and MCP servers (square, with a service icon) around it.
 *
 * On load the agent appears, then satellites one by one while their links draw
 * in towards the centre. Afterwards an impulse — a lime dot with a short trail —
 * runs from a random satellite to the agent every 1.5–2.5 s; on arrival the
 * chip pulses, the link flashes and a line is scrambled into the log. The
 * loop pauses off-screen and on a hidden tab. On desktop the card tilts after
 * the pointer (≤ 4°) and hovering a node shows "name · version · type".
 *
 * Decorative: the whole graph is aria-hidden, `describe` carries its meaning.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Database, Github, MessageSquare } from "lucide-react";
import { Scramble } from "./scramble";
import { fill, finePointerDesktop, reducedMotion } from "./motion";
import { cn } from "@/lib/utils";

export interface GraphCopy {
  agent: string;
  summary: string;
  status: string;
  skill: string;
  mcp: string;
  event: string;
  ms: string;
  describe: string;
}

type Kind = "skill" | "mcp";

interface Node {
  name: string;
  version: string;
  kind: Kind;
  x: number;
  y: number;
  icon?: typeof Github;
  /** Dropped on phones (< 768 px), leaving five satellites. */
  desktopOnly?: boolean;
}

// Illustrative agent; names and versions are never translated.
const W = 800;
const H = 480;
const CX = 400;
const CY = 240;
const NODES: Node[] = [
  { name: "pdf-reading", version: "1.4.2", kind: "skill", x: 150, y: 96 },
  { name: "github-mcp", version: "0.9.1", kind: "mcp", x: 640, y: 92, icon: Github },
  { name: "web-search", version: "2.1.0", kind: "skill", x: 650, y: 262 },
  { name: "postgres-mcp", version: "1.2.0", kind: "mcp", x: 585, y: 404, icon: Database },
  { name: "summarize", version: "0.6.3", kind: "skill", x: 205, y: 398 },
  { name: "code-review", version: "1.0.4", kind: "skill", x: 96, y: 250, desktopOnly: true },
  { name: "slack-mcp", version: "0.4.0", kind: "mcp", x: 398, y: 52, icon: MessageSquare, desktopOnly: true },
];
const SKILLS = NODES.filter((n) => n.kind === "skill").length;
const MCPS = NODES.length - SKILLS;

/** Horizontal S-curve from the satellite into the agent. */
function linkPath(n: Node) {
  const mx = (n.x + CX) / 2;
  return `M ${n.x} ${n.y} C ${mx} ${n.y}, ${mx} ${CY}, ${CX} ${CY}`;
}

const FLIGHT_MS = 900;
const TRAIL = 24;

interface LogRow {
  id: number;
  time: string;
  kind: Kind;
  name: string;
  ms: number;
}

function clock(d = new Date()) {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function SynapseGraph({ copy, agentName }: { copy: GraphCopy; agentName: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<(SVGPathElement | null)[]>([]);
  const trailRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const [assembled, setAssembled] = useState(false);
  /** Assembly finished: per-node delays stop applying to hover/flash transitions. */
  const [settled, setSettled] = useState(false);
  const [still, setStill] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const seq = useRef(0);

  const push = useCallback((n: Node) => {
    const row: LogRow = { id: ++seq.current, time: clock(), kind: n.kind, name: n.name, ms: 18 + Math.round(Math.random() * 70) };
    setLog((rows) => [row, ...rows].slice(0, 3));
  }, []);

  // Assembly + the seed log (client-only: the clock would not match the server render).
  useEffect(() => {
    const rm = reducedMotion();
    setStill(rm);
    const now = Date.now();
    setLog(
      [NODES[4], NODES[1], NODES[0]].map((n, i) => ({ id: ++seq.current, time: clock(new Date(now - (i + 1) * 2100)), kind: n.kind, name: n.name, ms: [42, 61, 38][i] })),
    );
    const id = requestAnimationFrame(() => setAssembled(true));
    const done = window.setTimeout(() => setSettled(true), 150 + NODES.length * 120 + 700);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(done);
    };
  }, []);

  // Impulse loop.
  useEffect(() => {
    if (!assembled || still) return;
    const card = cardRef.current;
    if (!card) return;
    let visible = true;
    let timer = 0;
    let raf = 0;
    let flashTimer = 0;
    const mobile = window.matchMedia("(max-width: 767px)");

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, delay);
    };

    function fire() {
      if (!visible || document.hidden) return; // resumed by the observers below
      const pool = NODES.map((n, i) => ({ n, i })).filter(({ n }) => !(mobile.matches && n.desktopOnly));
      const { n, i } = pool[Math.floor(Math.random() * pool.length)];
      const link = linkRefs.current[i];
      const trail = trailRef.current;
      const head = headRef.current;
      if (!link || !trail || !head) return schedule(1500);
      const len = link.getTotalLength();
      trail.setAttribute("d", link.getAttribute("d") ?? "");
      trail.style.strokeDasharray = `${TRAIL} ${len + TRAIL}`;
      trail.style.opacity = "1";
      head.style.opacity = "1";
      const begin = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - begin) / FLIGHT_MS);
        const at = easeInOut(p) * len;
        const pt = link.getPointAtLength(at);
        head.setAttribute("cx", String(pt.x));
        head.setAttribute("cy", String(pt.y));
        trail.style.strokeDashoffset = String(TRAIL - at);
        if (p < 1) {
          raf = requestAnimationFrame(step);
          return;
        }
        trail.style.opacity = "0";
        head.style.opacity = "0";
        chipRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        setFlash(i);
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setFlash(null), 450);
        push(n);
        schedule(1500 + Math.random() * 1000);
      };
      raf = requestAnimationFrame(step);
    }

    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = Boolean(entry?.isIntersecting);
      if (visible && !was) schedule(600);
    });
    io.observe(card);
    const onVisibility = () => {
      if (!document.hidden) schedule(600);
    };
    document.addEventListener("visibilitychange", onVisibility);
    // First impulse once the last link has drawn in.
    schedule(150 + NODES.length * 120 + 700);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(timer);
      window.clearTimeout(flashTimer);
      cancelAnimationFrame(raf);
    };
  }, [assembled, still, push]);

  // Tilt after the pointer, desktop only.
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || still || !finePointerDesktop()) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateX(${(-py * 8).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    if (cardRef.current) cardRef.current.style.transform = "";
    setHover(null);
  };

  const lit = (i: number) => still || hover === i || flash === i;

  return (
    <div className="[perspective:1200px]">
      <p className="sr-only">{copy.describe}</p>
      <div ref={cardRef} onPointerMove={onMove} onPointerLeave={onLeave} aria-hidden="true" className="about-card overflow-hidden transition-transform duration-150 ease-out [transform-style:preserve-3d]">
        <div className="about-mono flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 md:px-5">
          <span className="truncate text-[var(--text-2)]">
            <Scramble text={fill(copy.agent, { name: agentName })} start={assembled} /> <span className="hidden sm:inline">· {fill(copy.summary, { skills: SKILLS, mcp: MCPS })}</span>
          </span>
          <span className="about-chip shrink-0">
            <span className="about-pulse" /> <Scramble text={copy.status} start={assembled} delay={200} />
          </span>
        </div>

        <div className="relative aspect-[4/3] sm:aspect-[5/3]" style={{ containerType: "inline-size" } as CSSProperties}>
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {NODES.map((n, i) => (
              <path
                key={n.name}
                ref={(el) => {
                  linkRefs.current[i] = el;
                }}
                d={linkPath(n)}
                pathLength={1}
                fill="none"
                vectorEffect="non-scaling-stroke"
                className={cn("transition-[stroke,stroke-dashoffset,opacity] [transition-timing-function:var(--ease)]", n.desktopOnly && "max-md:hidden")}
                style={{
                  stroke: lit(i) ? "hsl(var(--synapse) / 0.9)" : "rgba(255,255,255,0.14)",
                  strokeWidth: 1,
                  strokeDasharray: 1,
                  strokeDashoffset: assembled || still ? 0 : 1,
                  opacity: still && hover !== null && hover !== i ? 0.35 : 1,
                  transitionDuration: !assembled || still ? "0ms" : settled ? (flash === i ? "120ms" : "400ms") : "600ms",
                  transitionDelay: assembled && !settled ? `${150 + i * 120}ms` : "0ms",
                }}
              />
            ))}
            <path ref={trailRef} fill="none" stroke="hsl(var(--synapse))" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ opacity: 0, filter: "drop-shadow(0 0 3px hsl(var(--synapse)))" }} />
            <circle ref={headRef} r={3} cx={-10} cy={-10} fill="hsl(var(--synapse))" style={{ opacity: 0, filter: "drop-shadow(0 0 4px hsl(var(--synapse)))" }} />
          </svg>

          {/* Agent chip. */}
          <div className="absolute" style={{ left: `${(CX / W) * 100}%`, top: `${(CY / H) * 100}%`, transform: "translate(-50%, -50%)" }}>
            <div
              ref={chipRef}
              className={cn("relative flex h-14 w-14 items-center justify-center rounded-[16px] bg-[var(--accent)] transition-[opacity,transform] duration-500 [transition-timing-function:var(--ease)] md:h-16 md:w-16", assembled || still ? "scale-100 opacity-100" : "scale-75 opacity-0")}
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.18), 0 10px 30px -6px rgba(0,0,0,0.7), 0 0 36px hsl(var(--synapse) / 0.35)" }}
            >
              <span className="h-8 w-8 bg-[var(--accent-ink)] md:h-9 md:w-9" style={{ maskImage: "url(/logo-mark.png)", WebkitMaskImage: "url(/logo-mark.png)", maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center" }} />
            </div>
          </div>

          {/* Satellites. */}
          {NODES.map((n, i) => {
            const Icon = n.icon;
            return (
              <div
                key={n.name}
                className={cn("absolute z-10", n.desktopOnly && "max-md:hidden")}
                style={{ left: `${(n.x / W) * 100}%`, top: `${(n.y / H) * 100}%`, transform: "translate(-50%, -50%)" }}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              >
                <div
                  className={cn(
                    "about-mono flex items-center gap-2 whitespace-nowrap border bg-[hsl(var(--card)/0.9)] px-2 py-1 text-[10px] text-[var(--text)] sm:px-2.5 sm:py-1.5 sm:text-[11px] shadow-[0_6px_18px_-8px_rgba(0,0,0,0.8)] transition-[opacity,transform,border-color] duration-500 [transition-timing-function:var(--ease)] md:text-[12px]",
                    n.kind === "skill" ? "rounded-full" : "rounded-[6px]",
                    lit(i) && !still ? "border-[hsl(var(--synapse)/0.6)]" : "border-[var(--line)]",
                    assembled || still ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                  )}
                  style={{ transitionDelay: assembled && !settled && !still ? `${150 + i * 120}ms` : "0ms" }}
                >
                  {Icon ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-white/[0.06]">
                      <Icon className="h-3 w-3" strokeWidth={1.75} />
                    </span>
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-2)]" />
                  )}
                  {n.name}
                </div>
                {hover === i && (
                  <div className="about-mono pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--line)] bg-[hsl(var(--background)/0.95)] px-2 py-1 text-[11px] text-[var(--text-2)] animate-fade-in">
                    {n.name} · v{n.version} · {n.kind === "skill" ? copy.skill : copy.mcp}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Connection log: newest on top; one line on phones. */}
        <ol className="about-mono border-t border-[var(--line)] px-4 py-3 md:px-5">
          {[0, 1, 2].map((slot) => {
            const row = log[slot];
            return (
              <li key={row?.id ?? `empty-${slot}`} className={cn("grid h-6 grid-cols-[auto_1fr_auto] items-center gap-4", slot > 0 && "max-md:hidden", slot === 0 ? "text-[var(--text)]" : "text-[var(--text-2)]", slot === 2 && "opacity-60")}>
                {row && (
                  <>
                    <span className="text-[var(--text-2)]">{row.time}</span>
                    <span className="truncate">
                      <Scramble text={fill(copy.event, { type: row.kind === "skill" ? copy.skill : copy.mcp, name: row.name })} duration={450} />
                    </span>
                    <span className={slot === 0 ? "text-[var(--accent)]" : undefined}>{fill(copy.ms, { ms: row.ms })}</span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
