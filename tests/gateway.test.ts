import { test } from "node:test";
import assert from "node:assert/strict";
import { executeSkill, type UpstreamCall } from "@/cortex/gateway";
import { billing } from "@/cortex/billing";
import { resetIdempotencyForTests } from "@/cortex/idempotency";
import { seedSkills } from "@/cortex/seed";
import type { Caller } from "@/cortex/api-keys";
import { API_KEY_SCOPES, DEFAULT_POLICY, tightenPolicy, type KeyPolicy } from "@/types/api-keys";
import { validateJson } from "@/lib/json-schema";

const weather = seedSkills.find((s) => s.slug === "acme-weather-now")!;
const tool = weather.manifest.tools[0];
const validInput = Object.fromEntries((tool.parameters.required ?? []).map((k) => [k, "Berlin"]));

const caller = (userId: string, policy: Partial<KeyPolicy> = {}, scopes: Caller["scopes"] = API_KEY_SCOPES): Caller => ({ userId, via: "api-key", keyId: `key_${userId}`, keyCreatedAt: null, scopes, policy: tightenPolicy(DEFAULT_POLICY, policy), agentName: null });

let calls = 0;
const ok: UpstreamCall = async () => {
  calls += 1;
  return { status: 200, bytes: 12, result: { temp: 21 } };
};
const boom = (status: number): UpstreamCall => async () => {
  calls += 1;
  const err = new Error(`Upstream responded ${status}`) as Error & { httpStatus: number };
  err.name = "UpstreamError";
  throw err;
};

test("JSON Schema subset: types, required, enums, additionalProperties", () => {
  const schema = { type: "object" as const, required: ["city"], properties: { city: { type: "string" as const, minLength: 2 }, units: { type: "string" as const, enum: ["c", "f"] } }, additionalProperties: false };
  assert.deepEqual(validateJson(schema, { city: "Oslo", units: "c" }), []);
  assert.ok(validateJson(schema, {}).some((e) => e.includes("required")));
  assert.ok(validateJson(schema, { city: "O" }).length === 1);
  assert.ok(validateJson(schema, { city: "Oslo", units: "k" }).length === 1);
  assert.ok(validateJson(schema, { city: "Oslo", extra: 1 }).length === 1);
  assert.ok(validateJson(schema, []).length === 1);
});

test("2xx settles, anything else releases; nothing is charged for a failure", async () => {
  await billing.topUp("usr_gw", 1);
  const start = (await billing.getWallet("usr_gw")).balanceMicros;
  const paid = await executeSkill(caller("usr_gw"), weather.slug, { tool: tool.name, input: validInput }, { upstream: ok });
  assert.equal(paid.status, 200);
  const afterPaid = (await billing.getWallet("usr_gw")).balanceMicros;
  assert.equal(start - afterPaid, Math.round(weather.pricePerCall * 1e6));

  const failed = await executeSkill(caller("usr_gw"), weather.slug, { tool: tool.name, input: validInput }, { upstream: boom(500) });
  assert.equal(failed.status, 502);
  assert.equal((failed.body as { error: string }).error, "upstream_failed");
  assert.equal((await billing.getWallet("usr_gw")).balanceMicros, afterPaid, "hold released");
});

test("checks before the hold: scope, schema, caps, balance — refusals cost nothing", async () => {
  await billing.topUp("usr_gw2", 1);
  const start = (await billing.getWallet("usr_gw2")).balanceMicros;
  calls = 0;
  const noScope = await executeSkill(caller("usr_gw2", {}, ["catalog:read"]), weather.slug, { tool: tool.name, input: validInput }, { upstream: ok });
  assert.equal((noScope.body as { error: string }).error, "scope_missing");
  const badArgs = await executeSkill(caller("usr_gw2"), weather.slug, { tool: tool.name, input: { nope: true } }, { upstream: ok });
  assert.equal((badArgs.body as { error: string }).error, "invalid_request");
  const perCall = await executeSkill(caller("usr_gw2", { maxPerCallMicros: 1 }), weather.slug, { tool: tool.name, input: validInput }, { upstream: ok });
  assert.equal((perCall.body as { error: string }).error, "budget_exceeded");
  const broke = await executeSkill(caller("usr_gw_broke"), weather.slug, { tool: tool.name, input: validInput }, { upstream: ok });
  assert.equal(broke.status, 402);
  assert.equal(calls, 0, "the author was never called");
  assert.equal((await billing.getWallet("usr_gw2")).balanceMicros, start);

  const price = Math.round(weather.pricePerCall * 1e6);
  const capped = caller("usr_gw2", { maxDailyMicros: price });
  assert.equal((await executeSkill(capped, weather.slug, { tool: tool.name, input: validInput }, { upstream: ok })).status, 200);
  const over = await executeSkill(capped, weather.slug, { tool: tool.name, input: validInput }, { upstream: ok });
  assert.equal((over.body as { rule: string }).rule, "daily_cap");
});

test("Idempotency-Key: a repeat returns the stored result without a second charge", async () => {
  resetIdempotencyForTests();
  await billing.topUp("usr_idem", 1);
  calls = 0;
  const first = await executeSkill(caller("usr_idem"), weather.slug, { tool: tool.name, input: validInput }, { idempotencyKey: "order-42-attempt", upstream: ok });
  const balance = (await billing.getWallet("usr_idem")).balanceMicros;
  const again = await executeSkill(caller("usr_idem"), weather.slug, { tool: tool.name, input: validInput }, { idempotencyKey: "order-42-attempt", upstream: ok });
  assert.equal(again.replayed, true);
  assert.deepEqual(again.body, first.body);
  assert.equal(calls, 1);
  assert.equal((await billing.getWallet("usr_idem")).balanceMicros, balance);
  const other = await executeSkill(caller("usr_idem"), weather.slug, { tool: tool.name, input: { ...validInput, extra: 1 } }, { idempotencyKey: "order-42-attempt", upstream: ok });
  assert.equal(other.status, 422, "same key, different request");
  // A refusal before the hold frees the key.
  const refused = await executeSkill(caller("usr_idem"), weather.slug, { tool: tool.name, input: { nope: 1 } }, { idempotencyKey: "retry-me-1234", upstream: ok });
  assert.equal(refused.status, 400);
  assert.equal((await executeSkill(caller("usr_idem"), weather.slug, { tool: tool.name, input: validInput }, { idempotencyKey: "retry-me-1234", upstream: ok })).status, 200);
});
