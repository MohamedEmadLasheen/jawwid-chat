#!/usr/bin/env python3
"""Prove what families download from apps/lessons carries no unreviewed lesson text (PD-29).

    python3 -I scripts/lessons/check-family-bundle.py check            # after `npm run build` in apps/lessons (CI)
    python3 -I scripts/lessons/check-family-bundle.py golden --check   # the committed golden is current (guards)
    python3 -I scripts/lessons/check-family-bundle.py golden --write   # rewrite it after a lesson's status changes
    python3 -I scripts/lessons/check-family-bundle.py selftest

The family build releases every JSON import first (apps/lessons/src/content/release.ts,
the lessons-release plugin in vite.config.ts): an approved lesson ships byte for byte,
a pending one only as {"withheld":true}. The plugin records what it shipped in
apps/lessons/release-manifest.json, next to dist/. `check` FAILS when:
  * the manifest is missing, inside dist/, from a preview build, or lists a different
    set of files than the content files on disk that the allowlist (release.ts RULES,
    read from that file) names;
  * a file's status is not what its source says (approved / pending -> withheld), or
    its source SHA-256 is not the file on disk;
  * an APPROVED file's shipped SHA-256 differs from its source's (approved content
    ships unchanged), a withheld file's differs from the stub's, or an as-is file's
    from its source's (unless dropUnsignedMechanics left mechanics out);
  * the manifest differs from apps/lessons/release-manifest.golden.json;
  * any text file in dist/ (the verified Quran snapshot under data/quran/ aside)
    contains a string that exists only in withheld content -- its text, review
    notes, old spellings (`was`), provenance -- searched raw, \\uXXXX-escaped (either
    case) and after undoing one and two levels of JS string escaping (esbuild and
    Vite's JSON.parse("...") may escape). Strings that also occur in shipped
    content, in the engine's own source (the UI) or in the Quran are not evidence
    and are dropped first.
Standard library only; reads files.
"""
import hashlib
import json
import os
import re
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LESSONS = os.path.join(ROOT, 'apps', 'lessons')
GOLDEN = 'release-manifest.golden.json'
MANIFEST = 'release-manifest.json'
BS = chr(92)  # a backslash, spelled out so no tool or editor turns an escape in this file into a character
ARABIC_LETTER = re.compile('[' + chr(0x621) + '-' + chr(0x64A) + chr(0x671) + '-' + chr(0x6D3) + ']')
RULE = re.compile(r"\{\s*pattern:\s*/(.+?)/,\s*kind:\s*'([a-z]+)',\s*reviewed:\s*(true|false)\s*\}")
SKIP_DIRS = {'node_modules', 'dist', 'public', 'test-results', 'playwright-report', '.vite'}
UI_EXT = ('.ts', '.tsx', '.css', '.html')
MIN_ASCII = 8  # a shorter ASCII string (an id like ba-001) is not evidence: minified code holds such runs by chance


def sha256(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode('utf-8')).hexdigest()


def rules(base):
    """The allowlist, read from release.ts itself: one source of truth for the build and this check."""
    text = open(os.path.join(base, 'src', 'content', 'release.ts'), encoding='utf-8').read()
    block = re.search(r'export const RULES[^=]*=\s*\[(.*?)\n\];', text, re.S)
    found = [(re.compile(p.replace(BS + '/', '/')), kind, reviewed == 'true') for p, kind, reviewed in RULE.findall(block.group(1) if block else '')]
    if not found:
        raise SystemExit('check-family-bundle: no RULES found in src/content/release.ts')
    return found


def stub(source):
    """The exact bytes release.ts stubFor() ships for a pending lesson."""
    kind = source.get('kind')
    obj = {'withheld': True, 'kind': kind} if isinstance(kind, str) and re.fullmatch('[a-z]+', kind) else {'withheld': True}
    return json.dumps(obj, separators=(',', ':'))


def flagged(source):
    out = []

    def walk(x, at):
        if isinstance(x, list):
            for i, v in enumerate(x):
                walk(v, f'{at}[{i}]')
        elif isinstance(x, dict):
            for k, v in x.items():
                here = f'{at}.{k}' if at else k
                if k in ('review', 'was') and at and v is not None:
                    out.append(here)
                elif not (k == 'review' and not at):
                    walk(v, here)
    walk(source, '')
    return out


