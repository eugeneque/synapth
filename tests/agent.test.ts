import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCall, AgentError, reportWeight, runAgentTool, resetAgentReportsForTests } from "@/cortex/agent";
import { issueApiKey, resetApiKeysForTests, type Caller } from "@/cortex/api-keys";
import { listAgentAudit, resetAgentAuditForTests } from "@/cortex/agent-audit";
import { verifyContentHash, contentHash, sha256 } from "@/cortex/signing";
import { resetRateLimits } from "@/cortex/rate-limit";
import { resetUsageForTests } from "@/cortex/plans";
import { skillRepository } from "@/cortex/repository";
import { API_KEY_SCOPES, DEFAULT_POLICY, tightenPolicy, type KeyPolicy } from "@/types/api-keys";
import { POST as mcpPost } from "@/app/mcp/route";
import { POST as restPost, GET as restGet } from "@/app/api/v1/agent/[tool]/route";

const caller = (policy: Partial<KeyPolicy> = {}, scopes: Caller["scopes"] = API_KEY_SCOPES): Caller => ({
  userId: "usr_agent_tester",
  via: "api-key",
  keyId: "key_test",
  keyCreatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  scopes,
  policy: tightenPolicy(DEFAULT_POLICY, policy),
  agentName: "test-agent/1.0",
});

type AnyObj = Record<string, any>;

test("a key without network never receives network skills — in any tool", async () => {
  resetRateLimits();
  const noNet = caller({ deniedPermissions: ["network"] });
  const search = (await runAgentTool(noNet, "search", { q: "", limit: 50 })) as AnyObj;
  assert.ok(search.items.length > 0);
  assert.ok(search.items.every((i: AnyObj) => !i.perm.includes("network")));
  assert.deepEqual(search.pol.np, ["network"]);

  const resolved = (await runAgentTool(noNet, "resolve_task", { task: "query a postgres database and browse web pages" })) as AnyObj;
  for (const v of resolved.variants) assert.ok(!v.permissions.includes("network"), v.id);

  const networked = (await skillRepository.all()).find((s) => s.manifest.permissions?.includes("network") && s.securityLevel !== "Sandbox");
  assert.ok(networked);
  await assert.rejects(runAgentTool(noNet, "get_skill", { id: networked.slug }), (e: unknown) => e instanceof AgentError && e.code === "policy_denied" && e.rule === "denied_permission");
  await assert.rejects(runAgentTool(noNet, "install_plan", { ids: [networked.id] }), (e: unknown) => e instanceof AgentError && e.code === "policy_denied");
});

test("resolve_task returns ≤ 3 scored variants with approval cards where needed", async () => {
  const res = (await runAgentTool(caller(), "resolve_task", { task: "Review pull requests and run SQL against Postgres", client: "claude-code" })) as AnyObj;
  assert.ok(res.variants.length >= 1 && res.variants.length <= 3);
  for (const v of res.variants) {
    assert.ok(v.reason.length <= 200);
    assert.ok(["pack", "set", "skill"].includes(v.type));
    assert.equal(typeof v.tokens, "number");
    if (v.requiresApproval) assert.ok(v.approvalCard?.title);
  }
  assert.ok(res.intents.includes("postgre") && res.intents.includes("sql"));
  assert.equal(res.ranker, "bm25f");
});

test("fetch_skill: per-file hashes, contentHash and a verifiable signature", async () => {
  const prompt = (await skillRepository.all()).find((s) => s.manifest.entrypoint.type === "prompt" && s.securityLevel !== "Sandbox");
  assert.ok(prompt);
  const res = (await runAgentTool(caller(), "fetch_skill", { id: prompt.slug })) as AnyObj;
  for (const f of res.files) assert.equal(sha256(f.content), f.sha256);
  assert.equal(contentHash(res.files), res.contentHash);
  assert.ok(verifyContentHash(res.contentHash, res.signature));
  assert.equal(verifyContentHash("0".repeat(64), res.signature), false);
  // MCP servers are not fetched, they get an install plan.
  const mcp = (await skillRepository.all()).find((s) => s.manifest.entrypoint.type === "mcp-stdio" && s.securityLevel !== "Sandbox")!;
  await assert.rejects(runAgentTool(caller(), "fetch_skill", { id: mcp.slug }), (e: unknown) => e instanceof AgentError && e.code === "invalid_request");
});

test("install_plan → confirm_install; a tampered hash is integrity_mismatch; check_updates reports drift", async () => {
  const mcp = (await skillRepository.all()).find((s) => s.manifest.entrypoint.type === "mcp-stdio" && s.securityLevel !== "Sandbox")!;
  const plan = (await runAgentTool(caller(), "install_plan", { ids: [mcp.id], client: "cursor" })) as AnyObj;
  assert.equal(plan.requiresApproval, true, "MCP servers always need a human yes");
  assert.equal(plan.steps[0].kind, "config");
  const [entry] = plan.lock;
  const before = (await skillRepository.byId(mcp.id))!.downloadsCount;
  const ok = (await runAgentTool(caller(), "confirm_install", { lock: [entry], client: "cursor" })) as AnyObj;
  assert.equal(ok.installed, 1);
  assert.equal((await skillRepository.byId(mcp.id))!.downloadsCount, before + 1);

  await assert.rejects(runAgentTool(caller(), "confirm_install", { lock: [{ ...entry, contentHash: "f".repeat(64) }] }), (e: unknown) => e instanceof AgentError && e.code === "integrity_mismatch");

  const updates = (await runAgentTool(caller(), "check_updates", { lock: [entry, { ...entry, contentHash: "a".repeat(64), version: "0.0.1", permissions: [] }, { ...entry, id: "skl_gone", slug: "gone" }] })) as AnyObj;
  assert.equal(updates.updates[0].status, "current");
  assert.equal(updates.updates[1].status, "update");
  assert.ok(updates.updates[1].permissions.added.length >= 0);
  assert.equal(updates.updates[2].status, "revoked");
});

