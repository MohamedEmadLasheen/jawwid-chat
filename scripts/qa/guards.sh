#!/usr/bin/env bash
# The release-gate guards, runnable in one command.
#
#   scripts/qa/guards.sh
#
# WHY THIS EXISTS
# ---------------
# These checks lived only as eight inline steps in .github/workflows/ci.yml, and
# ci.yml has never executed -- there is no git remote (PHASE-8-REPORT.md B-1).
# A gate that exists only inside a pipeline nobody can run is not a gate; it is
# a description of one.
#
# The cost of that was not theoretical. The guards job was found RED at its
# first step on 2026-09-08, meaning no test, no migration gate and no image
# build in the whole pipeline had ever been reachable. It was fixed, and then
# the environment-template check regressed again the SAME DAY, because an agent
# added rows to infra/env/manifest.tsv and had no one-command way to discover
# that the generated templates no longer matched.
#
# So this is the single source, and ci.yml calls it. Two copies of a gate drift,
# and the drifting copy is always the one that is not being run -- which is
# exactly the failure this file is named after.
#
# Every check here is cheap and needs no database, no network and no toolchain
# beyond git, grep and bash. Run it before you commit.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# GitHub renders ::error:: as an annotation; a terminal just prints it.
fail() { echo "::error::$*"; failed=$((failed + 1)); }
failed=0

check() {
  local name="$1"; shift
  total=$(( ${total:-0} + 1 ))
  printf '  %-52s ' "$name"
  if "$@" >/tmp/jawwid-guard.out 2>&1; then
    echo "PASS"
  else
    echo "FAIL"
    sed 's/^/      /' /tmp/jawwid-guard.out | head -20
    fail "$name"
  fi
}

# The gate DEFINITIONS are exempt from every pattern check below, and they have
# to be: this script and ci.yml must contain the forbidden patterns in order to
# search for them, so a gate that did not exempt them could never pass. Run
# verbatim, ci.yml's own G-20 step fails on ci.yml -- a latent failure nobody
# had seen, because the pipeline has never executed. Same principle as
# EXCLUDE_PATH in scan-secrets.sh, which exempts the scanner from itself.
GATE_DEFS=(':(exclude)scripts/qa/guards.sh' ':(exclude).github/workflows/ci.yml')

# -- G-18 ---------------------------------------------------------------------
# Hard patterns first: credential material is never legitimate anywhere.
#
# git grep --untracked, NOT a recursive filesystem grep. It covers tracked files
# AND new ones not yet staged -- which a developer running this before `git add`
# needs, and which plain `git grep` misses (a planted name in a new file passed
# the gate until this was fixed). Ignored paths stay out, which is the point: a
# recursive grep also reads build output, and found a private key inside
# build/ios/SourcePackages/livekit_client-2.12.0/... -- a fixture in a
# third-party SDK this repository neither wrote nor ships.
g18() {
  git grep -InE --untracked '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' \
    -- . "${GATE_DEFS[@]}" && return 1
  # JWT-shaped strings, excluding test paths: a synthetic token inside a
  # redaction test is the control working, not a leak.
  git grep -InE --untracked 'eyJhbGciOi[A-Za-z0-9_-]{10,}' -- . "${GATE_DEFS[@]}" \
    ':(exclude)test' ':(exclude)tests' ':(exclude)*_test.dart' \
    ':(exclude)*.spec.ts' ':(exclude)*.test.ts' && return 1
  git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.(local|production)$' && return 1
  return 0
}

# -- G-20 ---------------------------------------------------------------------
# The product brief names real staff. Acceptable in docs/, never in code,
# fixtures or seed data. This is the check that found a real employee name
# shipping as a learner displayName in lib/core/data/fake_backend.dart.
g20() {
  local hits
  hits=$(git grep -Il --untracked $'رحاب\|زينب\|دينا\|أسماء\|مريم\|رضوى\|رقيه' \
    -- . ':(exclude)docs' "${GATE_DEFS[@]}" || true)
  [ -z "$hits" ] || { echo "$hits"; return 1; }
}

