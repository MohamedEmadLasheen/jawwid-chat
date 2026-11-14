#!/usr/bin/env bash
# The fast release-gate guards, runnable in one command.
#
#   bash scripts/qa/guards.sh             # run every gate, print a summary
#   bash scripts/qa/guards.sh g18 g20     # run only the named gates
#   bash scripts/qa/guards.sh --list      # gate ids and the CI step each one is
#
# Run it before you push. It is the SAME definition CI runs: every step of the
# "Release-gate guards (fast)" job in .github/workflows/ci.yml is a one-line
# call into this file (`bash scripts/qa/guards.sh <id>`), and the `ci-wiring`
# gate fails if a gate defined here is not called from ci.yml. Two copies of a
# gate drift, and the copy that drifts is always the one nobody runs.
#
# WHY THE PATTERN SCANS ARE NOT grep
# ----------------------------------
# G-20 used to be a GNU-grep one-liner inside ci.yml:
#     grep -rIl $'<name>\|<name>\|...' ...
# Copied to a Mac it fake-PASSES, silently, in more than one way:
#   * zsh -- the default macOS shell -- rewrites `\|` inside $'...' to a bare
#     `|`, which is a literal pipe in a basic regex, so nothing ever matches;
#   * Claude Code's zsh wraps `grep` in a function that runs a different grep
#     (ugrep), with its own regex dialect;
#   * and the local helper, check-employee-name-guard.sh, only ever scanned
#     synthetic temp trees, never the real one.
# On 2026-10-20 a fixture named a child after a protected name, every local
# check passed, and only CI caught it (fixed in b160b1ac).
#
# So the pattern gates (G-18, G-20, G-31..G-35) run through scan() below: one
# small python3 matcher that compares BYTES, so it depends on no shell quoting,
# no grep dialect and no locale. Ubuntu runners and macOS both ship python3. If
# python3 is missing the gate FAILS -- it never passes for want of a tool.
#
# WHICH FILES ARE SCANNED
# -----------------------
# CI runs `grep -r .` over a fresh checkout, which holds exactly the tracked
# files. Locally the equivalent set is `git ls-files --cached --others
# --exclude-standard`: tracked files PLUS untracked, not-ignored ones -- the
# file you have not `git add`ed yet is precisely what this should catch, and
# untracked strays (iCloud's "name (1).ext" duplicates included) are scanned
# just as `grep -r .` would scan them. Ignored paths (build/, .dart_tool/,
# node_modules/) are skipped: they never exist in CI's checkout, and a raw
# recursive grep over them once flagged a private key inside a vendored SDK
# fixture this repository neither wrote nor ships. Outside a git work tree
# scan() walks the directory instead, as `grep -r` does.
#
# grep's flags map one to one: --exclude-dir matches a directory name at any
# depth, --exclude/--include match a file's basename, -I skips a file holding
# a NUL byte, symlinks are not followed. Each gate below keeps CI's original
# patterns and exclusions verbatim.
#
# Portable to macOS (bash 3.2, BSD userland) and Ubuntu: no associative arrays,
# no mapfile, no GNU-only flags.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

PYTHON="${PYTHON:-python3}"

# The product brief names real staff. They are acceptable in docs/, never in
# code, fixtures or seed data (docs/qa/system-inventory.md §4). This array is
# the ONE definition of the list; check-employee-name-guard.sh reads it back
# with `guards.sh --g20-names` rather than repeating it.
G20_NAMES=(رحاب زينب دينا أسماء مريم رضوى رقيه)

