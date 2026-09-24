"use client";

/**
 * PostReactions — emoji tallies under a post plus a picker. A viewer holds at
 * most one reaction per post: clicking a chip or a picker emoji sets it,
 * picking another emoji moves it, picking the current one withdraws it.
 * Updates are optimistic and replaced by the server's tallies when the action
 * returns. Signed-out viewers see the counts; any click sends them to the
 * sign-in gate.
 *
 * Motion (chip enter/exit, odometer counts, burst, picker) is adapted from
 * Smooth UI's EmojiReaction (MIT, smoothui.dev) on top of `motion/react`;
 * `useReducedMotion()` swaps it for instant state changes.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { SmilePlus } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { reactToPost } from "@/app/(site)/social-actions";
import { cn } from "@/lib/utils";
import { POST_REACTIONS, type PostReactionEmoji, type ReactionCount } from "@/types/social";

interface Props {
  postId: string;
  initial: ReactionCount[];
  /** Where a signed-out click goes; null when the viewer is signed in. */
  signInHref: string | null;
  className?: string;
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring", bounce: 0.1, duration: 0.25 } as const;
const POP_SPRING = { type: "spring", bounce: 0.4, duration: 0.4 } as const;
const INSTANT = { duration: 0 } as const;
const BURST_S = 0.55;
const BURST_DOTS = 10;
/** Keeps a hover-opened picker alive while the pointer crosses the gap to it. */
const CLOSE_DELAY_MS = 140;

/** The viewer's single reaction moves to `emoji`, or is withdrawn when it already was `emoji`. */
function applyReaction(list: ReactionCount[], emoji: PostReactionEmoji): ReactionCount[] {
  const prev = list.find((r) => r.mine)?.emoji ?? null;
  return POST_REACTIONS.map((e) => {
    const cur = list.find((r) => r.emoji === e) ?? { emoji: e, count: 0, mine: false };
    if (e === prev) return { ...cur, count: cur.count - 1, mine: false };
    if (e === emoji) return { ...cur, count: cur.count + 1, mine: true };
    return cur;
  }).filter((r) => r.count > 0);
}

