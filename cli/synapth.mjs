/**
 * Synapth CLI — links this machine to a Synapth account, installs catalogue
 * entries (skills, MCP servers, skillsets) into local agents, and runs the
 * local Synapth MCP server through which those agents install skills
 * themselves.
 *
 *   curl -fsSL https://synapth.ru/cli/install | sh
 *   synapth setup                 # link, pick an agent, connect Synapth MCP
 *   synapth install <slug>        # or just `synapth` for the interactive menu
 *
 * Bundled by `scripts/build-cli.mjs` (with `synapth migrate`, cli/migrate.ts)
 * into one dependency-free file served at /cli/synapth.mjs; Node 18+. The server decides plan, quota and trust; this
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
import { HANDS } from "./hands-art.mjs";
import { LANGS, LANG_NAMES, createT, detectLang } from "./i18n.mjs";
import { runMigrate } from "./migrate.ts";

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

/** Interface language: the saved choice, else the OS locale. The MCP server always speaks English (agents read it). */
const lang = () => (MCP_MODE ? "en" : LANGS.includes(CFG.lang) ? CFG.lang : detectLang(env));
const tr = createT(lang);

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
/** Terminal cells a code point takes: CJK is double-width. */
const charWidth = (cp) =>
  cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) ? 2 : 1;
const visibleLength = (s) => {
  let n = 0;
  for (const ch of stripAnsi(s)) n += charWidth(ch.codePointAt(0));
  return n;
};
/** Pads to `n` cells (padEnd counts code units, which breaks columns for CJK). */
const padCells = (s, n) => `${s}${" ".repeat(Math.max(0, n - visibleLength(s)))}`;

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
    const w = charWidth(ch.codePointAt(0));
    if (vis + w > width - 1) {
      out += "…";
      break;
    }
    out += ch;
    vis += w;
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

/**
 * Full-screen mode: the terminal's alternate screen, like vim or htop. Whatever the
 * menu draws disappears on exit and the shell's scrollback is left exactly as it was.
 */
let altScreen = false;
let screenDepth = 0;
const leaveScreen = () => {
  if (altScreen) {
    process.stdout.write("\x1b[?1049l");
    altScreen = false;
  }
};
const clearScreen = () => isTTY() && process.stdout.write("\x1b[2J\x1b[H");
async function fullscreen(fn) {
  const outer = screenDepth++ === 0;
  if (outer && interactive() && !altScreen) {
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
    altScreen = true;
  }
  try {
    return await fn();
  } finally {
    screenDepth--;
    if (outer) leaveScreen();
  }
}

process.on("exit", () => {
  showCursor();
  leaveScreen();
});
process.on("SIGINT", () => {
  showCursor();
  leaveScreen();
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

// ---------------------------------------------------------------------------
// Home scene — the hero's hands in ASCII (cli/hands-art.mjs, sampled from
// public/hero-hands.png): they slide in, touch, and a synapse sparks between
// the fingertips while the logo is drawn under them.
// ---------------------------------------------------------------------------

const RAMP = " .:-=+*#%@";
const HAND_STOPS = [
  [52, 78, 42],
  [104, 168, 58],
  [198, 244, 50],
  [240, 255, 160],
];
const SPARKS = ["✦", "✧", "*", "+", "·"];
const DUST = ["·", ".", "'", "˙"];
const handCache = new Map();

const noise = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Parses a density grid; finds the gap between the hands, the two fingertips and a halo of dust. */
function prepareHands(rows) {
  if (handCache.has(rows)) return handCache.get(rows);
  const h = rows.length;
  const w = rows[0].length;
  const lvl = rows.map((r) => Uint8Array.from(r, (d) => Number(d)));
  let mid = Math.floor(w / 2);
  let least = Infinity;
  for (let x = Math.floor(w * 0.35); x <= Math.ceil(w * 0.65); x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) sum += lvl[y][x];
    if (sum < least) {
      least = sum;
      mid = x;
    }
  }
  const tip = (from, to, step) => {
    for (let x = from; x !== to; x += step) {
      const ys = [];
      for (let y = 0; y < h; y++) if (lvl[y][x] >= 3) ys.push(y);
      if (ys.length) return { x, y: ys[Math.floor(ys.length / 2)] };
    }
    return { x: step > 0 ? w - 1 : 0, y: Math.floor(h / 2) };
  };
  const dust = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (lvl[y][x]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -3; dx <= 3; dx++) if ((lvl[y + dy]?.[x + dx] ?? 0) >= 2) near = true;
      if (near && noise(x, y) < 0.14) dust.push({ x, y });
    }
  }
  const art = { lvl, w, h, mid, dust, left: tip(mid - 1, -1, -1), right: tip(mid, w, 1) };
  handCache.set(rows, art);
  return art;
}

const handColor = (l) => {
  const f = (Math.min(9, Math.max(0, l)) / 9) * (HAND_STOPS.length - 1);
  const k = Math.min(HAND_STOPS.length - 2, Math.floor(f));
  return rgb([0, 1, 2].map((j) => lerp(HAND_STOPS[k][j], HAND_STOPS[k + 1][j], f - k)));
};

