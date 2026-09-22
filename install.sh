#!/usr/bin/env bash
# Synapth server installer — makes sure Node.js 20+ is available (installing
# it via nvm into ~/.nvm if it's missing or too old, no sudo/system changes),
# then hands off to the self-contained installer (scripts/install.mjs).
#
#   ./install.sh                 interactive install
#   ./install.sh --yes           non-interactive (CI/server), sane defaults
#   ./install.sh --yes --database-url=postgresql://... --auth-url=https://example.com
#   ./install.sh --no-auto-node  fail instead of installing Node.js automatically
#
# Requires Linux or macOS. See scripts/install.mjs --help for installer options.

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[1;31m'; CYAN='\033[1;36m'; RESET='\033[0m'
log() { printf "${CYAN}[synapth]${RESET} %s\n" "$*"; }
die() { printf "${RED}[synapth]${RESET} %s\n" "$*" >&2; exit 1; }

NODE_MIN_MAJOR=20
NVM_VERSION="v0.40.1" # https://github.com/nvm-sh/nvm/releases

for a in "$@"; do
  if [ "$a" = "--help" ] || [ "$a" = "-h" ]; then
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
  fi
done

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) die "неподдерживаемая ОС: $(uname -s) (нужен Linux или macOS)" ;;
esac

AUTO_NODE=1
ARGS=()
for a in "$@"; do
  case "$a" in
    --no-auto-node) AUTO_NODE=0 ;;
    *) ARGS+=("$a") ;;
  esac
done

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

install_node_via_nvm() {
  command -v curl >/dev/null 2>&1 || die "нужен curl для автоустановки Node.js через nvm (или поставьте Node.js 20+ вручную)."

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    log "node не найден — ставлю nvm в $NVM_DIR (без sudo, вне системных путей)"
    # nvm's own installer refuses to run when $NVM_DIR is pre-exported but the
    # directory doesn't exist yet (a fresh server has neither) — create it first.
    mkdir -p "$NVM_DIR"
    curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"

  log "ставлю Node.js ${NODE_MIN_MAJOR} через nvm"
  nvm install "$NODE_MIN_MAJOR"
  nvm use "$NODE_MIN_MAJOR" >/dev/null
}

if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
  if [ "$AUTO_NODE" -eq 1 ]; then
    install_node_via_nvm
  else
    die "node не найден (или версия < ${NODE_MIN_MAJOR}). Установите Node.js 20+ — macOS: brew install node · Linux: nvm install 20 (или пакетный менеджер дистрибутива)."
  fi
fi

command -v node >/dev/null 2>&1 || die "не удалось найти node после установки через nvm"
[ "$(node_major)" -ge "$NODE_MIN_MAJOR" ] || die "Node.js ${NODE_MIN_MAJOR}+ требуется, найдено $(node -v)"

log "Node.js $(node -v) готов"
# "${ARGS[@]}" on an empty array trips `set -u` on bash 3.2 (macOS's stock /bin/bash).
if [ "${#ARGS[@]}" -eq 0 ]; then
  exec node scripts/install.mjs
else
  exec node scripts/install.mjs "${ARGS[@]}"
fi
