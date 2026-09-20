/**
 * Cortex · Achievements
 *
 * `evaluateBadges(userId)` is idempotent: it recomputes the auto criteria
 * from catalogue + social signals and awards whatever is newly met, one
 * notification per new badge. Server actions call it after the event that
 * could have changed the outcome (a post, an impulse, a publish); the
 * profile page calls it for its owner so seeded data catches up too.
 * `grantBadge()` handles the manual tier (admin / ops).
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { getProfile } from "@/cortex/account";
import { notify } from "@/cortex/notifications";
import { skillRepository } from "@/cortex/repository";
import { socialSignals } from "@/cortex/social";
import { BADGES, BADGE_CRITERIA, badgeById, isBadgeId, type BadgeDefinition, type BadgeId, type BadgeSignals, type UserBadge } from "@/types/badges";

const g = globalThis as unknown as { __synapthBadges_v1?: Map<string, UserBadge[]> };
const mem = g.__synapthBadges_v1 ?? (g.__synapthBadges_v1 = new Map<string, UserBadge[]>());

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

/** Gathers the numbers the auto criteria read. */
export async function badgeSignals(userId: string): Promise<BadgeSignals> {
  const [profile, all, social] = await Promise.all([getProfile(userId), skillRepository.all(), socialSignals(userId)]);
  const skills = all.filter((s) => s.authorId === userId);
  return {
    skills: skills.length,
    verifiedSkills: skills.filter((s) => s.securityLevel === "Verified").length,
    mcpSkills: skills.filter((s) => s.category === "MCP").length,
    promptSkills: skills.filter((s) => s.category === "Prompt").length,
    toolSkills: skills.filter((s) => s.category === "Tool").length,
    githubSkills: skills.filter((s) => s.origin === "github").length,
    isAdmin: profile?.role === "admin",
    ...social,
  };
}

/** Awards every auto badge whose criteria are now met and returns the new ones. */
export async function evaluateBadges(userId: string): Promise<UserBadge[]> {
  const signals = await badgeSignals(userId);
  const have = new Set((await listBadges(userId)).map((b) => b.badgeId));
  const fresh: UserBadge[] = [];
  for (const def of BADGES) {
    if (def.award !== "auto" || have.has(def.id)) continue;
    const met = BADGE_CRITERIA[def.id as keyof typeof BADGE_CRITERIA];
    if (!met?.(signals)) continue;
    const row = await award(userId, def.id, null);
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

/** Manual grant: only admins, any badge id. Returns null when already held. */
export async function grantBadge(adminId: string, userId: string, badgeId: string): Promise<UserBadge | null> {
  const admin = await getProfile(adminId);
  if (admin?.role !== "admin") throw new BadgeGrantError("Only admins can grant badges");
  if (!isBadgeId(badgeId)) throw new BadgeGrantError(`Unknown badge ${badgeId}`);
  return award(userId, badgeId, adminId);
}

/** Test helper for the in-memory store. */
export function resetBadgesForTests() {
  mem.clear();
}
