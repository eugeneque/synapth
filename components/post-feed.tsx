"use client";

/**
 * PostFeed — "Recent posts & updates" on the profile page. The owner gets a
 * composer on top (`PostComposer`: photos, code, @mentions); every post
 * renders its parsed body, its photo carousel and its comment thread,
 * collapsed until the reply count is clicked (or the URL hash points at it).
 */

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { commentOnPost, removePost } from "@/app/(site)/social-actions";
import { Avatar } from "@/components/avatar";
import { VerifiedMark } from "@/components/verified-mark";
import { CommentThread } from "@/components/comment-thread";
import { PostReactions } from "@/components/post-reactions";
import { PostCarousel } from "@/components/post-carousel";
import { PostComposer } from "@/components/post-composer";
import { PostContent } from "@/components/post-content";
import { cn, timeAgo } from "@/lib/utils";
import type { AuthorRef, Comment, Post } from "@/types/social";

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
  const [, start] = useTransition();
  const isOwner = viewer?.id === ownerId;

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
      {isOwner && viewer && <PostComposer viewer={viewer} handle={handle} onPublished={(post) => setPosts((list) => [post, ...list])} />}

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

/** One post with its reactions and thread. `aside` sits under the author line (the feed's "why you see this" chip). */
export function PostCard({ post, viewer, canModerate, initialComments, onDelete, aside }: { post: Post; viewer: AuthorRef | null; canModerate: boolean; initialComments: Comment[]; onDelete: () => void; aside?: ReactNode }) {
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
    <article id={`post-${post.id}`} className="animate-rise scroll-mt-24 rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar author={post.author} size="md" link />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/u/${post.author.handle}`} className="text-sm font-semibold text-foreground hover:underline">
                {post.author.name || post.author.handle}
              </Link>
              {post.author.verified && <VerifiedMark size="sm" className="-ml-1" />}
              <span className="label-mono-sm normal-case tracking-normal">
                @{post.author.handle} · {timeAgo(post.createdAt, i18n)}
              </span>
            </div>
            {post.author.occupation && <span className="label-mono-sm text-synapse">{t(`occupation.${post.author.occupation}`)}</span>}
            {aside}
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

      <PostContent blocks={post.content} className="mt-3" />
      {post.images.length > 0 && <PostCarousel images={post.images} className="mt-3" />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <PostReactions postId={post.id} initial={post.reactions} signInHref={viewer ? null : `/signin?callbackUrl=/u/${post.author.handle}`} />
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
