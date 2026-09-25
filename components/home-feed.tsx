"use client";

/**
 * HomeFeed — the `/feed` stream. The server renders the first page; "Show
 * more" asks `loadFeed` for the next offset of the same ranking snapshot
 * (`asOf`) and skips posts already on screen. Signed-in readers get the
 * composer on top (a new post lands first and on their profile). Each card
 * carries a chip naming the strongest signal that put it here.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import { AtSign, Flame, Heart, Loader2, Newspaper, Repeat, Sparkles, User, UserCheck, UserPlus, Users, Zap, type LucideIcon } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { loadFeed, removePost } from "@/app/(site)/social-actions";
import { PostCard } from "@/components/post-feed";
import { PostComposer } from "@/components/post-composer";
import { Button } from "@/components/ui/button";
import type { FeedItem, FeedPage, FeedReason, FeedTab } from "@/types/feed";
import type { AuthorRef, Comment } from "@/types/social";

const REASON_ICON: Record<FeedReason, LucideIcon> = {
  self: User,
  mention: AtSign,
  friend: UserCheck,
  following: UserPlus,
  follower: UserPlus,
  friendsEngaged: Users,
  similar: Repeat,
  engaged: Heart,
  impulse: Zap,
  network: Users,
  popular: Flame,
  fresh: Sparkles,
};

interface Props {
  tab: FeedTab;
  viewer: AuthorRef | null;
  canModerate: boolean;
  initial: FeedPage;
}

export function HomeFeed({ tab, viewer, canModerate, initial }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState<FeedItem[]>(initial.items);
  const [comments, setComments] = useState<Record<string, Comment[]>>(initial.comments);
  const [next, setNext] = useState(initial.nextOffset);
  const [loading, startLoading] = useTransition();
  const [, start] = useTransition();

  function more() {
    if (next === null) return;
    startLoading(async () => {
      const res = await loadFeed(tab, next, initial.asOf);
      if (!res.ok) {
        toast({ tone: "danger", title: t("feed.loadFailed"), body: res.error });
        return;
      }
      setItems((list) => {
        const seen = new Set(list.map((i) => i.post.id));
        return [...list, ...res.data.items.filter((i) => !seen.has(i.post.id))];
      });
      setComments((c) => ({ ...res.data.comments, ...c }));
      setNext(res.data.nextOffset);
    });
  }

  function remove(item: FeedItem) {
    start(async () => {
      const res = await removePost(item.post.id, item.post.author.handle);
      if (!res.ok) {
        toast({ tone: "danger", title: t("posts.failed"), body: res.error });
        return;
      }
      setItems((list) => list.filter((i) => i.post.id !== item.post.id));
      toast({ tone: "undo", title: t("posts.deleted") });
    });
  }

  return (
    <div className="space-y-4">
      {viewer && <PostComposer viewer={viewer} handle={viewer.handle} onPublished={(post) => setItems((list) => [{ post, reason: "self", score: 0 }, ...list])} />}

      {items.length === 0 && (
        <div className="hatch flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Newspaper className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-tight">{t("feed.empty")}</span>
          <span className="max-w-xs text-xs text-muted-foreground">{tab === "following" ? t("feed.emptyFollowing") : t("feed.emptyLead")}</span>
          {tab === "following" && (
            <Button asChild variant="mono" size="sm" className="mt-2">
              <Link href="/search?tab=people">{t("feed.findPeople")}</Link>
            </Button>
          )}
        </div>
      )}

      <div className="stagger space-y-4">
        {items.map((item) => (
          <PostCard key={item.post.id} post={item.post} viewer={viewer} canModerate={canModerate} initialComments={comments[item.post.id] ?? []} onDelete={() => remove(item)} aside={<ReasonChip reason={item.reason} />} />
        ))}
      </div>

      {next !== null && (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="outline" size="sm" onClick={more} disabled={loading} className="font-mono text-[11px] uppercase tracking-[0.14em]">
            {loading && <Loader2 className="animate-spin" />} {t("feed.more")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ReasonChip({ reason }: { reason: FeedReason }) {
  const { t } = useI18n();
  const Icon = REASON_ICON[reason];
  return (
    <span title={t("feed.reasonTitle")} className="mt-1 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
      <Icon className="h-3 w-3 text-synapse" /> {t(`feed.reason.${reason}`)}
    </span>
  );
}
