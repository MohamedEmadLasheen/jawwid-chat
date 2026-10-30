#!/usr/bin/env python3
"""The lessons engine's supply-chain guard (PD-29 materials quality P0-3).

    python3 -I scripts/qa/check-lessons-supply-chain.py [apps/lessons]
    python3 -I scripts/qa/check-lessons-supply-chain.py selftest
    python3 -I scripts/qa/check-lessons-supply-chain.py --release-age   # warn-only, needs the registry

The old lessons repo was infected through its build config (a postcss.config.js
loader, .vscode folderOpen tasks, a fake font holding a second payload). The
engine is written from scratch, and this keeps it that way. It FAILS when:
  * package.json: a dependency is not an exact version; it declares optional,
    peer or bundled dependencies; an `overrides` entry is not a plain exact
    version (no ranges, nesting, $references or npm: aliases); or any
    lifecycle-looking script (install hooks, prepack/postpack, and any
    pre*/post* script);
  * package-lock.json: an entry is not lockfileVersion 3, is a link, or is not
    resolved from EXACTLY https://registry.npmjs.org/<name>/-/<basename>-<version>.tgz
    with an sha512 integrity (so an entry cannot point react at another
    package's tarball), or has an install script not on INSTALL_SCRIPT_ALLOWLIST
    (CI installs with --ignore-scripts; the list makes a new one a review);
  * any file git lists under apps/lessons (tracked, or untracked and not
    ignored -- the same set CI checks out) lies under node_modules/, dist/ or
    .vite/ at any depth, is a .vscode folder, or is a postcss/tailwind config;
  * a text file carries one of the infected family's markers, or a CSS file
    reaches outside (@import, url("../"));
  * a file is binary and not on BINARY_ALLOWLIST (by path AND SHA-256);
  * a source file imports from outside apps/lessons (a relative path that climbs
    out, an absolute path, an undeclared package -- nothing resolves through a
    parent node_modules -- or a Node built-in outside the build configs);
  * vite/vitest config or tsconfig points outside apps/lessons (resolve.alias,
    "../" paths, tsconfig paths/baseUrl/rootDirs/extends);
  * the engine's accepted Basmala hashes differ from the API's.
Standard library only; reads files, runs nothing but `git ls-files`.
"""
import calendar
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INSTALL_SCRIPT_ALLOWLIST = {'esbuild', 'fsevents'}
# Binary files that may exist under apps/lessons, by path -> SHA-256. The Amiri Quran
# font, vendored on the owner's instruction (2026-10-29: the verses rendered in a system
# fallback): the same file Admin Web bundles, Amiri 1.003, OFL 1.1.
BINARY_ALLOWLIST: dict = {
    'src/fonts/AmiriQuran.ttf': 'e2a47644762d16bdfb6d33e0d8db8c6ff30beae84150ef5a705316bbd829455c',
}
FONT_FACE = re.compile(r'@font-face\s*\{[^}]*\}')
EXACT = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')
MARKERS = [
    (re.compile(r"global(?:This)?\[\s*['\"]!['\"]\s*\]"), "global['!'] (the loader's marker)"),
    (re.compile(r'\b_0x[0-9a-fA-F]{4,}\b'), 'an _0x... obfuscated identifier'),
    (re.compile(r'\bchild_process\b'), 'child_process'),
    (re.compile(r"""['"`]child['"`]\s*\+\s*['"`]_process"""), "a split 'child'+'_process'"),
    (re.compile(r'(?<![\w$])eval\s*\('), 'eval('),
    (re.compile(r'\.\s*eval\b'), 'a .eval reference'),
    (re.compile(r'\(\s*0\s*,\s*eval\s*\)'), '(0, eval)'),
    (re.compile(r'(?<![\w$.])Function\s*\('), 'Function('),
    (re.compile(r'\bnew\s+Function\b'), 'new Function'),
    (re.compile(r'\bimport\.meta\.glob\b'), 'import.meta.glob'),
    (re.compile(r'\bnew\s+URL\s*\([^)]*import\.meta\.url'), 'new URL(..., import.meta.url)'),
    (re.compile(r'\bfolderOpen\b'), 'a folderOpen task'),
]
CSS_MARKERS = [
    (re.compile(r'@import\b'), 'a CSS @import'),
    (re.compile(r"""url\(\s*['"]?\s*(?:\.\./|/|https?:|//)"""), 'a CSS url() outside the folder'),
]
FORBIDDEN_NAMES = re.compile(r'^(postcss\.config\.[cm]?[jt]s|\.postcssrc(\..*)?|tailwind\.config\.[cm]?[jt]s)$')
FORBIDDEN_DIRS = {'node_modules', 'dist', '.vite', '.vscode'}
CODE_EXT = ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs')
CONFIG_FILES = {'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'}
CONFIG_BUILTINS = {'node:fs', 'node:path', 'node:url'}
IMPORT = re.compile(r"""(?:\bimport\s+(?:[^'"]*?\sfrom\s+)?|\bexport\s+[^'"]*?\sfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]""")
HOOK = re.compile(r'^(pre|post).+|^(install|prepare|prepublish|prepack|postpack)$')
API_INTEGRITY = os.path.join(ROOT, 'apps', 'api', 'src', 'quran', 'quran-integrity.ts')
HEX64 = re.compile(r"'([0-9a-f]{64})'")


