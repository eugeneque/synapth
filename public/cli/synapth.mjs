#!/usr/bin/env node
/**
 * Synapth CLI — links this machine to a Synapth account, installs catalogue
 * entries (skills, MCP servers, skillsets) into local agents, and runs the
 * local Synapth MCP server through which those agents install skills
 * themselves.
 *
 *   curl -fsSL https://<synapth>/cli/install | sh
 *   synapth setup                 # link, pick an agent, connect Synapth MCP
 *   synapth install <slug>        # or just `synapth` for the interactive menu
 *
 * Zero dependencies, Node 18+. The server decides plan, quota and trust; this
 * file renders its answers and applies install bundles, which are data
 * (directories to copy, `mcpServers` entries) — nothing from the server is
 * ever executed as shell. In `mcp serve` mode stdout belongs to JSON-RPC and
 * every human-facing line goes to stderr.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const VERSION = "0.2.0";
const HOME = process.env.SYNAPTH_HOME || path.join(os.homedir(), ".synapth");
const CONFIG = path.join(HOME, "config.json");
const STATE = path.join(HOME, "installed.json");
const TARGETS = ["claude-code", "cursor", "claude-desktop"];
const TARGET_LABEL = { "claude-code": "Claude Code", cursor: "Cursor", "claude-desktop": "Claude Desktop" };
const env = process.env;

let MCP_MODE = false;
let ARGS = { _: [] };
let CFG = {};

// ===========================================================================
// Terminal UI
// ===========================================================================

const isTTY = () => !MCP_MODE && Boolean(process.stdout.isTTY);
const colorOn = () => isTTY() && !("NO_COLOR" in env) && env.TERM !== "dumb";
const animOn = () => colorOn() && !env.CI && env.SYNAPTH_NO_ANIM !== "1" && CFG.animations !== false;
const interactive = () => isTTY() && Boolean(process.stdin.isTTY) && !env.CI && !ARGS.yes;
const TRUECOLOR = /truecolor|24bit/i.test(env.COLORTERM || "") || ["iTerm.app", "vscode", "WezTerm", "ghostty"].includes(env.TERM_PROGRAM || "");

function rgb([r, g, b]) {
  if (!colorOn()) return "";
  if (TRUECOLOR) return `\x1b[38;2;${r};${g};${b}m`;
  const q = (v) => Math.round((v / 255) * 5);
  return `\x1b[38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
}
const sgr = (code) => (s) => (colorOn() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  dim: sgr("2"),
  bold: sgr("1"),
  italic: sgr("3"),
  inverse: sgr("7"),
  red: sgr("91"),
  yellow: sgr("93"),
  cyan: sgr("96"),
  magenta: sgr("95"),
  lime: (s) => (colorOn() ? `${rgb([198, 244, 50])}${s}\x1b[0m` : String(s)),
};

/** The Synapth lime, dark → light. */
const LIME = [
  [104, 200, 64],
  [198, 244, 50],
  [240, 255, 160],
];

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function gradient(text, stops = LIME, offset = 0) {
  if (!colorOn() || !text) return text;
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  return (
    chars
      .map((ch, i) => {
        if (ch === " ") return ch;
        // Triangle wave: the shimmer can loop without a seam.
        const raw = (i / n / 1.6 + offset) % 1;
        const t = 1 - Math.abs(2 * raw - 1);
        const seg = t * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(seg));
        const f = seg - k;
        return rgb([0, 1, 2].map((j) => lerp(stops[k][j], stops[k + 1][j], f))) + ch;
      })
      .join("") + "\x1b[0m"
  );
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (s) => String(s).replace(ANSI, "");
const visibleLength = (s) => [...stripAnsi(s)].length;

/** Cuts a line to `width` visible characters, keeping escape codes intact. */
function fit(s, width) {
  if (visibleLength(s) <= width) return s;
  let out = "";
  let vis = 0;
  const re = /\x1b\[[0-9;?]*[A-Za-z]/y;
  for (let i = 0; i < s.length; ) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (m) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    if (vis >= width - 1) {
      out += "…";
      break;
    }
    out += ch;
    vis++;
    i += ch.length;
  }
  return out + (colorOn() ? "\x1b[0m" : "");
}

