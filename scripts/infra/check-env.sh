#!/usr/bin/env bash
# Validate configuration for one environment against infra/env/manifest.tsv.
# Owner: AI #7 (infrastructure).
#
#   scripts/infra/check-env.sh local                  # validate the process env
#   scripts/infra/check-env.sh production --file x.env
#   scripts/infra/check-env.sh staging --component worker
#
# Two components, two manifests: the API's infra/env/manifest.tsv and the
# worker's infra/env/worker.manifest.tsv. They state OPPOSITE rules for the same
# database variables -- the API requires DATABASE_URL (chat_app) and forbids
# DATABASE_SERVICE_URL; the worker requires DATABASE_SERVICE_URL (chat_service,
# BYPASSRLS) and forbids DATABASE_URL -- which is why the contract is two files
# rather than one. `api` is the default, so every existing invocation is
# unaffected.
#
# Runs in CI and as the first step of every deployment. A deployment that fails
# this check never starts, which is the point: a missing STORAGE_SECRET_KEY
# should stop the release, not surface an hour later as failed uploads.
#
# It NEVER prints a variable's value. Only names, and only pass/fail.
#
# Portability: written for bash 3.2, because that is what ships on macOS and
# every developer must be able to run this before pushing. No associative
# arrays, no `readarray`, no `${var,,}`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ENVIRONMENT="${1:-}"
ENV_FILE=""
COMPONENT="api"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --file) ENV_FILE="${2:-}"; shift 2 ;;
    --component) COMPONENT="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

USAGE="usage: $0 {local|staging|production} [--file path] [--component {api|worker}]"

case "$ENVIRONMENT" in
  local)      COLUMN=local ;;
  staging)    COLUMN=staging ;;
  production) COLUMN=production ;;
  *) echo "$USAGE" >&2; exit 64 ;;
esac

# The component is STATED, never inferred. "DATABASE_SERVICE_URL is present, so
# this must be the worker" would silently grade an API environment against the
# worker's contract the moment one shared env file leaked that variable in --
# and grading the API against a contract that REQUIRES a BYPASSRLS credential is
# the opposite of the control this gate exists to be.
case "$COMPONENT" in
  api)    MANIFEST="$ROOT/infra/env/manifest.tsv" ;;
  worker) MANIFEST="$ROOT/infra/env/worker.manifest.tsv" ;;
  *) echo "$USAGE" >&2; exit 64 ;;
esac

[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 66; }

# Values that mean "somebody copied the example file into a real environment".
PLACEHOLDER_PATTERNS='localhost|127\.0\.0\.1|changeme|placeholder|not-a-real-key|example\.com|devkey|devsecret|jawwid-dev|local-development|<[^>]+>'

# Snapshot the configuration source into NAME<TAB>VALUE lines so lookups are
# uniform whether they came from a file or from the process environment.
SNAPSHOT="$(mktemp -t jawwid-env-check)"
trap 'rm -f "$SNAPSHOT"' EXIT

if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 66; }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) : ;; *) continue ;; esac
    key="${line%%=*}"; value="${line#*=}"
    key="${key#export }"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf '%s\t%s\n' "$key" "$value" >> "$SNAPSHOT"
  done < "$ENV_FILE"
  SOURCE="file $ENV_FILE"
else
  # env -0 keeps multi-line values (APNS_PRIVATE_KEY is a PEM) intact.
  env -0 | tr '\n' ' ' | tr '\0' '\n' \
    | sed -e 's/=/\'$'\t''/' >> "$SNAPSHOT"
  SOURCE="process environment"
fi

lookup() {
  awk -F'\t' -v k="$1" '$1 == k { print substr($0, index($0, "\t") + 1); exit }' "$SNAPSHOT"
}

errors=0
warnings=0
checked=0

printf 'Validating %s %s configuration from %s\n\n' "$COMPONENT" "$ENVIRONMENT" "$SOURCE"

