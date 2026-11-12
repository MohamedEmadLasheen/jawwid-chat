#!/usr/bin/env bash
# OT-2b: the store-upload workflow can only ever put a build on a TESTING channel.
#
#   bash scripts/qa/check-store-upload-guards.sh check      # the real files
#   bash scripts/qa/check-store-upload-guards.sh selftest   # every rule below can fail
#
# Run by scripts/qa/guards.sh (inside the app-icons gate, the PD-56 store-build gate), so CI fails
# when .github/workflows/release-store-builds.yml or scripts/mobile/** drift. It fails if:
#   - the workflow has any trigger but workflow_dispatch;
#   - any job but `android` has id-token: write (or the workflow default permissions are anything
#     but contents: read, or write-all appears);
#   - scripts/mobile/play-upload.sh's package, track or status constants are not exactly
#     com.jawwid.jawwid_chat / internal / draft, are assigned more than once, are read from
#     anywhere, are not what its URLs and request body use, or its override refusal is gone; or its
#     track-answer check (one draft of exactly [versionCode], no other release carrying it, every
#     release a draft or a finished one) is not on its pinned lines;
#   - a store channel or action word appears in the workflow or scripts/mobile (production, beta,
#     alpha, rollout, completed, notarization, the Transporter binary name, submit..., the App Store
#     review and release-type API names), outside the few lines listed in ALLOW below;
#   - a GitHub artifact upload appears;
#   - any action is not pinned to a full commit SHA;
#   - an expression (an input or anything else) is written inside a run block: inputs reach the
#     shell through env only;
#   - a script in scripts/mobile other than play-upload.sh talks to the Play Developer API, or
#     anything calls the App Store Connect API directly;
#   - (R1) the iOS upload is not the exact verified .ipa: more than one exportArchive, an export
#     with destination upload, uploadSymbols not false; altool on any line but its pinned help,
#     two --upload-package lines (with and without --apple-id and the bundle flags) and
#     --upload-app line (so no other altool mode, no notarization), xcrun on any other line,
#     altool or xcrun in scripts/mobile; Transporter named outside its listed lines or in a mode
#     other than `-m upload`; anything but exactly one line per uploader, each uploading
#     "$VERIFIED_IPA" and each IMMEDIATELY preceded by the SHA-256 re-check; the .ipa not made
#     read-only, or not checked still read-only before the upload; success not requiring exit 0
#     AND the uploader's own success line ("No errors uploading" or "UPLOAD SUCCEEDED" for altool);
#   - (R2) the Google sign-in (google-github-actions/auth) is anywhere but once in the android job,
#     after that job's identity check; preflight or android does not assert the repository id,
#     owner id, repository, ref and workflow ref; android or ios is not in store-release;
#   - (R3) the Sentry token appears anywhere but its env lines; an auth-token flag, a debug/trace
#     log level, set -x, a sentry-cli subcommand other than --version / debug-files upload /
#     upload-proguard, a sentry-cli call whose output is not captured, a source upload flag or a
#     sentry config file; a Sentry step without SENTRY_LOG_LEVEL: warn; or an always-cleanup that
#     does not delete build/symbols and $RUNNER_TEMP/sentry-out;
#   - (P2-2) a Sentry step that, before its first upload, does not unset every other SENTRY_*,
#     proxy, CA-bundle and loader variable, turn .env loading off, remove and re-make its empty
#     working directory (also its HOME), and refuse a .sentryclirc in any parent directory; or
#     SENTRY_PROPERTIES / SENTRY_CONFIG / SENTRY_DOTENV* / SENTRYCLI_* named anywhere;
#   - (P2-1) preflight does not require the build commit to be $GITHUB_SHA (main's head at
#     dispatch), or the android job does not assert its checkout is that commit before the build
#     and the Google sign-in;
#   - (W56) the release evidence check (scripts/mobile/verify-store-artifact.sh) does not run
#     exactly once in each of the android and ios jobs, on the signed artifact AFTER its signature
#     verification and BEFORE the Sentry upload, the Google sign-in and every store upload; its step
#     is conditional, does not fail the job on a failed check, or does not write the summary; the
#     android step does not take bundletool from scripts/mobile/install-bundletool.sh, or that script
#     does not refuse a jar whose SHA-256 is not its pinned one; the helper's pinned expectations
#     (package, targetSdk 36, minSdk 26, 16 KB, AD_ID, Xcode 26, iOS 26 SDK, background modes audio
#     and voip) or its failing exit status change; or continue-on-error appears in the workflow.
#
# Python 3 (standard library only), run isolated. If python3 is missing this FAILS, never passes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" > /dev/null 2>&1; then
  echo "check-store-upload-guards: $PYTHON not found -- the check cannot run, so it FAILS"
  exit 2
fi
case "${1:-}" in
  check | selftest) : ;;
  *) echo "usage: $0 check|selftest"; exit 2 ;;
esac

exec "$PYTHON" -I - "$1" << 'PY'
import os
import re
import subprocess
import sys

WORKFLOW = '.github/workflows/release-store-builds.yml'
MOBILE = 'scripts/mobile'
PLAY = 'scripts/mobile/play-upload.sh'
ID_TOKEN_JOB = 'android'

# Store channels and actions that must never appear. Case-insensitive.
WORDS = [
    ('production', r'\bproduction'),
    ('beta', r'\bbeta\b'),
    ('alpha', r'\balpha\b'),
    ('rollout', r'\brollout'),
    ('completed', r'\bcompleted\b'),
    # altool is checked by check_ios_upload (only its pinned upload and help lines); notarization
    # is never a store-upload step.
    ('notarize', r'notari[sz]|notarytool'),
    ('iTMSTransporter', r'itmstransporter'),
    ('submit', r'\bsubmit'),
    ('appStoreVersionSubmissions', r'appstoreversionsubmissions'),
    ('reviewSubmissions', r'reviewsubmissions'),
    ('releaseType', r'releasetype'),
    ('upload-artifact', r'upload-artifact'),
]
# Staged-release words, banned in the Play upload script on top of the above.
PLAY_WORDS = [
    ('inProgress', r'inprogress'),
    ('halted', r'\bhalted\b'),
    ('userFraction', r'userfraction'),
]

# The only places a word above may appear. (path, word, line regex or None for the whole file.)
ALLOW = [
    # The Sentry environment name and the APNs entitlement check: not store channels.
    (WORKFLOW, 'production', r"^\s*SENTRY_ENVIRONMENT: \$\{\{ vars\.SENTRY_ENVIRONMENT \|\| 'production' \}\}\s*$"),
    (WORKFLOW, 'production', r'^\s*\[ "\$\(get "\$B/entitlements\.plist" aps-environment\)" = production \] && rec PASS "aps-environment production" \|\| rec FAIL "aps-environment is not production"\s*$'),
    # Xcode selection skips pre-release Xcode installs.
    (WORKFLOW, 'beta', r'^\s*x="\$\(ls -d /Applications/Xcode_26\*\.app 2>/dev/null \| grep -vi beta \| sort -V \| tail -1\)"\s*$'),
    # R1: finding Apple's Transporter, the last fallback after altool's two upload modes. It is
    # invoked as "$T" on one line, checked by check_ios_upload.
    (WORKFLOW, 'iTMSTransporter', r'^\s*T="\$\(xcrun --find iTMSTransporter 2>/dev/null \|\| true\)"\s*$'),
    (WORKFLOW, 'iTMSTransporter', r'^\s*TA=/Applications/Transporter\.app/Contents/itms/bin/iTMSTransporter\s*$'),
    # P2-1: play-upload.sh accepts a track answer whose other releases are finished ones only. This
    # one line, exactly, may name that status.
    (PLAY, 'completed', r'^  and all\(\.releases\[\]\?; \.status == \$status or \.status == "completed"\)\' "\$W/track\.json" > /dev/null 2>&1 \\$'),
    # The build script refuses non-production API hosts and names the Sentry environment; it
    # never talks to a store (no Play API, checked below).
    ('scripts/mobile/build-store.sh', 'production', None),
]

PLAY_TRACK_ANSWER = [
    ('exactly one draft release of exactly [versionCode]',
     r'^  and \(\[\.releases\[\]\? \| select\(\.status == \$status and codes == \[\$code\]\)\] \| length\) == 1$'),
    ('no other release carrying the versionCode',
     r'^  and \(\[\.releases\[\]\? \| select\(codes \| any\(\.\[\]; \. == \$code\)\)\] \| length\) == 1$'),
    ('every release a draft or a finished one',
     r'^  and all\(\.releases\[\]\?; \.status == \$status or \.status == "completed"\)\' "\$W/track\.json" > /dev/null 2>&1 \\$'),
    ('the versionCodes of a release, as strings',
     r'^  def codes: \(\.versionCodes // \[\]\) \| map\(tostring\);$'),
]
PLAY_CONSTANTS = {
    'PACKAGE_NAME': 'com.jawwid.jawwid_chat',
    'TRACK': 'internal',
    'RELEASE_STATUS': 'draft',
}


def read_files():
    files = {}
    paths = [WORKFLOW]
    for d, dirs, names in os.walk(MOBILE):
        dirs.sort()
        for n in sorted(names):
            paths.append(os.path.join(d, n))
    for p in paths:
        try:
            with open(p, 'rb') as f:
                data = f.read()
        except OSError:
            continue
        if b'\0' in data:
            continue
        files[p] = data.decode('utf-8', 'replace')
    return files


def top_level(text):
    """[(key, inline value, [body lines])] for each top-level YAML key."""
    out = []
    for line in text.split('\n'):
        if line and not line[0].isspace() and not line.startswith('#'):
            m = re.match(r'^["\']?([A-Za-z_][A-Za-z0-9_-]*)["\']?\s*:(.*)$', line)
            if m:
                out.append([m.group(1), m.group(2).split(' #')[0].strip(), []])
                continue
            out.append(['<unparsed>', line, []])
            continue
        if out:
            out[-1][2].append(line)
    return out