function wrap(text, width) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (line && visibleLength(line) + 1 + visibleLength(word) > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

const print = (s = "") => (MCP_MODE ? process.stderr : process.stdout).write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sym = {
  get ok() {
    return c.lime("✔");
  },
  get fail() {
    return c.red("✖");
  },
  get warn() {
    return c.yellow("▲");
  },
  get info() {
    return c.cyan("●");
  },
  get arrow() {
    return c.lime("❯");
  },
};
const warn = (s) => print(`${sym.warn} ${s}`);

let cursorHidden = false;
const hideCursor = () => {
  if (isTTY() && !cursorHidden) {
    process.stdout.write("\x1b[?25l");
    cursorHidden = true;
  }
};
const showCursor = () => {
  if (cursorHidden) {
    process.stdout.write("\x1b[?25h");
    cursorHidden = false;
  }
};
process.on("exit", showCursor);
process.on("SIGINT", () => {
  showCursor();
  if (!MCP_MODE) process.stdout.write("\n");
  process.exit(130);
});

/** A region of the terminal that is redrawn in place. */
class Live {
  lines = 0;
  render(text) {
    const cols = process.stdout.columns || 80;
    const rows = String(text)
      .split("\n")
      .map((l) => fit(l, cols - 1));
    process.stdout.write(`${this.lines ? `\x1b[${this.lines}A` : ""}\r\x1b[0J${rows.join("\n")}\n`);
    this.lines = rows.length;
  }
  clear() {
    if (this.lines) process.stdout.write(`\x1b[${this.lines}A\r\x1b[0J`);
    this.lines = 0;
  }
  done(text) {
    this.clear();
    if (text) print(text);
  }
}

const FRAMES = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  /** A signal travelling between two nodes — for talking to Synapth. */
  synapse: (i) => {
    const p = i % 7;
    return `◉${[0, 1, 2, 3, 4].map((k) => (k === p ? "●" : k === p - 1 ? "•" : "─")).join("")}${p >= 5 ? "◉" : "○"}`;
  },
};

function spinner(text, { frames = FRAMES.dots, interval = 80 } = {}) {
  let label = text;
  if (!animOn()) {
    return {
      set: (t) => (label = t),
      succeed: (t = label) => print(`${sym.ok} ${t}`),
      fail: (t = label) => print(`${sym.fail} ${t}`),
      warn: (t = label) => print(`${sym.warn} ${t}`),
      stop: () => {},
    };
  }
  const live = new Live();
  let i = 0;
  hideCursor();
  const tick = () => {
    const f = typeof frames === "function" ? frames(i) : frames[i % frames.length];
    live.render(`${gradient(f, LIME, i * 0.05)} ${label}`);
    i++;
  };
  tick();
  const id = setInterval(tick, interval);
  const end = (line) => {
    clearInterval(id);
    live.done(line);
    showCursor();
  };
  return {
    set: (t) => (label = t),
    succeed: (t = label) => end(`${sym.ok} ${t}`),
    fail: (t = label) => end(`${sym.fail} ${t}`),
    warn: (t = label) => end(`${sym.warn} ${t}`),
    stop: () => end(""),
  };
}

/** Runs `fn` under a spinner; the spinner turns into ✔ / ✖. */
async function step(text, fn, { done, frames } = {}) {
  const s = spinner(text, { frames });
  try {
    const result = await fn(s);
    s.succeed(typeof done === "function" ? done(result) : (done ?? text));
    return result;
  } catch (err) {
    s.fail(c.red(stripAnsi(text)));
    throw err;
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
function bar(ratio, width = 24) {
  const r = Math.max(0, Math.min(1, ratio));
  const full = Math.floor(r * width);
  const part = full < width ? PARTIAL[Math.floor((r * width - full) * 8)] : "";
  const empty = "░".repeat(Math.max(0, width - full - (part ? 1 : 0)));
  return `${c.dim("▕")}${gradient("█".repeat(full) + part)}${c.dim(empty)}${c.dim("▏")}`;
}

const UNLIMITED = 1_000_000_000;
const limitLabel = (n) => (n >= UNLIMITED ? "∞" : String(n));

/** used/total as a coloured meter: lime, then yellow past 60 %, red past 90 %. */
function meter(used, total, width = 18) {
  if (total >= UNLIMITED) return `${c.lime("∞")} ${c.dim(`${used} used`)}`;
  const r = total ? used / total : 1;
  const tone = r >= 0.9 ? c.red : r >= 0.6 ? c.yellow : c.lime;
  const full = Math.round(Math.min(1, r) * width);
  return `${c.dim("▕")}${tone("█".repeat(full))}${c.dim("░".repeat(width - full))}${c.dim("▏")} ${tone(`${used}/${total}`)}`;
}

function progressBar(label, total, { unit = "" } = {}) {
  let cur = 0;
  let bytes = 0;
  const t0 = Date.now();
  let last = 0;
  const live = animOn() ? new Live() : null;
  if (live) hideCursor();
  const draw = (force) => {
    if (!live) return;
    const now = Date.now();
    if (!force && now - last < 40) return;
    last = now;
    const ratio = total ? cur / total : 1;
    const rate = bytes / Math.max(0.2, (now - t0) / 1000);
    live.render(`${label} ${bar(ratio, 24)} ${c.bold(`${String(Math.round(ratio * 100)).padStart(3)}%`)} ${c.dim(`${cur}/${total}${unit} · ${fmtBytes(bytes)} · ${fmtBytes(rate)}/s`)}`);
  };
  draw(true);
  const finish = (line) => {
    if (live) {
      live.done(line);
      showCursor();
    } else print(line);
  };
  return {
    tick(n = 1, b = 0) {
      cur = Math.min(total, cur + n);
      bytes += b;
      draw(false);
    },
    done: (text) => {
      cur = total;
      draw(true);
      finish(`${sym.ok} ${text}`);
    },
    fail: (text) => finish(`${sym.fail} ${text}`),
  };
}

function box(lines, { title = "", color = c.lime } = {}) {
  const cols = Math.min(process.stdout.columns || 80, 96);
  const body = lines.filter((l) => l !== null && l !== undefined && l !== false).flatMap((l) => wrap(l, cols - 6));
  const t = visibleLength(title);
  const inner = Math.min(cols - 4, Math.max(t + 4, ...body.map(visibleLength), 20));
  const top = title ? `${color("╭─")} ${c.bold(title)} ${color("─".repeat(Math.max(0, inner - t - 2)) + "─╮")}` : color(`╭${"─".repeat(inner + 2)}╮`);
  const rows = body.map((l) => `${color("│")} ${fit(l, inner)}${" ".repeat(Math.max(0, inner - visibleLength(l)))} ${color("│")}`);
  return [top, ...rows, color(`╰${"─".repeat(inner + 2)}╯`)].join("\n");
}

const LOGO = ["█▀ █▄█ █▄ █ ▄▀█ █▀█ ▀█▀ █ █", "▄█  █  █ ▀█ █▀█ █▀▀  █  █▀█"];

async function banner(sub = "skills · MCP servers · agents") {
  const tag = `${c.dim(sub)}  ${c.dim(`v${VERSION}`)}`;
  if (!colorOn()) return print(`synapth ${VERSION} — ${sub}\n`);
  if (!animOn()) return print(["", ...LOGO.map((l) => `  ${gradient(l)}`), `  ${tag}`, ""].join("\n"));
  const live = new Live();
  hideCursor();
  const width = LOGO[0].length;
  for (let f = 0; f <= 16; f++) {
    const reveal = Math.min(width, Math.round((f / 10) * width));
    live.render(["", ...LOGO.map((l) => `  ${gradient(l.slice(0, reveal), LIME, f * 0.06)}`), f > 10 ? `  ${tag}` : ""].join("\n"));
    await sleep(26);
  }
  live.done(["", ...LOGO.map((l) => `  ${gradient(l)}`), `  ${tag}`, ""].join("\n"));
  showCursor();
}

/** A short burst of sparks that settles into a ✔ line. */
async function sparkle(text) {
  if (!animOn()) return print(`${sym.ok} ${c.bold(text)}`);
  const live = new Live();
  hideCursor();
  const sparks = ["✦", "✧", "⋆", "·", "˚"];
  for (let f = 0; f < 12; f++) {
    const pad = (n) => Array.from({ length: n }, () => (Math.random() < 0.45 ? sparks[Math.floor(Math.random() * sparks.length)] : " ")).join("");
    live.render(`${gradient(pad(4), LIME, f * 0.1)} ${c.bold(gradient(text, LIME, f * 0.08))} ${gradient(pad(4), LIME, f * 0.1 + 0.5)}`);
    await sleep(45);
  }
  live.done(`${sym.ok} ${c.bold(text)}`);
  showCursor();
}

function trustBadge(level) {
  if (level === "Verified" || level === "Certified") return c.lime(`◆ ${level}`);
  if (level === "Gov") return c.magenta(`◆ ${level}`);
  if (level === "Community") return c.cyan(`◇ ${level}`);
  if (level === "Sandbox") return c.yellow(`▲ ${level}`);
  return c.dim(level ?? "");
}

const planLabel = (id) => ({ free: "Free", pro: "Pro", team: "Team", business: "Business" })[id] ?? id;

function tilde(p) {
  const rel = path.relative(process.cwd(), p);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return `./${rel}`;
  return p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p;
}

// ---------------------------------------------------------------------------
// Prompts (raw-mode keyboard input)
// ---------------------------------------------------------------------------

function ensureInteractive(what) {
  if (!interactive()) throw new CliFail(`"${what}" needs an interactive terminal`, "Pass the value as an argument — see synapth help");
}

function runPrompt({ start, key, stop }) {
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setRawMode(true);
  stdin.resume();
  hideCursor();
  const live = new Live();
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      stop?.();
      stdin.off("keypress", onKey);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      showCursor();
    };
    const ctx = {
      render: (s) => !finished && live.render(s),
      finish: (line, value) => {
        cleanup();
        live.done(line);
        resolve(value);
      },
      cancel: (line) => {
        cleanup();
        live.done(line);
        const err = new CliFail("Cancelled");
        err.code = "cancelled";
        reject(err);
      },
    };
    function onKey(str, k = {}) {
      if (k.ctrl && k.name === "c") return ctx.cancel(`${sym.fail} ${c.dim("cancelled")}`);
      try {
        key(str, k, ctx);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }
    stdin.on("keypress", onKey);
    start(ctx);
  });
}

const printable = (str, k) => str && !k.ctrl && !k.meta && str.length === 1 && str >= " " && str !== "\x7f";
const question = (message) => `${c.cyan("?")} ${c.bold(message)}`;
const answered = (message, value) => `${sym.ok} ${c.bold(message)} ${c.dim("·")} ${c.lime(value)}`;

function choiceRows(list, idx, pageSize, { checked } = {}) {
  const start = Math.max(0, Math.min(idx - Math.floor(pageSize / 2), list.length - pageSize));
  const rows = list.slice(start, start + pageSize).map((ch, k) => {
    const active = start + k === idx;
    const box = checked ? (checked.has(ch.value) ? c.lime("◉ ") : c.dim("○ ")) : "";
    const label = ch.disabled ? c.dim(ch.label) : active ? c.bold(ch.label) : ch.label;
    const note = typeof ch.disabled === "string" ? `  ${c.dim(`(${ch.disabled})`)}` : ch.hint ? `  ${c.dim(ch.hint)}` : "";
    return `${active ? sym.arrow : " "} ${box}${label}${note}`;
  });
  if (list.length > pageSize) rows.push(c.dim(`  ${start > 0 ? "↑" : " "} ${idx + 1}/${list.length} ${start + pageSize < list.length ? "↓" : ""}`));
  return rows;
}

async function select({ message, choices, initial = 0, pageSize = 8, filter = true }) {
  ensureInteractive(message);
  let q = "";
  let idx = Math.max(0, initial);
  const visible = () => (q ? choices.filter((ch) => stripAnsi(`${ch.label} ${ch.hint ?? ""} ${ch.value}`).toLowerCase().includes(q.toLowerCase())) : choices);
  const draw = (ctx) => {
    const list = visible();
    idx = Math.min(idx, Math.max(0, list.length - 1));
    ctx.render([`${question(message)}${q ? `  ${c.lime(q)}${c.dim("▏")}` : ""}`, ...(list.length ? choiceRows(list, idx, pageSize) : [c.dim("  no match")]), c.dim(`  ↑↓ move · enter select${filter ? " · type to filter" : ""} · esc cancel`)].join("\n"));
  };
  return runPrompt({
    start: draw,
    key(str, k, ctx) {
      const list = visible();
      const n = Math.max(1, list.length);
      if (k.name === "up" || (k.ctrl && k.name === "p")) idx = (idx - 1 + n) % n;
      else if (k.name === "down" || k.name === "tab" || (k.ctrl && k.name === "n")) idx = (idx + 1) % n;
      else if (k.name === "return") {
        const ch = list[idx];
        if (ch && !ch.disabled) return ctx.finish(answered(message, stripAnsi(ch.label)), ch.value);
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim("· cancelled")}`);
      else if (k.name === "backspace") {
        q = q.slice(0, -1);
        idx = 0;
      } else if (filter && printable(str, k)) {
        q += str;
        idx = 0;
      }
      draw(ctx);
    },
  });
}

async function multiselect({ message, choices, pageSize = 8, allowEmpty = false }) {
  ensureInteractive(message);
  let idx = 0;
  let error = "";
  const picked = new Set(choices.filter((ch) => ch.checked && !ch.disabled).map((ch) => ch.value));
  const draw = (ctx) =>
    ctx.render([question(message), ...choiceRows(choices, idx, pageSize, { checked: picked }), error ? `  ${c.red(error)}` : c.dim("  ↑↓ move · space toggle · a all · enter confirm")].join("\n"));
  return runPrompt({
    start: draw,
    key(str, k, ctx) {
      error = "";
      const n = choices.length;
      if (k.name === "up") idx = (idx - 1 + n) % n;
      else if (k.name === "down" || k.name === "tab") idx = (idx + 1) % n;
      else if (k.name === "space") {
        const ch = choices[idx];
        if (!ch.disabled) picked.has(ch.value) ? picked.delete(ch.value) : picked.add(ch.value);
      } else if (str === "a") {
        const all = choices.filter((ch) => !ch.disabled);
        if (all.every((ch) => picked.has(ch.value))) picked.clear();
        else all.forEach((ch) => picked.add(ch.value));
      } else if (k.name === "return") {
        if (!picked.size && !allowEmpty) error = "Pick at least one (space)";
        else {
          const values = choices.filter((ch) => picked.has(ch.value));
          return ctx.finish(answered(message, values.length ? values.map((v) => stripAnsi(v.label)).join(", ") : "none"), values.map((v) => v.value));
        }
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim("· cancelled")}`);
      draw(ctx);
    },
  });
}

async function confirm({ message, initial = true }) {
  ensureInteractive(message);
  let v = initial;
  const draw = (ctx) => ctx.render(`${question(message)}  ${v ? c.inverse(c.lime(" Yes ")) : c.dim(" Yes ")} ${v ? c.dim(" No ") : c.inverse(" No ")}  ${c.dim("y/n")}`);
  return runPrompt({
    start: draw,
    key(str, k, ctx) {
      if (["left", "right", "tab", "h", "l"].includes(k.name)) v = !v;
      else if (str === "y" || str === "Y") v = true;
      else if (str === "n" || str === "N") v = false;
      else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim("· cancelled")}`);
      if (k.name === "return" || /^[yYnN]$/.test(str ?? "")) return ctx.finish(answered(message, v ? "yes" : "no"), v);
      draw(ctx);
    },
  });
}

async function input({ message, mask = false, placeholder = "", validate, initial = "" }) {
  ensureInteractive(message);
  let v = initial;
  let error = "";
  const shown = () => (mask ? c.lime("•".repeat(Math.min(v.length, 40))) : v);
  const draw = (ctx) => ctx.render(`${question(message)} ${v ? shown() : c.dim(placeholder)}${c.lime("▏")}${error ? `\n  ${c.red(error)}` : ""}`);
  return runPrompt({
    start: draw,
    key(str, k, ctx) {
      if (k.name === "return") {
        const value = v.trim();
        error = validate?.(value) || "";
        if (!error) return ctx.finish(answered(message, mask ? `${value.slice(0, 8)}••••` : value), value);
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim("· cancelled")}`);
      else if (k.name === "backspace") v = v.slice(0, -1);
      else if (k.ctrl && k.name === "u") v = "";
      else if (printable(str, k)) {
        v += str;
        error = "";
      }
      draw(ctx);
    },
  });
}

