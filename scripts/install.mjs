#!/usr/bin/env node
// Synapth server installer.
//
//   node scripts/install.mjs [--yes] [--skip-typecheck] [--skip-db]
//                             [--database-url=...] [--auth-url=...] [--port=3000]
//
// Self-contained (no dependencies beyond Node itself): installs npm packages
// with a live progress bar, writes .env, syncs Prisma when a real database is
// configured, then verifies the install actually landed (files, packages,
// generated Prisma client, types). Linux and macOS only.

import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

if (flag("help") || flag("h")) {
  console.log(`Usage: node scripts/install.mjs [options]

  --yes                 non-interactive, accept defaults (in-memory DB unless --database-url)
  --database-url=<url>  PostgreSQL connection string
  --auth-url=<url>      public URL used by Auth.js (default http://localhost:<port>)
  --port=<n>            port baked into the default AUTH_URL (default 3000)
  --skip-db             skip the Prisma generate/db push step
  --skip-typecheck      skip "tsc --noEmit" during the integrity check
`);
  process.exit(0);
}

const YES = flag("yes") || flag("y");
const SKIP_DB = flag("skip-db");
const SKIP_TYPECHECK = flag("skip-typecheck");
const TTY = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

// ---------------------------------------------------------------------------
// Terminal UI kit — colors, spinner, progress bar. No dependencies so the
// installer runs on a bare server before anything else is on disk.
// ---------------------------------------------------------------------------

const paint = (code) => (s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
  gray: paint("90"),
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function renderLine(text) {
  if (TTY) process.stdout.write(`\r\x1b[2K${text}`);
  else process.stdout.write(`${text}\n`);
}

function elapsed(startMs) {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

function indent(text, prefix = "    ") {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/** Runs fn with a spinner in front of `title`; fn may call report(msg) to update the trailing detail. */
async function withSpinner(title, fn) {
  const start = Date.now();
  let detail = "";
  let frame = 0;
  const report = (msg) => {
    detail = msg;
  };

  if (!TTY) console.log(`${c.cyan("›")} ${title}`);
  const timer = TTY
    ? setInterval(() => {
        const tail = detail ? c.dim(` — ${detail}`) : "";
        renderLine(`${c.cyan(SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length])} ${title}${tail} ${c.dim(elapsed(start))}`);
      }, 80)
    : null;

  try {
    const result = await fn(report);
    if (timer) clearInterval(timer);
    renderLine(`${c.green("✓")} ${title} ${c.dim(elapsed(start))}${result?.note ? c.dim(`  — ${result.note}`) : ""}`);
    if (TTY) process.stdout.write("\n");
    return result;
  } catch (err) {
    if (timer) clearInterval(timer);
    renderLine(`${c.red("✗")} ${title}`);
    if (TTY) process.stdout.write("\n");
    throw err;
  }
}

function progressBar(percent, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `${c.cyan("█".repeat(filled))}${c.gray("░".repeat(width - filled))}`;
}

function fmtEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "…";
  if (seconds < 1) return "<1s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function estimateEta(samples, percent) {
  if (samples.length < 2 || percent <= 0 || percent >= 100) return Infinity;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = (last.t - first.t) / 1000;
  const dp = last.p - first.p;
  if (dp <= 0 || dt <= 0) return Infinity;
  return (100 - percent) / (dp / dt);
}

function banner() {
  const title = ` SYNAPTH · server installer `;
  const width = title.length + 2;
  console.log(c.cyan(`┌${"─".repeat(width)}┐`));
  console.log(c.cyan("│") + c.bold(title) + c.cyan(" │"));
  console.log(c.cyan(`└${"─".repeat(width)}┘`));
  console.log(c.dim(`v${pkg.version} · Node ${process.version} · ${os.platform() === "darwin" ? "macOS" : "Linux"} ${os.release()}`));
  console.log(c.dim("Установит зависимости, настроит .env и проверит целостность файлов.\n"));
}

async function ask(question, fallback) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = fallback ? c.dim(` [${fallback}] `) : " ";
  const answer = await new Promise((resolve) => rl.question(`${c.cyan("?")} ${question}${suffix}`, resolve));
  rl.close();
  return answer.trim() || fallback || "";
}

function run(cmd, cmdArgs, extraEnv) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
  } catch (err) {
    const tail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim().split("\n").slice(-8).join("\n");
    throw new Error(tail || err.message);
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function checkSystem() {
  const platform = os.platform();
  if (platform !== "linux" && platform !== "darwin") {
    throw new Error(`Платформа "${platform}" не поддерживается — нужен Linux или macOS.`);
  }

  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor < 20) {
    throw new Error(`Node.js 20+ требуется, установлен ${process.versions.node}.`);
  }

  for (const bin of ["npm", "git"]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
    } catch {
      throw new Error(`"${bin}" не найден в PATH.`);
    }
  }

  return { note: `${platform === "darwin" ? "macOS" : "Linux"}, Node ${process.versions.node}` };
}

