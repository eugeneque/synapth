import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSkillset, deleteSkillset, favoriteSummary, getSkillset, getSkillsetImage, listFavoriteSkillsets, listSkillsets, resetSkillsetsForTests, setSkillsetVerification, skillsetHistory, skillsetSkills, toggleFavorite, updateSkillset, uploadSkillsetImage, SkillsetError } from "@/cortex/skillsets";
import { listNotifications, resetNotificationsForTests } from "@/cortex/notifications";
import { PermissionDeniedError } from "@/cortex/roles";
import { skillRepository } from "@/cortex/repository";
import { shellQuote, skillsetInstall } from "@/axon/install";
import type { Skill } from "@/types/skill";

const DEMO = "usr_demo"; // admin in the in-memory seed
const ACME = "usr_acme";
const KITE = "usr_kite";

// 1×1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeEach(() => {
  resetSkillsetsForTests();
  resetNotificationsForTests();
});

test("create: validates input, unique slugs, logs creation and every entry", async () => {
  const set = await createSkillset(ACME, { name: "  Data work  ", summary: "SQL + Postgres", description: "# Hi", skillIds: ["skl_postgres", "skl_sqlguard", "skl_postgres"] });
  assert.equal(set.name, "Data work");
  assert.equal(set.slug, "data-work");
  assert.equal(set.author.handle, "acme");
  assert.equal(set.verified, false);
  assert.deepEqual(set.items.map((i) => i.skillId), ["skl_postgres", "skl_sqlguard"]);
  assert.equal(set.items[0].skill?.category, "MCP");

  const again = await createSkillset(KITE, { name: "Data work" });
  assert.equal(again.slug, "data-work-2");
  assert.equal((await createSkillset(KITE, { name: "New" })).slug, "new-2", "route segments are reserved");
  assert.equal((await createSkillset(KITE, { name: "Разработка 2D-игр" })).slug, "razrabotka-2d-igr");
  assert.equal((await createSkillset(KITE, { name: "游戏开发" })).slug, "skillset");

  const history = await skillsetHistory(set.id);
  assert.deepEqual(history.map((h) => h.action).reverse(), ["created", "added", "added"]);
  assert.equal(history[0].skillName, "SQL Guardrails");

  await assert.rejects(createSkillset(ACME, { name: "x" }));
  await assert.rejects(createSkillset(ACME, { name: "Ghosts", skillIds: ["skl_missing"] }), SkillsetError);
  await assert.rejects(createSkillset(ACME, { name: "Avatar", avatar: "data:text/html;base64,PGgxPg==" }));
});

test("update: only the author edits; additions, removals and edits land in the history", async () => {
  const set = await createSkillset(ACME, { name: "Ops", skillIds: ["skl_postgres", "skl_jira"] });
  await assert.rejects(updateSkillset(KITE, set.id, { name: "Hijack", skillIds: [] }), (err: unknown) => err instanceof SkillsetError && err.status === 403);

  const updated = await updateSkillset(ACME, set.slug, { name: "Ops kit", description: "Now with docs", skillIds: ["skl_jira", "skl_browser"] });
  assert.equal(updated.name, "Ops kit");
  assert.equal(updated.slug, "ops", "slugs stay stable across renames");
  assert.deepEqual(updated.items.map((i) => i.skillId), ["skl_jira", "skl_browser"]);

  const lines = (await skillsetHistory(set.id)).reverse().map((h) => `${h.action}:${h.skillId ?? h.fields.join(",")}`);
  assert.deepEqual(lines.slice(3), ["edited:name,description", "added:skl_browser", "removed:skl_postgres"]);

  // Saving the same state is a no-op: nothing new in the history.
  const before = (await skillsetHistory(set.id)).length;
  await updateSkillset(ACME, set.id, { name: "Ops kit", description: "Now with docs", skillIds: ["skl_jira", "skl_browser"] });
  assert.equal((await skillsetHistory(set.id)).length, before);

  // Reordering is saved without history noise.
  const reordered = await updateSkillset(ACME, set.id, { name: "Ops kit", description: "Now with docs", skillIds: ["skl_browser", "skl_jira"] });
  assert.deepEqual(reordered.items.map((i) => i.skillId), ["skl_browser", "skl_jira"]);
  assert.equal((await skillsetHistory(set.id)).length, before);
});