/** Live search: the list follows the query (debounced), arrows pick, enter chooses. */
async function searchSelect({ message, search, placeholder = "type to search", pageSize = 7 }) {
  ensureInteractive(message);
  let q = "";
  let items = [];
  let idx = 0;
  let loading = false;
  let seq = 0;
  let timer = null;
  let frame = 0;
  let error = "";
  let ctxRef = null;
  let spin = null;
  const draw = () => {
    if (!ctxRef) return;
    const head = `${question(message)} ${q || c.dim(placeholder)}${c.lime("▏")} ${loading ? gradient(FRAMES.dots[frame % 10]) : ""}`;
    const body = error ? [`  ${c.red(error)}`] : items.length ? choiceRows(items, idx, pageSize) : [c.dim(loading ? "  searching…" : "  nothing found — try other words")];
    ctxRef.render([head, ...body, c.dim("  ↑↓ move · enter choose · esc cancel")].join("\n"));
  };
  const run = () => {
    const mine = ++seq;
    loading = true;
    draw();
    Promise.resolve(search(q))
      .then((r) => {
        if (mine !== seq) return;
        items = r;
        idx = Math.max(0, items.findIndex((i) => !i.disabled));
        error = "";
      })
      .catch((err) => {
        if (mine === seq) {
          items = [];
          error = err.message;
        }
      })
      .finally(() => {
        if (mine === seq) {
          loading = false;
          draw();
        }
      });
  };
  return runPrompt({
    start(ctx) {
      ctxRef = ctx;
      spin = setInterval(() => {
        if (loading) {
          frame++;
          draw();
        }
      }, 80);
      run();
    },
    stop() {
      clearInterval(spin);
      clearTimeout(timer);
    },
    key(str, k, ctx) {
      const n = Math.max(1, items.length);
      if (k.name === "up") idx = (idx - 1 + n) % n;
      else if (k.name === "down" || k.name === "tab") idx = (idx + 1) % n;
      else if (k.name === "return") {
        const it = items[idx];
        if (it && !it.disabled) return ctx.finish(answered(message, stripAnsi(it.label)), it.value);
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim("· cancelled")}`);
      else if (k.name === "backspace" || printable(str, k)) {
        q = k.name === "backspace" ? q.slice(0, -1) : q + str;
        clearTimeout(timer);
        timer = setTimeout(run, 180);
      }
      draw();
    },
  });
}

// ===========================================================================
// Config and local state
// ===========================================================================

class CliFail extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

const MALFORMED = Symbol("malformed");

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    return MALFORMED;
  }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: mode ?? 0o644 });
  fs.renameSync(tmp, file);
}

function loadConfig() {
  const raw = readJson(CONFIG, {});
  const cfg = raw === MALFORMED || typeof raw !== "object" ? {} : raw;
  if (!cfg.machineId) {
    cfg.machineId = randomUUID();
    writeJson(CONFIG, cfg, 0o600);
  }
  return cfg;
}

const saveConfig = (cfg) => writeJson(CONFIG, cfg, 0o600);
const baseUrl = (cfg) => (env.SYNAPTH_URL || cfg.baseUrl || "http://localhost:3000").replace(/\/$/, "");
const loadState = () => {
  const rows = readJson(STATE, []);
  return Array.isArray(rows) ? rows : [];
};
const saveState = (rows) => writeJson(STATE, rows);
const sameInstall = (a, b) => a.slug === b.slug && a.target === b.target && a.scope === b.scope && a.project === b.project;
const mcpSettings = (cfg) => ({ enabled: true, allowGlobal: false, confirm: true, ...(cfg.mcp ?? {}) });

// ===========================================================================
// HTTP
// ===========================================================================

const HINTS = {
  device_invalid: "Link this machine: synapth setup  (or synapth link <key>)",
  device_revoked: "Link it again: synapth link <key>",
  link_key_invalid: "Issue a fresh key in Settings → CLI and run synapth link again",
  cli_outdated: "Update the CLI: synapth upgrade",
};
const UPSELL = new Set(["plan_required", "quota_exceeded", "device_limit", "device_suspended"]);

function duration(seconds) {
  if (!seconds) return "a moment";
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function hintFor(data) {
  if (HINTS[data.code]) return HINTS[data.code];
  if (data.code === "quota_exceeded") return `Resets in ${duration(data.retryAfter)} · more installs with Synapth Pro: ${data.billing}`;
  if (UPSELL.has(data.code)) return `Upgrade: ${data.billing}${data.devices ? ` · machines: ${data.devices}` : ""}`;
  return data.hint;
}

async function api(cfg, method, route, body, { auth = true } = {}) {
  const headers = { "Content-Type": "application/json", "X-Synapth-Cli": VERSION, "User-Agent": `synapth-cli/${VERSION}` };
  if (auth) {
    if (!cfg.token) {
      const err = new CliFail("This machine is not linked to a Synapth account", HINTS.device_invalid);
      err.code = "device_invalid";
      throw err;
    }
    headers.Authorization = `Bearer ${cfg.token}`;
  }
  let res;
  try {
    res = await fetch(`${baseUrl(cfg)}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new CliFail(`Cannot reach ${baseUrl(cfg)} (${err.cause?.code ?? err.message})`, "Check the network or SYNAPTH_URL");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new CliFail(data.error || `HTTP ${res.status}`, hintFor(data));
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

// ===========================================================================
// Agents: where each one keeps skills and MCP servers
// ===========================================================================

const SEGMENT = /^[A-Za-z0-9._-]{1,80}$/;
const safeSegment = (s) => typeof s === "string" && SEGMENT.test(s) && s !== "." && s !== "..";
const safeRelative = (p) => typeof p === "string" && p.length > 0 && p.length <= 240 && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && p.split("/").every((s) => s && s !== "." && s !== "..");

function inside(root, p) {
  const rel = path.relative(root, p);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function claudeDesktopConfig() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
  if (process.platform === "win32") return path.join(env.APPDATA || path.join(os.homedir(), "AppData/Roaming"), "Claude/claude_desktop_config.json");
  return path.join(os.homedir(), ".config/Claude/claude_desktop_config.json");
}

function layout(target, global, project) {
  const home = os.homedir();
  if (target === "claude-code") return { skills: path.join(global ? home : project, ".claude/skills"), mcp: global ? path.join(home, ".claude.json") : path.join(project, ".mcp.json") };
  if (target === "cursor") return { skills: path.join(global ? home : project, ".cursor/skills"), mcp: path.join(global ? home : project, ".cursor/mcp.json") };
  return { skills: null, mcp: claudeDesktopConfig() };
}

function which(cmd) {
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

function detectAgents() {
  const home = os.homedir();
  return {
    "claude-code": which("claude") || fs.existsSync(path.join(home, ".claude")),
    cursor: which("cursor") || fs.existsSync(path.join(home, ".cursor")),
    "claude-desktop": fs.existsSync(path.dirname(claudeDesktopConfig())),
  };
}

/** `mcpServers` entry in each client's dialect. */
function mcpEntry(target, server) {
  if (server.transport === "stdio") return { command: server.command, args: server.args ?? [], ...(server.env ? { env: server.env } : {}) };
  // Claude Desktop only launches stdio servers: remote ones go through mcp-remote.
  if (target === "claude-desktop") return { command: "npx", args: ["-y", "mcp-remote", server.url, ...Object.entries(server.headers ?? {}).flatMap(([k, v]) => ["--header", `${k}:${v}`])] };
  if (target === "claude-code") return { type: server.transport, url: server.url, ...(server.headers ? { headers: server.headers } : {}) };
  return { url: server.url, ...(server.headers ? { headers: server.headers } : {}) };
}

/** Edits `mcpServers` in a client config, keeping every other key as it was. */
function editMcp(file, edit) {
  const cfg = readJson(file, {});
  if (cfg === MALFORMED || typeof cfg !== "object" || Array.isArray(cfg)) throw new CliFail(`${file} is not valid JSON; fix it before installing MCP servers`);
  cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === "object" ? cfg.mcpServers : {};
  edit(cfg.mcpServers);
  writeJson(file, cfg);
}

// ---------------------------------------------------------------------------
// Synapth MCP registration (the agent → Synapth bridge)
// ---------------------------------------------------------------------------

const selfPath = () => fs.realpathSync(fileURLToPath(import.meta.url));
const mcpConfigFile = (target) => layout(target, true, os.homedir()).mcp;

/** Absolute node + script paths: GUI agents (Claude Desktop) do not see the shell's PATH. */
function synapthMcpEntry(target) {
  const entry = { command: process.execPath, args: [selfPath(), "mcp", "serve"] };
  return target === "claude-code" ? { type: "stdio", ...entry } : entry;
}

function mcpRegistered(target) {
  const cfg = readJson(mcpConfigFile(target), {});
  return Boolean(cfg && cfg !== MALFORMED && cfg.mcpServers?.synapth);
}

const registerMcp = (target) => editMcp(mcpConfigFile(target), (servers) => (servers.synapth = synapthMcpEntry(target)));
const unregisterMcp = (target) => fs.existsSync(mcpConfigFile(target)) && editMcp(mcpConfigFile(target), (servers) => delete servers.synapth);

// ===========================================================================
// Skill sources
// ===========================================================================

const MAX_FILES = 300;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function githubToken() {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  return gh.status === 0 ? gh.stdout.trim() : null;
}

/**
 * Files of a directory in a public GitHub repository: the tree API lists
 * them, raw.githubusercontent.com serves them (six at a time). Symlinks
 * (mode 120000) are followed inside the repository — to a file or a whole
 * directory — so skills that share reference docs arrive with real content.
 * `onStart(files, bytes)` returns a progress handle.
 */
async function githubFiles({ repo, ref, path: dir }, onStart) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(ref) || (dir && !safeRelative(dir))) throw new CliFail(`Refusing a malformed source: ${repo}@${ref}/${dir}`);
  const token = githubToken();
  const headers = { Accept: "application/vnd.github+json", "User-Agent": `synapth-cli/${VERSION}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers });
  if (res.status === 403 || res.status === 429) throw new CliFail("GitHub rate limit reached", "Set GITHUB_TOKEN or run `gh auth login`, then retry");
  if (!res.ok) throw new CliFail(`GitHub returned ${res.status} for ${repo}`);
  const tree = (await res.json()).tree ?? [];
  const byPath = new Map(tree.map((n) => [n.path, n]));
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  const raw = async (p) => {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${enc(ref)}/${enc(p)}`, { headers: { "User-Agent": `synapth-cli/${VERSION}` } });
    if (!r.ok) throw new CliFail(`Download failed (${r.status}): ${p}`);
    return Buffer.from(await r.arrayBuffer());
  };

  // What to fetch (src in the repo) and where it lands (dest in the skill directory).
  const plan = [];
  const add = async (node, dest, depth) => {
    if (!safeRelative(dest) || plan.length > MAX_FILES) return;
    if (node.mode !== "120000") return void plan.push({ src: node.path, dest, size: node.size ?? 0, mode: node.mode === "100755" ? 0o755 : 0o644 });
    if (depth > 4) return;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(node.path), (await raw(node.path)).toString("utf8").trim()));
    if (target.startsWith("..") || path.posix.isAbsolute(target)) return; // outside the repository
    const hit = byPath.get(target);
    if (hit?.type === "blob") return add(hit, dest, depth + 1);
    if (hit?.type === "tree") for (const n of tree) if (n.type === "blob" && n.path.startsWith(`${target}/`)) await add(n, `${dest}/${n.path.slice(target.length + 1)}`, depth + 1);
  };
  const prefix = dir ? `${dir}/` : "";
  for (const n of tree) if (n.type === "blob" && n.path.startsWith(prefix)) await add(n, n.path.slice(prefix.length), 0);

  if (!plan.length) throw new CliFail(`Nothing found at ${repo}/${dir}`);
  if (plan.length > MAX_FILES) throw new CliFail(`${repo}/${dir} has more than ${MAX_FILES} files`);
  const big = plan.find((f) => f.size > MAX_FILE_BYTES);
  if (big) throw new CliFail(`${big.src} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const total = plan.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new CliFail(`${repo}/${dir} is larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB`);

  const progress = onStart?.(plan.length, total) ?? { tick() {}, done() {}, fail() {} };
  const files = new Array(plan.length);
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(6, plan.length) }, async () => {
        while (next < plan.length) {
          const k = next++;
          const content = await raw(plan[k].src);
          files[k] = { path: plan[k].dest, content, mode: plan[k].mode };
          progress.tick(1, content.length);
        }
      }),
    );
  } catch (err) {
    progress.fail(`${repo}/${dir}: ${err.message}`);
    throw err;
  }
  progress.done(`${files.length} files · ${fmtBytes(total)} ${c.dim(`from ${repo}`)}`);
  return files;
}

/** Writes into a temp directory next to the destination, then swaps it in. */
function placeDirectory(dest, files) {
  const tmp = `${dest}.synapth-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of files) {
    const file = path.join(tmp, f.path);
    if (!inside(tmp, file)) throw new CliFail(`Refusing to write outside the skill directory: ${f.path}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, f.content, { mode: f.mode ?? 0o644 });
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmp, dest);
}

// ===========================================================================
// Installing (shared by the terminal and the MCP server)
// ===========================================================================

async function applyBundle(bundle, { target, global, project, force }, hooks) {
  const where = layout(target, global, project);
  const state = loadState();
  const record = { slug: bundle.slug, name: bundle.name, version: bundle.version, target, scope: global ? "global" : "project", project: global ? null : project, paths: [], mcp: [], installedAt: new Date().toISOString() };
  const ours = state.filter((r) => r.slug === bundle.slug);

  for (const action of bundle.actions) {
    if (action.kind === "skill") {
      if (!where.skills) throw new CliFail(`${TARGET_LABEL[target]} has no skill directory`);
      if (!safeSegment(action.dir)) throw new CliFail(`Refusing a malformed skill directory name: ${action.dir}`);
      const dest = path.join(where.skills, action.dir);
      if (fs.existsSync(dest) && !ours.some((r) => r.paths.includes(dest)) && !force) throw new CliFail(`${tilde(dest)} already exists and was not installed by Synapth`, "Pass --force to replace it");
      const files =
        action.source.type === "github"
          ? await githubFiles(action.source, (n, bytes) => hooks.download(bundle, n, bytes))
          : action.source.files.map((f) => {
              if (!safeRelative(f.path)) throw new CliFail(`Refusing a malformed file path: ${f.path}`);
              return { path: f.path, content: Buffer.from(f.content, "utf8") };
            });
      placeDirectory(dest, files);
      record.paths.push(dest);
    } else if (action.kind === "mcp") {
      if (!safeSegment(action.name) || action.name === "synapth") throw new CliFail(`Refusing a malformed server name: ${action.name}`);
      const owned = ours.some((r) => r.mcp.some((m) => m.file === where.mcp && m.name === action.name));
      editMcp(where.mcp, (servers) => {
        if (servers[action.name] && !owned && !force) throw new CliFail(`MCP server "${action.name}" is already configured in ${tilde(where.mcp)}`, "Pass --force to replace it");
        servers[action.name] = mcpEntry(target, action.server);
      });
      record.mcp.push({ file: where.mcp, name: action.name });
    }
  }

  saveState([...state.filter((r) => !sameInstall(r, record)), record]);
  return record;
}

const SILENT_HOOKS = { request: (_label, fn) => fn(), bundleStart() {}, download: () => null, bundleDone() {}, bundleFail() {} };

/** Asks the server (plan, quota, trust), then applies every bundle it returned. */
async function performInstall(cfg, opts, hooks = SILENT_HOOKS) {
  const { slug, set = false, target, global = false, project = process.cwd(), force = false, allowSandbox = false, via = "cli" } = opts;
  const h = { ...SILENT_HOOKS, ...hooks };
  const res = await h.request(`Asking Synapth for ${c.bold(slug)}`, () => api(cfg, "POST", "/api/v1/cli/install", { slug, set, target, allowSandbox, via }));
  const results = [];
  const envNames = new Set();
  for (const [i, bundle] of res.installed.entries()) {
    h.bundleStart(bundle, i, res.installed.length);
    try {
      const record = await applyBundle(bundle, { target, global, project, force }, h);
      results.push({ bundle, record });
      bundle.env.forEach((e) => envNames.add(e));
      h.bundleDone(bundle, record, i, res.installed.length);
    } catch (err) {
      results.push({ bundle, error: err });
      h.bundleFail(bundle, err);
    }
  }
  return { results, skipped: res.skipped, usage: res.usage, env: [...envNames], target, global, project };
}

function removeRecord(record) {
  const where = layout(record.target, record.scope === "global", record.project ?? process.cwd());
  for (const p of record.paths) if (where.skills && inside(where.skills, p)) fs.rmSync(p, { recursive: true, force: true });
  for (const m of record.mcp) if (fs.existsSync(m.file)) editMcp(m.file, (servers) => delete servers[m.name]);
}

function installedHere(project = process.cwd()) {
  return loadState().filter((r) => r.scope === "global" || r.project === project);
}

// ===========================================================================
// Terminal flows
// ===========================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) args[k] = v;
      else if (["target", "name", "url", "limit"].includes(k)) args[k] = argv[++i];
      else args[k] = true;
    } else if (a === "-g") args.global = true;
    else if (a === "-y") args.yes = true;
    else if (a === "-t") args.target = argv[++i];
    else args._.push(a);
  }
  return args;
}

function cliHooks() {
  let spin = null;
  const prefix = (i, n) => (n > 1 ? c.dim(`[${i + 1}/${n}] `) : "");
  return {
    request: (label, fn) =>
      step(label, fn, {
        frames: FRAMES.synapse,
        done: (r) => (r.installed.length ? `Synapth cleared ${r.installed.length} entr${r.installed.length === 1 ? "y" : "ies"}${r.skipped.length ? c.dim(` · ${r.skipped.length} skipped`) : ""}` : "Nothing to install"),
      }),
    bundleStart(b, i, n) {
      spin = spinner(`${prefix(i, n)}Installing ${c.bold(b.name)} ${c.dim(`v${b.version}`)}`);
    },
    download(b, total) {
      spin?.stop();
      spin = null;
      return progressBar(`  ${c.lime("↓")} ${b.name}`, total, { unit: " files" });
    },
    bundleDone(b, rec, i, n) {
      const where = [...rec.paths.map(tilde), ...rec.mcp.map((m) => `${tilde(m.file)} ${c.dim(`[${m.name}]`)}`)].join(", ");
      const line = `${prefix(i, n)}${c.bold(b.name)} ${c.dim(`v${b.version}`)} ${trustBadge(b.securityLevel)} ${c.dim("→")} ${where}`;
      if (spin) spin.succeed(line);
      else print(`${sym.ok} ${line}`);
      spin = null;
    },
    bundleFail(b, err) {
      const line = `${b.name}: ${err.message}${err.hint ? c.dim(` — ${err.hint}`) : ""}`;
      if (spin) spin.fail(line);
      else print(`${sym.fail} ${line}`);
      spin = null;
      process.exitCode = 1;
    },
  };
}

async function chooseTarget(cfg, args, message = "Install into which agent?") {
  if (args.target) {
    if (!TARGETS.includes(args.target)) throw new CliFail(`Unknown target "${args.target}"`, `One of: ${TARGETS.join(", ")}`);
    return args.target;
  }
  if (cfg.defaultTarget) return cfg.defaultTarget;
  if (!interactive()) return "claude-code";
  const det = detectAgents();
  const target = await select({
    message,
    choices: TARGETS.map((t) => ({ label: TARGET_LABEL[t], value: t, hint: det[t] ? c.lime("● detected") : "not found" })),
    initial: Math.max(0, TARGETS.findIndex((t) => det[t])),
    filter: false,
  });
  cfg.defaultTarget = target;
  saveConfig(cfg);
  print(c.dim(`  saved as default · change with: synapth config target <agent>`));
  return target;
}

function renderInstallSummary(out) {
  const ok = out.results.filter((r) => r.record);
  for (const s of out.skipped) print(`${c.dim("–")} ${s.name} ${c.dim(`skipped (${s.reason})`)}`);
  if (!ok.length) return;
  const hasMcp = ok.some((r) => r.record.mcp.length);
  const hasSkills = ok.some((r) => r.record.paths.length);
  print(
    box(
      [
        `${c.dim("Agent    ")} ${TARGET_LABEL[out.target]} ${c.dim(out.global ? "· user-wide" : `· ${tilde(out.project) === "./" ? "this project" : tilde(out.project)}`)}`,
        out.env.length ? `${c.dim("Set env  ")} ${c.yellow(out.env.join(", "))}` : null,
        `${c.dim("Today    ")} ${meter(out.usage.installsToday, out.usage.installsPerDay)} ${c.dim("installs")}`,
        hasMcp ? c.dim(`Restart ${TARGET_LABEL[out.target]} to load new MCP servers.`) : null,
        hasSkills && !hasMcp ? c.dim("Skills load at the start of the next agent session.") : null,
      ],
      { title: `${ok.length} installed` },
    ),
  );
}

async function installFlow(cfg, slug, args, { set = false } = {}) {
  const target = await chooseTarget(cfg, args);
  const global = Boolean(args.global) || target === "claude-desktop";
  const attempt = (allowSandbox) => performInstall(cfg, { slug, set, target, global, project: process.cwd(), force: Boolean(args.force), allowSandbox, via: "cli" }, cliHooks());
  let out;
  try {
    out = await attempt(Boolean(args["allow-sandbox"]));
  } catch (err) {
    if (err.code === "not_installable" && err.data?.reason === "sandbox" && interactive()) {
      print(box([`${trustBadge("Sandbox")} — Synapth has not reviewed this entry yet.`, "It may run commands or read files with your permissions.", c.dim("Install it only if you trust the author.")], { title: "Unreviewed entry", color: c.yellow }));
      if (!(await confirm({ message: "Install it anyway?", initial: false }))) return null;
      out = await attempt(true);
    } else throw err;
  }
  renderInstallSummary(out);
  return out;
}

async function searchChoices(cfg, q) {
  const { results } = await api(cfg, "GET", `/api/v1/cli/search?q=${encodeURIComponent(q)}&limit=12`);
  return results.map((r) => ({
    label: `${r.name} ${c.dim(r.slug)}`,
    value: r.slug,
    hint: `${trustBadge(r.securityLevel)} ${c.dim(r.category)}`,
    disabled: r.entrypoint === "http" ? "runs on the gateway" : false,
  }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function doLink(cfg, key, args) {
  if (args.url) cfg.baseUrl = args.url.replace(/\/$/, "");
  const machine = { machineId: cfg.machineId, name: (args.name || os.hostname()).slice(0, 64), platform: process.platform, arch: process.arch, cliVersion: VERSION };
  const res = await step(`Linking ${c.bold(machine.name)} to ${baseUrl(cfg)}`, () => api(cfg, "POST", "/api/v1/cli/link", { key, machine }, { auth: false }), { frames: FRAMES.synapse, done: `Handshake with ${baseUrl(cfg)}` });
  cfg.token = res.token;
  cfg.device = { id: res.device.id, name: res.device.name };
  saveConfig(cfg);
  const status = await api(cfg, "GET", "/api/v1/cli/status");
  cfg.user = { handle: status.user.handle };
  saveConfig(cfg);
  await sparkle(`${res.device.name} is linked to @${status.user.handle} · ${planLabel(status.plan.id)}`);
  print(c.dim(`  token stored in ${tilde(CONFIG)} (0600)`));
  showNotices(status);
  return status;
}

const KEY_RE = /^slk_[0-9A-Za-z]{32}$/;

async function cmdLink(cfg, args) {
  let key = args._[1];
  if (!key && interactive()) {
    print(c.dim(`  Issue a key in Settings → CLI: ${baseUrl(cfg)}/dashboard/settings#cli`));
    key = await input({ message: "Paste your link key", mask: true, placeholder: "slk_…", validate: (v) => (KEY_RE.test(v) ? "" : "A link key is slk_ followed by 32 letters and digits") });
  }
  if (!key || !key.startsWith("slk_")) throw new CliFail("Usage: synapth link <slk_… key>", "Issue the key in Settings → CLI on the Synapth website");
  await doLink(cfg, key, args);
}

async function cmdUnlink(cfg) {
  if (interactive() && !(await confirm({ message: "Unlink this machine from your Synapth account?", initial: false }))) return;
  if (cfg.token) await step("Unlinking", () => api(cfg, "POST", "/api/v1/cli/unlink")).catch((err) => warn(`Server: ${err.message}`));
  delete cfg.token;
  delete cfg.user;
  delete cfg.device;
  saveConfig(cfg);
  print(`${sym.ok} This machine is unlinked. Installed skills stay where they are.`);
}

const NOTICES = {
  grace: (s) => `Payment failed — ${planLabel(s.plan.id)} stays on during the grace period. Update the payment method: ${s.links.billing}`,
  past_due: (s) => `Renewal is past due. Update the payment method: ${s.links.billing}`,
  expired: (s) => `Your ${planLabel(s.plan.lapsedFrom)} subscription has ended — Free limits apply. Renew: ${s.links.billing}`,
  cancel_scheduled: (s) => `${planLabel(s.plan.id)} ends on ${s.plan.periodEnd?.slice(0, 10)} (canceled).`,
  quota_low: (s) => `Almost out of installs for today: ${s.usage.installsToday}/${limitLabel(s.limits.installsPerDay)}.`,
  quota_exhausted: (s) => `Daily installs used up; resets ${s.resetAt.slice(11, 16)} UTC. More with Pro: ${s.links.billing}`,
  device_suspended: (s) => `This machine is paused: your plan allows ${limitLabel(s.limits.devices)} linked machine(s). Manage: ${s.links.devices}`,
  cli_update: (s) => `CLI ${s.cli.latest} is available — synapth upgrade`,
};
const showNotices = (s) => s.notices.forEach((n) => NOTICES[n] && warn(NOTICES[n](s)));

async function cmdStatus(cfg, args) {
  const s = args.json ? await api(cfg, "GET", "/api/v1/cli/status") : await step("Reading your account", () => api(cfg, "GET", "/api/v1/cli/status"), { done: (r) => `@${r.user.handle}` });
  if (args.json) return print(JSON.stringify(s, null, 2));
  const connected = TARGETS.filter(mcpRegistered).map((t) => TARGET_LABEL[t]);
  const plan = `${c.lime(c.bold(planLabel(s.plan.id)))}${s.plan.status !== "none" ? c.dim(` · ${s.plan.status}${s.plan.periodEnd ? ` until ${s.plan.periodEnd.slice(0, 10)}` : ""}`) : ""}`;
  print(
    box(
      [
        `${c.dim("Plan      ")} ${plan}`,
        `${c.dim("Installs  ")} ${meter(s.usage.installsToday, s.limits.installsPerDay)} ${c.dim(`today · resets ${s.resetAt.slice(11, 16)} UTC`)}`,
        `${c.dim("Machines  ")} ${meter(s.usage.devices, s.limits.devices)} ${c.dim(`· this: ${s.device.name}`)}${s.device.suspended ? c.red(" paused") : ""}`,
        `${c.dim("Skillsets ")} ${s.limits.bulk ? c.lime("included") : c.dim("Synapth Pro")}`,
        `${c.dim("Agent MCP ")} ${connected.length ? c.lime(connected.join(", ")) : c.dim("not connected — synapth mcp add")}`,
        `${c.dim("CLI       ")} ${VERSION}${s.cli.latest !== VERSION ? c.yellow(` → ${s.cli.latest}`) : ""} ${c.dim(`· ${baseUrl(cfg)}`)}`,
      ],
      { title: `@${s.user.handle}${s.user.name ? ` · ${s.user.name}` : ""}` },
    ),
  );
  showNotices(s);
}

async function cmdSearch(cfg, args) {
  const q = args._.slice(1).join(" ");
  if (!q && interactive()) return cmdInstall(cfg, { ...args, _: ["install"] });
  const { results } = await step(`Searching ${c.bold(q || "the catalogue")}`, () => api(cfg, "GET", `/api/v1/cli/search?q=${encodeURIComponent(q)}&limit=${Number(args.limit) || 10}`), { done: (r) => `${r.results.length} result${r.results.length === 1 ? "" : "s"}` });
  if (args.json) return print(JSON.stringify(results, null, 2));
  if (!results.length) return print(c.dim("Nothing found."));
  for (const r of results) {
    print(`\n${c.bold(r.name)} ${c.dim(r.slug)} ${c.dim(`v${r.version}`)}  ${trustBadge(r.securityLevel)} ${c.dim(r.category)}${r.entrypoint === "http" ? c.dim(" · gateway only") : ""}`);
    print(`  ${c.dim(r.description)}`);
  }
  if (interactive()) {
    const choices = results.filter((r) => r.entrypoint !== "http").map((r) => ({ label: r.name, value: r.slug, hint: r.slug }));
    if (!choices.length) return;
    print();
    const slug = await select({ message: "Install one?", choices: [...choices, { label: c.dim("No, thanks"), value: null }] });
    if (slug) await installFlow(cfg, slug, args);
  } else print(c.dim(`\nInstall: synapth install <slug>`));
}

async function cmdInstall(cfg, args) {
  let slug = args._[1];
  if (!slug) {
    if (!interactive()) throw new CliFail("Usage: synapth install <slug> [--set] [--target claude-code|cursor|claude-desktop] [--global]");
    slug = await searchSelect({ message: "Find a skill", search: (q) => searchChoices(cfg, q), placeholder: "postgres, browser, jira, code review…" });
  }
  await installFlow(cfg, slug, args, { set: Boolean(args.set) });
}

const VARIANT = { pack: "Pack", set: "Set of skills", skill: "Skill" };

async function cmdRecommend(cfg, args) {
  let task = args._.slice(1).join(" ");
  if (!task) {
    if (!interactive()) throw new CliFail('Usage: synapth recommend "<what your agent should do>"');
    task = await input({ message: "What should your agent be able to do?", placeholder: "e.g. query our Postgres and file Jira tickets", validate: (v) => (v.length < 3 ? "A few words, please" : "") });
  }
  const target = args.target || cfg.defaultTarget || "claude-code";
  const call = () => api(cfg, "POST", "/api/v1/cli/recommend", { task, target });
  const { recommendations } = args.json ? await call() : await step("Matching your task against the catalogue", call, { frames: FRAMES.synapse, done: (r) => `${r.recommendations.length} option${r.recommendations.length === 1 ? "" : "s"} for “${task.slice(0, 60)}”` });
  if (args.json) return print(JSON.stringify(recommendations, null, 2));
  if (!recommendations.length) return print(c.dim("Nothing fits yet — try describing the task differently."));
  recommendations.forEach((r, i) => {
    print(
      box(
        [
          c.italic(r.reason),
          ...r.items.map((it) => `${c.lime("•")} ${c.bold(it.name)} ${c.dim(it.slug)}  ${trustBadge(it.trust)}`),
          c.dim(`covers ${Math.round(r.coverage * 100)}% · ~${r.tokens} tokens${r.permissions.length ? ` · needs ${r.permissions.join(", ")}` : ""}`),
        ],
        { title: `${i + 1} · ${VARIANT[r.type]}${"set" in r.install ? ` · ${r.install.set}` : ""}` },
      ),
    );
  });
  if (!interactive()) return print(c.dim('\nInstall: synapth install <slug>  (a pack: synapth install <pack> --set)'));
  const pick = await select({ message: "Install one of these?", choices: [...recommendations.map((r, i) => ({ label: `${i + 1} · ${VARIANT[r.type]}`, value: i, hint: r.items.map((it) => it.name).join(", ") })), { label: c.dim("No, thanks"), value: -1 }], filter: false });
  if (pick < 0) return;
  const chosen = recommendations[pick];
  if ("set" in chosen.install) await installFlow(cfg, chosen.install.set, args, { set: true });
  else for (const slug of chosen.install.skills) await installFlow(cfg, slug, args);
}

function cmdList(args) {
  const rows = loadState();
  if (args.json) return print(JSON.stringify(rows, null, 2));
  if (!rows.length) return print(c.dim("Nothing installed through Synapth yet — try: synapth install"));
  const w = Math.max(...rows.map((r) => r.slug.length), 4);
  print(c.dim(`  ${"SKILL".padEnd(w)}  ${"VERSION".padEnd(9)}  ${"AGENT".padEnd(14)}  WHERE`));
  for (const r of rows) print(`  ${c.bold(r.slug.padEnd(w))}  ${c.dim(`v${r.version}`.padEnd(9))}  ${TARGET_LABEL[r.target].padEnd(14)}  ${c.dim(r.scope === "global" ? "user-wide" : tilde(r.project))}`);
}

function matching(slug, args) {
  const cwd = process.cwd();
  return loadState().filter((r) => r.slug === slug && (!args.target || r.target === args.target) && (args.global ? r.scope === "global" : r.scope === "global" || r.project === cwd));
}

async function cmdUninstall(args) {
  let rows;
  if (args._[1]) rows = matching(args._[1], args);
  else {
    const here = installedHere();
    if (!here.length) return print(c.dim("Nothing installed through Synapth here."));
    ensureInteractive("Remove which?");
    const keys = await multiselect({ message: "Remove which?", choices: here.map((r, i) => ({ label: r.slug, value: i, hint: `${TARGET_LABEL[r.target]} · ${r.scope === "global" ? "user-wide" : "project"}` })) });
    rows = keys.map((k) => here[k]);
  }
  if (!rows.length) throw new CliFail(`${args._[1]} is not installed here`, "See synapth list");
  for (const r of rows) await step(`Removing ${c.bold(r.slug)} from ${TARGET_LABEL[r.target]}`, async () => removeRecord(r));
  saveState(loadState().filter((r) => !rows.some((x) => sameInstall(x, r))));
}

async function cmdUpdate(cfg, args) {
  if (!args.all && !args._[1]) throw new CliFail("Usage: synapth update <slug> | --all");
  const rows = args.all ? installedHere() : matching(args._[1], args);
  if (!rows.length) return print(c.dim("Nothing to update here."));
  if (args.all) {
    const s = await api(cfg, "GET", "/api/v1/cli/status");
    if (!s.limits.bulk) throw new CliFail("update --all needs Synapth Pro", `Update one at a time, or upgrade: ${s.links.billing}`);
  }
  for (const [i, r] of rows.entries()) {
    print(c.dim(`\n[${i + 1}/${rows.length}] ${r.slug} · ${TARGET_LABEL[r.target]}`));
    const out = await performInstall(cfg, { slug: r.slug, target: r.target, global: r.scope === "global", project: r.project ?? process.cwd(), force: true }, cliHooks());
    const before = r.version;
    const after = out.results[0]?.record?.version;
    if (after) print(c.dim(`  ${before === after ? `already at v${after} (refreshed)` : `v${before} → ${c.lime(`v${after}`)}`}`));
  }
}

async function cmdUpgrade(cfg) {
  const code = await step("Downloading the latest CLI", async () => {
    const res = await fetch(`${baseUrl(cfg)}/cli/synapth.mjs`, { headers: { "User-Agent": `synapth-cli/${VERSION}` } });
    if (!res.ok) throw new CliFail(`Download failed: HTTP ${res.status}`);
    const text = await res.text();
    if (!text.startsWith("#!/usr/bin/env node")) throw new CliFail("The downloaded file does not look like the Synapth CLI");
    return text;
  });
  const self = selfPath();
  fs.writeFileSync(`${self}.new`, code, { mode: 0o755 });
  fs.renameSync(`${self}.new`, self);
  const next = code.match(/const VERSION = "([^"]+)"/)?.[1] ?? "?";
  await sparkle(next === VERSION ? `Already on ${VERSION}` : `Updated ${VERSION} → ${next}`);
}

