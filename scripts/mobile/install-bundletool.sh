#!/usr/bin/env bash
# W56: downloads bundletool from its official GitHub release, refuses it unless its SHA-256 is the one
# pinned below, and prints the path of the verified jar. Used by
# .github/workflows/release-store-builds.yml to read the signed App Bundle's manifest
# (scripts/mobile/verify-store-artifact.sh). The same version and digest as the release-readiness
# workflow of #523.
#
#   bash scripts/mobile/install-bundletool.sh <empty directory to install into>
#
# Whoever bumps BUNDLETOOL_VERSION copies the digest from the release page (GitHub shows each
# asset's sha256) in the same change.
set -euo pipefail

readonly BUNDLETOOL_VERSION='1.18.3'
readonly BUNDLETOOL_SHA256='a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'

err() { printf 'install-bundletool: %s\n' "$*" >&2; }

[ "$#" -eq 1 ] || { err "usage: $0 <directory>"; exit 2; }
DEST="$1"
mkdir -p "$DEST"
[ -z "$(ls -A "$DEST")" ] || { err "refused: $DEST is not empty"; exit 2; }

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

asset="bundletool-all-$BUNDLETOOL_VERSION.jar"
f="$DEST/bundletool.download"
curl -fsSL --proto '=https' --tlsv1.2 -o "$f" \
  "https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/$asset" \
  || { rm -f "$f"; err "could not download $asset"; exit 1; }
got="$(sha256_of "$f")"
if [ "$got" != "$BUNDLETOOL_SHA256" ]; then
  rm -f "$f"
  err "refused: $asset does not match its pinned SHA-256 (got $got)"
  exit 1
fi
mv "$f" "$DEST/$asset"
chmod 444 "$DEST/$asset"
printf '%s\n' "$DEST/$asset"
