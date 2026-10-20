#!/usr/bin/env bash
# Encryption for database backups. SOURCED by backup-db.sh and restore-db.sh;
# it does nothing when executed. Owner: AI #7 (infrastructure).
#
# WHY. A backup is a complete copy of every family's messages. The product works
# hard to keep those words out of its own logs; an unencrypted .dump on whatever
# disk it lands on would undo all of that at once.
#
# THE FORMAT -- jawwid-backup-v1, three files side by side:
#
#   NAME.dump.enc         `openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter N`
#                         over the pg_dump stream. Written straight from the pipe:
#                         the plaintext archive never exists as a file.
#   NAME.dump.enc.hmac    one line:
#                           jawwid-backup-v1 hmac-sha256 pbkdf2-sha256 N SALT TAG
#                         TAG is HMAC-SHA256 over the whole .enc file, keyed by
#                         PBKDF2-SHA256(secret, SALT, N) -- a fresh salt, so the
#                         MAC key is independent of the encryption key.
#   NAME.dump.enc.sha256  unkeyed checksum, for checking a copy without the key.
#
# Encrypt-then-MAC, because `openssl enc` cannot do an AEAD mode and CBC on its
# own is malleable: without the tag, a modified archive decrypts to garbage that
# pg_restore would start applying to the target. With it, restore-db.sh refuses
# a wrong key, a modified archive and a modified tag before it connects to
# anything. An unkeyed .sha256 cannot do that -- whoever can edit the archive can
# rewrite the checksum beside it.
#
# WHY openssl. It is the one tool present on a stock macOS (LibreSSL), on the
# GitHub runner and in the debian postgres image; age and gpg are on none of
# them reliably, and a backup step that needs a tool the host lacks is a backup
# that silently does not happen. Verified compatible both ways between LibreSSL
# 3.3 and OpenSSL 3.5.
#
# Recovering by hand, with nothing but openssl (N is in the .hmac file):
#
#   openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter N \
#     -pass file:/path/to/key -in NAME.dump.enc | pg_restore ...
#
# THE SECRET never appears on a command line, in a log or on stdout. openssl is
# told WHERE it is (`-pass env:VAR` or `-pass file:PATH`), never what it is, so
# `ps` shows a variable name or a path. The derived MAC key lives only in shell
# variables, and the HMAC below is assembled with bash builtins, because
# `openssl dgst -hmac KEY` would put that key in every process listing.

# PBKDF2 iteration count for new backups (OWASP 2023 guidance for SHA-256).
# Restores read the count from the .hmac file, so raising it later does not
# strand older archives.
BACKUP_KDF_ITER=600000
BACKUP_FORMAT=jawwid-backup-v1

# Decides whether a key is configured. Sets BACKUP_PASS_SPEC to the openssl
# `-pass` argument, which NAMES the secret and never contains it.
#   0  a usable key is configured
#   1  no key is configured at all
#   2  a key is configured but unusable (message on stderr)
backup_key_resolve() {
  BACKUP_PASS_SPEC=""
  local passphrase="${BACKUP_ENCRYPTION_PASSPHRASE:-}"
  local key_file="${BACKUP_ENCRYPTION_KEY_FILE:-}"
  local first_line=""

  if [ -n "$passphrase" ] && [ -n "$key_file" ]; then
    echo "set BACKUP_ENCRYPTION_KEY_FILE or BACKUP_ENCRYPTION_PASSPHRASE, not both" >&2
    return 2
  fi

  if [ -n "$key_file" ]; then
    if [ ! -f "$key_file" ] || [ ! -r "$key_file" ]; then
      echo "BACKUP_ENCRYPTION_KEY_FILE does not name a readable file" >&2
      return 2
    fi
    # openssl uses the FIRST LINE of the file. Read with a builtin, measured,
    # and never printed.
    IFS= read -r first_line < "$key_file" || true
    if [ "${#first_line}" -lt 16 ]; then
      echo "the first line of BACKUP_ENCRYPTION_KEY_FILE is shorter than 16 characters" >&2
      echo "generate one with:  openssl rand -base64 48 > backup.key && chmod 600 backup.key" >&2
      return 2
    fi
    first_line=""
    BACKUP_PASS_SPEC="file:$key_file"
  elif [ -n "$passphrase" ]; then
    if [ "${#passphrase}" -lt 16 ]; then
      echo "BACKUP_ENCRYPTION_PASSPHRASE is shorter than 16 characters" >&2
      return 2
    fi
    # `-pass env:` reads the process environment, so it must be exported even
    # when the caller only set it as a shell variable.
    export BACKUP_ENCRYPTION_PASSPHRASE
    BACKUP_PASS_SPEC="env:BACKUP_ENCRYPTION_PASSPHRASE"
  else
    return 1
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "a backup key is configured but openssl is not installed" >&2
    BACKUP_PASS_SPEC=""
    return 2
  fi
  return 0
}

