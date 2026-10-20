#!/usr/bin/env bash
# Is every backup encrypted that must be, and does restore refuse what it must?
#
# A backup is a complete copy of every family's messages. This guard holds the
# encryption contract of scripts/infra/backup-db.sh and restore-db.sh without a
# database or a docker daemon: the Postgres clients are stubbed, openssl is
# real. The full round trip against a real database is the G-41 drill in the
# integration job; this is the fast half that runs on every push.
#
#   1  the HMAC construction is HMAC-SHA256 (RFC 4231 vector, and openssl's own)
#   2  no key + a non-local APP_ENV is refused BEFORE pg_dump runs
#   3  a configured but unusable key is refused, never downgraded to plaintext
#   4  an encrypted backup leaves no plaintext and no key anywhere
#   5  restore hands pg_restore exactly what pg_dump produced
#   6  a wrong key, a modified archive, and a missing or edited tag are refused
#      before any client touches the target
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP="$ROOT/scripts/infra/backup-db.sh"
RESTORE="$ROOT/scripts/infra/restore-db.sh"
FAILED=0

ok()   { echo "  ok  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

command -v openssl >/dev/null 2>&1 || { echo "openssl is required"; exit 1; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/jawwid-backup-enc.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

# What the stub pg_dump emits. PGDMP is the real custom-format magic, so "no
# PGDMP in the artefact" means the same thing here as on a real archive.
MARKER="PGDMP-stub-archive SYNTHETIC-FAMILY-MESSAGE-7f3a91 every-word-a-parent-wrote"

BIN="$SANDBOX/bin"
mkdir -p "$BIN"

# Clients. Each records that it ran in $CALLS. pg_dump writes the marker to
# --file or stdout; pg_restore captures stdin; psql answers "0" (the target has
# no schema yet). docker dispatches on the client it was asked to run.
cat > "$BIN/pg_dump" <<'STUB'
#!/usr/bin/env bash
echo "pg_dump host" >> "$CALLS"
file=""
for a in "$@"; do case "$a" in --file=*) file="${a#--file=}" ;; esac; done
if [ -n "$file" ]; then printf '%s' "$STUB_DUMP" > "$file"; else printf '%s' "$STUB_DUMP"; fi
STUB
cat > "$BIN/pg_restore" <<'STUB'
#!/usr/bin/env bash
echo "pg_restore host" >> "$CALLS"
cat > "$RESTORE_CAPTURE"
STUB
cat > "$BIN/psql" <<'STUB'
#!/usr/bin/env bash
echo "psql host" >> "$CALLS"
echo 0
STUB
cat > "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    pg_dump)    echo "pg_dump container" >> "$CALLS"; printf '%s' "$STUB_DUMP"; exit 0 ;;
    pg_restore) echo "pg_restore container" >> "$CALLS"; cat > "$RESTORE_CAPTURE"; exit 0 ;;
    psql)       echo "psql container" >> "$CALLS"; echo 0; exit 0 ;;
  esac
