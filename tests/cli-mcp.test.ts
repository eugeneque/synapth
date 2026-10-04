/**
 * The CLI's local MCP server (`synapth mcp serve`) against a fake Synapth API:
 * JSON-RPC over stdio, approval through elicitation, MCP roots, and the
 * guards that keep an agent (or a hostile server) inside the project.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const CLI = path.resolve("public/cli/synapth.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "synapth-mcp-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

interface Seen {
  installs: Array<Record<string, unknown>>;
}

function inlineBundle(slug: string, dir = slug) {
  return {
    id: `skl_${slug}`,
    slug,
    name: `Skill ${slug}`,
    version: "1.0.0",
    securityLevel: "Verified",
    env: ["API_TOKEN"],
    actions: [
      { kind: "skill", dir, source: { type: "inline", files: [{ path: "SKILL.md", content: `---\nname: ${slug}\n---\nhello\n` }] } },
      { kind: "mcp", name: `${slug}-mcp`, server: { transport: "stdio", command: "npx", args: ["-y", "@acme/x"] } },
    ],
  };
}

async function fakeApi(seen: Seen): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== "Bearer sdt_test") return send(401, { error: "no", code: "device_invalid" });
    if (req.url === "/api/v1/cli/install") {
      const input = JSON.parse(body);
      seen.installs.push(input);
      if (input.slug === "sandboxed") return send(422, { error: "agents cannot install Sandbox", code: "not_installable", reason: "sandbox" });
      if (input.slug === "evil") return send(200, { installed: [inlineBundle("evil", "../../outside")], skipped: [], usage: { installsToday: 1, installsPerDay: 15 } });
      return send(200, { installed: [inlineBundle(input.slug)], skipped: [], usage: { installsToday: seen.installs.length, installsPerDay: 15 } });
    }
    if (req.url === "/api/v1/cli/status") {
      return send(200, { user: { handle: "demo" }, plan: { id: "free", lapsedFrom: null }, usage: { installsToday: 0, devices: 1 }, limits: { installsPerDay: 15, devices: 1, bulk: false }, resetAt: "2026-10-05T00:00:00.000Z", device: { suspended: false }, notices: [], cli: { latest: "0.2.0" }, links: { billing: "x", devices: "y" } });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
}

class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private waiting = new Map<number, (m: Record<string, unknown>) => void>();
  private id = 0;
  /** How the fake agent answers the server's own requests (elicitation, roots). */
  onRequest: (method: string, params: Record<string, unknown>) => unknown = () => ({});
  readonly serverRequests: string[] = [];

  constructor(home: string, cwd: string, apiUrl: string) {
    this.proc = spawn(process.execPath, [CLI, "mcp", "serve"], { cwd, env: { ...process.env, HOME: home, SYNAPTH_HOME: path.join(home, ".synapth"), SYNAPTH_URL: apiUrl, GITHUB_TOKEN: "unused" } });
    readline.createInterface({ input: this.proc.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method) {
        this.serverRequests.push(msg.method);
        this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: this.onRequest(msg.method, msg.params) })}\n`);
        return;
      }
      this.waiting.get(msg.id)?.(msg);
    });
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async tool(name: string, args: Record<string, unknown>) {
    const res = await this.call("tools/call", { name, arguments: args });
    return { text: res.result.content[0].text as string, isError: res.result.isError as boolean, data: res.result.structuredContent };
  }

  close() {
    this.proc.stdin.end();
  }
}

function sandbox(name: string) {
  const home = path.join(root, name, "home");
  const project = path.join(root, name, "project");
  fs.mkdirSync(path.join(home, ".synapth"), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(home, ".synapth/config.json"), JSON.stringify({ machineId: "m-test", token: "sdt_test" }));
  return { home, project };
}

test("handshake: protocol negotiation, six tools with annotations, unknown methods", async () => {
  const seen: Seen = { installs: [] };
  const { server, url } = await fakeApi(seen);
  const { home, project } = sandbox("handshake");
  const client = new McpClient(home, project, url);
  const init = await client.call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(init.result.serverInfo.name, "synapth");
  const { result } = await client.call("tools/list");
  const names = result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names, ["recommend_skills", "search_skills", "install_skill", "list_installed_skills", "uninstall_skill", "synapth_status"]);
  assert.equal(result.tools.find((t: { name: string }) => t.name === "uninstall_skill").annotations.destructiveHint, true);
  assert.equal((await client.call("nope/nope")).error.code, -32601);
  client.close();
  server.close();
});

test("install asks through elicitation: decline writes nothing and spends no quota, accept installs into the project", async () => {
  const seen: Seen = { installs: [] };
  const { server, url } = await fakeApi(seen);
  const { home, project } = sandbox("elicit");
  const client = new McpClient(home, project, url);
  await client.call("initialize", { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "claude-code", version: "2" } });

  client.onRequest = (method) => (method === "elicitation/create" ? { action: "decline" } : {});
  const declined = await client.tool("install_skill", { slug: "pg" });
  assert.match(declined.text, /declined/);
  assert.equal(seen.installs.length, 0, "the server is not asked before the user approves");
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);

  client.onRequest = (method) => (method === "elicitation/create" ? { action: "accept", content: { approve: true } } : {});
  const ok = await client.tool("install_skill", { slug: "pg" });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(seen.installs[0].via, "mcp", "the server learns the agent asked");
  assert.equal(seen.installs[0].allowSandbox, false);
  assert.equal(fs.readFileSync(path.join(project, ".claude/skills/pg/SKILL.md"), "utf8").includes("hello"), true);
  const mcp = JSON.parse(fs.readFileSync(path.join(project, ".mcp.json"), "utf8"));
  assert.deepEqual(mcp.mcpServers["pg-mcp"], { command: "npx", args: ["-y", "@acme/x"] });
  assert.match(ok.text, /API_TOKEN/);
  assert.match(ok.text, /restart/i);

  const listed = await client.tool("list_installed_skills", {});
  assert.match(listed.text, /pg v1\.0\.0/);
  const removed = await client.tool("uninstall_skill", { slug: "pg" });
  assert.match(removed.text, /Removed/);
  assert.equal(fs.existsSync(path.join(project, ".claude/skills/pg")), false);
  client.close();
  server.close();
});

test("the project comes from MCP roots when the client offers them", async () => {
  const seen: Seen = { installs: [] };
  const { server, url } = await fakeApi(seen);
  const { home, project } = sandbox("roots");
  const other = path.join(root, "roots", "real-project");
  fs.mkdirSync(other, { recursive: true });
  const client = new McpClient(home, project, url);
  client.onRequest = (method) => (method === "roots/list" ? { roots: [{ uri: pathToFileURL(other).href, name: "real" }] } : {});
  await client.call("initialize", { protocolVersion: "2025-06-18", capabilities: { roots: {} }, clientInfo: { name: "cursor-vscode", version: "1" } });
  const res = await client.tool("install_skill", { slug: "kit" });
  assert.equal(res.isError, false, res.text);
  assert.ok(client.serverRequests.includes("roots/list"));
  assert.equal(seen.installs[0].target, "cursor", "the agent is inferred from clientInfo");
  assert.ok(fs.existsSync(path.join(other, ".cursor/skills/kit/SKILL.md")));
  assert.ok(fs.existsSync(path.join(other, ".cursor/mcp.json")));
  assert.equal(fs.existsSync(path.join(project, ".cursor")), false);
  client.close();
  server.close();
});

test("guards: no user-wide installs by default, Sandbox refusals pass through, a hostile bundle cannot escape", async () => {
  const seen: Seen = { installs: [] };
  const { server, url } = await fakeApi(seen);
  const { home, project } = sandbox("guards");
  const client = new McpClient(home, project, url);
  await client.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } });

  const global = await client.tool("install_skill", { slug: "pg", scope: "global" });
  assert.equal(global.isError, true);
  assert.match(global.text, /mcp-global/);
  assert.equal(seen.installs.length, 0);

  const sandboxed = await client.tool("install_skill", { slug: "sandboxed" });
  assert.equal(sandboxed.isError, true);
  assert.match(sandboxed.text, /Sandbox/);

  const evil = await client.tool("install_skill", { slug: "evil" });
  assert.match(evil.text, /FAILED/);
  assert.equal(fs.existsSync(path.join(root, "guards", "outside")), false, "nothing lands outside the skills directory");

  const bad = await client.tool("install_skill", { slug: "../../etc" });
  assert.equal(bad.isError, true);
  client.close();
  server.close();
});

test("plain output when not on a terminal: no escape codes, help and version", () => {
  const help = spawnSync(process.execPath, [CLI, "help"], { encoding: "utf8", env: { ...process.env, SYNAPTH_HOME: path.join(root, "plain") } });
  assert.equal(help.status, 0);
  assert.doesNotMatch(help.stdout, /\x1b\[/);
  assert.match(help.stdout, /recommend/);
  const version = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
