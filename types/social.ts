/**
 * Social layer vocabulary: impulses (Synapth's take on likes — one developer
 * fires an impulse at another), posts, comments, skill watches and the
 * notifications they produce. Shared by Cortex stores, server actions and the
 * Axon notification centre.
 */

import type { Occupation } from "@/types/profile";

/** The public face of a user wherever content is attributed: feeds, comments, notifications. */
export interface AuthorRef {
  id: string;
  name: string;
  handle: string;
  image: string | null;
  occupation: Occupation | null;
  /** Account check mark (types/verification.ts); absent on refs built without a user lookup. */
  verified?: boolean;
}

/** How a viewer relates to a profile for impulses: signed out, the owner, or another member. */
export type ImpulseViewer = "anonymous" | "self" | "member";

/** One impulse per (from, to) pair; withdrawing it deletes the row. Users cannot impulse themselves. */
export interface Impulse {
  fromId: string;
  toId: string;
  createdAt: string;
}

/**
 * Friends are mutual follows. A one-way follow is a pending friend request:
 * the sender already hears about the receiver's posts, not the other way round.
 */
export interface Follow {
  fromId: string;
  toId: string;
  createdAt: string;
}

/**
 * How the viewer relates to a profile: `requested` — the viewer sent a request
 * that is not answered yet; `incoming` — the profile owner asked the viewer.
 */
export type FriendState = "anonymous" | "self" | "none" | "requested" | "incoming" | "friends";

export interface FriendCounts {
  friends: number;
  /** One-way followers of this user (friend requests waiting for an answer). */
  incoming: number;
  /** One-way follows this user sent. */
  outgoing: number;
}

/** A row of the people search / friend lists. */
export interface PersonSummary extends AuthorRef {
  bio: string;
  friends: number;
  /** Viewer relation, so each row can render its own friend control. */
  state: FriendState;
}

/** Emoji reactions a post accepts, in picker order. Anything else is rejected by the store. */
export const POST_REACTIONS = ["👍", "❤️", "🔥", "🚀", "🎉", "🤯", "👀"] as const;
export type PostReactionEmoji = (typeof POST_REACTIONS)[number];

/** One emoji's tally on a post; `mine` — the viewer left it. Only emojis with a count > 0 are listed, in picker order. */
export interface ReactionCount {
  emoji: PostReactionEmoji;
  count: number;
  mine: boolean;
}

export interface PostReaction {
  postId: string;
  userId: string;
  emoji: PostReactionEmoji;
  createdAt: string;
}

/** One run of highlighted code; `cls` is the highlight.js scope class list (`hljs-keyword` …), absent for plain text. */
export interface CodeToken {
  text: string;
  cls?: string;
}

/** A piece of a rendered text block. Mentions are only emitted for handles that belong to a real account. */
export type PostInline = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "mention"; user: AuthorRef };

/**
 * A post body, parsed and resolved on the server (`cortex/post-content.ts`):
 * text with mentions, and code blocks already tokenized so the client ships
 * no highlighter. `auto` — the language was guessed, not written on the fence.
 */
export type PostBlock = { kind: "text"; parts: PostInline[] } | { kind: "code"; lang: string; label: string; auto: boolean; code: string; tokens: CodeToken[] };

/** A photo of the post's carousel, served by `GET POST_IMAGE_PATH<id>`. */
export interface PostImage {
  id: string;
  url: string;
}

export interface Post {
  id: string;
  author: AuthorRef;
  /** Raw source as typed (code fences, @handles); `content` is what to render. */
  body: string;
  content: PostBlock[];
  images: PostImage[];
  commentCount: number;
  reactions: ReactionCount[];
  createdAt: string;
}

export const COMMENT_TARGET_KINDS = ["post", "skill"] as const;
export type CommentTargetKind = (typeof COMMENT_TARGET_KINDS)[number];

/** Comments attach to a post or to a catalogue entry (skill / MCP server / tool are all `Skill` rows). */
export interface Comment {
  id: string;
  author: AuthorRef;
  targetKind: CommentTargetKind;
  targetId: string;
  body: string;
  createdAt: string;
}