/** Mirrors npm's os/cpu matching: positive entries require a match, "!x" entries exclude x. */
function matchesPlatformList(list, value) {
  if (!list || list.length === 0) return true;
  let hasPositive = false;
  for (const item of list) {
    if (item.startsWith("!")) {
      if (item.slice(1) === value) return false;
    } else {
      hasPositive = true;
      if (item === value) return true;
    }
  }
  return !hasPositive;
}

function installableOnThisPlatform(entry) {
  // "optional": true covers both other-OS/arch binaries (esbuild, rollup, @next/swc, ...)
  // and last-resort wasm fallbacks npm may skip once a native build is picked — neither
  // is required for the app to run, so neither belongs in the "did this install?" check.
  if (entry.optional) return false;
  return matchesPlatformList(entry.os, process.platform) && matchesPlatformList(entry.cpu, process.arch);
}

/** Top-level, non-optional package names npm is expected to install here. */
function readLockedTopLevelPackages() {
  const lockPath = path.join(ROOT, "package-lock.json");
  if (!fs.existsSync(lockPath)) return [];
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const names = new Set();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const match = key.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
    if (match && installableOnThisPlatform(entry ?? {})) names.add(match[1]);
  }
  return [...names];
}

function countInstalled(names) {
  return names.reduce((n, name) => n + (fs.existsSync(path.join(ROOT, "node_modules", name)) ? 1 : 0), 0);
}

async function installDependencies() {
  const expected = readLockedTopLevelPackages();
  const total = expected.length || 1;
  const nodeModules = path.join(ROOT, "node_modules");
  const lockPath = path.join(ROOT, "package-lock.json");

  const alreadyCurrent =
    fs.existsSync(nodeModules) &&
    fs.existsSync(lockPath) &&
    fs.statSync(nodeModules).mtimeMs >= fs.statSync(lockPath).mtimeMs &&
    countInstalled(expected) === total;

  const title = "Установка npm-зависимостей";
  if (alreadyCurrent) {
    renderLine(`${c.green("✓")} ${title} ${c.dim(`— уже актуальны (${total} пакетов)`)}`);
    if (TTY) process.stdout.write("\n");
    return;
  }

  const start = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const samples = [];
    const poll = setInterval(() => {
      const installed = countInstalled(expected);
      const percent = Math.min(99, Math.round((installed / total) * 100));
      samples.push({ t: Date.now(), p: percent });
      while (samples.length > 16) samples.shift();
      const eta = estimateEta(samples, percent);
      renderLine(
        `${c.cyan(SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length])} ${title} ` +
          `${progressBar(percent)} ${String(percent).padStart(3)}%  ` +
          `${c.dim(`${installed}/${total} пакетов · осталось ${fmtEta(eta)}`)}`
      );
    }, 250);

    child.on("error", (err) => {
      clearInterval(poll);
      reject(err);
    });
    child.on("exit", (code) => {
      clearInterval(poll);
      if (code === 0) {
        const installed = countInstalled(expected);
        renderLine(`${c.green("✓")} ${title} ${progressBar(100)} 100%  ${c.dim(`${installed}/${total} пакетов · ${elapsed(start)}`)}`);
        if (TTY) process.stdout.write("\n");
        resolve();
      } else {
        renderLine(`${c.red("✗")} ${title}`);
        if (TTY) process.stdout.write("\n");
        reject(new Error(stderr.trim().split("\n").slice(-8).join("\n") || `npm install завершился с кодом ${code}`));
      }
    });
  });
}