function onOff(value, key) {
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  throw new CliFail(`Usage: synapth config ${key} on|off`);
}

function cmdConfig(cfg, args) {
  const [, key, value] = args._;
  const mcp = mcpSettings(cfg);
  if (key === "url" && value) cfg.baseUrl = value.replace(/\/$/, "");
  else if (key === "target" && value) {
    if (!TARGETS.includes(value)) throw new CliFail(`Unknown target "${value}"`, `One of: ${TARGETS.join(", ")}`);
    cfg.defaultTarget = value;
  } else if (key === "mcp") cfg.mcp = { ...mcp, enabled: onOff(value, key) };
  else if (key === "mcp-global") cfg.mcp = { ...mcp, allowGlobal: onOff(value, key) };
  else if (key === "mcp-confirm") cfg.mcp = { ...mcp, confirm: onOff(value, key) };
  else if (key === "animations") cfg.animations = onOff(value, key);
  else if (key) throw new CliFail("Usage: synapth config [url <u> | target <agent> | mcp on|off | mcp-global on|off | mcp-confirm on|off | animations on|off]");
  if (key) saveConfig(cfg);
  const now = mcpSettings(cfg);
  const yes = (b) => (b ? c.lime("on") : c.dim("off"));
  print(
    box(
      [
        `${c.dim("url          ")} ${baseUrl(cfg)}`,
        `${c.dim("target       ")} ${TARGET_LABEL[cfg.defaultTarget] ?? c.dim("ask")}`,
        `${c.dim("linked       ")} ${cfg.token ? `${cfg.device?.name ?? "yes"} → @${cfg.user?.handle ?? "?"}` : c.dim("no")}`,
        `${c.dim("mcp          ")} ${yes(now.enabled)} ${c.dim("· agents may use Synapth")}`,
        `${c.dim("mcp-global   ")} ${yes(now.allowGlobal)} ${c.dim("· agents may install user-wide")}`,
        `${c.dim("mcp-confirm  ")} ${yes(now.confirm)} ${c.dim("· ask before an agent installs")}`,
        `${c.dim("animations   ")} ${yes(CFG.animations !== false)}`,
        c.dim(tilde(CONFIG)),
      ],
      { title: "config" },
    ),
  );
}