# ---------------------------------------------------------------------- scan
# scan [options] PATTERN
#   --exclude-dir NAME   skip any directory with this name, at any depth
#   --exclude GLOB       skip files whose basename matches
#   --include GLOB       scan only files whose basename matches (repeatable)
#   --exempt PATH        skip this exact repo-relative path (a gate definition)
#   -l                   print matching files, not file:line
# Exit status follows grep: 0 = a match was found, 1 = none, 2 = error.
# The matching TEXT is never printed: echoing a leaked key into a CI log copies
# the leak into a second system.
scan() {
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the pattern gates cannot run, so they FAIL"
    return 2
  fi
  "$PYTHON" -I - "$@" <<'PY'
import fnmatch, os, re, subprocess, sys

# os.fsencode undoes argv decoding, so the pattern is the exact bytes the shell
# passed, whatever the locale.
argv = [os.fsencode(a) for a in sys.argv[1:]]
exclude_dirs, excludes, includes, exempt = [], [], [], set()
files_only, pattern = False, None
i = 0
while i < len(argv):
    a = argv[i]
    if a in (b"--exclude-dir", b"--exclude", b"--include", b"--exempt"):
        {b"--exclude-dir": exclude_dirs.append, b"--exclude": excludes.append,
         b"--include": includes.append, b"--exempt": exempt.add}[a](argv[i + 1])
        i += 2
    elif a == b"-l":
        files_only = True
        i += 1
    else:
        pattern = a
        i += 1
if pattern is None:
    sys.stderr.write("scan: no pattern\n")
    sys.exit(2)
rx = re.compile(pattern)


def candidates():
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        out = None
    if out is not None:
        seen = set()
        for p in out.split(b"\0"):
            if p and p not in seen:
                seen.add(p)
                yield p
        return
    for d, dirs, names in os.walk(b"."):
        dirs[:] = sorted(x for x in dirs if x != b".git")
        for n in sorted(names):
            p = os.path.join(d, n)
            yield p[2:] if p.startswith(b"./") else p


def wanted(path):
    if path in exempt:
        return False
    parts = path.split(b"/")
    base = parts[-1]
    for d in parts[:-1]:
        if any(fnmatch.fnmatchcase(d, g) for g in exclude_dirs):
            return False
    if any(fnmatch.fnmatchcase(base, g) for g in excludes):
        return False
    if includes and not any(fnmatch.fnmatchcase(base, g) for g in includes):
        return False
    return True


out = sys.stdout.buffer
found = False
for path in candidates():
    if not wanted(path) or os.path.islink(path) or not os.path.isfile(path):
        continue
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        continue
    if b"\0" in data:  # grep -I: a binary file is never a match
        continue
    hits = [n for n, line in enumerate(data.split(b"\n"), 1) if rx.search(line)]
    if not hits:
        continue
    found = True
    if files_only:
        out.write(path + b"\n")
    else:
        for n in hits:
            out.write(path + b":" + str(n).encode() + b"\n")
out.flush()
sys.exit(0 if found else 1)
PY
}

# A match (0) fails the gate; no match (1) passes; a scanner error (2) fails.
# Never `if scan ...; then fail; fi` alone -- that turns a crashed scanner into
# a pass.
no_match() {
  local rc
  scan "$@"
  rc=$?
  [ "$rc" -eq 1 ] && return 0
  [ "$rc" -ne 0 ] && echo "guards: the scanner itself failed (exit $rc)"
  return 1
}

# ---------------------------------------------------------------------- gates
# Each gate is a function gate_<id> (dashes become underscores). The title is
# the CI step name, kept identical so the log reads the same in both places.

GATE_IDS="g18 g20 g20-meta jc011 g31 secret-scan web-env env-example env-templates app-spec backup-client backup-encryption backup-offsite storage-admin-keys launch-redis pd-registry quran-dataset geo-dataset pd040-routes lesson-writer lessons-supply-chain app-icons actions-pinned ci-wiring"

title() {
  case "$1" in
    g18)           echo "G-18 · no secrets committed" ;;
    g20)           echo "G-20 · no real employee names in source, tests or seed data" ;;
    g20-meta)      echo "G-20 meta-guard · the employee-name guard can pass, and can still fail" ;;
    jc011)         echo "JC-011 · protected regression tests must not be deleted or gutted" ;;
    g31)           echo "G-31..G-35 · Phase 2 functionality must not ship in MVP" ;;
    secret-scan)   echo "Secret scan — worktree and history" ;;
    web-env)       echo "Server secrets must not be reachable from a client bundle" ;;
    env-example)   echo "The local environment example is valid" ;;
    env-templates) echo "Environment templates match the manifest" ;;
    app-spec)      echo "App Platform specs match the manifest and DigitalOcean's schema" ;;
    backup-client) echo "The backup drill runs the pg_dump it is given" ;;
    backup-encryption) echo "Backups are encrypted, and restore refuses what it must" ;;
    backup-offsite) echo "The weekly off-site backup stores only encrypted archives and keeps 8 weeks" ;;
    storage-admin-keys) echo "Spaces: the bucket's versioning and lifecycle are checked with the admin key; the app never receives it" ;;
    launch-redis)  echo "ADR-015 · a LAUNCH_PHASE=launch deploy refuses any Redis but managed, locked-down Valkey" ;;
    pd-registry)   echo "PD numbers and migration slots — one claim each, every migration claimed" ;;
    quran-dataset) echo "The Quran text is pinned: pins, manifests and files agree; the loader refuses what it must" ;;
    geo-dataset)   echo "PD-45 · the country and subdivision dataset is exactly what its pinned CLDR files and reviewed overlay build" ;;
    pd040-routes)  echo "PD-40 · every API route declares the permission it asks of staff" ;;
    lesson-writer) echo "PD-46 · chat.lesson is written only through LessonWriter" ;;
    lessons-supply-chain) echo "The lessons engine: exact pins from the registry, no install scripts, no markers, nothing imported from outside; lesson content resolves in the verified text; the family bundle carries no withheld lesson text; the API's voice-over text is current" ;;
    app-icons)     echo "PD-56 · the app icon and launch image are Jawwid's, never Flutter's template; the 1024 icon is opaque" ;;
    actions-pinned) echo "Every GitHub Action is pinned to a full commit SHA" ;;
    ci-wiring)     echo "Every gate in scripts/qa/guards.sh runs in CI" ;;
    *)             return 1 ;;
  esac
}