def child_keys(body):
    lines = [l for l in body if l.strip() and not l.strip().startswith('#')]
    if not lines:
        return [], []
    indent = len(lines[0]) - len(lines[0].lstrip())
    keys, other = [], []
    for l in lines:
        if len(l) - len(l.lstrip()) != indent:
            continue
        m = re.match(r'^\s*["\']?([A-Za-z0-9_-]+)["\']?\s*:(.*)$', l)
        if m and not l.lstrip().startswith('-'):
            keys.append((m.group(1), m.group(2).split(' #')[0].strip()))
        else:
            other.append(l.strip())
    return keys, other


def check_workflow(text, errors):
    tops = top_level(text)
    names = [t[0] for t in tops]
    # Triggers: `on` (YAML 1.1 may read it as `true`), exactly workflow_dispatch.
    ons = [t for t in tops if t[0] in ('on', 'true')]
    if len(ons) != 1:
        errors.append(f'{WORKFLOW}: expected exactly one top-level `on:`, found {len(ons)}')
    for _, inline, body in ons:
        if inline:
            if inline != 'workflow_dispatch':
                errors.append(f'{WORKFLOW}: trigger must be workflow_dispatch only, found `on: {inline}`')
            elif any(l.strip() and not l.strip().startswith('#') for l in body):
                errors.append(f'{WORKFLOW}: unexpected lines under `on: workflow_dispatch`')
        else:
            keys, other = child_keys(body)
            if [k for k, _ in keys] != ['workflow_dispatch'] or other:
                found = [k for k, _ in keys] + other
                errors.append(f'{WORKFLOW}: trigger must be workflow_dispatch only, found {found}')
    if '<unparsed>' in names:
        errors.append(f'{WORKFLOW}: a top-level line could not be read as a key')

    # Workflow default permissions: exactly contents: read.
    perms = [t for t in tops if t[0] == 'permissions']
    if len(perms) != 1:
        errors.append(f'{WORKFLOW}: expected exactly one top-level permissions block')
    for _, inline, body in perms:
        keys, other = child_keys(body)
        if inline or keys != [('contents', 'read')] or other:
            errors.append(f'{WORKFLOW}: the workflow default permissions must be exactly `contents: read`')
    if re.search(r'write-all', text):
        errors.append(f'{WORKFLOW}: write-all permissions')

    # id-token: write only in the android job.
    jobs = [t for t in tops if t[0] == 'jobs']
    for t in tops:
        if t[0] != 'jobs' and any(re.search(r'id-token', l) for l in t[2] + [t[1]]):
            errors.append(f'{WORKFLOW}: id-token outside a job (top-level `{t[0]}`)')
    if len(jobs) != 1:
        errors.append(f'{WORKFLOW}: expected exactly one jobs block')
    for _, _, body in jobs:
        current = None
        for l in body:
            m = re.match(r'^  ([A-Za-z0-9_-]+)\s*:\s*(#.*)?$', l)
            if m:
                current = m.group(1)
                continue
            if re.search(r'id-token\s*:', l) and not l.strip().startswith('#'):
                if current != ID_TOKEN_JOB or not re.search(r'id-token\s*:\s*write\s*(#.*)?$', l):
                    errors.append(f'{WORKFLOW}: id-token in job `{current}`: only the {ID_TOKEN_JOB} job may have id-token: write')

    lines = text.split('\n')
    for n, l in enumerate(lines, 1):
        # Every action pinned to a full commit SHA.
        m = re.match(r'^\s*(-\s+)?uses\s*:\s*([^\s#]+)', l)
        if m and not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}', m.group(2).strip('"\'')):
            errors.append(f'{WORKFLOW}:{n}: action `{m.group(2)}` is not pinned to a full commit SHA')

    # No expression inside a run block.
    i = 0
    while i < len(lines):
        m = re.match(r'^(\s*)(-\s+)?run\s*:\s*(.*)$', lines[i])
        if not m:
            i += 1
            continue
        key_indent = len(m.group(1)) + len(m.group(2) or '')
        block = [(i + 1, m.group(3))]
        j = i + 1
        while j < len(lines) and (not lines[j].strip() or len(lines[j]) - len(lines[j].lstrip()) > key_indent):
            block.append((j + 1, lines[j]))
            j += 1
        for n, l in block:
            if '${{' in l:
                errors.append(f'{WORKFLOW}:{n}: an expression inside a run block; pass inputs and values through env')
        i = j


def check_play(text, errors):
    for name, value in PLAY_CONSTANTS.items():
        exact = re.findall(r"^readonly %s='%s'$" % (name, re.escape(value)), text, re.M)
        if len(exact) != 1:
            errors.append(f"{PLAY}: must declare exactly `readonly {name}='{value}'` once")
        if len(re.findall(r'\b%s=' % name, text)) != 1:
            errors.append(f'{PLAY}: {name} is assigned somewhere other than its readonly constant')
        if re.search(r'\b(read|mapfile|readarray|getopts)\b[^\n]*\b%s\b|printf\s+-v\s+%s\b|\$\{%s:?[-=+?]' % (name, name, name), text):
            errors.append(f'{PLAY}: {name} can be read in or defaulted, not only fixed')
    if not re.search(r'compgen -e', text) or not re.search(r'PLAY_\*\) overrides=', text) \
            or not re.search(r'for name in PACKAGE_NAME TRACK RELEASE_STATUS USER_FRACTION; do', text):
        errors.append(f'{PLAY}: the refusal of PLAY_* / PACKAGE_NAME / TRACK / RELEASE_STATUS overrides is missing')
    for m in re.finditer(r'tracks/(\S*)', text):
        if not re.match(r'\$TRACK\b|\$\{TRACK\}', m.group(1)):
            errors.append(f'{PLAY}: a tracks URL that does not use $TRACK')
    for m in re.finditer(r'\$(?:UPLOAD_)?API/(\S*)', text):
        if not m.group(1).startswith('$PACKAGE_NAME/'):
            errors.append(f'{PLAY}: a Play API URL that does not use $PACKAGE_NAME')
    # P2-1: the track answer is committed only if it holds our one draft, no other release carries
    # this versionCode, and every release is a draft or a finished one (none staged or paused).
    for what, rx in PLAY_TRACK_ANSWER:
        if len(re.findall(rx, text, re.M)) != 1:
            errors.append(f'{PLAY}: the track answer check must require {what}, on its one pinned line')
    for arg, const in (('status', 'RELEASE_STATUS'), ('track', 'TRACK')):
        for m in re.finditer(r'--arg %s (\S+)' % arg, text):
            if m.group(1) != '"$%s"' % const:
                errors.append(f'{PLAY}: the request {arg} is not bound to ${const}')


def code_lines(text):
    """[(line number, line)] without blank and comment lines."""
    return [(n, l) for n, l in enumerate(text.split('\n'), 1) if l.strip() and not l.strip().startswith('#')]


def job_bodies(text):
    """{job id: [(line number, line)]} for the jobs block (job ids at two spaces)."""
    jobs, current, inside = {}, None, False
    for n, l in enumerate(text.split('\n'), 1):
        if l and not l[0].isspace() and not l.startswith('#'):
            inside = bool(re.match(r'^jobs\s*:', l))
            current = None
            continue
        if not inside:
            continue
        m = re.match(r'^  ([A-Za-z0-9_-]+)\s*:\s*(#.*)?$', l)
        if m:
            current = m.group(1)
            jobs[current] = []
            continue
        if current:
            jobs[current].append((n, l))
    return jobs


def first(body, rx):
    for n, l in body:
        if not l.strip().startswith('#') and re.search(rx, l):
            return n
    return None


# R2: the run's own identity, asserted at runtime in preflight and in the android job (before the
# Google sign-in), the same values the Google provider's attribute condition pins.
REPO = 'MohamedEmadLasheen/jawwid-chat'
IDENTITY = [
    ('repository id', r'"\$GITHUB_REPOSITORY_ID" = 1362573850'),
    ('repository owner id', r'"\$GITHUB_REPOSITORY_OWNER_ID" = 183662661'),
    ('repository', r'"\$GITHUB_REPOSITORY" = MohamedEmadLasheen/jawwid-chat'),
    ('ref', r'"\$GITHUB_REF" = refs/heads/main'),
    ('workflow ref', r'"\$GITHUB_WORKFLOW_REF" = MohamedEmadLasheen/jawwid-chat/\.github/workflows/release-store-builds\.yml@refs/heads/main'),
]
AUTH_ACTION = r'^\s*(-\s+)?uses\s*:\s*google-github-actions/auth@'


def check_identity(text, errors):
    jobs = job_bodies(text)
    for job in ('preflight', 'android'):
        body = jobs.get(job, [])
        for what, rx in IDENTITY:
            if first(body, r'^\s*\[ %s \] \|\| \{ echo "::error::[^"]*"; exit 1; \}\s*$' % rx) is None:
                errors.append(f'{WORKFLOW}: the {job} job does not assert the {what} (R2)')
    for job in ('android', 'ios'):
        if first(jobs.get(job, []), r'^    environment: store-release\s*$') is None:
            errors.append(f'{WORKFLOW}: the {job} job is not in the store-release Environment')
    auth = [(job, n) for job, body in jobs.items() for n, l in body
            if not l.strip().startswith('#') and re.search(AUTH_ACTION, l)]
    if [job for job, _ in auth] != [ID_TOKEN_JOB]:
        errors.append(f'{WORKFLOW}: google-github-actions/auth must appear exactly once, in the {ID_TOKEN_JOB} job (found {auth})')
    elif auth:
        body = jobs.get(ID_TOKEN_JOB, [])
        checks = [first(body, r'^\s*\[ %s \] \|\|' % rx) for _, rx in IDENTITY]
        if any(c is None or c > auth[0][1] for c in checks):
            errors.append(f'{WORKFLOW}: the {ID_TOKEN_JOB} job signs in to Google before asserting its identity (R2)')


# P2-1: the build commit's code runs in the job that can request the Google token (the .aab cannot
# reach a separate upload job without a GitHub artifact or cache). So only the head of main at
# dispatch is built: preflight requires ref == GITHUB_SHA, and the android job asserts the checkout
# is that commit before the build and before the Google sign-in.
BUILD_IS_HEAD_PREFLIGHT = r'^\s*\[ "\$REF" = "\$GITHUB_SHA" \] \|\| \{ echo "::error::[^"]*"; exit 1; \}\s*$'
BUILD_IS_HEAD_ANDROID = r'^\s*\[ "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA" \] \|\| \{ echo "::error::[^"]*"; exit 1; \}\s*$'
ANDROID_BUILD = r'^\s*run: bash scripts/mobile/build-store\.sh android\s*$'