def content_files(base, allow):
    """Every JSON file under apps/lessons that the allowlist names, by relative path."""
    out = {}
    for dp, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.'))
        for f in sorted(files):
            if not f.endswith('.json'):
                continue
            rel = os.path.relpath(os.path.join(dp, f), base).replace(os.sep, '/')
            rule = next((r for r in allow if r[0].fullmatch(rel)), None)
            if rule:
                out[rel] = rule
    return out


def expected(base):
    """What the family build must ship of each content file, computed from the source alone."""
    errors, files = [], {}
    for rel, (_, kind, reviewed) in content_files(base, rules(base)).items():
        raw = open(os.path.join(base, rel), 'rb').read()
        entry = {'path': rel, 'kind': kind, 'sourceSha256': sha256(raw)}
        if not reviewed:
            files[rel] = {**entry, 'status': 'as-is', 'shippedSha256': entry['sourceSha256']}
            continue
        source = json.loads(raw.decode('utf-8'))
        status = (source.get('review') or {}).get('status') if isinstance(source.get('review'), dict) else None
        if source.get('schema') not in (None, 1):
            errors.append(f'{rel}: schema {source.get("schema")!r} has no release rule yet')
        elif status == 'approved':
            if flagged(source):
                errors.append(f'{rel}: approved while {len(flagged(source))} item(s) are still held')
            files[rel] = {**entry, 'status': 'approved', 'shippedSha256': entry['sourceSha256']}
        elif status == 'pending':
            files[rel] = {**entry, 'status': 'withheld', 'shippedSha256': sha256(stub(source))}
        else:
            errors.append(f'{rel}: review.status is {status!r}, neither pending nor approved')
    return files, errors


def golden_of(files):
    """The reviewed projection: each file's status, and what ships of a lesson (an approved file's own hash, or the stub's)."""
    out = {}
    for rel in sorted(files):
        f = files[rel]
        out[rel] = {'status': f['status'], **({'shippedSha256': f['shippedSha256']} if f['status'] in ('approved', 'withheld') else {})}
    return out


def golden_text(files):
    lines = ',\n'.join(f'    {json.dumps(rel)}: {json.dumps(v, sort_keys=True)}' for rel, v in golden_of(files).items())
    about = ('What the family lessons build ships of each content file (PD-29): approved = the file byte for byte, '
             'withheld = only the stub, as-is = carries no lesson text. Written by scripts/lessons/check-family-bundle.py '
             'golden --write; CI checks every build against it.')
    return '{\n  "about": ' + json.dumps(about) + ',\n  "files": {\n' + lines + '\n  }\n}\n'


# ----------------------------------------------------------------------- the bundle

def strings_of(x, out):
    if isinstance(x, str):
        out.add(x.strip())
    elif isinstance(x, list):
        for v in x:
            strings_of(v, out)
    elif isinstance(x, dict):
        for v in x.values():
            strings_of(v, out)
    return out


def evidence(withheld, shipped, ui, quran):
    """The strings that exist only in withheld content: what must never be found in dist/."""
    corpus = '\n'.join(sorted(strings_of(shipped, set())) + [ui, quran])
    out = set()
    for s in strings_of(withheld, set()):
        arabic = bool(ARABIC_LETTER.search(s))
        if len(s) < (2 if arabic else MIN_ASCII) or s in corpus:
            continue
        out.add(s)
    return sorted(out)


