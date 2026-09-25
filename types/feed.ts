/**
 * Feed vocabulary (`/feed`, `cortex/feed.ts`): a ranked "For you" tab and a
 * chronological "Following" tab over everyone's posts.
 */

import type { AuthorRef, Comment, Post } from "@/types/social";

export const FEED_TABS = ["for-you", "following"] as const;
export type FeedTab = (typeof FEED_TABS)[number];

/**
 * Why a post landed in the viewer's feed — the strongest signal behind its
 * score, shown as a chip on the card. `popular` and `fresh` are the fallbacks
 * when nothing personal applies (and all an anonymous reader gets).
 */
export const FEED_REASONS = ["self", "mention", "friend", "following", "friendsEngaged", "similar", "engaged", "impulse", "network", "follower", "popular", "fresh"] as const;
export type FeedReason = (typeof FEED_REASONS)[number];

export interface FeedItem {
  post: Post;
  reason: FeedReason;
  score: number;
}

export interface FeedPage {
  items: FeedItem[];
  /** Threads preloaded for the page's posts, keyed by post id. */
  comments: Record<string, Comment[]>;
  /** Offset of the next page, null at the end. */
  nextOffset: number | null;
  /** Ranking snapshot time: pass it back with the next page so the order stays put. */
  asOf: string;
}

/** A "people to follow" row next to the feed. */
export interface FeedSuggestion extends AuthorRef {
  /** Friends of the viewer who already follow this person (0 for popular picks). */
  mutual: number;
}

export const FEED_PAGE_SIZE = 15;
