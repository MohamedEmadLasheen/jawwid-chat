#!/usr/bin/env python3
"""DigitalOcean App Platform app spec: render, resolve, check. Owner: infrastructure.

  python3 scripts/infra/app-spec.py render  staging > .do/app.staging.yaml
  python3 scripts/infra/app-spec.py resolve staging --out "$RUNNER_TEMP/app-spec.yaml"
  python3 scripts/infra/app-spec.py check            # the `app-spec` guard
  python3 scripts/infra/app-spec.py selftest         # proves the guard can fail

WHY THE SPEC IS GENERATED (ADR-008, ADR-009, ADR-010)
-----------------------------------------------------
The app spec is the infrastructure as code: the components, their commands,
their health checks and the environment each one receives. The environment half
is a copy of infra/env/manifest.tsv, and a hand-kept copy drifts -- a variable
added to the manifest and forgotten in the spec passes every local check and
surfaces as a feature that is silently off in staging. So the committed
`.do/app.<env>.yaml` is rendered from the manifest, and the `app-spec` guard
fails CI when the committed file differs from what this script produces.

WHY THE SPEC HOLDS NO VALUES
----------------------------
Every value in the committed spec is a `${NAME}` placeholder. Values live in one
place, the GitHub Environment (`staging`, `production`), which the deploy
workflow already validates with check-env.sh. `resolve` runs inside that
workflow, BEFORE the backup and the migrations: it fills each placeholder from
the process environment, refuses an unset required value, drops an unset
optional one (an empty string would configure nothing, and an empty SECRET is
not a "disabled" feature, it is a broken one), and writes the deployable spec to
a mode-600 file outside the repository. It never prints a value.

A value written into the committed spec would bypass the GitHub Environment and
check-env.sh both. The guard refuses one.

Portable: python3 standard library only, no PyYAML. The spec format is ours, so
it is rendered and read line by line.
"""
from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MANIFEST = os.path.join(ROOT, "infra", "env", "manifest.tsv")
ENVIRONMENTS = ("staging", "production")

# The images. One API image runs two commands (ADR-004); Admin Web is its own,
# environment-specific image served by its nginx container (ADR-006, ADR-011).
REGISTRY = "mohamedemadlasheen"          # ghcr.io/<owner>, lower-cased
API_REPOSITORY = "jawwid-chat/api"
ADMIN_WEB_REPOSITORY = "jawwid-chat/admin-web"

# Manifest groups that are NOT the application's environment. BACKUP_* belong to
# the backup job (backup-db.sh, run by the deploy workflow); handing the backup
# passphrase to every running API and worker would widen its exposure for no
# reader at all.
EXCLUDED_GROUPS = ("backup",)

# Admin Web's runtime environment: the nginx template's CSP origins
# (apps/admin-web/infra-nginx/default.conf.template). Not secrets, not in the
# manifest (the manifest is the API process), always required: an empty origin
# silently narrows the CSP until calls or voice notes stop working.
ADMIN_WEB_ENV = ("API_ORIGIN", "REALTIME_ORIGIN", "LIVEKIT_ORIGIN", "STORAGE_ORIGIN")

# Placeholders the resolver derives instead of reading. Each domain is the host
# of a URL the workflow already holds, so the two can never disagree.
DERIVED = {"API_DOMAIN": "API_ORIGIN", "ADMIN_WEB_DOMAIN": "ADMIN_WEB_URL"}

# Sizes and counts per environment. API instance_count stays 1 in production
# until multi-instance realtime is proven on staging (production-readiness.md
# RISK-4): two instances without a working Redis adapter deliver each realtime
# event to only one of them.
SIZES = {
    "staging": {
        "api": ("apps-s-1vcpu-1gb", 1),
        "worker": ("apps-s-1vcpu-0.5gb", 1),
        "admin-web": ("apps-s-1vcpu-0.5gb", 1),
    },
    "production": {
        "api": ("apps-s-1vcpu-2gb", 1),
        "worker": ("apps-s-1vcpu-1gb", 1),
        "admin-web": ("apps-s-1vcpu-0.5gb", 1),
    },
}

PLACEHOLDER = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")


