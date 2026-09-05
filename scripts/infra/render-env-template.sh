#!/usr/bin/env bash
# Render an environment template from infra/env/manifest.tsv.
# Owner: AI #7 (infrastructure).
#
#   scripts/infra/render-env-template.sh staging    > infra/env/staging.env.example
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
MANIFEST="$ROOT/infra/env/manifest.tsv"
ENVIRONMENT="${1:-}"

case "$ENVIRONMENT" in
  staging|production) : ;;
  *) echo "usage: $0 {staging|production}" >&2; exit 64 ;;
esac

cat <<HEADER
# Jawwid Chat — ${ENVIRONMENT} environment template.
#
# GENERATED FILE. Do not edit by hand.
#   scripts/infra/render-env-template.sh ${ENVIRONMENT} > infra/env/${ENVIRONMENT}.env.example
#
# Every variable marked SECRET is supplied at deploy time from the secret store
# (docs/infrastructure/secrets.md). It is never written here, never committed,
# and never printed by a build log.
#
# Validate a real environment before deploying:
#   scripts/infra/check-env.sh ${ENVIRONMENT}
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
