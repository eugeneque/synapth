import { test } from "node:test";
import assert from "node:assert/strict";
import { globalSearch } from "@/cortex/global-search";
import { skillRepository } from "@/cortex/repository";
import { skillSource } from "@/types/skill";
import { GLOBAL_SEARCH_LIMIT } from "@/types/search";

test("a handle finds the person first; @ searches people only", async () => {
  const hits = await globalSearch("acme");
  assert.equal(hits[0].kind, "user");
  assert.equal(hits[0].kind === "user" && hits[0].person.handle, "acme");
  assert.ok(hits.some((h) => h.kind === "skill"), "catalogue entries follow the person");

  const people = await globalSearch("@ki");
  assert.ok(people.length > 0);
  assert.ok(people.every((h) => h.kind === "user"));
});

test("empty query is a mixed, capped 'popular' list without duplicates", async () => {
  const hits = await globalSearch("");
  assert.ok(hits.length <= GLOBAL_SEARCH_LIMIT);
  assert.ok(new Set(hits.map((h) => h.kind)).size >= 2);
  assert.equal(new Set(hits.map((h) => `${h.kind}:${h.id}`)).size, hits.length);
});

test("source filter: github keeps crawled entries only, synapth drops them", async () => {
  const github = await globalSearch("", { source: "github", limit: 30 });
  assert.ok(github.every((h) => h.kind === "skill" && h.source === "github"));
  const synapth = await globalSearch("", { source: "synapth", limit: 30 });
  assert.ok(synapth.every((h) => h.kind !== "skill" || h.source === "synapth"));

  const res = await skillRepository.search("", { source: "synapth", limit: 100 });
  assert.ok(res.hits.length > 0);
  assert.ok(res.hits.every((h) => skillSource(h.skill) === "synapth"));
  const list = await skillRepository.list({ source: "github", limit: 100 });
  assert.ok(list.items.every((s) => s.origin === "github"));
});
