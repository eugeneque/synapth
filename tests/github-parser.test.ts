import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoUrl, importFromGithub, createMockFetcher, parseSkillMarkdown, GithubParseError } from "@/lib/github-parser";

test("parseRepoUrl handles every accepted shape", () => {
  assert.deepEqual(parseRepoUrl("acme/repo"), { owner: "acme", repo: "repo", ref: "HEAD", path: "" });
  assert.deepEqual(parseRepoUrl("https://github.com/acme/repo.git"), { owner: "acme", repo: "repo", ref: "HEAD", path: "" });
  assert.deepEqual(parseRepoUrl("github.com/acme/repo/tree/main/packages/x"), { owner: "acme", repo: "repo", ref: "main", path: "packages/x" });
  assert.throws(() => parseRepoUrl("https://gitlab.com/a/b"), GithubParseError);
});

test("mcp-server.json → MCP skill with stdio entrypoint", async () => {
  const r = await importFromGithub("https://github.com/acme/postgres-mcp", createMockFetcher());
  assert.equal(r.manifestFile, "mcp-server.json");
  assert.equal(r.input.category, "MCP");
  assert.equal(r.input.manifest.tools.length, 2);
  assert.equal(r.input.manifest.entrypoint.type, "mcp-stdio");
  assert.deepEqual(r.input.manifest.requiredEnv, ["DATABASE_URL"]);
  assert.equal(r.input.githubStars, 1840);
});

test("tool.json → Tool skill with http entrypoint", async () => {
  const r = await importFromGithub("acme/weather-tool", createMockFetcher());
  assert.equal(r.input.category, "Tool");
  assert.equal(r.input.manifest.entrypoint.type, "http");
  assert.equal(r.input.manifest.tools[0].name, "weather_now");
});

test("SKILL.md → Prompt skill; frontmatter arrays parsed", async () => {
  const r = await importFromGithub("acme/code-review-skill", createMockFetcher());
  assert.equal(r.input.category, "Prompt");
  assert.equal(r.input.name, "Strict Code Reviewer");
  assert.ok(r.input.manifest.systemPrompt?.includes("Verdict / Blockers / Nits"));
  assert.ok(r.input.tags?.includes("prompt"));
});

test("unknown repo → not_found", async () => {
  await assert.rejects(importFromGithub("acme/nope", createMockFetcher()), (e: unknown) => e instanceof GithubParseError && e.code === "not_found");
});

test("parseSkillMarkdown without frontmatter", () => {
  const r = parseSkillMarkdown("just a prompt");
  assert.deepEqual(r.frontmatter, {});
  assert.equal(r.body, "just a prompt");
});