def check_build_commit(text, errors):
    jobs = job_bodies(text)
    pre = jobs.get('preflight', [])
    pre_check = first(pre, BUILD_IS_HEAD_PREFLIGHT)
    pre_out = first(pre, r'^\s*echo "sha=\$REF" >> "\$GITHUB_OUTPUT"\s*$')
    if pre_check is None or pre_out is None or pre_check > pre_out:
        errors.append(f'{WORKFLOW}: preflight must refuse a ref other than the head of main at dispatch '
                      f'([ "$REF" = "$GITHUB_SHA" ]) before it outputs the sha (P2-1)')
    body = jobs.get(ID_TOKEN_JOB, [])
    check = first(body, BUILD_IS_HEAD_ANDROID)
    build = first(body, ANDROID_BUILD)
    auth = first(body, AUTH_ACTION)
    if check is None or build is None or auth is None or check > build or check > auth:
        errors.append(f'{WORKFLOW}: the {ID_TOKEN_JOB} job must assert the checked-out commit is $GITHUB_SHA '
                      f'before the build and before the Google sign-in (P2-1)')


# W56: release evidence read from the signed artifacts (LR-50, LR-51, LR-52, LR-58, LR-73). In each
# job, the helper runs exactly once, after the signature verification and before anything leaves the
# runner (Sentry, the Google sign-in, every store upload); a failed check fails the job; the table
# goes to the step summary. The helper's expectations and the bundletool pin cannot drift.
HELPER = 'scripts/mobile/verify-store-artifact.sh'
BUNDLETOOL = 'scripts/mobile/install-bundletool.sh'
EVIDENCE_ANDROID = (r'^\s*out="\$\(bash release-tools/scripts/mobile/verify-store-artifact\.sh android "\$AAB" "\$BT" '
                    r'"\$BUILD_NAME" "\$BUILD_NUMBER"\)" \|\| rc=\$\?\s*$')
EVIDENCE_IOS = (r'^\s*out="\$\(bash release-tools/scripts/mobile/verify-store-artifact\.sh ios "\$\{apps\[0\]\}" '
                r'ios/Runner/PrivacyInfo\.xcprivacy\)" \|\| rc=\$\?\s*$')
EVIDENCE_FAIL = r'^\s*\[ "\$rc" -eq 0 \] \|\| \{ echo "::error::[^"]*"; exit 1; \}\s*$'
EVIDENCE_BT = r'^\s*BT="\$\(bash release-tools/scripts/mobile/install-bundletool\.sh "\$RUNNER_TEMP/bundletool"\)"\s*$'
PLAY_UPLOAD = r'^\s*bash release-tools/scripts/mobile/play-upload\.sh\b'
STEP_START = r'^      - '


def evidence_specs():
    """(job, the pinned helper call, what it must follow, what it must precede). A function, because
    the Sentry and upload line patterns are defined further down."""
    return [
        ('android', EVIDENCE_ANDROID, ('the App Bundle signature verification', r'^\s*jarsigner -verify '),
         [('the Sentry upload', SENTRY_CALL), ('the Google sign-in', AUTH_ACTION), ('the Play upload', PLAY_UPLOAD)]),
        ('ios', EVIDENCE_IOS, ('the .ipa verification', r'^\s*echo "VERIFIED_IPA_SHA256=\$sha" >> "\$GITHUB_ENV"\s*$'),
         [('the Sentry upload', SENTRY_CALL), ('the altool help', ALTOOL_HELP)] + UPLOADS),
    ]


HELPER_PINS = [
    ('the package', "readonly PACKAGE='com.jawwid.jawwid_chat'"),
    ('targetSdk 36 (LR-50)', "readonly TARGET_SDK='36'"),
    ('minSdk 26 (LR-50)', "readonly MIN_SDK='26'"),
    ('16 KB alignment (LR-51)', "readonly PAGE_BYTES='16384'"),
    ('the AD_ID permission', "readonly AD_ID='com.google.android.gms.permission.AD_ID'"),
    ('Xcode 26 (LR-52)', "readonly DTXCODE_MIN='2600'"),
    ('the iOS 26 SDK (LR-52)', "readonly SDK_RX='^iphoneos26(\\.[0-9]+)*$'"),
    ('background modes exactly audio and voip', "readonly BACKGROUND_MODES='audio voip'"),
    ('a failed check marks the run failed', '  [ "$1" = FAIL ] && bad=1'),
    ('the exit status of the checks', 'exit "$bad"'),
]
BUNDLETOOL_PINS = [
    ('a pinned SHA-256', r"^readonly BUNDLETOOL_SHA256='[0-9a-f]{64}'$"),
    ('the refusal of any other jar', r'^if \[ "\$got" != "\$BUNDLETOOL_SHA256" \]; then$'),
]


def step_of(body, n):
    """The (line number, line) pairs of the step of a job body that holds line n."""
    starts = [m for m, l in body if re.match(STEP_START, l)]
    s = max([m for m in starts if m <= n], default=None)
    if s is None:
        return []
    e = min([m for m in starts if m > n], default=10 ** 9)
    return [(m, l) for m, l in body if s <= m < e]


def check_evidence(files, errors):
    text = files.get(WORKFLOW, '')
    code = code_lines(text)
    jobs = job_bodies(text)
    if re.search(r'continue-on-error', text):
        errors.append(f'{WORKFLOW}: continue-on-error lets a failed check through (W56)')
    for job, call, (verified_what, verified_rx), later in evidence_specs():
        body = jobs.get(job, [])
        everywhere = [n for n, l in code if re.match(call, l)]
        at = first(body, call)
        if len(everywhere) != 1 or at is None:
            errors.append(f'{WORKFLOW}: the {job} job must run the release evidence check exactly once, on its '
                          f'pinned line (found lines {everywhere}) (W56)')
            continue
        v = first(body, verified_rx)
        if v is None or v > at:
            errors.append(f'{WORKFLOW}: the {job} release evidence must read the artifact after {verified_what} (W56)')
        for what, rx in later:
            n = first(body, rx)
            if n is None or n < at:
                errors.append(f'{WORKFLOW}: the {job} release evidence must run before {what} (W56)')
        step = [(n, l) for n, l in step_of(body, at) if l.strip() and not l.strip().startswith('#')]
        if any(re.match(r'^        (if|continue-on-error)\s*:', l) for _, l in step):
            errors.append(f'{WORKFLOW}: the {job} release evidence step must not be conditional (W56)')
        if not any(n < at and re.match(r'^\s*rc=0\s*$', l) for n, l in step):
            errors.append(f'{WORKFLOW}: the {job} release evidence step must start from rc=0 (W56)')
        fail = [n for n, l in step if n > at and re.match(EVIDENCE_FAIL, l)]
        if not fail:
            errors.append(f'{WORKFLOW}: a failed {job} release evidence check must fail the job (W56)')
        elif any(at < n < fail[0] and re.search(r'\brc=', l) for n, l in step):
            errors.append(f'{WORKFLOW}: the {job} release evidence result is overwritten before it is checked (W56)')
        if not any(n > at and re.search(r'>> "\$GITHUB_STEP_SUMMARY"', l) for n, l in step):
            errors.append(f'{WORKFLOW}: the {job} release evidence step must write its table to the step summary (W56)')
        if job == 'android' and not any(n < at and re.match(EVIDENCE_BT, l) for n, l in step):
            errors.append(f'{WORKFLOW}: the android release evidence must use the bundletool that '
                          f'{BUNDLETOOL} verified against its pin (W56)')
    helper = files.get(HELPER, '')
    lines = helper.split('\n')
    for what, literal in HELPER_PINS:
        if lines.count(literal) != 1:
            errors.append(f'{HELPER}: must pin {what}, exactly `{literal.strip()}` once (W56)')
        m = re.match(r'^readonly ([A-Z_0-9]+)=', literal)
        if m and len(re.findall(r'\b%s=' % m.group(1), helper)) != 1:
            errors.append(f'{HELPER}: {m.group(1)} is assigned somewhere other than its readonly constant (W56)')
    if len(re.findall(r'\bbad=0\b', helper)) != 1:
        errors.append(f'{HELPER}: the failure flag may be reset only where it starts (W56)')
    tool = files.get(BUNDLETOOL, '')
    for what, rx in BUNDLETOOL_PINS:
        if len(re.findall(rx, tool, re.M)) != 1:
            errors.append(f'{BUNDLETOOL}: must have {what}, on its pinned line (W56)')
    if len(re.findall(r'\bBUNDLETOOL_SHA256=', tool)) != 1:
        errors.append(f'{BUNDLETOOL}: BUNDLETOOL_SHA256 is assigned somewhere other than its readonly constant (W56)')


# R1: one export; the exact verified .ipa is what is uploaded, by altool in an upload mode
# (--upload-package, else --upload-app) or, failing both, by Transporter. Every altool, xcrun and
# "$T" line is pinned; each upload line is immediately preceded by the SHA-256 re-check.
TRANSPORTER_LINES = [
    r'^\s*T="\$\(xcrun --find iTMSTransporter 2>/dev/null \|\| true\)"\s*$',
    r'^\s*\[ -n "\$T" \] \|\| \[ ! -x "\$TA" \] \|\| T="\$TA"\s*$',
    r'^\s*\[ -n "\$T" \] \|\| \{ echo "::error title=No uploader on this runner::[^"]*"; exit 1; \}\s*$',
]
UPLOAD_LOG = r' > "\$B/upload\.log" 2>&1 \|\| rc=\$\?\s*$'
TRANSPORTER_INVOKE = (r'^\s*"\$T" -m upload -assetFile "\$VERIFIED_IPA" -apiKey "\$ASC_API_KEY_ID" '
                      r'-apiIssuer "\$ASC_API_ISSUER_ID" -v informational' + UPLOAD_LOG)
