import { test } from "node:test";
import assert from "node:assert/strict";
import { scanDependencies, typosquatTarget, levenshtein } from "@/lib/dependency-scanner";
import { auditDependencies, type FetchLike } from "@/cortex/dependency-audit";

const rules = (files: Record<string, string>) => scanDependencies(files).findings.map((f) => f.rule);

test("install hooks are flagged (DP-02)", () => {
  assert.ok(rules({ "package.json": JSON.stringify({ scripts: { postinstall: "node setup.js" } }), "package-lock.json": "{}" }).includes("DP-02"));
  // A build-only `prepare` is normal.
  assert.ok(!rules({ "package.json": JSON.stringify({ scripts: { prepare: "tsc" } }), "package-lock.json": "{}" }).includes("DP-02"));
  assert.ok(rules({ "setup.py": "setup(cmdclass={'install': PostInstall})" }).includes("DP-02"));
});

test("typosquatting is 1–2 edits from a popular name, never the name itself (DP-03)", () => {
  assert.equal(levenshtein("lodahs", "lodash"), 2);
  assert.equal(typosquatTarget("expresss", "npm"), "express");
  assert.equal(typosquatTarget("reqeusts", "PyPI"), "requests");
  assert.equal(typosquatTarget("express", "npm"), null);
  assert.equal(typosquatTarget("color", "npm"), null);
  assert.ok(rules({ "package.json": JSON.stringify({ dependencies: { "expresss": "4.18.2" } }), "package-lock.json": "{}" }).includes("DP-03"));
});

test("missing lock files and ranges (DP-04); internal-looking names (DP-06)", () => {
  assert.ok(rules({ "package.json": JSON.stringify({ dependencies: { zod: "^3.0.0" } }) }).includes("DP-04"));
  assert.ok(!rules({ "package.json": JSON.stringify({ dependencies: { zod: "^3.0.0" } }), "yarn.lock": "" }).includes("DP-04"));
  assert.ok(rules({ "requirements.txt": "requests>=2\nhttpx==0.27.0" }).includes("DP-04"));
  assert.ok(!rules({ "requirements.txt": "requests==2.32.3" }).includes("DP-04"));
  assert.ok(rules({ "go.mod": "module x\nrequire github.com/a/b v1.0.0" }).includes("DP-04"));
  assert.ok(rules({ "package.json": JSON.stringify({ dependencies: { "acme-internal-utils": "1.0.0" } }), "package-lock.json": "{}" }).includes("DP-06"));
});

test("exact versions come from the lock file", () => {
  const scan = scanDependencies({
    "srv/package.json": JSON.stringify({ dependencies: { zod: "^3.0.0" } }),
    "srv/package-lock.json": JSON.stringify({ packages: { "": {}, "node_modules/zod": { version: "3.23.8" } } }),
  });
  assert.deepEqual(scan.packages, [{ ecosystem: "npm", name: "zod", version: "3.23.8" }]);
  assert.deepEqual(scan.lockfiles, ["srv/package-lock.json"]);
});

test("OSV hits become DP-01 with the advisory severity; young packages DP-05", async () => {
  const calls: string[] = [];
  const fake: FetchLike = async (url) => {
    calls.push(url);
    const body = url.includes("querybatch")
      ? { results: [{ vulns: [{ id: "GHSA-xxxx" }] }] }
      : url.includes("/vulns/")
        ? { id: "GHSA-xxxx", summary: "Prototype pollution", database_specific: { severity: "CRITICAL" } }
        : url.includes("registry.npmjs.org")
          ? { time: { created: new Date().toISOString() } }
          : { downloads: 12 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const findings = await auditDependencies([{ ecosystem: "npm", name: "left-pad", version: "1.0.0" }], "package.json", { fetch: fake });
  assert.equal(findings.find((f) => f.rule === "DP-01")?.severity, "critical");
  assert.ok(findings.some((f) => f.rule === "DP-05"));
  assert.ok(calls[0].includes("api.osv.dev"));
});

test("an unreachable registry never blocks the scan", async () => {
  const down: FetchLike = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await auditDependencies([{ ecosystem: "npm", name: "zod", version: "3.0.0" }], "package.json", { fetch: down }), []);
});