async function cmdMcp(cfg, args) {
  const sub = args._[1];
  if (sub === "serve" || (!sub && !process.stdin.isTTY)) return mcpServe(cfg);
  if (sub === "add") {
    let targets = args.target ? [args.target] : null;
    if (targets && !TARGETS.includes(targets[0])) throw new CliFail(`Unknown target "${targets[0]}"`, `One of: ${TARGETS.join(", ")}`);
    if (!targets) {
      if (!interactive()) throw new CliFail("Usage: synapth mcp add --target claude-code|cursor|claude-desktop");
      const det = detectAgents();
      targets = await multiselect({ message: "Connect Synapth MCP to", choices: TARGETS.map((t) => ({ label: TARGET_LABEL[t], value: t, checked: det[t] || mcpRegistered(t), hint: mcpRegistered(t) ? "connected" : det[t] ? "detected" : "not found" })) });
    }
    for (const t of targets) await step(`Connecting ${TARGET_LABEL[t]}`, async () => registerMcp(t), { done: `${TARGET_LABEL[t]} ${c.dim("→")} ${tilde(mcpConfigFile(t))}` });
    return print(c.dim(`  Restart ${targets.map((t) => TARGET_LABEL[t]).join(", ")} to load the Synapth tools.`));
  }
  if (sub === "remove") {
    const targets = args.target ? [args.target] : TARGETS.filter(mcpRegistered);
    for (const t of targets) await step(`Disconnecting ${TARGET_LABEL[t]}`, async () => unregisterMcp(t));
    return;
  }
  const m = mcpSettings(cfg);
  print(
    box(
      [
        "Synapth MCP lets your agent find and install skills by itself:",
        `${c.dim("tools")} recommend_skills · search_skills · install_skill · list_installed_skills · uninstall_skill · synapth_status`,
        "",
        ...TARGETS.map((t) => `${mcpRegistered(t) ? sym.ok : c.dim("○")} ${TARGET_LABEL[t].padEnd(15)} ${c.dim(tilde(mcpConfigFile(t)))}`),
        "",
        `${c.dim("enabled")} ${m.enabled ? c.lime("on") : c.red("off")}  ${c.dim("confirm")} ${m.confirm ? c.lime("on") : c.yellow("off")}  ${c.dim("global installs")} ${m.allowGlobal ? c.yellow("allowed") : c.lime("project only")}`,
        c.dim("synapth mcp add · synapth mcp remove · synapth config mcp-global on|off"),
      ],
      { title: "Synapth MCP" },
    ),
  );
}