# -- G-31..G-35 ---------------------------------------------------------------
# Advisory scan. Fails only on unmistakable Phase 2 feature wiring.
#
# -w, NOT \b. `git grep -E` does not honour \b -- it matches NOTHING, silently,
# on tracked and untracked files alike. This gate was converted from GNU
# `grep -rInE` (where \b works) and was therefore dead from that commit until a
# negative probe caught it. -w applies the word boundary to the whole
# alternation, which is what \b(...)\b was written to mean.
#
# Nothing else here relies on \b; the G-18 patterns are anchored by their own
# shape (AKIA…, -----BEGIN…, eyJhbGciOi…).
g31() {
  ! git grep -InEw --untracked \
    '(videoCall|enableVideo|startVideo|broadcastToAll|aiScore|aiSuggest|draftWithAI)' \
    -- '*.ts' '*.dart' '*.tsx' "${GATE_DEFS[@]}"
}

# -- environment templates ----------------------------------------------------
# The templates are GENERATED from infra/env/manifest.tsv. A hand-edited
# template, or a manifest row added without re-rendering, drifts from the
# checker deployments actually run -- and the drift is otherwise discovered by a
# failed release. This is the check that regressed twice on 2026-09-08.
templates() {
  local rc=0 env component file
  local -a args
  for component in api worker; do
    for env in staging production; do
      if [ "$component" = "api" ]; then
        file="infra/env/${env}.env.example"
        args=("$env")
      else
        file="infra/env/worker.${env}.env.example"
        args=("$env" --component worker)
      fi
      if ! scripts/infra/render-env-template.sh "${args[@]}" | diff -u "$file" - ; then
        echo "$file is stale -- regenerate it:"
        echo "  scripts/infra/render-env-template.sh ${args[*]} > $file"
        rc=1
      fi
    done
  done
  return $rc
}

# The two manifests state deliberately OPPOSITE req/opt/forbid rules for the
# same database variables -- that is the whole reason there are two. But whether
# a value is a SECRET is a property of the value, not of the process reading it,
# so a variable classified differently in the two files is always a mistake, and
# the mistake it produces is a credential rendered into a committed template.
# This is the one axis on which the duplication must not drift.
manifest_secrets() {
  awk -F'\t' '
    /^#/ || NF < 6 { next }
    FILENAME ~ /worker\.manifest\.tsv$/ { worker[$1] = $3; next }
    { api[$1] = $3 }
    END {
      rc = 0
      for (name in worker)
        if (name in api && api[name] != worker[name]) {
          printf "%s: SECRET=%s in the API manifest, SECRET=%s in the worker manifest\n", \
                 name, api[name], worker[name]
          rc = 1
        }
      exit rc
    }
  ' infra/env/manifest.tsv infra/env/worker.manifest.tsv
}

echo "Release-gate guards (docs/qa/release-gate.md)"
check "G-18 · no secrets committed"                g18
check "G-20 · no real employee names"              g20
check "JC-011 · protected regression tests"        bash scripts/qa/check-protected-tests.sh
check "G-31..G-35 · no Phase 2 capability in MVP"  g31
check "Secret scan — worktree and history"         bash scripts/infra/scan-secrets.sh --history
check "Server secrets not in a client bundle"      bash scripts/infra/check-web-env.sh
check "The local environment example is valid"     bash scripts/infra/check-env.sh local --file .env.example
check "Environment templates match the manifest"   templates
check "Manifest SECRET flags agree across components"  manifest_secrets
check "No migration narrows an earlier CHECK constraint"  bash scripts/qa/check-constraint-narrowing.sh
check "Deployment workflows match the env contract"  bash scripts/qa/check-deploy-env.sh

echo
if [ "$failed" -eq 0 ]; then
  echo "guards: PASS ($total/$total)"
else
  echo "guards: FAIL ($failed of $total)"
  exit 1
fi
