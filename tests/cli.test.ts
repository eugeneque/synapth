import { test } from "node:test";
import assert from "node:assert/strict";
import { CliError, cliRecommend, cliStatus, getLinkKey, installForDevice, issueLinkKey, linkDevice, listDevices, requireDevice, resetCliForTests, revokeDevice, revokeLinkKey, type MachineInfo } from "@/cortex/cli";
import { resetPaymentsForTests, settleMockPayment, startCheckout } from "@/cortex/payments";
import { cliBundle, isSafeRelativePath, safeSegment } from "@/lib/cli-bundle";
import { skillRepository } from "@/cortex/repository";
import { compareVersions } from "@/types/cli";
import { PLANS } from "@/types/billing";

const machine = (id: string, extra: Partial<MachineInfo> = {}): MachineInfo => ({ machineId: `machine-${id}-0000`, name: `host-${id}`, platform: "darwin", arch: "arm64", cliVersion: "0.1.0", ...extra });
const withToken = (token: string, version?: string) => new Request("https://synapth.test/api/v1/cli/status", { headers: { Authorization: `Bearer ${token}`, ...(version ? { "X-Synapth-Cli": version } : {}) } });
const code = (c: string) => (e: unknown) => e instanceof CliError && e.code === c;

async function goPro(userId: string) {
  const out = await startCheckout(userId, { kind: "subscription", plan: "pro", period: "month", method: "card" }, { returnBase: "https://synapth.test" });
  if (out.kind === "redirect") await settleMockPayment(userId, out.paymentId, "succeeded");
}

test("link key: slk_ + 32 chars, shown once, rotation retires the old one", async () => {
  resetCliForTests();
  const first = await issueLinkKey("usr_cli1");
  assert.match(first.key, /^slk_[0-9A-Za-z]{32}$/);
  assert.equal(first.info.prefix, first.key.slice(0, 8));
  assert.equal((await getLinkKey("usr_cli1"))?.prefix, first.info.prefix);

  const second = await issueLinkKey("usr_cli1");
  await assert.rejects(linkDevice(first.key, machine("a")), code("link_key_invalid"));
  const linked = await linkDevice(second.key, machine("a"));
  assert.match(linked.token, /^sdt_[0-9A-Za-z]{40}$/);
  assert.equal(linked.userId, "usr_cli1");
  assert.ok((await getLinkKey("usr_cli1"))?.lastUsedAt, "link marks the key as used");

  await revokeLinkKey("usr_cli1");
  assert.equal(await getLinkKey("usr_cli1"), null);
  await assert.rejects(linkDevice(second.key, machine("b")), code("link_key_invalid"));
  assert.ok(await requireDevice(withToken(linked.token)), "revoking the key keeps linked machines");
});

test("device token resolves, re-linking a machine replaces it, unlink is instant", async () => {
  resetCliForTests();
  const { key } = await issueLinkKey("usr_cli2");
  const a = await linkDevice(key, machine("a", { name: "laptop\u0007‮" }));
  assert.equal(a.device.name, "laptop", "non-printable characters are dropped");
  const caller = await requireDevice(withToken(a.token));
  assert.equal(caller.device.userId, "usr_cli2");

  const again = await linkDevice(key, machine("a"));
  await assert.rejects(requireDevice(withToken(a.token)), code("device_revoked"));
  assert.equal((await listDevices("usr_cli2")).length, 1, "same machine → one device");

  assert.equal(await revokeDevice("usr_other", again.device.id), false, "only the owner unlinks");
  assert.equal(await revokeDevice("usr_cli2", again.device.id), true);
  await assert.rejects(requireDevice(withToken(again.token)), code("device_revoked"));
  await assert.rejects(requireDevice(withToken("sdt_nope")), code("device_invalid"));
  await assert.rejects(requireDevice(new Request("https://synapth.test")), code("device_invalid"));
});