ALTOOL_HELP = r'^\s*AH="\$\(xcrun altool --help 2>&1 \|\| true\)"\s*$'
ALTOOL_PACKAGE = (r'^\s*xcrun altool --upload-package "\$VERIFIED_IPA" --type ios --apple-id "\$ASC_APP_APPLE_ID" '
                  r'--bundle-id "\$VERIFIED_BUNDLE_ID" --bundle-version "\$VERIFIED_BUILD" '
                  r'--bundle-short-version-string "\$VERIFIED_VERSION" --apiKey "\$ASC_API_KEY_ID" '
                  r'--apiIssuer "\$ASC_API_ISSUER_ID"' + UPLOAD_LOG)
ALTOOL_PACKAGE_PLAIN = (r'^\s*xcrun altool --upload-package "\$VERIFIED_IPA" --type ios --apiKey "\$ASC_API_KEY_ID" '
                        r'--apiIssuer "\$ASC_API_ISSUER_ID"' + UPLOAD_LOG)
ALTOOL_APP = (r'^\s*xcrun altool --upload-app -f "\$VERIFIED_IPA" -t ios --apiKey "\$ASC_API_KEY_ID" '
              r'--apiIssuer "\$ASC_API_ISSUER_ID"' + UPLOAD_LOG)
UPLOADS = [('altool --upload-package (with --apple-id and the bundle flags)', ALTOOL_PACKAGE),
           ('altool --upload-package', ALTOOL_PACKAGE_PLAIN), ('altool --upload-app', ALTOOL_APP),
           ('Transporter', TRANSPORTER_INVOKE)]
ALTOOL_LINES = [ALTOOL_HELP, ALTOOL_PACKAGE, ALTOOL_PACKAGE_PLAIN, ALTOOL_APP]
XCRUN_LINES = ALTOOL_LINES + [TRANSPORTER_LINES[0]]
# Success is exit status 0 AND the uploader's own success line: "No errors uploading" for both
# altool modes (UNVERIFIED wording, docs/release/signed-builds-ci.md), "uploaded successfully" for
# Transporter.
OK_ALTOOL = r"^\s*OK='No errors uploading\|UPLOAD SUCCEEDED'\s*$"
OK_TRANSPORTER = r"^\s*OK='uploaded successfully'\s*$"
UPLOAD_SUCCESS = r'^\s*if \[ "\$rc" -ne 0 \] \|\| ! grep -qE "\$OK" "\$B/upload\.log" \\\s*$'
SHA_RECHECK = (r'^\s*\[ "\$\(shasum -a 256 "\$VERIFIED_IPA" \| awk \'\{print \$1\}\'\)" = "\$VERIFIED_IPA_SHA256" \] '
               r'\|\| \{ echo "::error::[^"]*"; exit 1; \}\s*$')
STEP_NAME = r'^\s*(-\s+)?name\s*:'


def check_ios_upload(text, errors):
    code = code_lines(text)
    for n, l in code:
        if re.match(STEP_NAME, l):
            continue
        if re.search(r'\baltool\b', l, re.I) and not any(re.match(rx, l) for rx in ALTOOL_LINES):
            errors.append(f'{WORKFLOW}:{n}: altool used other than on its pinned lines (help, --upload-package or '
                          f'--upload-app of "$VERIFIED_IPA"): no other mode (R1)')
        if re.search(r'\bxcrun\b', l) and not any(re.match(rx, l) for rx in XCRUN_LINES):
            errors.append(f'{WORKFLOW}:{n}: xcrun used other than on its pinned lines (R1)')
    for what, rx in [('altool help', ALTOOL_HELP)] + UPLOADS:
        found = [n for n, l in code if re.match(rx, l)]
        if len(found) != 1:
            errors.append(f'{WORKFLOW}: expected exactly one {what} line, found lines {found} (R1)')
    ios_code = [(n, l) for n, l in job_bodies(text).get('ios', []) if l.strip() and not l.strip().startswith('#')]
    upload_lines = []
    for i, (n, l) in enumerate(ios_code):
        for what, rx in UPLOADS:
            if re.match(rx, l):
                upload_lines.append(n)
                if i == 0 or not re.match(SHA_RECHECK, ios_code[i - 1][1]):
                    errors.append(f'{WORKFLOW}:{n}: the {what} upload is not immediately preceded by the SHA-256 '
                                  f're-check of the verified .ipa (R1)')
    if len(upload_lines) != len(UPLOADS):
        errors.append(f'{WORKFLOW}: the uploads of the verified .ipa must all be in the ios job (R1)')
    oks = [n for n, l in code if re.match(r'^\s*OK=', l)]
    if len([n for n, l in code if re.match(OK_ALTOOL, l)]) != 2 \
            or len([n for n, l in code if re.match(OK_TRANSPORTER, l)]) != 1 or len(oks) != 3:
        errors.append(f'{WORKFLOW}: each altool upload must expect "No errors uploading|UPLOAD SUCCEEDED" and Transporter '
                      f'"uploaded successfully", and nothing else (R1)')
    success = [n for n, l in ios_code if re.match(UPLOAD_SUCCESS, l)]
    if len(success) != 1 or not upload_lines or success[0] < max(upload_lines):
        errors.append(f'{WORKFLOW}: the upload must fail unless the uploader exits 0 AND prints its success line (R1)')
    exports = [n for n, l in code if '-exportArchive' in l]
    if len(exports) != 1:
        errors.append(f'{WORKFLOW}: expected exactly one -exportArchive (the verified local export), found lines {exports} (R1)')
    if re.search(r'<string>\s*upload\s*</string>', text):
        errors.append(f'{WORKFLOW}: an export with destination upload re-signs the app; upload the verified .ipa instead (R1)')
    if len(re.findall(r'<key>destination</key><string>export</string>', text)) != 1:
        errors.append(f'{WORKFLOW}: the one export must be destination export (R1)')
    syms = re.findall(r'<key>uploadSymbols</key>\s*(<[a-z]+/>)', text)
    if syms != ['<false/>'] or len(re.findall(r'uploadSymbols', text)) != 1:
        errors.append(f'{WORKFLOW}: uploadSymbols must be exactly once and false: symbols go only to Sentry (R3)')
    for n, l in code:
        if not re.search(r'\$T\b|itmstransporter', l, re.I):
            continue
        for m in re.finditer(r'(?:^|\s)-m\s*(\S+)', l):
            if m.group(1) != 'upload':
                errors.append(f'{WORKFLOW}:{n}: Transporter mode `-m {m.group(1)}`: only `-m upload` is allowed (R1)')
    for n, l in code:
        if re.search(r'\$T\b', l) and not re.match(TRANSPORTER_INVOKE, l) \
                and not any(re.match(rx, l) for rx in TRANSPORTER_LINES):
            errors.append(f'{WORKFLOW}:{n}: Transporter used other than to upload "$VERIFIED_IPA" once (R1)')
    ios = job_bodies(text).get('ios', [])
    if first(ios, r'^\s*echo "VERIFIED_IPA_SHA256=\$sha" >> "\$GITHUB_ENV"\s*$') is None:
        errors.append(f'{WORKFLOW}: the verification step must record VERIFIED_IPA_SHA256 (R1)')
    made_ro = first(ios, r'^\s*chmod a-w "\$IPA"\s*$')
    still_ro = first(ios, r'^\s*\[ ! -w "\$VERIFIED_IPA" \] \|\| \{ echo "::error::[^"]*"; exit 1; \}\s*$')
    if made_ro is None or still_ro is None or not upload_lines or still_ro > min(upload_lines):
        errors.append(f'{WORKFLOW}: the verified .ipa must be made read-only and checked still read-only before the upload (R1)')
    always = first(ios, r'^\s*if: always\(\)\s*$')
    if always is None or not any(n > always and re.search(r'rm -f .*\.appstoreconnect/private_keys/', l) for n, l in ios):
        errors.append(f'{WORKFLOW}: the ios always-cleanup must delete the key copied for the uploader (R1)')


# R3: Sentry gets the token only through env, prints nothing it was given, and leaves nothing behind.
SENTRY_TOKEN_LINES = [
    r"^\s*SENTRY_AUTH_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}\s*$",
    r"^\s*HAS_SENTRY_TOKEN: \$\{\{ secrets\.SENTRY_AUTH_TOKEN != '' \}\}\s*$",
    r'^\s*(HAS_[A-Z_]+:[A-Z0-9_]+ )*HAS_SENTRY_TOKEN:SENTRY_AUTH_TOKEN; do\s*$',
]
# P2-2: nothing an earlier step planted (a .sentryclirc in a parent directory, a reused output
# directory, SENTRY_* / proxy / CA / loader variables added through GITHUB_ENV, a .env file) is
# read by sentry-cli. Each pinned line is in every Sentry step, before its first upload.
SENTRY_SCRUB_TEXT = ('for v in $(compgen -e); do case "$v" in SENTRY_AUTH_TOKEN | SENTRY_ORG | SENTRY_PROJECT | '
                     'SENTRY_URL | SENTRY_LOG_LEVEL | SENTRY_NO_PROGRESS_BAR) : ;; SENTRY* | *_proxy | *_PROXY | '
                     'SSL_CERT_* | CURL_CA_BUNDLE | LD_* | DYLD_*) unset "$v" ;; esac; done')
SENTRY_SCRUB = r'^\s*' + re.escape(SENTRY_SCRUB_TEXT) + r'\s*$'
SENTRY_TOKEN_LINES.append(SENTRY_SCRUB)
SENTRY_NO_DOTENV = r'^\s*export SENTRY_LOAD_DOTENV=0\s*$'
SENTRY_FRESH_DIR = r'^\s*' + re.escape('O="$RUNNER_TEMP/sentry-out"; rm -rf "$O"; mkdir -m 700 "$O"; cd "$O"') + r'\s*$'
SENTRY_RC_CHECK = (r'^\s*' + re.escape('d="$O"; while [ "$d" != / ]; do d="$(dirname "$d")"; '
                                       '[ ! -e "$d/.sentryclirc" ] || { echo "::error::')
                   + r'[^"]*' + re.escape('"; exit 1; }; done') + r'\s*$')