def git_files(base):
    """What CI checks out: tracked files plus untracked, not-ignored ones."""
    out = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', '.'],
                         cwd=base, capture_output=True, text=True, check=True).stdout
    return sorted({os.path.join(base, p) for p in out.splitlines() if p and os.path.exists(os.path.join(base, p))})


def package_root(spec):
    parts = spec.split('/')
    return '/'.join(parts[:2]) if spec.startswith('@') else parts[0]


def is_binary(data):
    if b'\x00' in data[:8192]:
        return True
    try:
        data.decode('utf-8')
        return False
    except UnicodeDecodeError:
        return True


def basmala_set(text):
    m = re.search(r'\bBASMALA_SHA256\b[^=\n]*=\s*new Set\(\[(.*?)\]\)', text, re.S)
    return set(HEX64.findall(m.group(1))) if m else set()


def check(base, paths=None, api_integrity=API_INTEGRITY):
    base = os.path.abspath(base)
    errors = []
    rel = lambda p: os.path.relpath(p, base)
    inside = lambda p: os.path.commonpath([os.path.abspath(p), base]) == base
    pkg_path = os.path.join(base, 'package.json')
    lock_path = os.path.join(base, 'package-lock.json')
    if not os.path.exists(pkg_path) or not os.path.exists(lock_path):
        return ['package.json and package-lock.json must both exist']

    pkg = json.load(open(pkg_path, encoding='utf-8'))
    declared = {}
    for field in ('dependencies', 'devDependencies'):
        for name, version in (pkg.get(field) or {}).items():
            declared[name] = field
            if not EXACT.match(str(version)):
                errors.append(f'package.json {field}.{name} = {version!r} is not an exact version')
    for field in ('optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies'):
        if pkg.get(field):
            errors.append(f'package.json must not declare {field}')
    # Overrides hold transitive packages back to releases past the cooldown
    # (rollup, postcss, @babel/*, the browserslist family): reviewed pins, so
    # each must be one plain exact version of the package it names.
    overrides = pkg.get('overrides') or {}
    if not isinstance(overrides, dict):
        errors.append('package.json overrides must be an object of exact versions')
        overrides = {}
    for name, version in overrides.items():
        if not isinstance(version, str) or not EXACT.match(version):
            errors.append(f'package.json overrides.{name} = {version!r} is not a plain exact version')
    for script in (pkg.get('scripts') or {}):
        if HOOK.match(script):
            errors.append(f'package.json must not define the lifecycle script {script!r}')

    lock = json.load(open(lock_path, encoding='utf-8'))
    if lock.get('lockfileVersion') != 3:
        errors.append('package-lock.json must be lockfileVersion 3')
    for path, entry in (lock.get('packages') or {}).items():
        if path == '':
            continue
        name = path.split('node_modules/')[-1]
        if entry.get('link'):
            errors.append(f'lock {path}: a linked package')
            continue
        expected = f'https://registry.npmjs.org/{name}/-/{name.split("/")[-1]}-{entry.get("version")}.tgz'
        if entry.get('resolved') != expected:
            errors.append(f'lock {path}: resolved from {entry.get("resolved") or "nowhere"}, not {expected}')
        if entry.get('name') not in (None, name):
            errors.append(f'lock {path}: installs {entry.get("name")!r} under the name {name!r}')
        if not str(entry.get('integrity', '')).startswith('sha512-'):
            errors.append(f'lock {path}: no sha512 integrity')
        if entry.get('hasInstallScript') and name not in INSTALL_SCRIPT_ALLOWLIST:
            errors.append(f'lock {path}: has an install script and is not on the allowlist')

    for p in (git_files(base) if paths is None else paths):
        name = os.path.basename(p)
        parts = rel(p).split(os.sep)
        bad_dir = FORBIDDEN_DIRS.intersection(parts[:-1])
        if bad_dir:
            errors.append(f'{rel(p)}: a file under {sorted(bad_dir)[0]}/ (never committed, never scanned around)')
            continue
        if FORBIDDEN_NAMES.match(name):
            errors.append(f'{rel(p)}: a {name} build-config file (the old repo\'s infection vector)')
        data = open(p, 'rb').read()
        if is_binary(data):
            want = BINARY_ALLOWLIST.get(rel(p).replace(os.sep, '/'))
            if want != hashlib.sha256(data).hexdigest():
                errors.append(f'{rel(p)}: a binary file not on the allowlist (by path and SHA-256)')
            continue
        if name == 'package-lock.json':
            continue
        text = data.decode('utf-8')
        for pattern, what in MARKERS:
            if pattern.search(text):
                errors.append(f'{rel(p)}: contains {what}')
        if name.endswith('.css'):
            for pattern, what in CSS_MARKERS:
                if pattern.search(text):
                    errors.append(f'{rel(p)}: contains {what}')
            # A verse is drawn in Amiri Quran and nothing else: named only through the token, never
            # with a fallback (a system font mis-shapes the Uthmani marks). The @font-face says it.
            for value in re.findall(r'font-family\s*:\s*([^;}]*)', FONT_FACE.sub('', text)):
                if 'amiri' in value.lower() and value.strip() != 'var(--quran-font)':
                    errors.append(f'{rel(p)}: font-family {value.strip()!r} names the Quran font directly; use var(--quran-font), with no fallback')
        if name.endswith(CODE_EXT):
            for spec in IMPORT.findall(text):
                if spec.startswith('.'):
                    if not inside(os.path.normpath(os.path.join(os.path.dirname(p), spec))):
                        errors.append(f'{rel(p)}: imports {spec!r}, outside apps/lessons')
                elif spec.startswith('/') or re.match(r'^[A-Za-z]:', spec) or spec.startswith('file:'):
                    errors.append(f'{rel(p)}: imports the absolute path {spec!r}')
                elif spec.startswith('node:') or spec in ('fs', 'path', 'url', 'os', 'child_process'):
                    if not (name in CONFIG_FILES and spec in CONFIG_BUILTINS):
                        errors.append(f'{rel(p)}: imports the Node built-in {spec!r}')
                elif package_root(spec) not in declared:
                    errors.append(f'{rel(p)}: imports {spec!r}, which package.json does not declare')
        if name in CONFIG_FILES:
            if re.search(r'\balias\s*:', text):
                errors.append(f'{rel(p)}: resolve.alias is refused (it can point outside apps/lessons)')
            if re.search(r"""['"`][^'"`]*\.\./""", text):
                errors.append(f'{rel(p)}: a "../" path points outside apps/lessons')
        if name.startswith('tsconfig') and name.endswith('.json'):
            opts = json.loads(text).get('compilerOptions', {})
            tsdir = os.path.dirname(p)
            for key in ('baseUrl', 'rootDir'):
                if key in opts and not inside(os.path.join(tsdir, opts[key])):
                    errors.append(f'{rel(p)}: compilerOptions.{key} points outside apps/lessons')
            for target in [t for ts in (opts.get('paths') or {}).values() for t in ts] + list(opts.get('rootDirs') or []):
                if not inside(os.path.join(tsdir, opts.get('baseUrl', '.'), target)):
                    errors.append(f'{rel(p)}: tsconfig path {target!r} points outside apps/lessons')
            ext = json.loads(text).get('extends')
            if ext and (not str(ext).startswith('.') or not inside(os.path.join(tsdir, ext))):
                errors.append(f'{rel(p)}: extends {ext!r}, outside apps/lessons')

    styles = os.path.join(base, 'src', 'styles.css')
    if os.path.exists(styles):
        css = open(styles, encoding='utf-8').read()
        faces = FONT_FACE.findall(css)
        if not any(re.search(r"font-family:\s*'Amiri Quran'", f) and "url('./fonts/AmiriQuran.ttf')" in f and 'font-display: block' in f for f in faces):
            errors.append("src/styles.css: must declare @font-face 'Amiri Quran' from url('./fonts/AmiriQuran.ttf') with font-display: block")
        if not re.search(r"--quran-font:\s*'Amiri Quran';", css):
            errors.append("src/styles.css: --quran-font must be 'Amiri Quran' (no fallback)")

    engine = os.path.join(base, 'src', 'quran', 'basmala.ts')
    if not os.path.exists(engine) or not os.path.exists(api_integrity):
        errors.append('src/quran/basmala.ts and apps/api/src/quran/quran-integrity.ts must both exist (the Basmala check)')
    else:
        mine, theirs = basmala_set(open(engine, encoding='utf-8').read()), basmala_set(open(api_integrity, encoding='utf-8').read())
        if not mine or mine != theirs:
            errors.append('src/quran/basmala.ts: BASMALA_SHA256 differs from apps/api/src/quran/quran-integrity.ts')
    return errors