gate_g18() {
  local rc=0
  # Hard patterns: never legitimate anywhere in the tree.
  if ! no_match --exclude-dir .git --exclude-dir node_modules --exclude-dir dist \
       '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'; then
    echo "::error::G-18 FAIL — credential material committed"; rc=1
  fi
  # JWT-shaped strings, excluding test files. A synthetic token inside a
  # redaction test is the control working, not a leak (redacting_logger_test.dart
  # asserts such a token never reaches a log), so test paths are exempt from
  # this heuristic only.
  if ! no_match --exclude-dir .git --exclude-dir node_modules --exclude-dir dist \
       --exclude-dir test --exclude-dir tests \
       --exclude '*_test.dart' --exclude '*.spec.ts' --exclude '*.test.ts' \
       'eyJhbGciOi[A-Za-z0-9_-]{10,}'; then
    echo "::error::G-18 FAIL — JWT-shaped credential committed outside a test"; rc=1
  fi
  if git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.(local|production)$' ; then
    echo "::error::G-18 FAIL — a real .env file is tracked"; rc=1
  fi
  [ "$rc" -eq 0 ] && echo "G-18 pass"
  return "$rc"
}

gate_g20() {
  # docs/ is where the brief legitimately names staff. .github is excluded as it
  # always was, and this file is exempt because it is the definition site: it
  # holds the list in order to search for it, so without the exemption the guard
  # matches itself and can never pass. Application and test sources -- and every
  # other script -- are still scanned.
  local alternation
  alternation="$(IFS='|'; echo "${G20_NAMES[*]}")"
  local hits rc
  hits="$(scan -l --exclude-dir .git --exclude-dir node_modules --exclude-dir dist \
            --exclude-dir docs --exclude-dir .github \
            --exempt scripts/qa/guards.sh "($alternation)")"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "::error::G-20 FAIL — real employee names outside docs/:"; echo "$hits"; return 1
  fi
  if [ "$rc" -ne 1 ]; then
    echo "$hits"; echo "::error::G-20 FAIL — the scanner itself failed (exit $rc)"; return 1
  fi
  echo "G-20 pass"
}

gate_g20_meta() { bash scripts/qa/check-employee-name-guard.sh; }

gate_jc011() { bash scripts/qa/check-protected-tests.sh; }

gate_g31() {
  # Advisory scan. Fails only on unmistakable Phase 2 feature wiring.
  if ! no_match --include '*.ts' --include '*.dart' --include '*.tsx' \
       --exclude-dir node_modules --exclude-dir dist \
       '\b(videoCall|enableVideo|startVideo|broadcastToAll|aiScore|aiSuggest|draftWithAI)\b'; then
    echo "::error::G-31..G-35 FAIL — Phase 2 capability referenced in MVP code"; return 1
  fi
  echo "G-31..G-35 pass"
}

gate_secret_scan() { bash scripts/infra/scan-secrets.sh --history; }

gate_web_env() { bash scripts/infra/check-web-env.sh; }

gate_env_example() { bash scripts/infra/check-env.sh local --file .env.example; }

gate_env_templates() {
  # The templates are generated from infra/env/manifest.tsv. A hand-edited
  # template drifts from the checker that deployments run, and the drift is only
  # discovered by a failed release.
  local tmp env rc=0
  tmp="$(mktemp -d)" || return 1
  for env in staging production; do
    if ! bash scripts/infra/render-env-template.sh "$env" > "$tmp/$env.env.example"; then
      echo "could not render the $env template"; rc=1; continue
    fi
    if ! diff -u "infra/env/$env.env.example" "$tmp/$env.env.example"; then
      echo "infra/env/$env.env.example is stale -- regenerate it:"
      echo "  scripts/infra/render-env-template.sh $env > infra/env/$env.env.example"
      rc=1
    fi
  done
  rm -rf "$tmp"
  return "$rc"
}

