/**
 * Synapth Pro: plans, subscriptions and payments (ТЗ §4.1, §4.6).
 *
 * Plan prices are catalogue prices in the provider's currency (RUB for the
 * Russian providers), stored as integer minor units (kopecks). They are not
 * ledger money: the pay-per-call wallet stays in micro-dollars
 * (types/economy.ts) until the move to roubles is confirmed.
 *
 * All prices are starting hypotheses (ТЗ «[По умолчанию]»).
 */

export const PLAN_IDS = ["free", "pro", "team", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const BILLING_PERIODS = ["month", "year"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export interface PlanLimits {
  /** Active API keys. */
  keys: number;
  /** Agent API requests per UTC day. */
  requestsPerDay: number;
  /** `resolve_task` calls per UTC day (they run the ranker / LLM). */
  resolvePerDay: number;
  /** Private packs; null = unlimited. */
  privatePacks: number | null;
  /** Repositories the CI scanner may watch. */
  ciRepos: number;
  /** Agent audit log retention. */
  auditDays: number;
}

export interface PlanSpec {
  id: PlanId;
  /** Minor units (kopecks) per month / per year; null = contact sales. Per seat when `perSeat`. */
  price: Record<BillingPeriod, number | null>;
  currency: "RUB";
  perSeat: boolean;
  minSeats: number;
  /** Self-serve checkout; Business goes through sales (dedicated instance, SLA). */
  selfServe: boolean;
  limits: PlanLimits;
}

const UNLIMITED = 1_000_000_000;

export const PLANS: Record<PlanId, PlanSpec> = {
  free: {
    id: "free",
    price: { month: 0, year: 0 },
    currency: "RUB",
    perSeat: false,
    minSeats: 1,
    selfServe: true,
    limits: { keys: 1, requestsPerDay: 1_000, resolvePerDay: 20, privatePacks: 3, ciRepos: 0, auditDays: 7 },
  },
  pro: {
    id: "pro",
    price: { month: 790_00, year: 7_900_00 },
    currency: "RUB",
    perSeat: false,
    minSeats: 1,
    selfServe: true,
    limits: { keys: 5, requestsPerDay: 20_000, resolvePerDay: 500, privatePacks: null, ciRepos: 3, auditDays: 30 },
  },
  team: {
    id: "team",
    price: { month: 1_490_00, year: 14_900_00 },
    currency: "RUB",
    perSeat: true,
    minSeats: 3,
    selfServe: true,
    limits: { keys: 20, requestsPerDay: 100_000, resolvePerDay: 2_000, privatePacks: null, ciRepos: 20, auditDays: 180 },
  },
  business: {
    id: "business",
    price: { month: 60_000_00, year: null },
    currency: "RUB",
    perSeat: false,
    minSeats: 1,
    selfServe: false,
    limits: { keys: 100, requestsPerDay: UNLIMITED, resolvePerDay: UNLIMITED, privatePacks: null, ciRepos: UNLIMITED, auditDays: 365 },
  },
};

export const isUnlimited = (n: number | null) => n === null || n >= UNLIMITED;

/** One-off services for authors and vendors (ТЗ §4.1): paid for the review, not for a positive result. */
export const REVIEW_SERVICES = [
  { id: "verified", price: 15_000_00 },
  { id: "rereview", price: 5_000_00 },
  { id: "pack", price: 30_000_00 },
  { id: "gov", price: 60_000_00 },
] as const;

/** Amount due for a plan, period and seat count, in minor units. */
export function planPrice(plan: PlanSpec, period: BillingPeriod, seats = 1): number | null {
  const unit = plan.price[period];
  if (unit === null) return null;
  return unit * (plan.perSeat ? Math.max(seats, plan.minSeats) : 1);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_STATUSES = ["active", "past_due", "grace", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** ТЗ §4.6: retries on day 1, 3 and 7, then 14 days of grace, then Free. */
export const DUNNING = { retryDays: [1, 3, 7], graceDays: 14, dataKeptDays: 90 } as const;

export interface Subscription {
  id: string;
  userId: string;
  plan: PlanId;
  period: BillingPeriod;
  seats: number;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  /** Downgrades take effect from the next period. */
  pendingPlan: PlanId | null;
  provider: PaymentProviderId;
  /** Saved payment method at the provider, for renewals. Never card data. */
  paymentMethodId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_PROVIDERS = ["yookassa", "cloudpayments", "mock"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_METHODS = ["card", "sbp", "invoice"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "canceled", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentKind = "subscription" | "topup";

export interface Payment {
  id: string;
  userId: string;
  kind: PaymentKind;
  plan: PlanId | null;
  period: BillingPeriod | null;
  seats: number | null;
  /** Minor units of `currency`. */
  amount: number;
  currency: "RUB" | "USD";
  provider: PaymentProviderId;
  method: PaymentMethod;
  status: PaymentStatus;
  /** The provider's payment id; unique per provider. */
  providerPaymentId: string | null;
  /** Where the browser goes to pay (hosted checkout / SBP QR page). */
  confirmationUrl: string | null;
  description: string;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

/** Top-ups: ТЗ §5.4 — from 100 ₽; the wallet is USD for now, so the floor is $1. */
export const TOPUP_MIN_USD = 1;
export const TOPUP_MAX_USD = 5_000;
export const TOPUP_PRESETS_USD = [5, 20, 50, 100] as const;
