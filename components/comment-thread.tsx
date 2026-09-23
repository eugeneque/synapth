"use client";

/**
 * CommentThread — the discussion under a post or a catalogue entry. The
 * parent decides where a new comment goes by passing `submit`; this
 * component only owns the optimistic list and the reply box.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Send, Trash2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { removeComment, type ActionResult } from "@/app/(site)/social-actions";
import { Avatar } from "@/components/avatar";
import { cn, timeAgo } from "@/lib/utils";
import { COMMENT_MAX_LENGTH, type AuthorRef, type Comment } from "@/types/social";

interface Props {
  initial: Comment[];
  viewer: AuthorRef | null;
  /** Viewer holds `content.moderate`: delete controls on everyone's comments. */
  canModerate?: boolean;
  submit: (body: string) => Promise<ActionResult<Comment>>;
  /** Where to send a signed-out reader. */
  signInHref: string;
  onCountChange?: (delta: number) => void;
  className?: string;
}

export function CommentThread({ initial, viewer, canModerate = false, submit, signInHref, onCountChange, className }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const { toast } = useToast();
  const [comments, setComments] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  function post() {
    const body = draft.trim();
    if (!body) return;
    start(async () => {
      const res = await submit(body);
      if (!res.ok) {
        toast({ tone: "danger", title: t("comments.failed"), body: res.error });
        return;
      }
      setComments((list) => [...list, res.data]);
      setDraft("");
      onCountChange?.(1);
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await removeComment(id);
      if (!res.ok) {
        toast({ tone: "danger", title: t("comments.failed"), body: res.error });
        return;
      }
      setComments((list) => list.filter((c) => c.id !== id));
      onCountChange?.(-1);
    });
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {comments.length === 0 && <p className="label-mono-sm normal-case tracking-normal">{t("comments.empty")}</p>}
      {comments.map((c) => (
        <div key={c.id} id={`comment-${c.id}`} className="group flex items-start gap-3">
          <Avatar author={c.author} size="sm" link />
          <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface-lowest px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Link href={`/u/${c.author.handle}`} className="text-xs font-semibold text-foreground hover:underline">
                {c.author.name || c.author.handle}
              </Link>
              <span className="label-mono-sm normal-case tracking-normal">@{c.author.handle}</span>
              {c.author.occupation && <span className="label-mono-sm rounded bg-muted px-1.5">{t(`occupation.${c.author.occupation}`)}</span>}
              <span className="label-mono-sm ml-auto normal-case tracking-normal">{timeAgo(c.createdAt, i18n)}</span>
              {(viewer?.id === c.author.id || canModerate) && (
                <button type="button" onClick={() => remove(c.id)} disabled={pending} aria-label={t("comments.delete")} className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-danger group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{c.body}</p>
          </div>
        </div>
      ))}

      {viewer ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
          className="flex items-start gap-3"
        >
          <Avatar author={viewer} size="sm" />
          <div className="relative flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") post();
              }}
              rows={draft.length > 80 ? 3 : 1}
              placeholder={t("comments.placeholder")}
              className="h-auto min-h-9 w-full resize-none rounded-lg border border-border bg-muted py-2 pl-3 pr-24 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25"
            />
            <button type="submit" disabled={pending || !draft.trim()} className="absolute right-1.5 top-1.5 inline-flex h-6 items-center gap-1 rounded-md bg-synapse px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-synapse-foreground transition-opacity disabled:opacity-40">
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} {t("comments.send")}
            </button>
          </div>
        </form>
      ) : (
        <p className="label-mono-sm normal-case tracking-normal">
          <Link href={signInHref} className="text-synapse hover:underline">
            {t("comments.signIn")}
          </Link>{" "}
          {t("comments.signInTail")}
        </p>
      )}
    </div>
  );
}