async function cmdSetup(cfg, args) {
  if (!interactive()) throw new CliFail("synapth setup is interactive", "Run it in a terminal, or use: synapth link <key>");
  await banner("let's connect this machine");

  print(c.dim("  ── 1/3 · Account"));
  if (cfg.token) {
    try {
      await step("Checking the link", () => api(cfg, "GET", "/api/v1/cli/status"), { frames: FRAMES.synapse, done: (s) => `Linked to ${c.bold(`@${s.user.handle}`)} · ${planLabel(s.plan.id)}` });
    } catch (err) {
      if (err.code !== "device_revoked" && err.code !== "device_invalid") throw err;
      delete cfg.token;
      saveConfig(cfg);
    }
  }
  if (!cfg.token) {
    print(c.dim(`  Get a key in Settings → CLI: ${baseUrl(cfg)}/dashboard/settings#cli`));
    const key = await input({ message: "Paste your link key", mask: true, placeholder: "slk_…", validate: (v) => (KEY_RE.test(v) ? "" : "A link key is slk_ followed by 32 letters and digits") });
    await doLink(cfg, key, args);
  }

  print(c.dim("\n  ── 2/3 · Default agent"));
  const det = detectAgents();
  const current = TARGETS.indexOf(cfg.defaultTarget);
  cfg.defaultTarget = await select({
    message: "Where should skills go by default?",
    choices: TARGETS.map((t) => ({ label: TARGET_LABEL[t], value: t, hint: det[t] ? c.lime("● detected") : "not found" })),
    initial: current >= 0 ? current : Math.max(0, TARGETS.findIndex((t) => det[t])),
    filter: false,
  });
  saveConfig(cfg);

  print(c.dim("\n  ── 3/3 · Let agents install skills"));
  print(box(["Synapth MCP gives your agent tools to find and install skills when a task needs them.", c.dim("It works inside the current project, asks before writing when the agent supports it, and spends your plan's daily quota.")], { title: "Synapth MCP" }));
  const targets = await multiselect({
    message: "Connect Synapth MCP to",
    choices: TARGETS.map((t) => ({ label: TARGET_LABEL[t], value: t, checked: det[t] || mcpRegistered(t), hint: mcpRegistered(t) ? "connected" : det[t] ? "detected" : "not found" })),
    allowEmpty: true,
  });
  for (const t of targets) await step(`Connecting ${TARGET_LABEL[t]}`, async () => registerMcp(t), { done: `${TARGET_LABEL[t]} ${c.dim("→")} ${tilde(mcpConfigFile(t))}` });

  print();
  await sparkle("You're all set");
  print(
    box(
      [
        `${c.lime("synapth")}               interactive menu`,
        `${c.lime("synapth install")}       search and install a skill`,
        `${c.lime("synapth recommend")}     describe a task, get skills`,
        `${c.lime("synapth status")}        plan, quota, machines`,
        targets.length ? c.dim(`Restart ${targets.map((t) => TARGET_LABEL[t]).join(", ")} and ask it for what you need — it can now reach Synapth.`) : null,
      ],
      { title: "Next" },
    ),
  );
}

