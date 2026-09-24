"use client";

/**
 * PostReactions — emoji tallies under a post plus a picker. Clicking a chip
 * toggles the viewer's own reaction with that emoji; the smiley button opens
 * the full `POST_REACTIONS` palette. Updates are optimistic and replaced by
 * the server's tallies when the action returns. Signed-out viewers see the
 * counts; any click sends them to the sign-in gate.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

function toggled(list: ReactionCount[], emoji: PostReactionEmoji): ReactionCount[] {
  const cur = list.find((r) => r.emoji === emoji);
  const next = cur ? { ...cur, count: cur.count + (cur.mine ? -1 : 1), mine: !cur.mine } : { emoji, count: 1, mine: true };
  return POST_REACTIONS.map((e) => (e === emoji ? next : list.find((r) => r.emoji === e))).filter((r): r is ReactionCount => Boolean(r && r.count > 0));
}

export function PostReactions({ postId, initial, signInHref, className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  // Last emoji the viewer toggled: re-keys its chip so the pop animation replays.
  const [bumped, setBumped] = useState<{ emoji: string; n: number } | null>(null);
  const [, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function react(emoji: PostReactionEmoji) {
    setOpen(false);
    if (signInHref) {
      router.push(signInHref);
      return;
    }
    const before = list;
    setList(toggled(list, emoji));
    setBumped((b) => ({ emoji, n: (b?.n ?? 0) + 1 }));
    start(async () => {
      const res = await reactToPost(postId, emoji);
      if (!res.ok) {
        setList(before);
        toast({ tone: "danger", title: t("reactions.failed"), body: res.error });
        return;
      }
      setList(res.data);
    });
  }

  return (
    <div ref={root} className={cn("relative flex flex-wrap items-center gap-1.5", className)}>
      {list.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => react(r.emoji)}
          aria-pressed={r.mine}
          aria-label={t("reactions.toggle", { emoji: r.emoji, n: r.count })}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs tabular-nums transition-all duration-200 hover:-translate-y-px active:scale-95", r.mine ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border bg-surface-lowest/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground")}
        >
          <span key={bumped?.emoji === r.emoji ? bumped.n : 0} className={cn("text-sm leading-none", bumped?.emoji === r.emoji && "animate-pop-in")}>
            {r.emoji}
          </span>
          <span className="font-mono">{r.count}</span>
        </button>
      ))}

      <button
        type="button"
        onClick={() => (signInHref ? router.push(signInHref) : setOpen((o) => !o))}
        aria-label={t("reactions.add")}
        aria-expanded={open}
        title={t("reactions.add")}
        className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed transition-colors", open ? "border-synapse/60 text-synapse" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground")}
      >
        <SmilePlus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-20 mb-2 flex animate-pop-in items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-2xl">
          {POST_REACTIONS.map((emoji) => {
            const mine = list.some((r) => r.emoji === emoji && r.mine);
            return (
              <button key={emoji} type="button" role="menuitemcheckbox" aria-checked={mine} onClick={() => react(emoji)} className={cn("flex h-9 w-9 items-center justify-center rounded-full text-lg transition-transform duration-150 hover:-translate-y-1 hover:scale-125", mine && "bg-synapse/15")}>
                {emoji}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
