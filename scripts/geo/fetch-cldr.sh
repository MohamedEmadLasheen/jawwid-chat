#!/usr/bin/env bash
# PD-45: download the pinned CLDR files into <out-dir>, at their CLDR paths,
# and refuse any whose SHA-256 is not the pin in data/geo/cldr-49.json.
#
#   bash scripts/geo/fetch-cldr.sh <out-dir>
#   python3 -I scripts/geo/build-dataset.py --cldr <out-dir> --check
#
# <out-dir> should be a new, empty directory outside the repository: the files
# are data, read by build-dataset.py's fixed patterns and never executed.
set -euo pipefail

out="${1:?usage: fetch-cldr.sh <out-dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
manifest="$root/data/geo/cldr-49.json"
PYTHON="${PYTHON:-/usr/bin/python3}"

tag="$("$PYTHON" -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["tag"])' "$manifest")"
"$PYTHON" -I -c 'import json,sys; print("\n".join(sorted(json.load(open(sys.argv[1]))["files"])))' "$manifest" |
while IFS= read -r rel; do
  mkdir -p "$out/$(dirname "$rel")"
  curl -sSfL --proto '=https' "https://raw.githubusercontent.com/unicode-org/cldr/$tag/$rel" -o "$out/$rel"
done

"$PYTHON" -I - "$manifest" "$out" <<'PY'
import hashlib, json, os, sys
manifest, out = sys.argv[1], sys.argv[2]
bad = []
for rel, want in sorted(json.load(open(manifest))['files'].items()):
    got = hashlib.sha256(open(os.path.join(out, rel), 'rb').read()).hexdigest()
    if got != want:
        bad.append(f'{rel}: {got} (pinned {want})')
if bad:
    sys.exit('fetch-cldr: these files do not match their pins:\n  ' + '\n  '.join(bad))
print(f'fetch-cldr: every file matches its pin ({out})')
PY
