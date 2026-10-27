#!/usr/bin/env python3
"""The lessons engine's supply-chain guard (PD-29 materials quality P0-3).

    python3 -I scripts/qa/check-lessons-supply-chain.py [apps/lessons]
    python3 -I scripts/qa/check-lessons-supply-chain.py selftest

The old lessons repo was infected through its build config (a postcss.config.js
loader, .vscode folderOpen tasks, a fake font holding a second payload). The
engine is written from scratch, and this keeps it that way. It fails when:
  * a dependency in package.json is not an exact version (no ^ ~ * ranges, tags,
    git, file or URL specs);
  * a package-lock.json entry does not come from https://registry.npmjs.org/
    with an sha512 integrity, or is a link;
  * a locked package has an install script and is not on INSTALL_SCRIPT_ALLOWLIST
    (CI installs with --ignore-scripts, so none of them runs; the list makes any
    new one a reviewed change);
  * a source file carries one of the infected family's markers;
  * a build-config file the payload used (postcss / tailwind config) or a
    .vscode folder exists;
  * a font file is not a font (magic bytes);
  * a source file imports anything from outside apps/lessons: a relative path
    that climbs out, an absolute path, or a bare package that is not declared in
    package.json (so nothing resolves through a parent node_modules).
Standard library only; reads files as text and bytes, runs nothing.
"""
import json
import os
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INSTALL_SCRIPT_ALLOWLIST = {'esbuild', 'fsevents'}
EXACT = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')
MARKERS = [
    (re.compile(r"global\[\s*['\"]!['\"]\s*\]"), "global['!'] (the loader's marker)"),
    (re.compile(r'\b_0x[0-9a-fA-F]{4,}\b'), 'an _0x… obfuscated identifier'),
    (re.compile(r'\bchild_process\b'), 'child_process'),
    (re.compile(r'(?<![\w.])eval\s*\('), 'eval('),
    (re.compile(r'\bnew\s+Function\s*\('), 'new Function('),
    (re.compile(r'\bfolderOpen\b'), 'a folderOpen task'),
]
FORBIDDEN_NAMES = re.compile(r'^(postcss\.config\.[cm]?[jt]s|\.postcssrc(\..*)?|tailwind\.config\.[cm]?[jt]s)$')
FONT_MAGIC = {'.woff2': [b'wOF2'], '.woff': [b'wOFF'], '.ttf': [b'\x00\x01\x00\x00', b'true'], '.otf': [b'OTTO']}
SOURCE_EXT = ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.json')
SKIP_DIRS = {'node_modules', 'dist', '.vite'}
IMPORT = re.compile(r"""(?:\bimport\s+(?:[^'"]*?\sfrom\s+)?|\bexport\s+[^'"]*?\sfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]""")
NODE_BUILTINS_FOR_CONFIG = {'node:path', 'node:url'}


def files(base):
    for dp, dirs, fs in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in fs:
            yield os.path.join(dp, f)


def package_root(spec):
    parts = spec.split('/')
    return '/'.join(parts[:2]) if spec.startswith('@') else parts[0]


def check(base):
    errors = []
    rel = lambda p: os.path.relpath(p, base)
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
    for hook in ('preinstall', 'install', 'postinstall', 'prepare', 'prepublish'):
        if hook in (pkg.get('scripts') or {}):
            errors.append(f'package.json must not define a {hook} script')

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
        resolved = entry.get('resolved', '')
        if not resolved.startswith('https://registry.npmjs.org/'):
            errors.append(f'lock {path}: resolved from {resolved or "nowhere"}, not registry.npmjs.org')
        if not str(entry.get('integrity', '')).startswith('sha512-'):
            errors.append(f'lock {path}: no sha512 integrity')
        if entry.get('hasInstallScript') and name not in INSTALL_SCRIPT_ALLOWLIST:
            errors.append(f'lock {path}: has an install script and is not on the allowlist')

    for p in files(base):
        name = os.path.basename(p)
        parts = rel(p).split(os.sep)
        if '.vscode' in parts:
            errors.append(f'{rel(p)}: a .vscode folder')
        if FORBIDDEN_NAMES.match(name):
            errors.append(f'{rel(p)}: a {name} build-config file (the old repo\'s infection vector)')
        ext = os.path.splitext(name)[1].lower()
        if ext in FONT_MAGIC:
            head = open(p, 'rb').read(4)
            if not any(head.startswith(m) for m in FONT_MAGIC[ext]):
                errors.append(f'{rel(p)}: a "{ext}" font whose bytes are not a font')
        if name == 'package-lock.json' or not name.endswith(SOURCE_EXT):
            continue
        text = open(p, encoding='utf-8', errors='replace').read()
        for pattern, what in MARKERS:
            if pattern.search(text):
                errors.append(f'{rel(p)}: contains {what}')
        if ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'):
            for spec in IMPORT.findall(text):
                if spec.startswith('.'):
                    target = os.path.normpath(os.path.join(os.path.dirname(p), spec))
                    if os.path.commonpath([target, os.path.abspath(base)]) != os.path.abspath(base):
                        errors.append(f'{rel(p)}: imports {spec!r}, outside apps/lessons')
                elif spec.startswith('/') or re.match(r'^[A-Za-z]:', spec) or spec.startswith('file:'):
                    errors.append(f'{rel(p)}: imports the absolute path {spec!r}')
                elif spec.startswith('node:'):
                    if not (name in ('vite.config.ts', 'vitest.config.ts') and spec in NODE_BUILTINS_FOR_CONFIG):
                        errors.append(f'{rel(p)}: imports the Node built-in {spec!r}')
                else:
                    root = package_root(spec)
                    if root not in declared:
                        errors.append(f'{rel(p)}: imports {spec!r}, which package.json does not declare')
    return errors