# ------------------------------------------------------------------- manifest
def read_manifest(path: str = MANIFEST) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) != 6:
                raise SystemExit(f"app-spec: malformed manifest row: {cols[0]!r}")
            name, group, secret, local, staging, production = cols
            rows.append({
                "name": name, "group": group, "secret": secret == "yes",
                "local": local, "staging": staging, "production": production,
            })
    return rows


def app_env_rows(rows: list[dict], env: str) -> list[dict]:
    """The manifest rows that become the API's and the worker's environment."""
    return [r for r in rows if r[env] != "forbid" and r["group"] not in EXCLUDED_GROUPS]


# --------------------------------------------------------------------- render
def env_block(indent: str, key: str, secret: bool) -> list[str]:
    return [
        f"{indent}- key: {key}",
        f"{indent}  scope: RUN_TIME",
        f"{indent}  type: {'SECRET' if secret else 'GENERAL'}",
        f"{indent}  value: ${{{key}}}",
    ]


def image_block(repository: str, tag_var: str) -> list[str]:
    return [
        "    image:",
        "      registry_type: GHCR",
        f"      registry: {REGISTRY}",
        f"      repository: {repository}",
        f"      tag: ${{{tag_var}}}",
        "      registry_credentials: ${GHCR_PULL_CREDENTIALS}",
    ]


def render(env: str, manifest_path: str = MANIFEST) -> str:
    if env not in ENVIRONMENTS:
        raise SystemExit(f"app-spec: unknown environment {env!r} (staging|production)")
    rows = app_env_rows(read_manifest(manifest_path), env)
    size = SIZES[env]
    app_env = []
    for r in rows:
        app_env += env_block("      ", r["name"], r["secret"])
    web_env = []
    for key in ADMIN_WEB_ENV:
        web_env += env_block("      ", key, False)

    out = [
        f"# Jawwid Chat -- DigitalOcean App Platform app spec ({env}).",
        "#",
        "# GENERATED FILE. Do not edit by hand. After changing infra/env/manifest.tsv",
        "# or scripts/infra/app-spec.py, regenerate it:",
        f"#   python3 scripts/infra/app-spec.py render {env} > .do/app.{env}.yaml",
        "# CI fails while it is stale (`bash scripts/qa/guards.sh app-spec`).",
        "#",
        "# Holds structure, never a value. Every ${NAME} is filled at deploy time from",
        f"# the `{env}` GitHub Environment by `app-spec.py resolve`",
        f"# (.github/workflows/deploy-{env}.yml), which refuses an unset required",
        "# value, drops an unset optional one, and writes the deployable spec outside",
        "# the repository. ADR-009, ADR-010, ADR-011 in docs/infrastructure/decisions.md.",
        f"name: jawwid-chat-{env}",
        "# Frankfurt: the closest App Platform region to the users.",
        "region: fra",
        "alerts:",
        "  - rule: DEPLOYMENT_FAILED",
        "  - rule: DOMAIN_FAILED",
        "# One host per component, each matching the URL the clients are built",
        "# against. Admin Web is a separate origin from the API on purpose: its CSP",
        "# names the API origin, and the API's CORS allowlist names Admin Web.",
        "domains:",
        "  - domain: ${API_DOMAIN}",
        "    type: PRIMARY",
        '    minimum_tls_version: "1.2"',
        "  - domain: ${ADMIN_WEB_DOMAIN}",
        "    type: ALIAS",
        '    minimum_tls_version: "1.2"',
        "ingress:",
        "  rules:",
        "    - match:",
        "        authority:",
        "          exact: ${API_DOMAIN}",
        "        path:",
        "          prefix: /",
        "      component:",
        "        name: api",
        "    - match:",
        "        authority:",
        "          exact: ${ADMIN_WEB_DOMAIN}",
        "        path:",
        "          prefix: /",
        "      component:",
        "        name: admin-web",
        "services:",
        "  # The API (ADR-004: the same image as the worker, a different command).",
        "  - name: api",
        *image_block(API_REPOSITORY, "API_IMAGE_TAG"),
        "    run_command: node dist/main.js",
        "    http_port: 3000",
        f"    instance_size_slug: {size['api'][0]}",
        f"    instance_count: {size['api'][1]}",
        "    # Readiness (ADR-007): checks Postgres and Redis. Failing it takes the",
        "    # instance out of routing; it never restarts the container.",
        "    health_check:",
        "      http_path: /health/ready",
        "      initial_delay_seconds: 10",
        "      period_seconds: 10",
        "      timeout_seconds: 5",
        "      failure_threshold: 3",
        "      success_threshold: 1",
        "    # Liveness (ADR-007): touches no dependency, so a database blip removes",
        "    # instances from routing instead of restarting every one of them.",
        "    liveness_health_check:",
        "      http_path: /health/live",
        "      initial_delay_seconds: 20",
        "      period_seconds: 30",
        "      timeout_seconds: 5",
        "      failure_threshold: 3",
        "    # Longer than SHUTDOWN_GRACE_MS, so the graceful drain finishes first.",
        "    termination:",
        "      grace_period_seconds: 20",
        "    envs:",
        *app_env,
        "  # Admin Web: its nginx container, not a static site (ADR-011). The bundle",
        "  # is built per environment (ADR-006); the runtime env is the CSP's origins.",
        "  - name: admin-web",
        *image_block(ADMIN_WEB_REPOSITORY, "ADMIN_WEB_IMAGE_TAG"),
        "    http_port: 8080",
        f"    instance_size_slug: {size['admin-web'][0]}",
        f"    instance_count: {size['admin-web'][1]}",
        "    health_check:",
        "      http_path: /healthz",
        "    liveness_health_check:",
        "      http_path: /healthz",
        "    envs:",
        *web_env,
        "workers:",
        "  # The outbox worker: the API image, the worker command (ADR-004). It serves",
        "  # no HTTP, so it has no health check; a crash exits and is restarted.",
        "  - name: worker",
        *image_block(API_REPOSITORY, "API_IMAGE_TAG"),
        "    run_command: node dist/worker.js",
        f"    instance_size_slug: {size['worker'][0]}",
        f"    instance_count: {size['worker'][1]}",
        "    termination:",
        "      grace_period_seconds: 20",
        "    envs:",
        *app_env,
    ]
    return "\n".join(out) + "\n"


