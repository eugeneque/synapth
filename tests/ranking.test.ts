import { test } from "node:test";
import assert from "node:assert/strict";
import { sortSkills, isHiddenGem } from "@/cortex/ranking";
import { seedSkills } from "@/cortex/seed";

test("hidden gems = Verified, ≤5k installs, retention ≥ 0.6, rating ≥ 4.4", () => {
  const gems = sortSkills(seedSkills, "hidden-gems").map((s) => s.slug);
  assert.deepEqual(new Set(gems), new Set(["kite-sql-guardrails", "nimbus-meeting-summariser"]));
  assert.ok(!isHiddenGem(seedSkills.find((s) => s.slug === "acme-postgres-mcp")!));
});

test("trending puts high-velocity, starred skills first", () => {
  const top = sortSkills(seedSkills, "trending")[0];
  assert.ok(["nimbus-headless-browser", "acme-postgres-mcp"].includes(top.slug));
});

test("recent is chronological", () => {
  const recent = sortSkills(seedSkills, "recent");
  for (let i = 1; i < recent.length; i++) assert.ok(Date.parse(recent[i - 1].createdAt) >= Date.parse(recent[i].createdAt));
});