done
exit 1
STUB
chmod +x "$BIN"/*

KEY="$SANDBOX/backup.key"
WRONG="$SANDBOX/wrong.key"
SHORT="$SANDBOX/short.key"
(umask 077 && openssl rand -base64 48 > "$KEY" && openssl rand -base64 48 > "$WRONG" && printf 'tooshort\n' > "$SHORT")
SECRET="$(head -1 "$KEY")"

# run NAME SCRIPT [VAR=VALUE ...] -- [script args]
# A clean environment, the stub bin first, and nothing else inherited.
run() {
  local name="$1" script="$2"; shift 2
  local dir="$SANDBOX/$name"
  mkdir -p "$dir"
  local envs=(
    "PATH=$BIN:/usr/bin:/bin:/usr/sbin:/sbin"
    "TMPDIR=$SANDBOX"
    "CALLS=$dir/calls"
    "RESTORE_CAPTURE=$dir/restored"
    "STUB_DUMP=$MARKER"
    "DATABASE_URL=postgres://backup:hunter2@localhost:5432/jawwid_chat_test"
  )
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  env -i "${envs[@]}" bash "$script" "$@" >"$dir/stdout" 2>"$dir/stderr"
  echo $? > "$dir/exit"
}
exit_of()  { cat "$SANDBOX/$1/exit"; }
calls_of() { cat "$SANDBOX/$1/calls" 2>/dev/null || true; }

# ---- 1 · the MAC is HMAC-SHA256 ------------------------------------------------
# shellcheck source=scripts/infra/backup-crypto.sh
. "$ROOT/scripts/infra/backup-crypto.sh"
printf 'what do ya want for nothing?' > "$SANDBOX/rfc4231"
if [ "$(backup_hmac_file 4a656665 "$SANDBOX/rfc4231")" = \
     5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843 ]; then
  ok "1a · HMAC matches RFC 4231 test case 2"
else
  fail "1a · HMAC does not match RFC 4231 test case 2"
fi
head -c 70000 /dev/urandom > "$SANDBOX/random"
# A throwaway test key, so putting it on openssl's command line is harmless --
# which is exactly what backup-crypto.sh avoids doing with a real one.
test_key="$(openssl rand -hex 32)"
reference="$(openssl dgst -sha256 -mac HMAC -macopt "hexkey:$test_key" "$SANDBOX/random" 2>/dev/null | awk '{print $NF}')"
if [ -n "$reference" ] && [ "$(backup_hmac_file "$test_key" "$SANDBOX/random")" = "$reference" ]; then
  ok "1b · HMAC matches openssl's own HMAC on random data"
else
  fail "1b · HMAC disagrees with openssl on random data"
fi

# ---- 2 · no key outside local/test/ci: refused before the dump ----------------
for env_name in production staging unset; do
  if [ "$env_name" = unset ]; then
    run "refuse-$env_name" "$BACKUP" -- --out "$SANDBOX/refuse-$env_name/out"
  else
    run "refuse-$env_name" "$BACKUP" "APP_ENV=$env_name" -- --out "$SANDBOX/refuse-$env_name/out"
  fi
  if [ "$(exit_of "refuse-$env_name")" = 0 ]; then
    fail "2 · APP_ENV=$env_name with no key wrote a backup"
  elif [ -n "$(calls_of "refuse-$env_name")" ]; then
    fail "2 · APP_ENV=$env_name with no key ran pg_dump before refusing"
  elif [ -e "$SANDBOX/refuse-$env_name/out" ]; then
    fail "2 · APP_ENV=$env_name with no key created the output directory"
  else
    ok "2 · APP_ENV=$env_name with no key is refused before pg_dump runs"
  fi
done

run allow-plaintext "$BACKUP" "APP_ENV=production" -- --out "$SANDBOX/allow-plaintext/out" --allow-plaintext
if [ "$(exit_of allow-plaintext)" = 0 ] && grep -q 'UNENCRYPTED' "$SANDBOX/allow-plaintext/stdout"; then
  ok "2 · --allow-plaintext is an explicit, announced override"
else
  fail "2 · --allow-plaintext did not produce an announced plaintext backup"
fi

# ---- 3 · an unusable key is an error, not a reason to write plaintext --------
run short-key "$BACKUP" "APP_ENV=ci" "BACKUP_ENCRYPTION_KEY_FILE=$SHORT" -- --out "$SANDBOX/short-key/out"
run both-keys "$BACKUP" "APP_ENV=ci" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" "BACKUP_ENCRYPTION_PASSPHRASE=$SECRET" -- --out "$SANDBOX/both-keys/out"
run missing-key "$BACKUP" "APP_ENV=ci" "BACKUP_ENCRYPTION_KEY_FILE=$SANDBOX/does-not-exist" -- --out "$SANDBOX/missing-key/out"
for c in short-key both-keys missing-key; do
  if [ "$(exit_of "$c")" != 0 ] && [ -z "$(calls_of "$c")" ]; then
    ok "3 · $c is refused even where plaintext would be allowed"
  else
    fail "3 · $c fell through to a backup"
  fi
done

# ---- 4 · an encrypted backup: ciphertext only, no key anywhere ----------------
check_encrypted() {
  local name="$1" want_client="$2" out="$SANDBOX/$1/out" enc
  enc="$(ls "$out"/*.dump.enc 2>/dev/null | head -1)"
  if [ "$(exit_of "$name")" != 0 ] || [ -z "$enc" ]; then
    fail "4 · $name did not produce an encrypted archive"; return
  fi
  if ls "$out" | grep -v -E '\.dump\.enc(\.hmac|\.sha256)?$' | grep -q .; then
    fail "4 · $name left another file beside the archive: $(ls "$out" | tr '\n' ' ')"
  elif LC_ALL=C grep -a -q -e PGDMP -e SYNTHETIC-FAMILY-MESSAGE "$out"/*; then
    fail "4 · $name: the plaintext is readable in the backup output"
  elif LC_ALL=C grep -a -q -F -e "$SECRET" "$out"/* "$SANDBOX/$name/stdout" "$SANDBOX/$name/stderr"; then
    fail "4 · $name: the key was written to an artefact or to the output"
  elif [ "$(head -c 8 "$enc")" != "Salted__" ] || [ ! -s "$enc.hmac" ]; then
    fail "4 · $name: not an openssl archive with an integrity tag"
  elif ! grep -q "pg_dump $want_client" "$SANDBOX/$name/calls"; then
    fail "4 · $name ran the wrong pg_dump: $(calls_of "$name")"
  else
    ok "4 · $name: ciphertext, tag and checksum only; no plaintext, no key"
  fi
}
run enc-host "$BACKUP" "APP_ENV=production" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" -- --out "$SANDBOX/enc-host/out" --schema chat
check_encrypted enc-host host
run enc-env "$BACKUP" "APP_ENV=staging" "BACKUP_ENCRYPTION_PASSPHRASE=$SECRET" -- --out "$SANDBOX/enc-env/out"
check_encrypted enc-env host
# PG_IMAGE outranks PATH on the encrypted path too (check-backup-client-selection.sh).
run enc-container "$BACKUP" "APP_ENV=production" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" "PG_IMAGE=postgres:17-alpine" -- --out "$SANDBOX/enc-container/out"
check_encrypted enc-container container

# ---- 5 · restore round trip ---------------------------------------------------
ARCHIVE="$(ls "$SANDBOX/enc-host/out"/*.dump.enc | head -1)"
TARGET_URL="postgres://restore:hunter2@localhost:5432/scratch"
restored_ok() {
  local name="$1" client="$2"
  [ "$(exit_of "$name")" = 0 ] && [ -f "$SANDBOX/$name/restored" ] \
    && [ "$(cat "$SANDBOX/$name/restored")" = "$MARKER" ] \
    && grep -q "pg_restore $client" "$SANDBOX/$name/calls"
}
run restore-ok "$RESTORE" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" -- --file "$ARCHIVE" --into "$TARGET_URL" --schema chat
if restored_ok restore-ok host; then
  ok "5 · the right key restores exactly what pg_dump wrote, through a pipe"
else
  fail "5 · restore with the right key did not deliver the archive: exit $(exit_of restore-ok); $(tail -2 "$SANDBOX/restore-ok/stderr")"
fi
run restore-env "$RESTORE" "BACKUP_ENCRYPTION_PASSPHRASE=$SECRET" -- --file "$(ls "$SANDBOX/enc-env/out"/*.dump.enc)" --into "$TARGET_URL"
restored_ok restore-env host && ok "5 · a passphrase backup restores with the passphrase" \
  || fail "5 · a passphrase backup did not restore"
run restore-container "$RESTORE" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" "PG_IMAGE=postgres:17-alpine" -- --file "$ARCHIVE" --into "$TARGET_URL"
restored_ok restore-container container && ok "5 · PG_IMAGE picks the pg_restore, and the stream reaches it" \
  || fail "5 · the containerised restore did not receive the archive: $(calls_of restore-container | tr '\n' ' ')"
if find "$SANDBOX" -name 'jawwid-restore.*' | grep -q .; then
  fail "5 · restore left its working directory behind"
fi

# ---- 6 · refusals, before any client runs --------------------------------------
refused_untouched() {
  local name="$1" why="$2"
  if [ "$(exit_of "$name")" = 0 ]; then
    fail "6 · $why was restored"
  elif [ -n "$(calls_of "$name")" ]; then
    fail "6 · $why was refused only after touching the target: $(calls_of "$name" | tr '\n' ' ')"
  else
    ok "6 · $why is refused before the target is touched"
  fi
}
run wrong-key "$RESTORE" "BACKUP_ENCRYPTION_KEY_FILE=$WRONG" -- --file "$ARCHIVE" --into "$TARGET_URL"
refused_untouched wrong-key "a wrong key"
run no-key "$RESTORE" -- --file "$ARCHIVE" --into "$TARGET_URL"
refused_untouched no-key "an encrypted archive with no key"

TAMPER="$SANDBOX/tamper"
mkdir -p "$TAMPER"
cp "$ARCHIVE" "$TAMPER/a.dump.enc"; cp "$ARCHIVE.hmac" "$TAMPER/a.dump.enc.hmac"
size="$(wc -c < "$TAMPER/a.dump.enc" | tr -d ' ')"
# Overwrite 16 bytes in the ciphertext body, then make the unkeyed checksum
# agree -- as anyone able to edit the archive could -- so only the tag stands.
dd if=/dev/urandom of="$TAMPER/a.dump.enc" bs=1 seek=$(( size / 2 )) count=16 conv=notrunc 2>/dev/null
(cd "$TAMPER" && { shasum -a 256 a.dump.enc 2>/dev/null || sha256sum a.dump.enc; } > a.dump.enc.sha256)
run tampered "$RESTORE" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" -- --file "$TAMPER/a.dump.enc" --into "$TARGET_URL"
refused_untouched tampered "a modified archive with a matching checksum"

cp "$ARCHIVE" "$TAMPER/b.dump.enc"
run no-tag "$RESTORE" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" -- --file "$TAMPER/b.dump.enc" --into "$TARGET_URL"
refused_untouched no-tag "an archive without its tag"

cp "$ARCHIVE" "$TAMPER/c.dump.enc"
awk '{ t = $6; f = (substr(t, 1, 1) == "0") ? "1" : "0"; $6 = f substr(t, 2); print }' "$ARCHIVE.hmac" > "$TAMPER/c.dump.enc.hmac"
run edited-tag "$RESTORE" "BACKUP_ENCRYPTION_KEY_FILE=$KEY" -- --file "$TAMPER/c.dump.enc" --into "$TARGET_URL"
refused_untouched edited-tag "an edited tag"

if [ "$FAILED" -ne 0 ]; then
  echo "backup encryption: FAIL"; exit 1
fi
echo "backup encryption: pass"