# -------------------------------------------------------------------- resolve
KEY_LINE = re.compile(r"^(\s*)- key: ([A-Z][A-Z0-9_]*)$")
VALUE_LINE = re.compile(r"^(\s*(?:- )?[a-z_]+: )\$\{([A-Z][A-Z0-9_]*)\}$")


def host_of(url: str, source: str) -> str:
    if not url.startswith("https://"):
        raise ValueError(f"{source} must be an https:// URL")
    host = url[len("https://"):].split("/", 1)[0]
    if not host or ":" in host:
        raise ValueError(f"{source} must name a host with no port")
    return host


def resolve(env: str, template: str, environ: dict, manifest_path: str = MANIFEST):
    """Return (spec_text, set_names, dropped_names, errors). Never returns a value
    anywhere but inside spec_text."""
    rules = {r["name"]: r[env] for r in read_manifest(manifest_path)}
    errors: list[str] = []
    dropped: list[str] = []
    filled: list[str] = []

    def value_of(name: str) -> str:
        if name in DERIVED:
            source = DERIVED[name]
            url = environ.get(source, "")
            if not url:
                return ""
            try:
                return host_of(url, source)
            except ValueError as e:
                errors.append(str(e))
                return ""
        return environ.get(name, "")

    lines = template.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("#"):
            out.append(line)
            i += 1
            continue
        m = KEY_LINE.match(line)
        if m:
            indent, key = m.group(1), m.group(2)
            block = [line]
            i += 1
            while i < len(lines) and lines[i].startswith(indent + "  ") \
                    and not lines[i].startswith(indent + "  -"):
                block.append(lines[i])
                i += 1
            value_lines = [b for b in block if b.strip().startswith("value:")]
            if len(value_lines) != 1 or value_lines[0].strip() != f"value: ${{{key}}}":
                errors.append(f"env {key}: its value must be exactly ${{{key}}}")
                continue
            value = value_of(key)
            if not value:
                if rules.get(key) == "opt":
                    dropped.append(key)
                else:
                    errors.append(f"MISSING {key}")
                continue
            filled.append(key)
            out += [b.replace(f"${{{key}}}", json.dumps(value)) for b in block]
            continue
        if PLACEHOLDER.search(line):
            vm = VALUE_LINE.match(line)
            if not vm:
                errors.append(f"line {i + 1}: a placeholder must be a whole value")
            else:
                name = vm.group(2)
                value = value_of(name)
                if not value:
                    errors.append(f"MISSING {name}")
                else:
                    filled.append(name)
                    line = vm.group(1) + json.dumps(value)
        out.append(line)
        i += 1
    return "\n".join(out), sorted(set(filled)), sorted(set(dropped)), sorted(set(errors))