test("outdated CLIs are refused", async () => {
  resetCliForTests();
  const { key } = await issueLinkKey("usr_cli3");
  await assert.rejects(linkDevice(key, machine("a", { cliVersion: "0.0.9" })), code("cli_outdated"));
  const { token } = await linkDevice(key, machine("a"));
  await assert.rejects(requireDevice(withToken(token, "0.0.1")), code("cli_outdated"));
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("Free: one machine, daily quota, no skillsets; Pro lifts all three", async () => {
  resetCliForTests();
  resetPaymentsForTests();
  const user = "usr_cli4";
  const { key } = await issueLinkKey(user);
  const { token } = await linkDevice(key, machine("a"));
  await assert.rejects(linkDevice(key, machine("b")), code("device_limit"));

  const caller = await requireDevice(withToken(token));
  const status = await cliStatus(caller);
  assert.equal(status.plan.id, "free");
  assert.equal(status.limits.installsPerDay, PLANS.free.limits.cliInstallsPerDay);
  assert.equal(status.limits.bulk, false);

  await assert.rejects(installForDevice(caller, { slug: "team-ops", set: true, target: "claude-code" }), code("plan_required"));

  const limit = PLANS.free.limits.cliInstallsPerDay;
  for (let i = 0; i < limit; i++) await installForDevice(caller, { slug: "acme-strict-code-reviewer", target: "claude-code" });
  await assert.rejects(installForDevice(caller, { slug: "acme-strict-code-reviewer", target: "claude-code" }), (e: unknown) => code("quota_exceeded")(e) && typeof (e as CliError).extra.retryAfter === "number");
  assert.ok((await cliStatus(caller)).notices.includes("quota_exhausted"));

  await goPro(user);
  const pro = await cliStatus(caller);
  assert.equal(pro.plan.id, "pro");
  assert.equal(pro.limits.bulk, true);
  const res = await installForDevice(caller, { slug: "team-ops", set: true, target: "claude-code" });
  assert.ok(res.installed.length > 0, "skillset installs on Pro");
  assert.equal(res.usage.installsToday, limit + res.installed.length, "each entry counts once");
  await linkDevice(key, machine("b"));
});

test("an ended subscription falls back to Free: extra machines are paused, the notice says why", async () => {
  resetCliForTests();
  resetPaymentsForTests();
  const user = "usr_cli5";
  await goPro(user);
  const { key } = await issueLinkKey(user);
  const first = await linkDevice(key, machine("a"));
  const second = await linkDevice(key, machine("b"));

  // Push the period past its end with cancellation scheduled: the plan is over.
  const g = globalThis as unknown as { __synapthPayments_v1: { subs: Array<{ userId: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean }> } };
  const sub = g.__synapthPayments_v1.subs.find((s) => s.userId === user)!;
  sub.currentPeriodEnd = new Date(Date.now() - 1000).toISOString();
  sub.cancelAtPeriodEnd = true;

  const older = await requireDevice(withToken(first.token));
  const newer = await requireDevice(withToken(second.token));
  assert.equal(older.suspended, false, "the oldest machine keeps working");
  assert.equal(newer.suspended, true);
  const status = await cliStatus(newer);
  assert.equal(status.plan.id, "free");
  assert.equal(status.plan.lapsedFrom, "pro");
  assert.ok(status.notices.includes("expired"));
  assert.ok(status.notices.includes("device_suspended"));
  await assert.rejects(installForDevice(newer, { slug: "acme-strict-code-reviewer", target: "claude-code" }), code("device_suspended"));
  await installForDevice(older, { slug: "acme-strict-code-reviewer", target: "claude-code" });
});

test("trust and entrypoints: Sandbox needs opt-in, HTTP tools are not installable, refusals cost nothing", async () => {
  resetCliForTests();
  resetPaymentsForTests();
  const { key } = await issueLinkKey("usr_cli6");
  const caller = await requireDevice(withToken((await linkDevice(key, machine("a"))).token));
  await assert.rejects(installForDevice(caller, { slug: "kite-unrestricted-shell", target: "claude-code" }), (e: unknown) => code("not_installable")(e) && (e as CliError).extra.reason === "sandbox");
  await assert.rejects(installForDevice(caller, { slug: "acme-weather-now", target: "claude-code" }), (e: unknown) => code("not_installable")(e) && (e as CliError).extra.reason === "http");
  await assert.rejects(installForDevice(caller, { slug: "acme-strict-code-reviewer", target: "claude-desktop" }), code("not_installable"));
  await assert.rejects(installForDevice(caller, { slug: "no-such-entry", target: "claude-code" }), code("not_found"));
  assert.equal((await cliStatus(caller)).usage.installsToday, 0);

  const sandbox = await installForDevice(caller, { slug: "kite-unrestricted-shell", target: "claude-code", allowSandbox: true });
  assert.equal(sandbox.installed[0].securityLevel, "Sandbox");
});

test("bundles are data with safe names: MCP entries and SKILL.md directories", async () => {
  const mcp = (await skillRepository.bySlug("acme-postgres-mcp"))!;
  const out = cliBundle(mcp, "cursor");
  assert.ok(out.ok);
  assert.equal(out.bundle.actions[0].kind, "mcp");

  const prompt = (await skillRepository.bySlug("acme-strict-code-reviewer"))!;
  const evil = { ...prompt, slug: "../../etc", name: 'x"\n---\nevil: true', source: null };
  const res = cliBundle(evil, "claude-code");
  assert.ok(res.ok);
  const action = res.bundle.actions[0];
  assert.equal(action.kind, "skill");
  if (action.kind === "skill") {
    assert.ok(!action.dir.includes(".."), "slug cannot climb out of the skills directory");
    assert.equal(action.source.type, "inline");
    if (action.source.type === "inline") assert.match(action.source.files[0].content, /^---\nname: "x\\" --- evil: true"\n/, "frontmatter is quoted");
  }

  const github = cliBundle({ ...prompt, source: { ...(prompt.source ?? ({} as never)), fullName: "acme/skills", defaultBranch: "main", manifestPath: "skills/review/SKILL.md", manifestFile: "SKILL.md" } as never }, "claude-code");
  assert.ok(github.ok && github.bundle.actions[0].kind === "skill" && github.bundle.actions[0].source.type === "github" && github.bundle.actions[0].dir === "review");

  assert.equal(safeSegment(".."), "skill");
  assert.equal(safeSegment("a/b c"), "a-b-c");
  assert.equal(isSafeRelativePath("scripts/run.sh"), true);
  for (const bad of ["/etc/passwd", "../x", "a/../b", "a//b", "a\\b", ""]) assert.equal(isSafeRelativePath(bad), false, bad);
});

test("agents (via mcp) never get Sandbox, even with allowSandbox; recommend runs resolve_task for the device", async () => {
  resetCliForTests();
  resetPaymentsForTests();
  const { key } = await issueLinkKey("usr_cli7");
  const caller = await requireDevice(withToken((await linkDevice(key, machine("a"))).token));
  await assert.rejects(
    installForDevice(caller, { slug: "kite-unrestricted-shell", target: "claude-code", allowSandbox: true, via: "mcp" }),
    (e: unknown) => code("not_installable")(e) && /agents cannot/.test((e as Error).message),
  );
  const res = await installForDevice(caller, { slug: "acme-postgres-mcp", target: "claude-code", via: "mcp" });
  assert.equal(res.installed.length, 1);
  const g = globalThis as unknown as { __synapthCli_v1: { installs: Array<{ via: string }> } };
  assert.equal(g.__synapthCli_v1.installs.at(-1)?.via, "mcp", "the install is attributed to the agent");

  const recs = await cliRecommend(caller, "read-only SQL access to a postgres database", "claude-code");
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.ok("set" in r.install || r.install.skills.length > 0);
    assert.ok(r.items.every((i) => i.trust !== "Sandbox" && i.trust !== "Quarantine"), "the owner policy keeps Sandbox out");
  }
});

test("installer: no bare $VAR right before a non-ASCII byte (bash 3.2 in a UTF-8 locale reads it as part of the name)", async () => {
  const { GET } = await import("@/app/cli/install/route");
  const script = await (await GET(new Request("http://localhost:3000/cli/install"))).text();
  assert.ok(script.startsWith("#!/bin/sh"));
  assert.deepEqual(script.match(/\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7f])/g) ?? [], []);
});
