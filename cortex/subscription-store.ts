/**
 * Cortex · Subscription store
 *
 * The `Subscription` rows behind Synapth Pro, split out of `cortex/payments.ts`
 * so read paths that sit under `cortex/auth.ts` (account → author refs → the
 * Pro mark) never pull the payment providers or `node:crypto` into the edge
 * middleware bundle. Checkout, webhooks and renewals stay in payments.ts.
 */

import type { Prisma } from "@prisma/client";
import { prisma, hasDatabase } from "@/cortex/db";
import { DUNNING, PRO_MARK_PLANS, type BillingPeriod, type PlanId, type ProStatus, type Subscription, type SubscriptionProvider } from "@/types/billing";

const DAY = 86_400_000;

/** In-memory rows; payments.ts keeps its payment rows in the same singleton. */
export interface PaymentsMemory {
  payments: unknown[];
  subs: Subscription[];
}
const g = globalThis as unknown as { __synapthPayments_v1?: PaymentsMemory };
export const paymentsMemory: PaymentsMemory = g.__synapthPayments_v1 ?? (g.__synapthPayments_v1 = { payments: [], subs: [] });

type DbSub = Prisma.SubscriptionGetPayload<object>;

export const subFromDb = (r: DbSub): Subscription => ({
  id: r.id,
  userId: r.userId,
  plan: r.plan as PlanId,
  period: r.period as BillingPeriod,
  seats: r.seats,
  status: r.status as Subscription["status"],
  currentPeriodStart: r.currentPeriodStart.toISOString(),
  currentPeriodEnd: r.currentPeriodEnd.toISOString(),
  cancelAtPeriodEnd: r.cancelAtPeriodEnd,
  pendingPlan: (r.pendingPlan as PlanId | null) ?? null,
  provider: r.provider as SubscriptionProvider,
  paymentMethodId: r.paymentMethodId,
  subscribedSince: (r.subscribedSince ?? r.createdAt).toISOString(),
  grantedById: r.grantedById,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function getSubscriptionRow(userId: string): Promise<Subscription | null> {
  if (!hasDatabase) return paymentsMemory.subs.find((s) => s.userId === userId) ?? null;
  const row = await prisma.subscription.findUnique({ where: { userId } });
  return row ? subFromDb(row) : null;
}

export async function getSubscriptionRows(userIds: string[]): Promise<Subscription[]> {
  if (!userIds.length) return [];
  if (!hasDatabase) return paymentsMemory.subs.filter((s) => userIds.includes(s.userId));
  return (await prisma.subscription.findMany({ where: { userId: { in: userIds } } })).map(subFromDb);
}

export type SubscriptionWrite = Omit<Subscription, "id" | "createdAt" | "updatedAt" | "subscribedSince" | "grantedById"> & Partial<Pick<Subscription, "id" | "subscribedSince" | "grantedById">>;

/**
 * Upsert by user. `subscribedSince` carries over while the previous row is
 * still live (upgrades, renewals, grant extensions) and restarts after a gap.
 */
export async function saveSubscription(sub: SubscriptionWrite): Promise<Subscription> {
  const now = new Date().toISOString();
  const prev = await getSubscriptionRow(sub.userId);
  const since = sub.subscribedSince ?? (prev && effectiveStatus(prev) !== "canceled" ? prev.subscribedSince : now);
  const grantedById = sub.grantedById !== undefined ? sub.grantedById : sub.provider === "grant" ? (prev?.grantedById ?? null) : null;
  if (!hasDatabase) {
    const existing = paymentsMemory.subs.find((s) => s.userId === sub.userId);
    if (existing) {
      Object.assign(existing, sub, { id: existing.id, subscribedSince: since, grantedById, updatedAt: now });
      return { ...existing };
    }
    const row: Subscription = { ...sub, id: sub.id ?? `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, subscribedSince: since, grantedById, createdAt: now, updatedAt: now };
    paymentsMemory.subs.push(row);
    return { ...row };
  }
  const { id: _id, ...data } = sub;
  const fields = { ...data, subscribedSince: new Date(since), grantedById, currentPeriodStart: new Date(sub.currentPeriodStart), currentPeriodEnd: new Date(sub.currentPeriodEnd) };
  const row = await prisma.subscription.upsert({ where: { userId: sub.userId }, create: fields, update: fields });
  return subFromDb(row);
}

/** Status as of `now`: the stored row only changes on events, time moves it along here. Grants have no dunning. */
export function effectiveStatus(sub: Subscription, now = Date.now()): Subscription["status"] {
  if (sub.status === "canceled") return "canceled";
  const end = Date.parse(sub.currentPeriodEnd);
  if (now < end) return sub.status === "past_due" ? "past_due" : "active";
  if (sub.cancelAtPeriodEnd || sub.provider === "grant") return "canceled";
  return now < end + DUNNING.graceDays * DAY ? "grace" : "canceled";
}

const proFromSub = (sub: Subscription, now: number): ProStatus | null =>
  PRO_MARK_PLANS.includes(sub.plan) && effectiveStatus(sub, now) !== "canceled" ? { plan: sub.plan, since: sub.subscribedSince } : null;

/** Batch lookup of the public Pro mark for names in feeds, cards and profiles; users without a live paid plan are absent. */
export async function getProStatuses(userIds: Iterable<string>, now = Date.now()): Promise<Map<string, ProStatus>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, ProStatus>();
  if (!ids.length) return out;
  const subs = hasDatabase
    ? (await prisma.subscription.findMany({ where: { userId: { in: ids }, plan: { in: [...PRO_MARK_PLANS] }, status: { not: "canceled" } } })).map(subFromDb)
    : paymentsMemory.subs.filter((s) => ids.includes(s.userId));
  for (const sub of subs) {
    const pro = proFromSub(sub, now);
    if (pro) out.set(sub.userId, pro);
  }
  return out;
}