export function PostReactions({ postId, initial, signInHref, className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const reduced = Boolean(useReducedMotion());
  const [list, setList] = useState(initial);
  // Last emoji the viewer picked: its chip replays the pop and the burst.
  const [bumped, setBumped] = useState<{ emoji: PostReactionEmoji; n: number } | null>(null);
  const [, start] = useTransition();
  const mine = list.find((r) => r.mine)?.emoji ?? null;

  const react = useCallback(
    (emoji: PostReactionEmoji) => {
      if (signInHref) {
        router.push(signInHref);
        return;
      }
      const before = list;
      setList(applyReaction(list, emoji));
      if (mine !== emoji) setBumped((b) => ({ emoji, n: (b?.n ?? 0) + 1 }));
      start(async () => {
        const res = await reactToPost(postId, emoji);
        if (!res.ok) {
          setList(before);
          toast({ tone: "danger", title: t("reactions.failed"), body: res.error });
          return;
        }
        setList(res.data);
      });
    },
    [list, mine, postId, router, signInHref, t, toast],
  );

  return (
    <motion.div layout={!reduced} role="group" aria-label={t("reactions.group")} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((r) => (
          <ReactionChip key={r.emoji} reaction={r} bump={bumped?.emoji === r.emoji ? bumped.n : 0} reduced={reduced} onClick={() => react(r.emoji)} label={t("reactions.toggle", { emoji: r.emoji, n: r.count })} />
        ))}
        <motion.div key="picker" layout={reduced ? false : "position"}>
          <ReactionPicker mine={mine} reduced={reduced} onPick={react} onSignIn={signInHref ? () => router.push(signInHref) : null} />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

function ReactionChip({ reaction, bump, reduced, onClick, label }: { reaction: ReactionCount; bump: number; reduced: boolean; onClick: () => void; label: string }) {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const [burst, setBurst] = useState(0);

  // Driven imperatively so the pop animates the emoji node that already exists instead of remounting it.
  useEffect(() => {
    if (!bump || reduced) return;
    if (scope.current) animate(scope.current, { scale: [0.7, 1], y: [2, 0] }, POP_SPRING);
    setBurst(bump);
  }, [bump, reduced, animate, scope]);

  return (
    <motion.button
      layout={!reduced}
      type="button"
      onClick={onClick}
      aria-pressed={reaction.mine}
      aria-label={label}
      initial={reduced ? false : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, scale: 0.6, transition: { duration: 0.15, ease: EASE_OUT } }}
      transition={reduced ? INSTANT : SPRING}
      whileTap={reduced ? undefined : { scale: 0.94 }}
      className={cn(
        "relative inline-flex h-7 select-none items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition-[background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-synapse/60",
        reaction.mine ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border bg-surface-lowest/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      <span className="relative inline-flex items-center justify-center">
        <span ref={scope} aria-hidden className="block text-sm leading-none">
          {reaction.emoji}
        </span>
        {burst > 0 && <Burst key={burst} seed={burst} onDone={() => setBurst(0)} />}
      </span>
      <Odometer value={reaction.count} reduced={reduced} />
    </motion.button>
  );
}

/** Rolling digits: the new count slides in from the direction it moved. */
function Odometer({ value, reduced }: { value: number; reduced: boolean }) {
  const prev = useRef(value);
  const dir = value < prev.current ? -1 : 1;
  useEffect(() => {
    prev.current = value;
  }, [value]);

  return (
    <span aria-hidden className="relative inline-flex h-[1.15em] items-center overflow-hidden font-mono tabular-nums leading-none">
      <AnimatePresence custom={dir} initial={false} mode="popLayout">
        <motion.span
          key={value}
          custom={dir}
          className="block leading-none"
          variants={reduced ? { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } } : { enter: (d: number) => ({ opacity: 0, y: d * 10 }), center: { opacity: 1, y: 0 }, exit: (d: number) => ({ opacity: 0, y: -d * 10 }) }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduced ? INSTANT : SPRING}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A ring plus a handful of dots; deterministic jitter from `seed` (no `Math.random()` during render). */
function Burst({ seed, onDone }: { seed: number; onDone: () => void }) {
  const dots = useMemo(() => {
    let s = (seed * 2654435761) >>> 0;
    const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
    return Array.from({ length: BURST_DOTS }, (_, i) => {
      const angle = (((360 / BURST_DOTS) * i + (next() - 0.5) * 22) * Math.PI) / 180;
      const dist = 18 + next() * 14;
      return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, size: 3 + Math.round(next() * 2), opacity: 0.5 + next() * 0.5 };
    });
  }, [seed]);

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <motion.span className="absolute h-6 w-6 rounded-full border border-synapse/60" initial={{ opacity: 0.7, scale: 0.4 }} animate={{ opacity: 0, scale: 1.9 }} transition={{ duration: BURST_S, ease: EASE_OUT }} onAnimationComplete={onDone} />
      {dots.map((d, i) => (
        <motion.span key={i} className="absolute rounded-full bg-synapse" style={{ width: d.size, height: d.size }} initial={{ opacity: d.opacity, scale: 1, x: 0, y: 0 }} animate={{ opacity: 0, scale: 0.4, x: d.x, y: d.y }} transition={{ duration: BURST_S, ease: EASE_OUT }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

function useHoverCapable() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setOk(mq.matches);
    const on = (e: MediaQueryListEvent) => setOk(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return ok;
}

/**
 * Single-choice palette: opens on hover (fine pointers), click or ↑/↓; arrows
 * move between emojis, Escape closes back to the trigger. The viewer's current
 * emoji is checked, and picking it again withdraws it.
 */
function ReactionPicker({ mine, reduced, onPick, onSignIn }: { mine: PostReactionEmoji | null; reduced: boolean; onPick: (e: PostReactionEmoji) => void; onSignIn: (() => void) | null }) {
  const { t } = useI18n();
  const hover = useHoverCapable() && !onSignIn;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<number | null>(null);
  const focusOnOpen = useRef(false);
  const menuId = useId();
  const startIndex = Math.max(0, mine ? POST_REACTIONS.indexOf(mine) : 0);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const show = useCallback(
    (focus: boolean) => {
      clearTimer();
      focusOnOpen.current = focus;
      setOpen(true);
    },
    [clearTimer],
  );
  const hide = useCallback(
    (refocus: boolean) => {
      clearTimer();
      setOpen(false);
      if (refocus) trigger.current?.focus();
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) hide(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") hide(true);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, hide]);

  // Only a click or keyboard open moves focus — hovering never steals it.
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      items.current[startIndex]?.focus();
    }
  }, [open, startIndex]);

  function onItemKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = POST_REACTIONS.length;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      items.current[(i + step + n) % n]?.focus();
    } else if (e.key === "Tab") hide(false);
  }

  return (
    <div ref={root} className="relative inline-flex" onMouseEnter={() => hover && show(false)} onMouseLeave={() => hover && (timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS))}>
      <motion.button
        ref={trigger}
        type="button"
        onClick={() => (onSignIn ? onSignIn() : open ? hide(false) : show(true))}
        onKeyDown={(e) => {
          if (!onSignIn && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            show(true);
          }
        }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        aria-label={t("reactions.add")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={t("reactions.add")}
        className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-synapse/60", open ? "border-synapse/60 text-synapse" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground")}
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </motion.button>

      <AnimatePresence>
        {open && (
          // The offset is padding, not margin, so the pointer never leaves the hover region on its way up.
          <span key="menu" className="absolute bottom-full left-0 z-20 block pb-2">
            <motion.div
              id={menuId}
              role="menu"
              aria-label={t("reactions.add")}
              style={{ transformOrigin: "bottom left" }}
              initial="closed"
              animate="open"
              exit="closed"
              variants={
                reduced
                  ? { closed: { opacity: 0, transition: INSTANT }, open: { opacity: 1, transition: INSTANT } }
                  : { closed: { opacity: 0, scale: 0.94, y: 6, transition: { duration: 0.15, ease: EASE_OUT } }, open: { opacity: 1, scale: 1, y: 0, transition: { ...SPRING, staggerChildren: 0.03 } } }
              }
              className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-2xl"
            >
              {POST_REACTIONS.map((emoji, i) => {
                const checked = emoji === mine;
                return (
                  <motion.button
                    key={emoji}
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    aria-label={t("reactions.pick", { emoji })}
                    tabIndex={i === startIndex ? 0 : -1}
                    onClick={() => {
                      onPick(emoji);
                      hide(true);
                    }}
                    onKeyDown={(e) => onItemKey(e, i)}
                    variants={reduced ? { closed: { opacity: 0 }, open: { opacity: 1 } } : { closed: { opacity: 0, scale: 0.8 }, open: { opacity: 1, scale: 1 } }}
                    whileHover={reduced ? undefined : { y: -4, scale: 1.25 }}
                    whileTap={reduced ? undefined : { scale: 0.9 }}
                    className={cn("flex h-9 w-9 items-center justify-center rounded-full text-lg outline-none focus-visible:ring-2 focus-visible:ring-synapse/60", checked && "bg-synapse/15 ring-1 ring-synapse/40")}
                  >
                    {emoji}
                  </motion.button>
                );
              })}
            </motion.div>
          </span>
        )}
      </AnimatePresence>
    </div>
  );
}