SENTRY_ISOLATION = [
    ('unset every planted SENTRY_*, proxy, CA-bundle and loader variable', SENTRY_SCRUB),
    ('turn .env loading off', SENTRY_NO_DOTENV),
    ('run in a freshly made, empty directory (removed and re-made, never reused)', SENTRY_FRESH_DIR),
    ('refuse a .sentryclirc in any parent directory', SENTRY_RC_CHECK),
]
SENTRY_BANNED = [
    ('an auth-token flag (the token goes through SENTRY_AUTH_TOKEN only)', r'auth-token'),
    ('a debug or trace log level', r'(log-level|log_level|SENTRY_LOG_LEVEL)\W{1,3}(debug|trace)'),
    ('shell tracing', r'\bset\s+-[a-z]*x|\bxtrace\b|\bbash\s+-[a-z]*x\b'),
    ('a source upload', r'include-sources|sourcemaps|source-bundle|bundle-sources|bundle-jvm'),
    ('a sentry-cli config file or config print', r'sentryclirc|sentry-cli\W+(info|login|config)\b'),
    ('a sentry-cli properties, config or dotenv setting (P2-2)', r'SENTRY_PROPERTIES|SENTRY_CONFIG|SENTRY_DOTENV|SENTRYCLI_'),
    ('.env loading not off (P2-2)', r'SENTRY_LOAD_DOTENV(?!=0\s*$)'),
]
SENTRY_HELPER = r'^\s*if HOME="\$O" "\$RUNNER_TEMP/sentry-cli/sentry-cli" "\$@" > "\$O/sentry\.log" 2>&1; then\s*$'
# The install step refuses unless the pinned installer put sentry-cli at that fixed path (its directory
# must be empty, and the binary must match its pinned SHA-256). The path is never passed through a
# variable: release run 43024454072 lost SENTRY_CLI to the P2-2 scrub, and a variable an earlier step
# could set through GITHUB_ENV is exactly what the scrub exists to refuse.
SENTRY_INSTALL_CHECK = (r'^\s*' + re.escape('[ "$p" = "$RUNNER_TEMP/sentry-cli/sentry-cli" ] || { echo "::error::')
                        + r'[^"]*' + re.escape('"; exit 1; }') + r'\s*$')
SENTRY_CALL = r'^\s*sq "[^"$]+" (debug-files upload|upload-proguard) "[^"]+"\s*$'


def check_sentry(files, errors):
    for path, text in files.items():
        if path != WORKFLOW and not path.startswith(MOBILE + '/'):
            continue
        for n, l in code_lines(text):
            # The one pinned line that looks for a planted .sentryclirc names the file to refuse it.
            if path == WORKFLOW and re.match(SENTRY_RC_CHECK, l):
                continue
            for what, rx in SENTRY_BANNED:
                if re.search(rx, l, re.I):
                    errors.append(f'{path}:{n}: {what} (R3)')
            if 'SENTRY_AUTH_TOKEN' in l and not (path == WORKFLOW and any(re.match(rx, l) for rx in SENTRY_TOKEN_LINES)):
                errors.append(f'{path}:{n}: SENTRY_AUTH_TOKEN used outside a step env line: sentry-cli reads it from the environment (R3)')
    # Run the scrub itself: it must keep every variable the Sentry step reads after it and unset any
    # other SENTRY_* variable, SENTRY_CLI included (release run 43024454072 failed under set -u
    # because the step still read a SENTRY_CLI the scrub had unset).
    kept = ('SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_URL')
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'SENTRY_PLANTED': 'x', 'SENTRY_CLI': 'x'}
    env.update({k: 'x' for k in kept})
    probe = ' '.join(f'"${{{k}-UNSET}}"' for k in kept + ('SENTRY_PLANTED', 'SENTRY_CLI'))
    run = subprocess.run(['bash', '-euc', SENTRY_SCRUB_TEXT + '; printf "%s\\n" ' + probe],
                         env=env, capture_output=True, text=True)
    if run.returncode != 0 or run.stdout.split() != ['x'] * len(kept) + ['UNSET', 'UNSET']:
        errors.append(f'the Sentry variable scrub must keep {", ".join(kept)} and unset any other SENTRY_* '
                      f'variable, SENTRY_CLI included (got {run.stdout.split()!r}) (P2-2)')
    text = files.get(WORKFLOW, '')
    code = code_lines(text)
    for n, l in code:
        if re.search(r'\bSENTRY_CLI\b', l):
            errors.append(f'{WORKFLOW}:{n}: the sentry-cli path read from a variable; sq calls the fixed path (R3)')
        if 'sentry-cli/sentry-cli' in l and not (re.match(SENTRY_HELPER, l) or re.match(SENTRY_INSTALL_CHECK, l)):
            errors.append(f'{WORKFLOW}:{n}: sentry-cli called without capturing its output; use the sq helper (R3)')
        if re.search(r'(^|[\s;&|(])sentry-cli\s', l) and not re.match(r'^\s*(-\s+)?name\s*:', l):
            errors.append(f'{WORKFLOW}:{n}: sentry-cli called by name; use the verified binary through sq (R3)')
        if re.match(r'^\s*sq\s', l) and not re.match(SENTRY_CALL, l):
            errors.append(f'{WORKFLOW}:{n}: sq may only run `debug-files upload` or `upload-proguard` on one path (R3)')
        if 'SENTRY_LOG_LEVEL' in l and not re.match(r'^\s*SENTRY_LOG_LEVEL: warn\s*$', l) \
                and not re.match(SENTRY_SCRUB, l):
            errors.append(f'{WORKFLOW}:{n}: SENTRY_LOG_LEVEL must be warn (R3)')
    for job, body in job_bodies(text).items():
        tokens = [n for n, l in body if re.match(SENTRY_TOKEN_LINES[0], l)]
        if not tokens:
            continue
        levels = [n for n, l in body if re.match(r'^\s*SENTRY_LOG_LEVEL: warn\s*$', l)]
        if len(levels) != len(tokens):
            errors.append(f'{WORKFLOW}: every Sentry step in the {job} job must set SENTRY_LOG_LEVEL: warn (R3)')
        calls = [n for n, l in body if re.match(SENTRY_CALL, l)]
        checks = [n for n, l in body if re.match(SENTRY_INSTALL_CHECK, l)]
        if len(checks) != len(tokens) or (calls and (not checks or checks[0] > calls[0])):
            errors.append(f'{WORKFLOW}: every Sentry step in the {job} job must follow an install step that '
                          f'refuses unless sentry-cli is at its fixed path (R3)')
        for what, rx in SENTRY_ISOLATION:
            at = [n for n, l in body if re.match(rx, l)]
            if len(at) != len(tokens) or (calls and (not at or at[0] > calls[0])):
                errors.append(f'{WORKFLOW}: every Sentry step in the {job} job must {what}, before its first '
                              f'upload (P2-2)')
        always = first(body, r'^\s*if: always\(\)\s*$')
        cleanup = [l for n, l in body if always is not None and n > always]
        for what, rx in (('build/symbols', r'rm -rf .*\bbuild/symbols\b'), ('$RUNNER_TEMP/sentry-out', r'rm -rf .*"\$RUNNER_TEMP/sentry-out"')):
            if not any(re.search(rx, l) for l in cleanup):
                errors.append(f'{WORKFLOW}: the {job} always-cleanup does not delete {what} (R3)')


def check_words(files, errors):
    for path, text in files.items():
        words = WORDS + (PLAY_WORDS if path == PLAY else [])
        for n, line in enumerate(text.split('\n'), 1):
            for word, rx in words:
                if not re.search(rx, line, re.I):
                    continue
                allowed = any(p == path and w == word and (lr is None or re.match(lr, line))
                              for p, w, lr in ALLOW)
                if not allowed:
                    errors.append(f'{path}:{n}: `{word}` must not appear here (store channel or action)')
            if path.startswith(MOBILE + '/') and re.search(r'\baltool\b|\bxcrun\b', line, re.I):
                errors.append(f'{path}:{n}: altool and xcrun belong only on the workflow\'s pinned upload lines (R1)')
            if path != PLAY and path.startswith(MOBILE + '/') and re.search(r'androidpublisher', line, re.I):
                errors.append(f'{path}:{n}: only {PLAY} may talk to the Play Developer API')
            if re.search(r'api\.appstoreconnect\.apple\.com', line, re.I):
                errors.append(f'{path}:{n}: no direct App Store Connect API call')


def check(files):
    errors = []
    if WORKFLOW not in files:
        errors.append(f'{WORKFLOW} not found')
    else:
        check_workflow(files[WORKFLOW], errors)
        check_identity(files[WORKFLOW], errors)
        check_build_commit(files[WORKFLOW], errors)
        check_ios_upload(files[WORKFLOW], errors)
    check_evidence(files, errors)
    check_sentry(files, errors)
    if PLAY not in files:
        errors.append(f'{PLAY} not found')
    else:
        check_play(files[PLAY], errors)
    check_words(files, errors)
    return errors


def replaced(text, old, new):
    if old not in text:
        raise SystemExit(f'selftest: the mutation anchor is gone, update the selftest: {old!r}')
    return text.replace(old, new, 1)


def after(text, marker, old, new):
    """Replace the first `old` after `marker` (e.g. inside one job)."""
    i = text.find(marker)
    j = text.find(old, i) if i >= 0 else -1
    if j < 0:
        raise SystemExit(f'selftest: the mutation anchor is gone, update the selftest: {marker!r} / {old!r}')
    return text[:j] + new + text[j + len(old):]


ANDROID = '\n  android:\n'
ANDROID_REPO_ID_LINE = ('          [ "$GITHUB_REPOSITORY_ID" = 1362573850 ] || { echo "::error::repository id $GITHUB_REPOSITORY_ID '
                        'is not 1362573850 (MohamedEmadLasheen/jawwid-chat)."; exit 1; }\n')
