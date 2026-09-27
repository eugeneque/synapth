/**
 * Cortex · Granted Pro
 *
 * Admins hand out Synapth Pro without a payment (partners, contributors,
 * support cases). A grant is an ordinary `Subscription` row with
 * `provider: "grant"`: it applies Pro limits and the Pro mark, is never
 * charged or renewed, and simply ends when its period does. A paying
 * subscriber is never overwritten; granting again extends the grant, and
 * «subscriber since» keeps running while the grant is live.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { RoleChangeError, isSystemAccount, requirePermission } from "@/cortex/roles";
import { effectiveStatus, getSubscriptionRow, getSubscriptionRows, saveSubscription } from "@/cortex/subscription-store";
import { PRO_GRANT_MONTHS, type ProGrantMonths, type Subscription } from "@/types/billing";

/** Admin directory view of someone's plan. */
export interface ProGrantState {
  /** Live Pro-or-better plan, whatever its source. */
  active: boolean;
  plan: Subscription["plan"] | null;
  granted: boolean;
  since: string | null;
  until: string | null;
}

export const NO_PRO: ProGrantState = { active: false, plan: null, granted: false, since: null, until: null };

export function proGrantState(sub: Subscription | null, now = Date.now()): ProGrantState {
  if (!sub || sub.plan === "free" || effectiveStatus(sub, now) === "canceled") return NO_PRO;
  return { active: true, plan: sub.plan, granted: sub.provider === "grant", since: sub.subscribedSince, until: sub.currentPeriodEnd };
}

function addMonths(fromMs: number, months: number): string {
  const d = new Date(fromMs);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

async function assertPerson(targetId: string): Promise<void> {
  if (isSystemAccount(targetId)) throw new RoleChangeError("System accounts cannot hold a plan");
  const exists = hasDatabase ? Boolean(await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })) : memoryUsers.some((u) => u.id === targetId);
  if (!exists) throw new RoleChangeError("User not found", 404);
}

/** Grants Pro for `months`, or extends a live grant by that much. Refuses over a paid subscription. */
export async function grantPro(actorId: string, targetId: string, months: number, now = Date.now()): Promise<ProGrantState> {
  await requirePermission(actorId, "subscriptions.grant");
  if (!PRO_GRANT_MONTHS.includes(months as ProGrantMonths)) throw new RoleChangeError("Unsupported grant length");
  await assertPerson(targetId);

  const sub = await getSubscriptionRow(targetId);
  const live = sub && effectiveStatus(sub, now) !== "canceled" ? sub : null;
  if (live && live.provider !== "grant" && live.plan !== "free") throw new RoleChangeError("The user already pays for a plan", 409);

  const extending = live?.provider === "grant";
  const start = extending ? live.currentPeriodStart : new Date(now).toISOString();
  const from = extending ? Math.max(Date.parse(live.currentPeriodEnd), now) : now;
  const saved = await saveSubscription({
    userId: targetId,
    plan: "pro",
    period: months >= 12 ? "year" : "month",
    seats: 1,
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: addMonths(from, months),
    // Never renewed: the renewal pass ends grants when the period is over.
    cancelAtPeriodEnd: true,
    pendingPlan: null,
    provider: "grant",
    paymentMethodId: null,
    grantedById: actorId,
  });
  return proGrantState(saved, now);
}

/** Ends a grant right away. Paid subscriptions are the subscriber's to cancel, not staff's. */
export async function revokePro(actorId: string, targetId: string, now = Date.now()): Promise<ProGrantState> {
  await requirePermission(actorId, "subscriptions.grant");
  await assertPerson(targetId);
  const sub = await getSubscriptionRow(targetId);
  if (!sub || effectiveStatus(sub, now) === "canceled") return NO_PRO;
  if (sub.provider !== "grant") throw new RoleChangeError("Only a granted plan can be revoked here", 409);
  await saveSubscription({ ...sub, status: "canceled", currentPeriodEnd: new Date(now).toISOString() });
  return NO_PRO;
}

/** Batch view for the admin directory. */
export async function proGrantStates(userIds: string[], now = Date.now()): Promise<Map<string, ProGrantState>> {
  const subs = new Map((await getSubscriptionRows(userIds)).map((s) => [s.userId, s]));
  return new Map(userIds.map((id) => [id, proGrantState(subs.get(id) ?? null, now)]));
}