/** One frame of the hands as terminal lines. `offL`/`offR` slide the halves; `sweep` is a highlight column; `spark` (0-1) the synapse. */
function composeHands(art, { offL = 0, offR = 0, sweep = -99, spark = 0, frame = 0, pad = 0 } = {}) {
  const { lvl, w, h, mid, dust, left, right } = art;
  const grid = Array.from({ length: h }, () => new Array(w).fill(0));
  const glyph = Array.from({ length: h }, () => new Array(w).fill(null));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = x - offL;
      const b = x - offR;
      if (a >= 0 && a < mid) grid[y][x] = lvl[y][a];
      if (b >= mid && b < w) grid[y][x] = Math.max(grid[y][x], lvl[y][b]);
    }
  }
  if (offL === 0 && offR === 0) {
    for (const d of dust) if (noise(d.x + frame * 7, d.y + frame) < 0.5) glyph[d.y][d.x] = { ch: DUST[(d.x + d.y + frame) % DUST.length], l: 2 };
  }
  if (spark > 0) {
    const xa = left.x + offL + 1;
    const xb = right.x + offR - 1;
    const ym = Math.round((left.y + right.y) / 2);
    const put = (x, y, l = 9) => x >= 0 && x < w && y >= 0 && y < h && !grid[y][x] && (glyph[y][x] = { ch: SPARKS[Math.floor(Math.random() * SPARKS.length)], l });
    for (let x = xa; x <= xb; x++) put(x, ym + Math.round((Math.random() * 2 - 1) * spark * 1.4));
    const cx = Math.round((xa + xb) / 2);
    for (let i = 0; i < 6; i++) if (Math.random() < spark) put(cx + Math.round((Math.random() * 2 - 1) * 5), ym + Math.round((Math.random() * 2 - 1) * 2), 8);
    put(cx, ym, 9);
  }
  const out = [];
  for (let y = 0; y < h; y++) {
    let line = " ".repeat(pad);
    let last = "";
    for (let x = 0; x < w; x++) {
      const g = glyph[y][x];
      let ch;
      let l;
      if (g) {
        ch = g.ch;
        l = g.l;
      } else {
        l = grid[y][x];
        ch = RAMP[l];
      }
      if (ch === " ") {
        line += " ";
        continue;
      }
      if (Math.abs(x - sweep) <= 2 && l > 0) l = Math.min(9, l + 5 - Math.abs(x - sweep));
      const color = handColor(l);
      if (color !== last) {
        line += color;
        last = color;
      }
      line += ch;
    }
    out.push(colorOn() ? `${line}\x1b[0m` : line.trimEnd());
  }
  return out;
}

const LOGO = ["█▀ █▄█ █▄ █ ▄▀█ █▀█ ▀█▀ █ █", "▄█  █  █ ▀█ █▀█ █▀▀  █  █▀█"];
const LOGO_ROWS = 17;

/**
 * The CLI's front page: hands, logo, tagline. `animate` plays the slide-in and the spark
 * (first view only); later views print the finished frame. Hands need room: the wide
 * grid wants 78 columns and 29 rows, the narrow one 48 and 24, otherwise just the logo.
 */
async function homeScreen({ animate = false, sub = tr("tagline") } = {}) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 40;
  const grid = cols >= 78 && rows >= LOGO_ROWS + HANDS.wide.length + 1 ? HANDS.wide : cols >= 48 && rows >= LOGO_ROWS + HANDS.narrow.length + 1 ? HANDS.narrow : null;
  const art = grid ? prepareHands(grid) : null;
  const pad = art ? Math.max(0, Math.floor((cols - art.w) / 2)) : 0;
  const center = (width) => " ".repeat(Math.max(2, Math.floor((cols - width) / 2)));
  const tag = `${c.dim(sub)}  ${c.dim(`v${VERSION}`)}`;
  const tagLine = `${center(visibleLength(tag))}${tag}`;
  const logo = (reveal = LOGO[0].length, shift = 0) => LOGO.map((l) => `${center(LOGO[0].length)}${gradient([...l].slice(0, reveal).join(""), LIME, shift)}`);
  const still = () => ["", ...(art ? composeHands(art, { pad }) : []), "", ...logo(), tagLine, ""].join("\n");
  if (!animate || !animOn()) return print(still());

  const live = new Live();
  hideCursor();
  const empty = ["", "", "", ""];
  if (art) {
    const far = Math.round(art.w * 0.55);
    for (let f = 0; f <= 20; f++) {
      const off = Math.round((1 - (1 - (1 - f / 20) ** 3)) * far);
      live.render(["", ...composeHands(art, { offL: -off, offR: off, pad }), "", ...empty].join("\n"));
      await sleep(30);
    }
  }
  for (let f = 0; f <= 18; f++) {
    const spark = f < 12 ? 1 : Math.max(0, 1 - (f - 12) / 6);
    const reveal = Math.round(Math.min(1, f / 12) * LOGO[0].length);
    const hands = art ? composeHands(art, { pad, frame: f, spark, sweep: Math.round((f / 18) * (art.w + 8)) - 4 }) : [];
    live.render(["", ...hands, "", ...logo(reveal, f * 0.05), f > 10 ? tagLine : "", ""].join("\n"));
    await sleep(34);
  }
  live.done(still());
  showCursor();
}

/** A compact title bar for the screens behind the menu; the gradient sweeps across once. `step` draws ●●○ progress. */
async function screenHeader(title, { step } = {}) {
  const cols = Math.min(process.stdout.columns || 80, 72);
  const dots = step ? `   ${Array.from({ length: step.total }, (_, i) => (i < step.n ? c.lime("●") : c.dim("○"))).join(" ")}` : "";
  const line = (shift) => `  ${gradient("◉──●", LIME, shift)} ${c.bold("SYNAPTH")} ${c.dim("›")} ${c.bold(title)}${dots}`;
  const rule = c.dim(`  ${"─".repeat(Math.max(8, cols - 4))}`);
  if (animOn()) {
    const live = new Live();
    hideCursor();
    for (let f = 0; f < 9; f++) {
      live.render(`\n${line(f * 0.11)}\n${c.dim(`  ${"─".repeat(Math.round(((f + 1) / 9) * Math.max(8, cols - 4)))}`)}`);
      await sleep(22);
    }
    live.done(`\n${line(0)}\n${rule}\n`);
    showCursor();
  } else print(`\n${line(0)}\n${rule}\n`);
}

/** `label  value` rows with the labels padded to the widest one (labels may be CJK). */
const kv = (pairs) => {
  const w = Math.max(...pairs.map(([k]) => visibleLength(k)));
  return pairs.map(([k, v]) => (v === null || v === undefined || v === false ? null : `${c.dim(padCells(k, w))}  ${v}`));
};