def release_age(base, days=7):
    """Warn (never fail) on locked versions published less than `days` ago: a
    cooldown, so a freshly hijacked release is noticed before it is adopted."""
    lock = json.load(open(os.path.join(base, 'package-lock.json'), encoding='utf-8'))
    entries = [(p.split('node_modules/')[-1], e['version']) for p, e in lock['packages'].items() if p]

    def age(item):
        name, version = item
        try:
            with urllib.request.urlopen(f'https://registry.npmjs.org/{name.replace("/", "%2F")}', timeout=20) as r:
                published = json.load(r)['time'][version]
            return name, version, (time.time() - calendar.timegm(time.strptime(published[:19], '%Y-%m-%dT%H:%M:%S'))) / 86400
        except Exception:
            return name, version, None

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results = list(pool.map(age, sorted(set(entries))))
    young = [r for r in results if r[2] is not None and r[2] < days]
    for name, version, d in young:
        print(f'lessons-supply-chain: WARNING {name}@{version} was published {d:.1f} days ago (cooldown {days} days)')
    unknown = sum(1 for r in results if r[2] is None)
    print(f'lessons-supply-chain: release age of {len(results)} locked versions; {len(young)} younger than {days} days, '
          f'{unknown} not checked (a warning only, never a failure)')
    return 0


