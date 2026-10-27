#!/usr/bin/env bash
# Load every vendored, pinned Quran dataset (data/quran/<id>.txt) into the
# database, after the migrations. Idempotent: a dataset already loaded with the
# same fingerprints is skipped; the same id with different fingerprints fails.
#
#   PSQL="psql -v ON_ERROR_STOP=1 $DATABASE_URL" scripts/db/load-quran.sh
#
# Run from the repo checkout (the deploy job, right after scripts/db/apply.sh),
# never inside the API image. docs/product/quran-dataset-contract.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PSQL:?set PSQL, e.g. PSQL=\"psql -v ON_ERROR_STOP=1 \$DATABASE_URL\"}"
shopt -s nullglob
files=(data/quran/*.txt)
if [ "${#files[@]}" -eq 0 ]; then
  echo "load-quran: no dataset vendored in data/quran/; nothing to load"
  exit 0
fi
for file in "${files[@]}"; do
  id="$(basename "$file" .txt)"
  python3 -I scripts/db/load-quran.py --check "$id"
  python3 -I scripts/db/load-quran.py "$id" | $PSQL
done