/** The logo alone — used where the full scene does not fit. */
async function banner(sub = tr("tagline")) {
  return homeScreen({ animate: false, sub });
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
      if (k.ctrl && k.name === "c") return ctx.cancel(`${sym.fail} ${c.dim(tr("cancelled"))}`);
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
    ctx.render([`${question(message)}${q ? `  ${c.lime(q)}${c.dim("▏")}` : ""}`, ...(list.length ? choiceRows(list, idx, pageSize) : [c.dim(`  ${tr("hint.noMatch")}`)]), c.dim(`  ${tr("hint.select")}${filter ? tr("hint.filter") : ""}${tr("hint.cancel")}`)].join("\n"));
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
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim(`· ${tr("cancelled")}`)}`);
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
    ctx.render([question(message), ...choiceRows(choices, idx, pageSize, { checked: picked }), error ? `  ${c.red(error)}` : c.dim(`  ${tr("hint.multi")}`)].join("\n"));
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
        if (!picked.size && !allowEmpty) error = tr("hint.pickOne");
        else {
          const values = choices.filter((ch) => picked.has(ch.value));
          return ctx.finish(answered(message, values.length ? values.map((v) => stripAnsi(v.label)).join(", ") : tr("none")), values.map((v) => v.value));
        }
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim(`· ${tr("cancelled")}`)}`);
      draw(ctx);
    },
  });
}

