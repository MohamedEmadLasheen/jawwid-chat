#!/usr/bin/env python3
"""PD-40 route gate: every HTTP handler of the API declares what it asks of staff.

A handler passes when its decorator stack (the decorators directly above its
@Get/@Post/@Put/@Patch/@Delete) holds exactly one of @Requires(...),
@SelfService(), @NotForStaff() or @Public(), or when its controller class is
@Public(). Anything else fails: a route with no declaration is refused to staff
at runtime by PermissionGuard, so this catches it before it ships.

It also checks every @Requires key is in the catalogue
(apps/api/src/platform/permissions/catalogue.ts).

The jest spec apps/api/test/unit/authorization/pd040-route-permissions.spec.ts
checks the same thing on Nest's own metadata; this one needs no Node, so it
runs in the guards job before anything is installed.

    python3 -I scripts/qa/check-route-permissions.py check
    python3 -I scripts/qa/check-route-permissions.py selftest
"""
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'apps', 'api', 'src')
CATALOGUE = os.path.join(SRC, 'platform', 'permissions', 'catalogue.ts')

HTTP = re.compile(r"^\s*@(Get|Post|Put|Patch|Delete)\(")
DECL = re.compile(r"^\s*@(Requires|SelfService|NotForStaff|Public)\(")
REQUIRES = re.compile(r"@Requires\(([^)]*)\)")
KEY = re.compile(r"'([a-z_]+(?:\.[a-z_]+)+)'")
DECORATOR = re.compile(r"^\s*@\w")
CLASS = re.compile(r"^\s*export class \w+")


def catalogue_keys(text):
    body = text.split('const ENTRIES = {', 1)[1].split('} as const', 1)[0]
    return set(re.findall(r"^\s*'([a-z_]+(?:\.[a-z_]+)+)':", body, re.M))


def check_source(name, text, keys):
    """Problems in one controller's source, as strings."""
    problems = []
    lines = text.split('\n')
    class_public = False
    for i, line in enumerate(lines):
        if CLASS.match(line):
            # The class's own decorators sit directly above it.
            class_public = False
            j = i - 1
            while j >= 0 and DECORATOR.match(lines[j]):
                class_public = class_public or '@Public()' in lines[j]
                j -= 1
            continue
        if not HTTP.match(line):
            continue
        stack = []
        j = i - 1
        while j >= 0 and DECORATOR.match(lines[j]):
            stack.append(lines[j])
            j -= 1
        k = i + 1
        while k < len(lines) and DECORATOR.match(lines[k]):
            stack.append(lines[k])
            k += 1
        decls = [s for s in stack if DECL.match(s)]
        where = '%s:%d %s' % (name, i + 1, line.strip())
        if len(decls) > 1:
            problems.append('%s declares more than one access rule' % where)
        elif not decls and not class_public:
            problems.append('%s declares no access rule (@Requires, @SelfService, @NotForStaff or @Public)' % where)
        for d in decls:
            m = REQUIRES.search(d)
            if not m:
                continue
            found = KEY.findall(m.group(1))
            if not found:
                problems.append('%s has an empty @Requires' % where)
            for key in found:
                if key not in keys:
                    problems.append('%s requires %r, which is not in the catalogue' % (where, key))
    return problems


def check():
    keys = catalogue_keys(open(CATALOGUE, encoding='utf-8').read())
    if not keys:
        print('route-permissions: the catalogue has no keys -- cannot check')
        return 1
    problems = []
    count = 0
    for base, _dirs, files in os.walk(SRC):
        for f in sorted(files):
            if not f.endswith('.controller.ts'):
                continue
            path = os.path.join(base, f)
            text = open(path, encoding='utf-8').read()
            count += len([l for l in text.split('\n') if HTTP.match(l)])
            problems += check_source(os.path.relpath(path, ROOT), text, keys)
    for p in problems:
        print('::error::PD-40 route gate: ' + p)
    if problems:
        return 1
    print('route-permissions: %d handlers, every one declares its access rule (%d catalogue keys)' % (count, len(keys)))
    return 0


def selftest():
    keys = {'certificates.view', 'certificates.request.student'}
    ok = """
@Controller('x')
export class X {
  @Requires('certificates.view')
  @Get()
  a() {}

  @SelfService()
  @RateLimited(Scope.X)
  @Post('b')
  b() {}

  @Get('c')
  @NotForStaff()
  c() {}
}
"""
    public_class = """
@Public()
@Controller('media')
export class M {
  @Get(':id')
  a() {}
}
"""
    cases = [
        ('a clean controller passes', ok, 0),
        ('a @Public controller passes', public_class, 0),
        ('an undeclared handler fails', ok.replace("  @Requires('certificates.view')\n", ''), 1),
        ('an unknown key fails', ok.replace("'certificates.view'", "'certificates.vew'"), 1),
        ('two rules on one handler fail', ok.replace("  @SelfService()\n", "  @SelfService()\n  @NotForStaff()\n"), 1),
        ('an empty @Requires fails', ok.replace("@Requires('certificates.view')", '@Requires()'), 1),
        ('a key with a multi-part action passes', ok.replace("'certificates.view'", "'certificates.request.student'"), 0),
        ('a multi-part key not in the catalogue fails', ok.replace("'certificates.view'", "'certificates.request.parent'"), 1),
    ]
    failed = 0
    for label, text, want in cases:
        got = len(check_source('selftest.controller.ts', text, keys))
        if (got > 0) != (want > 0):
            print('route-permissions selftest FAILED: %s (problems: %d)' % (label, got))
            failed += 1
    if failed:
        return 1
    print('route-permissions selftest: %d cases pass' % len(cases))
    return 0


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    sys.exit(selftest() if mode == 'selftest' else check())
