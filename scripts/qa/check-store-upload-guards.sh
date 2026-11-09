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
#     anywhere, are not what its URLs and request body use, or its override refusal is gone;
#   - a store channel or action word appears in the workflow or scripts/mobile (production, beta,
#     alpha, rollout, completed, the old Apple upload tool, submit..., the App Store review and
#     release-type API names), outside the few lines listed in ALLOW below;
#   - a GitHub artifact upload appears;
#   - any action is not pinned to a full commit SHA;
#   - an expression (an input or anything else) is written inside a run block: inputs reach the
#     shell through env only;
#   - a script in scripts/mobile other than play-upload.sh talks to the Play Developer API, or
#     anything calls the App Store Connect API directly.
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
    ('altool', r'\baltool\b'),
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
    # The build script refuses non-production API hosts and names the Sentry environment; it
    # never talks to a store (no Play API, checked below).
    ('scripts/mobile/build-store.sh', 'production', None),
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
    for arg, const in (('status', 'RELEASE_STATUS'), ('track', 'TRACK')):
        for m in re.finditer(r'--arg %s (\S+)' % arg, text):
            if m.group(1) != '"$%s"' % const:
                errors.append(f'{PLAY}: the request {arg} is not bound to ${const}')


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


def mutations():
    W, P = WORKFLOW, PLAY
    m = [
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
              'no expression in a run block')
        return 0
    base = check(files)
    if base:
        for e in base:
            print(f'selftest: the real files already fail: {e}')
        return 1
    bad = 0
    for name, path, mutate in mutations():
        mutated = dict(files)
        mutated[path] = mutate(files.get(path, ''))
        if not check(mutated):
            print(f'selftest: NOT caught: {name}')
            bad += 1
    if bad:
        print(f'store upload guards selftest: FAIL ({bad} mutation(s) not caught)')
        return 1
    print(f'store upload guards selftest: every mutation caught ({len(mutations())})')
    return 0


sys.exit(main(sys.argv[1]))
PY
