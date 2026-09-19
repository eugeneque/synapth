import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, search, suggest, parseQuery, tokenize, damerauLevenshtein } from "@/cortex/search";
import { seedSkills } from "@/cortex/seed";

const index = buildIndex(seedSkills);

test("tokenize stems and drops stop words", () => {
  assert.deepEqual(tokenize("The Postgres queries for agents"), ["postgre", "query", "agent"]);
});

test("exact term ranks the right skill first with highlights", () => {
  const r = search(index, "postgres");
  assert.equal(r.hits[0].skill.slug, "acme-postgres-mcp");
  assert.ok(r.hits[0].highlights.some((h) => h.segments.some((s) => s.match)));
  assert.ok(r.tookMs >= 0);
});

test("typo is corrected via fuzzy matching", () => {
  const r = search(index, "postgers");
  assert.equal(r.hits[0]?.skill.slug, "acme-postgres-mcp");
  assert.deepEqual(r.corrections, [{ from: "postger", to: "postgre" }]);
});

test("prefix expansion works for the last term", () => {
  const r = search(index, "brows");
  assert.equal(r.hits[0]?.skill.slug, "nimbus-headless-browser");
});

test("query syntax: filters and exclusion", () => {
  const p = parseQuery('category:MCP is:verified author:acme stars:>100 -weather "read-only"');
  assert.equal(p.filters.category, "MCP");
  assert.equal(p.filters.securityLevel, "Verified");
  assert.equal(p.filters.author, "acme");
  assert.equal(p.filters.minStars, 100);
  assert.deepEqual(p.excluded, ["weather"]);
  assert.deepEqual(p.phrases, ["read-only"]);

  const r = search(index, "category:Prompt is:verified");
  assert.ok(r.hits.length > 0);
  assert.ok(r.hits.every((h) => h.skill.category === "Prompt" && h.skill.securityLevel === "Verified"));
});

test("facets are computed over the filtered set", () => {
  const r = search(index, "");
  assert.equal(r.total, seedSkills.length);
  assert.deepEqual(
    r.facets.category.map((b) => b.value).sort(),
    ["MCP", "Prompt", "Tool"],
  );
});

test("suggest returns skills, tags and terms", () => {
  const s = suggest(index, "post");
  assert.ok(s.some((x) => x.type === "skill" && x.slug === "acme-postgres-mcp"));
  assert.ok(s.some((x) => x.type === "tag" && x.text === "tag:postgres"));
});

test("damerauLevenshtein handles transpositions", () => {
  assert.equal(damerauLevenshtein("postgers", "postgres", 2), 1);
  assert.equal(damerauLevenshtein("abc", "xyz", 1), 2);
});
