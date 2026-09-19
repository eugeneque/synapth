import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processRepo, crawl, loadState } from "@/cortex/crawler";
import { createMockFetcher, importAllFromGithub, discoverManifests, parseRepoUrl } from "@/lib/github-parser";

const fetcher = createMockFetcher();

test("discoverManifests finds every SKILL.md in a collection, root first", async () => {
  const found = await discoverManifests(parseRepoUrl("acme/skills-collection"), fetcher);
  assert.deepEqual(
    found.map((f) => f.path),
    ["skills/pdf/SKILL.md", "skills/xlsx/SKILL.md"],
  );
});

test("importAllFromGithub maps a collection to one skill per directory with folded YAML", async () => {
  const results = await importAllFromGithub("acme/skills-collection", fetcher);
  assert.equal(results.length, 2);
  const xlsx = results.find((r) => r.input.name === "xlsx")!;
  assert.equal(xlsx.input.description, "Create and edit spreadsheets with formulas.");
  assert.equal(xlsx.input.slug, "acme-skills-collection-xlsx");
  assert.equal(xlsx.input.origin, "github");
  assert.equal(xlsx.input.source?.manifestPath, "skills/xlsx/SKILL.md");
  assert.equal(xlsx.input.source?.language, "Python");
  assert.ok(xlsx.input.readme?.includes("openpyxl"));
});

test("processRepo scans every manifest and reports counts", async () => {
  const r = await processRepo({ fullName: "acme/skills-collection", foundBy: "test" }, fetcher, {});
  assert.equal(r.status, "imported");
  assert.equal(r.skills, 2);
  assert.ok(r.items.every((i) => i.scan.level === "Community"));
});

test("unknown repo is rejected, not thrown", async () => {
  const r = await processRepo({ fullName: "acme/nope", foundBy: "test" }, fetcher, {});
  assert.equal(r.status, "rejected");
});

test("crawl with injected candidates persists state and is resumable", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "synapth-")), "state.json");
  const candidates = [
    { fullName: "acme/skills-collection", foundBy: "test" },
    { fullName: "acme/weather-tool", foundBy: "test" },
    { fullName: "acme/nope", foundBy: "test" },
  ];
  const first = await crawl({ candidates, fetcher, statePath, token: null, codeSearch: false });
  assert.equal(first.processed, 3);
  assert.equal(first.imported, 2);
  assert.equal(first.rejected, 1);
  assert.equal(first.skillsCreated + first.skillsUpdated, 3);

  const state = loadState(statePath);
  assert.equal(Object.keys(state.repos).length, 3);
  assert.equal(state.runs.length, 1);

  const second = await crawl({ candidates, fetcher, statePath, token: null, codeSearch: false });
  assert.equal(second.processed, 0, "already-seen repos are skipped");

  const third = await crawl({ candidates, fetcher, statePath, token: null, codeSearch: false, refresh: true });
  assert.equal(third.skillsUpdated, 3);
});
