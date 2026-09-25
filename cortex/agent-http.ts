/**
 * Cortex · Shared plumbing for the agent transports (REST and MCP):
 * caller resolution, rate limits and quotas, error mapping.
 */

import { ZodError } from "zod";
import { ApiKeyError, resolveCaller, type Caller } from "@/cortex/api-keys";
import { AgentError, agentCall, type AgentToolName } from "@/cortex/agent";
import { enforceRateLimit, clientIp, RateLimitError } from "@/cortex/rate-limit";
import { enforceAgentQuota, QuotaExceededError } from "@/cortex/plans";
import type { AgentErrorBody } from "@/types/agent";
import { GatewayFailure } from "@/cortex/gateway";

/** Resolves the caller; a bad key is an AgentError, not a 500. */
export async function agentCaller(request: Request): Promise<Caller | null> {
  try {
    const caller = await resolveCaller(request);
    // A browser session only counts same-origin: a cross-site form must not act with the visitor's cookie.
    if (caller?.via === "session" && !sameOrigin(request)) return null;
    return caller;
  } catch (err) {
    if (err instanceof ApiKeyError) throw new AgentError("unauthorized", err.message, err.code);
    throw err;
  }
}

function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

/** Per-minute limits (anonymous per IP, keyed per key) plus the plan's daily quotas. */
export async function limitAgent(request: Request, caller: Caller | null, tool: AgentToolName): Promise<void> {
  if (!caller) {
    enforceRateLimit("agentAnon", `ip:${clientIp(request)}`);
    return;
  }
  const who = caller.keyId ? `key:${caller.keyId}` : `user:${caller.userId}`;
  enforceRateLimit("agent", who);
  if (tool === "resolve_task") enforceRateLimit("resolveTask", who);
  await enforceAgentQuota(caller.userId, tool === "resolve_task" ? "resolve" : "request");
}

export function agentErrorBody(err: unknown, caller: Caller | null): { status: number; body: AgentErrorBody; retryAfter?: number } {
  const pol = agentCall(caller).pol;
  if (err instanceof GatewayFailure) return { status: err.status, body: { pol, ...err.body } as unknown as AgentErrorBody };
  if (err instanceof AgentError) return { status: err.status, body: { error: err.code, message: err.message, hint: err.hint, ...(err.rule ? { rule: err.rule } : {}), pol } };
  if (err instanceof RateLimitError) {
    const e = new AgentError("rate_limited", err.message);
    return { status: 429, body: { error: e.code, message: e.message, hint: e.hint, pol }, retryAfter: err.result.retryAfter };
  }
  if (err instanceof QuotaExceededError) {
    const e = new AgentError("rate_limited", err.message, err.quota);
    return { status: 429, body: { error: e.code, message: e.message, hint: "The daily quota of your plan is used up. It resets at 00:00 UTC; upgrade on /pro for more.", rule: err.quota, pol }, retryAfter: err.retryAfter };
  }
  if (err instanceof ZodError) {
    const e = new AgentError("invalid_request", err.issues.map((i) => i.message).join("; "));
    return { status: 400, body: { error: e.code, message: e.message, hint: e.hint, pol } };
  }
  console.error("[agent] unexpected error", err);
  return { status: 500, body: { error: "invalid_request", message: "Internal error", hint: "Retry later; if it persists, report it.", pol } };
}
