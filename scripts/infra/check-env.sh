#!/usr/bin/env bash
# Validate configuration for one environment against infra/env/manifest.tsv.
# Owner: AI #7 (infrastructure).
#
#   scripts/infra/check-env.sh local                  # validate the process env
#   scripts/infra/check-env.sh production --file x.env
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
MANIFEST="$ROOT/infra/env/manifest.tsv"

ENVIRONMENT="${1:-}"
ENV_FILE=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --file) ENV_FILE="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

case "$ENVIRONMENT" in
  local)      COLUMN=local ;;
  staging)    COLUMN=staging ;;
  production) COLUMN=production ;;
  *) echo "usage: $0 {local|staging|production} [--file path]" >&2; exit 64 ;;
esac

[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 66; }

# Values that mean "somebody copied the example file into a real environment".
PLACEHOLDER_PATTERNS='localhost|127\.0\.0\.1|changeme|placeholder|not-a-real-key|example\.com|devkey|devsecret|jawwid-dev|local-development|<[^>]+>'

# Snapshot the configuration source into NAME<TAB>VALUE lines so lookups are
# uniform whether they came from a file or from the process environment.
# `mktemp -t NAME` is a BSD idiom: macOS appends the random suffix itself, but
# GNU coreutils treats NAME as the template and refuses it -- "too few X's in
# template" -- so this failed on every Linux runner while passing locally.
# An explicit template works identically on both, and honours TMPDIR as -t did.
SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/jawwid-env-check.XXXXXX")"
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

# Leading and trailing whitespace removed (bash 3.2: no extglob needed).
trim() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

errors=0
warnings=0
checked=0

printf 'Validating %s configuration from %s\n\n' "$ENVIRONMENT" "$SOURCE"

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
  if [ "$(lookup CORS_ALLOWED_ORIGINS)" = "*" ]; then
    echo "  FORBIDDEN   CORS_ALLOWED_ORIGINS is '*' -- wildcard CORS on a credentialed API"
    errors=$((errors + 1))
  fi
  if [ "$(lookup NODE_ENV)" != "production" ]; then
    echo "  FORBIDDEN   NODE_ENV must be 'production' in the production environment"
    errors=$((errors + 1))
  fi
  case "$(lookup DATABASE_URL)" in
    *sslmode=disable*)
      echo "  FORBIDDEN   DATABASE_URL disables TLS"; errors=$((errors + 1)) ;;
  esac
  # APNS_PRODUCTION=false points the client at Apple's sandbox gateway, which
  # silently accepts production device tokens and delivers nothing. It fails as
  # "push stopped working for iOS" with no error anywhere.
  if [ "$(lookup APNS_PRODUCTION)" != "true" ]; then
    echo "  FORBIDDEN   APNS_PRODUCTION must be 'true' -- sandbox APNs drops production tokens"
    errors=$((errors + 1))
  fi
  # PD-56 / Stripe M1: the API refuses to boot with a wrong Stripe setup too
  # (apps/api/src/billing/stripe-config.ts, the same rules); caught here, before
  # the backup and the migrations, rather than after them. Values are trimmed
  # as the API trims them, matched in shell variables, and never printed.
  #
  # LAUNCH_PHASE (deploy-production.yml passes the production Environment
  # variable to this step; app-spec.py refuses anything but review|launch):
  #   review  the store-review period: Stripe optional (unset = cards off);
  #   launch  the public launch takes card payments: BOTH secrets required.
  stripe_key="$(trim "$(lookup STRIPE_SECRET_KEY)")"
  stripe_whsec="$(trim "$(lookup STRIPE_WEBHOOK_SECRET)")"
  # The prefix is the safety check; after it any non-whitespace character is
  # accepted (Stripe promises no character set). Portable POSIX ERE classes.
  stripe_live_re='^(sk|rk)_live_[^[:space:]]+$'
  stripe_whsec_re='^whsec_[^[:space:]]+$'
  if [ -n "$stripe_key" ]; then
    case "$stripe_key" in
      sk_test_* | rk_test_*)
        echo "  FORBIDDEN   STRIPE_SECRET_KEY is a Stripe TEST key -- no money would move"
        errors=$((errors + 1)) ;;
      *)
        if ! [[ "$stripe_key" =~ $stripe_live_re ]]; then
          echo "  FORBIDDEN   STRIPE_SECRET_KEY is not a live secret or restricted key (sk_live_/rk_live_)"
          errors=$((errors + 1))
        fi ;;
    esac
  fi
  if [ -n "$stripe_whsec" ] && ! [[ "$stripe_whsec" =~ $stripe_whsec_re ]]; then
    echo "  FORBIDDEN   STRIPE_WEBHOOK_SECRET is not a webhook signing secret (whsec_) -- no payment could be recorded"
    errors=$((errors + 1))
  fi
  if [ "$(lookup LAUNCH_PHASE)" = "launch" ]; then
    if [ -z "$stripe_key" ]; then
      echo "  MISSING     STRIPE_SECRET_KEY (payments, required at LAUNCH_PHASE=launch: the public launch takes cards)"
      errors=$((errors + 1))
    fi
    if [ -z "$stripe_whsec" ]; then
      echo "  MISSING     STRIPE_WEBHOOK_SECRET (payments, required at LAUNCH_PHASE=launch: card payments must be recorded)"
      errors=$((errors + 1))
    fi
  elif [ -n "$stripe_key" ] && [ -z "$stripe_whsec" ]; then
    echo "  FORBIDDEN   STRIPE_WEBHOOK_SECRET is missing -- card payments could never be recorded"
    errors=$((errors + 1))
  fi
fi

printf '\n%d variables checked, %d error(s), %d note(s)\n' "$checked" "$errors" "$warnings"
[ "$errors" -eq 0 ] || { echo "environment validation FAILED"; exit 1; }
echo "environment validation passed"
