import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToml, tomlTableBlock } from "@/lib/toml-lite";
import { filterFrontmatter, namedPlaceholders, planMigration, MIGRATION_MARKER, type MigrationSnapshot } from "@/lib/agent-migration";

const CODEX_CONFIG = `
model = "gpt-5-codex" # comment
[mcp_servers.github]
command = "npx"
args = [
  "-y",
  "@modelcontextprotocol/server-github", # trailing comma next
]
env = { GITHUB_TOKEN = "ghp_secret" }
startup_timeout_sec = 20

[mcp_servers."linear-remote"]
url = 'https://mcp.linear.app/mcp'
bearer_token_env_var = "LINEAR_TOKEN"

[mcp_servers.off]
command = "x"
enabled = false
`;

const snap = (files: Record<string, string>, dirs: Record<string, string[]> = {}): MigrationSnapshot => ({ files, dirs });

test("toml-lite reads Codex configs and round-trips appended tables", () => {
  const t = parseToml(CODEX_CONFIG);
  assert.equal(t.model, "gpt-5-codex");
  const servers = t.mcp_servers as Record<string, Record<string, unknown>>;
  assert.deepEqual(servers.github.args, ["-y", "@modelcontextprotocol/server-github"]);
  assert.deepEqual(servers.github.env, { GITHUB_TOKEN: "ghp_secret" });
  assert.equal(servers["linear-remote"].url, "https://mcp.linear.app/mcp");
  assert.equal(parseToml('s = "a\\tb\\u00e9"\nm = """\nx\ny"""').s, "a\tbé");
  assert.throws(() => parseToml("a = 1\na = 2"), /Duplicate/);

  const block = tomlTableBlock(["mcp_servers", "my server"], { command: 'say "hi"', args: ["a"], env: { K: "v" } });
  assert.equal(block, '[mcp_servers."my server"]\ncommand = "say \\"hi\\""\nargs = ["a"]\nenv = { K = "v" }');
  assert.deepEqual(parseToml(block), { mcp_servers: { "my server": { command: 'say "hi"', args: ["a"], env: { K: "v" } } } });
});

test("codex → claude code: imports AGENTS.md, moves MCP without secrets, copies skills", () => {
  const plan = planMigration(
    { from: "codex", to: "claude-code", scope: "project" },
    snap({ "AGENTS.md": "# Rules\nUse pnpm.", "api/AGENTS.md": "API rules", ".codex/config.toml": CODEX_CONFIG }, { ".codex/skills": ["pdf/", "README.md"], ".claude/skills": [] }),
  );
  const byPath = Object.fromEntries(plan.ops.flatMap((o) => ("path" in o ? [[o.path, o]] : [])));
  assert.equal(byPath["CLAUDE.md"].kind, "create");
  assert.match((byPath["CLAUDE.md"] as { content: string }).content, /^@AGENTS\.md$/m);
  assert.equal(byPath["api/CLAUDE.md"].kind, "create");

  const mcp = JSON.parse((byPath[".mcp.json"] as { content: string }).content);
  assert.deepEqual(mcp.mcpServers.github, { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } });
  assert.deepEqual(mcp.mcpServers["linear-remote"], { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer ${LINEAR_TOKEN}" } });
  assert.equal(mcp.mcpServers.off, undefined, "disabled servers stay behind");
  assert.ok(!JSON.stringify(plan).includes("ghp_secret"), "secret values never leave the source config");
  assert.ok(plan.notes.some((n) => n.message.includes("GITHUB_TOKEN") && n.level === "warn"));
  assert.ok(plan.notes.some((n) => n.message.includes("startup_timeout_sec")));

  assert.deepEqual(
    plan.ops.filter((o) => o.kind === "copy-dir"),
    [{ kind: "copy-dir", from: ".codex/skills/pdf", to: ".claude/skills/pdf", what: "skill pdf" }],
  );
});

test("migration never overwrites and a second run is a no-op", () => {
  const opts = { from: "codex", to: "claude-code", scope: "project" } as const;
  const existing = { "AGENTS.md": "rules", "CLAUDE.md": "# Mine\n", ".codex/config.toml": CODEX_CONFIG, ".mcp.json": JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } }, other: 1 }) };
  const first = planMigration(opts, snap(existing, { ".codex/skills": ["pdf/"], ".claude/skills": ["pdf/"] }));
  const claude = first.ops.find((o) => "path" in o && o.path === "CLAUDE.md");
  assert.equal(claude?.kind, "append");
  const mcp = first.ops.find((o) => "path" in o && o.path === ".mcp.json") as { kind: string; content: string };
  assert.equal(mcp.kind, "update");
  const doc = JSON.parse(mcp.content);
  assert.deepEqual(doc.mcpServers.github, { command: "gh-mcp" }, "an existing server wins");
  assert.equal(doc.other, 1, "unrelated keys survive");
  assert.ok(doc.mcpServers["linear-remote"]);
  assert.equal(first.ops.filter((o) => o.kind === "copy-dir").length, 0);

  const applied = { ...existing, "CLAUDE.md": existing["CLAUDE.md"] + (claude as { content: string }).content, ".mcp.json": mcp.content };
  const second = planMigration(opts, snap(applied));
  assert.deepEqual(second.ops, []);
});

