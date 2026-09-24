/**
 * Cortex · Achievements
 *
 * `evaluateBadges(userId)` is idempotent: it recomputes the auto criteria
 * from catalogue + social signals and awards whatever is newly met, one
 * notification per new badge. Server actions call it after the event that
 * could have changed the outcome (a post, an impulse, a publish); the
 * profile page calls it for its owner so seeded data catches up too.
 * `grantBadge()` handles the manual tier (admin / ops). `unique` badges
 * follow an account flag both ways: evaluation also revokes them.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { getProfile } from "@/cortex/account";
import { notify } from "@/cortex/notifications";
import { skillRepository } from "@/cortex/repository";
import { socialSignals } from "@/cortex/social";
import { friendCounts } from "@/cortex/friends";
import { listSkillsets } from "@/cortex/skillsets";
import { hasPermission } from "@/cortex/roles";
import { BADGES, BADGE_CRITERIA, BADGE_THRESHOLDS, badgeById, isBadgeId, type BadgeDefinition, type BadgeId, type BadgeSignals, type UserBadge } from "@/types/badges";

const g = globalThis as unknown as { __synapthBadges_v2?: Map<string, UserBadge[]> };
const mem = g.__synapthBadges_v2 ?? (g.__synapthBadges_v2 = new Map<string, UserBadge[]>());

export interface AwardedBadge extends UserBadge {
  def: BadgeDefinition;
}

export async function listBadges(userId: string): Promise<AwardedBadge[]> {
  let rows: UserBadge[];
  if (hasDatabase) {
    const dbRows = await prisma.userBadge.findMany({ where: { userId }, orderBy: { awardedAt: "asc" } });
    rows = dbRows.flatMap((r): UserBadge[] => (isBadgeId(r.badgeId) ? [{ badgeId: r.badgeId, awardedAt: r.awardedAt.toISOString(), grantedBy: r.grantedBy }] : []));
  } else rows = mem.get(userId) ?? [];
  return rows.map((r) => ({ ...r, def: badgeById(r.badgeId) }));
}

async function award(userId: string, badgeId: BadgeId, grantedBy: string | null): Promise<UserBadge | null> {
  const awardedAt = new Date();
  if (!hasDatabase) {
    const list = mem.get(userId) ?? [];
    if (list.some((b) => b.badgeId === badgeId)) return null;
    const row: UserBadge = { badgeId, awardedAt: awardedAt.toISOString(), grantedBy };
    mem.set(userId, [...list, row]);
    await notify({ userId, kind: "badge", actorId: grantedBy, subject: { kind: "badge", badgeId } });
    return row;
  }
  const existing = await prisma.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId } } });
  if (existing) return null;
  await prisma.userBadge.create({ data: { userId, badgeId, awardedAt, grantedBy } });
  await notify({ userId, kind: "badge", actorId: grantedBy, subject: { kind: "badge", badgeId } });
  return { badgeId, awardedAt: awardedAt.toISOString(), grantedBy };
}

/** Silent removal (no notification): the flag behind a unique badge was taken away. */
async function revoke(userId: string, badgeId: BadgeId): Promise<void> {
  if (!hasDatabase) {
    const list = mem.get(userId) ?? [];
    mem.set(userId, list.filter((b) => b.badgeId !== badgeId));
    return;
  }
  await prisma.userBadge.deleteMany({ where: { userId, badgeId } });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Gathers the numbers the auto criteria read. */
export async function badgeSignals(userId: string): Promise<BadgeSignals> {
  const [profile, all, social, friends, verifiedSets] = await Promise.all([
    getProfile(userId),
    skillRepository.all(),
    socialSignals(userId),
    friendCounts(userId),
    listSkillsets({ authorId: userId, verified: true, limit: BADGE_THRESHOLDS.five }),
  ]);
  const skills = all.filter((s) => s.authorId === userId);
  const verified = skills.filter((s) => s.securityLevel === "Verified");
  const verifiedIn = (category: string) => verified.filter((s) => s.category === category).length;
  return {
    skills: skills.length,
    topInstalls: skills.reduce((max, s) => Math.max(max, s.downloadsCount), 0),
    verified: { skillset: verifiedSets.length, Prompt: verifiedIn("Prompt"), MCP: verifiedIn("MCP"), Plugin: verifiedIn("Plugin") },
    posts: social.posts,
    impulsesReceived: social.impulsesReceived,
    friends: friends.friends,
    accountAgeDays: profile ? Math.floor((Date.now() - Date.parse(profile.createdAt)) / DAY_MS) : 0,
    isDeveloper: Boolean(profile?.developer),
  };
}

/** Awards every auto badge whose criteria are now met (and revokes unique ones that no longer hold); returns the new ones. */
export async function evaluateBadges(userId: string): Promise<UserBadge[]> {
  const signals = await badgeSignals(userId);
  const have = new Set((await listBadges(userId)).map((b) => b.badgeId));
  const fresh: UserBadge[] = [];
  for (const def of BADGES as readonly BadgeDefinition[]) {
    if (def.award !== "auto") continue;
    const met = BADGE_CRITERIA[def.id as BadgeId](signals);
    const id = def.id as BadgeId;
    if (have.has(id)) {
      if (def.unique && !met) await revoke(userId, id);
      continue;
    }
    if (!met) continue;
    const row = await award(userId, id, null);
    if (row) fresh.push(row);
  }
  return fresh;
}

export class BadgeGrantError extends Error {
  status = 403 as const;
  constructor(message: string) {
    super(message);
    this.name = "BadgeGrantError";
  }
}

/** Manual grant: only admins, any non-unique badge id. Returns null when already held. */
export async function grantBadge(adminId: string, userId: string, badgeId: string): Promise<UserBadge | null> {
  if (!(await hasPermission(adminId, "badges.grant"))) throw new BadgeGrantError("Only admins can grant badges");
  if (!isBadgeId(badgeId)) throw new BadgeGrantError(`Unknown badge ${badgeId}`);
  if ((badgeById(badgeId) as BadgeDefinition).unique) throw new BadgeGrantError(`${badgeId} follows an account flag and cannot be granted by hand`);
  return award(userId, badgeId, adminId);
}

/** Test helper for the in-memory store. */
export function resetBadgesForTests() {
  mem.clear();
}