gate_app_spec() {
  # The DigitalOcean App Platform specs (.do/app.<env>.yaml, ADR-009/ADR-010)
  # are rendered from infra/env/manifest.tsv. The check fails when a committed
  # spec is stale, loses an ADR invariant (one image two commands, the
  # liveness/readiness split, Admin Web as a container), carries a literal
  # value, names a variable its deploy workflow never supplies, or fails
  # `doctl apps spec validate --schema-only` (offline, no credentials). doctl
  # is REQUIRED: without it the gate fails rather than skipping the schema.
  # The selftest runs first and proves each of those drifts is caught.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the app-spec gate cannot run, so it FAILS"
    return 2
  fi
  "$PYTHON" -I scripts/infra/app-spec.py selftest || return 1
  "$PYTHON" -I scripts/infra/app-spec.py check
}

gate_backup_client() {
  # pg_dump refuses to dump from a server newer than itself, so PG_IMAGE naming
  # a client has to outrank whatever is on PATH.
  bash scripts/qa/check-backup-client-selection.sh
}

gate_backup_encryption() {
  # A backup is every family's messages. Without a database: no key outside
  # local/test/ci is refused before pg_dump runs, an encrypted backup leaves no
  # plaintext and no key, and a wrong key or a modified archive is refused
  # before the target is touched. The real-database round trip is G-41.
  bash scripts/qa/check-backup-encryption.sh
}

gate_backup_offsite() {
  # The weekly copy in Spaces (backup-weekly.yml): only .dump.enc with its .hmac
  # leaves the runner, every object is read back, and prune keeps exactly the
  # last 8 weeks. AWS CLI stubbed; no network, no credential.
  bash scripts/qa/check-backup-offsite.sh
}

gate_storage_admin_keys() {
  # Two Spaces keys, never one: storage-versioning.sh runs on STORAGE_ADMIN_*
  # only and refuses without it; the deploy's storage check gets the admin key,
  # the app spec never does. AWS CLI stubbed; no network, no credential.
  bash scripts/qa/check-storage-admin-keys.sh
}

gate_launch_redis() {
  # ADR-015: the review period's in-app Redis cannot reach the public launch.
  # verify-managed-redis.sh with doctl stubbed; no network, no credential. (The
  # app spec's own half -- LAUNCH_PHASE, and the in-app component dropped at
  # launch -- is in the app-spec gate's selftest.)
  bash scripts/qa/check-verify-managed-redis.sh
}

gate_pd_registry() {
  # One file per claim (docs/product/pd-registry/, docs/product/migration-slots/),
  # so parallel PRs only ever ADD files. Refuses a PD number claimed twice, a
  # duplicate migration timestamp, and a migration with no slot claim. The
  # selftest runs first and proves each of those is caught.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the pd-registry gate cannot run, so it FAILS"
    return 2
  fi
  "$PYTHON" -I scripts/docs/registry-index.py selftest || return 1
  "$PYTHON" -I scripts/docs/registry-index.py check
}

gate_quran_dataset() {
  # The shared Quran dataset (docs/product/quran-dataset-contract.md): the
  # loader's refusals are tested (tampered file, count mismatch, split,
  # duplicate or empty ayah), and every pinned fingerprint agrees with its
  # manifest and its vendored file.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the quran-dataset gate cannot run, so it FAILS"
    return 2
  fi
  "$PYTHON" -I scripts/db/test_load_quran.py || return 1
  "$PYTHON" -I scripts/db/check-quran-pins.py
}

gate_geo_dataset() {
  # PD-45 (docs/product/pd045-parent-location-plan.md §3.1): apps/api/src/geo/
  # dataset.json, its LICENSE-CLDR.txt and the migration's generated seed are
  # rebuilt from the pinned CLDR 49 files (data/geo/cldr-49.json) and the
  # reviewed overlay, and must come out byte for byte. The files are downloaded
  # into a temporary directory; one that does not match its SHA-256 pin fails,
  # and so does a missing tool or network -- never a pass for want of either.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the geo-dataset gate cannot run, so it FAILS"
    return 2
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "guards: curl not found -- the geo-dataset gate cannot run, so it FAILS"
    return 2
  fi
  local dir rc
  dir="$(mktemp -d)" || return 2
  PYTHON="$PYTHON" bash scripts/geo/fetch-cldr.sh "$dir" &&
    "$PYTHON" -I scripts/geo/build-dataset.py --cldr "$dir" --check
  rc=$?
  rm -rf "$dir"
  [ "$rc" -eq 0 ] && echo "the geo dataset is what its pinned inputs build"
  return "$rc"
}

