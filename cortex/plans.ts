/**
 * Cortex · Plan limits and daily agent quotas (ТЗ §4.1).
 *
 * The plan comes from the subscription (`cortex/payments.ts`); Free is the
 * default. Daily counters live in memory per process, like the per-minute
 * rate limits: good enough to stop runaway agents, not an invoice. Metered
 * billing would move them to the database.
 */

import { currentPlanId } from "@/cortex/payments";
import { PLANS, type PlanId, type PlanLimits, type PlanSpec } from "@/types/billing";

export class QuotaExceededError extends Error {
  status = 429 as const;
  code = "quota_exceeded" as const;
  constructor(
    public readonly quota: "requestsPerDay" | "resolvePerDay",
    public readonly limit: number,
    public readonly retryAfter: number,
  ) {
    super(`Daily ${quota === "resolvePerDay" ? "resolve_task" : "agent request"} quota of ${limit} is used up`);
    this.name = "QuotaExceededError";
  }
}

export async function currentPlan(userId: string): Promise<PlanSpec> {
  return PLANS[await currentPlanId(userId)];
}

export async function planLimits(userId: string): Promise<PlanLimits> {
  return (await currentPlan(userId)).limits;
}

type Counter = "request" | "resolve";
const g = globalThis as unknown as { __synapthAgentUsage_v1?: Map<string, number> };
const usage: Map<string, number> = g.__synapthAgentUsage_v1 ?? (g.__synapthAgentUsage_v1 = new Map());

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const secondsToMidnight = (now: number) => Math.max(1, Math.ceil((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1) - now) / 1000));

export function usageToday(userId: string, now = Date.now()): Record<Counter, number> {
  const day = utcDay(now);
  return { request: usage.get(`${day}:${userId}:request`) ?? 0, resolve: usage.get(`${day}:${userId}:resolve`) ?? 0 };
}

/** Counts one agent call; `resolve` also counts as a request. Throws when the plan's daily quota is used up. */
export async function enforceAgentQuota(userId: string, kind: Counter, now = Date.now(), plan?: PlanId): Promise<void> {
  const limits = plan ? PLANS[plan].limits : await planLimits(userId);
  const day = utcDay(now);
  // Yesterday's counters are dead weight.
  if (usage.size > 10_000) for (const key of usage.keys()) if (!key.startsWith(day)) usage.delete(key);
  const used = usageToday(userId, now);
  if (used.request >= limits.requestsPerDay) throw new QuotaExceededError("requestsPerDay", limits.requestsPerDay, secondsToMidnight(now));
  if (kind === "resolve" && used.resolve >= limits.resolvePerDay) throw new QuotaExceededError("resolvePerDay", limits.resolvePerDay, secondsToMidnight(now));
  usage.set(`${day}:${userId}:request`, used.request + 1);
  if (kind === "resolve") usage.set(`${day}:${userId}:resolve`, used.resolve + 1);
}

export function resetUsageForTests() {
  usage.clear();
}