# stdin -> encrypted file $1
backup_encrypt_to() {
  openssl enc -e -aes-256-cbc -pbkdf2 -md sha256 -iter "$BACKUP_KDF_ITER" -salt \
    -pass "$BACKUP_PASS_SPEC" -out "$1"
}

# encrypted file $1, iterations $2 -> plaintext on stdout (a pipe, never a file)
backup_decrypt_from() {
  openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter "$2" \
    -pass "$BACKUP_PASS_SPEC" -in "$1"
}

# PBKDF2-SHA256(secret, salt $1, iterations $2), 32 bytes, as hex on stdout.
# `enc -P` prints the derived key instead of encrypting; the caller captures it
# in a variable, so it is never displayed.
backup_mac_key() {
  openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter "$2" -S "$1" \
    -pass "$BACKUP_PASS_SPEC" -P </dev/null | sed -n 's/^key=//p'
}

# HMAC-SHA256 (RFC 2104) of file $2 under the hex key $1; hex tag on stdout.
#
#   HMAC(K, m) = H((K0 ^ opad) || H((K0 ^ ipad) || m))
#
# K0 is the key zero-padded to SHA-256's 64-byte block. The pads are built with
# printf (a builtin -- no process, so no argv anyone can read) and only the
# hashing is done by openssl. scripts/qa/check-backup-encryption.sh checks this
# against the RFC 4231 test vector and against `openssl dgst -hmac`.
backup_hmac_file() {
  local key="$1" file="$2" ipad="" opad="" i b x
  local key_bytes=$(( ${#key} / 2 ))
  if [ $(( ${#key} % 2 )) -ne 0 ] || [ "$key_bytes" -gt 64 ] || [ "$key_bytes" -lt 1 ]; then
    return 1
  fi
  case "$key" in *[!0-9a-fA-F]*) return 1 ;; esac
  for ((i = 0; i < 64; i++)); do
    if [ "$i" -lt "$key_bytes" ]; then b=$(( 16#${key:$(( i * 2 )):2} )); else b=0; fi
    printf -v x '\\x%02x' $(( b ^ 0x36 )); ipad="$ipad$x"
    printf -v x '\\x%02x' $(( b ^ 0x5c )); opad="$opad$x"
  done
  # The pads ARE format strings, deliberately: printf expanding their \xHH
  # escapes is how the raw bytes are produced. They hold only \xHH, never %.
  # shellcheck disable=SC2059
  { printf "$opad"; { printf "$ipad"; cat "$file"; } | openssl dgst -sha256 -binary; } \
    | openssl dgst -sha256 -binary | od -An -v -tx1 | tr -d ' \n'
}

# Writes the integrity tag for archive $1 to $1.hmac.
backup_write_tag() {
  local salt key tag
  salt="$(openssl rand -hex 8)"
  key="$(backup_mac_key "$salt" "$BACKUP_KDF_ITER")"
  [ "${#key}" -eq 64 ] || { echo "could not derive the integrity key" >&2; return 1; }
  tag="$(backup_hmac_file "$key" "$1")"
  key=""
  [ "${#tag}" -eq 64 ] || { echo "could not compute the integrity tag" >&2; return 1; }
  printf '%s hmac-sha256 pbkdf2-sha256 %s %s %s\n' \
    "$BACKUP_FORMAT" "$BACKUP_KDF_ITER" "$salt" "$tag" > "$1.hmac"
}

# Verifies archive $1 against tag file $2. Sets BACKUP_TAG_ITER on success.
#   0  the tag matches
#   1  the tag does not match: wrong key, or the archive or the tag was modified
#   3  the tag file is malformed or of an unknown format
backup_verify_tag() {
  local magic alg kdf iter salt tag extra key got
  BACKUP_TAG_ITER=""
  read -r magic alg kdf iter salt tag extra < "$2" || [ -n "${magic:-}" ] || return 3
  [ "$magic" = "$BACKUP_FORMAT" ] && [ "$alg" = hmac-sha256 ] \
    && [ "$kdf" = pbkdf2-sha256 ] && [ -z "${extra:-}" ] || return 3
  case "$iter" in ''|*[!0-9]*) return 3 ;; esac
  # Bounded, so a forged tag file cannot make the restore spin for hours.
  [ "${#iter}" -le 8 ] && [ "$iter" -ge 100000 ] && [ "$iter" -le 10000000 ] || return 3
  [ "${#salt}" -eq 16 ] && [ "${#tag}" -eq 64 ] || return 3
  case "$salt$tag" in *[!0-9a-f]*) return 3 ;; esac

  key="$(backup_mac_key "$salt" "$iter")"
  [ "${#key}" -eq 64 ] || return 1
  got="$(backup_hmac_file "$key" "$1")"
  key=""
  [ "$got" = "$tag" ] || return 1
  # shellcheck disable=SC2034  # read by restore-db.sh, which sources this file
  BACKUP_TAG_ITER="$iter"
  return 0
}
