#!/usr/bin/env bash
# Render an environment template from infra/env/manifest.tsv.
# Owner: AI #7 (infrastructure).
#
#   scripts/infra/render-env-template.sh staging    > infra/env/staging.env.example
#   scripts/infra/render-env-template.sh staging --component worker \
#                                                 > infra/env/worker.staging.env.example
#
# Two components, two manifests. The API is the default so that every existing
# invocation renders exactly what it rendered before; the worker's contract is a
# separate file because the two processes need opposite rules for the same
# database variables (see infra/env/worker.manifest.tsv).
#
# Templates are GENERATED, never hand-edited. Hand-maintained per-environment
# files drift from the manifest the checker validates against, and the drift is
# only discovered by a failed deployment. Add a variable to the manifest and
# re-run this instead.
#
# Secret-valued variables render as an empty assignment with a `# SECRET` marker:
# a template must be safe to commit, so it can never carry a value.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVIRONMENT="${1:-}"
COMPONENT="api"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --component) COMPONENT="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

USAGE="usage: $0 {staging|production} [--component {api|worker}]"

case "$ENVIRONMENT" in
  staging|production) : ;;
  *) echo "$USAGE" >&2; exit 64 ;;
esac

# The component is stated, never inferred from which variables happen to be
# present -- the same rule the runtime follows (platform/database-role.ts).
# `api` is the default because it is the RLS-enforced side: anything that has
# not said otherwise gets the least-privileged contract.
case "$COMPONENT" in
  api)
    MANIFEST="$ROOT/infra/env/manifest.tsv"
    TITLE="${ENVIRONMENT} environment template"
    ARGS="${ENVIRONMENT}"
    TEMPLATE="infra/env/${ENVIRONMENT}.env.example"
    ;;
  worker)
    MANIFEST="$ROOT/infra/env/worker.manifest.tsv"
    TITLE="${ENVIRONMENT} WORKER environment template"
    ARGS="${ENVIRONMENT} --component worker"
    TEMPLATE="infra/env/worker.${ENVIRONMENT}.env.example"
    ;;
  *) echo "$USAGE" >&2; exit 64 ;;
esac

[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 66; }

cat <<HEADER
# Jawwid Chat — ${TITLE}.
#
# GENERATED FILE. Do not edit by hand.
#   scripts/infra/render-env-template.sh ${ARGS} > ${TEMPLATE}
#
# Every variable marked SECRET is supplied at deploy time from the secret store
# (docs/infrastructure/secrets.md). It is never written here, never committed,
# and never printed by a build log.
#
# Validate a real environment before deploying:
#   scripts/infra/check-env.sh ${ARGS}
HEADER

current_group=""
while IFS=$'\t' read -r name group secret r_local r_staging r_prod || [ -n "${name:-}" ]; do
  case "$name" in ''|'#'*) continue ;; esac
  case "$ENVIRONMENT" in
    staging)    rule="$r_staging" ;;
    production) rule="$r_prod" ;;
  esac

  # Forbidden variables are listed, commented out, with the reason. Silence
  # would invite someone to "just add DEBUG" without knowing it is a rule.
  if [ "$rule" = "forbid" ]; then
    if [ "$current_group" != "$group" ]; then
      printf '\n# --- %s ---\n' "$group"; current_group="$group"
    fi
    printf '# %s=            # FORBIDDEN in %s\n' "$name" "$ENVIRONMENT"
    continue
  fi

  if [ "$current_group" != "$group" ]; then
    printf '\n# --- %s ---\n' "$group"; current_group="$group"
  fi

  marker=""
  [ "$secret" = "yes" ] && marker="   # SECRET — inject from the secret store"
  [ "$rule" = "opt" ] && marker="${marker}${marker:+;} optional"

  printf '%s=%s\n' "$name" "$marker"
done < "$MANIFEST"
