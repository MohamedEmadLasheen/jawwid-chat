#!/usr/bin/env bash
# Look for committed credentials. Owner: AI #7 (infrastructure).
#
#   scripts/infra/scan-secrets.sh            # scan tracked files in the worktree
#   scripts/infra/scan-secrets.sh --history  # also scan full git history
#
# This is a cheap, dependency-free tripwire, not a replacement for a real
# scanner. It catches the failure modes this project can actually produce: a
# .env committed, a private key pasted into a file, a Supabase service_role key,
# an FCM service-account JSON, a LiveKit secret in Flutter or Admin Web source,
# a Stripe / DigitalOcean / Google / Meta / Sentry credential, an SMTP or Redis
# URL with a password, or a key or keystore file tracked by name. The full list
# and the exclusions are in docs/infrastructure/secrets.md, section 3.1.
#
# A finding is reported by FILE and RULE. The matching text is never printed --
# echoing a leaked key into CI logs copies the leak into a second system.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SCAN_HISTORY=0
[ "${1:-}" = "--history" ] && SCAN_HISTORY=1

findings=0

report() { printf '  %-34s %s\n' "$1" "$2"; findings=$((findings + 1)); }

# --- rule 1: env files that must never be tracked -----------------------------
while IFS= read -r f; do
  case "$f" in
    *.env.example|*/env.example|infra/env/*.example) continue ;;
  esac
  report "tracked env file" "$f"
done < <(git ls-files | grep -E '(^|/)\.env($|\.)|(^|/)[^/]*\.env$' || true)

# --- rule 1b: key, keystore and signing files, by name ------------------------
# These are usually binary, and rule 2's `git grep -I` skips binary files, so
# their contents are never examined. Their names are enough: an APNs key (.p8),
# a PKCS#12 certificate (.p12/.pfx), an Android keystore (.jks/.keystore) or a
# provisioning profile has no business in this repository. .gitignore lists the
# same extensions; this catches one added with `git add -f`.
while IFS= read -r f; do
  report "tracked key or keystore file" "$f"
done < <(git ls-files | grep -iE '\.(p8|p12|pfx|jks|keystore|mobileprovision)$' || true)

# --- rule 2: high-signal credential patterns in tracked text ------------------
# Each entry is RULE::REGEX. Kept deliberately narrow: a scanner that cries wolf
# gets disabled, and a disabled scanner finds nothing.
RULES=(
  'private key block::-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'supabase service_role jwt::eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*(service_role|c2VydmljZV9yb2xl)'
  'google service account::"type"[[:space:]]*:[[:space:]]*"service_account"'
  'aws access key id::AKIA[0-9A-Z]{16}'
  'slack token::xox[abposr]-[0-9A-Za-z-]{10,}'
  'github token::gh[pousr]_[0-9A-Za-z]{30,}'
  'postgres url with password::postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]{6,}@'
  'livekit secret assignment::LIVEKIT_API_SECRET[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}'
  # Key bodies are letters and digits only, and long: the test fixtures in this
  # repository (sk_test_unit, whsec_unit_test_secret, rk_live_x) are short or
  # contain "_" and do not match.
  'stripe secret key::(sk|rk)_(live|test)_[0-9A-Za-z]{20,}'
  'stripe webhook secret::whsec_[0-9A-Za-z+/=]{24,}'
  'digitalocean token::do[opr]_v1_[0-9a-f]{64}'
  'google api key::AIza[0-9A-Za-z_-]{35}'
  # Must start a token: the same run inside a base64 blob is not a credential.
  'meta access token::(^|[^0-9A-Za-z+/])EAA[0-9A-Za-z]{90,}'
  # The legacy DSN form, public:SECRET@host. A modern DSN (public key only) is
  # meant to ship in clients and is not flagged.
  'sentry dsn with secret::https?://[0-9a-f]{32}:[0-9a-f]{32}@'
  'sentry auth token::sntry[su]_[0-9A-Za-z+/=_-]{40,}'
  # A password may not START with $ % { < (a $VAR, ${VAR}, %s, {{x}} or <pass>
  # placeholder) and may not contain "/" (a real one is percent-encoded), so
  # host:port/db@... is not mistaken for user:password@.
  'smtp url with password::smtps?://[^:/@[:space:]]+:[^$%{<@/[:space:]][^@/[:space:]]{5,}@'
  'redis url with password::rediss?://[^:/@[:space:]]*:[^$%{<@/[:space:]][^@/[:space:]]{5,}@'
)

# Files that legitimately describe secrets without containing them.
EXCLUDE_PATH='^(docs/infrastructure/|infra/env/|scripts/infra/scan-secrets\.sh$|docs/JAWWID_CHAT_BRIEF)'

# Matches that are credentials in form but not in substance: a connection
# string pointing at localhost or at a compose service name is a development
# default, and flagging it trains people to ignore this scanner. Applied to the
# matching LINE, before the filename is extracted -- note the line itself is
# used only for filtering and is never printed.
BENIGN_LINE='@localhost|@127\.0\.0\.1|@postgres:|@db:|@redis:'

# For the SMTP and Redis URL rules only: the literal word "password" as the
# password, or a host under a reserved TLD (RFC 2606/6761: .invalid, .example,
# .test, .localhost) that can never resolve. Both appear in this repository's
# own documentation and self-tests. Deliberately NOT applied to the older rules,
# so adding these rules relaxed nothing that was already enforced.
URL_PLACEHOLDER_LINE=':password@|@[A-Za-z0-9.-]*\.(invalid|example|test|localhost)([^A-Za-z0-9.-]|$)'

for rule in "${RULES[@]}"; do
  name="${rule%%::*}"; regex="${rule#*::}"
  benign="$BENIGN_LINE"
  case "$name" in
    'smtp url with password'|'redis url with password') benign="$BENIGN_LINE|$URL_PLACEHOLDER_LINE" ;;
  esac
  while IFS=: read -r file _; do
    [ -n "$file" ] || continue
    printf '%s' "$file" | grep -Eq "$EXCLUDE_PATH" && continue
    report "$name" "$file"
  # -e is required: patterns beginning with "-" would otherwise be parsed by
  # git grep as options and silently match nothing.
  done < <(git grep -InE --untracked -e "$regex" -- . 2>/dev/null \
             | grep -Ev "$benign" | cut -d: -f1 | sort -u || true)
done

# --- rule 3: server secrets reachable from a client bundle --------------------
# The Flutter app and the Admin Web bundle ship to devices and browsers.
# Anything in them is public, whatever it is named.
CLIENT_PATHS="lib apps/admin-web/src"
CLIENT_FORBIDDEN='LIVEKIT_API_SECRET|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|STORAGE_SECRET_KEY|CORE_API_KEY|CORE_WEBHOOK_SECRET|service_role'
for p in $CLIENT_PATHS; do
  [ -d "$p" ] || continue
  while IFS=: read -r file _; do
    [ -n "$file" ] || continue
    report "server secret in client code" "$file"
  done < <(git grep -InE --untracked -e "$CLIENT_FORBIDDEN" -- "$p" 2>/dev/null \
             | cut -d: -f1 | sort -u || true)
done

# --- rule 4: history ----------------------------------------------------------
if [ "$SCAN_HISTORY" -eq 1 ]; then
  while IFS= read -r f; do
    case "$f" in *.env.example|infra/env/*) continue ;; esac
    report "env file in git history" "$f"
  done < <(git log --pretty=format: --name-only --diff-filter=A \
             | grep -E '(^|/)\.env($|\.)' | sort -u || true)
fi

echo
if [ "$findings" -eq 0 ]; then
  echo "secret scan: clean (0 findings)"
else
  echo "secret scan: $findings finding(s)"
  cat <<'MSG'

A finding is not automatically a breach -- but treat it as one until proven
otherwise. If a real credential was committed, ROTATE IT FIRST and only then
remove it from the tree. Removing it from git does not un-leak it: the value is
already in every clone and in CI's caches.
See docs/infrastructure/secrets.md, "Recovering from a leaked credential".
MSG
  exit 1
fi