IDENTITY_MUTATIONS = [
    ('repository id', '[ "$GITHUB_REPOSITORY_ID" = 1362573850 ]', '[ "$GITHUB_REPOSITORY_ID" = 1 ]'),
    ('repository owner id', '[ "$GITHUB_REPOSITORY_OWNER_ID" = 183662661 ]', '[ "$GITHUB_REPOSITORY_OWNER_ID" = 1 ]'),
    ('repository', '[ "$GITHUB_REPOSITORY" = MohamedEmadLasheen/jawwid-chat ]', '[ "$GITHUB_REPOSITORY" = someone/fork ]'),
    ('ref', '[ "$GITHUB_REF" = refs/heads/main ]', '[ -n "$GITHUB_REF" ]'),
    ('workflow ref', '.github/workflows/release-store-builds.yml@refs/heads/main ]', '.github/workflows/release-store-builds.yml@refs/heads/other ]'),
]
SYM_CALL = '          sq "Dart symbols" debug-files upload "$SYM"\n'
SHA_LINE = '[ "$(shasum -a 256 "$VERIFIED_IPA" | awk \'{print $1}\')" = "$VERIFIED_IPA_SHA256" ]'
# The evidence step (W56) re-checks the same hash before it unpacks the .ipa, earlier in the file;
# the re-check removed must be the one right before an upload, so it is found after this step name.
ASC_UPLOAD_STEP = '      - name: Upload the verified .ipa itself to App Store Connect'
AH_LINE = '          AH="$(xcrun altool --help 2>&1 || true)"\n'
ALTOOL_APP_START = '            xcrun altool --upload-app'
ALTOOL_PLAIN_START = '              xcrun altool --upload-package "$VERIFIED_IPA" --type ios --apiKey'
ALTOOL_PACKAGE_START = '              xcrun altool --upload-package "$VERIFIED_IPA" --type ios --apple-id'
BUILD_HEAD_LINE = ('          [ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ] || { echo "::error::the checked-out build commit '
                   'is not this workflow\'s own commit; nothing was built."; exit 1; }\n')
AUTH_STEP = '      - uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0\n'


def mutations_r123():
    W = WORKFLOW
    m = [
        # R1
        ('a second export', W, lambda t: replaced(t, AH_LINE, '          xcodebuild -exportArchive -archivePath "$B/Runner.xcarchive" -exportPath "$B/upload"\n' + AH_LINE)),
        ('an export with destination upload', W, lambda t: replaced(t, '<key>destination</key><string>export</string>', '<key>destination</key><string>upload</string>')),
        ('symbols uploaded to Apple', W, lambda t: replaced(t, '<key>uploadSymbols</key><false/>', '<key>uploadSymbols</key><true/>')),
        ('another Transporter mode', W, lambda t: replaced(t, '"$T" -m upload', '"$T" -m lookupMetadata')),
        ('a second Transporter call', W, lambda t: replaced(t, '            "$T" -m upload -assetFile', '            "$T" -m upload -assetFile "$VERIFIED_IPA"\n            "$T" -m upload -assetFile')),
        ('a Transporter upload of another file', W, lambda t: replaced(t, '-assetFile "$VERIFIED_IPA"', '-assetFile "$B/export/Runner.ipa"')),
        ('the SHA-256 re-check removed', W, lambda t: after(t, ASC_UPLOAD_STEP, SHA_LINE, '[ -n "$VERIFIED_IPA_SHA256" ]')),
        ('the SHA-256 re-check not right before an upload', W, lambda t: replaced(t, ALTOOL_APP_START, '            cp "$B/export/other.ipa" "$VERIFIED_IPA" || true\n' + ALTOOL_APP_START)),
        ('the SHA-256 not recorded', W, lambda t: replaced(t, 'echo "VERIFIED_IPA_SHA256=$sha"', 'echo "VERIFIED_IPA_SHA=$sha"')),
        ('the .ipa not made read-only', W, lambda t: replaced(t, '          chmod a-w "$IPA"\n', '')),
        ('the read-only check before the upload removed', W, lambda t: replaced(t, '[ ! -w "$VERIFIED_IPA" ] ||', '[ -f "$VERIFIED_IPA" ] ||')),
        ('the uploader key left behind', W, lambda t: replaced(t, '|| rm -f "$HOME/.appstoreconnect/private_keys/', '|| echo "$HOME/.appstoreconnect/keys/')),
        # R1, altool: upload modes of the verified .ipa only.
        ('altool --validate-app', W, lambda t: replaced(t, AH_LINE, AH_LINE + '          xcrun altool --validate-app -f "$VERIFIED_IPA" --type ios --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_ISSUER_ID"\n')),
        ('altool --notarize-app', W, lambda t: replaced(t, AH_LINE, AH_LINE + '          xcrun altool --notarize-app -f "$VERIFIED_IPA" --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_ISSUER_ID"\n')),
        ('altool --list-apps', W, lambda t: replaced(t, AH_LINE, AH_LINE + '          xcrun altool --list-apps --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_ISSUER_ID" > "$B/apps.txt" 2>&1 || true\n')),
        ('altool found through a variable', W, lambda t: replaced(t, AH_LINE, AH_LINE + '          A="$(xcrun --find altool)"\n')),
        ('another tool through xcrun', W, lambda t: replaced(t, AH_LINE, AH_LINE + '          xcrun stapler validate "$VERIFIED_IPA" || true\n')),
        ('a second altool upload', W, lambda t: replaced(t, AH_LINE, AH_LINE + '          ' + SHA_LINE + ' || { echo "::error::x"; exit 1; }\n          xcrun altool --upload-app -f "$VERIFIED_IPA" -t ios --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_ISSUER_ID" > "$B/upload.log" 2>&1 || rc=$?\n')),
        # The anchors below start at "xcrun altool": the step's comment block names the same flags
        # (`altool --upload-package "$VERIFIED_IPA" --type ios --apiKey`, `altool --upload-app -f
        # "$VERIFIED_IPA"`), and an anchor that matched there first mutated only a comment.
        ('altool --upload-package of another file', W, lambda t: replaced(t, ALTOOL_PACKAGE_START, ALTOOL_PACKAGE_START.replace('"$VERIFIED_IPA"', '"$B/export/Runner.ipa"'))),
        ('plain altool --upload-package of another file', W, lambda t: replaced(t, ALTOOL_PLAIN_START, ALTOOL_PLAIN_START.replace('"$VERIFIED_IPA"', '"$B/export/Runner.ipa"'))),
        ('plain altool --upload-package with an extra flag', W, lambda t: replaced(t, ALTOOL_PLAIN_START, ALTOOL_PLAIN_START.replace('--type ios --apiKey', '--type ios --validate --apiKey'))),
        ('plain altool --upload-package removed', W, lambda t: replaced(t, ALTOOL_PLAIN_START, '              : plain-upload-gone "$VERIFIED_IPA" --type ios')),
        ('the SHA-256 re-check not right before the plain --upload-package', W, lambda t: replaced(t, ALTOOL_PLAIN_START, '              cp "$B/export/other.ipa" "$VERIFIED_IPA" || true\n' + ALTOOL_PLAIN_START)),
        ('altool --upload-app with notarization', W, lambda t: replaced(t, '-f "$VERIFIED_IPA" -t ios --apiKey', '-f "$VERIFIED_IPA" -t ios --notarize --apiKey')),
        ('altool --upload-app of another file', W, lambda t: replaced(t, ALTOOL_APP_START + ' -f "$VERIFIED_IPA"', ALTOOL_APP_START + ' -f "$B/check/Runner.ipa"')),
        ('altool --upload-package with a bundle id not read from the .ipa', W, lambda t: replaced(t, '--bundle-id "$VERIFIED_BUNDLE_ID"', '--bundle-id "$BUNDLE_ID"')),
        ('altool --upload-package removed', W, lambda t: replaced(t, '            xcrun altool --upload-package', '            : altool-free')),
        ('altool success wording not required', W, lambda t: replaced(t, "OK='No errors uploading|UPLOAD SUCCEEDED'", "OK=''")),
        ('the success line not checked', W, lambda t: replaced(t, '! grep -qE "$OK" "$B/upload.log"', '! true')),
        ('the upload exit status not checked', W, lambda t: replaced(t, 'if [ "$rc" -ne 0 ] || ! grep -qE', 'if ! grep -qE')),
        ('altool in a mobile script', 'scripts/mobile/zz-selftest.sh', lambda t: 'xcrun altool --upload-app -f x.ipa --type ios\n'),
        # R2
        ('a Google sign-in in the ios job', W, lambda t: replaced(t, '      - name: Select Xcode 26 explicitly\n', AUTH_STEP + '      - name: Select Xcode 26 explicitly\n')),
        ('a second Google sign-in in android', W, lambda t: replaced(t, '      - name: Upload the App Bundle to Play internal testing as a draft release\n', AUTH_STEP + '      - name: Upload the App Bundle to Play internal testing as a draft release\n')),
        ('android identity checked after the Google sign-in', W, lambda t: replaced(
            after(t, ANDROID, ANDROID_REPO_ID_LINE, ''),
            '          echo "::add-mask::$PLAY_ACCESS_TOKEN"\n', '          echo "::add-mask::$PLAY_ACCESS_TOKEN"\n' + ANDROID_REPO_ID_LINE)),
        ('android outside store-release', W, lambda t: after(t, ANDROID, '    environment: store-release\n', '    environment: other\n')),
        ('ios outside store-release', W, lambda t: after(t, '\n  ios:\n', '    environment: store-release\n', '')),
        # R3
        ('the Sentry token on a command line', W, lambda t: replaced(t, SYM_CALL, '          sq "Dart symbols" debug-files upload --auth-token "$SENTRY_AUTH_TOKEN" "$SYM"\n')),
        ('the Sentry token echoed', W, lambda t: replaced(t, '          O="$RUNNER_TEMP/sentry-out"', '          echo "$SENTRY_AUTH_TOKEN" | wc -c\n          O="$RUNNER_TEMP/sentry-out"')),
        ('a debug Sentry log level', W, lambda t: replaced(t, '          SENTRY_LOG_LEVEL: warn\n', '          SENTRY_LOG_LEVEL: debug\n')),
        ('a Sentry step without its log level', W, lambda t: replaced(t, '          SENTRY_LOG_LEVEL: warn\n', '')),
        ('a log level set after the scrub loop on its line', W,
         lambda t: replaced(t, SENTRY_SCRUB_TEXT, SENTRY_SCRUB_TEXT + '; export SENTRY_LOG_LEVEL="$L"')),
        # The review's bypass of a prefix-only exemption: a SECOND line that starts like the scrub loop.
        ('a second scrub-like line that sets a log level', W,
         lambda t: replaced(t, SENTRY_SCRUB_TEXT, SENTRY_SCRUB_TEXT
                            + '\n          for v in $(compgen -e); do case "$v" in X) : ;; esac; done; '
                            + 'export SENTRY_LOG_LEVEL=$(echo debug)')),
        ('--log-level trace', W, lambda t: replaced(t, SYM_CALL, '          sq "Dart symbols" debug-files upload --log-level=trace "$SYM"\n')),
        ('sentry-cli info', W, lambda t: replaced(t, SYM_CALL, '          sq "config" info\n' + SYM_CALL)),
        ('sentry-cli output printed', W, lambda t: replaced(t, SYM_CALL, '          "$RUNNER_TEMP/sentry-cli/sentry-cli" debug-files upload "$SYM"\n')),
        ('sentry-cli called by name', W, lambda t: replaced(t, SYM_CALL, '          sentry-cli debug-files upload "$SYM"\n')),
        ('a source upload', W, lambda t: replaced(t, SYM_CALL, '          sq "Dart symbols" debug-files upload --include-sources "$SYM"\n')),
        ('shell tracing', W, lambda t: replaced(t, '          O="$RUNNER_TEMP/sentry-out"', '          set -x\n          O="$RUNNER_TEMP/sentry-out"')),
        ('a sentry-cli config file', W, lambda t: replaced(t, '          O="$RUNNER_TEMP/sentry-out"', '          touch .sentryclirc\n          O="$RUNNER_TEMP/sentry-out"')),
        ('android symbols not cleaned up', W, lambda t: replaced(t, '          rm -rf "$RUNNER_TEMP/sentry-out" build/symbols build/app/outputs\n', '          rm -rf build/app/outputs\n')),
        ('ios Sentry output not cleaned up', W, lambda t: replaced(t, '          rm -rf "$RUNNER_TEMP/sentry-out" build/symbols\n', '          rm -rf build/symbols\n')),
        ('the Sentry token in a mobile script', 'scripts/mobile/zz-selftest.sh', lambda t: 'curl -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" https://sentry.io/\n'),
        # P2-2: sentry-cli reads nothing an earlier step planted.
        ('the Sentry output directory reused (mkdir -p)', W, lambda t: replaced(t, 'rm -rf "$O"; mkdir -m 700 "$O"; cd "$O"', 'mkdir -p "$O"; cd "$O"')),
        ('the Sentry working directory in the checkout', W, lambda t: replaced(t, 'O="$RUNNER_TEMP/sentry-out"; rm -rf', 'O="$GITHUB_WORKSPACE"; rm -rf')),
        ('planted SENTRY_* variables kept', W, lambda t: replaced(t, ') : ;; SENTRY* | *_proxy', ') : ;; *_proxy')),
        ('another SENTRY_* variable allowed through', W, lambda t: replaced(t, 'SENTRY_NO_PROGRESS_BAR) : ;;', 'SENTRY_NO_PROGRESS_BAR | SENTRY_PROPERTIES) : ;;')),
        ('the variable scrub removed', W, lambda t: replaced(t, '          ' + SENTRY_SCRUB_TEXT + '\n', '')),
        ('the variable scrub after the first upload', W, lambda t: replaced(replaced(t, '          ' + SENTRY_SCRUB_TEXT + '\n', ''), SYM_CALL, SYM_CALL + '          ' + SENTRY_SCRUB_TEXT + '\n')),
        ('.env loading left on', W, lambda t: replaced(t, 'export SENTRY_LOAD_DOTENV=0', 'export SENTRY_LOAD_DOTENV=1')),
        ('.env loading not turned off', W, lambda t: replaced(t, '          export SENTRY_LOAD_DOTENV=0\n', '')),
        ('a properties file for sentry-cli', W, lambda t: replaced(t, '          O="$RUNNER_TEMP/sentry-out"', '          export SENTRY_PROPERTIES="$GITHUB_WORKSPACE/sentry.properties"\n          O="$RUNNER_TEMP/sentry-out"')),
        ('the parent .sentryclirc check removed', W, lambda t: replaced(t, '[ ! -e "$d/.sentryclirc" ] ||', 'true ||')),
        ('HOME not the empty directory', W, lambda t: replaced(t, 'if HOME="$O" "$RUNNER_TEMP/sentry-cli/sentry-cli"', 'if "$RUNNER_TEMP/sentry-cli/sentry-cli"')),
        ('the sentry-cli path read from a variable', W, lambda t: replaced(t, 'if HOME="$O" "$RUNNER_TEMP/sentry-cli/sentry-cli"', 'if HOME="$O" "$SENTRY_CLI"')),
        ('the sentry-cli path handed over through GITHUB_ENV', W, lambda t: after_line(t, '          "$p" --version', '          echo "SENTRY_CLI=$p" >> "$GITHUB_ENV"\n')),
        ('the installed path not checked', W, lambda t: replaced(t, '[ "$p" = "$RUNNER_TEMP/sentry-cli/sentry-cli" ] ||', 'true ||')),
        ('SENTRY_CLI allowed through the scrub', W, lambda t: replaced(t, 'case "$v" in SENTRY_AUTH_TOKEN', 'case "$v" in SENTRY_CLI | SENTRY_AUTH_TOKEN')),
        # P2-1: only the head of main at dispatch is built in the job that can request the token.
        ('preflight accepts an older commit on main', W, lambda t: replaced(t, '[ "$REF" = "$GITHUB_SHA" ]', '[ -n "$GITHUB_SHA" ]')),
        ('android does not assert the build commit', W, lambda t: replaced(t, '[ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]', '[ -n "$GITHUB_SHA" ]')),
        ('android asserts the build commit after the build', W, lambda t: replaced(
            replaced(t, BUILD_HEAD_LINE, ''),
            '      - name: Verify the App Bundle is signed with the upload key\n',
            '      - name: late\n        run: |\n' + BUILD_HEAD_LINE + '      - name: Verify the App Bundle is signed with the upload key\n')),
    ]
    for what, old, new in IDENTITY_MUTATIONS:
        m.append((f'preflight without the {what} assertion', W, lambda t, o=old, n=new: replaced(t, o, n)))
        m.append((f'android without the {what} assertion', W, lambda t, o=old, n=new: after(t, ANDROID, o, n)))
    return m