gate_pd040_routes() {
  # PD-40: a route with no @Requires / @SelfService / @NotForStaff / @Public is
  # refused to staff at runtime. This catches it before it ships, without Node.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the pd040-routes gate cannot run, so it FAILS"
    return 2
  fi
  "$PYTHON" -I scripts/qa/check-route-permissions.py selftest || return 1
  "$PYTHON" -I scripts/qa/check-route-permissions.py check
}

gate_lesson_writer() {
  # PD-46 §3.1: a lesson write outside LessonWriter is a lesson change nobody hears of.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the lesson-writer gate cannot run, so it FAILS"
    return 2
  fi
  "$PYTHON" -I scripts/qa/check-lesson-writer.py selftest || return 1
  "$PYTHON" -I scripts/qa/check-lesson-writer.py check
}

gate_lessons_supply_chain() {
  # apps/lessons (PD-29 materials quality P0-3) is written from scratch; the old
  # lessons repo was infected through its build config. Exact pins, every locked
  # package from registry.npmjs.org with integrity, no unlisted install scripts,
  # none of the infected family's markers in any git-listed file, no postcss/tailwind
  # config, .vscode or nested node_modules/dist, no unlisted binary, nothing
  # imported or aliased from outside apps/lessons; and the
  # Quran snapshot builds only from the verified dataset. The selftest proves
  # each check can fail.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the lessons-supply-chain gate cannot run, so it FAILS"
    return 2
  fi
  "$PYTHON" -I scripts/qa/check-lessons-supply-chain.py selftest || return 1
  "$PYTHON" -I scripts/qa/check-lessons-supply-chain.py || return 1
  "$PYTHON" -I scripts/lessons/test_build_quran_snapshot.py || return 1
  # P0-4: each lesson's reviewed content resolves in the verified surah and
  # carries no typed Quran.
  "$PYTHON" -I scripts/lessons/check-lesson-content.py selftest || return 1
  "$PYTHON" -I scripts/lessons/check-lesson-content.py || return 1
  # PD-49: the children's Quran content (schema 2) -- positions and tokens
  # resolve, no typed Quran, every citation a public-domain work in its role,
  # asbab only under the display rule, and every approval fresh, complete and
  # resting on pinned editions.
  "$PYTHON" -I scripts/lessons/check-quran-content.py selftest || return 1
  "$PYTHON" -I scripts/lessons/check-quran-content.py || return 1
  # PD-49: every approvals file is the API's signed export, verified under a key
  # of approvals-keys.json (Ed25519, Node's built-in crypto): CI is the trust
  # anchor, so a hand-edited or forged approval fails here.
  if ! command -v node >/dev/null 2>&1; then
    echo "guards: node not found -- the approvals signatures cannot be verified, so the gate FAILS"
    return 2
  fi
  node scripts/lessons/verify-approvals.mjs selftest || return 1
  node scripts/lessons/verify-approvals.mjs || return 1
  # ...a change never adds a key together with what it signs, never re-commits an
  # older export (a replay of something since withdrawn), never signs with a
  # retired key (against the PR's base branch; GITHUB_BASE_REF in CI).
  node scripts/lessons/verify-approvals.mjs diff || return 1
  # PD-29: the family bundle ships no unreviewed lesson text. The check can fail on each
  # kind of leak, and the committed golden (each content file's status, and what ships
  # of a lesson) is current; the ci.yml lessons job runs the check on the real build.
  "$PYTHON" -I scripts/lessons/check-family-bundle.py selftest || return 1
  "$PYTHON" -I scripts/lessons/check-family-bundle.py golden --check || return 1
  # ...and the job that builds the production lessons bundle verifies them
  # before it builds; no other workflow builds that bundle (a hand-built or
  # elsewhere-built bundle cannot skip the check).
  "$PYTHON" -I - <<'PY' || return 1
import glob, re, sys
ci = open('.github/workflows/ci.yml', encoding='utf-8').read()
job = re.search(r'\n  lessons:\n(.*?)(?=\n  [a-z0-9_-]+:\n|\Z)', ci, re.S)
if not job:
    sys.exit('guards: ci.yml has no lessons job')
body = job.group(1)
v, b = body.find('verify-approvals.mjs'), body.find('npm run build')
if v < 0 or b < 0 or v > b:
    sys.exit('guards: the ci.yml lessons job must run scripts/lessons/verify-approvals.mjs before npm run build')
step = re.search(r'^ +run: python3 -I scripts/lessons/check-family-bundle\.py check *$', body, re.M)
c, u = (step.start() if step else -1), body.find('name: lessons-dist-')
if c < 0 or u < 0 or not b < c < u:
    sys.exit('guards: the ci.yml lessons job must run scripts/lessons/check-family-bundle.py check after npm run build and before it uploads lessons-dist')
others = [f for f in glob.glob('.github/workflows/*.yml') if f != '.github/workflows/ci.yml'
          and re.search(r'apps/lessons[^\n]*\n?[^\n]*npm run build|working-directory: apps/lessons', open(f, encoding='utf-8').read())]
if others:
    sys.exit(f'guards: only ci.yml builds the lessons bundle; also built in: {others}')
print('lessons bundle: built only by the ci.yml lessons job, after its approvals verify, and checked for withheld text before upload')
PY
  # PD-49: the API reviews exactly what apps/lessons holds -- its generated map of
  # items and mechanics (with their hashes and required steps) is never stale.
  "$PYTHON" -I scripts/lessons/lesson-content-subjects.py selftest || return 1
  "$PYTHON" -I scripts/lessons/lesson-content-subjects.py check || return 1
  # P0-5: the Arabic letters lessons -- every word holds its unit's letter by the
  # one rule (no folding), full tashkeel with the pausal sukun, and every quiz
  # question has exactly one right answer.
  "$PYTHON" -I scripts/lessons/check-arabic-lesson.py selftest || return 1
  "$PYTHON" -I scripts/lessons/check-arabic-lesson.py || return 1
  # PD-48: the API's copy of each lesson's approved text is current (a changed
  # word switches its voice-over clip off), and no lesson uses the browser's
  # own speech synthesis.
  "$PYTHON" -I scripts/lessons/lesson-audio-texts.py selftest || return 1
  "$PYTHON" -I scripts/lessons/lesson-audio-texts.py check || return 1
  # PD-48: the operator's generation script plans and refuses as it must (no network, no key).
  "$PYTHON" -I scripts/lessons/tts/tts.py selftest
}