def unescape(text):
    """One level of JS string escaping undone, across the whole file (code and strings alike)."""
    def one(m):
        e = m.group(1)
        if e[0] == 'u' and e[1] == '{':
            return chr(int(e[2:-1], 16))
        if e[0] in 'ux':
            return chr(int(e[1:], 16))
        return {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'}.get(e, e)
    pattern = re.escape(BS) + r'(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])'
    out = re.sub(pattern, one, text)
    # Escaped surrogate pairs (astral characters) become one character again.
    return out.encode('utf-16', 'surrogatepass').decode('utf-16', 'replace')


def escaped(s, upper=False):
    """s with every non-ASCII character as a 4-hex escape (surrogate pairs above U+FFFF), as esbuild may write it."""
    out = []
    for ch in s:
        if ord(ch) < 128:
            out.append(ch)
            continue
        units = [ord(ch)] if ord(ch) < 0x10000 else [0xD800 + ((ord(ch) - 0x10000) >> 10), 0xDC00 + ((ord(ch) - 0x10000) & 0x3FF)]
        out.extend(BS + 'u' + (f'{u:04X}' if upper else f'{u:04x}') for u in units)
    return ''.join(out)


def scan(dist, strings):
    """Every (file, string, form) where withheld text is found in dist/."""
    hits = []
    for dp, dirs, files in os.walk(dist):
        rel_dir = os.path.relpath(dp, dist).replace(os.sep, '/')
        if rel_dir == 'data/quran' or rel_dir.startswith('data/quran/'):
            continue  # the verified Quran snapshot (build-quran-snapshot.py), copied from public/
        for f in sorted(files):
            p = os.path.join(dp, f)
            try:
                raw = open(p, 'rb').read().decode('utf-8')
            except UnicodeDecodeError:
                continue  # a font or an image
            once = unescape(raw)
            twice = unescape(once)
            rel = os.path.relpath(p, dist).replace(os.sep, '/')
            for s in strings:
                if s in raw:
                    hits.append((rel, s, 'raw'))
                elif any(e != s and e in raw for e in (escaped(s), escaped(s, True))):
                    hits.append((rel, s, 'escaped'))
                elif s in once or s in twice:
                    hits.append((rel, s, 'after unescaping'))
    return hits


def ui_text(base):
    """The engine's own source (tests aside): a string it holds is the UI's, not a lesson's."""
    parts = []
    for dp, dirs, files in os.walk(os.path.join(base, 'src')):
        for f in sorted(files):
            if f.endswith(UI_EXT) and '.test.' not in f and not dp.endswith(os.sep + 'test'):
                parts.append(open(os.path.join(dp, f), encoding='utf-8').read())
    index = os.path.join(base, 'index.html')
    if os.path.exists(index):
        parts.append(open(index, encoding='utf-8').read())
    return '\n'.join(parts)


def quran_text(base):
    folder = os.path.join(base, 'public', 'data', 'quran')
    if not os.path.isdir(folder):
        return None
    ayat = []
    for f in sorted(os.listdir(folder)):
        if re.fullmatch(r'surah-\d{3}\.json', f):
            ayat.extend(a['text'] for a in json.load(open(os.path.join(folder, f), encoding='utf-8'))['ayahs'])
    return '\n'.join(ayat)


# ----------------------------------------------------------------------- check

def check(base, quiet=False):
    errors = []
    want, errs = expected(base)
    errors += errs
    dist = os.path.join(base, 'dist')
    path = os.path.join(base, MANIFEST)
    if not os.path.isdir(dist):
        return errors + ['dist/ is missing: run after `npm run build`']
    for dp, _, files in os.walk(dist):
        if MANIFEST in files:
            errors.append(f'{os.path.relpath(os.path.join(dp, MANIFEST), base)}: the release manifest must never ship inside dist/')
    if not os.path.exists(path):
        return errors + [f'{MANIFEST} is missing: the lessons-release plugin did not run']
    manifest = json.load(open(path, encoding='utf-8'))
    if manifest.get('v') != 1 or manifest.get('mode') != 'family':
        return errors + [f'{MANIFEST}: v {manifest.get("v")!r}, mode {manifest.get("mode")!r}: not a family build']
    drop = manifest.get('dropUnsignedMechanics')
    if not isinstance(drop, bool):
        errors.append(f'{MANIFEST}: dropUnsignedMechanics must be true or false')
    got = {f.get('path'): f for f in manifest.get('files') or []}
    for rel in sorted(set(want) - set(got)):
        errors.append(f'{rel}: a content file on disk that the build did not release (not imported, or released under another name)')
    for rel in sorted(set(got) - set(want)):
        errors.append(f'{rel}: released by the build but not a content file the allowlist names on disk')
    dropped_strings = set()
    for rel in sorted(set(want) & set(got)):
        w, g = want[rel], got[rel]
        for key in ('kind', 'status', 'sourceSha256'):
            if g.get(key) != w[key]:
                errors.append(f'{rel}: {key} is {g.get(key)!r}, the source says {w[key]!r}')
        if g.get('status') == 'approved' and g.get('shippedSha256') != g.get('sourceSha256'):
            errors.append(f'{rel}: APPROVED but what shipped ({g.get("shippedSha256")}) is not the source ({g.get("sourceSha256")}): approved content ships unchanged')
        elif g.get('dropped') and w['kind'] == 'mechanics' and drop:
            source = json.load(open(os.path.join(base, rel), encoding='utf-8'))
            dropped_strings |= strings_of([m for m in source.get('mechanics', []) if m.get('id') in g['dropped']], set())
        elif g.get('shippedSha256') != w['shippedSha256']:
            errors.append(f'{rel}: shipped {g.get("shippedSha256")}, expected {w["shippedSha256"]} ({w["status"]})')
    golden_path = os.path.join(base, GOLDEN)
    committed = json.load(open(golden_path, encoding='utf-8')).get('files') if os.path.exists(golden_path) else None
    built = golden_of({rel: {**g, 'status': g.get('status'), 'shippedSha256': g.get('shippedSha256')} for rel, g in got.items()})
    if committed != built:
        diff = sorted(rel for rel in set(built) | set(committed or {}) if (committed or {}).get(rel) != built.get(rel))
        errors.append(f'{GOLDEN}: this build differs from the committed golden at {diff[:5]} (run golden --write and review the change)')

    quran = quran_text(base)
    if quran is None:
        return errors + ['public/data/quran/ is missing: build the snapshot first (scripts/lessons/build-quran-snapshot.py)']
    withheld = [json.load(open(os.path.join(base, rel), encoding='utf-8')) for rel, w in want.items() if w['status'] == 'withheld']
    withheld += [sorted(dropped_strings)]
    shipped = [json.load(open(os.path.join(base, rel), encoding='utf-8')) for rel, w in want.items() if w['status'] != 'withheld']
    strings = evidence(withheld, shipped, ui_text(base), quran)
    hits = scan(dist, strings)
    for rel, s, form in hits[:20]:
        errors.append(f'dist/{rel}: carries withheld lesson text ({form}): {s[:60]!r}')
    if len(hits) > 20:
        errors.append(f'... and {len(hits) - 20} more')
    if not errors and not quiet:
        counts = {s: sum(1 for w in want.values() if w['status'] == s) for s in ('approved', 'withheld', 'as-is')}
        print(f'family-bundle: {counts["approved"]} approved file(s) shipped byte for byte, {counts["withheld"]} withheld as the stub, '
              f'{counts["as-is"]} as-is; {len(strings)} withheld-only strings, none found in dist/ (raw, escaped or unescaped)')
    return errors


def golden(base, write, quiet=False):
    want, errors = expected(base)
    if errors:
        return errors
    text = golden_text(want)
    path = os.path.join(base, GOLDEN)
    if write:
        open(path, 'w', encoding='utf-8').write(text)
        print(f'family-bundle: wrote {GOLDEN} ({len(want)} files)')
        return []
    if not os.path.exists(path) or open(path, encoding='utf-8').read() != text:
        return [f'{GOLDEN} is not current: a lesson\'s status or approved content changed (run golden --write and review the change)']
    if not quiet:
        print(f'family-bundle: {GOLDEN} is current ({len(want)} files)')
    return []


# ----------------------------------------------------------------------- selftest

def selftest():
    A = lambda *cps: ''.join(chr(c) for c in cps)
    HELD = A(0x628, 0x64E, 0x64A, 0x652, 0x62A, 0x64C, 0x20, 0x62C, 0x64E, 0x62F, 0x650, 0x64A, 0x62F)  # held Arabic text
    NOTE = 'ADDED TASHKEEL on the final letter'
    OK_TEXT = A(0x642, 0x64E, 0x644, 0x64E, 0x645, 0x652)  # approved text
    UI = A(0x642, 0x64A, 0x62F, 0x20, 0x627, 0x644, 0x645, 0x631, 0x627, 0x62C, 0x639, 0x629)  # a UI string
    QURAN = A(0x62D, 0x64E, 0x645, 0x652, 0x62F)
    release_ts = ("export const RULES: readonly Rule[] = [\n"
                  "  { pattern: /^src" + BS + "/content" + BS + "/surah-" + BS + "d{3}" + BS + ".json$/, kind: 'surah', reviewed: true },\n"
                  "  { pattern: /^src" + BS + "/arabic" + BS + "/lesson-" + BS + "d{3}" + BS + ".json$/, kind: 'arabic', reviewed: true },\n"
                  "  { pattern: /^quran-pin" + BS + ".json$/, kind: 'pin', reviewed: false },\n];\n")

    def tree(d):
        def w(rel, text):
            os.makedirs(os.path.dirname(os.path.join(d, rel)) or d, exist_ok=True)
            open(os.path.join(d, rel), 'w', encoding='utf-8').write(text)
        w('src/content/release.ts', release_ts)
        w('src/App.tsx', f"export const t = '{UI}';\n")
        w('src/content/surah-085.json', json.dumps({'surah': 85, 'review': {'status': 'pending', 'by': None, 'note': 'Extracted from the old lesson'},
                                                    'provenance': {'from': 'old-lessons @ c231532 surah 85'},
                                                    'intro': {'text': HELD, 'review': NOTE}, 'quiz': [{'q': QURAN + ' ' + UI, 'review': None}]}, ensure_ascii=False))
        w('src/arabic/lesson-005.json', json.dumps({'lesson': 5, 'kind': 'reading', 'review': {'status': 'pending', 'by': None, 'note': 'x'},
                                                    'stages': [{'items': [{'text': OK_TEXT, 'was': None, 'review': None}]}]}, ensure_ascii=False))
        w('src/arabic/lesson-001.json', json.dumps({'lesson': 1, 'review': {'status': 'approved', 'by': 'Teachers department', 'note': 'x'},
                                                    'units': [{'words': [{'text': OK_TEXT, 'was': None, 'review': None}]}]}, ensure_ascii=False, indent=1))
        w('src/arabic/letters.fixture.json', json.dumps({'only': 'tests import this'}))
        w('quran-pin.json', '{"datasetId": "test-1"}\n')
        w('public/data/quran/surah-001.json', json.dumps({'ayahs': [{'text': QURAN}]}, ensure_ascii=False))
        files, errs = expected(d)
        assert not errs, errs
        w(GOLDEN, golden_text(files))
        manifest = {'v': 1, 'mode': 'family', 'dropUnsignedMechanics': False,
                    'files': [{k: f[k] for k in ('path', 'kind', 'status', 'sourceSha256', 'shippedSha256')} for f in files.values()]}
        w(MANIFEST, json.dumps(manifest, indent=2))
        w('dist/index.html', '<!doctype html><script type="module" src="/assets/index-abc.js"></script>')
        w('dist/assets/index-abc.js', 'const a={withheld:!0},b={withheld:!0,kind:"reading"};const ok=JSON.parse(' + json.dumps(json.dumps({'t': OK_TEXT}, ensure_ascii=False), ensure_ascii=False) + ');const ui="' + UI + '";')
        w('dist/data/quran/surah-001.json', json.dumps({'ayahs': [{'text': HELD}]}, ensure_ascii=False))  # skipped: the snapshot's folder
        return w

    def manifest_edit(change):
        def m(d, w):
            p = os.path.join(d, MANIFEST)
            x = json.load(open(p, encoding='utf-8'))
            change(x)
            w(MANIFEST, json.dumps(x))
        return m

    def entry(rel, **kv):
        def change(x):
            for f in x['files']:
                if f['path'] == rel:
                    f.update(kv)
        return manifest_edit(change)

    def plant(text):
        return lambda d, w: w('dist/assets/chunk-x.js', f'export const z={text};')

    js_double = json.dumps(json.dumps({'t': HELD}))  # JSON.parse("...") with ASCII escapes, as a JS literal
    cases = {
        'clean': (lambda d, w: None, None),
        'planted-raw': (plant(json.dumps(HELD, ensure_ascii=False)), "(raw)"),
        'planted-escaped': (plant('"' + escaped(HELD) + '"'), '(escaped)'),
        'planted-escaped-upper': (plant('"' + escaped(HELD, True) + '"'), '(escaped)'),
        'planted-double-escaped': (plant('JSON.parse(' + js_double + ')'), 'after unescaping'),
        'planted-note': (plant(json.dumps(NOTE)), 'ADDED TASHKEEL'),
        'planted-provenance': (plant(json.dumps('old-lessons @ c231532 surah 85')), 'c231532'),
        'planted-in-css': (lambda d, w: w('dist/assets/a.css', f'.x::after{{content:"{HELD}"}}'), "(raw)"),
        'ui-string-not-evidence': (plant(json.dumps(UI, ensure_ascii=False)), None),
        'quran-not-evidence': (plant(json.dumps(QURAN, ensure_ascii=False)), None),
        'approved-text-not-evidence': (plant(json.dumps(OK_TEXT, ensure_ascii=False)), None),
        'approved-shipped-changed': (entry('src/arabic/lesson-001.json', shippedSha256='0' * 64), 'APPROVED but what shipped'),
        'status-lie': (entry('src/content/surah-085.json', status='approved', shippedSha256=sha256('x'), sourceSha256=sha256('x')), 'status is'),
        'stub-hash-wrong': (entry('src/arabic/lesson-005.json', shippedSha256=sha256('{"withheld":true}')), 'shipped'),
        'source-hash-wrong': (entry('src/content/surah-085.json', sourceSha256='1' * 64), 'sourceSha256 is'),
        'file-not-released': (manifest_edit(lambda x: x.update(files=[f for f in x['files'] if f['path'] != 'src/arabic/lesson-005.json'])), 'did not release'),
        'unknown-released': (manifest_edit(lambda x: x['files'].append({'path': 'src/x.json', 'kind': 'surah', 'status': 'as-is', 'sourceSha256': 'a', 'shippedSha256': 'a'})), 'not a content file'),
        'preview-manifest': (manifest_edit(lambda x: x.update(mode='preview')), 'not a family build'),
        'no-manifest': (lambda d, w: os.remove(os.path.join(d, MANIFEST)), 'is missing'),
        'manifest-in-dist': (lambda d, w: w('dist/' + MANIFEST, '{}'), 'never ship inside dist/'),
        'golden-drift': (lambda d, w: w(GOLDEN, '{"files": {}}'), 'differs from the committed golden'),
        'approved-with-held-item': (lambda d, w: w('src/arabic/lesson-001.json', json.dumps({'lesson': 1, 'review': {'status': 'approved'},
                                                                                          'units': [{'words': [{'text': 'x', 'was': 'y', 'review': None}]}]})), 'still held'),
        'unknown-status': (lambda d, w: w('src/arabic/lesson-005.json', json.dumps({'review': {'status': 'draft'}})), 'neither pending nor approved'),
    }
    failed = []
    with tempfile.TemporaryDirectory() as scratch:
        for i, (name, (mutate, want)) in enumerate(cases.items()):
            d = os.path.join(scratch, f'case-{i}')
            os.makedirs(d)
            w = tree(d)
            mutate(d, w)
            errors = check(d, quiet=True)
            ok = (not errors) if want is None else any(want in e for e in errors)
            if not ok:
                failed.append(f'{name}: expected {want or "no errors"}, got {errors}')
        # golden --check sees a changed status; the stub bytes are release.ts's.
        d = os.path.join(scratch, 'golden')
        os.makedirs(d)
        w = tree(d)
        if golden(d, False, quiet=True):
            failed.append('golden: a fresh golden is reported stale')
        w('src/arabic/lesson-005.json', json.dumps({'lesson': 5, 'review': {'status': 'approved', 'by': 'T'}, 'stages': []}))
        if not any('not current' in e for e in golden(d, False, quiet=True)):
            failed.append('golden: an approval did not make the golden stale')
        if stub({'kind': 'reading', 'x': 1}) != '{"withheld":true,"kind":"reading"}' or stub({'kind': 'Bad'}) != '{"withheld":true}':
            failed.append('stub: not the bytes release.ts ships')
        if unescape(escaped(HELD)) != HELD or unescape(unescape(json.dumps(json.dumps(HELD))[1:-1])) != '"' + HELD + '"':
            failed.append('unescape: does not undo escaped()')
    for f in failed:
        print(f'family-bundle selftest: FAIL {f}')
    if not failed:
        print(f'family-bundle selftest: {len(cases) + 3} cases, each as expected')
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ['selftest']:
        return selftest()
    if argv[:1] == ['golden'] and argv[1:2] in (['--check'], ['--write']):
        errors = golden(LESSONS, argv[1] == '--write')
    elif argv[:1] == ['check']:
        errors = check(os.path.abspath(argv[1]) if len(argv) > 1 else LESSONS)
    else:
        print(__doc__)
        return 2
    for e in errors:
        print(f'family-bundle: {e}')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
