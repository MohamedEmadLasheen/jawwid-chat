#!/usr/bin/env bash
# ENG-43 proof: the integration shards in .github/workflows/ci.yml together run
# every integration spec exactly once -- the same set the unsharded job ran.
# Lists specs only (no database, nothing is executed).
#   scripts/ci/integration-shards.sh [shard-count]   (default 4; keep in step with ci.yml)
set -euo pipefail
N="${1:-4}"
cd "$(dirname "${BASH_SOURCE[0]}")/../../apps/api"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
list() { npx jest --selectProjects integration --listTests "$@" | grep "^/" | sed "s#^$PWD/##" | sort; }
list > "$tmp/all"
: > "$tmp/union"
for i in $(seq 1 "$N"); do
  list --shard="$i/$N" > "$tmp/s$i"
  echo "shard $i/$N: $(wc -l < "$tmp/s$i" | tr -d ' ') specs"
  cat "$tmp/s$i" >> "$tmp/union"
done
echo "unsharded: $(wc -l < "$tmp/all" | tr -d ' ') specs"
if [ -n "$(sort "$tmp/union" | uniq -d)" ]; then echo "FAIL: a spec is in two shards"; exit 1; fi
if ! diff <(sort "$tmp/union") "$tmp/all" >/dev/null; then echo "FAIL: shard union differs from the full list"; diff <(sort "$tmp/union") "$tmp/all"; exit 1; fi
echo "OK: shards are disjoint and their union equals the unsharded list"
