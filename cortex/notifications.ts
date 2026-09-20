/**
 * Cortex · Notification store
 *
 * A pure inbox: rows are produced by the social layer (`cortex/social.ts`),
 * badge engine (`cortex/badges.ts`) and system events, read by the drawer
 * (`GET /api/v1/notifications`) and the notifications page. Dual store like
 * the rest of Cortex. Nothing here decides *when* to notify — callers do.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { getAuthorRefs } from "@/cortex/account";
import { seedNotifications } from "@/cortex/seed";
import { NOTIFICATION_CHANNEL, NOTIFICATION_KINDS, type Notification, type NotificationChannel, type NotificationFeed, type NotificationKind, type NotificationPoll, type NotificationSubject } from "@/types/social";

interface Row {
  id: string;
  userId: string;
  kind: NotificationKind;
  actorId: string | null;
  subject: NotificationSubject;
  readAt: string | null;
  createdAt: string;
}

const g = globalThis as unknown as { __synapthNotifications_v1?: Row[] };
const rows: Row[] = g.__synapthNotifications_v1 ?? (g.__synapthNotifications_v1 = [...seedNotifications]);

const newId = () => `ntf_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

function isKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

async function hydrate(list: Row[]): Promise<Notification[]> {
  const actors = await getAuthorRefs(list.map((r) => r.actorId).filter((id): id is string => Boolean(id)));
  return list.map((r) => ({ id: r.id, userId: r.userId, kind: r.kind, actor: r.actorId ? (actors.get(r.actorId) ?? null) : null, subject: r.subject, readAt: r.readAt, createdAt: r.createdAt }));
}

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  actorId?: string | null;
  subject: NotificationSubject;
}

/** Appends one row. Actors never notify themselves; the caller may still pass their own id and get `null`. */
export async function notify(input: NotifyInput): Promise<Notification | null> {
  if (input.actorId && input.actorId === input.userId) return null;
  const actorId = input.actorId ?? null;
  if (!hasDatabase) {
    const row: Row = { id: newId(), userId: input.userId, kind: input.kind, actorId, subject: input.subject, readAt: null, createdAt: new Date().toISOString() };
    rows.push(row);
    return (await hydrate([row]))[0];
  }
  const created = await prisma.notification.create({ data: { userId: input.userId, kind: input.kind, actorId, subject: input.subject } });
  return (await hydrate([toRow(created)]))[0];
}

/** True when `actorId` already produced a `kind` row for `userId` in the last `withinMs` — lets toggles stay quiet. */
export async function hasRecent(userId: string, kind: NotificationKind, actorId: string, withinMs: number): Promise<boolean> {
  const since = new Date(Date.now() - withinMs);
  if (!hasDatabase) return rows.some((r) => r.userId === userId && r.kind === kind && r.actorId === actorId && r.createdAt >= since.toISOString());
  return Boolean(await prisma.notification.findFirst({ where: { userId, kind, actorId, createdAt: { gte: since } }, select: { id: true } }));
}

/** Fan-out helper for skill releases: one row per watcher, the author excluded. */
export async function notifyMany(userIds: Iterable<string>, input: Omit<NotifyInput, "userId">): Promise<number> {
  let n = 0;
  for (const userId of new Set(userIds)) {
    if (await notify({ ...input, userId })) n += 1;
  }
  return n;
}

function toRow(r: { id: string; userId: string; kind: string; actorId: string | null; subject: unknown; readAt: Date | null; createdAt: Date }): Row {
  return { id: r.id, userId: r.userId, kind: isKind(r.kind) ? r.kind : "system", actorId: r.actorId, subject: r.subject as NotificationSubject, readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
}

export interface FeedQuery {
  channel?: NotificationChannel | "all" | "unread";
  limit?: number;
}

/** Newest first, optionally narrowed to a drawer tab. `total` counts the whole inbox, `unread` the unread rows. */
export async function listNotifications(userId: string, query: FeedQuery = {}): Promise<NotificationFeed> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const channel = query.channel ?? "all";
  const matches = (r: Row) => (channel === "all" ? true : channel === "unread" ? r.readAt === null : NOTIFICATION_CHANNEL[r.kind] === channel);

  if (!hasDatabase) {
    const mine = rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: await hydrate(mine.filter(matches).slice(0, limit)), unread: mine.filter((r) => r.readAt === null).length, total: mine.length };
  }
  const kinds = channel === "all" || channel === "unread" ? undefined : NOTIFICATION_KINDS.filter((k) => NOTIFICATION_CHANNEL[k] === channel);
  const [list, unread, total] = await Promise.all([
    prisma.notification.findMany({ where: { userId, ...(kinds ? { kind: { in: kinds } } : {}), ...(channel === "unread" ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return { items: await hydrate(list.map(toRow)), unread, total };
}

/** Per-channel unread counts for the tab chips. */
export async function countByChannel(userId: string): Promise<Record<NotificationChannel | "all" | "unread", number>> {
  const out = { all: 0, unread: 0, social: 0, skills: 0, system: 0 };
  const list = hasDatabase ? (await prisma.notification.findMany({ where: { userId }, select: { kind: true, readAt: true } })).map((r) => ({ kind: isKind(r.kind) ? r.kind : ("system" as const), readAt: r.readAt })) : rows.filter((r) => r.userId === userId);
  for (const r of list) {
    out.all += 1;
    if (r.readAt === null) out.unread += 1;
    out[NOTIFICATION_CHANNEL[r.kind]] += 1;
  }
  return out;
}

/** What the drawer polls: unread total plus rows created after `after` (the client's last cursor). */
export async function pollNotifications(userId: string, after: string | null): Promise<NotificationPoll> {
  const serverTime = new Date().toISOString();
  if (!hasDatabase) {
    const mine = rows.filter((r) => r.userId === userId);
    const fresh = after ? mine.filter((r) => r.createdAt > after).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 20) : [];
    return { unread: mine.filter((r) => r.readAt === null).length, fresh: await hydrate(fresh), serverTime };
  }
  const [unread, fresh] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    after ? prisma.notification.findMany({ where: { userId, createdAt: { gt: new Date(after) } }, orderBy: { createdAt: "asc" }, take: 20 }) : Promise.resolve([]),
  ]);
  return { unread, fresh: await hydrate(fresh.map(toRow)), serverTime };
}

/** Marks the given ids (or everything when `ids` is omitted) as read; returns the new unread count. */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const now = new Date();
  if (!hasDatabase) {
    for (const r of rows) {
      if (r.userId === userId && r.readAt === null && (!ids || ids.includes(r.id))) r.readAt = now.toISOString();
    }
    return rows.filter((r) => r.userId === userId && r.readAt === null).length;
  }
  await prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: now } });
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Removes one row from the inbox (the card's ✕). Only the owner can dismiss. */
export async function dismiss(userId: string, id: string): Promise<boolean> {
  if (!hasDatabase) {
    const i = rows.findIndex((r) => r.id === id && r.userId === userId);
    if (i < 0) return false;
    rows.splice(i, 1);
    return true;
  }
  const res = await prisma.notification.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

/** Test / seed helper for the in-memory store. */
export function resetNotificationsForTests() {
  rows.length = 0;
}