gate_app_icons() {
  python3 scripts/qa/check-app-icons.py || return 1
  # OT-2b, in this PD-56 store-build gate: the store-upload workflow and scripts/mobile can only
  # put a build on a testing channel (Play internal track as a draft, TestFlight); manual trigger
  # only, id-token only in the Android job, pinned actions, no artifacts, no expression in a run
  # block. The selftest runs first and proves each rule can fail.
  bash scripts/qa/check-store-upload-guards.sh selftest || return 1
  bash scripts/qa/check-store-upload-guards.sh check
}

gate_actions_pinned() {
  # P3-11. A tag (`@v4`) or branch (`@main`) is a moving pointer: whoever
  # controls the action's repository can repoint it, and the next run executes
  # their code with this repository's secrets. Every `uses:` must name a full
  # 40-hex commit (`owner/repo@<sha> # vX.Y.Z`). Local actions (`./...`) and
  # `docker://image@sha256:<64 hex>` are allowed. A PR that adds an unpinned
  # action must pin it to the commit its tag resolves to.
  #
  # Scanned: .github/workflows/*.yml|*.yaml and .github/actions/**/action.yml|
  # action.yaml. The scan is python, not grep (see the header). It fails closed:
  # a `uses:` written in a form it does not recognise (a flow mapping, a block
  # scalar) fails, and so does a tree with no workflow at all. The selftest
  # runs first and proves the gate fails on `@v4`, `@main` and the other
  # floating forms, and passes on a pinned line.
  if ! command -v "$PYTHON" >/dev/null 2>&1; then
    echo "guards: $PYTHON not found -- the actions-pinned gate cannot run, so it FAILS"
    return 2
  fi
  actions_pinned selftest || return 1
  actions_pinned check .
}

