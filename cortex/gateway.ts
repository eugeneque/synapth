/**
 * Cortex · Pay-per-call gateway (ТЗ §5.2) — shared by
 * `POST /api/v1/skills/:id/execute` and the MCP / REST `execute` tool.
 *
 *   1. checks before any money moves: listed and not Sandbox, `skills:execute`,
 *      key policy, per-call cap, daily cap, tool exists, arguments match its
 *      JSON Schema — any failure is a refusal without a charge;
 *   2. hold the price (parallel calls cannot overdraw);
 *   3. call the author: public hosts only (`safeFetch`), 30 s, 1 MB;
 *   4. 2xx → settle (charge, earning, platform fee); 5xx, 4xx, timeout,
 *      network error → release, nothing charged;
 *   5. `Idempotency-Key`: a repeat within 24 h returns the stored response.
 *
 * Upstream bodies of failed calls are never echoed: a 500 page from an
 * internal service is exactly what an SSRF probe wants to read.
 */

import { skillRepository } from "@/cortex/repository";
import { billing, InsufficientFundsError } from "@/cortex/billing";
import type { Caller } from "@/cortex/api-keys";
import { AgentError, agentCall } from "@/cortex/agent";
import { recordAgentAction } from "@/cortex/agent-audit";
import { abandonIdempotent, beginIdempotent, finishIdempotent, IDEMPOTENCY_KEY_PATTERN, type StoredResponse } from "@/cortex/idempotency";
import { canonicalJson, sha256 } from "@/cortex/signing";
import { BlockedUrlError, safeFetch } from "@/cortex/ssrf";
import { validateJson } from "@/lib/json-schema";
import { evaluatePolicy } from "@/types/api-keys";
import { microsToUsd, usdToMicros, type ExecutionReceipt } from "@/types/economy";

export const UPSTREAM_TIMEOUT_MS = 30_000;
export const UPSTREAM_MAX_BYTES = 1024 * 1024;

export interface ExecuteInput {
  tool: string | null;
  input?: unknown;
}

/** A gateway refusal or upstream failure surfaced through the agent transports with its own body (receipt included). */
export class GatewayFailure extends Error {
  name = "GatewayFailure";
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.message ?? "execute failed"));
  }
}

export interface GatewayResult extends StoredResponse {
  replayed: boolean;
}

class UpstreamError extends Error {
  name = "UpstreamError";
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
  }
}

/** Upstream hop, injectable in tests. */
export type UpstreamCall = (url: string, method: "GET" | "POST", tool: string | null, input: unknown, signal: AbortSignal) => Promise<{ status: number; bytes: number; result: unknown }>;

const defaultUpstream: UpstreamCall = async (url, method, tool, input, signal) => {
  const res = await safeFetch(url, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": "synapth-gateway/0.2", Accept: "application/json" },
    body: method === "POST" ? JSON.stringify({ tool, input }) : undefined,
    signal,
    maxBytes: UPSTREAM_MAX_BYTES,
  });
  if (!res.ok) throw new UpstreamError(`Upstream responded ${res.status}`, res.status);
  let result: unknown = res.text;
  try {
    result = JSON.parse(res.text);
  } catch {
    /* plain text result */
  }
  return { status: res.status, bytes: Buffer.byteLength(res.text), result };
};

const agentErr = (e: AgentError): StoredResponse => ({ status: e.status, body: { error: e.code, message: e.message, hint: e.hint, ...(e.rule ? { rule: e.rule } : {}) } });

export async function executeSkill(caller: Caller, idOrSlug: string, req: ExecuteInput, opts: { idempotencyKey?: string | null; upstream?: UpstreamCall } = {}): Promise<GatewayResult> {
  const key = opts.idempotencyKey?.trim() || null;
  if (key && !IDEMPOTENCY_KEY_PATTERN.test(key)) return { ...agentErr(new AgentError("invalid_request", "Idempotency-Key must be 8–128 characters [A-Za-z0-9_.:-]")), replayed: false };

  if (key) {
    const requestHash = sha256(canonicalJson({ skill: idOrSlug, tool: req.tool, input: req.input ?? null }));
    const claim = await beginIdempotent(caller.userId, key, requestHash);
    if (claim.state === "replay") return { ...claim.response, replayed: true };
    if (claim.state === "mismatch") return { ...agentErr(new AgentError("invalid_request", "This Idempotency-Key was used with a different request")), status: 422, replayed: false };
    if (claim.state === "in_progress") return { ...agentErr(new AgentError("invalid_request", "A request with this Idempotency-Key is still running")), status: 409, replayed: false };
  }

  const { response, executionId, final } = await run(caller, idOrSlug, req, opts.upstream ?? defaultUpstream);
  if (key) {
    // Refusals before the hold free the key for a corrected retry; anything that reached the author is final.
    if (final) await finishIdempotent(caller.userId, key, response, executionId);
    else await abandonIdempotent(caller.userId, key);
  }
  return { ...response, replayed: false };
}

