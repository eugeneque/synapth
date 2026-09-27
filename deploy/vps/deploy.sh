#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <application-image> <migrator-image>" >&2
  exit 2
fi

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "$(pwd)/.env is missing" >&2
  exit 1
fi

app_image=$1
migrator_image=$2
compose=(docker compose --env-file .env --env-file .images.env)
previous_images=""

if [ -f .images.env ]; then
  previous_images=$(mktemp)
  cp .images.env "$previous_images"
fi

printf 'SYNAPTH_IMAGE=%s\nSYNAPTH_MIGRATOR_IMAGE=%s\n' "$app_image" "$migrator_image" > .images.env

rollback() {
  if [ -n "$previous_images" ] && [ -f "$previous_images" ]; then
    echo "New application did not become healthy; restoring the previous image" >&2
    cp "$previous_images" .images.env
    "${compose[@]}" up -d --no-deps app
  fi
}
trap rollback ERR

"${compose[@]}" pull app migrate
"${compose[@]}" up -d db
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --no-deps app

container_id=$("${compose[@]}" ps -q app)
for _ in $(seq 1 45); do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  if [ "$health" = "healthy" ]; then
    trap - ERR
    [ -z "$previous_images" ] || rm -f "$previous_images"
    echo "Synapth is healthy on $app_image"
    exit 0
  fi
  if [ "$health" = "unhealthy" ] || [ "$health" = "exited" ] || [ "$health" = "dead" ]; then
    "${compose[@]}" logs --tail=150 app >&2
    exit 1
  fi
  sleep 2
done

"${compose[@]}" logs --tail=150 app >&2
echo "Timed out waiting for the application health check" >&2
exit 1