def selftest():
    """The guard can pass, and can still fail on each kind of problem."""
    api = None

    def tree(d, mutate):
        os.makedirs(os.path.join(d, 'src', 'quran'))
        json.dump({'name': 'x', 'scripts': {'build': 'vite build'}, 'dependencies': {'react': '18.3.1'}, 'devDependencies': {'vitest': '2.1.9'}},
                  open(os.path.join(d, 'package.json'), 'w'))
        json.dump({'lockfileVersion': 3, 'packages': {'': {}, 'node_modules/react': {
            'version': '18.3.1', 'resolved': 'https://registry.npmjs.org/react/-/react-18.3.1.tgz', 'integrity': 'sha512-x'},
            'node_modules/@types/react': {'version': '18.3.31', 'resolved': 'https://registry.npmjs.org/@types/react/-/react-18.3.31.tgz', 'integrity': 'sha512-z'}}},
            open(os.path.join(d, 'package-lock.json'), 'w'))
        open(os.path.join(d, 'src', 'a.ts'), 'w').write("import { b } from './b';\nimport React from 'react';\n")
        open(os.path.join(d, 'src', 'b.ts'), 'w').write('export const b = 1;\n')
        open(os.path.join(d, 'src', 'quran', 'basmala.ts'), 'w').write(f"export const BASMALA_SHA256 = new Set(['{'a' * 64}']);\n")
        open(api, 'w').write(f"export const BASMALA_SHA256 = new Set(['{'a' * 64}']);\n")
        mutate(d)
        paths = [os.path.join(dp, f) for dp, _, fs in os.walk(d) for f in fs]
        return check(d, paths, api)

    def write(rel, content, binary=False):
        def m(d):
            os.makedirs(os.path.dirname(os.path.join(d, rel)) or d, exist_ok=True)
            open(os.path.join(d, rel), 'wb' if binary else 'w').write(content)
        return m

    def lock_entry(path='node_modules/evil', **entry):
        def m(d):
            p = os.path.join(d, 'package-lock.json')
            lock = json.load(open(p))
            name = path.split('node_modules/')[-1]
            lock['packages'][path] = {'version': '1.0.0', 'resolved': f'https://registry.npmjs.org/{name}/-/{name}-1.0.0.tgz',
                                      'integrity': 'sha512-y', **entry}
            json.dump(lock, open(p, 'w'))
        return m

    def edit_pkg(change):
        def m(d):
            p = os.path.join(d, 'package.json')
            pkg = json.load(open(p))
            change(pkg)
            json.dump(pkg, open(p, 'w'))
        return m

    cases = {
        'clean': (lambda d: None, None),
        'clean-with-override': (edit_pkg(lambda k: k.update(overrides={'rollup': '4.64.12'})), None),
        'range': (edit_pkg(lambda k: k['dependencies'].update(react='^18.3.1')), 'not an exact version'),
        'override-range': (edit_pkg(lambda k: k.update(overrides={'rollup': '^4.64.12'})), 'not a plain exact version'),
        'override-alias': (edit_pkg(lambda k: k.update(overrides={'rollup': 'npm:attacker-pkg@1.0.0'})), 'not a plain exact version'),
        'override-nested': (edit_pkg(lambda k: k.update(overrides={'vite': {'rollup': '4.64.12'}})), 'not a plain exact version'),
        'override-ref': (edit_pkg(lambda k: k.update(overrides={'react': '$react'})), 'not a plain exact version'),
        'lifecycle-prepack': (edit_pkg(lambda k: k['scripts'].update(prepack='node x')), 'lifecycle script'),
        'lifecycle-pretest': (edit_pkg(lambda k: k['scripts'].update(pretest='node x')), 'lifecycle script'),
        'registry-host': (lock_entry(resolved='https://evil.example/evil-1.0.0.tgz'), 'not https://registry.npmjs.org/evil/'),
        'name-substitution': (lock_entry('node_modules/react', version='18.3.1',
                                         resolved='https://registry.npmjs.org/attacker-pkg/-/attacker-pkg-1.0.0.tgz'), 'not https://registry.npmjs.org/react/'),
        'scoped-substitution': (lock_entry('node_modules/@types/react', version='18.3.31',
                                           resolved='https://registry.npmjs.org/@evil/react/-/react-18.3.31.tgz'), 'not https://registry.npmjs.org/@types/react/'),
        'alias-name': (lock_entry(name='attacker-pkg'), 'installs'),
        'integrity': (lock_entry(integrity=''), 'no sha512 integrity'),
        'install-script': (lock_entry(hasInstallScript=True), 'install script'),
        'marker': (write('src/c.ts', "global['!'] = '9-0183-1';\n"), "global['!']"),
        'eval': (write('src/c.ts', 'const x = eval("1");\n'), 'eval('),
        'window-eval': (write('src/c.ts', 'const x = window.eval("1");\n'), '.eval'),
        'indirect-eval': (write('src/c.ts', 'const x = (0, eval)("1");\n'), '(0, eval)'),
        'bare-function': (write('src/c.ts', "const f = Function('return 1');\n"), 'Function('),
        'split-child-process': (write('src/c.ts', "const m = 'child' + '_process';\n"), "'child'+'_process'"),
        'glob': (write('src/c.ts', "const all = import.meta.glob('../../**');\n"), 'import.meta.glob'),
        'url-meta': (write('src/c.ts', "const u = new URL('../x', import.meta.url);\n"), 'import.meta.url'),
        'css-import': (write('src/c.css', "@import '../../x.css';\n"), '@import'),
        'css-url': (write('src/c.css', "a { background: url('../../x.png'); }\n"), 'url()'),
        'svg': (write('public/a.svg', "<svg><script>eval('x')</script></svg>\n"), 'eval('),
        'markdown': (write('notes.md', "run `node -e` with child_process\n"), 'child_process'),
        'extensionless': (write('bin/run', "#!/bin/sh\nnode -e \"require('child_process')\"\n"), 'child_process'),
        'binary': (write('public/x.bin', b'\x00\x01\x02payload', binary=True), 'binary file'),
        'fake-font': (write('public/fa.woff2', b'\x00node -e', binary=True), 'binary file'),
        'verse-font-fallback': (write('src/c.css', ".v { font-family: 'Amiri Quran', serif; }\n"), 'names the Quran font directly'),
        'no-font-face': (write('src/styles.css', ":root { --quran-font: 'Amiri Quran'; }\n"), 'must declare @font-face'),
        # The vendored Quran font at its own path, but other bytes: the pin is by path AND hash.
        'swapped-quran-font': (write('src/fonts/AmiriQuran.ttf', b'\x00\x01not the pinned font', binary=True), 'binary file'),
        'postcss': (write('postcss.config.js', 'module.exports = {};\n'), 'build-config file'),
        'vscode': (write('.vscode/tasks.json', '{}'), 'under .vscode/'),
        'nested-dist': (write('src/dist/x.ts', "export const x = 1;\n"), 'under dist/'),
        'nested-node-modules': (write('src/node_modules/y/index.js', "module.exports = 1;\n"), 'under node_modules/'),
        'climbs-out': (write('src/c.ts', "import x from '../../apps/api/src/x';\n"), 'outside apps/lessons'),
        'undeclared': (write('src/c.ts', "import y from 'left-pad';\n"), 'does not declare'),
        'absolute': (write('src/c.ts', "import z from '/etc/passwd';\n"), 'absolute path'),
        'builtin-in-src': (write('src/c.ts', "import fs from 'node:fs';\n"), 'Node built-in'),
        'vite-alias': (write('vite.config.ts', "export default { resolve: { alias: { x: 'y' } } };\n"), 'resolve.alias'),
        'vite-parent-path': (write('vite.config.ts', "export default { root: '../' };\n"), '"../" path'),
        'tsconfig-paths': (write('tsconfig.json', json.dumps({'compilerOptions': {'baseUrl': '.', 'paths': {'@x/*': ['../api/*']}}})), 'tsconfig path'),
        'tsconfig-extends': (write('tsconfig.json', json.dumps({'extends': '../../tsconfig.base.json'})), 'extends'),
        'basmala-missing': (lambda d: os.remove(os.path.join(d, 'src', 'quran', 'basmala.ts')), 'must both exist'),
        'basmala-drift': (write('src/quran/basmala.ts', f"export const BASMALA_SHA256 = new Set(['{'b' * 64}']);\n"), 'BASMALA_SHA256 differs'),
    }
    failed = []
    with tempfile.TemporaryDirectory() as scratch:
        api = os.path.join(scratch, 'quran-integrity.ts')
        for i, (name, (mutate, expected)) in enumerate(cases.items()):
            d = os.path.join(scratch, f'case-{i}')
            os.makedirs(d)
            errors = tree(d, mutate)
            ok = (not errors) if expected is None else any(expected in e for e in errors)
            if not ok:
                failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    for f in failed:
        print(f'lessons-supply-chain selftest: FAIL {f}')
    if not failed:
        print(f'lessons-supply-chain selftest: {len(cases)} cases, each caught')
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ['selftest']:
        return selftest()
    if argv[:1] == ['--release-age']:
        return release_age(os.path.join(ROOT, 'apps', 'lessons'))
    base = os.path.abspath(argv[0] if argv else os.path.join(ROOT, 'apps', 'lessons'))
    errors = check(base)
    for e in errors:
        print(f'lessons-supply-chain: {e}')
    if not errors:
        lock = json.load(open(os.path.join(base, 'package-lock.json')))
        print(f'lessons-supply-chain: {len(lock["packages"]) - 1} locked packages, each the exact registry tarball of its own name, with integrity; '
              'exact pins; no markers; nothing from outside apps/lessons')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
