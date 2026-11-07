#!/usr/bin/env bash
# Two Spaces keys, never one: the application's bucket-limited key runs the API,
# the administrative key checks and sets the bucket's versioning and lifecycle.
# scripts/infra/storage-versioning.sh with the AWS CLI stubbed (no network, no
# credential), plus a static read of the workflows, manifest and app specs.
#
#   1  verify uses the ADMIN key, never the application key, and passes on a
#      bucket with versioning Enabled + the 30-day, 1-day and probe rules
#   2  apply uses the ADMIN key for every call
#   3  only the application key set: refused before any call, naming STORAGE_ADMIN_*
#   4  an admin key equal to the application key: refused before any call
#   5  strict: Suspended versioning, a missing probe rule, a missing multipart
#      rule, a refused lifecycle read -- each fails
#   6  no key value appears in any output
#   7  workflows: the storage steps get only STORAGE_ADMIN_*, the app-spec step
#      never does; nothing that builds the app (manifest, .do specs) names them
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/infra/storage-versioning.sh"
FAILED=0
ok()   { echo "  ok  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/jawwid-storage-keys.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin"
export STUB_DIR="$SANDBOX"

# aws: records which access key id made each call, answers from files.
cat > "$SANDBOX/bin/aws" <<'STUB'
#!/usr/bin/env bash
echo "$AWS_ACCESS_KEY_ID $*" >> "$STUB_DIR/calls"
[ -z "${STORAGE_ACCESS_KEY:-}" ] || echo "LEAKED-APP-KEY-TO-CHILD" >> "$STUB_DIR/calls"
args="$*"
case "$args" in
  *get-bucket-versioning*) cat "$STUB_DIR/versioning" ;;
  *get-bucket-lifecycle-configuration*)
    [ -f "$STUB_DIR/lifecycle-refused" ] && { echo "AccessDenied" >&2; exit 254; }
    cat "$STUB_DIR/lifecycle.json" ;;
  *put-bucket-versioning*|*put-bucket-lifecycle-configuration*) : ;;
  *) echo "stub aws: unexpected call: $*" >&2; exit 2 ;;
esac
STUB
chmod +x "$SANDBOX/bin/aws"

APP_ID="APPKEY0000000000APP1"; APP_SECRET="app-secret-value-9c1e"
ADMIN_ID="ADMKEY0000000000ADM1"; ADMIN_SECRET="admin-secret-value-4b7d"