def after_line(text, prefix, new):
    """Insert `new` after the whole line that starts with `prefix` (e.g. a step's name line)."""
    i = text.find(prefix)
    j = text.find('\n', i) if i >= 0 else -1
    if j < 0:
        raise SystemExit(f'selftest: the mutation anchor is gone, update the selftest: {prefix!r}')
    return text[:j + 1] + new + text[j + 1:]


EV_A = ('          out="$(bash release-tools/scripts/mobile/verify-store-artifact.sh android "$AAB" "$BT" '
        '"$BUILD_NAME" "$BUILD_NUMBER")" || rc=$?\n')
EV_I = ('          out="$(bash release-tools/scripts/mobile/verify-store-artifact.sh ios "${apps[0]}" '
        'ios/Runner/PrivacyInfo.xcprivacy)" || rc=$?\n')
FAIL_A = ('          [ "$rc" -eq 0 ] || { echo "::error::the signed App Bundle failed its release evidence checks; '
          'nothing was uploaded."; exit 1; }\n')
FAIL_I = ('          [ "$rc" -eq 0 ] || { echo "::error::the signed .ipa failed its release evidence checks; '
          'nothing was uploaded."; exit 1; }\n')
BT_A = '          BT="$(bash release-tools/scripts/mobile/install-bundletool.sh "$RUNNER_TEMP/bundletool")"\n'
EV_SUMMARY = '          { echo ""; printf \'%s\\n\' "$out"; } >> "$GITHUB_STEP_SUMMARY"\n'
NAME_A = '      - name: Release evidence from the signed App Bundle'
NAME_I = '      - name: Release evidence from the signed .ipa'
AAB_CHECK = '          AAB=build/app/outputs/bundle/release/app-release.aab\n          [ -f "$AAB" ]'
ASC_SUMMARY = '          echo "- App Store Connect: the verified .ipa'