# actions_pinned selftest | check ROOT
actions_pinned() {
  "$PYTHON" -I - "$@" <<'PY'
import os, re, shutil, sys, tempfile

SHA = "0123456789abcdef0123456789abcdef01234567"
DIGEST = "sha256:" + "ab" * 32

# A `uses:` key: `uses: x`, `- uses: x`, optionally quoted key or value.
USES = re.compile(r"""^\s*(?:-\s+)?(["']?)uses\1\s*:\s*(.*)$""")
ANY_USES = re.compile(r"""(?:^|[^A-Za-z0-9_-])["']?uses["']?\s*:""")
PINNED = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[^@\s]+)?@[0-9a-f]{40}$")
DOCKER = re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}$")


def files(root):
    out = []
    wf = os.path.join(root, ".github", "workflows")
    if os.path.isdir(wf):
        for n in sorted(os.listdir(wf)):
            p = os.path.join(wf, n)
            if n.endswith((".yml", ".yaml")) and os.path.isfile(p):
                out.append(p)
    acts = os.path.join(root, ".github", "actions")
    for d, dirs, names in os.walk(acts):
        dirs.sort()
        for n in sorted(names):
            if n in ("action.yml", "action.yaml"):
                out.append(os.path.join(d, n))
    return out


def strip_comment(line):
    # YAML: a comment starts at a `#` that begins the line or follows a space.
    m = re.search(r"(^|\s)#", line)
    return line[:m.start()] if m else line


def allowed(ref):
    return ref.startswith("./") or bool(DOCKER.match(ref)) or bool(PINNED.match(ref))


def check(root):
    """Returns (number of files scanned, list of 'path:line: problem')."""
    found = files(root)
    bad = []
    for path in found:
        rel = os.path.relpath(path, root)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().split("\n")
        for n, raw in enumerate(lines, 1):
            line = strip_comment(raw)
            if not ANY_USES.search(line):
                continue
            m = USES.match(line)
            ref = m.group(2).strip() if m else ""
            if len(ref) >= 2 and ref[0] == ref[-1] and ref[0] in "\"'":
                ref = ref[1:-1].strip()
            if not m or not ref or ref[0] in "|>{[&*!":
                bad.append("%s:%d: a `uses:` in a form this gate cannot read; write it as `uses: owner/repo@<40-hex sha>`" % (rel, n))
            elif not allowed(ref):
                bad.append("%s:%d: %s is not pinned to a full commit SHA" % (rel, n, ref))
    return len(found), bad


def report(root):
    count, bad = check(root)
    if count == 0:
        print("actions-pinned: no workflow found under %s/.github -- nothing was checked, so it FAILS" % root)
        return 1
    if bad:
        print("::error::actions-pinned FAIL -- pin each action to the commit its tag resolves to (`owner/repo@<sha> # vX.Y.Z`):")
        for b in bad:
            print("  " + b)
        return 1
    print("actions-pinned pass (%d files, every action pinned to a commit)" % count)
    return 0


def selftest():
    # (where, the `uses:` line, should it pass?)
    cases = [
        ("wf", "      - uses: actions/checkout@v4", False),
        ("wf", "      - uses: actions/checkout@main", False),
        ("wf", "      - uses: actions/checkout@v4.2.1", False),
        ("wf", "      - uses: actions/checkout", False),
        ("wf", "      - uses: actions/checkout@" + SHA[:39], False),
        ("wf", "      - uses: actions/checkout@" + SHA.upper(), False),
        ("wf", "      - uses: actions/checkout@" + SHA + "0", False),
        ("wf", "      - uses: \"actions/checkout@v4\"", False),
        ("wf", "      - 'uses': actions/checkout@main", False),
        ("wf", "      - {uses: actions/checkout@v4}", False),
        ("wf", "        uses: >-", False),
        ("wf", "    uses: org/repo/.github/workflows/build.yml@main", False),
        ("wf", "      - uses: docker://alpine:3.19", False),
        ("wf", "      - uses: docker://alpine@sha256:" + "AB" * 32, False),
        ("act", "    - uses: actions/setup-node@v4", False),
        ("wf", "      - uses: actions/checkout@" + SHA + " # v4.2.1", True),
        ("wf", "      - uses: 'actions/checkout@" + SHA + "'", True),
        ("wf", "        uses: github/codeql-action/init@" + SHA, True),
        ("wf", "    uses: org/repo/.github/workflows/build.yml@" + SHA, True),
        ("wf", "      - uses: ./.github/actions/setup", True),
        ("wf", "      - uses: docker://alpine@" + DIGEST, True),
        ("wf", "      # - uses: actions/checkout@v4", True),
        ("wf", "        run: echo refuses: nothing  # uses: actions/checkout@v4", True),
        ("act", "    - uses: actions/setup-node@" + SHA + " # v4.4.0", True),
    ]
    failures = 0
    for where, line, ok in cases:
        tmp = tempfile.mkdtemp()
        try:
            wf = os.path.join(tmp, ".github", "workflows")
            os.makedirs(wf)
            with open(os.path.join(wf, "ci.yml"), "w") as f:
                f.write("name: t\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n")
                if where == "wf":
                    f.write(line + "\n")
            if where == "act":
                act = os.path.join(tmp, ".github", "actions", "setup")
                os.makedirs(act)
                with open(os.path.join(act, "action.yml"), "w") as f:
                    f.write("name: s\nruns:\n  using: composite\n  steps:\n" + line + "\n")
            _, bad = check(tmp)
            if (not bad) != ok:
                failures += 1
                print("selftest: expected %s, got %s: %s (%s)"
                      % ("PASS" if ok else "FAIL", "PASS" if not bad else "FAIL", line.strip(), where))
        finally:
            shutil.rmtree(tmp)
    # A tree with no workflow at all must fail, never pass for want of input.
    tmp = tempfile.mkdtemp()
    try:
        devnull = open(os.devnull, "w")
        saved, sys.stdout = sys.stdout, devnull
        try:
            rc = report(tmp)
        finally:
            sys.stdout = saved
            devnull.close()
        if rc == 0:
            failures += 1
            print("selftest: an empty tree passed")
    finally:
        shutil.rmtree(tmp)
    if failures:
        print("::error::actions-pinned selftest FAIL (%d case(s))" % failures)
        return 1
    print("actions-pinned selftest pass (%d cases)" % (len(cases) + 1))
    return 0