async function setupEnv(report) {
  const envPath = path.join(ROOT, ".env");
  const examplePath = path.join(ROOT, ".env.example");

  if (fs.existsSync(envPath)) return { note: ".env уже существует, не перезаписан" };

  report(".env.example → .env");
  let content = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";

  const secret = randomBytes(32).toString("base64");
  content = content.includes("AUTH_SECRET=")
    ? content.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET="${secret}"`)
    : `${content}\nAUTH_SECRET="${secret}"\n`;

  let databaseUrl = opt("database-url", "");
  let authUrl = opt("auth-url", `http://localhost:${opt("port", "3000")}`);

  if (TTY && !YES) {
    databaseUrl = await ask("PostgreSQL DATABASE_URL (пусто — in-memory сторе):", databaseUrl);
    authUrl = await ask("AUTH_URL:", authUrl);
  }

  content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`);
  content = content.replace(/^AUTH_URL=.*$/m, `AUTH_URL="${authUrl}"`);

  fs.writeFileSync(envPath, content);
  return { note: databaseUrl ? "создан, PostgreSQL настроен" : "создан, in-memory режим" };
}

function hasRealDatabaseUrl() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return false;
  return /^DATABASE_URL="postgres/m.test(fs.readFileSync(envPath, "utf8"));
}

async function syncDatabase(report) {
  if (SKIP_DB) return { note: "пропущено (--skip-db)" };

  report("prisma generate");
  run("npx", ["prisma", "generate"]);

  if (!hasRealDatabaseUrl()) return { note: "in-memory режим (DATABASE_URL не задан)" };

  report("prisma db push");
  run("npx", ["prisma", "db", "push", "--skip-generate"]);
  return { note: "схема применена к базе данных" };
}

async function verifyInstall(report) {
  const problems = [];

  report("структура каталогов");
  for (const dir of ["app", "cortex", "axon", "lib", "types", "components", "prisma"]) {
    if (!fs.existsSync(path.join(ROOT, dir))) problems.push(`нет каталога ${dir}/`);
  }

  report("пакеты node_modules");
  const expected = readLockedTopLevelPackages();
  const missing = expected.filter((name) => !fs.existsSync(path.join(ROOT, "node_modules", name)));
  if (missing.length) {
    const shown = missing.slice(0, 5).join(", ");
    problems.push(`не установлены пакеты: ${shown}${missing.length > 5 ? ` и ещё ${missing.length - 5}` : ""}`);
  }

  if (!SKIP_DB) {
    report("prisma client");
    if (!fs.existsSync(path.join(ROOT, "node_modules", ".prisma", "client", "index.js"))) {
      problems.push("Prisma client не сгенерирован (node_modules/.prisma/client)");
    }
  }

  report(".env");
  if (!fs.existsSync(path.join(ROOT, ".env"))) problems.push(".env отсутствует");

  if (!SKIP_TYPECHECK) {
    report("typecheck (tsc --noEmit)");
    try {
      run("npx", ["tsc", "--noEmit"]);
    } catch (err) {
      problems.push(`typecheck не прошёл:\n${indent(err.message)}`);
    }
  }

  if (problems.length) throw new Error(problems.join("\n"));
  return { note: SKIP_TYPECHECK ? "файлы и пакеты в порядке" : "файлы, пакеты и типы в порядке" };
}

// ---------------------------------------------------------------------------

async function main() {
  banner();
  try {
    await withSpinner("Проверка системы", checkSystem);
    const env = await withSpinner("Конфигурация .env", setupEnv);
    // Draws its own progress bar (live % + ETA), so it isn't wrapped in withSpinner.
    await installDependencies();
    await withSpinner("База данных / Prisma", syncDatabase);
    await withSpinner("Проверка целостности", verifyInstall);

    console.log(c.green(c.bold("Готово.")) + " Synapth установлен и проверен.\n");
    console.log(c.dim("Запуск:"));
    console.log(`  ${c.cyan("npm run build && npm start")}   ${c.dim("production")}`);
    console.log(`  ${c.cyan("./run.sh dev")}                 ${c.dim("dev-сервер")}`);
    if (env.note?.includes("in-memory")) {
      console.log(c.dim("\nDATABASE_URL не задан — приложение работает на in-memory сторе (данные не сохраняются между рестартами)."));
    }
  } catch (err) {
    console.error(`\n${c.red(c.bold("Установка прервана:"))}\n${indent(err.message)}\n`);
    process.exitCode = 1;
  }
}

main();