export interface SkillWatch {
  userId: string;
  skillId: string;
  createdAt: string;
}

export const POST_MAX_LENGTH = 4000;
/** Photos per post (the carousel). */
export const POST_MAX_IMAGES = 10;
/** Each photo is scaled to fit this box in the browser; the server re-checks the byte ceiling. */
export const POST_IMAGE = { width: 1600, height: 1600, maxBytes: 900 * 1024 } as const;
export const POST_IMAGE_PATH = "/api/v1/posts/images/";
/** Mentioned people notified per post; the rest still render as links. */
export const POST_MAX_MENTION_NOTIFY = 10;
export const COMMENT_MAX_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = ["impulse", "friend.request", "friend.accepted", "post.new", "post.mention", "comment.post", "comment.skill", "skill.updated", "moderation.requested", "moderation.decided", "skillset.updated", "skillset.verified", "verification.requested", "verification.updated", "badge", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Drawer filter tabs; each kind belongs to exactly one channel. */
export type NotificationChannel = "social" | "skills" | "system";
export const NOTIFICATION_CHANNEL: Record<NotificationKind, NotificationChannel> = {
  impulse: "social",
  "friend.request": "social",
  "friend.accepted": "social",
  "post.new": "social",
  "post.mention": "social",
  "comment.post": "social",
  "comment.skill": "skills",
  "skill.updated": "skills",
  "moderation.requested": "skills",
  "moderation.decided": "skills",
  "skillset.updated": "skills",
  "skillset.verified": "skills",
  "verification.requested": "system",
  "verification.updated": "system",
  badge: "system",
  system: "system",
};

/** Everything the notification card needs to render without extra lookups. */
export type NotificationSubject =
  | { kind: "impulse"; total: number }
  /** To the receiver of a friend request (a one-way follow). */
  | { kind: "friend.request" }
  /** To the original sender: the request was returned, they are friends now. */
  | { kind: "friend.accepted" }
  /** To everyone following the author (friends and pending senders alike). */
  | { kind: "post.new"; postId: string; excerpt: string }
  /** To everyone @mentioned in a post (instead of `post.new`, if they also follow the author). */
  | { kind: "post.mention"; postId: string; excerpt: string }
  | { kind: "comment.post"; postId: string; commentId: string; excerpt: string }
  | { kind: "comment.skill"; skillId: string; slug: string; skillName: string; commentId: string; excerpt: string }
  | { kind: "skill.updated"; skillId: string; slug: string; skillName: string; version: string; previousVersion: string | null; verified: boolean }
  /** To staff: someone asked for a review of this entry. */
  | { kind: "moderation.requested"; requestId: string; skillId: string; slug: string; skillName: string }
  /** To the requester and the author: the review is closed. */
  | { kind: "moderation.decided"; requestId: string; skillId: string; slug: string; skillName: string; verdict: "approved" | "rejected"; note: string | null }
  /** To users who favorited a skillset: its composition changed. */
  | { kind: "skillset.updated"; skillsetId: string; slug: string; name: string; added: number; removed: number }
  /** To the skillset author: staff set or revoked `verified`. */
  | { kind: "skillset.verified"; skillsetId: string; slug: string; name: string; verified: boolean }
  /** To admins: a developer filed a verification request that passed the scan. */
  | { kind: "verification.requested"; requestId: string }
  /** To the applicant (or the user, on a manual grant / revoke): the request moved or the mark changed. */
  | { kind: "verification.updated"; requestId: string | null; code: "claimed" | "approved" | "rejected" | "scan_failed" | "granted" | "revoked"; note: string | null }
  | { kind: "badge"; badgeId: string }
  | { kind: "system"; title: string; body: string; href: string | null; tone: "info" | "success" | "warn" | "danger" };

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  /** Who triggered it; null for skill releases and system events. */
  actor: AuthorRef | null;
  subject: NotificationSubject;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  items: Notification[];
  unread: number;
  total: number;
}

/** Client ↔ server polling contract (`GET /api/v1/notifications`). */
export interface NotificationPoll {
  unread: number;
  /** Items newer than the `after` cursor, oldest first, capped. */
  fresh: Notification[];
  serverTime: string;
}
