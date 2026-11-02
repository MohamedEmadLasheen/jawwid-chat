#!/usr/bin/env bash
# G-38 · end-to-end smoke. Owner: release-qa.
#
# Starts the REAL built API and outbox worker against a Postgres and a Redis you
# name, seeds synthetic people with the real seed CLI, runs
# apps/api/test/e2e/smoke.e2e.ts against them over HTTP and socket.io, and stops
# everything it started.
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5433/jawwid_e2e \
#   REDIS_URL=redis://localhost:6380 \
#     scripts/qa/e2e-smoke.sh
#
# Against the compose stack: `docker compose up -d postgres redis`, create an
# EMPTY throwaway database in it, and point DATABASE_URL there. The script applies
# every migration and the seed refuses a database that is already seeded, so it
# never runs against data that matters. CI runs it on fresh service containers.
#
# Secrets: the JWT and signing secrets and the one QA password are generated
# here, live in a chmod-700 temporary directory, are never printed, and are
# deleted on exit.
#
# Options (environment): E2E_PORT (default 3555), SKIP_BUILD=1 to reuse dist/.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to an empty throwaway database}"
: "${REDIS_URL:?set REDIS_URL}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PORT="${E2E_PORT:-3555}"
BASE="http://127.0.0.1:$PORT"

WORK="$(mktemp -d)"
chmod 700 "$WORK"
PIDS=()
cleanup() {
  status=$?
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  if [ "$status" -ne 0 ]; then
    for f in api worker seed; do
      [ -s "$WORK/$f.log" ] && { echo "---- last lines of $f.log"; tail -n 60 "$WORK/$f.log"; }
    done
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$1"; }

step "migrations"
(cd "$ROOT" && bash scripts/db/apply.sh > "$WORK/migrate.log" 2>&1) || { tail -n 40 "$WORK/migrate.log"; exit 1; }
echo "applied: $(grep -c '^  apply' "$WORK/migrate.log" || true)"

if [ "${SKIP_BUILD:-}" != 1 ]; then
  step "build the API"
  (cd "$API_DIR" && npx prisma generate > "$WORK/build.log" 2>&1 && npm run build >> "$WORK/build.log" 2>&1) \
    || { tail -n 40 "$WORK/build.log"; exit 1; }
fi

step "secrets (generated, never printed)"
(umask 077
 openssl rand -base64 24 | tr -d '\n' > "$WORK/qa.pw"
 {
   echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
   echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
   echo "STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)"
 } > "$WORK/secrets.env")

# The seed insists that --target names the database DATABASE_URL points at.
target="${DATABASE_URL#*://}"; target="${target#*@}"; target="${target%%\?*}"

step "seed synthetic people ($target)"
(cd "$API_DIR" && APP_ENV=ci node dist/cli/seed-org-chat.js \
   --target "$target" --password-file "$WORK/qa.pw" --manifest "$WORK/manifest.json" \
   > "$WORK/seed.log" 2>&1)
tail -n 1 "$WORK/seed.log"

step "start the API and the worker"
start() {
  ( set -a; . "$WORK/secrets.env"; set +a
    export APP_ENV=ci PORT="$PORT" QUEUE_PREFIX="e2e-$$" OUTBOX_POLL_MS=250 OUTBOX_IDLE_BACKOFF_MS=500
    cd "$API_DIR" && exec node "dist/$1.js" ) > "$WORK/$2.log" 2>&1 &
  PIDS+=("$!")
}
start main api
start worker worker
for i in $(seq 1 60); do
  curl -sf "$BASE/health/ready" >/dev/null 2>&1 && break
  kill -0 "${PIDS[0]}" 2>/dev/null || { echo "the API exited during start-up"; exit 1; }
  sleep 1
done
curl -sf "$BASE/health/ready" >/dev/null || { echo "the API was not ready after 60 s"; exit 1; }
echo "ready after ${i}s on $BASE"

step "end-to-end smoke"
(cd "$API_DIR" && E2E_BASE_URL="$BASE" E2E_MANIFEST="$WORK/manifest.json" E2E_PASSWORD_FILE="$WORK/qa.pw" \
   npm run --silent test:e2e)
