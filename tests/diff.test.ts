import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, diffSummary } from "@/lib/diff";

test("diffLines marks additions and removals", () => {
  const d = diffLines("a\nb\nc", "a\nx\nc\nd");
  assert.deepEqual(
    d.map((l) => `${l.op}:${l.text}`),
    ["equal:a", "remove:b", "add:x", "equal:c", "add:d"],
  );
  assert.deepEqual(diffSummary(d), { added: 2, removed: 1, unchanged: 2 });
});

test("empty strings", () => {
  assert.deepEqual(diffLines("", ""), []);
  assert.deepEqual(diffLines("", "a"), [{ op: "add", text: "a" }]);
});