def cmd_resolve(env: str, out_path: str) -> int:
    with open(os.path.join(ROOT, ".do", f"app.{env}.yaml"), encoding="utf-8") as f:
        template = f.read()
    text, filled, dropped, errors = resolve(env, template, dict(os.environ))
    for e in errors:
        print(f"::error title=App spec::{e}")
    if errors:
        print(f"app spec NOT resolved: {len(errors)} error(s); nothing was written")
        return 1
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(out_path, 0o600)
    print(f"app spec resolved for {env}: {len(filled)} value(s) set")
    if dropped:
        print("optional, unset, left out: " + ", ".join(dropped))
    return 0


# ---------------------------------------------------------------------- check
def blocks(text: str):
    """Yield (component, key, type) for every env entry, from the rendered text."""
    component = None
    lines = text.split("\n")
    for n, line in enumerate(lines):
        cm = re.match(r"^  - name: ([a-z-]+)$", line)
        if cm:
            component = cm.group(1)
        km = KEY_LINE.match(line)
        if km and n + 2 < len(lines):
            tm = re.match(r"^\s*type: (\w+)$", lines[n + 2])
            yield component, km.group(2), tm.group(1) if tm else None


def invariants(env: str, text: str, manifest_path: str = MANIFEST) -> list[str]:
    """Properties the ADRs require of the spec, checked on the committed text so
    an edit to the generator cannot quietly remove one."""
    errs = []
    rows = read_manifest(manifest_path)
    by_name = {r["name"]: r for r in rows}
    want = {r["name"] for r in app_env_rows(rows, env)}

    if "static_sites:" in text:
        errs.append("Admin Web must be a container service, not a static site (ADR-011)")
    for needle, why in (
        ("run_command: node dist/main.js", "the API command (ADR-004)"),
        ("run_command: node dist/worker.js", "the worker command (ADR-004)"),
        ("http_path: /health/ready", "readiness probe (ADR-007)"),
        ("http_path: /health/live", "liveness probe (ADR-007)"),
        ("http_path: /healthz", "Admin Web probe (ADR-011)"),
    ):
        if needle not in text:
            errs.append(f"missing {why}: '{needle}'")
    if text.count(f"repository: {API_REPOSITORY}") != 2:
        errs.append("the API and the worker must run the one API image (ADR-004)")
    for n, line in enumerate(text.split("\n"), 1):
        s = line.strip()
        if s.startswith("value:") and not re.fullmatch(r"value: \$\{[A-Z][A-Z0-9_]*\}", s):
            errs.append(f"line {n}: a literal value bypasses the GitHub Environment")
        if s.startswith("registry_credentials:") and s != "registry_credentials: ${GHCR_PULL_CREDENTIALS}":
            errs.append(f"line {n}: registry credentials must be a placeholder")

    seen: dict[str, set] = {}
    for component, key, typ in blocks(text):
        seen.setdefault(component, set()).add(key)
        row = by_name.get(key)
        if row is None:
            if component != "admin-web":
                errs.append(f"{component}: {key} is not in the manifest")
            continue
        if row[env] == "forbid":
            errs.append(f"{component}: {key} is forbidden in {env}")
        if row["secret"] and typ != "SECRET":
            errs.append(f"{component}: {key} is a secret but has type {typ}")
        if not row["secret"] and typ != "GENERAL":
            errs.append(f"{component}: {key} is not a secret but has type {typ}")
    for component in ("api", "worker"):
        have = seen.get(component, set())
        for missing in sorted(want - have):
            errs.append(f"{component}: manifest variable {missing} is absent")
        for extra in sorted(have - want):
            if extra in by_name:
                errs.append(f"{component}: {extra} must not be in the app environment")
    if seen.get("admin-web", set()) != set(ADMIN_WEB_ENV):
        errs.append("admin-web: its env must be exactly " + ", ".join(ADMIN_WEB_ENV))
    return errs