async function run(caller: Caller, idOrSlug: string, req: ExecuteInput, upstream: UpstreamCall): Promise<{ response: StoredResponse; executionId: string | null; final: boolean }> {
  const call = agentCall(caller);
  const deny = async (e: AgentError, skillId?: string) => {
    await recordAgentAction(caller, { action: "execute", objectType: "skill", objectId: skillId ?? idOrSlug, decision: "deny", rule: e.rule ?? e.code, result: e.code });
    return { response: { ...agentErr(e), body: { ...(agentErr(e).body as object), pol: call.pol } }, executionId: null, final: false };
  };

  const skill = (await skillRepository.byId(idOrSlug)) ?? (await skillRepository.bySlug(idOrSlug));
  if (!skill || skill.securityLevel === "Quarantine") return deny(new AgentError("not_found", "Skill not found"));
  if (skill.securityLevel === "Sandbox") return deny(new AgentError("policy_denied", "Sandbox-level skills are never executed through the gateway", "sandbox"), skill.id);
  if (!caller.scopes.includes("skills:execute")) return deny(new AgentError("scope_missing", "This key lacks the skills:execute scope", "skills:execute"), skill.id);

  const priceMicros = usdToMicros(skill.pricePerCall);
  const decision = evaluatePolicy(call.policy, { id: skill.id, slug: skill.slug, category: skill.category, securityLevel: skill.securityLevel, manifest: skill.manifest, priceMicros });
  if (!decision.ok) return deny(decision.rule === "price_per_call" ? new AgentError("budget_exceeded", "The price per call is above the key's cap", "price_per_call") : new AgentError("policy_denied", `Denied by policy rule ${decision.rule}`, decision.rule), skill.id);
  if (call.policy.maxDailyMicros !== null && priceMicros > 0) {
    const spent = await billing.spentToday(caller.userId, caller.keyId);
    if (spent + priceMicros > call.policy.maxDailyMicros) return deny(new AgentError("budget_exceeded", `Daily cap of $${microsToUsd(call.policy.maxDailyMicros)} would be exceeded`, "daily_cap"), skill.id);
  }

  const ep = skill.manifest.entrypoint;
  if (ep.type === "mcp-stdio" || ep.type === "mcp-sse") return deny(new AgentError("invalid_request", "MCP skills run on the agent side; use install_plan instead of execute"), skill.id);
  const tool = req.tool ? skill.manifest.tools.find((t) => t.name === req.tool) : (skill.manifest.tools[0] ?? null);
  if (req.tool && !tool) return deny(new AgentError("invalid_request", `Unknown tool "${req.tool}"; tools: ${skill.manifest.tools.map((t) => t.name).join(", ")}`), skill.id);
  const schemaErrors = tool ? validateJson(tool.parameters, req.input ?? {}) : [];
  if (schemaErrors.length) return deny(new AgentError("invalid_request", `Arguments do not match the tool schema: ${schemaErrors.join("; ")}`), skill.id);

  let event;
  try {
    event = await billing.openExecution({ skill, callerId: caller.userId, apiKeyId: caller.keyId, toolName: req.tool, input: req.input });
  } catch (err) {
    if (err instanceof InsufficientFundsError) return deny(new AgentError("budget_exceeded", err.message, "balance"), skill.id);
    throw err;
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let receipt: ExecutionReceipt;
  try {
    let result: unknown;
    let httpStatus: number | null = null;
    let bytes: number | null = null;
    if (ep.type === "http") {
      const res = await upstream(ep.url, ep.method ?? "POST", req.tool, req.input, controller.signal);
      result = res.result;
      httpStatus = res.status;
      bytes = res.bytes;
    } else {
      // Prompt skills have nothing to run server-side: the "execution" hands back the prompt.
      result = { systemPrompt: skill.manifest.systemPrompt };
    }
    receipt = await billing.closeExecution(event.id, { status: "succeeded", latencyMs: Date.now() - started, httpStatus, responseBytes: bytes });
    await recordAgentAction(caller, { action: "execute", objectType: "skill", objectId: skill.id, objectVersion: skill.version, decision: "allow", result: "ok" });
    return { response: { status: 200, body: { receipt, result, pol: call.pol } }, executionId: event.id, final: true };
  } catch (err) {
    const httpStatus = err instanceof UpstreamError ? err.httpStatus : null;
    receipt = await billing.closeExecution(event.id, { status: "failed", latencyMs: Date.now() - started, httpStatus });
    // Only our own, non-reflective messages reach the caller; the rest stays in the logs.
    const timedOut = controller.signal.aborted;
    const message = timedOut ? "Upstream timed out" : err instanceof BlockedUrlError || err instanceof UpstreamError ? err.message : "Skill execution failed";
    if (!(err instanceof BlockedUrlError || err instanceof UpstreamError) && !timedOut) console.error("execute failed", { skill: skill.id, err });
    await recordAgentAction(caller, { action: "execute", objectType: "skill", objectId: skill.id, objectVersion: skill.version, decision: "allow", result: timedOut ? "timeout" : `upstream_${httpStatus ?? "error"}` });
    return { response: { status: 502, body: { receipt, error: "upstream_failed", message, hint: "Nothing was charged: the hold was released. Retry later or pick another tool.", pol: call.pol } }, executionId: event.id, final: true };
  } finally {
    clearTimeout(timer);
  }
}
