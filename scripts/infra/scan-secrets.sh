#!/usr/bin/env bash
# Look for committed credentials. Owner: AI #7 (infrastructure).
#
#   scripts/infra/scan-secrets.sh            # scan tracked files in the worktree
#   scripts/infra/scan-secrets.sh --history  # also scan full git history
#
# This is a cheap, dependency-free tripwire, not a replacement for a real
# scanner. It catches the failure modes this project can actually produce: a
# .env committed, a private key pasted into a file, a Supabase service_role key,
# an FCM service-account JSON, a LiveKit secret in Flutter or Admin Web source.
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
)

# Files that legitimately describe secrets without containing them.
EXCLUDE_PATH='^(docs/infrastructure/|infra/env/|scripts/infra/scan-secrets\.sh$|docs/JAWWID_CHAT_BRIEF)'

# Rules that match a secret-shaped NAME rather than credential MATERIAL.
#
# `LIVEKIT_API_SECRET = "<any 8+ characters>"` is a leak in shipping code and a
# fixture in a test -- a call test cannot exercise token signing without setting
# a signing secret, and the value it sets is invented. Flagging those trains
# people to ignore this scanner, which is the failure mode the RULES comment
# above is written against.
#
# Exemption is per-rule and applies ONLY to these heuristics. The rules that
# match real credential material -- key blocks, provider tokens, service-account
# JSON, a DSN with a password -- are NEVER exempted, in a test or anywhere else:
# a real key pasted into a spec file is still a real key. This is the same line
# ci.yml already draws for its JWT-shaped heuristic (G-18).
HEURISTIC_RULES='^(livekit secret assignment)$'
TEST_PATH='(^|/)(test|tests)/|\.spec\.ts$|\.test\.ts$|_test\.dart$'

# Matches that are credentials in form but not in substance: a connection
# string pointing at localhost or at a compose service name is a development
# default, and flagging it trains people to ignore this scanner. Applied to the
# matching LINE, before the filename is extracted -- note the line itself is
# used only for filtering and is never printed.
BENIGN_LINE='@localhost|@127\.0\.0\.1|@postgres:|@db:|@redis:'

for rule in "${RULES[@]}"; do
  name="${rule%%::*}"; regex="${rule#*::}"
  while IFS=: read -r file _; do
    [ -n "$file" ] || continue
    printf '%s' "$file" | grep -Eq "$EXCLUDE_PATH" && continue
    if printf '%s' "$name" | grep -Eq "$HEURISTIC_RULES"; then
      printf '%s' "$file" | grep -Eq "$TEST_PATH" && continue
    fi
    report "$name" "$file"
  # -e is required: patterns beginning with "-" would otherwise be parsed by
  # git grep as options and silently match nothing.
  done < <(git grep -InE --untracked -e "$regex" -- . 2>/dev/null \
             | grep -Ev "$BENIGN_LINE" | cut -d: -f1 | sort -u || true)
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