test("scopes are enforced and anonymous callers only search", async () => {
  await assert.rejects(runAgentTool(caller({}, ["catalog:read"]), "fetch_skill", { id: "x" }), (e: unknown) => e instanceof AgentError && e.code === "scope_missing");
  await assert.rejects(runAgentTool(null, "resolve_task", { task: "anything goes" }), (e: unknown) => e instanceof AgentError && e.code === "unauthorized");
  const anon = (await runAgentTool(null, "search", { q: "" })) as AnyObj;
  assert.ok(anon.items.every((i: AnyObj) => i.sec !== "Sandbox"), "no Sandbox without a key");
});

test("report_outcome: one per day; young keys and authors do not count", async () => {
  resetAgentReportsForTests();
  const skill = (await skillRepository.all()).find((s) => s.securityLevel === "Verified")!;
  const res = (await runAgentTool(caller(), "report_outcome", { id: skill.slug, result: "success", tokens: 1200 })) as AnyObj;
  assert.deepEqual({ accepted: res.accepted, counted: res.counted }, { accepted: true, counted: true });
  await assert.rejects(runAgentTool(caller(), "report_outcome", { id: skill.slug, result: "fail" }), (e: unknown) => e instanceof AgentError && e.code === "invalid_request");
  assert.equal(reportWeight({ ...caller(), keyCreatedAt: new Date().toISOString() }, skill), 0, "keys younger than 7 days");
  assert.equal(reportWeight({ ...caller(), userId: skill.authorId }, skill), 0, "the author's own keys");
});

test("every call lands in the audit log with its decision", async () => {
  resetAgentAuditForTests();
  const c = caller({ deniedPermissions: ["network"] });
  await runAgentTool(c, "search", { q: "postgres" });
  const networked = (await skillRepository.all()).find((s) => s.manifest.permissions?.includes("network") && s.securityLevel !== "Sandbox")!;
  await runAgentTool(c, "get_skill", { id: networked.id }).catch(() => null);
  const rows = await listAgentAudit(c.userId);
  assert.ok(rows.some((r) => r.action === "search" && r.decision === "allow"));
  assert.ok(rows.some((r) => r.action === "get_skill" && r.decision === "deny" && r.result === "policy_denied" && r.agentName === "test-agent/1.0"));
});

test("MCP: initialize, tools/list, tools/call with key; errors are isError results with hints", async () => {
  resetApiKeysForTests();
  resetRateLimits();
  resetUsageForTests();
  const { key } = await issueApiKey("usr_demo", { label: "mcp", scopes: ["catalog:read", "skills:fetch"] });
  const rpc = async (body: unknown, withKey = true) => {
    const res = await mcpPost(new Request("https://synapth.test/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...(withKey ? { "X-Synapth-Key": key } : {}) }, body: JSON.stringify(body) }));
    return { status: res.status, body: res.status === 202 ? null : ((await res.json()) as AnyObj) };
  };
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, false);
  assert.equal(init.body!.result.serverInfo.name, "synapth-mcp");
  assert.equal(init.body!.result.protocolVersion, "2025-06-18");
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, false);
  assert.ok(list.body!.result.tools.some((t: AnyObj) => t.name === "resolve_task"));

  const call = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "resolve_task", arguments: { task: "summarise meeting transcripts" } } });
  assert.equal(call.body!.result.isError, false);
  assert.ok(Array.isArray(call.body!.result.structuredContent.variants));

  const denied = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "resolve_task", arguments: { task: "x y z" } } }, false);
  assert.equal(denied.body!.result.isError, true);
  assert.equal(denied.body!.result.structuredContent.error, "unauthorized");
  assert.ok(denied.body!.result.structuredContent.hint);

  const unknown = await rpc({ jsonrpc: "2.0", id: 5, method: "resources/list" });
  assert.equal(unknown.body!.error.code, -32601);
});

test("REST mirrors MCP: GET search, POST tools, coded errors", async () => {
  resetRateLimits();
  const ctx = (tool: string) => ({ params: Promise.resolve({ tool }) });
  const search = await restGet(new Request("https://synapth.test/api/v1/agent/search?q=postgres"), ctx("search"));
  assert.equal(search.status, 200);
  assert.ok(((await search.json()) as AnyObj).pol);
  const noKey = await restPost(new Request("https://synapth.test/api/v1/agent/resolve_task", { method: "POST", body: JSON.stringify({ task: "hello world" }) }), ctx("resolve_task"));
  assert.equal(noKey.status, 401);
  assert.equal(((await noKey.json()) as AnyObj).error, "unauthorized");
  const badKey = await restPost(new Request("https://synapth.test/api/v1/agent/search", { method: "POST", headers: { "X-Synapth-Key": "sk_live_nope" }, body: "{}" }), ctx("search"));
  assert.equal(badKey.status, 401);
  const unknown = await restPost(new Request("https://synapth.test/api/v1/agent/nope", { method: "POST", body: "{}" }), ctx("nope"));
  assert.equal(unknown.status, 404);
  assert.ok(agentCall(null).pol.t === "Community");
});