test("verification: staff only, logged, author notified, reset by any composition change", async () => {
  const set = await createSkillset(ACME, { name: "Reviewed", skillIds: ["skl_postgres"] });
  await assert.rejects(setSkillsetVerification(KITE, set.id, true), PermissionDeniedError);

  const verified = await setSkillsetVerification(DEMO, set.id, true);
  assert.equal(verified.verified, true);
  assert.equal(verified.verifiedBy?.handle, "demo");
  assert.equal((await listNotifications(ACME)).items[0].kind, "skillset.verified");

  // Text edits keep the verification…
  assert.equal((await updateSkillset(ACME, set.id, { name: "Reviewed", summary: "typo fixed", skillIds: ["skl_postgres"] })).verified, true);
  // …a new entry drops it, with an automatic history line.
  const changed = await updateSkillset(ACME, set.id, { name: "Reviewed", summary: "typo fixed", skillIds: ["skl_postgres", "skl_shell"] });
  assert.equal(changed.verified, false);
  assert.equal(changed.verifiedBy, null);
  const last = (await skillsetHistory(set.id))[0];
  assert.equal(last.action, "unverified");
  assert.equal(last.auto, true);

  const empty = await createSkillset(ACME, { name: "Empty" });
  await assert.rejects(setSkillsetVerification(DEMO, empty.id, true), (err: unknown) => err instanceof SkillsetError && err.status === 409);
  assert.equal((await listSkillsets({ verified: true })).length, 0);
});

test("favorites: toggle per user, listed newest first, followers hear about composition changes", async () => {
  const a = await createSkillset(ACME, { name: "Alpha", skillIds: ["skl_postgres"] });
  const b = await createSkillset(ACME, { name: "Beta" });

  assert.deepEqual(await toggleFavorite(KITE, a.id), { favorites: 1, favorited: true });
  await toggleFavorite(KITE, b.slug);
  await toggleFavorite(DEMO, a.id);
  assert.deepEqual(await favoriteSummary(a.id, KITE), { favorites: 2, favorited: true });
  assert.deepEqual((await listFavoriteSkillsets(KITE)).map((s) => s.slug), ["beta", "alpha"]);
  assert.equal((await listSkillsets({ sort: "popular" }))[0].slug, "alpha");

  await updateSkillset(ACME, a.id, { name: "Alpha", skillIds: ["skl_postgres", "skl_jira"] });
  const feed = await listNotifications(KITE);
  assert.equal(feed.items[0].kind, "skillset.updated");
  assert.deepEqual(feed.items[0].subject, { kind: "skillset.updated", skillsetId: a.id, slug: "alpha", name: "Alpha", added: 1, removed: 0 });

  assert.deepEqual(await toggleFavorite(KITE, a.id), { favorites: 1, favorited: false });
  await assert.rejects(toggleFavorite(KITE, "nope"), SkillsetError);
});

test("delete: author or moderator; everything attached goes with it", async () => {
  const set = await createSkillset(ACME, { name: "Temp", skillIds: ["skl_postgres"] });
  await toggleFavorite(KITE, set.id);
  await assert.rejects(deleteSkillset(KITE, set.id), (err: unknown) => err instanceof SkillsetError && err.status === 403);
  await deleteSkillset(DEMO, set.id, { moderator: true });
  assert.equal(await getSkillset(set.id), null);
  assert.equal((await skillsetHistory(set.id)).length, 0);
  assert.equal((await listFavoriteSkillsets(KITE)).length, 0);
});

