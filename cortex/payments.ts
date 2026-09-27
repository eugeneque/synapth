/**
 * Cortex · Synapth Pro: subscriptions, checkout and payment history (ТЗ §4.1, §4.6).
 *
 * Flow:
 *   startCheckout → Payment(pending) → provider.createPayment → redirect to the
 *   hosted checkout → the provider calls /api/v1/billing/webhook/<provider>
 *   (or the user comes back to the return page, which re-reads the status)
 *   → applyPaymentEvent: pending → succeeded|failed exactly once →
 *   subscription activated / extended, or the wallet credited.
 *
 * Plan changes (§4.6): an upgrade applies at once and charges the prorated
 * difference; a downgrade is scheduled for the next period; «cancel» keeps
 * the plan until the period ends. A failed renewal leaves the plan working
 * for `DUNNING.graceDays`, then the account falls back to Free.
 *
 * Plan prices are RUB minor units; wallet top-ups are USD (the wallet ledger
 * stays in micro-dollars until the rouble switch is confirmed).
 */

import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, hasDatabase } from "@/cortex/db";
import { billing } from "@/cortex/billing";
import { availableProviders, PROVIDERS, type PaymentProvider, type WebhookEvent } from "@/cortex/payment-providers";
import {
  DUNNING,
  PLANS,
  planPrice,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  type BillingPeriod,
  type Payment,
  type PaymentMethod,
  type PaymentProviderId,
  type PaymentStatus,
  type PlanId,
  type Subscription,
} from "@/types/billing";

const DAY = 86_400_000;

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 503 = 400,
    public readonly code = "payment_error",
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

interface PaymentMeta {
  change?: "new" | "upgrade" | "renewal";
  /** Upgrade within the same period keeps the end date. */
  keepPeriodEnd?: boolean;
}

type PaymentRow = Payment & { metadata: PaymentMeta };

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface Store {
  payments: PaymentRow[];
  subs: Subscription[];
}
const g = globalThis as unknown as { __synapthPayments_v1?: Store };
const mem: Store = g.__synapthPayments_v1 ?? (g.__synapthPayments_v1 = { payments: [], subs: [] });

const newId = (p: string) => `${p}_${randomBytes(8).toString("hex")}`;

type DbPayment = Prisma.PaymentGetPayload<object>;
type DbSub = Prisma.SubscriptionGetPayload<object>;

const paymentFromDb = (r: DbPayment): PaymentRow => ({
  id: r.id,
  userId: r.userId,
  kind: r.kind === "topup" ? "topup" : "subscription",
  plan: (r.plan as PlanId | null) ?? null,
  period: (r.period as BillingPeriod | null) ?? null,
  seats: r.seats,
  amount: r.amount,
  currency: r.currency === "USD" ? "USD" : "RUB",
  provider: r.provider as PaymentProviderId,
  method: r.method as PaymentMethod,
  status: r.status as PaymentStatus,
  providerPaymentId: r.providerPaymentId,
  confirmationUrl: r.confirmationUrl,
  description: r.description,
  failureReason: r.failureReason,
  createdAt: r.createdAt.toISOString(),
  paidAt: r.paidAt?.toISOString() ?? null,
  metadata: (r.metadata ?? {}) as PaymentMeta,
});