async function confirm({ message, initial = true }) {
  ensureInteractive(message);
  let v = initial;
  const draw = (ctx) => ctx.render(`${question(message)}  ${v ? c.inverse(c.lime(` ${tr("yes")} `)) : c.dim(` ${tr("yes")} `)} ${v ? c.dim(` ${tr("no")} `) : c.inverse(` ${tr("no")} `)}  ${c.dim("y/n")}`);
  return runPrompt({
    start: draw,
    key(str, k, ctx) {
      if (["left", "right", "tab", "h", "l"].includes(k.name)) v = !v;
      else if (str === "y" || str === "Y") v = true;
      else if (str === "n" || str === "N") v = false;
      else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim(`· ${tr("cancelled")}`)}`);
      if (k.name === "return" || /^[yYnN]$/.test(str ?? "")) return ctx.finish(answered(message, v ? tr("yes.lower") : tr("no.lower")), v);
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
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim(`· ${tr("cancelled")}`)}`);
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
async function searchSelect({ message, search, placeholder = tr("hint.typeToSearch"), pageSize = 7 }) {
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
    const body = error ? [`  ${c.red(error)}`] : items.length ? choiceRows(items, idx, pageSize) : [c.dim(`  ${loading ? tr("hint.searching") : tr("hint.nothingFound")}`)];
    ctxRef.render([head, ...body, c.dim(`  ${tr("hint.select")}${tr("hint.cancel")}`)].join("\n"));
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
      } else if (k.name === "escape") return ctx.cancel(`${sym.fail} ${message} ${c.dim(`· ${tr("cancelled")}`)}`);
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
const DEFAULT_URL = "https://synapth.ru";
// Pre-launch staging host that early installers saved into config.json.
const LEGACY_HOST = /^https?:\/\/synapth\.localhost8081\.ru(?=\/|$)/;
const baseUrl = (cfg) => (env.SYNAPTH_URL || cfg.baseUrl || DEFAULT_URL).replace(LEGACY_HOST, DEFAULT_URL).replace(/\/$/, "");
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
        done: (r) => (r.installed.length ? `${tr("install.cleared", { n: r.installed.length })}${r.skipped.length ? c.dim(` · ${r.skipped.length} ${tr("install.skipped")}`) : ""}` : tr("install.nothing")),
      }),
    bundleStart(b, i, n) {
      spin = spinner(`${prefix(i, n)}${tr("install.installing")} ${c.bold(b.name)} ${c.dim(`v${b.version}`)}`);
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

async function chooseTarget(cfg, args, message = tr("install.which")) {
  if (args.target) {
    if (!TARGETS.includes(args.target)) throw new CliFail(`Unknown target "${args.target}"`, `One of: ${TARGETS.join(", ")}`);
    return args.target;
  }
  if (cfg.defaultTarget) return cfg.defaultTarget;
  if (!interactive()) return "claude-code";
  const det = detectAgents();
  const target = await select({
    message,
    choices: TARGETS.map((x) => ({ label: TARGET_LABEL[x], value: x, hint: det[x] ? c.lime(`● ${tr("detected")}`) : tr("notFound") })),
    initial: Math.max(0, TARGETS.findIndex((x) => det[x])),
    filter: false,
  });
  cfg.defaultTarget = target;
  saveConfig(cfg);
  print(c.dim(`  ${tr("install.savedDefault")}`));
  return target;
}

function renderInstallSummary(out) {
  const ok = out.results.filter((r) => r.record);
  for (const s of out.skipped) print(`${c.dim("–")} ${s.name} ${c.dim(`${tr("install.skipped")} (${s.reason})`)}`);
  if (!ok.length) return;
  const hasMcp = ok.some((r) => r.record.mcp.length);
  const hasSkills = ok.some((r) => r.record.paths.length);
  print(
    box(
      [
        ...kv([
          [tr("install.agent"), `${TARGET_LABEL[out.target]} ${c.dim(out.global ? `· ${tr("install.userWide")}` : `· ${tilde(out.project) === "./" ? tr("install.thisProject") : tilde(out.project)}`)}`],
          [tr("install.setEnv"), out.env.length ? c.yellow(out.env.join(", ")) : null],
          [tr("install.today"), `${meter(out.usage.installsToday, out.usage.installsPerDay)} ${c.dim(tr("install.installs"))}`],
        ]),
        hasMcp ? c.dim(tr("install.restart", { agent: TARGET_LABEL[out.target] })) : null,
        hasSkills && !hasMcp ? c.dim(tr("install.nextSession")) : null,
      ],
      { title: tr("install.count", { n: ok.length }) },
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
      print(box([`${trustBadge("Sandbox")} — ${tr("install.unreviewed1")}`, tr("install.unreviewed2"), c.dim(tr("install.unreviewed3"))], { title: tr("install.unreviewed"), color: c.yellow }));
      if (!(await confirm({ message: tr("install.anyway"), initial: false }))) return null;
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
    disabled: r.entrypoint === "http" ? tr("install.runsOnGateway") : false,
  }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function doLink(cfg, key, args) {
  if (args.url) cfg.baseUrl = args.url.replace(/\/$/, "");
  const machine = { machineId: cfg.machineId, name: (args.name || os.hostname()).slice(0, 64), platform: process.platform, arch: process.arch, cliVersion: VERSION };
  const res = await step(tr("link.linking", { name: c.bold(machine.name), url: baseUrl(cfg) }), () => api(cfg, "POST", "/api/v1/cli/link", { key, machine }, { auth: false }), { frames: FRAMES.synapse, done: tr("link.handshake", { url: baseUrl(cfg) }) });
  cfg.token = res.token;
  cfg.device = { id: res.device.id, name: res.device.name };
  saveConfig(cfg);
  const status = await api(cfg, "GET", "/api/v1/cli/status");
  cfg.user = { handle: status.user.handle };
  saveConfig(cfg);
  await sparkle(tr("link.done", { device: res.device.name, handle: status.user.handle, plan: planLabel(status.plan.id) }));
  print(c.dim(`  ${tr("link.token", { file: tilde(CONFIG) })}`));
  showNotices(status);
  return status;
}

const KEY_RE = /^slk_[0-9A-Za-z]{32}$/;

/** Why a pasted value is not a link key; API keys and device tokens look alike, so name them. */
function linkKeyProblem(value) {
  if (KEY_RE.test(value)) return "";
  if (/^(sk_live_|syn_)/.test(value)) return tr("key.apiKey");
  if (value.startsWith("sdt_")) return tr("key.deviceToken");
  return tr("key.format");
}

async function cmdLink(cfg, args) {
  let key = args._[1];
  if (!key && interactive()) {
    print(c.dim(`  ${tr("link.issue", { url: `${baseUrl(cfg)}/dashboard/settings#cli` })}`));
    key = await input({ message: tr("setup.pasteKey"), mask: true, placeholder: "slk_…", validate: linkKeyProblem });
  }
  if (!key) throw new CliFail("Usage: synapth link <slk_… key>", "Issue the key in Settings → CLI on the Synapth website");
  if (linkKeyProblem(key)) throw new CliFail(linkKeyProblem(key), `${baseUrl(cfg)}/dashboard/settings#cli`);
  await doLink(cfg, key, args);
}

async function cmdUnlink(cfg) {
  if (interactive() && !(await confirm({ message: tr("link.unlinkAsk"), initial: false }))) return;
  if (cfg.token) await step(tr("link.unlinking"), () => api(cfg, "POST", "/api/v1/cli/unlink")).catch((err) => warn(`Server: ${err.message}`));
  delete cfg.token;
  delete cfg.user;
  delete cfg.device;
  saveConfig(cfg);
  print(`${sym.ok} ${tr("link.unlinked")}`);
}

const NOTICES = {
  grace: (s) => tr("notice.grace", { plan: planLabel(s.plan.id), url: s.links.billing }),
  past_due: (s) => tr("notice.pastDue", { url: s.links.billing }),
  expired: (s) => tr("notice.expired", { plan: planLabel(s.plan.lapsedFrom), url: s.links.billing }),
  cancel_scheduled: (s) => tr("notice.cancel", { plan: planLabel(s.plan.id), date: s.plan.periodEnd?.slice(0, 10) }),
  quota_low: (s) => tr("notice.quotaLow", { used: s.usage.installsToday, limit: limitLabel(s.limits.installsPerDay) }),
  quota_exhausted: (s) => tr("notice.quotaOut", { time: s.resetAt.slice(11, 16), url: s.links.billing }),
  device_suspended: (s) => tr("notice.suspended", { n: limitLabel(s.limits.devices), url: s.links.devices }),
  cli_update: (s) => tr("notice.update", { version: s.cli.latest }),
};
const showNotices = (s) => s.notices.forEach((n) => NOTICES[n] && warn(NOTICES[n](s)));

async function cmdStatus(cfg, args) {
  const s = args.json ? await api(cfg, "GET", "/api/v1/cli/status") : await step(tr("status.reading"), () => api(cfg, "GET", "/api/v1/cli/status"), { done: (r) => `@${r.user.handle}` });
  if (args.json) return print(JSON.stringify(s, null, 2));
  const connected = TARGETS.filter(mcpRegistered).map((x) => TARGET_LABEL[x]);
  const until = s.plan.periodEnd ? ` ${tr("status.until", { date: s.plan.periodEnd.slice(0, 10) })}` : "";
  const plan = `${c.lime(c.bold(planLabel(s.plan.id)))}${s.plan.status !== "none" ? c.dim(` · ${s.plan.status}${until}`) : ""}`;
  print(
    box(
      kv([
        [tr("status.plan"), plan],
        [tr("status.installs"), `${meter(s.usage.installsToday, s.limits.installsPerDay)} ${c.dim(tr("status.today", { time: s.resetAt.slice(11, 16) }))}`],
        [tr("status.machines"), `${meter(s.usage.devices, s.limits.devices)} ${c.dim(`· ${tr("status.this", { name: s.device.name })}`)}${s.device.suspended ? c.red(tr("status.paused")) : ""}`],
        [tr("status.skillsets"), s.limits.bulk ? c.lime(tr("status.included")) : c.dim(tr("status.pro"))],
        [tr("status.agentMcp"), connected.length ? c.lime(connected.join(", ")) : c.dim(tr("status.notConnected"))],
        ["CLI", `${VERSION}${s.cli.latest !== VERSION ? c.yellow(` → ${s.cli.latest}`) : ""} ${c.dim(`· ${baseUrl(cfg)}`)}`],
      ]),
      { title: `@${s.user.handle}${s.user.name ? ` · ${s.user.name}` : ""}` },
    ),
  );
  showNotices(s);
}

async function cmdSearch(cfg, args) {
  const q = args._.slice(1).join(" ");
  if (!q && interactive()) return cmdInstall(cfg, { ...args, _: ["install"] });
  const { results, skillsets = [] } = await step(tr("search.searching", { q: c.bold(q || tr("search.catalogue")) }), () => api(cfg, "GET", `/api/v1/cli/search?q=${encodeURIComponent(q)}&limit=${Number(args.limit) || 10}`), { done: (r) => tr("search.results", { n: r.results.length + (r.skillsets?.length ?? 0) }) });
  if (args.json) return print(JSON.stringify(skillsets.length ? { results, skillsets } : results, null, 2));
  if (!results.length && !skillsets.length) return print(c.dim(tr("search.nothing")));
  for (const k of skillsets) {
    print(`\n${c.bold(k.name)} ${c.dim(k.slug)}  ${c.dim(tr("search.skillset", { n: k.total }))}${k.verified ? ` ${c.lime(tr("search.verified"))}` : ""}`);
    print(`  ${c.dim(k.summary)}`);
    print(`  ${c.dim(tr("search.installSet", { slug: k.slug }))}`);
  }
  for (const r of results) {
    print(`\n${c.bold(r.name)} ${c.dim(r.slug)} ${c.dim(`v${r.version}`)}  ${trustBadge(r.securityLevel)} ${c.dim(r.category)}${r.entrypoint === "http" ? c.dim(" · gateway only") : ""}`);
    print(`  ${c.dim(r.description)}`);
  }
  if (interactive()) {
    const choices = results.filter((r) => r.entrypoint !== "http").map((r) => ({ label: r.name, value: r.slug, hint: r.slug }));
    if (!choices.length) return;
    print();
    const slug = await select({ message: tr("search.installOne"), choices: [...choices, { label: c.dim(tr("search.noThanks")), value: null }] });
    if (slug) await installFlow(cfg, slug, args);
  } else print(c.dim(`\n${tr("search.installHint")}`));
}

async function cmdInstall(cfg, args) {
  let slug = args._[1];
  if (!slug) {
    if (!interactive()) throw new CliFail("Usage: synapth install <slug> [--set] [--target claude-code|cursor|claude-desktop] [--global]");
    slug = await searchSelect({ message: tr("install.find"), search: (q) => searchChoices(cfg, q), placeholder: tr("install.findPlaceholder") });
  }
  await installFlow(cfg, slug, args, { set: Boolean(args.set) });
}

const VARIANT = {
  get pack() {
    return tr("rec.pack");
  },
  get set() {
    return tr("rec.set");
  },
  get skill() {
    return tr("rec.skill");
  },
};

async function cmdRecommend(cfg, args) {
  let task = args._.slice(1).join(" ");
  if (!task) {
    if (!interactive()) throw new CliFail('Usage: synapth recommend "<what your agent should do>"');
    task = await input({ message: tr("rec.ask"), placeholder: tr("rec.placeholder"), validate: (v) => (v.length < 3 ? tr("rec.short") : "") });
  }
  const target = args.target || cfg.defaultTarget || "claude-code";
  const call = () => api(cfg, "POST", "/api/v1/cli/recommend", { task, target });
  const { recommendations } = args.json ? await call() : await step(tr("rec.matching"), call, { frames: FRAMES.synapse, done: (r) => tr("rec.options", { n: r.recommendations.length, task: task.slice(0, 60) }) });
  if (args.json) return print(JSON.stringify(recommendations, null, 2));
  if (!recommendations.length) return print(c.dim(tr("rec.nothing")));
  recommendations.forEach((r, i) => {
    print(
      box(
        [
          c.italic(r.reason),
          ...r.items.map((it) => `${c.lime("•")} ${c.bold(it.name)} ${c.dim(it.slug)}  ${trustBadge(it.trust)}`),
          c.dim(`${tr("rec.covers", { pct: Math.round(r.coverage * 100), tokens: r.tokens })}${r.permissions.length ? ` · ${tr("rec.needs", { what: r.permissions.join(", ") })}` : ""}`),
        ],
        { title: `${i + 1} · ${VARIANT[r.type]}${"set" in r.install ? ` · ${r.install.set}` : ""}` },
      ),
    );
  });
  if (!interactive()) return print(c.dim(`\n${tr("rec.installHint")}`));
  const pick = await select({ message: tr("rec.pick"), choices: [...recommendations.map((r, i) => ({ label: `${i + 1} · ${VARIANT[r.type]}`, value: i, hint: r.items.map((it) => it.name).join(", ") })), { label: c.dim(tr("search.noThanks")), value: -1 }], filter: false });
  if (pick < 0) return;
  const chosen = recommendations[pick];
  if ("set" in chosen.install) await installFlow(cfg, chosen.install.set, args, { set: true });
  else for (const slug of chosen.install.skills) await installFlow(cfg, slug, args);
}

function cmdList(args) {
  const rows = loadState();
  if (args.json) return print(JSON.stringify(rows, null, 2));
  if (!rows.length) return print(c.dim(tr("list.empty")));
  const w = Math.max(...rows.map((r) => r.slug.length), visibleLength(tr("list.skill")));
  print(c.dim(`  ${padCells(tr("list.skill"), w)}  ${padCells(tr("list.version"), 9)}  ${padCells(tr("list.agent"), 14)}  ${tr("list.where")}`));
  for (const r of rows) print(`  ${c.bold(r.slug.padEnd(w))}  ${c.dim(`v${r.version}`.padEnd(9))}  ${TARGET_LABEL[r.target].padEnd(14)}  ${c.dim(r.scope === "global" ? tr("install.userWide") : tilde(r.project))}`);
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
    if (!here.length) return print(c.dim(tr("list.emptyHere")));
    ensureInteractive(tr("remove.which"));
    const keys = await multiselect({ message: tr("remove.which"), choices: here.map((r, i) => ({ label: r.slug, value: i, hint: `${TARGET_LABEL[r.target]} · ${r.scope === "global" ? tr("install.userWide") : tr("install.thisProject")}` })) });
    rows = keys.map((k) => here[k]);
  }
  if (!rows.length) throw new CliFail(`${args._[1]} is not installed here`, "See synapth list");
  for (const r of rows) await step(tr("remove.removing", { slug: c.bold(r.slug), agent: TARGET_LABEL[r.target] }), async () => removeRecord(r));
  saveState(loadState().filter((r) => !rows.some((x) => sameInstall(x, r))));
}

async function cmdUpdate(cfg, args) {
  if (!args.all && !args._[1]) throw new CliFail("Usage: synapth update <slug> | --all");
  const rows = args.all ? installedHere() : matching(args._[1], args);
  if (!rows.length) return print(c.dim(tr("update.nothing")));
  if (args.all) {
    const s = await api(cfg, "GET", "/api/v1/cli/status");
    if (!s.limits.bulk) throw new CliFail("update --all needs Synapth Pro", `Update one at a time, or upgrade: ${s.links.billing}`);
  }
  for (const [i, r] of rows.entries()) {
    print(c.dim(`\n[${i + 1}/${rows.length}] ${r.slug} · ${TARGET_LABEL[r.target]}`));
    const out = await performInstall(cfg, { slug: r.slug, target: r.target, global: r.scope === "global", project: r.project ?? process.cwd(), force: true }, cliHooks());
    const before = r.version;
    const after = out.results[0]?.record?.version;
    if (after) print(c.dim(`  ${before === after ? tr("update.same", { v: after }) : `v${before} → ${c.lime(`v${after}`)}`}`));
  }
}

async function cmdUpgrade(cfg) {
  const code = await step(tr("upgrade.downloading"), async () => {
    const res = await fetch(`${baseUrl(cfg)}/cli/synapth.mjs`, { headers: { "User-Agent": `synapth-cli/${VERSION}` } });
    if (!res.ok) throw new CliFail(`Download failed: HTTP ${res.status}`);
    const text = await res.text();
    if (!text.startsWith("#!/usr/bin/env node")) throw new CliFail("The downloaded file does not look like the Synapth CLI");
    return text;
  });
  const self = selfPath();
  fs.writeFileSync(`${self}.new`, code, { mode: 0o755 });
  fs.renameSync(`${self}.new`, self);
  const next = code.match(/(?:const|let|var) VERSION = "([^"]+)"/)?.[1] ?? "?";
  await sparkle(next === VERSION ? tr("upgrade.same", { v: VERSION }) : tr("upgrade.done", { from: VERSION, to: next }));
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
  else if (key === "lang" && value) {
    if (!LANGS.includes(value)) throw new CliFail(tr("lang.usage"));
    cfg.lang = value;
  }
  else if (key) throw new CliFail("Usage: synapth config [url <u> | target <agent> | mcp on|off | mcp-global on|off | mcp-confirm on|off | animations on|off | lang en|ru|zh]");
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
        `${c.dim("lang         ")} ${LANG_NAMES[lang()]}`,
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
      targets = await multiselect({ message: tr("mcp.connectTo"), choices: TARGETS.map((x) => ({ label: TARGET_LABEL[x], value: x, checked: det[x] || mcpRegistered(x), hint: mcpRegistered(x) ? tr("connected") : det[x] ? tr("detected") : tr("notFound") })) });
    }
    for (const x of targets) await step(tr("setup.connecting", { agent: TARGET_LABEL[x] }), async () => registerMcp(x), { done: `${TARGET_LABEL[x]} ${c.dim("→")} ${tilde(mcpConfigFile(x))}` });
    return print(c.dim(`  ${tr("mcp.restart", { agents: targets.map((x) => TARGET_LABEL[x]).join(", ") })}`));
  }
  if (sub === "remove") {
    const targets = args.target ? [args.target] : TARGETS.filter(mcpRegistered);
    for (const x of targets) await step(tr("mcp.disconnecting", { agent: TARGET_LABEL[x] }), async () => unregisterMcp(x));
    return;
  }
  const m = mcpSettings(cfg);
  print(
    box(
      [
        tr("mcp.intro"),
        `${c.dim(tr("mcp.tools"))} recommend_skills · search_skills · install_skill · list_installed_skills · uninstall_skill · synapth_status`,
        "",
        ...TARGETS.map((t) => `${mcpRegistered(t) ? sym.ok : c.dim("○")} ${TARGET_LABEL[t].padEnd(15)} ${c.dim(tilde(mcpConfigFile(t)))}`),
        "",
        `${c.dim(tr("mcp.enabled"))} ${m.enabled ? c.lime("on") : c.red("off")}  ${c.dim(tr("mcp.confirm"))} ${m.confirm ? c.lime("on") : c.yellow("off")}  ${c.dim(tr("mcp.global"))} ${m.allowGlobal ? c.yellow(tr("mcp.allowed")) : c.lime(tr("mcp.projectOnly"))}`,
        c.dim("synapth mcp add · synapth mcp remove · synapth config mcp-global on|off"),
      ],
      { title: "Synapth MCP" },
    ),
  );
}

async function chooseLanguage(cfg) {
  cfg.lang = await select({
    message: tr("lang.hint"),
    choices: LANGS.map((code) => ({ label: LANG_NAMES[code], value: code, hint: code === lang() ? c.lime("●") : c.dim(code) })),
    initial: Math.max(0, LANGS.indexOf(lang())),
    filter: false,
  });
  saveConfig(cfg);
}

async function cmdLang(cfg, args) {
  const code = args._[1];
  if (code) {
    if (!LANGS.includes(code)) throw new CliFail(tr("lang.usage"));
    cfg.lang = code;
    saveConfig(cfg);
  } else if (interactive()) await chooseLanguage(cfg);
  else return print(`${LANG_NAMES[lang()]} (${lang()})`);
  print(`${sym.ok} ${tr("lang.saved", { name: LANG_NAMES[lang()] })}`);
}

/** The wizard is one screen per step (the alternate screen, cleared between steps), with ●●○ progress. */
async function cmdSetup(cfg, args) {
  if (!interactive()) throw new CliFail(tr("setup.needsTerminal"), tr("setup.needsTerminal.hint"));
  const nested = screenDepth > 0;
  const total = cfg.lang ? 3 : 4;
  let n = 0;
  let targets = [];
  const stepScreen = async (title) => {
    n++;
    clearScreen();
    if (n === 1) {
      await homeScreen({ animate: !nested, sub: tr("tagline.setup") });
      print(`  ${Array.from({ length: total }, (_, i) => (i < n ? c.lime("●") : c.dim("○"))).join(" ")}   ${c.bold(title)}\n`);
    } else await screenHeader(title, { step: { n, total } });
  };
  const summary = async () => {
    print();
    await sparkle(tr("setup.allSet"));
    const cmds = [["synapth", "setup.cmd.menu"], ["synapth install", "setup.cmd.install"], ["synapth recommend", "setup.cmd.recommend"], ["synapth status", "setup.cmd.status"]];
    print(box([...cmds.map(([cmd, key]) => `${padCells(c.lime(cmd), 20)}${tr(key)}`), targets.length ? c.dim(tr("setup.restart", { agents: targets.map((x) => TARGET_LABEL[x]).join(", ") })) : null], { title: tr("setup.next") }));
  };

  await fullscreen(async () => {
    if (!cfg.lang) {
      await stepScreen(tr("lang.hint"));
      await chooseLanguage(cfg);
    }

    await stepScreen(tr("setup.account"));
    if (cfg.token) {
      try {
        await step(tr("setup.checking"), () => api(cfg, "GET", "/api/v1/cli/status"), { frames: FRAMES.synapse, done: (s) => tr("setup.linkedTo", { who: c.bold(`@${s.user.handle}`), plan: planLabel(s.plan.id) }) });
      } catch (err) {
        if (err.code !== "device_revoked" && err.code !== "device_invalid") throw err;
        delete cfg.token;
        saveConfig(cfg);
      }
    }
    if (!cfg.token) {
      print(c.dim(`  ${tr("setup.getKey", { url: `${baseUrl(cfg)}/dashboard/settings#cli` })}`));
      const key = await input({ message: tr("setup.pasteKey"), mask: true, placeholder: "slk_…", validate: linkKeyProblem });
      await doLink(cfg, key, args);
      await sleep(700);
    }

    await stepScreen(tr("setup.agent"));
    const det = detectAgents();
    const current = TARGETS.indexOf(cfg.defaultTarget);
    cfg.defaultTarget = await select({
      message: tr("setup.whereDefault"),
      choices: TARGETS.map((x) => ({ label: TARGET_LABEL[x], value: x, hint: det[x] ? c.lime(`● ${tr("detected")}`) : tr("notFound") })),
      initial: current >= 0 ? current : Math.max(0, TARGETS.findIndex((x) => det[x])),
      filter: false,
    });
    saveConfig(cfg);

    await stepScreen(tr("setup.mcp"));
    print(box([tr("setup.mcpBox1"), c.dim(tr("setup.mcpBox2"))], { title: "Synapth MCP" }));
    targets = await multiselect({
      message: tr("setup.connectTo"),
      choices: TARGETS.map((x) => ({ label: TARGET_LABEL[x], value: x, checked: det[x] || mcpRegistered(x), hint: mcpRegistered(x) ? tr("connected") : det[x] ? tr("detected") : tr("notFound") })),
      allowEmpty: true,
    });
    for (const x of targets) await step(tr("setup.connecting", { agent: TARGET_LABEL[x] }), async () => registerMcp(x), { done: `${TARGET_LABEL[x]} ${c.dim("→")} ${tilde(mcpConfigFile(x))}` });

    if (nested) await summary();
  });
  // Standalone: the alternate screen is gone, so the result stays in the user's terminal.
  if (!nested) await summary();
}

/** "Enter — back to the menu": results stay on screen until the user is done reading. */
async function pause() {
  if (!interactive()) return;
  print(`\n${c.dim(`  ${tr("menu.back")}`)}`);
  await runPrompt({
    start: () => {},
    key: (str, k, ctx) => {
      if (k.name === "return" || k.name === "escape" || k.name === "space") ctx.finish("", undefined);
    },
  }).catch((err) => {
    if (err.code !== "cancelled") throw err;
  });
}

/**
 * The home page and the menu on the alternate screen: every action gets a clean screen with a title bar,
 * and the menu is redrawn from scratch afterwards, so nothing piles up. Quitting restores the terminal.
 */
async function menu(cfg) {
  const ITEMS = [
    ["install", "menu.install", (c0) => cmdInstall(c0, { _: ["install"] })],
    ["recommend", "menu.recommend", (c0) => cmdRecommend(c0, { _: ["recommend"] })],
    ["list", "menu.list", () => cmdList({})],
    ["update", "menu.update", (c0) => cmdUpdate(c0, { _: ["update"], all: true })],
    ["uninstall", "menu.uninstall", () => cmdUninstall({ _: ["uninstall"] })],
    ["mcp", "menu.mcp", (c0) => cmdMcp(c0, { _: ["mcp", interactive() ? "add" : "status"] })],
    ["status", "menu.status", (c0) => cmdStatus(c0, {})],
  ];
  const cancelled = (err) => err.code === "cancelled";
  await fullscreen(async () => {
    let animate = true;
    for (;;) {
      clearScreen();
      await homeScreen({ animate });
      animate = false;
      if (!cfg.lang) {
        try {
          await chooseLanguage(cfg);
        } catch (err) {
          if (cancelled(err)) return;
          throw err;
        }
        continue;
      }
      if (!cfg.token) {
        print(box([tr("menu.unlinked")], { title: tr("menu.welcome"), color: c.cyan }));
        try {
          if (!(await confirm({ message: tr("menu.runSetup") }))) return;
          await cmdSetup(cfg, ARGS);
        } catch (err) {
          if (cancelled(err)) return;
          reportError(err);
        }
        await pause();
        continue;
      }
      let action;
      try {
        action = await select({
          message: tr("menu.title"),
          filter: false,
          pageSize: ITEMS.length + 2,
          choices: [
            ...ITEMS.map(([value, key]) => ({ label: tr(key), value, hint: value === "recommend" ? tr("menu.recommend.hint") : undefined })),
            { label: tr("menu.language"), value: "lang", hint: LANG_NAMES[lang()] },
            { label: c.dim(tr("menu.quit")), value: "quit" },
          ],
        });
      } catch (err) {
        if (cancelled(err)) action = "quit";
        else throw err;
      }
      if (action === "quit") return;
      if (action === "lang") {
        clearScreen();
        await homeScreen();
        try {
          await chooseLanguage(cfg);
        } catch (err) {
          if (!cancelled(err)) throw err;
        }
        continue;
      }
      const [, key, run] = ITEMS.find(([value]) => value === action);
      clearScreen();
      await screenHeader(tr(key));
      try {
        await run(cfg);
      } catch (err) {
        if (!cancelled(err)) reportError(err);
      }
      await pause();
    }
  });
  if (interactive()) print(c.dim(`  ${tr("bye")}`));
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
      "Look in Synapth for tools when the user starts a task (a mobile or web app, an API, a database, a deploy…) or needs a capability you do not have (a browser, an issue tracker, a code-review style…). Describe the task in plain words; returns up to 3 options (a skillset/pack, a set or a single skill) with trust level and what to pass to install_skill. Tell the user you are checking Synapth. Read-only.",
    inputSchema: { type: "object", properties: { task: { type: "string", description: "What needs to be done, in plain words (≤ 2000 chars)." } }, required: ["task"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "search_skills",
    title: "Search the Synapth catalogue",
    description: "Keyword search over Synapth skills, MCP servers and skillsets (packs). Skillsets are listed separately with their entries. Read-only.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"] },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "install_skill",
    title: "Install a Synapth skill",
    description:
      "Installs a skill or MCP server from Synapth into this agent (current project by default). Pass the slug from recommend_skills/search_skills; for a skillset (pack) pass skillset: true. Propose it to the user and get a yes in chat first. Never installs unreviewed (Sandbox) entries. Counts against the user's daily Synapth quota; the user may be asked to approve. New MCP servers need an agent restart; skills load in the next session.",
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

const MCP_INSTRUCTIONS = [
  "Synapth (synapth.ru) is a catalogue of agent skills, MCP servers and skillsets (packs of them). The user connected it to you on purpose, so use it.",
  "WHEN TO LOOK: when a task builds or changes something non-trivial (a mobile or web app, an API, a database, a deploy, tests, design, an integration…) or needs a capability you lack, call recommend_skills with the task in plain words before reinventing it. Use search_skills for a specific keyword. Both cover skillsets. Skip it for trivial edits, and look once per distinct need.",
  "BE OPEN ABOUT IT: before a lookup say in one short line that you are checking Synapth; afterwards tell the user what you found (name, trust level, why it fits) and always name Synapth as the source. Never present a Synapth tool or skillset as your own.",
  "INSTALL ONLY WITH CONSENT: propose first, in the user's own language, with a short question that names Synapth, the entry, its type and trust level — e.g. “I found «Mobile kit» in Synapth (skillset, Verified, 6 entries: Xcode, SwiftUI…). Install the recommended skills from Synapth into this project?” (Russian: «Установить рекомендуемые навыки из Synapth?»). Then wait for the user's yes in the chat and call install_skill (for a skillset pass skillset: true). Do not install in the turn you first suggest something unless the user already asked for it. Prefer Verified, then Community; never push low-trust entries. Do not repeat an offer the user declined.",
  "AFTER INSTALLING: tell the user what was installed and where, which environment variables they must set, and that new MCP servers need a restart (skills load next session).",
].join("\n");

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
      if (!recommendations.length) return { text: "Checked the Synapth catalogue: nothing fits this task. Try other words or search_skills, and tell the user nothing suitable was found there.", data: { recommendations } };
      const text = recommendations
        .map((r, i) => {
          const how = "set" in r.install ? `install_skill { slug: "${r.install.set}", skillset: true }` : r.install.skills.map((s) => `install_skill { slug: "${s}" }`).join(", then ");
          return `${i + 1}. ${VARIANT[r.type]} — ${r.reason}\n   ${r.items.map((it) => `${it.name} (${it.slug}, ${it.trust})`).join("; ")}\n   coverage ${Math.round(r.coverage * 100)}%, ~${r.tokens} tokens${r.permissions.length ? `, needs ${r.permissions.join(", ")}` : ""}\n   → ${how}`;
        })
        .join("\n\n");
      return { text: `From the Synapth catalogue (synapth.ru) — options for this task:\n\n${text}\n\nTell the user these come from Synapth, say which you suggest and why, and ask before installing.`, data: { recommendations } };
    },

    async search_skills({ query, limit }) {
      guard();
      const n = Math.min(Math.max(Number(limit) || 8, 1), 20);
      const { results, skillsets = [] } = await api(cfg, "GET", `/api/v1/cli/search?q=${encodeURIComponent(String(query ?? ""))}&limit=${n}`);
      const lines = [`From the Synapth catalogue (synapth.ru) for “${String(query ?? "").slice(0, 80)}”:`];
      if (skillsets.length) {
        lines.push("", "Skillsets (install whole with install_skill { slug, skillset: true }):");
        for (const k of skillsets) lines.push(`- ${k.slug} — ${k.name}${k.verified ? " (verified set)" : ""}, ${k.total} entries: ${k.summary}\n    ${k.entries.map((e) => `${e.name} (${e.securityLevel})`).join("; ")}${k.total > k.entries.length ? "; …" : ""}`);
      }
      if (results.length) {
        lines.push("", "Single entries (install_skill { slug }):");
        for (const r of results) lines.push(`- ${r.slug} — ${r.name} (${r.securityLevel}, ${r.category}${r.entrypoint === "http" ? ", gateway only — not installable" : ""}): ${r.description}`);
      }
      if (!results.length && !skillsets.length) lines.push("No results.");
      else lines.push("", "Tell the user these come from Synapth and ask before installing.");
      return { text: lines.join("\n"), data: { results, skillsets } };
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

const HELP = () => `${c.bold("synapth")} ${c.dim(VERSION)} — ${tr("help.title")}

${c.dim(tr("help.start"))}
  ${c.lime("synapth")}                                ${tr("help.menu")}
  ${c.lime("setup")}                                  ${tr("help.setup")}
  ${c.lime("link")} [key] [--name <n>] [--url <u>]    ${tr("help.link")}
  ${c.lime("lang")} [en|ru|zh]                        ${tr("help.lang")}

${c.dim(tr("help.skills"))}
  ${c.lime("install")} [slug] [options]               ${tr("help.install")}
      --target claude-code|cursor|claude-desktop   -g, --global   --set (pack, Pro)
      --allow-sandbox   --force   -y (no prompts)
  ${c.lime("recommend")} ["task"]                     ${tr("help.recommend")}
  ${c.lime("search")} <query>                         ${tr("help.search")}
  ${c.lime("list")} · ${c.lime("update")} <slug>|--all · ${c.lime("uninstall")} [slug]

${c.dim(tr("help.agents"))}
  ${c.lime("mcp")} [add|remove|serve]                 ${tr("help.mcp")}
  ${c.lime("migrate")} --from codex|claude [--apply]  ${tr("help.migrate")}

${c.dim(tr("help.account"))}
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
  // migrate parses its own flags (cli/migrate.ts).
  if (cmd === "migrate") return runMigrate(process.argv.slice(process.argv.indexOf("migrate") + 1));
  const cfg = loadConfig();
  CFG = cfg;
  if (ARGS.help || cmd === "help") return print(HELP());
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
    case "lang":
    case "language":
      return cmdLang(cfg, ARGS);
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
