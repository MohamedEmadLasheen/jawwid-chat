#!/usr/bin/env bash
# Local development stack for Jawwid Chat. Owner: AI #7 (infrastructure).
#
#   scripts/infra/dev.sh up      start Postgres + Redis + MinIO, wait for health
#   scripts/infra/dev.sh status  what is running, and on which ports
#   scripts/infra/dev.sh logs    follow logs
#   scripts/infra/dev.sh down    stop; data volumes are preserved
#   scripts/infra/dev.sh nuke    stop AND delete volumes (destroys local data)
#
# This never touches containers it did not create. During bring-up the team
# started Postgres and Redis by hand with `docker run`; `status` reports those
# as legacy and tells you how to migrate, but will not stop or delete them.
# Someone else's uncommitted local data is not ours to discard.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PROJECT=jawwid-chat
LEGACY_CONTAINERS="jawwid-chat-pg jawwid-chat-test"

COMPOSE_CMD=""

# Resolved once, up front. Doing this lazily inside a command whose stderr is
# redirected swallows the diagnostic and leaves the user with a bare exit code.
require_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    cat >&2 <<'MSG'
error: Docker Compose is not installed.

The docker CLI alone is not enough -- `docker compose` is a separate plugin.

  macOS (Homebrew):  brew install docker-compose
                     mkdir -p ~/.docker/cli-plugins
                     ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" \
                             ~/.docker/cli-plugins/docker-compose
  Docker Desktop:    included; ensure the CLI is on PATH
  Linux:             sudo apt-get install docker-compose-plugin

Verify with: docker compose version
MSG
    exit 127
  fi
}

compose() { $COMPOSE_CMD "$@"; }

warn_legacy() {
  local found=""
  for c in $LEGACY_CONTAINERS; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then found="$found $c"; fi
  done
  [ -n "$found" ] || return 0
  cat >&2 <<MSG

note: hand-started containers are present:$found
      They predate this compose stack and may hold ports 5433 / 55432.
      They are NOT managed here and will not be stopped automatically.
      When you are ready to migrate: docker rm -f$found
MSG
}

require_compose

case "${1:-up}" in
  up)
    warn_legacy
    compose up -d --wait
    echo
    "$0" status
    ;;
  status)
    compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || compose ps
    warn_legacy
    ;;
  logs)   shift; compose logs -f "$@" ;;
  down)   compose down ;;
  nuke)
    printf 'This deletes all local Postgres, Redis and MinIO data. Type "yes": '
    read -r reply
    [ "$reply" = "yes" ] || { echo "aborted"; exit 1; }
    compose down -v
    ;;
  *) echo "usage: $0 {up|status|logs|down|nuke}" >&2; exit 64 ;;
esac
