import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { permissionsFromAllowedTools, permissionsFromCode, permissionsFromDependencies, permissionsFromTools, refinePermissions, codeFilesFor, withPermissions } from "@/lib/permissions";
import { appendVersion, manifestText, sameContent, versionLabel } from "@/lib/skill-versions";
import { diffLines } from "@/lib/diff";
import { createMockFetcher, importAllFromGithub } from "@/lib/github-parser";
import { applyAudit, auditRepository } from "@/cortex/repo-audit";
import { skillRepository, VELOCITY_WINDOW_MS } from "@/cortex/repository";
import type { SkillManifest } from "@/types/skill";

const base: SkillManifest = { schemaVersion: 1, name: "x", description: "d", category: "MCP", tools: [], entrypoint: { type: "mcp-stdio", command: "npx", args: ["-y", "x"] } };

test("allowed-tools map to permissions with the tool as evidence", () => {
  const ev = permissionsFromAllowedTools(["Read", "Grep", "Edit", "Bash(git:*)", "WebFetch", "mcp__github__create_issue"]);
  assert.deepEqual([...new Set(ev.map((e) => e.permission))], ["filesystem:read", "filesystem:write", "shell", "network"]);
  assert.ok(ev.some((e) => e.detail === "Bash(git:*)" && e.via === "allowed-tools"));
});

test("code detection reports the line, skips comments and needs an fs import for file calls", () => {
  const ev = permissionsFromCode({
    "src/index.ts": ['import { readFile, writeFile } from "node:fs/promises";', "// fetch( in a comment", "const body = await readFile(p);", "await writeFile(out, body);", "const r = await fetch(url);", "const k = process.env.API_KEY;"].join("\n"),
    "src/other.ts": "const stat = obj.stat(x); // no fs import",
    "tool.py": "import subprocess\nwith open(path) as f:\n    pass\nopen(out, 'w').write(x)\n",
  });
  const where = (p: string) => ev.filter((e) => e.permission === p).map((e) => e.detail);
  assert.deepEqual(where("filesystem:read"), ["src/index.ts:3 · const body = await readFile(p);", "tool.py:2 · with open(path) as f:"]);
  assert.deepEqual(where("filesystem:write"), ["src/index.ts:4 · await writeFile(out, body);", "tool.py:4 · open(out, 'w').write(x)"]);
  assert.deepEqual(where("network"), ["src/index.ts:5 · const r = await fetch(url);"]);
  assert.deepEqual(where("shell"), ["tool.py:1 · import subprocess"]);
  assert.equal(where("env").length, 1);
});

test("dependencies and declared tools count as evidence", () => {
  const deps = permissionsFromDependencies({ "package.json": JSON.stringify({ dependencies: { axios: "1", execa: "9", lodash: "4" } }), "requirements.txt": "httpx==0.27 # client\npyperclip\n" });
  assert.deepEqual(deps.map((e) => `${e.permission}:${e.detail}`), ["network:axios · package.json", "shell:execa · package.json", "network:httpx · requirements.txt", "clipboard:pyperclip · requirements.txt"]);
  const tools = permissionsFromTools([{ name: "read_file" }, { name: "writeFile" }, { name: "run_command" }, { name: "query", annotations: { openWorldHint: true } }, { name: "list_tables" }]);
  assert.deepEqual(tools.map((e) => e.permission), ["filesystem:read", "filesystem:write", "shell", "network"]);
});

test("a guess is replaced only once code was read; declared SKILL.md grows with its scripts", () => {
  const assumed = { ...base, ...withPermissions("assumed", [], ["shell", "network"]) };
  assert.deepEqual(assumed.permissions, ["shell", "network"]);
  assert.equal(refinePermissions(assumed, { files: [], evidence: [] }), assumed);
  const refined = refinePermissions(assumed, { files: ["src/index.ts"], evidence: [{ permission: "env", via: "code", detail: "src/index.ts:1 · process.env.X" }] });
  assert.equal(refined.permissionSource, "detected");
  assert.deepEqual(refined.permissions, ["env"]);

  const skill: SkillManifest = { ...base, category: "Prompt", entrypoint: { type: "prompt" }, ...withPermissions("declared", permissionsFromAllowedTools(["Bash"])) };
  const withScripts = refinePermissions(skill, { files: ["scripts/a.py"], evidence: [{ permission: "filesystem:write", via: "code", detail: "scripts/a.py:3 · open(x, 'w')" }] });
  assert.equal(withScripts.permissionSource, "declared");
  assert.deepEqual(withScripts.permissions, ["filesystem:write", "shell"]);
});

