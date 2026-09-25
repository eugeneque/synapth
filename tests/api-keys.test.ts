import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiKeyError, generateApiKey, issueApiKey, listApiKeys, requireScope, resetApiKeysForTests, resolveCaller, revokeApiKey, ScopeError } from "@/cortex/api-keys";
import { listAgentAudit, recordAgentAction, resetAgentAuditForTests } from "@/cortex/agent-audit";
import { compactPolicy, DEFAULT_POLICY, evaluatePolicy, keyStatus, tightenPolicy, type PolicySubject } from "@/types/api-keys";

const withKey = (key: string, agent?: string) => new Request("https://synapth.test/api/v1/agent/search", { headers: { "X-Synapth-Key": key, ...(agent ? { "X-Agent-Name": agent } : {}) } });

test("keys are sk_live_ + 32 base62 chars; only the prefix is kept for display", () => {
  const { key, prefix, hash } = generateApiKey();
  assert.match(key, /^sk_live_[0-9A-Za-z]{32}$/);
  assert.equal(prefix, key.slice(0, 12));
  assert.equal(hash.length, 64);
  assert.notEqual(generateApiKey().key, key);
});

test("issue → resolve with scopes and policy → revoke is instant", async () => {
  resetApiKeysForTests();
  const { key, info } = await issueApiKey("usr_demo", { label: "laptop", scopes: ["catalog:read"], policy: { deniedPermissions: ["network"], minTrust: "Verified" } });
  assert.equal(keyStatus(info), "active");
  assert.ok(info.expiresAt && Date.parse(info.expiresAt) - Date.now() > 89 * 86_400_000, "90 days by default");
  assert.equal((await listApiKeys("usr_demo"))[0].id, info.id);

  const caller = await resolveCaller(withKey(key, "claude-code/2.1"));
  assert.ok(caller);
  assert.equal(caller.keyId, info.id);
  assert.equal(caller.agentName, "claude-code/2.1");
  assert.deepEqual(caller.scopes, ["catalog:read"]);
  assert.equal(caller.policy.minTrust, "Verified");
  assert.deepEqual(caller.policy.deniedPermissions, ["network"]);
  assert.throws(() => requireScope(caller, "skills:execute"), ScopeError);

  assert.equal(await revokeApiKey("usr_other", info.id), false, "only the owner revokes");
  assert.equal(await revokeApiKey("usr_demo", info.id), true);
  await assert.rejects(resolveCaller(withKey(key)), (e: unknown) => e instanceof ApiKeyError && e.code === "key_revoked");
  await assert.rejects(resolveCaller(withKey("sk_live_nope")), (e: unknown) => e instanceof ApiKeyError && e.code === "key_invalid");
});

test("expired keys are refused with a reason", async () => {
  resetApiKeysForTests();
  const { key, info } = await issueApiKey("usr_demo", { label: "short", scopes: ["catalog:read"], ttlDays: 30 });
  // Expire the stored row in place (the in-memory store lives on globalThis).
  const g = globalThis as unknown as { __synapthApiKeys_v1: Array<{ id: string; expiresAt: string }> };
  g.__synapthApiKeys_v1.find((k) => k.id === info.id)!.expiresAt = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(resolveCaller(withKey(key)), (e: unknown) => e instanceof ApiKeyError && e.code === "key_expired");
});

test("a key policy can only tighten the owner's", () => {
  const org = { ...DEFAULT_POLICY, minTrust: "Verified" as const, deniedPermissions: ["shell" as const], maxPerCallMicros: 50_000 };
  const p = tightenPolicy(org, { minTrust: "Sandbox", deniedPermissions: ["network"], maxPerCallMicros: 1_000_000, categories: ["Prompt"] });
  assert.equal(p.minTrust, "Verified", "cannot loosen trust");
  assert.deepEqual(p.deniedPermissions.sort(), ["network", "shell"]);
  assert.equal(p.maxPerCallMicros, 50_000, "cannot raise a cap");
  assert.deepEqual(p.categories, ["Prompt"]);
});

test("policy decisions name the rule; pol is compact", () => {
  const subject: PolicySubject = { id: "skl_1", slug: "acme-x", category: "MCP", securityLevel: "Community", manifest: { permissions: ["network", "filesystem:read"] }, priceMicros: 0 };
  assert.deepEqual(evaluatePolicy(DEFAULT_POLICY, subject), { ok: true });
  assert.equal(evaluatePolicy(DEFAULT_POLICY, { ...subject, securityLevel: "Sandbox" }).ok, false, "Sandbox is not handed out by default");
  const noNet = tightenPolicy(DEFAULT_POLICY, { deniedPermissions: ["network"] });
  const denied = evaluatePolicy(noNet, subject);
  assert.equal(denied.ok, false);
  assert.equal(!denied.ok && denied.rule, "denied_permission");
  assert.equal(evaluatePolicy(tightenPolicy(DEFAULT_POLICY, { deniedPermissions: ["filesystem"] }), subject).ok, false, "filesystem covers read");
  assert.equal(evaluatePolicy(tightenPolicy(DEFAULT_POLICY, { deny: ["acme-x"] }), subject).ok, false);
  assert.equal(evaluatePolicy(tightenPolicy(DEFAULT_POLICY, { allow: ["other"] }), subject).ok, false);
  assert.equal(evaluatePolicy(tightenPolicy(DEFAULT_POLICY, { maxPerCallMicros: 10 }), { ...subject, priceMicros: 20 }).ok, false);
  assert.deepEqual(compactPolicy(tightenPolicy(DEFAULT_POLICY, { deniedPermissions: ["network"], maxDailyMicros: 2_000_000 })), { t: "Community", np: ["network"], pd: 2 });
});

test("the audit log keeps one row per call, newest first, per owner", async () => {
  resetAgentAuditForTests();
  const caller = { userId: "usr_demo", keyId: "key_1", agentName: "cursor/1.0" };
  await recordAgentAction(caller, { action: "search", decision: "allow", result: "ok" });
  await recordAgentAction(caller, { action: "fetch_skill", objectType: "skill", objectId: "skl_1", objectVersion: "1.0.0", objectHash: "abc", decision: "deny", rule: "denied_permission", result: "policy_denied" });
  await recordAgentAction({ userId: "usr_other", keyId: null, agentName: null }, { action: "search", decision: "allow", result: "ok" });
  const rows = await listAgentAudit("usr_demo");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, "fetch_skill");
  assert.equal(rows[0].rule, "denied_permission");
  assert.equal(rows[0].agentName, "cursor/1.0");
});
