#!/usr/bin/env bash
# Jawwid Chat — Phase 2 live smoke.
#
# WHAT THIS ADDS over the jest suites, which is the only reason it exists:
# they exercise the SERVICES against a real database. This exercises the
# RUNNING SYSTEM — the global AuthGuard, the route table (including whether
# `search` is shadowed by `:messageId`), the error filter, the /api/v1 prefix,
# a real Socket.IO handshake, and the outbox worker actually delivering events
# from one process to a socket held by another.
#
# Every one of those is a place a change can pass every test and still be
# broken in a deployment. The socket handshake race that
# phase2-realtime-handshake.spec.ts now pins was found here and nowhere else.
#
# Usage, from the repository root, with the API and the worker already running
# against the same DATABASE_URL, REDIS_URL and QUEUE_PREFIX:
#
#   scripts/qa/phase2-smoke/run.sh
#
# Environment:
#   API_BASE_URL   default http://127.0.0.1:3999/api/v1
#   REALTIME_URL   default http://127.0.0.1:3999
#   DATABASE_URL   required by the seed step
#
# THE SEED IS DESTRUCTIVE. It truncates the chat schema, so point it at a
# throwaway database and never at anything you mind losing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT/scripts/qa/phase2-smoke"

export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3999/api/v1}"
export REALTIME_URL="${REALTIME_URL:-http://127.0.0.1:3999}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required (the seed connects directly)." >&2
  exit 2
fi

echo "== seeding =="
# The scripts resolve their own dependencies out of apps/api and
# apps/admin-web, so none of them cares what the working directory is.
ids="$(node "$HERE/seed.mjs")"
echo "$ids"

echo
echo "== HTTP =="
node "$HERE/http.mjs" "$ids"

echo
echo "== realtime (Family -> Supervisor) =="
node "$HERE/realtime.mjs" "$ids"

echo
echo "== bidirectional (Supervisor console -> Family mobile) =="
# The second direction, and the one an API-only test cannot cover: the
# supervisor acts through the Admin Web console's OWN endpoint module, so a
# path or body the console gets wrong fails here rather than in a browser.
node "$HERE/bidirectional.mjs" "$ids"

echo
echo "PHASE 2 LIVE SMOKE: ALL PASS"
