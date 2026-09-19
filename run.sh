#!/usr/bin/env bash
# Synapth launcher.
#
#   ./run.sh            dev server (next dev) on http://localhost:3000
#   ./run.sh prod       typecheck + build + next start
#   ./run.sh check      typecheck + tests + build (no server)
#   ./run.sh crawl      refresh data/catalog.json, then start dev server
#
# Env: PORT (default 3000). Without DATABASE_URL the app runs on the in-memory store.

set -euo pipefail
cd "$(dirname "$0")"

# Ignore a pasted trailing comment ("./run.sh  # dev") — zsh passes '#' as an argument.
MODE="${1:-dev}"
case "$MODE" in \#*) MODE="dev" ;; esac
PORT="${PORT:-3000}"

log() { printf '\033[1;36m[synapth]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[synapth]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "node not found — install Node.js 20+"
command -v npm  >/dev/null || die "npm not found"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required, found $(node -v)"

# Dependencies (postinstall runs prisma generate).
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  log "installing dependencies"
  npm install
fi

# Local env file. GITHUB_TOKEN is deliberately left empty (see CLAUDE.md).
if [ ! -f .env ] && [ -f .env.example ]; then
  log "creating .env from .env.example"
  cp .env.example .env
  if command -v openssl >/dev/null; then
    SECRET="$(openssl rand -base64 32)"
    sed -i.bak "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$SECRET\"|" .env && rm -f .env.bak
  fi
  # Default to the in-memory store: no PostgreSQL required.
  sed -i.bak 's|^DATABASE_URL=.*|DATABASE_URL=""|' .env && rm -f .env.bak
fi

# Sync the schema when a real database is configured.
if [ -f .env ] && grep -Eq '^DATABASE_URL="?postgres' .env; then
  log "DATABASE_URL set — pushing prisma schema"
  npm run db:push
fi

if [ ! -s data/catalog.json ] && [ "$MODE" != "crawl" ]; then
  log "data/catalog.json is missing — the catalogue will be seeded in memory (run ./run.sh crawl to fetch it)"
fi

case "$MODE" in
  dev)
    log "starting dev server on http://localhost:$PORT"
    exec npx next dev -p "$PORT"
    ;;
  prod)
    log "typecheck + build"
    npm run typecheck
    npm run build
    log "starting production server on http://localhost:$PORT"
    exec npx next start -p "$PORT"
    ;;
  check)
    npm run typecheck && npm test && npm run build
    log "all checks passed"
    ;;
  crawl)
    log "crawling catalogue"
    npm run crawl
    log "starting dev server on http://localhost:$PORT"
    exec npx next dev -p "$PORT"
    ;;
  *)
    die "unknown mode '$MODE' (dev | prod | check | crawl)"
    ;;
esac