def strip_comments(text: str) -> str:
    return "\n".join(l for l in text.split("\n") if not l.lstrip().startswith("#"))


def workflow_mirror(env: str, text: str, manifest_path: str = MANIFEST) -> list[str]:
    """Every placeholder must be supplied by the deploy workflow, and a secret
    only ever from `secrets.`: an unsupplied optional variable would otherwise
    stay off forever, with nothing anywhere saying why."""
    path = os.path.join(ROOT, ".github", "workflows", f"deploy-{env}.yml")
    with open(path, encoding="utf-8") as f:
        wf = f.read()
    secrets = {r["name"] for r in read_manifest(manifest_path) if r["secret"]}
    secrets.add("GHCR_PULL_CREDENTIALS")
    errs = []
    names = set(PLACEHOLDER.findall(strip_comments(text)))
    for name in sorted(names):
        source = DERIVED.get(name, name)
        m = re.search(rf"(?m)^\s+{re.escape(source)}: (.*)$", wf)
        if not m:
            errs.append(f"deploy-{env}.yml never supplies {source}")
        elif source in secrets and "secrets." not in m.group(1):
            errs.append(f"deploy-{env}.yml supplies the secret {source} from somewhere other than secrets.")
    return errs


def doctl_schema(path: str) -> tuple[bool, str]:
    """`doctl apps spec validate --schema-only`: a strict decode against
    DigitalOcean's own AppSpec types, so an unknown or misspelt field fails. It
    runs offline: no token, and an empty config file so a developer's saved
    credentials can never be read."""
    doctl = shutil.which("doctl")
    if not doctl:
        return False, ("doctl is not installed, so the spec schema cannot be checked "
                       "(brew install doctl, or scripts/infra/install-doctl.sh on Linux)")
    with tempfile.TemporaryDirectory() as tmp:
        cfg = os.path.join(tmp, "config.yaml")
        open(cfg, "w").close()
        env = {k: v for k, v in os.environ.items() if not k.startswith("DIGITALOCEAN_")}
        env["HOME"] = tmp
        p = subprocess.run([doctl, "--config", cfg, "apps", "spec", "validate",
                            "--schema-only", path],
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env, text=True)
    return p.returncode == 0, p.stderr.strip()


def cmd_check() -> int:
    rc = 0
    for env in ENVIRONMENTS:
        path = os.path.join(ROOT, ".do", f"app.{env}.yaml")
        rel = os.path.relpath(path, ROOT)
        want = render(env)
        try:
            with open(path, encoding="utf-8") as f:
                have = f.read()
        except FileNotFoundError:
            have = ""
        if have != want:
            sys.stdout.writelines(difflib.unified_diff(
                have.splitlines(True), want.splitlines(True), rel, f"{rel} (rendered)"))
            print(f"{rel} is stale -- regenerate it:")
            print(f"  python3 scripts/infra/app-spec.py render {env} > {rel}")
            rc = 1
            continue
        errs = invariants(env, have) + workflow_mirror(env, have)
        ok, why = doctl_schema(path)
        if not ok:
            errs.append(f"doctl schema validation failed: {why}")
        for e in errs:
            print(f"  {rel}: {e}")
        if errs:
            rc = 1
        else:
            print(f"{rel}: matches the manifest, keeps the ADR invariants, "
                  "is supplied by its workflow, and passes doctl's schema")
    return rc


