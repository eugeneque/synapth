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
}

/** One impulse per (from, to) pair; withdrawing it deletes the row. Users cannot impulse themselves. */
export interface Impulse {
  fromId: string;
  toId: string;
  createdAt: string;
}

export interface Post {
  id: string;
  author: AuthorRef;
  body: string;
  commentCount: number;
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

export const POST_MAX_LENGTH = 2000;
export const COMMENT_MAX_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = ["impulse", "comment.post", "comment.skill", "skill.updated", "badge", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Drawer filter tabs; each kind belongs to exactly one channel. */
export type NotificationChannel = "social" | "skills" | "system";
export const NOTIFICATION_CHANNEL: Record<NotificationKind, NotificationChannel> = {
  impulse: "social",
  "comment.post": "social",
  "comment.skill": "skills",
  "skill.updated": "skills",
  badge: "system",
  system: "system",
};

/** Everything the notification card needs to render without extra lookups. */
export type NotificationSubject =
  | { kind: "impulse"; total: number }
  | { kind: "comment.post"; postId: string; commentId: string; excerpt: string }
  | { kind: "comment.skill"; skillId: string; slug: string; skillName: string; commentId: string; excerpt: string }
  | { kind: "skill.updated"; skillId: string; slug: string; skillName: string; version: string; previousVersion: string | null; verified: boolean }
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