def mutations_w56():
    W, H, T = WORKFLOW, HELPER, BUNDLETOOL
    return [
        ('android evidence check removed', W, lambda t: replaced(t, EV_A, '          out="$(echo skipped)" || rc=$?\n')),
        ('android evidence result ignored', W, lambda t: replaced(t, FAIL_A, '          true\n')),
        ('android evidence result overwritten', W, lambda t: replaced(t, EV_A, EV_A + '          rc=0\n')),
        ('a second android evidence call', W, lambda t: replaced(t, EV_A, EV_A + EV_A)),
        ('android evidence after the Google sign-in', W, lambda t: replaced(
            replaced(t, EV_A, ''), '          echo "::add-mask::$PLAY_ACCESS_TOKEN"\n',
            '          echo "::add-mask::$PLAY_ACCESS_TOKEN"\n' + EV_A)),
        ('android evidence before the signature check', W, lambda t: replaced(
            replaced(t, EV_A, ''), AAB_CHECK, AAB_CHECK.replace('\n', '\n' + EV_A, 1))),
        ('android evidence step skippable', W, lambda t: after_line(t, NAME_A, '        if: false\n')),
        ('android evidence step continue-on-error', W, lambda t: after_line(t, NAME_A, '        continue-on-error: true\n')),
        ('android evidence not in the summary', W, lambda t: replaced(t, EV_SUMMARY, '          : no summary\n')),
        ('bundletool not the pinned one', W, lambda t: replaced(t, BT_A, '          BT="$RUNNER_TEMP/bundletool.jar"\n')),
        ('ios evidence check removed', W, lambda t: replaced(t, EV_I, '          out="$(echo skipped)" || rc=$?\n')),
        ('ios evidence result ignored', W, lambda t: replaced(t, FAIL_I, '          true\n')),
        ('ios evidence after the upload', W, lambda t: replaced(replaced(t, EV_I, ''), ASC_SUMMARY, EV_I + ASC_SUMMARY)),
        ('ios evidence step skippable', W, lambda t: after_line(t, NAME_I, '        if: false\n')),
        ('ios evidence not in the summary', W, lambda t: after(t, '\n  ios:\n', EV_SUMMARY, '          : no summary\n')),
        ('continue-on-error on the .ipa verification', W, lambda t: after_line(
            t, '      - name: Verify the .ipa is App Store signed', '        continue-on-error: true\n')),
        ('targetSdk 35', H, lambda t: replaced(t, "readonly TARGET_SDK='36'", "readonly TARGET_SDK='35'")),
        ('minSdk 21', H, lambda t: replaced(t, "readonly MIN_SDK='26'", "readonly MIN_SDK='21'")),
        ('4 KB alignment', H, lambda t: replaced(t, "readonly PAGE_BYTES='16384'", "readonly PAGE_BYTES='4096'")),
        ('AD_ID looked up under another name', H, lambda t: replaced(t, "permission.AD_ID'", "permission.AD_ID_X'")),
        ('Xcode 16 accepted', H, lambda t: replaced(t, "readonly DTXCODE_MIN='2600'", "readonly DTXCODE_MIN='1600'")),
        ('any iOS SDK accepted', H, lambda t: replaced(t, "readonly SDK_RX='^iphoneos26(\\.[0-9]+)*$'", "readonly SDK_RX='^iphoneos'")),
        ('another background mode accepted', H, lambda t: replaced(t, "readonly BACKGROUND_MODES='audio voip'", "readonly BACKGROUND_MODES='audio fetch voip'")),
        ('a failed check that does not count', H, lambda t: replaced(t, '  [ "$1" = FAIL ] && bad=1', '  [ "$1" = FAIL ] && : bad=1')),
        ('the helper always exits 0', H, lambda t: replaced(t, '\nexit "$bad"', '\nexit 0')),
        ('the failure flag reset before the exit', H, lambda t: replaced(t, '\nexit "$bad"', '\nbad=0\nexit "$bad"')),
        ('a pinned expectation reassigned', H, lambda t: replaced(t, "readonly MAX_ENTRIES=", "TARGET_SDK=35\nreadonly MAX_ENTRIES=")),
        ('the helper emptied', H, lambda t: ''),
        ('bundletool SHA-256 not checked', T, lambda t: replaced(t, 'if [ "$got" != "$BUNDLETOOL_SHA256" ]; then', 'if false; then')),
        ('bundletool digest not pinned', T, lambda t: re.sub(r"readonly BUNDLETOOL_SHA256='[0-9a-f]{64}'",
                                                               'readonly BUNDLETOOL_SHA256="${BT_SHA:-}"', t, count=1)),
    ]


def mutations():
    W, P = WORKFLOW, PLAY
    m = mutations_r123() + mutations_w56() + [
        ('a push trigger', W, lambda t: replaced(t, '\non:\n  workflow_dispatch:\n', '\non:\n  push:\n  workflow_dispatch:\n')),
        ('a pull_request_target trigger', W, lambda t: replaced(t, '\non:\n  workflow_dispatch:\n', '\non:\n  workflow_dispatch:\n  pull_request_target:\n')),
        ('an inline trigger list', W, lambda t: replaced(t, '\non:\n  workflow_dispatch:\n', '\non: [workflow_dispatch, push]\nold_on:\n  workflow_dispatch:\n')),
        ('a quoted "on" with a schedule', W, lambda t: replaced(t, '\non:\n  workflow_dispatch:\n', '\n"on":\n  schedule:\n  workflow_dispatch:\n')),
        ('id-token in the ios job', W, lambda t: replaced(t, '\n  ios:\n', '\n  ios:\n    permissions:\n      id-token: write\n')),
        ('id-token in preflight', W, lambda t: replaced(t, '      actions: read\n', '      actions: read\n      id-token: write\n')),
        ('id-token in the workflow defaults', W, lambda t: replaced(t, '\npermissions:\n  contents: read\n', '\npermissions:\n  contents: read\n  id-token: write\n')),
        ('write-all defaults', W, lambda t: replaced(t, '\npermissions:\n  contents: read\n', '\npermissions: write-all\n')),
        ('another track constant', P, lambda t: replaced(t, "readonly TRACK='internal'", "readonly TRACK='qa'")),
        ('an overridable track', P, lambda t: replaced(t, "readonly TRACK='internal'", 'readonly TRACK="${PLAY_TRACK:-internal}"')),
        ('another status constant', P, lambda t: replaced(t, "readonly RELEASE_STATUS='draft'", "readonly RELEASE_STATUS='live'")),
        ('another package constant', P, lambda t: replaced(t, "readonly PACKAGE_NAME='com.jawwid.jawwid_chat'", "readonly PACKAGE_NAME='com.example.other'")),
        ('a second track assignment', P, lambda t: replaced(t, "readonly RELEASE_STATUS='draft'\n", "readonly RELEASE_STATUS='draft'\nTRACK=\"$4\"\n")),
        ('the track read from input', P, lambda t: replaced(t, "readonly RELEASE_STATUS='draft'\n", "readonly RELEASE_STATUS='draft'\nread -r TRACK < /dev/stdin\n")),
        ('a tracks URL without the constant', P, lambda t: replaced(t, 'tracks/$TRACK', 'tracks/qa')),
        ('a Play URL without the package constant', P, lambda t: replaced(t, '"$API/$PACKAGE_NAME/edits"', '"$API/$1/edits"')),
        ('a status not bound to the constant', P, lambda t: replaced(t, '--arg status "$RELEASE_STATUS"', '--arg status "${STATUS:-draft}"')),
        ('the override refusal removed', P, lambda t: replaced(t, 'PLAY_*) overrides=', 'PLAY_*) ignored=')),
        ('a staged-release fraction in the Play script', P, lambda t: t + '\n# userFraction 0.1\n'),
        ('the track answer check lets a staged release through', P, lambda t: replaced(t, 'or .status == "completed")', 'or .status == "completed" or .status == "inProgress")')),
        ('the track answer check accepts any status', P, lambda t: replaced(t, '  and all(.releases[]?; .status == $status or .status == "completed")', '  and true')),
        ('the track answer check lets another release carry the code', P, lambda t: replaced(t, '  and ([.releases[]? | select(codes | any(.[]; . == $code))] | length) == 1\n', '')),
        ('the track answer check without our one draft', P, lambda t: replaced(t, 'select(.status == $status and codes == [$code])] | length) == 1', 'select(.status == $status)] | length) >= 1')),
        ('an artifact upload step', W, lambda t: t + '      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n'),
        ('an unpinned action', W, lambda t: replaced(t, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683', 'actions/checkout@v4')),
        ('an action pinned to a short SHA', W, lambda t: replaced(t, 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683', 'actions/checkout@11bd719')),
        ('an input in a one-line run', W, lambda t: replaced(t, 'run: bash scripts/mobile/build-store.sh android', 'run: bash scripts/mobile/build-store.sh android ${{ inputs.build_name }}')),
        ('an input in a run block', W, lambda t: replaced(t, '          set -euo pipefail\n          [ "$GITHUB_REF"', '          set -euo pipefail\n          echo "${{ inputs.ref }}"\n          [ "$GITHUB_REF"')),
        ('a track named outside the allowed lines', W, lambda t: t + '          track: production\n'),
        ('a second word in the build script', 'scripts/mobile/build-store.sh', lambda t: t + '\n# beta\n'),
        ('the Play API from another mobile script', 'scripts/mobile/zz-selftest.sh', lambda t: 'curl https://androidpublisher.googleapis.com/x\n'),
        ('a direct App Store Connect API call', W, lambda t: t + '          # curl https://api.appstoreconnect.apple.com/v1/builds\n'),
    ]
    for word, _ in WORDS:
        m.append((f'`{word}` in the workflow', W, lambda t, w=word: t + f'          # {w}\n'))
        m.append((f'`{word}` in a mobile script', 'scripts/mobile/zz-selftest.sh', lambda t, w=word: f'echo {w}\n'))
    m.append(('`completed` as the Play status', P, lambda t: replaced(t, "readonly RELEASE_STATUS='draft'", "readonly RELEASE_STATUS='completed'")))
    return m


def main(mode):
    files = read_files()
    if mode == 'check':
        errors = check(files)
        for e in errors:
            print(f'::error::{e}')
        if errors:
            print(f'store upload guards: FAIL ({len(errors)})')
            return 1
        print('store upload guards: workflow_dispatch only; id-token only in android; Play upload fixed to '
              'com.jawwid.jawwid_chat / internal / draft; no other channel or action; no artifacts; actions pinned; '
              'no expression in a run block; iOS uploads the verified .ipa only, altool in upload modes only (R1); identity asserted, Google '
              'sign-in only in android (R2); Sentry token env-only, output captured, symbols cleaned up (R3); '
              'sentry-cli reads no planted settings (P2-2); only main\'s head at dispatch is built (P2-1); '
              'release evidence read from each signed artifact before anything leaves the runner (W56)')
        return 0
    base = check(files)
    if base:
        for e in base:
            print(f'selftest: the real files already fail: {e}')
        return 1
    bad = 0
    # A mutation must change what it claims to change. Unchanged text, or a change only to comment
    # lines (an anchor that matched a comment first), is a broken mutation and fails the selftest:
    # otherwise "caught" or "NOT caught" says nothing about the rule. Only these mutations add a
    # comment on purpose (the words and the App Store Connect API rules read comments too).
    comment_only = {'a direct App Store Connect API call', 'a staged-release fraction in the Play script',
                    'a second word in the build script'} | {f'`{w}` in the workflow' for w, _ in WORDS}
    for name, path, mutate in mutations():
        mutated = dict(files)
        original = files.get(path, '')
        mutated[path] = mutate(original)
        if mutated[path] == original:
            print(f'selftest: mutation changes nothing (fix its anchor): {name}')
            bad += 1
            continue
        if name not in comment_only and \
                [l for _, l in code_lines(mutated[path])] == [l for _, l in code_lines(original)]:
            print(f'selftest: mutation changes only comment lines (fix its anchor): {name}')
            bad += 1
            continue
        if not check(mutated):
            print(f'selftest: NOT caught: {name}')
            bad += 1
    if bad:
        print(f'store upload guards selftest: FAIL ({bad} mutation(s) broken or not caught)')
        return 1
    print(f'store upload guards selftest: every mutation caught ({len(mutations())})')
    return 0


sys.exit(main(sys.argv[1]))
PY
