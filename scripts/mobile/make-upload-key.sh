#!/usr/bin/env bash
# LR-07c: make the Android UPLOAD keystore for Google Play, once.
#
# Run BY THE OWNER ONLY, in a dedicated standard macOS user (not the development user), in an empty
# folder. Never by CI, never by an agent, never inside a project folder or a git checkout (it refuses
# a folder with .git in it or any parent, or a path containing /dev/ or /Documents/jawwid).
# Instructions: docs/release/android-upload-key.md.
#
#   bash make-upload-key.sh                      # asks for the password twice (hidden)
#   <password manager CLI> | bash make-upload-key.sh   # or reads ONE line from stdin
#
# It creates ./jawwid-upload.jks (PKCS12, alias jawwid-upload, RSA 4096, mode 600) and prints only:
# the certificate's SHA-256 (for ANDROID_UPLOAD_CERT_SHA256), the GitHub secret names to fill, and the
# command that copies the keystore's base64 to the clipboard. It never prints the password or the
# base64, never writes the password to a file, and never puts it on a command line: keytool reads it
# from an environment variable (-storepass:env / -keypass:env) that is unset right after.
#
# The password must be letters and digits only (A-Z, a-z, 0-9), at least 16 characters: the CI
# workflow writes it into a Java properties file and refuses anything else.
#
# KEYTOOL overrides the keytool binary (default: `keytool` on PATH).
set -euo pipefail
export LC_ALL=C
umask 077

readonly KEYSTORE=jawwid-upload.jks
readonly ALIAS=jawwid-upload
readonly DNAME='CN=Jawwid LLC upload key, O=Jawwid LLC'
readonly PW_ENV=JAWWID_UPLOAD_KEYSTORE_PW
KEYTOOL="${KEYTOOL:-keytool}"

fail() { echo "make-upload-key: $*" >&2; exit 1; }

# Whatever happens, the password leaves the environment and the shell when the script ends.
cleanup() { unset JAWWID_UPLOAD_KEYSTORE_PW pw pw2 2>/dev/null || true; }
trap cleanup EXIT

[ $# -eq 0 ] || fail "takes no arguments (the password is never accepted on the command line)"
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  fail "refusing to run in CI: only the owner runs this, on a trusted Mac user"
fi

# Never inside a project folder or a git checkout: the key must not sit next to code that agents and
# tools read. Checked on both the logical and the physical path (a symlinked folder counts), with
# case-insensitive matching (macOS file names are).
check_folder() {
  local dir="$1" d
  shopt -s nocasematch
  if [[ "$dir/" == */dev/* || "$dir/" == */documents/jawwid* ]]; then
    shopt -u nocasematch
    fail "refusing to run in $dir: it looks like a project area (/dev/ or /Documents/jawwid). Use an empty folder such as ~/upload-key in the dedicated user."
  fi
  shopt -u nocasematch
  d="$dir"
  while :; do
    if [ -e "$d/.git" ] || [ -L "$d/.git" ]; then
      fail "refusing to run in $dir: $d is a git checkout. Use an empty folder such as ~/upload-key in the dedicated user."
    fi
    [ -n "$d" ] && [ "$d" != / ] || break
    d="${d%/*}"
  done
}
check_folder "$PWD"
check_folder "$(pwd -P)"
if [ -e "$KEYSTORE" ] || [ -L "$KEYSTORE" ]; then
  fail "$PWD/$KEYSTORE already exists; refusing to overwrite it. Use an empty folder."
fi
command -v "$KEYTOOL" >/dev/null 2>&1 || fail "keytool not found (install a JDK, or set KEYTOOL)"

pw=''
pw2=''
if [ -t 0 ]; then
  IFS= read -r -s -p "Upload keystore password (letters and digits only, 16+): " pw || true
  echo >&2
  IFS= read -r -s -p "Same password again: " pw2 || true
  echo >&2
  [ "$pw" = "$pw2" ] || fail "the two passwords differ; nothing was created"
else
  # From a password manager: exactly one line on stdin.
  IFS= read -r pw || true
  extra=''
  if IFS= read -r extra || [ -n "$extra" ]; then
    fail "stdin must hold the password on one line and nothing else; nothing was created"
  fi
fi
pw2=''

[[ "$pw" =~ ^[A-Za-z0-9]+$ ]] || fail "the password must be letters and digits only (A-Z, a-z, 0-9); nothing was created"
[ "${#pw}" -ge 16 ] || fail "the password must be at least 16 characters; nothing was created"

# The password reaches keytool only through this environment variable, and only for these two calls.
export JAWWID_UPLOAD_KEYSTORE_PW="$pw"
pw=''
gen_status=0
gen_out="$("$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "$DNAME" \
  -storepass:env "$PW_ENV" -keypass:env "$PW_ENV" 2>&1)" || gen_status=$?
list_status=0
list_out=''
if [ "$gen_status" -eq 0 ]; then
  list_out="$("$KEYTOOL" -list -v -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
    -storepass:env "$PW_ENV" 2>&1)" || list_status=$?
fi
unset JAWWID_UPLOAD_KEYSTORE_PW

if [ "$gen_status" -ne 0 ]; then
  printf '%s\n' "$gen_out" >&2
  fail "keytool could not create the keystore (exit $gen_status). If $KEYSTORE was left behind, delete it yourself before trying again."
fi
[ -f "$KEYSTORE" ] || fail "keytool reported success but $KEYSTORE is missing"
chmod 600 "$KEYSTORE"

if [ "$list_status" -ne 0 ]; then
  printf '%s\n' "$list_out" >&2
  fail "the keystore was created but could not be read back (exit $list_status). Run: keytool -list -v -keystore $KEYSTORE -alias $ALIAS"
fi
fpr="$(printf '%s\n' "$list_out" | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | tr -d '[:space:]')"
fpr_re='^([0-9A-F]{2}:){31}[0-9A-F]{2}$'
if [ "$(printf '%s\n' "$list_out" | grep -c '^[[:space:]]*SHA256:' || true)" != 1 ] || ! [[ "$fpr" =~ $fpr_re ]]; then
  fail "the keystore was created but its SHA-256 could not be read. Run: keytool -list -v -keystore $KEYSTORE -alias $ALIAS"
fi

cat <<EOF
Created $PWD/$KEYSTORE (mode 600).

Environment variable (store-release), not secret:
  ANDROID_UPLOAD_CERT_SHA256 = $fpr

Environment secrets (store-release), paste each value yourself:
  ANDROID_UPLOAD_KEYSTORE_BASE64   = the keystore as base64; this copies it to the clipboard without showing it:
      base64 -i $KEYSTORE | tr -d '\n' | pbcopy
  ANDROID_UPLOAD_KEYSTORE_PASSWORD = the password you just entered
  ANDROID_UPLOAD_KEY_ALIAS         = $ALIAS
  ANDROID_UPLOAD_KEY_PASSWORD      = the same password as ANDROID_UPLOAD_KEYSTORE_PASSWORD
EOF