async function menu(cfg) {
  await banner();
  if (!cfg.token) {
    print(box(["This machine is not linked to a Synapth account yet."], { title: "Welcome", color: c.cyan }));
    if (await confirm({ message: "Run setup now?" })) return cmdSetup(cfg, ARGS);
    return;
  }
  for (;;) {
    let action;
    try {
      action = await select({
        message: "What would you like to do?",
        filter: false,
        choices: [
          { label: "Find & install a skill", value: "install" },
          { label: "Get skills for a task", value: "recommend", hint: "describe it in words" },
          { label: "Installed here", value: "list" },
          { label: "Update installed", value: "update" },
          { label: "Remove skills", value: "uninstall" },
          { label: "Agent access (MCP)", value: "mcp" },
          { label: "Account & quota", value: "status" },
          { label: c.dim("Quit"), value: "quit" },
        ],
      });
    } catch (err) {
      if (err.code === "cancelled") return;
      throw err;
    }
    if (action === "quit") return;
    try {
      if (action === "install") await cmdInstall(cfg, { _: ["install"] });
      else if (action === "recommend") await cmdRecommend(cfg, { _: ["recommend"] });
      else if (action === "list") cmdList({});
      else if (action === "update") await cmdUpdate(cfg, { _: ["update"], all: true });
      else if (action === "uninstall") await cmdUninstall({ _: ["uninstall"] });
      else if (action === "mcp") await cmdMcp(cfg, { _: ["mcp", interactive() ? "add" : "status"] });
      else if (action === "status") await cmdStatus(cfg, {});
    } catch (err) {
      if (err.code !== "cancelled") reportError(err);
    }
    print();
  }
}

// ===========================================================================
// Synapth MCP server (stdio, JSON-RPC 2.0, one message per line)
// ===========================================================================