test("code files: entry points first, tests and configs out", () => {
  const tree = ["src/index.ts", "src/util/a.ts", "src/index.test.ts", "tests/x.ts", "vite.config.ts", "README.md", "pkg/other/main.py", "src/types.d.ts"];
  assert.deepEqual(codeFilesFor(tree, "", 10), ["src/index.ts", "pkg/other/main.py", "src/util/a.ts"]);
  assert.deepEqual(codeFilesFor(["skills/pdf/scripts/merge.py", "skills/xlsx/x.py"], "skills/pdf", 5), ["skills/pdf/scripts/merge.py"]);
});

test("the crawler path: permissions come from the repository, not a blanket guess", async () => {
  const fetcher = createMockFetcher();
  const results = await importAllFromGithub("acme/postgres-mcp", fetcher);
  assert.equal(results[0].input.manifest.permissionSource, "assumed", "before the code is read");
  const audit = await auditRepository(results[0].ref, fetcher, [""]);
  const manifest = applyAudit(results[0].input, results[0].manifestPath, audit).manifest;
  assert.equal(manifest.permissionSource, "detected");
  assert.deepEqual(manifest.permissions, ["network", "env"]);
  assert.ok(manifest.permissionEvidence?.some((e) => e.via === "code" && e.detail.startsWith("src/index.ts:2")));

  const remote = await importAllFromGithub("acme/weather-tool", fetcher);
  assert.deepEqual(remote[0].input.manifest.permissionEvidence, [{ permission: "network", via: "entrypoint", detail: "HTTP POST tools.acme.dev" }]);
});

test("versions: a change without a bump gets a tagged label; analysis-only changes are not versions", () => {
  const v1 = { ...base, description: "one" };
  const v2 = { ...base, description: "two" };
  const h1 = appendVersion([], "1.0.0", v1, "2026-01-01T00:00:00Z")!;
  assert.equal(appendVersion(h1, "1.0.0", { ...v1, permissionEvidence: [{ permission: "env", via: "code", detail: "a:1" }] }, "x"), null);
  const h2 = appendVersion(h1, "1.0.0", v2, "2026-01-02T00:00:00Z")!;
  assert.match(h2[1].version, /^1\.0\.0\+[0-9a-f]{7}$/);
  const h3 = appendVersion(h2, "1.1.0", v1, "2026-01-03T00:00:00Z")!;
  assert.equal(h3[2].version, "1.1.0");
  assert.equal(versionLabel("1.0.0", v1, ["2.0.0"]), "1.0.0");
  const reordered = Object.fromEntries(Object.entries(v1).reverse()) as unknown as SkillManifest;
  assert.ok(sameContent(v1, reordered), "key order does not make a version");
});

test("manifestText + diff read like a changelog", () => {
  const before = manifestText({ ...base, permissions: ["network"], systemPrompt: "a\nb\nc" });
  const after = manifestText({ ...base, permissions: ["network", "shell"], systemPrompt: "a\nB\nc" });
  const changed = diffLines(before, after).filter((l) => l.op !== "equal");
  assert.deepEqual(changed, [
    { op: "remove", text: "permissions: network" },
    { op: "add", text: "permissions: network, shell" },
    { op: "remove", text: "b" },
    { op: "add", text: "B" },
  ]);
  // Long unchanged heads and tails stay out of the LCS table.
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
  assert.deepEqual(diffLines(big, big.replace("line 2500", "changed")).filter((l) => l.op !== "equal").length, 2);
});

test("the catalogue keeps every manifest change and counts installs over seven days", async () => {
  const slug = `provenance-${Date.now()}`;
  const item = (description: string) => ({ input: { name: "Provenance", slug, description, version: "0.1.0", category: "MCP" as const, pricePerCall: 0, manifest: { ...base, description } }, authorId: "gh:prov", authorName: "prov", securityLevel: "Community" as const });
  await skillRepository.upsertMany([item("first")]);
  await skillRepository.upsertMany([item("first")]);
  await skillRepository.upsertMany([item("second")]);
  const skill = (await skillRepository.bySlug(slug))!;
  const versions = await skillRepository.versions(skill.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].manifest.description, "second", "newest first");
  assert.match(versions[0].version, /^0\.1\.0\+/);
  const change = await skillRepository.latestChange();
  assert.equal(change?.skill.id, skill.id);

  await skillRepository.recordInstall(skill.id, "web");
  await skillRepository.recordInstall(skill.id, "web");
  assert.equal((await skillRepository.byId(skill.id))!.stats.installVelocity7d, 2);
  assert.equal((await skillRepository.byId(skill.id))!.downloadsCount, 2);

  mock.timers.enable({ apis: ["Date"], now: Date.now() + VELOCITY_WINDOW_MS + 120_000 });
  try {
    const later = (await skillRepository.byId(skill.id))!;
    assert.equal(later.stats.installVelocity7d, 0, "the weekly figure decays without new installs");
    assert.equal(later.downloadsCount, 2, "the all-time figure does not");
  } finally {
    mock.timers.reset();
  }
});