if len(sys.argv) >= 2 and sys.argv[1] == "selftest":
    sys.exit(selftest())
if len(sys.argv) == 3 and sys.argv[1] == "check":
    sys.exit(report(sys.argv[2]))
sys.stderr.write("usage: actions_pinned selftest | check ROOT\n")
sys.exit(2)
PY
}

gate_ci_wiring() {
  # The anti-drift check: a gate added here but never called from CI would pass
  # locally and guard nothing.
  local ci=.github/workflows/ci.yml id rc=0
  [ -f "$ci" ] || { echo "$ci not found"; return 1; }
  for id in $GATE_IDS; do
    if ! grep -Eq "scripts/qa/guards\.sh ${id}([[:space:]]|\$)" "$ci"; then
      echo "ci.yml never runs 'bash scripts/qa/guards.sh $id' ($(title "$id"))"
      rc=1
    fi
  done
  [ "$rc" -eq 0 ] && echo "every gate is called from ci.yml"
  return "$rc"
}

run_gate() {
  local fn
  fn="gate_$(printf '%s' "$1" | tr '-' '_')"
  "$fn"
}

# ----------------------------------------------------------------------- main
case "${1:-}" in
  --list)
    for id in $GATE_IDS; do printf '%-14s %s\n' "$id" "$(title "$id")"; done
    exit 0 ;;
  --g20-names)
    printf '%s\n' "${G20_NAMES[@]}"
    exit 0 ;;
  -h|--help)
    sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
esac

if [ "$#" -gt 0 ]; then
  # Named gates, output streamed: this is the form each CI step uses.
  status=0
  for id in "$@"; do
    if ! title "$id" >/dev/null; then
      echo "guards: unknown gate '$id' (see --list)"; exit 2
    fi
    run_gate "$id" || status=1
  done
  exit "$status"
fi

# Every gate, each one run even after another fails, then a summary.
echo "Release-gate guards (fast) -- docs/qa/release-gate.md §8"
out="$(mktemp)" || exit 2
trap 'rm -f "$out"' EXIT
total=0
failed=0
failed_titles=""
for id in $GATE_IDS; do
  total=$((total + 1))
  t="$(title "$id")"
  # Status first: printf pads by bytes, and the titles hold multi-byte "·"/"—".
  if run_gate "$id" >"$out" 2>&1; then
    printf '  PASS  %s\n' "$t"
  else
    printf '  FAIL  %s\n' "$t"
    sed 's/^/          /' "$out" | head -40
    failed=$((failed + 1))
    failed_titles="$failed_titles
  - $id: $t"
  fi
done

echo
if [ "$failed" -eq 0 ]; then
  echo "guards: PASS ($total/$total)"
  exit 0
fi
echo "guards: FAIL ($failed of $total)$failed_titles"
echo "Re-run one with: bash scripts/qa/guards.sh <id>"
exit 1