const MCP_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const MCP_TOOLS = [
  {
    name: "recommend_skills",
    title: "Find Synapth skills for a task",
    description:
      "Use when the user's task needs a capability you do not have (a database, a browser, an issue tracker, a code-review style…). Describe the task in plain words; returns up to 3 options (a pack, a set or a single skill) with trust level and what to pass to install_skill. Read-only.",
    inputSchema: { type: "object", properties: { task: { type: "string", description: "What needs to be done, in plain words (≤ 2000 chars)." } }, required: ["task"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "search_skills",
    title: "Search the Synapth catalogue",
    description: "Keyword search over Synapth skills and MCP servers. Read-only.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "install_skill",
    title: "Install a Synapth skill",
    description:
      "Installs a skill or MCP server from Synapth into this agent (current project by default). Pass the slug from recommend_skills/search_skills; for a pack pass skillset: true. Never installs unreviewed (Sandbox) entries. Counts against the user's daily Synapth quota; the user may be asked to approve. New MCP servers need an agent restart; skills load in the next session.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Skill slug, or a pack's slug with skillset: true." },
        skillset: { type: "boolean", description: "Install a whole pack (Synapth Pro)." },
        scope: { type: "string", enum: ["project", "global"], description: "project (default) or user-wide, if the user allowed it." },
      },
      required: ["slug"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_installed_skills",
    title: "List skills installed by Synapth",
    description: "Skills and MCP servers Synapth installed for this project and user-wide. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "uninstall_skill",
    title: "Remove a Synapth skill",
    description: "Removes a skill or MCP server that Synapth installed in this project. Only touches files Synapth created.",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "synapth_status",
    title: "Synapth plan and quota",
    description: "The user's Synapth plan, today's install quota and whether this machine may install. Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const MCP_INSTRUCTIONS =
  "Synapth is a catalogue of agent skills and MCP servers. When a task needs a capability you lack, call recommend_skills with the task, pick the best option and call install_skill. Prefer Verified entries. Tell the user what you installed and that new MCP servers need a restart.";

function mcpServe(cfg) {
  MCP_MODE = true;
  const state = { client: null, caps: {}, nextId: 1, pending: new Map(), roots: null };
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const request = (method, params, timeoutMs = 120_000) =>
    new Promise((resolve, reject) => {
      const id = `synapth-${state.nextId++}`;
      const timer = setTimeout(() => state.pending.delete(id) && reject(new Error(`${method} timed out`)), timeoutMs);
      state.pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
      send({ jsonrpc: "2.0", id, method, params });
    });

  const settings = () => mcpSettings(loadConfig());

  function inferTarget() {
    const name = String(state.client?.name ?? "").toLowerCase();
    if (name.includes("cursor")) return "cursor";
    if (name.includes("claude-code") || name.includes("claude code")) return "claude-code";
    if (name.includes("claude")) return "claude-desktop";
    return cfg.defaultTarget || "claude-code";
  }

  /** The project the agent works in: MCP roots when the client offers them, else the server's cwd. */
  async function projectDir() {
    if (state.caps.roots) {
      try {
        if (!state.roots) state.roots = (await request("roots/list", {}, 5_000)).roots ?? [];
        const first = state.roots.find((r) => String(r.uri).startsWith("file://"));
        if (first) return fileURLToPath(first.uri);
      } catch {
        /* fall back to cwd */
      }
    }
    return env.SYNAPTH_PROJECT_DIR || process.cwd();
  }

  async function approve(message) {
    if (!settings().confirm || !state.caps.elicitation) return true;
    const res = await request("elicitation/create", {
      message,
      requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: "Install", description: "Let Synapth write these files", default: true } } },
    });
    return res?.action === "accept" && res.content?.approve !== false;
  }

  const guard = () => {
    if (!settings().enabled) throw new CliFail("Synapth MCP is turned off on this machine", "The user can enable it with: synapth config mcp on");
  };

  const TOOLS = {
    async recommend_skills({ task }) {
      guard();
      if (!task || String(task).trim().length < 3) throw new CliFail("Describe the task in a few words");
      const { recommendations } = await api(cfg, "POST", "/api/v1/cli/recommend", { task: String(task).slice(0, 2000), target: inferTarget() });
      if (!recommendations.length) return { text: "Nothing in the Synapth catalogue fits this task. Try other words or search_skills.", data: { recommendations } };
      const text = recommendations
        .map((r, i) => {
          const how = "set" in r.install ? `install_skill { slug: "${r.install.set}", skillset: true }` : r.install.skills.map((s) => `install_skill { slug: "${s}" }`).join(", then ");
          return `${i + 1}. ${VARIANT[r.type]} — ${r.reason}\n   ${r.items.map((it) => `${it.name} (${it.slug}, ${it.trust})`).join("; ")}\n   coverage ${Math.round(r.coverage * 100)}%, ~${r.tokens} tokens${r.permissions.length ? `, needs ${r.permissions.join(", ")}` : ""}\n   → ${how}`;
        })
        .join("\n\n");
      return { text, data: { recommendations } };
    },

    async search_skills({ query, limit }) {
      guard();
      const n = Math.min(Math.max(Number(limit) || 8, 1), 20);
      const { results } = await api(cfg, "GET", `/api/v1/cli/search?q=${encodeURIComponent(String(query ?? ""))}&limit=${n}`);
      const text = results.length ? results.map((r) => `- ${r.slug} — ${r.name} (${r.securityLevel}, ${r.category}${r.entrypoint === "http" ? ", gateway only — not installable" : ""}): ${r.description}`).join("\n") : "No results.";
      return { text, data: { results } };
    },

    async install_skill({ slug, skillset, scope }) {
      guard();
      slug = String(slug ?? "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(slug)) throw new CliFail("slug is required — take it from recommend_skills or search_skills");
      const target = inferTarget();
      const global = scope === "global" || target === "claude-desktop";
      if (global && target !== "claude-desktop" && !settings().allowGlobal) throw new CliFail("User-wide installs by agents are turned off", "Install into the project (scope: project), or the user can run: synapth config mcp-global on");
      const project = global ? os.homedir() : await projectDir();
      if (!global && (project === os.homedir() || project === path.parse(project).root)) throw new CliFail(`No project directory: the agent runs in ${project}`, "Open a project folder in the agent, or set SYNAPTH_PROJECT_DIR in the Synapth MCP server config");
      const where = global ? "user-wide" : project;
      if (!(await approve(`Install ${skillset ? "the pack" : ""} “${slug}” from Synapth into ${TARGET_LABEL[target]} (${where})?`))) {
        return { text: "The user declined this installation. Do not retry unless they ask.", data: { installed: [], declined: true } };
      }
      const out = await performInstall(cfg, { slug, set: Boolean(skillset), target, global, project, via: "mcp" });
      const ok = out.results.filter((r) => r.record);
      const failed = out.results.filter((r) => r.error);
      const lines = [`Installed into ${TARGET_LABEL[target]} (${where}):`];
      for (const r of ok) lines.push(`- ${r.bundle.name} v${r.bundle.version} (${r.bundle.securityLevel}) → ${[...r.record.paths, ...r.record.mcp.map((m) => `${m.file} [mcpServers.${m.name}]`)].join(", ")}`);
      for (const r of failed) lines.push(`- FAILED ${r.bundle.name}: ${r.error.message}`);
      for (const s of out.skipped) lines.push(`- skipped ${s.name}: ${s.reason}`);
      if (out.env.length) lines.push(`The user must set these environment variables: ${out.env.join(", ")}.`);
      if (ok.some((r) => r.record.mcp.length)) lines.push(`New MCP servers load after ${TARGET_LABEL[target]} restarts — tell the user.`);
      if (ok.some((r) => r.record.paths.length)) lines.push("New skills load at the start of the next session.");
      lines.push(`Synapth quota: ${out.usage.installsToday}/${limitLabel(out.usage.installsPerDay)} installs today.`);
      return { text: lines.join("\n"), data: { installed: ok.map((r) => ({ slug: r.bundle.slug, version: r.bundle.version, trust: r.bundle.securityLevel, paths: r.record.paths, mcp: r.record.mcp })), skipped: out.skipped, env: out.env, usage: out.usage }, isError: !ok.length && failed.length > 0 };
    },

    async list_installed_skills() {
      const rows = installedHere(await projectDir());
      return { text: rows.length ? rows.map((r) => `- ${r.slug} v${r.version} · ${TARGET_LABEL[r.target]} · ${r.scope === "global" ? "user-wide" : r.project}`).join("\n") : "Nothing installed through Synapth here.", data: { installed: rows } };
    },

    async uninstall_skill({ slug }) {
      guard();
      const project = await projectDir();
      const rows = loadState().filter((r) => r.slug === slug && (r.project === project || (r.scope === "global" && settings().allowGlobal)));
      if (!rows.length) throw new CliFail(`${slug} was not installed by Synapth in this project`);
      if (!(await approve(`Remove “${slug}” (installed by Synapth) from ${rows.map((r) => TARGET_LABEL[r.target]).join(", ")}?`))) return { text: "The user declined.", data: { removed: [] } };
      rows.forEach(removeRecord);
      saveState(loadState().filter((r) => !rows.some((x) => sameInstall(x, r))));
      return { text: `Removed ${slug}.`, data: { removed: rows.map((r) => ({ slug: r.slug, target: r.target })) } };
    },

    async synapth_status() {
      const s = await api(cfg, "GET", "/api/v1/cli/status");
      const text = [
        `Plan: ${planLabel(s.plan.id)}${s.plan.lapsedFrom ? ` (${planLabel(s.plan.lapsedFrom)} ended)` : ""}`,
        `Installs today: ${s.usage.installsToday}/${limitLabel(s.limits.installsPerDay)} (resets ${s.resetAt})`,
        `Packs: ${s.limits.bulk ? "available" : "need Synapth Pro"}`,
        s.device.suspended ? "This machine is paused by the plan's machine limit — installs are blocked." : null,
        ...s.notices.map((n) => NOTICES[n]?.(s)).filter(Boolean),
      ]
        .filter(Boolean)
        .join("\n");
      return { text, data: s };
    },
  };

  async function handle(msg) {
    const { method, params = {} } = msg;
    if (method === "initialize") {
      state.client = params.clientInfo ?? null;
      state.caps = params.capabilities ?? {};
      const protocolVersion = MCP_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : MCP_PROTOCOLS[0];
      return { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "synapth", title: "Synapth", version: VERSION }, instructions: MCP_INSTRUCTIONS };
    }
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: MCP_TOOLS };
    if (method === "resources/list") return { resources: [] };
    if (method === "prompts/list") return { prompts: [] };
    if (method === "tools/call") {
      const impl = TOOLS[params.name];
      if (!impl) throw Object.assign(new Error(`Unknown tool ${params.name}`), { rpc: -32602 });
      try {
        const r = await impl(params.arguments ?? {});
        return { content: [{ type: "text", text: r.text }], structuredContent: r.data, isError: Boolean(r.isError) };
      } catch (err) {
        return { content: [{ type: "text", text: `${err.message}${err.hint ? `\n${err.hint}` : ""}` }], isError: true };
      }
    }
    throw Object.assign(new Error(`Method not found: ${method}`), { rpc: -32601 });
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    // A response to one of our requests (roots, elicitation).
    if (msg.method === undefined && msg.id !== undefined) {
      const p = state.pending.get(msg.id);
      if (p) {
        state.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
      return;
    }
    if (msg.id === undefined) {
      if (msg.method === "notifications/roots/list_changed") state.roots = null;
      return;
    }
    handle(msg).then(
      (result) => send({ jsonrpc: "2.0", id: msg.id, result }),
      (err) => send({ jsonrpc: "2.0", id: msg.id, error: { code: err.rpc ?? -32603, message: err.message } }),
    );
  });
  return new Promise((resolve) => rl.on("close", resolve));
}

// ===========================================================================
// Entry
// ===========================================================================

const HELP = () => `${c.bold("synapth")} ${c.dim(VERSION)} — install Synapth skills into your agents

${c.dim("GET STARTED")}
  ${c.lime("synapth")}                                interactive menu
  ${c.lime("setup")}                                  link, choose an agent, connect Synapth MCP
  ${c.lime("link")} [key] [--name <n>] [--url <u>]    link this machine (key: Settings → CLI)

${c.dim("SKILLS")}
  ${c.lime("install")} [slug] [options]               search & install (no slug = live search)
      --target claude-code|cursor|claude-desktop   -g, --global   --set (pack, Pro)
      --allow-sandbox   --force   -y (no prompts)
  ${c.lime("recommend")} ["task"]                     describe a task, get skills
  ${c.lime("search")} <query>                         keyword search
  ${c.lime("list")} · ${c.lime("update")} <slug>|--all · ${c.lime("uninstall")} [slug]

${c.dim("AGENTS")}
  ${c.lime("mcp")} [add|remove|serve]                 let agents install skills themselves

${c.dim("ACCOUNT")}
  ${c.lime("status")} [--json] · ${c.lime("config")} [key value] · ${c.lime("unlink")} · ${c.lime("upgrade")}
`;

function reportError(err) {
  if (!(err instanceof CliFail)) {
    console.error(err);
    return;
  }
  if (err.code === "cancelled") return;
  if (UPSELL.has(err.code) && colorOn()) {
    print(box([c.bold(err.message), err.hint ? c.dim(err.hint) : null], { title: err.code === "quota_exceeded" ? "Daily quota" : "Synapth Pro", color: c.yellow }));
    return;
  }
  const stream = MCP_MODE ? process.stderr : process.stderr;
  stream.write(`${sym.fail} ${err.message}\n${err.hint ? `  ${c.dim(err.hint)}\n` : ""}`);
}

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) throw new CliFail(`Node ${process.versions.node} is too old`, "Synapth CLI needs Node 18+");
  ARGS = parseArgs(process.argv.slice(2));
  const cmd = ARGS._[0];
  if (ARGS.version || cmd === "version") return print(VERSION);
  if (ARGS.help || cmd === "help") return print(HELP());
  const cfg = loadConfig();
  CFG = cfg;
  switch (cmd) {
    case undefined:
      return interactive() ? menu(cfg) : print(HELP());
    case "setup":
    case "onboard":
      return cmdSetup(cfg, ARGS);
    case "link":
      return cmdLink(cfg, ARGS);
    case "unlink":
      return cmdUnlink(cfg);
    case "status":
    case "whoami":
      return cmdStatus(cfg, ARGS);
    case "search":
      return cmdSearch(cfg, ARGS);
    case "install":
    case "add":
      return cmdInstall(cfg, ARGS);
    case "recommend":
    case "suggest":
      return cmdRecommend(cfg, ARGS);
    case "list":
    case "ls":
      return cmdList(ARGS);
    case "uninstall":
    case "remove":
      return cmdUninstall(ARGS);
    case "update":
      return cmdUpdate(cfg, ARGS);
    case "mcp":
      return cmdMcp(cfg, ARGS);
    case "upgrade":
      return cmdUpgrade(cfg);
    case "config":
      return cmdConfig(cfg, ARGS);
    default:
      throw new CliFail(`Unknown command "${cmd}"`, "See synapth help");
  }
}

main().catch((err) => {
  showCursor();
  reportError(err);
  process.exitCode = 1;
});
