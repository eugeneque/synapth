/**
 * Synapth CLI. Bundled by `scripts/build-cli.mjs` into a single
 * dependency-free file served at `/cli/synapth.mjs`:
 *
 *   curl -fsSL https://<host>/cli/synapth.mjs -o synapth.mjs
 *   node synapth.mjs migrate --from codex            # preview
 *   node synapth.mjs migrate --from codex --apply    # write
 *
 * Planning lives in `lib/agent-migration.ts`; this file only reads the
 * disk, prints the plan and applies it. Nothing is written without --apply.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AGENTS, planMigration, snapshotSpec, type AgentId, type MigrationOp, type MigrationOptions, type MigrationPlan, type MigrationScope, type MigrationSnapshot } from "../lib/agent-migration";

const VERSION = "0.1.0";

/** Directories never searched for nested instruction files. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", ".next", "dist", "build", "out", "target", "vendor", ".venv", "venv", "__pycache__", ".cache", ".turbo", "coverage"]);
const WALK_DEPTH = 6;
const WALK_LIMIT = 5000;

const TTY = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint("1"), dim: paint("2"), red: paint("31"), green: paint("32"), yellow: paint("33"), lime: paint("38;5;154") };

const AGENT_ALIASES: Record<string, AgentId> = { codex: "codex", claude: "claude-code", "claude-code": "claude-code", cc: "claude-code" };
const AGENT_LABEL: Record<AgentId, string> = { codex: "Codex", "claude-code": "Claude Code" };

const HELP = `${c.bold("synapth")} ${VERSION} — Synapth command line

${c.bold("Usage")}
  synapth migrate --from <agent> [--to <agent>] [--scope project|user] [--dir <path>] [--apply]
  synapth help | version

${c.bold("migrate")}  moves what one coding agent knows about your project into another
  agents     codex, claude (claude-code)
  --from     the agent you are leaving
  --to       the agent you are moving to (default: the other one)
  --scope    project (default): AGENTS.md/CLAUDE.md in every directory, .codex/config.toml ⇄ .mcp.json,
             project skills; user: ~/.codex ⇄ ~/.claude (instructions, MCP servers, prompts/commands, skills)
  --dir      project root (default: current directory)
  --apply    write the changes; without it the plan is only printed

Nothing is overwritten: instruction files get an appended block, configs get only
missing servers, existing commands and skills are kept. Secret values in env are
not copied — the migrated config references \${VAR} and the CLI lists what to export.
`;

interface Args {
  command: string | undefined;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      if (v !== undefined) flags.set(k, v);
      else if (argv[i + 1] && !argv[i + 1].startsWith("--") && !["apply", "help"].includes(k)) flags.set(k, argv[++i]);
      else flags.set(k, true);
    } else if (a === "-h") flags.set("help", true);
    else command ??= a;
  }
  return { command, flags };
}

function die(message: string): never {
  process.stderr.write(`${c.red("✗")} ${message}\n`);
  process.exit(1);
}

function agentFlag(value: string | true | undefined, name: string): AgentId | undefined {
  if (value === undefined) return undefined;
  const id = typeof value === "string" ? AGENT_ALIASES[value.toLowerCase()] : undefined;
  if (!id) die(`--${name} expects one of: ${Object.keys(AGENT_ALIASES).join(", ")}`);
  return id;
}

/** Path keys → disk: "~/.codex/…" honours $CODEX_HOME, other "~/" keys live in the home directory, the rest in the project. */
function resolver(root: string) {
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  return (key: string) => {
    if (key === "~/.codex" || key.startsWith("~/.codex/")) return path.join(codexHome, key.slice("~/.codex".length));
    if (key.startsWith("~/")) return path.join(home, key.slice(2));
    return path.join(root, key);
  };
}

function readText(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? fs.readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** Project-relative paths of every file named one of `names`, skipping dependency and build directories. */
function findNested(root: string, names: string[]): string[] {
  const out: string[] = [];
  let visited = 0;
  const walk = (rel: string, depth: number) => {
    if (depth > WALK_DEPTH || visited++ > WALK_LIMIT) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.isSymbolicLink()) walk(child, depth + 1);
      else if (e.isFile() && names.includes(e.name)) out.push(child);
    }
  };
  walk("", 0);
  return out;
}