const subFromDb = (r: DbSub): Subscription => ({
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
  provider: r.provider as PaymentProviderId,
  paymentMethodId: r.paymentMethodId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function findPayment(where: { id?: string; provider?: PaymentProviderId; providerPaymentId?: string }): Promise<PaymentRow | null> {
  if (!hasDatabase) {
    return mem.payments.find((p) => (where.id ? p.id === where.id : p.provider === where.provider && p.providerPaymentId === where.providerPaymentId)) ?? null;
  }
  const row = where.id
    ? await prisma.payment.findUnique({ where: { id: where.id } })
    : await prisma.payment.findUnique({ where: { provider_providerPaymentId: { provider: where.provider!, providerPaymentId: where.providerPaymentId! } } });
  return row ? paymentFromDb(row) : null;
}

async function insertPayment(row: PaymentRow): Promise<void> {
  if (!hasDatabase) {
    mem.payments.push(row);
    return;
  }
  const { createdAt: _c, paidAt: _p, metadata, ...data } = row;
  await prisma.payment.create({ data: { ...data, metadata: metadata as Prisma.InputJsonValue } });
}

async function patchPayment(id: string, patch: Partial<Pick<PaymentRow, "providerPaymentId" | "confirmationUrl" | "status" | "failureReason">>): Promise<void> {
  if (!hasDatabase) {
    Object.assign(mem.payments.find((p) => p.id === id) ?? {}, patch);
    return;
  }
  await prisma.payment.update({ where: { id }, data: patch });
}

/** pending → final, exactly once: returns false when another delivery got there first. */
async function closePayment(id: string, status: PaymentStatus, failureReason: string | null): Promise<boolean> {
  const paidAt = status === "succeeded" ? new Date() : null;
  if (!hasDatabase) {
    const row = mem.payments.find((p) => p.id === id);
    if (!row || row.status !== "pending") return false;
    Object.assign(row, { status, failureReason, paidAt: paidAt?.toISOString() ?? null });
    return true;
  }
  const res = await prisma.payment.updateMany({ where: { id, status: "pending" }, data: { status, failureReason, paidAt } });
  return res.count === 1;
}

export async function getSubscriptionRow(userId: string): Promise<Subscription | null> {
  if (!hasDatabase) return mem.subs.find((s) => s.userId === userId) ?? null;
  const row = await prisma.subscription.findUnique({ where: { userId } });
  return row ? subFromDb(row) : null;
}

async function saveSubscription(sub: Omit<Subscription, "id" | "createdAt" | "updatedAt"> & Partial<Pick<Subscription, "id">>): Promise<Subscription> {
  const now = new Date().toISOString();
  if (!hasDatabase) {
    const existing = mem.subs.find((s) => s.userId === sub.userId);
    if (existing) {
      Object.assign(existing, sub, { id: existing.id, updatedAt: now });
      return { ...existing };
    }
    const row: Subscription = { ...sub, id: sub.id ?? newId("sub"), createdAt: now, updatedAt: now };
    mem.subs.push(row);
    return { ...row };
  }
  const { id: _id, ...data } = sub;
  const fields = { ...data, currentPeriodStart: new Date(sub.currentPeriodStart), currentPeriodEnd: new Date(sub.currentPeriodEnd) };
  const row = await prisma.subscription.upsert({ where: { userId: sub.userId }, create: fields, update: fields });
  return subFromDb(row);
}

// ---------------------------------------------------------------------------
// Plan state
// ---------------------------------------------------------------------------

export function addPeriod(fromIso: string, period: BillingPeriod): string {
  const d = new Date(fromIso);
  if (period === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/** Status as of `now`: the stored row only changes on events, time moves it along here. */
export function effectiveStatus(sub: Subscription, now = Date.now()): Subscription["status"] {
  if (sub.status === "canceled") return "canceled";
  const end = Date.parse(sub.currentPeriodEnd);
  if (now < end) return sub.status === "past_due" ? "past_due" : "active";
  if (sub.cancelAtPeriodEnd) return "canceled";
  return now < end + DUNNING.graceDays * DAY ? "grace" : "canceled";
}

/** The plan whose limits apply right now. */
export async function currentPlanId(userId: string, now = Date.now()): Promise<PlanId> {
  const sub = await getSubscriptionRow(userId);
  if (!sub) return "free";
  return effectiveStatus(sub, now) === "canceled" ? "free" : sub.plan;
}

export interface PlanQuote {
  change: "new" | "upgrade" | "downgrade" | "same";
  /** Due now, minor units RUB; 0 for downgrades (scheduled). */
  amount: number;
  effective: "now" | "period_end";
  periodEnd: string;
}

const RANK: Record<PlanId, number> = { free: 0, pro: 1, team: 2, business: 3 };

export async function quotePlanChange(userId: string, plan: PlanId, period: BillingPeriod, seats = 1, now = Date.now()): Promise<PlanQuote> {
  const spec = PLANS[plan];
  if (!spec.selfServe || plan === "free") throw new PaymentError(plan === "free" ? "Switch to Free by canceling the subscription" : "This plan is sold through sales", 400, "not_self_serve");
  const price = planPrice(spec, period, seats);
  if (price === null) throw new PaymentError(`${plan} has no ${period} price`, 400, "no_price");
  const sub = await getSubscriptionRow(userId);
  const active = sub && effectiveStatus(sub, now) !== "canceled" ? sub : null;
  const nowIso = new Date(now).toISOString();
  if (!active) return { change: "new", amount: price, effective: "now", periodEnd: addPeriod(nowIso, period) };

  const oldPrice = planPrice(PLANS[active.plan], active.period, active.seats) ?? 0;
  const start = Date.parse(active.currentPeriodStart);
  const end = Date.parse(active.currentPeriodEnd);
  const remaining = Math.min(1, Math.max(0, (end - now) / Math.max(1, end - start)));
  const sameShape = active.plan === plan && active.period === period && active.seats === seats;
  if (sameShape) return { change: "same", amount: 0, effective: "now", periodEnd: active.currentPeriodEnd };

  const upgrade = RANK[plan] > RANK[active.plan] || (plan === active.plan && (seats > active.seats || (period === "year" && active.period === "month")));
  if (!upgrade) return { change: "downgrade", amount: 0, effective: "period_end", periodEnd: active.currentPeriodEnd };

  // Same period: pay the difference for what is left of it. New period length: start over, minus the unused credit.
  if (period === active.period) return { change: "upgrade", amount: Math.max(0, Math.round((price - oldPrice) * remaining)), effective: "now", periodEnd: active.currentPeriodEnd };
  return { change: "upgrade", amount: Math.max(0, Math.round(price - oldPrice * remaining)), effective: "now", periodEnd: addPeriod(nowIso, period) };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export type CheckoutInput =
  | { kind: "subscription"; plan: PlanId; period: BillingPeriod; seats?: number; method: PaymentMethod; provider?: PaymentProviderId }
  | { kind: "topup"; amountUsd: number; method: PaymentMethod; provider?: PaymentProviderId };

export type CheckoutOutcome = { kind: "redirect"; paymentId: string; url: string } | { kind: "scheduled"; effective: string } | { kind: "noop" };

function pickProvider(currency: Payment["currency"], method: PaymentMethod, requested?: PaymentProviderId): PaymentProvider {
  const list = availableProviders(currency).filter((p) => p.methods.includes(method));
  const chosen = requested ? list.find((p) => p.id === requested) : list[0];
  if (!chosen) throw new PaymentError(requested ? `${requested} is not available for ${currency} / ${method}` : "No payment provider is configured", 503, "provider_unavailable");
  return chosen;
}

export async function startCheckout(userId: string, input: CheckoutInput, opts: { returnBase: string; email?: string | null }): Promise<CheckoutOutcome> {
  let row: PaymentRow;
  const id = newId("pay");
  if (input.kind === "subscription") {
    const seats = PLANS[input.plan].perSeat ? Math.max(input.seats ?? 1, PLANS[input.plan].minSeats) : 1;
    const quote = await quotePlanChange(userId, input.plan, input.period, seats);
    if (quote.change === "same") return { kind: "noop" };
    if (quote.change === "downgrade") {
      const sub = (await getSubscriptionRow(userId))!;
      await saveSubscription({ ...sub, pendingPlan: input.plan, cancelAtPeriodEnd: false });
      return { kind: "scheduled", effective: sub.currentPeriodEnd };
    }
    const current = await getSubscriptionRow(userId);
    const keepPeriodEnd = quote.change === "upgrade" && input.period === current?.period;
    if (quote.amount === 0) {
      // Fully covered by the unused credit: apply without a payment.
      await activate({ userId, plan: input.plan, period: input.period, seats, provider: current?.provider ?? "mock", paymentMethodId: null }, { change: quote.change === "upgrade" ? "upgrade" : "new", keepPeriodEnd });
      return { kind: "noop" };
    }
    const provider = pickProvider("RUB", input.method, input.provider);
    row = {
      id,
      userId,
      kind: "subscription",
      plan: input.plan,
      period: input.period,
      seats,
      amount: quote.amount,
      currency: "RUB",
      provider: provider.id,
      method: input.method,
      status: "pending",
      providerPaymentId: null,
      confirmationUrl: null,
      description: `Synapth ${input.plan} · ${input.period}${seats > 1 ? ` · ${seats} seats` : ""}${quote.change === "upgrade" ? " · upgrade" : ""}`,
      failureReason: null,
      createdAt: new Date().toISOString(),
      paidAt: null,
      metadata: { change: quote.change === "upgrade" ? "upgrade" : "new", keepPeriodEnd },
    };
  } else {
    if (!(input.amountUsd >= TOPUP_MIN_USD && input.amountUsd <= TOPUP_MAX_USD)) throw new PaymentError(`Top-ups are $${TOPUP_MIN_USD}–$${TOPUP_MAX_USD}`, 400, "amount");
    const provider = pickProvider("USD", input.method, input.provider);
    row = {
      id,
      userId,
      kind: "topup",
      plan: null,
      period: null,
      seats: null,
      amount: Math.round(input.amountUsd * 100),
      currency: "USD",
      provider: provider.id,
      method: input.method,
      status: "pending",
      providerPaymentId: null,
      confirmationUrl: null,
      description: `Synapth wallet top-up · $${input.amountUsd.toFixed(2)}`,
      failureReason: null,
      createdAt: new Date().toISOString(),
      paidAt: null,
      metadata: {},
    };
  }

  await insertPayment(row);
  const provider = PROVIDERS[row.provider];
  try {
    const res = await provider.createPayment({ payment: row, returnUrl: `${opts.returnBase.replace(/\/$/, "")}/dashboard/billing/return?payment=${row.id}`, savePaymentMethod: row.kind === "subscription", email: opts.email });
    await patchPayment(row.id, { providerPaymentId: res.providerPaymentId, confirmationUrl: res.confirmationUrl });
    return { kind: "redirect", paymentId: row.id, url: res.confirmationUrl };
  } catch (err) {
    await closePayment(row.id, "failed", (err as Error).message.slice(0, 200));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Applying provider events
// ---------------------------------------------------------------------------

async function activate(p: { userId: string; plan: PlanId; period: BillingPeriod; seats: number; provider: PaymentProviderId; paymentMethodId: string | null }, meta: PaymentMeta): Promise<Subscription> {
  const now = new Date().toISOString();
  const sub = await getSubscriptionRow(p.userId);
  const live = sub && effectiveStatus(sub) !== "canceled" ? sub : null;
  if (meta.change === "renewal" && live) {
    const start = live.currentPeriodEnd;
    return saveSubscription({ ...live, plan: live.pendingPlan ?? live.plan, pendingPlan: null, status: "active", currentPeriodStart: start, currentPeriodEnd: addPeriod(start, live.period), paymentMethodId: p.paymentMethodId ?? live.paymentMethodId });
  }
  if (meta.change === "upgrade" && live && meta.keepPeriodEnd) {
    return saveSubscription({ ...live, plan: p.plan, seats: p.seats, status: "active", pendingPlan: null, cancelAtPeriodEnd: false, provider: p.provider, paymentMethodId: p.paymentMethodId ?? live.paymentMethodId });
  }
  return saveSubscription({
    userId: p.userId,
    plan: p.plan,
    period: p.period,
    seats: p.seats,
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: addPeriod(now, p.period),
    cancelAtPeriodEnd: false,
    pendingPlan: null,
    provider: p.provider,
    paymentMethodId: p.paymentMethodId ?? live?.paymentMethodId ?? null,
  });
}

/**
 * Idempotent: providers retry notifications, and the return page may race
 * the webhook. Only the delivery that moves the payment out of `pending`
 * credits the wallet or activates the plan.
 */
export async function applyPaymentEvent(providerId: PaymentProviderId, event: WebhookEvent): Promise<PaymentRow | null> {
  const payment = (await findPayment({ provider: providerId, providerPaymentId: event.providerPaymentId })) ?? (event.paymentId ? await findPayment({ id: event.paymentId }) : null);
  if (!payment || payment.provider !== providerId) return null;
  if (event.status === "pending") return payment;
  if (!payment.providerPaymentId) await patchPayment(payment.id, { providerPaymentId: event.providerPaymentId });
  if (!(await closePayment(payment.id, event.status, event.failureReason))) return findPayment({ id: payment.id });

  if (event.status === "succeeded") {
    if (payment.kind === "topup") {
      await billing.topUp(payment.userId, payment.amount / 100, `Top-up ${payment.id}`);
    } else if (payment.plan && payment.period) {
      await activate({ userId: payment.userId, plan: payment.plan, period: payment.period, seats: payment.seats ?? 1, provider: payment.provider, paymentMethodId: event.paymentMethodId }, payment.metadata);
    }
  } else if (payment.metadata.change === "renewal") {
    const sub = await getSubscriptionRow(payment.userId);
    if (sub) await saveSubscription({ ...sub, status: "past_due" });
  }
  return findPayment({ id: payment.id });
}

/** Return page: ask the provider again instead of waiting for the webhook. */
export async function refreshPayment(userId: string, paymentId: string): Promise<PaymentRow | null> {
  const payment = await findPayment({ id: paymentId });
  if (!payment || payment.userId !== userId) return null;
  if (payment.status !== "pending" || !payment.providerPaymentId) return payment;
  const fetch = PROVIDERS[payment.provider].fetchStatus;
  const event = fetch ? await fetch.call(PROVIDERS[payment.provider], payment.providerPaymentId) : null;
  return event ? ((await applyPaymentEvent(payment.provider, event)) ?? payment) : payment;
}

/** The mock checkout page's buttons. Only the owner, only mock payments. */
export async function settleMockPayment(userId: string, paymentId: string, outcome: "succeeded" | "failed"): Promise<PaymentRow> {
  const payment = await findPayment({ id: paymentId });
  if (!payment || payment.userId !== userId) throw new PaymentError("Payment not found", 404, "not_found");
  if (payment.provider !== "mock" || !PROVIDERS.mock.configured()) throw new PaymentError("Not a mock payment", 403, "not_mock");
  return (await applyPaymentEvent("mock", { providerPaymentId: payment.providerPaymentId ?? `mock_${payment.id}`, paymentId: payment.id, status: outcome, paymentMethodId: outcome === "succeeded" && payment.kind === "subscription" ? `mock_pm_${userId}` : null, failureReason: outcome === "failed" ? "declined_by_tester" : null }))!;
}

// ---------------------------------------------------------------------------
// Subscription controls
// ---------------------------------------------------------------------------

/** «Cancel»: the plan works until the period ends, then Free. */
export async function cancelSubscription(userId: string): Promise<Subscription> {
  const sub = await getSubscriptionRow(userId);
  if (!sub || effectiveStatus(sub) === "canceled") throw new PaymentError("No active subscription", 404, "not_found");
  return saveSubscription({ ...sub, cancelAtPeriodEnd: true, pendingPlan: null });
}

export async function resumeSubscription(userId: string): Promise<Subscription> {
  const sub = await getSubscriptionRow(userId);
  if (!sub || effectiveStatus(sub) === "canceled") throw new PaymentError("No active subscription", 404, "not_found");
  return saveSubscription({ ...sub, cancelAtPeriodEnd: false, pendingPlan: null });
}

export async function listPayments(userId: string, limit = 50): Promise<Payment[]> {
  const rows = hasDatabase
    ? (await prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit })).map(paymentFromDb)
    : mem.payments.filter((p) => p.userId === userId).slice(-limit).reverse();
  return rows.map(({ metadata: _m, ...p }) => p);
}

export async function getPayment(userId: string, paymentId: string): Promise<Payment | null> {
  const row = await findPayment({ id: paymentId });
  if (!row || row.userId !== userId) return null;
  const { metadata: _m, ...p } = row;
  return p;
}

/**
 * Renewal pass (cron): charge saved methods for periods that ended; without
 * a saved method, or when the charge fails, the subscription goes past_due and
 * keeps working through the grace window.
 */
export async function renewDueSubscriptions(now = Date.now()): Promise<{ renewed: number; pastDue: number; ended: number }> {
  const subs = hasDatabase ? (await prisma.subscription.findMany({ where: { status: { in: ["active", "past_due"] }, currentPeriodEnd: { lte: new Date(now) } } })).map(subFromDb) : mem.subs.filter((s) => (s.status === "active" || s.status === "past_due") && Date.parse(s.currentPeriodEnd) <= now);
  let renewed = 0;
  let pastDue = 0;
  let ended = 0;
  for (const sub of subs) {
    if (sub.cancelAtPeriodEnd || effectiveStatus(sub, now) === "canceled") {
      await saveSubscription({ ...sub, status: "canceled" });
      ended += 1;
      continue;
    }
    const plan = PLANS[sub.pendingPlan ?? sub.plan];
    const amount = planPrice(plan, sub.period, sub.seats);
    const provider = PROVIDERS[sub.provider];
    if (!amount || !sub.paymentMethodId || !provider.chargeSaved || !provider.configured()) {
      if (sub.status !== "past_due") await saveSubscription({ ...sub, status: "past_due" });
      pastDue += 1;
      continue;
    }
    const row: PaymentRow = { id: newId("pay"), userId: sub.userId, kind: "subscription", plan: plan.id, period: sub.period, seats: sub.seats, amount, currency: "RUB", provider: provider.id, method: "card", status: "pending", providerPaymentId: null, confirmationUrl: null, description: `Synapth ${plan.id} · ${sub.period} · renewal`, failureReason: null, createdAt: new Date(now).toISOString(), paidAt: null, metadata: { change: "renewal" } };
    await insertPayment(row);
    const event = await provider.chargeSaved({ payment: row, paymentMethodId: sub.paymentMethodId }).catch((err: Error) => ({ providerPaymentId: `failed_${row.id}`, paymentId: row.id, status: "failed" as const, paymentMethodId: null, failureReason: err.message.slice(0, 200) }));
    const applied = await applyPaymentEvent(provider.id, { ...event, paymentId: row.id });
    if (applied?.status === "succeeded") renewed += 1;
    else pastDue += 1;
  }
  return { renewed, pastDue, ended };
}

export function resetPaymentsForTests() {
  mem.payments.length = 0;
  mem.subs.length = 0;
}