def selftest():
    """The guard can pass, and can still fail on each kind of problem."""
    def tree(mutate):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, 'src'))
        json.dump({'name': 'x', 'dependencies': {'react': '18.3.1'}, 'devDependencies': {'vitest': '2.1.9'}}, open(os.path.join(d, 'package.json'), 'w'))
        json.dump({'lockfileVersion': 3, 'packages': {'': {}, 'node_modules/react': {
            'version': '18.3.1', 'resolved': 'https://registry.npmjs.org/react/-/react-18.3.1.tgz', 'integrity': 'sha512-x'}}},
            open(os.path.join(d, 'package-lock.json'), 'w'))
        open(os.path.join(d, 'src', 'a.ts'), 'w').write("import { b } from './b';\nimport React from 'react';\n")
        open(os.path.join(d, 'src', 'b.ts'), 'w').write('export const b = 1;\n')
        mutate(d)
        return check(d)

    def write(rel, text, mode='w'):
        return lambda d: (os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True), open(os.path.join(d, rel), mode).write(text))

    def lock_entry(**entry):
        def m(d):
            p = os.path.join(d, 'package-lock.json')
            lock = json.load(open(p))
            lock['packages']['node_modules/evil'] = {'version': '1.0.0', 'resolved': 'https://registry.npmjs.org/evil/-/evil-1.0.0.tgz', 'integrity': 'sha512-y', **entry}
            json.dump(lock, open(p, 'w'))
        return m

    def range_dep(d):
        p = os.path.join(d, 'package.json')
        pkg = json.load(open(p))
        pkg['dependencies']['react'] = '^18.3.1'
        json.dump(pkg, open(p, 'w'))

    cases = {
        'clean': (lambda d: None, None),
        'range': (range_dep, 'not an exact version'),
        'registry': (lock_entry(resolved='https://evil.example/evil.tgz'), 'not registry.npmjs.org'),
        'integrity': (lock_entry(integrity=''), 'no sha512 integrity'),
        'install-script': (lock_entry(hasInstallScript=True), 'install script'),
        'marker': (write('src/c.ts', "global['!'] = '9-0183-1';\n"), "global['!']"),
        'eval': (write('src/c.ts', 'const x = eval("1");\n'), 'eval('),
        'postcss': (write('postcss.config.js', 'module.exports = {};\n'), 'build-config file'),
        'vscode': (write('.vscode/tasks.json', '{}'), '.vscode folder'),
        'fake-font': (write('public/fa.woff2', 'node -e "x"'), 'not a font'),
        'climbs-out': (write('src/c.ts', "import x from '../../apps/api/src/x';\n"), 'outside apps/lessons'),
        'undeclared': (write('src/c.ts', "import y from 'left-pad';\n"), 'does not declare'),
        'absolute': (write('src/c.ts', "import z from '/etc/passwd';\n"), 'absolute path'),
    }
    failed = []
    for name, (mutate, expected) in cases.items():
        errors = tree(mutate)
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
    base = os.path.abspath(argv[0] if argv else os.path.join(ROOT, 'apps', 'lessons'))
    errors = check(base)
    for e in errors:
        print(f'lessons-supply-chain: {e}')
    if not errors:
        lock = json.load(open(os.path.join(base, 'package-lock.json')))
        print(f'lessons-supply-chain: {len(lock["packages"]) - 1} locked packages from the registry with integrity; '
              'exact pins; no markers; nothing imported from outside apps/lessons')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