while IFS=$'\t' read -r name group secret r_local r_staging r_prod || [ -n "${name:-}" ]; do
  case "$name" in ''|'#'*) continue ;; esac
  case "$COLUMN" in
    local)      rule="$r_local" ;;
    staging)    rule="$r_staging" ;;
    production) rule="$r_prod" ;;
  esac
  checked=$((checked + 1))

  value="$(lookup "$name")"
  # An empty value is treated as unset: a variable set to "" configures nothing.
  present=0; [ -n "$value" ] && present=1

  case "$rule" in
    req)
      if [ "$present" -eq 0 ]; then
        printf '  MISSING     %-30s (%s, required in %s)\n' "$name" "$group" "$ENVIRONMENT"
        errors=$((errors + 1))
      elif [ "$ENVIRONMENT" != "local" ] \
           && printf '%s' "$value" | grep -Eqi "$PLACEHOLDER_PATTERNS"; then
        # Deliberately does not echo the value -- it may be a real secret that
        # merely happens to match. The variable name is enough to act on.
        printf '  PLACEHOLDER %-30s (%s) looks like a development value\n' "$name" "$group"
        errors=$((errors + 1))
      fi
      ;;
    forbid)
      if [ "$present" -eq 1 ]; then
        printf '  FORBIDDEN   %-30s (%s) must not be set in %s\n' "$name" "$group" "$ENVIRONMENT"
        errors=$((errors + 1))
      fi
      ;;
    opt)
      if [ "$present" -eq 0 ] && [ "$secret" = "yes" ] && [ "$ENVIRONMENT" != "local" ]; then
        printf '  note        %-30s (%s) unset; the feature it enables is off\n' "$name" "$group"
        warnings=$((warnings + 1))
      fi
      ;;
    *) printf '  BAD RULE    %-30s rule=%s\n' "$name" "$rule"; errors=$((errors + 1)) ;;
  esac
done < "$MANIFEST"

# Production-only structural checks that a per-variable rule cannot express.
if [ "$ENVIRONMENT" = "production" ]; then
  # API only: the worker starts no HTTP server, so it has no CORS policy to get
  # wrong. Copying this check onto it would be grading a variable it must not
  # have.
  if [ "$COMPONENT" = "api" ]; then
    if [ "$(lookup CORS_ALLOWED_ORIGINS)" = "*" ]; then
      echo "  FORBIDDEN   CORS_ALLOWED_ORIGINS is '*' -- wildcard CORS on a credentialed API"
      errors=$((errors + 1))
    fi
  fi
  if [ "$(lookup NODE_ENV)" != "production" ]; then
    echo "  FORBIDDEN   NODE_ENV must be 'production' in the production environment"
    errors=$((errors + 1))
  fi
  # TLS on the connection THIS process actually opens. The two components reach
  # the same database as different roles through different variables, so the
  # check has to follow the component or it grades a variable that is forbidden
  # here and absent by design.
  case "$COMPONENT" in
    worker) DB_URL_VAR=DATABASE_SERVICE_URL ;;
    *)      DB_URL_VAR=DATABASE_URL ;;
  esac
  case "$(lookup "$DB_URL_VAR")" in
    *sslmode=disable*)
      echo "  FORBIDDEN   $DB_URL_VAR disables TLS"; errors=$((errors + 1)) ;;
  esac
  # APNS_ENVIRONMENT=sandbox points the client at Apple's sandbox gateway, which
  # silently accepts production device tokens and delivers nothing. It fails as
  # "push stopped working for iOS" with no error anywhere. The runtime reads
  # this variable (apns.provider.ts) and refuses any value but sandbox|production.
  if [ "$(lookup APNS_ENVIRONMENT)" != "production" ]; then
    echo "  FORBIDDEN   APNS_ENVIRONMENT must be 'production' -- sandbox APNs drops production tokens"
    errors=$((errors + 1))
  fi
fi

printf '\n%d variables checked, %d error(s), %d note(s)\n' "$checked" "$errors" "$warnings"
[ "$errors" -eq 0 ] || { echo "environment validation FAILED"; exit 1; }
echo "environment validation passed"