# ------------------------------------------------------------------- selftest
def cmd_selftest() -> int:
    """The guard has to be able to FAIL. Each case is a drift it must catch."""
    failures = []

    def expect(cond: bool, what: str):
        print(f"  {'ok  ' if cond else 'FAIL'}  {what}")
        if not cond:
            failures.append(what)

    with tempfile.TemporaryDirectory() as tmp:
        manifest = os.path.join(tmp, "manifest.tsv")
        with open(MANIFEST, encoding="utf-8") as f:
            base = f.read()
        with open(manifest, "w", encoding="utf-8") as f:
            f.write(base + "SELFTEST_NEW_VAR\tapplication\tno\topt\treq\treq\n")
        expect(render("staging", manifest) != render("staging"),
               "a variable added to the manifest makes the committed spec stale")

        spec = render("staging")
        expect(not invariants("staging", spec), "the rendered staging spec keeps every invariant")
        broken = spec.replace("http_path: /health/ready", "http_path: /health/live")
        expect(any("readiness" in e for e in invariants("staging", broken)),
               "a readiness probe pointed at liveness is refused")
        literal = spec.replace("value: ${CORE_BASE_URL}", "value: https://core.invalid", 1)
        expect(any("literal value" in e for e in invariants("staging", literal)),
               "a literal value in the committed spec is refused")
        downgraded = re.sub(r"(- key: JWT_ACCESS_SECRET\n\s+scope: RUN_TIME\n\s+type: )SECRET",
                            r"\1GENERAL", spec, count=1)
        expect(any("JWT_ACCESS_SECRET is a secret" in e for e in invariants("staging", downgraded)),
               "a secret rendered as a plain variable is refused")
        expect(any("static site" in e for e in invariants("staging", spec + "static_sites:\n")),
               "an Admin Web static site is refused")

        environ = {r["name"]: f"v-{r['name'].lower()}"
                   for r in app_env_rows(read_manifest(), "staging")
                   if r["staging"] == "req"}
        secret_value = 'line one\nline "two" \\ end'
        environ.update({
            "JWT_ACCESS_SECRET": secret_value,
            "API_IMAGE_TAG": "0123abc", "ADMIN_WEB_IMAGE_TAG": "staging-0123abc",
            "GHCR_PULL_CREDENTIALS": "user:token",
            "API_ORIGIN": "https://api.staging.invalid",
            "ADMIN_WEB_URL": "https://admin.staging.invalid",
            "REALTIME_ORIGIN": "wss://api.staging.invalid",
            "LIVEKIT_ORIGIN": "wss://livekit.invalid",
            "STORAGE_ORIGIN": "https://storage.invalid",
        })
        text, filled, dropped, errors = resolve("staging", spec, environ)
        expect(not errors, "a complete environment resolves")
        expect("SENTRY_DSN" in dropped and "- key: SENTRY_DSN" not in text,
               "an unset optional variable is left out, not set empty")
        expect("${" not in strip_comments(text), "no placeholder survives resolution")
        expect(json.dumps(secret_value) in text,
               "a multi-line value with quotes is emitted as one quoted scalar")
        expect("exact: \"api.staging.invalid\"" in text,
               "the API domain is derived from API_ORIGIN")
        resolved = os.path.join(tmp, "resolved.yaml")
        with open(resolved, "w", encoding="utf-8") as f:
            f.write(text)
        ok, why = doctl_schema(resolved)
        expect(ok, "the resolved spec passes doctl's schema" + ("" if ok else f" ({why})"))

        missing = dict(environ)
        del missing["DATABASE_URL"]
        _, _, _, errors = resolve("staging", spec, missing)
        expect("MISSING DATABASE_URL" in errors, "an unset required variable is refused")
        missing = dict(environ)
        del missing["GHCR_PULL_CREDENTIALS"]
        _, _, _, errors = resolve("staging", spec, missing)
        expect("MISSING GHCR_PULL_CREDENTIALS" in errors, "unset registry credentials are refused")
        plain = dict(environ, API_ORIGIN="http://api.staging.invalid")
        _, _, _, errors = resolve("staging", spec, plain)
        expect(any("https://" in e for e in errors), "a non-https API origin is refused")

        bad = os.path.join(tmp, "bad.yaml")
        with open(bad, "w", encoding="utf-8") as f:
            f.write(text.replace("run_command: node dist/worker.js",
                                 "run_command: node dist/worker.js\n    bogus_field: 1"))
        ok, _ = doctl_schema(bad)
        expect(not ok, "doctl refuses an unknown field")

    print("selftest: " + ("PASS" if not failures else f"FAIL ({len(failures)})"))
    return 0 if not failures else 1


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "render":
        sys.stdout.write(render(argv[1]))
        return 0
    if len(argv) == 4 and argv[0] == "resolve" and argv[2] == "--out":
        if argv[1] not in ENVIRONMENTS:
            print(f"app-spec: unknown environment {argv[1]!r}")
            return 64
        return cmd_resolve(argv[1], argv[3])
    if argv == ["check"]:
        return cmd_check()
    if argv == ["selftest"]:
        return cmd_selftest()
    print(__doc__.split("\n\n")[0], file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
