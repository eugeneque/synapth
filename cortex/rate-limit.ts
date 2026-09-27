/**
 * Cortex · Rate limiting.
 *
 * Sliding-window counters kept in `globalThis` (same reasoning as the other
 * singletons: HMR and route-handler module instances must share state). A
 * single process is all the demo needs; swapping the store for Redis means
 * re-implementing `hit()` alone.
 */

const WINDOW_SWEEP_MS = 60_000;

export interface RateLimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the oldest hit in the window expires. */
  retryAfter: number;
  resetAt: number;
}

/** Per-endpoint budgets. Auth and anything that spends money or reaches the network are the tight ones. */
export const RATE_LIMITS = {
  register: { limit: 5, windowMs: 60 * 60_000 },
  signin: { limit: 10, windowMs: 10 * 60_000 },
  /** Confirmation emails: every hit is a real message sent, so per address and per IP. */
  emailCode: { limit: 5, windowMs: 60 * 60_000 },
  /** Code guesses per IP; the per-code budget lives with the code (EMAIL_CODE_MAX_ATTEMPTS). */
  emailVerify: { limit: 20, windowMs: 15 * 60_000 },
  execute: { limit: 30, windowMs: 60_000 },
  publish: { limit: 20, windowMs: 60 * 60_000 },
  import: { limit: 10, windowMs: 10 * 60_000 },
  crawl: { limit: 3, windowMs: 60 * 60_000 },
  install: { limit: 60, windowMs: 60_000 },
  search: { limit: 120, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
  write: { limit: 60, windowMs: 60_000 },
  moderationRequest: { limit: 10, windowMs: 60 * 60_000 },
  /** Account verification requests: a slow process, a handful per day is plenty. */
  verificationRequest: { limit: 3, windowMs: 24 * 60 * 60_000 },
  /** Images pasted into skillset descriptions: stored rows, so metered like publishing. */
  skillsetImage: { limit: 40, windowMs: 60 * 60_000 },
  /** Post photos: stored rows, up to `POST_MAX_IMAGES` per post. */
  postImage: { limit: 60, windowMs: 60 * 60_000 },
  /** Agent API without a key: public search only (ТЗ FR-AI-13). */
  agentAnon: { limit: 30, windowMs: 60_000 },
  /** Agent API per key (plans add daily quotas on top, cortex/plans.ts). */
  agent: { limit: 300, windowMs: 60_000 },
  /** `resolve_task` ranks up to 50 candidates per call: stricter. */
  resolveTask: { limit: 20, windowMs: 60_000 },
  /** Checkout sessions opened with a payment provider. */
  checkout: { limit: 10, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

interface Store {
  hits: Map<string, number[]>;
  sweptAt: number;
}

const g = globalThis as unknown as { __synapthRateLimit_v1?: Store };
const store: Store = g.__synapthRateLimit_v1 ?? (g.__synapthRateLimit_v1 = { hits: new Map(), sweptAt: Date.now() });

/** Records one hit for `key` and reports whether it fits inside the window. */
export function hit(name: RateLimitName, key: string, rule: RateLimitRule = RATE_LIMITS[name]): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = `${name}:${key}`;
  const window = (store.hits.get(bucket) ?? []).filter((ts) => now - ts < rule.windowMs);

  if (window.length >= rule.limit) {
    store.hits.set(bucket, window);
    const oldest = window[0];
    const resetAt = oldest + rule.windowMs;
    return { ok: false, limit: rule.limit, remaining: 0, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)), resetAt };
  }

  window.push(now);
  store.hits.set(bucket, window);
  return { ok: true, limit: rule.limit, remaining: rule.limit - window.length, retryAfter: 0, resetAt: now + rule.windowMs };
}

/** Drops empty/expired buckets so a long-running process does not grow unbounded. */
function sweep(now: number) {
  if (now - store.sweptAt < WINDOW_SWEEP_MS) return;
  store.sweptAt = now;
  const longest = Math.max(...Object.values(RATE_LIMITS).map((r) => r.windowMs));
  for (const [bucket, timestamps] of store.hits) {
    const live = timestamps.filter((ts) => now - ts < longest);
    if (live.length) store.hits.set(bucket, live);
    else store.hits.delete(bucket);
  }
}

/** Test helper: forget every counter. */
export function resetRateLimits() {
  store.hits.clear();
  store.sweptAt = Date.now();
}

/**
 * Best-effort client identity. Behind a proxy `x-forwarded-for` is the only
 * signal available; trust just the left-most hop and fall back to a constant
 * so a missing header still shares one (generous) bucket instead of none.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export class RateLimitError extends Error {
  status = 429 as const;
  constructor(public readonly result: RateLimitResult) {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

/** Throws `RateLimitError` (rendered as 429 + `Retry-After` by `lib/api`) when the budget is spent. */
export function enforceRateLimit(name: RateLimitName, key: string): RateLimitResult {
  const result = hit(name, key);
  if (!result.ok) throw new RateLimitError(result);
  return result;
}

/** Convenience for route handlers: limit by caller id when known, by IP otherwise. */
export function enforceRequestLimit(name: RateLimitName, request: Request, userId?: string | null): RateLimitResult {
  return enforceRateLimit(name, userId ? `user:${userId}` : `ip:${clientIp(request)}`);
}
