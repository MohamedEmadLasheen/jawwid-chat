#!/usr/bin/env bash
# OT-2b: downloads sentry-cli from its official GitHub release, refuses it unless its SHA-256 is the
# one pinned below, and prints the path of the verified binary. Used by
# .github/workflows/release-store-builds.yml to upload debug symbols (docs/mobile/store-builds.md).
#
#   bash scripts/mobile/install-sentry-cli.sh <empty directory to install into>
#
# Whoever bumps SENTRY_CLI_VERSION copies both digests from the release page (GitHub shows each
# asset's sha256) in the same change.
set -euo pipefail

readonly SENTRY_CLI_VERSION='3.8.2'
readonly SHA256_LINUX_X86_64='c958865f9d4000183509ea21b1f04925d5390de6d8d87386b9e69f2b305070c3'
readonly SHA256_DARWIN_UNIVERSAL='2d1b118fa46960ba5e8e0cca9a6e197366905776a0ddc5a89c7d05a3908b77db'

err() { printf 'install-sentry-cli: %s\n' "$*" >&2; }

[ "$#" -eq 1 ] || { err "usage: $0 <directory>"; exit 2; }
DEST="$1"
mkdir -p "$DEST"
[ -z "$(ls -A "$DEST")" ] || { err "refused: $DEST is not empty"; exit 2; }

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) asset='sentry-cli-Linux-x86_64'; want="$SHA256_LINUX_X86_64" ;;
  Darwin/*) asset='sentry-cli-Darwin-universal'; want="$SHA256_DARWIN_UNIVERSAL" ;;
  *) err "no pinned sentry-cli build for $(uname -s)/$(uname -m)"; exit 1 ;;
esac

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

f="$DEST/sentry-cli.download"
curl -fsSL --proto '=https' --tlsv1.2 -o "$f" \
  "https://github.com/getsentry/sentry-cli/releases/download/$SENTRY_CLI_VERSION/$asset" \
  || { rm -f "$f"; err "could not download $asset $SENTRY_CLI_VERSION"; exit 1; }
got="$(sha256_of "$f")"
if [ "$got" != "$want" ]; then
  rm -f "$f"
  err "refused: $asset $SENTRY_CLI_VERSION does not match its pinned SHA-256 (got $got)"
  exit 1
fi
mv "$f" "$DEST/sentry-cli"
chmod 755 "$DEST/sentry-cli"
printf '%s\n' "$DEST/sentry-cli"