test("claude code → codex: copies CLAUDE.md text, converts servers to TOML, keeps variables by name", () => {
  const plan = planMigration(
    { from: "claude-code", to: "codex", scope: "project" },
    snap(
      {
        "CLAUDE.md": "# Project\nAlways test.\n@docs/style.md",
        ".mcp.json": JSON.stringify({
          mcpServers: {
            pg: { command: "uvx", args: ["pg-mcp"], env: { DB_URL: "${DB_URL}", MODE: "ro" } },
            sentry: { type: "http", url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "Bearer ${SENTRY}", "X-Org": "acme" } },
            old: { type: "sse", url: "https://x/sse" },
          },
        }),
        ".codex/config.toml": 'model = "o3"\n',
      },
      { ".claude/commands": ["fix.md"] },
    ),
  );
  const agents = plan.ops.find((o) => "path" in o && o.path === "AGENTS.md") as { kind: string; content: string };
  assert.equal(agents.kind, "create");
  assert.match(agents.content, new RegExp(`${MIGRATION_MARKER} from Claude Code: CLAUDE\\.md`));
  assert.match(agents.content, /Always test\./);

  const toml = plan.ops.find((o) => "path" in o && o.path === ".codex/config.toml") as { kind: string; content: string };
  assert.equal(toml.kind, "append");
  const parsed = parseToml('model = "o3"\n' + toml.content) as { mcp_servers: Record<string, unknown> };
  assert.deepEqual(parsed.mcp_servers.pg, { command: "uvx", args: ["pg-mcp"], env: { MODE: "ro" }, env_vars: ["DB_URL"] });
  assert.deepEqual(parsed.mcp_servers.sentry, { url: "https://mcp.sentry.dev/mcp", bearer_token_env_var: "SENTRY", http_headers: { "X-Org": "acme" } });
  assert.equal(parsed.mcp_servers.old, undefined);
  assert.ok(plan.notes.some((n) => n.message.includes("SSE")));
  assert.ok(plan.notes.some((n) => n.message.includes("@docs/style.md")));
  assert.ok(plan.notes.some((n) => n.message.includes("~/.codex/prompts")), "project commands have no Codex home");
});

test("user scope: prompts ⇄ commands keep supported frontmatter; Claude user MCP goes through `claude mcp`", () => {
  const toClaude = planMigration(
    { from: "codex", to: "claude-code", scope: "user" },
    snap(
      {
        "~/.codex/AGENTS.md": "global rules",
        "~/.codex/config.toml": '[mcp_servers.fs]\ncommand = "npx"\nargs = ["fs-mcp", "it\'s"]\n',
        "~/.codex/prompts/review.md": "---\ndescription: Review\nargument-hint: FILE=<path>\n---\nReview $FILE",
      },
      { "~/.codex/prompts": ["review.md"], "~/.claude/commands": [] },
    ),
  );
  const cmd = toClaude.ops.find((o) => "path" in o && o.path === "~/.claude/commands/review.md");
  assert.ok(cmd);
  assert.ok(toClaude.notes.some((n) => n.message.includes("$FILE")));
  const run = toClaude.ops.find((o) => o.kind === "run") as { command: string };
  assert.equal(run.command, `claude mcp add-json --scope user fs '{"command":"npx","args":["fs-mcp","it'\\''s"]}'`);
  assert.match((toClaude.ops.find((o) => "path" in o && o.path === "~/.claude/CLAUDE.md") as { content: string }).content, /^@~\/\.codex\/AGENTS\.md$/m);

  const toCodex = planMigration(
    { from: "claude-code", to: "codex", scope: "user" },
    snap({ "~/.claude/commands/fix.md": "---\ndescription: Fix\nallowed-tools: Bash(git:*)\nmodel: opus\n---\nFix $ARGUMENTS" }, { "~/.claude/commands": ["fix.md"] }),
  );
  const prompt = toCodex.ops.find((o) => "path" in o && o.path === "~/.codex/prompts/fix.md") as { content: string; what: string };
  assert.equal(prompt.content, "---\ndescription: Fix\n---\nFix $ARGUMENTS");
  assert.equal(prompt.what, "command → /prompts:fix");
});

test("frontmatter helpers", () => {
  assert.deepEqual(filterFrontmatter("no frontmatter", new Set()), { text: "no frontmatter", dropped: [] });
  assert.deepEqual(filterFrontmatter("---\nmodel: x\n---\nbody", new Set(["description"])), { text: "body", dropped: ["model"] });
  assert.deepEqual(filterFrontmatter("---\ndescription: >\n  long\n  text\nmodel: x\n---\nbody", new Set(["description"])).text, "---\ndescription: >\n  long\n  text\n---\nbody");
  assert.deepEqual(namedPlaceholders("Use $1 and $ARGUMENTS, then $TICKET_ID and $TICKET_ID"), ["TICKET_ID"]);
  assert.throws(() => planMigration({ from: "codex", to: "codex", scope: "project" }, snap({})));
});
