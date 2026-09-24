import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processRepo, crawl, loadState } from "@/cortex/crawler";
import { createMockFetcher, importAllFromGithub, discoverManifests, parseRepoUrl, rateLimitReset, GithubParseError, type RepoFetcher } from "@/lib/github-parser";
import { githubFullName, mcpRegistryCandidates, dockerProject, marketplaceRepos, linkedRepos, awesomeCandidates } from "@/cortex/crawl-sources";

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

test("rateLimitReset tells a rate limit from any other 403", () => {
  const res = (status: number, headers: Record<string, string>) => new Response(null, { status, headers });
  assert.ok(rateLimitReset(res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" }), "")! === 2_000_000_000_000);
  assert.ok(rateLimitReset(res(403, { "retry-after": "30" }), "")! > Date.now());
  assert.ok(rateLimitReset(res(403, {}), '{"message":"You have exceeded a secondary rate limit"}')! > Date.now());
  assert.ok(rateLimitReset(res(429, {}), "")! > Date.now());
  assert.equal(rateLimitReset(res(403, { "x-ratelimit-remaining": "4999" }), '{"message":"Repository access blocked"}'), null);
  assert.equal(rateLimitReset(res(404, {}), ""), null);
});

test("githubFullName reads every repository URL shape registries use", () => {
  assert.equal(githubFullName("git+https://github.com/acme/postgres-mcp.git"), "acme/postgres-mcp");
  assert.equal(githubFullName("https://github.com/acme/mcp/tree/main/servers/x"), "acme/mcp");
  assert.equal(githubFullName("git@github.com:acme/tool.js.git"), "acme/tool.js");
  assert.equal(githubFullName("https://www.github.com/acme/skills#readme"), "acme/skills");
  assert.equal(githubFullName("https://notgithub.com/acme/skills"), null);
  assert.equal(githubFullName("https://gitlab.com/acme/skills"), null);
  assert.equal(githubFullName(undefined), null);
});

test("MCP registry discovery pages until enough unknown repos, skipping known ones", async () => {
  const pages = [
    { servers: [{ server: { repository: { url: "https://github.com/acme/known" } } }, { server: { repository: { url: "https://github.com/acme/one" } } }, { server: {} }], metadata: { nextCursor: "c1" } },
    { servers: [{ server: { repository: { url: "https://github.com/acme/two.git" } } }, { server: { repository: { url: "https://github.com/acme/three" } } }], metadata: { nextCursor: "c2" } },
  ];
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(pages[urls.length - 1] ?? { servers: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const found = await mcpRegistryCandidates({ want: 2, isKnown: (k) => k === "acme/known", log: () => undefined });
    assert.deepEqual(found.map((c) => c.fullName), ["acme/known", "acme/one", "acme/two", "acme/three"]);
    assert.equal(urls.length, 2, "stops once two unknown repos were found");
    assert.ok(urls[1].includes("cursor=c1"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a rate limit that outlasts the deadline ends the run instead of sleeping, and leaves repos unrecorded", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "synapth-")), "state.json");
  const limited: RepoFetcher = {
    meta: async () => {
      throw new GithubParseError("rate limited", "rate_limited", Date.now() + 3_600_000);
    },
    readFile: async () => null,
    tree: async () => null,
  };
  const started = Date.now();
  const p = await crawl({ candidates: [{ fullName: "acme/a", foundBy: "t" }, { fullName: "acme/b", foundBy: "t" }], fetcher: limited, statePath, token: null, deadline: Date.now() + 5_000 });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(p.processed, 0);
  assert.equal(Object.keys(loadState(statePath).repos).length, 0, "retried by the next run");
});

test("a refused repo is an error, not a rejection, and does not stop the run", async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), "synapth-")), "state.json");
  const base = createMockFetcher();
  const refusing: RepoFetcher = {
    ...base,
    meta: async (ref) => {
      if (ref.repo === "blocked") throw new GithubParseError("Repository access blocked", "forbidden");
      return base.meta(ref);
    },
  };
  const p = await crawl({ candidates: [{ fullName: "acme/blocked", foundBy: "t" }, { fullName: "acme/weather-tool", foundBy: "t" }], fetcher: refusing, statePath, token: null, refresh: true });
  assert.equal(p.errors, 1);
  assert.equal(p.imported, 1);
});

test("NUL characters never reach the catalogue", async () => {
  const base = createMockFetcher();
  const nul: RepoFetcher = {
    ...base,
    readFile: async (ref, path) => {
      if (ref.repo !== "weather-tool" || path !== "tool.json") return base.readFile(ref, path);
      return JSON.stringify({ name: "weather_now", description: "Weather\u0000 now \\\u0000", url: "https://tools.acme.dev/weather" });
    },
  };
  const [r] = await importAllFromGithub("acme/weather-tool", nul);
  assert.equal(r.input.description, "Weather now \\");
  assert.ok(!JSON.stringify(r.input).includes("\\u0000"));
});

test("Docker catalog server.yaml yields its GitHub project", () => {
  const yaml = "name: github-official\nimage: ghcr.io/github/github-mcp-server\nabout:\n  title: GitHub\nsource:\n  project: https://github.com/github/github-mcp-server\n  commit: 23fa0dd\nrun:\n  allowHosts: []\n";
  assert.equal(dockerProject(yaml), "github/github-mcp-server");
  assert.equal(dockerProject("name: remote\ntype: remote\nremote:\n  url: https://x.dev/mcp\n"), null);
});

test("marketplace.json: the marketplace repo plus every plugin source on GitHub", () => {
  const json = JSON.stringify({
    plugins: [
      { name: "local", source: "./plugins/local" },
      { name: "gh", source: { source: "github", repo: "acme/gh-plugin" } },
      { name: "url", source: { source: "url", url: "https://github.com/acme/url-plugin.git" } },
      { name: "sub", source: { source: "git-subdir", url: "https://github.com/acme/mono.git", path: "plugins/x" } },
      { name: "gitlab", source: { source: "url", url: "https://gitlab.com/acme/x.git" } },
    ],
  });
  assert.deepEqual(marketplaceRepos(json, "acme/market"), ["acme/market", "acme/gh-plugin", "acme/url-plugin", "acme/mono"]);
  assert.deepEqual(marketplaceRepos("not json", "acme/market"), []);
});

test("awesome lists: repo links in order, without the list itself or non-repo pages", () => {
  const md = "- [A](https://github.com/acme/a) - x\n- [B](https://github.com/acme/b.git)\n[topic](https://github.com/topics/mcp) [self](https://github.com/me/awesome) [sponsor](https://github.com/sponsors/acme)\n- https://github.com/acme/c/tree/main/src.";
  assert.deepEqual(linkedRepos(md, "me/awesome"), ["acme/a", "acme/b", "acme/c"]);
});

test("awesome discovery stops at the wanted number of unknown repos", async () => {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response("[a](https://github.com/acme/known) [b](https://github.com/acme/one) [c](https://github.com/acme/two) [d](https://github.com/acme/three)", { status: 200 });
  }) as typeof fetch;
  try {
    const found = await awesomeCandidates({ want: 2, isKnown: (k) => k === "acme/known", log: () => undefined }, ["me/list-a", "me/list-b"]);
    assert.deepEqual(found.map((c) => c.fullName), ["acme/known", "acme/one", "acme/two"]);
    assert.equal(urls.length, 1, "the second list is not fetched");
    assert.ok(urls[0].startsWith("https://raw.githubusercontent.com/me/list-a/HEAD/README.md"));
  } finally {
    globalThis.fetch = realFetch;
  }
});
