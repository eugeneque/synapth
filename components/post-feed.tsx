"use client";

/**
 * PostFeed — "Recent posts & updates" on the profile page. The owner gets a
 * composer on top; every post carries its comment thread, collapsed until
 * the reply count is clicked (or the URL hash points at it).
 */

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Loader2, MessageSquare, MoreHorizontal, Send, Trash2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { commentOnPost, publishPost, removePost } from "@/app/(site)/social-actions";
import { Avatar } from "@/components/avatar";
import { CommentThread } from "@/components/comment-thread";
import { cn, timeAgo } from "@/lib/utils";
import { POST_MAX_LENGTH, type AuthorRef, type Comment, type Post } from "@/types/social";

interface Props {
  handle: string;
  ownerId: string;
  viewer: AuthorRef | null;
  /** Viewer holds `content.moderate`: delete controls on every post and comment. */
  canModerate?: boolean;
  initialPosts: Post[];
  /** Threads preloaded by the server, keyed by post id. */
  initialComments: Record<string, Comment[]>;
}

export function PostFeed({ handle, ownerId, viewer, canModerate = false, initialPosts, initialComments }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [posts, setPosts] = useState(initialPosts);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const isOwner = viewer?.id === ownerId;

  function publish() {
    const body = draft.trim();
    if (!body) return;
    start(async () => {
      const res = await publishPost(body, handle);
      if (!res.ok) {
        toast({ tone: "danger", title: t("posts.failed"), body: res.error });
        return;
      }
      setPosts((list) => [res.data, ...list]);
      setDraft("");
      toast({ tone: "success", title: t("posts.publishedTitle"), body: t("posts.publishedBody") });
    });
  }

  function remove(post: Post) {
    start(async () => {
      const res = await removePost(post.id, handle);
      if (!res.ok) {
        toast({ tone: "danger", title: t("posts.failed"), body: res.error });
        return;
      }
      setPosts((list) => list.filter((p) => p.id !== post.id));
      toast({ tone: "undo", title: t("posts.deleted") });
    });
  }

  return (
    <div className="space-y-4">
      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            publish();
          }}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-start gap-3">
            <Avatar author={viewer!} size="md" />
            <div className="min-w-0 flex-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, POST_MAX_LENGTH))}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") publish();
                }}
                rows={3}
                placeholder={t("posts.placeholder")}
                className="w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="label-mono-sm normal-case tracking-normal">
                  {draft.length} / {POST_MAX_LENGTH} · {t("posts.shortcut")}
                </span>
                <button type="submit" disabled={pending || !draft.trim()} className="inline-flex h-8 items-center gap-2 rounded-lg bg-synapse px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-synapse-foreground shadow-glow transition-all hover:shadow-glow-lg disabled:opacity-50 disabled:shadow-none">
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("posts.publish")}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {posts.length === 0 && (
        <div className="hatch flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-tight">{t("posts.empty")}</span>
          <span className="max-w-xs text-xs text-muted-foreground">{isOwner ? t("posts.emptyOwner") : t("posts.emptyLead")}</span>
        </div>
      )}

      {posts.map((post) => (
        <PostCard key={post.id} post={post} viewer={viewer} canModerate={canModerate} initialComments={initialComments[post.id] ?? []} onDelete={() => remove(post)} />
      ))}
    </div>
  );
}

function PostCard({ post, viewer, canModerate, initialComments, onDelete }: { post: Post; viewer: AuthorRef | null; canModerate: boolean; initialComments: Comment[]; onDelete: () => void }) {
  const i18n = useI18n();
  const { t, n } = i18n;
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(post.commentCount);
  const [menu, setMenu] = useState(false);

  // Deep links from notifications (`#post-<id>`) open the thread.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === `#post-${post.id}`) setOpen(true);
  }, [post.id]);

  return (
    <article id={`post-${post.id}`} className="scroll-mt-24 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar author={post.author} size="md" link />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/u/${post.author.handle}`} className="text-sm font-semibold text-foreground hover:underline">
                {post.author.name || post.author.handle}
              </Link>
              <span className="label-mono-sm normal-case tracking-normal">
                @{post.author.handle} · {timeAgo(post.createdAt, i18n)}
              </span>
            </div>
            {post.author.occupation && <span className="label-mono-sm text-synapse">{t(`occupation.${post.author.occupation}`)}</span>}
          </div>
        </div>
        {(viewer?.id === post.author.id || canModerate) && (
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label={t("posts.more")} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menu && (
              <div className="absolute right-0 top-8 z-10 min-w-36 rounded-lg border border-border bg-card p-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-danger transition-colors hover:bg-danger/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t("posts.delete")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{post.body}</p>

      <div className="mt-3 flex items-center gap-4 border-t border-border pt-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className={cn("inline-flex items-center gap-1.5 font-mono text-xs transition-colors hover:text-foreground", open ? "text-synapse" : "text-muted-foreground")}>
          <MessageSquare className="h-4 w-4" /> {n("posts.comments", count)}
        </button>
      </div>

      {open && (
        <CommentThread className="mt-4" initial={initialComments} viewer={viewer} canModerate={canModerate} submit={(body) => commentOnPost(post.id, body)} signInHref={`/signin?callbackUrl=/u/${post.author.handle}`} onCountChange={(d) => setCount((c) => c + d)} />
      )}
    </article>
  );
}
