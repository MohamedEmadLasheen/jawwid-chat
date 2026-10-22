#!/usr/bin/env bash
# Install a pinned, checksum-verified doctl on a Linux x86-64 runner.
# Owner: infrastructure.
#
#   scripts/infra/install-doctl.sh            # installs into $RUNNER_TEMP/bin (or ./.bin)
#
# Used by CI (the `app-spec` guard validates the app specs with
# `doctl apps spec validate --schema-only`, which needs no credentials) and by
# the deploy workflows. Pinned and verified rather than a floating "latest":
# the deploy job hands this binary the DigitalOcean token.
#
# On a Mac: brew install doctl.
set -euo pipefail

VERSION="1.168.0"
SHA256="ad817330e1a12fd60729f105d8c39af31ca845f221a60886a1b2215f74d9b35d"   # doctl-1.168.0-linux-amd64.tar.gz

[ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] \
  || { echo "install-doctl.sh supports Linux x86-64 only; on macOS: brew install doctl" >&2; exit 1; }

DEST="${RUNNER_TEMP:-$PWD}/bin"
mkdir -p "$DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

archive="doctl-${VERSION}-linux-amd64.tar.gz"
curl -fsSL --retry 3 -o "$tmp/$archive" \
  "https://github.com/digitalocean/doctl/releases/download/v${VERSION}/${archive}"
echo "${SHA256}  $tmp/$archive" | sha256sum -c - >/dev/null \
  || { echo "::error::doctl ${VERSION} checksum mismatch -- refusing to install"; exit 1; }
tar -xzf "$tmp/$archive" -C "$tmp" doctl
install -m 0755 "$tmp/doctl" "$DEST/doctl"

[ -n "${GITHUB_PATH:-}" ] && echo "$DEST" >> "$GITHUB_PATH"
"$DEST/doctl" version | head -1
