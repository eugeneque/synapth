/**
 * GET /cli/install — the POSIX installer behind
 *
 *   curl -fsSL <origin>/cli/install | sh               # install, then the setup wizard
 *   curl -fsSL <origin>/cli/install | sh -s -- slk_…   # install and link this machine
 *
 * Checks Node 18+, downloads /cli/synapth.mjs into ~/.synapth/bin, links
 * `synapth` into a writable directory on PATH, remembers the origin, then
 * hands the terminal to `synapth setup` (keyboard via /dev/tty, since stdin
 * is the pipe). Animations only on a colour TTY; `NO_COLOR`/`CI` get plain
 * lines, `SYNAPTH_NO_SETUP=1` skips the wizard.
 */

import { enforceRequestLimit } from "@/cortex/rate-limit";
import { withErrors } from "@/lib/api";
import { shellQuote } from "@/axon/install";

export const runtime = "nodejs";

function origin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

/** Shell parameter expansion, kept out of the template's own `${…}`. */
const sh = (expr: string) => "$" + "{" + expr + "}";

function installerScript(base: string): string {
  return String.raw`#!/bin/sh
# Synapth CLI installer — ${base.replace(/\n/g, "")}
# The whole script is one function: sh parses it completely before anything runs.
set -eu

main() {
  BASE=${shellQuote(base)}
  DIR="${sh("SYNAPTH_HOME:-$HOME/.synapth")}"
  LOG="$(mktemp 2>/dev/null || echo "/tmp/synapth-install.$$")"

  FANCY=0
  if [ -t 2 ] && [ -z "${sh("NO_COLOR:-")}" ] && [ -z "${sh("CI:-")}" ] && [ "${sh("TERM:-dumb")}" != "dumb" ]; then FANCY=1; fi
  if [ "$FANCY" = 1 ]; then
    E=$(printf '\033')
    R="$E[0m"; B="$E[1m"; D="$E[2m"; RED="$E[91m"; YEL="$E[93m"
    L1="$E[38;5;112m"; L2="$E[38;5;148m"; L3="$E[38;5;154m"; L4="$E[38;5;190m"; L5="$E[38;5;191m"
  else
    E=""; R=""; B=""; D=""; RED=""; YEL=""; L1=""; L2=""; L3=""; L4=""; L5=""
  fi

  trap 'cleanup' EXIT
  trap 'cleanup; exit 130' INT TERM

  banner
  say "  ${sh("D")}Synapth CLI installer · $BASE${sh("R")}"
  say ""

  # 1 · environment ---------------------------------------------------------
  stepline 1 4 "Environment"
  command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required — https://nodejs.org (or: brew install node)"
  NODE_V=$(node --version 2>/dev/null || echo "?")
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || fail "Node.js 18+ is required, found $NODE_V"
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  ok "Node $NODE_V · $(uname -s) $(uname -m)"

  # 2 · download --------------------------------------------------------------
  stepline 2 4 "Download"
  mkdir -p "$DIR/bin"
  chmod 700 "$DIR"
  if [ "$FANCY" = 1 ]; then
    printf '  %s' "$L3" >&2
    curl -fL --progress-bar "$BASE/cli/synapth.mjs" -o "$DIR/bin/synapth.tmp" || fail "Download failed"
    printf '%s' "$R" >&2
    printf '%s[1A%s[2K' "$E" "$E" >&2
  else
    curl -fsSL "$BASE/cli/synapth.mjs" -o "$DIR/bin/synapth.tmp" || fail "Download failed"
  fi
  head -n 1 "$DIR/bin/synapth.tmp" | grep -q '^#!/usr/bin/env node' || { rm -f "$DIR/bin/synapth.tmp"; fail "Unexpected download — is $BASE a Synapth instance?"; }
  chmod 755 "$DIR/bin/synapth.tmp"
  mv "$DIR/bin/synapth.tmp" "$DIR/bin/synapth"
  VERSION=$("$DIR/bin/synapth" --version 2>/dev/null || echo "?")
  ok "synapth $VERSION ${sh("D")}→ $DIR/bin/synapth${sh("R")}"

  # Remember which Synapth this CLI talks to (an existing choice wins).
  node -e 'const fs=require("fs"),[f,u]=process.argv.slice(1);let c={};try{c=JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){}if(!c.baseUrl){c.baseUrl=u;fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n",{mode:0o600})}' "$DIR/config.json" "$BASE"

  # 3 · PATH -------------------------------------------------------------------
  stepline 3 4 "Command"
  run "Linking synapth into PATH" link_bin
  LINKED=$(cat "$LOG")
  if [ -n "$LINKED" ]; then
    ok "synapth ${sh("D")}→ $LINKED/synapth${sh("R")}"
  else
    warn "Add ~/.local/bin to PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  # 4 · agents -----------------------------------------------------------------
  stepline 4 4 "Agents on this machine"
  FOUND=0
  agent "Claude Code" "$(has_claude_code)"
  agent "Cursor" "$( { command -v cursor >/dev/null 2>&1 || [ -d "$HOME/.cursor" ]; } && echo 1 || echo 0)"
  agent "Claude Desktop" "$( { [ -d "$HOME/Library/Application Support/Claude" ] || [ -d "$HOME/.config/Claude" ]; } && echo 1 || echo 0)"
  [ "$FOUND" = 0 ] && warn "No agents found yet — skills can still be installed with --target"

  say ""
  if [ "$#" -gt 0 ]; then
    "$DIR/bin/synapth" link "$1"
  elif [ -z "${sh("SYNAPTH_NO_SETUP:-")}" ] && [ -t 1 ] && (exec </dev/tty) 2>/dev/null; then
    "$DIR/bin/synapth" setup </dev/tty || true
  else
    say "  ${sh("B")}Next:${sh("R")} ${sh("L3")}synapth setup${sh("R")}   ${sh("D")}(link this machine with the key from Settings → CLI)${sh("R")}"
  fi
}

say() { printf '%s\n' "$*" >&2; }
ok() { say "  ${sh("L3")}✔${sh("R")} $*"; }
warn() { say "  ${sh("YEL")}▲${sh("R")} $*"; }
fail() { say "  ${sh("RED")}✖ $*${sh("R")}"; exit 1; }
stepline() { say "${sh("D")}  ── $1/$2 ·${sh("R")} ${sh("B")}$3${sh("R")}"; }

cleanup() {
  [ -n "${sh("E:-")}" ] && printf '%s' "$E[?25h" >&2
  [ -n "${sh("LOG:-")}" ] && rm -f "$LOG"
  return 0
}

nap() { sleep "$1" 2>/dev/null || true; }

banner() {
  if [ "$FANCY" != 1 ]; then say "SYNAPTH"; return; fi
  printf '%s' "$E[?25l" >&2
  say ""
  n=1
  while [ "$n" -le 5 ]; do
    l1=""; l2=""
    [ "$n" -ge 1 ] && { l1="$l1$L1█▀ █▄█ "; l2="$l2$L1▄█  █  "; }
    [ "$n" -ge 2 ] && { l1="$l1$L2█▄ █ "; l2="$l2$L2█ ▀█ "; }
    [ "$n" -ge 3 ] && { l1="$l1$L3▄▀█ "; l2="$l2$L3█▀█ "; }
    [ "$n" -ge 4 ] && { l1="$l1$L4█▀█ ▀█▀ "; l2="$l2$L4█▀▀  █  "; }
    [ "$n" -ge 5 ] && { l1="$l1$L5█ █"; l2="$l2$L5█▀█"; }
    printf '%s[2K  %s%s\n%s[2K  %s%s\n' "$E" "$l1" "$R" "$E" "$l2" "$R" >&2
    [ "$n" -lt 5 ] && printf '%s[2A' "$E" >&2
    nap 0.06
    n=$((n + 1))
  done
  printf '%s' "$E[?25h" >&2
}

frame() {
  case $1 in
    0) printf '⠋' ;; 1) printf '⠙' ;; 2) printf '⠹' ;; 3) printf '⠸' ;; 4) printf '⠼' ;;
    5) printf '⠴' ;; 6) printf '⠦' ;; 7) printf '⠧' ;; 8) printf '⠇' ;; *) printf '⠏' ;;
  esac
}

# run "label" command… — a spinner while it runs; output kept in $LOG.
run() {
  label=$1
  shift
  if [ "$FANCY" != 1 ]; then
    "$@" >"$LOG" 2>&1 && return 0
    say "  ✖ $label"; sed 's/^/    /' "$LOG" >&2; return 1
  fi
  printf '%s' "$E[?25l" >&2
  "$@" >"$LOG" 2>&1 &
  pid=$!
  i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf '\r%s[2K  %s%s%s %s' "$E" "$L3" "$(frame "$i")" "$R" "$label" >&2
    i=$(((i + 1) % 10))
    nap 0.08
  done
  printf '\r%s[2K' "$E" >&2
  printf '%s' "$E[?25h" >&2
  if wait "$pid"; then return 0; fi
  say "  ${sh("RED")}✖${sh("R")} $label"
  sed 's/^/    /' "$LOG" >&2
  return 1
}

# Prints the directory synapth was linked into, or nothing.
link_bin() {
  for d in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
    case ":$PATH:" in *":$d:"*) ;; *) continue ;; esac
    # Directories under $HOME may be on PATH before they exist.
    case "$d" in "$HOME"/*) mkdir -p "$d" 2>/dev/null || true ;; esac
    if [ -d "$d" ] && [ -w "$d" ]; then
      ln -sf "$DIR/bin/synapth" "$d/synapth"
      echo "$d"
      return 0
    fi
  done
  mkdir -p "$HOME/.local/bin" && ln -sf "$DIR/bin/synapth" "$HOME/.local/bin/synapth"
  nap 0.2
}

has_claude_code() { { command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; } && echo 1 || echo 0; }

agent() {
  if [ "$2" = 1 ]; then
    FOUND=1
    say "  ${sh("L3")}●${sh("R")} $1"
  else
    say "  ${sh("D")}○ $1 — not found${sh("R")}"
  fi
}

main "$@"
`;
}

export const GET = withErrors(async (request: Request) => {
  enforceRequestLimit("install", request);
  return new Response(installerScript(origin(request)), { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