good_bucket() {
  echo "Enabled" > "$SANDBOX/versioning"
  rm -f "$SANDBOX/lifecycle-refused"
  cat > "$SANDBOX/lifecycle.json" <<'JSON'
{"Rules":[
 {"ID":"jawwid-noncurrent-30d","Status":"Enabled","Filter":{"Prefix":""},
  "NoncurrentVersionExpiration":{"NoncurrentDays":30},
  "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}},
 {"ID":"jawwid-lifecycle-probe","Status":"Enabled","Filter":{"Prefix":"_lifecycle-probe/"},
  "NoncurrentVersionExpiration":{"NoncurrentDays":1}}]}
JSON
}

# run MODE [extra env...]: both keys present unless overridden.
run() {
  local mode="$1"; shift
  : > "$SANDBOX/calls"
  env PATH="$SANDBOX/bin:$PATH" \
    STORAGE_ENDPOINT=https://fra1.example.invalid STORAGE_BUCKET=b STORAGE_REGION=fra1 \
    STORAGE_ACCESS_KEY="$APP_ID" STORAGE_SECRET_KEY="$APP_SECRET" \
    STORAGE_ADMIN_ACCESS_KEY="$ADMIN_ID" STORAGE_ADMIN_SECRET_KEY="$ADMIN_SECRET" \
    "$@" bash "$SCRIPT" "$mode" > "$SANDBOX/out" 2>&1
}
calls_by() { grep -c "^$1 " "$SANDBOX/calls" 2>/dev/null || true; }
ALL_OUT="$SANDBOX/all-out"; : > "$ALL_OUT"
keep() { cat "$SANDBOX/out" >> "$ALL_OUT"; }

# 1 --------------------------------------------------------------------------
good_bucket
if run verify; then
  if [ "$(calls_by "$ADMIN_ID")" -eq 2 ] && [ "$(calls_by "$APP_ID")" -eq 0 ] \
     && ! grep -q LEAKED "$SANDBOX/calls"; then
    ok "verify reads versioning and lifecycle with the admin key only; the app key never reaches the AWS CLI"
  else fail "verify called aws with: $(cut -d' ' -f1 "$SANDBOX/calls" | sort | uniq -c | tr '\n' ' ')"; fi
else fail "verify failed on a correctly configured bucket: $(cat "$SANDBOX/out")"; fi
keep

# 2 --------------------------------------------------------------------------
good_bucket
if run apply && [ "$(calls_by "$ADMIN_ID")" -eq 4 ] && [ "$(calls_by "$APP_ID")" -eq 0 ]; then
  ok "apply sets versioning and lifecycle, and reads them back, with the admin key only"
else fail "apply: $(cat "$SANDBOX/out"); calls: $(cut -d' ' -f1-3 "$SANDBOX/calls" | tr '\n' ';')"; fi
keep

# 3 --------------------------------------------------------------------------
good_bucket
if run verify STORAGE_ADMIN_ACCESS_KEY= STORAGE_ADMIN_SECRET_KEY= ; then
  fail "verify ran without an admin key (on the application key?)"
elif [ ! -s "$SANDBOX/calls" ] && grep -q "STORAGE_ADMIN_ACCESS_KEY is not set" "$SANDBOX/out" \
     && grep -q "Nothing was checked or changed" "$SANDBOX/out"; then
  ok "no admin key: refused before any call, naming STORAGE_ADMIN_ACCESS_KEY (the app key is not a fallback)"
else fail "no admin key: calls=$(wc -l < "$SANDBOX/calls"), out: $(cat "$SANDBOX/out")"; fi
keep
if run apply STORAGE_ADMIN_SECRET_KEY= ; then
  fail "apply ran with an empty admin secret"
elif [ ! -s "$SANDBOX/calls" ] && grep -q "STORAGE_ADMIN_SECRET_KEY is not set" "$SANDBOX/out"; then
  ok "half an admin key (secret missing): refused before any call"
else fail "half an admin key: $(cat "$SANDBOX/out")"; fi
keep

# 4 --------------------------------------------------------------------------
if run verify STORAGE_ADMIN_ACCESS_KEY="$APP_ID" STORAGE_ADMIN_SECRET_KEY="$APP_SECRET"; then
  fail "an admin key equal to the application key was accepted"
elif [ ! -s "$SANDBOX/calls" ] && grep -q "is the application's STORAGE_ACCESS_KEY" "$SANDBOX/out"; then
  ok "an admin key that is the application key: refused before any call"
else fail "admin == app: $(cat "$SANDBOX/out")"; fi
keep

# 5 --------------------------------------------------------------------------
strict() {   # strict LABEL EXPECT  (bucket already altered)
  if run verify; then fail "strict: $1 passed"
  elif grep -q "$2" "$SANDBOX/out"; then ok "strict: $1 fails"
  else fail "strict: $1 failed without saying '$2': $(cat "$SANDBOX/out")"; fi
  keep
}
good_bucket; echo "Suspended" > "$SANDBOX/versioning"; strict "versioning Suspended" "not Enabled"
good_bucket; echo "None" > "$SANDBOX/versioning";      strict "versioning never enabled" "not Enabled"
good_bucket; python3 -I - "$SANDBOX/lifecycle.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
d["Rules"] = [r for r in d["Rules"] if r["ID"] != "jawwid-lifecycle-probe"]; json.dump(d, open(p, "w"))
PY
strict "the probe rule missing" "probe rule"
good_bucket; python3 -I - "$SANDBOX/lifecycle.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
del d["Rules"][0]["AbortIncompleteMultipartUpload"]; json.dump(d, open(p, "w"))
PY
strict "the multipart rule missing" "multipart"
good_bucket; python3 -I - "$SANDBOX/lifecycle.json" <<'PY'
import json, sys; p = sys.argv[1]; d = json.load(open(p))
d["Rules"][0]["NoncurrentVersionExpiration"]["NoncurrentDays"] = 7; json.dump(d, open(p, "w"))
PY
strict "noncurrent expiry shorter than 30 days" "30 days"
good_bucket; touch "$SANDBOX/lifecycle-refused"; strict "a refused lifecycle read" "GetBucketLifecycleConfiguration"

# 6 --------------------------------------------------------------------------
if grep -qF -e "$APP_SECRET" -e "$ADMIN_SECRET" -e "$APP_ID" -e "$ADMIN_ID" "$ALL_OUT"; then
  fail "a key id or secret appeared in the script's output"
else ok "no key id or secret appears in any output"; fi

# 7 --------------------------------------------------------------------------
if python3 -I - "$ROOT" <<'PY'
import glob, os, re, sys
root = sys.argv[1]
problems = []

def steps(path):
    """(name, text) per step of every job, by indentation; good enough for these files."""
    text = open(path, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"\n      - (?:name: ([^\n]*)|uses: [^\n]*)\n(.*?)(?=\n      - |\n  [a-z0-9_-]+:\n|\Z)", text, re.S):
        out.append(((m.group(1) or "").strip(), m.group(0)))
    return text, out

ADMIN = re.compile(r"STORAGE_ADMIN_(ACCESS|SECRET)_KEY")
APP_SECRET_REF = re.compile(r"secrets\.STORAGE_(ACCESS|SECRET)_KEY\b")

# deploy-production: the storage step uses admin only; the app-spec step never sees admin.
text, ss = steps(os.path.join(root, ".github/workflows/deploy-production.yml"))
storage = [s for n, s in ss if n.startswith("Object storage keeps deleted objects")]
resolve = [s for n, s in ss if n.startswith("Validate the production configuration")]
if len(storage) != 1: problems.append("deploy-production: no single 'Object storage keeps deleted objects' step")
else:
    s = storage[0]
    if "secrets.STORAGE_ADMIN_ACCESS_KEY" not in s or "secrets.STORAGE_ADMIN_SECRET_KEY" not in s:
        problems.append("deploy-production: the storage check does not use STORAGE_ADMIN_*")
    if APP_SECRET_REF.search(s):
        problems.append("deploy-production: the storage check receives the application's STORAGE_ACCESS_KEY/SECRET_KEY")
if len(resolve) != 1: problems.append("deploy-production: no single app-spec validation step")
elif ADMIN.search(resolve[0]):
    problems.append("deploy-production: the app-spec step (what the app runs with) receives STORAGE_ADMIN_*")
for n, s in ss:
    # Admin VALUES only in the storage step; elsewhere only as a boolean (!= '' / ==).
    for line in s.splitlines():
        if "secrets.STORAGE_ADMIN_" in line and not n.startswith("Object storage keeps deleted objects"):
            if not re.search(r"\$\{\{[^}]*secrets\.STORAGE_ADMIN_[A-Z_]+ *(!=|==)", line):
                problems.append(f"deploy-production: step '{n}' receives an admin key value: {line.strip()}")

# storage-versioning.yml: admin only, the app key at most compared as a boolean.
text, ss = steps(os.path.join(root, ".github/workflows/storage-versioning.yml"))
for n, s in ss:
    for line in s.splitlines():
        if APP_SECRET_REF.search(line) and not re.search(r"== *secrets\.STORAGE_ACCESS_KEY *\}\}", line):
            problems.append(f"storage-versioning.yml: step '{n}' receives the application key: {line.strip()}")
run_step = [s for n, s in ss if n.startswith("storage-versioning.sh")]
if len(run_step) != 1 or "secrets.STORAGE_ADMIN_ACCESS_KEY" not in run_step[0]:
    problems.append("storage-versioning.yml: the script step does not use STORAGE_ADMIN_*")

# Nothing that configures the app may name the admin key.
for f in ["infra/env/manifest.tsv", ".do/app.production.yaml", ".do/app.staging.yaml",
          ".env.example", "apps/api/.env.example", "docker-compose.yml",
          ".github/workflows/deploy-staging.yml"] + glob.glob(os.path.join(root, "infra/env/*.env.example")):
    p = f if os.path.isabs(f) else os.path.join(root, f)
    if os.path.exists(p) and ADMIN.search(open(p, encoding="utf-8").read()):
        problems.append(f"{os.path.relpath(p, root)} names STORAGE_ADMIN_* (the app must never receive it)")
for f in glob.glob(os.path.join(root, "apps/**/*.ts"), recursive=True):
    if "node_modules" in f: continue
    if ADMIN.search(open(f, encoding="utf-8").read()):
        problems.append(f"{os.path.relpath(f, root)} reads STORAGE_ADMIN_*")

for p in problems: print("    " + p)
sys.exit(1 if problems else 0)
PY
then ok "workflows: storage checks use only STORAGE_ADMIN_*; the app spec, manifest and app code never name it"
else fail "workflow / configuration separation (above)"; fi

exit "$FAILED"