test("listing: search, author and contained-skill filters", async () => {
  await createSkillset(ACME, { name: "Game dev", summary: "Godot and assets", skillIds: ["skl_browser"] });
  await createSkillset(KITE, { name: "Embedded", summary: "Low-level", skillIds: ["skl_sqlguard"] });
  assert.deepEqual((await listSkillsets({ q: "godot" })).map((s) => s.slug), ["game-dev"]);
  assert.deepEqual((await listSkillsets({ authorId: KITE })).map((s) => s.slug), ["embedded"]);
  assert.deepEqual((await listSkillsets({ skillId: "skl_browser" })).map((s) => s.slug), ["game-dev"]);
  const [summary] = await listSkillsets({ q: "embedded" });
  assert.deepEqual(summary.counts, { MCP: 0, Prompt: 1, Tool: 0 });
});

test("description images: only real image data URLs, served back as bytes", async () => {
  const { id, url } = await uploadSkillsetImage(ACME, PNG);
  assert.equal(url, `/api/v1/skillsets/images/${id}`);
  const image = await getSkillsetImage(id);
  assert.equal(image?.mime, "image/png");
  assert.equal(image?.body.subarray(1, 4).toString(), "PNG");
  await assert.rejects(uploadSkillsetImage(ACME, "data:image/svg+xml;base64,PHN2Zz4="));
  await assert.rejects(uploadSkillsetImage(ACME, "https://example.com/a.png"));
});

test("install: one script, Sandbox and HTTP entries skipped, manifest data shell-quoted", async () => {
  const set = await createSkillset(ACME, { name: "Everything", skillIds: ["skl_postgres", "skl_sqlguard", "skl_weather", "skl_shell"] });
  const skills = await skillsetSkills(set);
  const plan = skillsetInstall(set, skills, "claude-code");
  assert.match(plan.command, /^curl -fsSL '.*\/api\/v1\/skillsets\/everything\/install\?target=claude-code' \| sh$/);
  assert.deepEqual(plan.included.map((s) => s.slug), ["acme-postgres-mcp", "kite-sql-guardrails"]);
  assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), ["http", "sandbox"]);
  assert.match(plan.body, /^#!\/bin\/sh/);
  assert.match(plan.body, /claude mcp add 'acme-postgres-mcp' -- 'npx'/);
  assert.match(plan.body, /\.claude\/skills\/kite-sql-guardrails\/SKILL\.md/);
  assert.match(plan.body, /# skipped \(sandbox\): Unrestricted Shell/);
  assert.doesNotMatch(plan.body, /→ Unrestricted Shell/);

  // A hostile manifest cannot break out of quoting or end the heredoc early.
  const base = (await skillRepository.byId("skl_sqlguard"))!;
  const evil: Skill = {
    ...base,
    id: "skl_evil",
    slug: "evil",
    securityLevel: "Community",
    manifest: { ...base.manifest, systemPrompt: "line\nSYNAPTH_EVIL_EOF\nrm -rf ~\n" },
  };
  const mcp: Skill = { ...base, id: "skl_evil_mcp", slug: "evil-mcp", securityLevel: "Community", manifest: { ...base.manifest, category: "MCP", entrypoint: { type: "mcp-stdio", command: "npx", args: ["pkg; rm -rf ~", "$(whoami)"] } } };
  const script = skillsetInstall({ slug: "x", name: "X" }, [evil, mcp], "claude-code").body;
  assert.match(script, /<<'SYNAPTH_EVIL_EOF_X'/);
  assert.match(script, /'pkg; rm -rf ~' '\$\(whoami\)'/);
  assert.equal(shellQuote("it's"), `'it'\\''s'`);

  const cursor = skillsetInstall(set, skills, "cursor");
  assert.match(cursor.body, /node -e/);
  assert.match(cursor.body, /\.cursor\/rules\/kite-sql-guardrails\.mdc/);

  const desktop = skillsetInstall(set, skills, "claude-desktop");
  assert.equal(desktop.commandLanguage, "json");
  assert.ok(JSON.parse(desktop.command).mcpServers["acme-postgres-mcp"]);
});
