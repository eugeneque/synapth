#!/usr/bin/env bash
# Synapth server installer — bootstraps the Node.js check, then hands off to
# the self-contained installer (scripts/install.mjs) for the actual work.
#
#   ./install.sh                 interactive install
#   ./install.sh --yes           non-interactive (CI/server), sane defaults
#   ./install.sh --yes --database-url=postgresql://... --auth-url=https://example.com
#
# Requires Node.js 20+ on Linux or macOS. See scripts/install.mjs --help for options.

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[1;31m'; RESET='\033[0m'
die() { printf "${RED}[synapth]${RESET} %s\n" "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) die "неподдерживаемая ОС: $(uname -s) (нужен Linux или macOS)" ;;
esac

command -v node >/dev/null 2>&1 || die "node не найден. Установите Node.js 20+ — macOS: brew install node · Linux: nvm install 20 (или пакетный менеджер дистрибутива)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ требуется, найдено $(node -v)"

exec node scripts/install.mjs "$@"