function collect(opts: MigrationOptions, root: string, resolve: (key: string) => string): MigrationSnapshot {
  const spec = snapshotSpec(opts);
  const snap: MigrationSnapshot = { files: {}, dirs: {} };
  const keys = new Set([...spec.files, ...(spec.nested.length ? findNested(root, spec.nested) : [])]);
  for (const key of keys) {
    const text = readText(resolve(key));
    if (text !== undefined) snap.files[key] = text;
  }
  for (const dir of spec.dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(resolve(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    snap.dirs[dir] = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const text = readText(path.join(resolve(dir), e.name));
      if (text !== undefined) snap.files[`${dir}/${e.name}`] = text;
    }
  }
  return snap;
}

const OP_LABEL: Record<MigrationOp["kind"], string> = { create: "create", append: "append", update: "update", "copy-dir": "copy  ", run: "run   " };

function printPlan(plan: MigrationPlan, root: string) {
  const { from, to, scope } = plan.options;
  process.stdout.write(`\n${c.lime("●")} ${c.bold(`${AGENT_LABEL[from]} → ${AGENT_LABEL[to]}`)} ${c.dim(`· ${scope === "project" ? root : "user scope"}`)}\n\n`);
  if (!plan.ops.length) process.stdout.write(`  ${c.dim("nothing to move")}\n`);
  for (const op of plan.ops) {
    const target = op.kind === "copy-dir" ? `${op.from} → ${op.to}` : op.kind === "run" ? op.command : op.path;
    process.stdout.write(`  ${c.green(OP_LABEL[op.kind])}  ${target}  ${c.dim(op.what)}\n`);
  }
  if (plan.notes.length) process.stdout.write("\n");
  for (const n of plan.notes) process.stdout.write(`  ${n.level === "warn" ? c.yellow("!") : c.dim("·")} ${n.level === "warn" ? n.message : c.dim(n.message)}\n`);
  process.stdout.write("\n");
}

function apply(plan: MigrationPlan, snap: MigrationSnapshot, resolve: (key: string) => string): number {
  let failed = 0;
  const fail = (op: MigrationOp, why: string) => {
    failed++;
    process.stdout.write(`  ${c.red("✗")} ${op.kind === "run" ? op.command : op.kind === "copy-dir" ? op.to : op.path}: ${why}\n`);
  };
  for (const op of plan.ops) {
    try {
      if (op.kind === "create") {
        const file = resolve(op.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, op.content, { flag: "wx" });
      } else if (op.kind === "append" || op.kind === "update") {
        const file = resolve(op.path);
        // The plan was made from what was read; a file changed since then is left alone.
        if (readText(file) !== snap.files[op.path]) {
          fail(op, "changed since it was read — rerun the migration");
          continue;
        }
        if (op.kind === "append") fs.appendFileSync(file, op.content);
        else fs.writeFileSync(file, op.content);
      } else if (op.kind === "copy-dir") {
        fs.cpSync(resolve(op.from), resolve(op.to), { recursive: true, errorOnExist: true, force: false });
      } else {
        const res = spawnSync("sh", ["-c", op.command], { stdio: "inherit" });
        if (res.status !== 0) {
          fail(op, "failed — run it by hand");
          continue;
        }
      }
      process.stdout.write(`  ${c.green("✓")} ${op.what}\n`);
    } catch (e) {
      fail(op, e instanceof Error ? e.message : String(e));
    }
  }
  return failed;
}

function migrate(flags: Map<string, string | true>) {
  const from = agentFlag(flags.get("from"), "from") ?? die("--from is required (codex or claude)");
  const to = agentFlag(flags.get("to"), "to") ?? (AGENTS.find((a) => a !== from) as AgentId);
  if (from === to) die("--from and --to must differ");
  const scopeFlag = flags.get("scope") ?? "project";
  if (scopeFlag !== "project" && scopeFlag !== "user") die("--scope expects project or user");
  const scope: MigrationScope = scopeFlag;
  const dirFlag = flags.get("dir");
  const root = path.resolve(typeof dirFlag === "string" ? dirFlag : process.cwd());
  if (!fs.existsSync(root)) die(`${root} does not exist`);

  const opts: MigrationOptions = { from, to, scope };
  const resolve = resolver(root);
  const snap = collect(opts, root, resolve);
  const plan = planMigration(opts, snap);
  printPlan(plan, root);

  if (!plan.ops.length) return;
  if (flags.get("apply") !== true) {
    process.stdout.write(`${c.dim("Preview only. Apply with:")} synapth migrate --from ${flags.get("from")}${flags.has("to") ? ` --to ${flags.get("to")}` : ""}${scope === "user" ? " --scope user" : ""}${dirFlag ? ` --dir ${dirFlag}` : ""} --apply\n`);
    return;
  }
  const failed = apply(plan, snap, resolve);
  process.stdout.write(failed ? `\n${c.red(`${failed} step(s) failed.`)}\n` : `\n${c.lime("●")} Done. Open the project in ${AGENT_LABEL[to]}.\n`);
  if (failed) process.exitCode = 1;
}

function main(argv: string[]) {
  const { command, flags } = parseArgs(argv);
  if (command === "version" || flags.has("version")) return void process.stdout.write(`${VERSION}\n`);
  if (!command || command === "help" || flags.has("help")) return void process.stdout.write(HELP);
  if (command === "migrate") return migrate(flags);
  die(`Unknown command "${command}". Run: synapth help`);
}

main(process.argv.slice(2));
