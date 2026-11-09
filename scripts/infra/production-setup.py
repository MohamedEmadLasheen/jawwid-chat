#!/usr/bin/env python3
"""Fill the GitHub configuration Deploy production needs, and say what is missing.

  python3 -I scripts/infra/production-setup.py status           # read-only: what is set, what is missing, who provides it
  python3 -I scripts/infra/production-setup.py fixed            # set the values this repository already knows
  python3 -I scripts/infra/production-setup.py generate         # create the random app secrets (never printed)
  python3 -I scripts/infra/production-setup.py ask NAME [NAME…] # paste a value you hold (secrets: hidden prompt; plain settings: stored as variables)
  python3 -I scripts/infra/production-setup.py file NAME PATH   # a multi-line secret from a file (.p8, .json)
  DATABASE_URL=... python3 -I scripts/infra/production-setup.py legal  # read-only: the PD-58 legal.current.* rows in the database

The owner runs it, on their own machine, with `gh` signed in as the repository
owner. It writes ONLY through `gh variable set` / `gh secret set`. It never
prints, logs or stores a secret value: generated secrets go from Python's
`secrets` module straight into gh's stdin, and `ask` uses gh's own hidden
prompt. `generate` refuses to replace a secret that already exists (rotating
the JWT keys signs everyone out) unless `--rotate` is given.

What is REQUIRED is derived, not listed by hand: every manifest row required
in production (infra/env/manifest.tsv) that deploy-production.yml reads from
`vars.` or `secrets.`, plus the deploy's own inputs. A rename in either file
moves this tool with it.

Values come from the decisions recorded in docs/infrastructure/decisions.md:
hostnames under chat.jawwid.com (production) and chat-staging.jawwid.com
(staging, repository variables used to build the image), ADR-014 (Supabase,
smaller pools) and ADR-015 (LAUNCH_PHASE=review, in-app Redis).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MANIFEST = os.path.join(ROOT, "infra", "env", "manifest.tsv")
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "deploy-production.yml")
ENV = "production"

# PD-58 (roadmap §7.3): the API refuses to start in production unless each of
# these chat.config rows names a version published with chat.publish_legal_version.
LEGAL_DOCUMENTS = ("terms_family", "terms_teacher", "terms_staff", "code_of_conduct")
LEGAL_SQL = (
    "select d.key, (c.key is not null), "
    "coalesce(case when jsonb_typeof(c.value) = 'string' then c.value #>> '{}' end, ''), "
    "(l.version is not null) "
    "from unnest(array['" + "','".join(LEGAL_DOCUMENTS) + "']) with ordinality as d(key, n) "
    "left join chat.config c on c.key = 'legal.current.' || d.key "
    "left join chat.legal_document_version l on l.document_key = d.key "
    "and jsonb_typeof(c.value) = 'string' and l.version = c.value #>> '{}' "
    "order by d.n"
)

# Read by jobs WITHOUT a GitHub Environment (preflight, build-admin-web), so
# they must be REPOSITORY variables; the staging four build the image the
# production deploy promotes.
REPO_VARS = {
    "PRODUCTION_API_BASE_URL": "https://api.chat.jawwid.com",
    "PRODUCTION_REALTIME_URL": "wss://api.chat.jawwid.com",
    "PRODUCTION_ADMIN_WEB_URL": "https://admin.chat.jawwid.com",
    "PRODUCTION_CORS_ALLOWED_ORIGINS": "https://admin.chat.jawwid.com",
    "STAGING_API_BASE_URL": "https://api.chat-staging.jawwid.com",
    "STAGING_REALTIME_URL": "wss://api.chat-staging.jawwid.com",
    "STAGING_ADMIN_WEB_URL": "https://admin.chat-staging.jawwid.com",
    "STAGING_CORS_ALLOWED_ORIGINS": "https://admin.chat-staging.jawwid.com",
}

# Production Environment values the repository already knows (not secrets,
# except REDIS_URL, which during the review period names the in-app component
# and holds no password; it is a secret only because the manifest says so).
ENV_VARS = {
    "LAUNCH_PHASE": "review",                       # ADR-015
    "DATABASE_POOL_MAX": "5",                       # ADR-014: Supabase Free's pooler
    "DATABASE_WORKER_POOL_MAX": "2",
    "STORAGE_ENDPOINT": "https://fra1.digitaloceanspaces.com",
    "STORAGE_REGION": "fra1",
    "APNS_BUNDLE_ID": "com.jawwid.jawwidChat",      # ios/Runner.xcodeproj
    "APNS_TEAM_ID": "KX683HAR3Y",                   # the paid team that signs Release
}
FIXED_SECRETS = {"REDIS_URL": "redis://redis:6379"}  # ADR-015, review period only

# Random, generated here, never seen by anyone: >= 32 characters each (the API
# refuses shorter: play-token.ts, media-url.ts, object-storage.ts, password-reset).
GENERATED = ("JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "RESET_CODE_HASH_SECRET", "STORAGE_SIGNING_SECRET")

# Who provides the rest, and how. Shown by `status`; never a value.
HINTS = {
    "DATABASE_URL": "Supabase Frankfurt project: session pooler string (port 5432, user postgres.<ref>) + ?sslmode=require",
    "DIGITALOCEAN_ACCESS_TOKEN": "DigitalOcean API token: read/create/update apps (+ read databases at launch)",
    "GHCR_PULL_CREDENTIALS": "<github-username>:<classic token with read:packages only>",
    "DIGITALOCEAN_APP_ID": "printed by the first `Deploy production` run with first_deploy=true",
    "BACKUP_ENCRYPTION_PASSPHRASE": "generate it in your password manager and KEEP it there too (backup-recovery.md §3)",
    "STORAGE_BUCKET": "the private Spaces bucket in fra1 (e.g. jawwid-chat-prod-media)",
    "STORAGE_ACCESS_KEY": "Spaces access key for that bucket",
    "STORAGE_SECRET_KEY": "Spaces secret key for that bucket",
    "STORAGE_ADMIN_ACCESS_KEY": "a SEPARATE Spaces key (Full Access) used only by the deploy's storage check and the versioning workflow; never the app's key",
    "STORAGE_ADMIN_SECRET_KEY": "the secret of that separate admin Spaces key",
    "APNS_KEY_ID": "Apple Developer -> Keys -> APNs key id",
    "APNS_PRIVATE_KEY": "the .p8 file: `file APNS_PRIVATE_KEY ~/Downloads/AuthKey_XXXX.p8`",
    "FCM_PROJECT_ID": "Firebase project id",
    "FCM_SERVICE_ACCOUNT_JSON": "Firebase service-account JSON: `file FCM_SERVICE_ACCOUNT_JSON ~/…json`",
    "LIVEKIT_URL": "the PRODUCTION LiveKit project's wss:// URL",
    "LIVEKIT_API_KEY": "production LiveKit API key",
    "LIVEKIT_API_SECRET": "production LiveKit API secret",
    "SENTRY_DSN": "Sentry project DSN for the API",
    "SMTP_URL": "smtps://user:password@host:465 from your email provider",
    "RECOVERY_MAIL_FROM": "the sender address, e.g. Jawwid <no-reply@jawwid.com> (SPF/DKIM on that domain)",
    "TRUSTED_PROXY_HOPS": "MEASURED after the first deploy (production-runbook.md §1d); leave it unset until then, never guess it",
}
ALWAYS_REQUIRED = ("DIGITALOCEAN_ACCESS_TOKEN", "GHCR_PULL_CREDENTIALS", "BACKUP_ENCRYPTION_PASSPHRASE",
                   "LAUNCH_PHASE", "DATABASE_POOL_MAX", "DATABASE_WORKER_POOL_MAX",
                   # The deploy's storage check, never the app (storage-versioning.sh).
                   "STORAGE_ADMIN_ACCESS_KEY", "STORAGE_ADMIN_SECRET_KEY")
AFTER_FIRST_DEPLOY = ("DIGITALOCEAN_APP_ID", "TRUSTED_PROXY_HOPS")


def required() -> dict[str, str]:
    """name -> 'secret' | 'var', for everything a review-phase production deploy needs."""
    wf = open(WORKFLOW, encoding="utf-8").read()
    wf_vars = set(re.findall(r"\$\{\{\s*vars\.([A-Z0-9_]+)", wf))
    wf_secrets = set(re.findall(r"\$\{\{\s*secrets\.([A-Z0-9_]+)", wf)) - {"GITHUB_TOKEN"}
    out: dict[str, str] = {}
    for line in open(MANIFEST, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        name, _group, _secret, _local, _staging, prod = line.rstrip("\n").split("\t")
        if prod != "req":
            continue
        if name in wf_secrets:
            out[name] = "secret"
        elif name in wf_vars:
            out[name] = "var"
    for name in ALWAYS_REQUIRED + AFTER_FIRST_DEPLOY:
        out[name] = "secret" if name in wf_secrets else "var"
    for name in REPO_VARS:
        if name.startswith("PRODUCTION_"):
            out[name] = "repo-var"
    return dict(sorted(out.items()))


def gh(args: list[str], stdin: str | None = None, interactive: bool = False) -> subprocess.CompletedProcess:
    if interactive:
        return subprocess.run(["gh", *args], check=False)
    return subprocess.run(["gh", *args], input=stdin, text=True, capture_output=True, check=False)


def names(kind: str) -> set[str]:
    """Names only. gh never returns a secret's value; variables' values are not read."""
    cmd = {"secret": ["secret", "list", "--env", ENV], "var": ["variable", "list", "--env", ENV],
           "repo-var": ["variable", "list"]}[kind] + ["--json", "name"]
    p = gh(cmd)
    if p.returncode != 0:
        raise SystemExit(f"production-setup: `gh {' '.join(cmd[:3])}` failed: is gh signed in with access to this repository?")
    return {row["name"] for row in json.loads(p.stdout or "[]")}


def cmd_status() -> int:
    have = {k: names(k) for k in ("secret", "var", "repo-var")}
    have["var"] |= have["repo-var"]          # vars.X resolves a repository variable too
    missing_now, missing_later = [], []
    print(f"{'NAME':34} {'KIND':9} STATE    SOURCE")
    for name, kind in required().items():
        ok = name in have["secret" if kind == "secret" else ("repo-var" if kind == "repo-var" else "var")]
        if name in GENERATED:
            src = "generate"
        elif name in ENV_VARS or name in REPO_VARS or name in FIXED_SECRETS:
            src = "fixed"
        else:
            src = HINTS.get(name, "you")
        print(f"{name:34} {kind:9} {'set    ' if ok else 'MISSING'}  {src}")
        if not ok:
            (missing_later if name in AFTER_FIRST_DEPLOY else missing_now).append(name)
    staging = [n for n in REPO_VARS if n.startswith("STAGING_") and n not in have["repo-var"]]
    print()
    if staging:
        print("image build (Deploy staging's build job) still needs repository variables: " + ", ".join(staging))
    print(f"missing before the first deploy: {len(missing_now)}" + (f" ({', '.join(missing_now)})" if missing_now else ""))
    if missing_later:
        print("set after the first deploy: " + ", ".join(missing_later))
    print("database (not GitHub): PD-58 needs the four legal.current.* rows before the API deploys; "
          "check them with `DATABASE_URL=... python3 -I scripts/infra/production-setup.py legal`")
    return 0 if not missing_now else 1


# libpq URI query parameters that have a standard PG* environment variable.
# Anything else is refused: dropping it silently could weaken the connection
# (e.g. lose a TLS setting) without anyone noticing.
PG_QUERY_ENV = {
    "host": "PGHOST",
    "hostaddr": "PGHOSTADDR",
    "port": "PGPORT",
    "dbname": "PGDATABASE",
    "user": "PGUSER",
    "password": "PGPASSWORD",
    "options": "PGOPTIONS",
    "application_name": "PGAPPNAME",
    "connect_timeout": "PGCONNECT_TIMEOUT",
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "sslcrl": "PGSSLCRL",
    "channel_binding": "PGCHANNELBINDING",
    "gssencmode": "PGGSSENCMODE",
    "target_session_attrs": "PGTARGETSESSIONATTRS",
}


def pg_env(url: str) -> dict[str, str]:
    """A postgres:// URL as PG* environment variables, so psql gets no secret on its command line.

    Raises ValueError with a message that never contains the URL, the password
    or any other value taken from it (parameter NAMES only, and only when they
    look like one).
    """
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise ValueError("DATABASE_URL is not a valid URL (an invalid port, or brackets)") from None
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must start with postgres:// or postgresql://")
    if parts.fragment:
        raise ValueError("DATABASE_URL has a #fragment, which libpq does not accept")
    if "," in parts.netloc:
        raise ValueError("DATABASE_URL names several hosts; give one host")
    env: dict[str, str] = {}
    # unquote, not unquote_plus: libpq decodes %XX only, never '+'.
    if parts.username:
        env["PGUSER"] = unquote(parts.username)
    if parts.password is not None:
        env["PGPASSWORD"] = unquote(parts.password)
    # Host from the netloc itself: .hostname lowercases, which would corrupt a
    # percent-encoded socket directory (postgresql://%2Fvar%2Frun%2Fpostgresql/db).
    hostport = parts.netloc.rpartition("@")[2]
    host = hostport[1:].partition("]")[0] if hostport.startswith("[") else hostport.partition(":")[0]
    if host:
        env["PGHOST"] = unquote(host)
    if port is not None:
        env["PGPORT"] = str(port)
    dbname = unquote(parts.path[1:]) if parts.path.startswith("/") else ""
    if dbname:
        env["PGDATABASE"] = dbname
    seen: set[str] = set()
    for pair in parts.query.split("&") if parts.query else []:
        raw_key, sep, raw_value = pair.partition("=")
        key = unquote(raw_key)
        shown = key if re.fullmatch(r"[a-z_]{1,40}", key) else "an unreadable parameter"
        if not sep:
            raise ValueError(f"DATABASE_URL query parameter {shown} has no value")
        if key not in PG_QUERY_ENV:
            raise ValueError(f"DATABASE_URL query parameter {shown} has no PG* environment variable; "
                             "remove it or set it some other way")
        if key in seen:
            raise ValueError(f"DATABASE_URL repeats the query parameter {shown}")
        seen.add(key)
        env[PG_QUERY_ENV[key]] = unquote(raw_value)  # libpq: a query parameter overrides the URI part
    return env


def cmd_legal() -> int:
    """Read-only: does each legal.current.<key> row name a published version? Prints names, never the URL."""
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("production-setup legal: set DATABASE_URL for the database to check (it is never printed)", file=sys.stderr)
        return 64
    try:
        conn = pg_env(url)
    except ValueError as e:
        print(f"production-setup legal: {e} (the URL is never printed)", file=sys.stderr)
        return 64
    # The connection goes through the environment, not argv, so `ps` never shows
    # the URL or password. The session is always read-only; options from the URL
    # are kept and the read-only setting is appended so it wins.
    read_only = "-c default_transaction_read_only=on"
    conn["PGOPTIONS"] = f"{conn['PGOPTIONS']} {read_only}" if conn.get("PGOPTIONS") else read_only
    env = {**os.environ, **conn}
    p = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", LEGAL_SQL],
                       text=True, capture_output=True, check=False, env=env)
    if p.returncode != 0:
        print(f"production-setup legal: psql exited {p.returncode}", file=sys.stderr)  # stderr not echoed: it can quote the URL
        return 1
    problems = 0
    for line in p.stdout.splitlines():
        key, configured, version, published = line.split("\t")
        name = f"legal.current.{key}"
        if configured != "t":
            state, problems = "MISSING", problems + 1
        elif not version:
            state, problems = "NOT A VERSION NAME (a JSON string)", problems + 1
        elif published != "t":
            state, problems = f"names {version!r}, which was never published", problems + 1
        else:
            state = f"set: {version!r}"
        print(f"{name:34} {state}")
    if problems:
        print(f"{problems} of {len(LEGAL_DOCUMENTS)} missing: production refuses to start (PD-58, roadmap §7.3). "
              "Release order: ENG-11 and ENG-12 first, then publish and set these rows, then deploy the API.")
    return 0 if problems == 0 else 1


def cmd_fixed() -> int:
    rc = 0
    for name, value in REPO_VARS.items():
        rc |= report(name, gh(["variable", "set", name, "--body", value]))
    for name, value in ENV_VARS.items():
        rc |= report(name, gh(["variable", "set", name, "--env", ENV, "--body", value]))
    for name, value in FIXED_SECRETS.items():
        rc |= report(name, gh(["secret", "set", name, "--env", ENV], stdin=value))
    return rc


def cmd_generate(rotate: bool) -> int:
    existing = names("secret")
    rc = 0
    for name in GENERATED:
        if name in existing and not rotate:
            print(f"  skip   {name}: already set (rotating it needs --rotate)")
            continue
        rc |= report(name, gh(["secret", "set", name, "--env", ENV], stdin=secrets.token_hex(32)))
    return rc


def cmd_ask(names_: list[str]) -> int:
    """Secrets through gh's hidden prompt; plain settings (vars.X in the deploy) as Environment variables.

    A value the deploy reads as `vars.X` stored as a secret is invisible to it,
    so the kind comes from required(), never from the caller.
    """
    kinds = required()
    rc = 0
    for name in names_:
        print(f"{name}: {HINTS.get(name, '')}")
        if kinds.get(name) == "var":
            value = input(f"{name} (not a secret; shown as you type): ").strip()
            if not value:
                print(f"  skip   {name}: empty")
                rc |= 1
                continue
            rc |= report(name, gh(["variable", "set", name, "--env", ENV, "--body", value]))
        else:
            rc |= gh(["secret", "set", name, "--env", ENV], interactive=True).returncode
    return rc


def report(name: str, p: subprocess.CompletedProcess) -> int:
    if p.returncode == 0:
        print(f"  set    {name}")
        return 0
    print(f"  FAILED {name}: gh exited {p.returncode}")  # gh's stderr is not echoed: it could quote input
    return 1


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.split("\n\n")[0])
        return 64 if not argv else 0
    mode, rest = argv[0], argv[1:]
    if mode == "status" and not rest:
        return cmd_status()
    if mode == "legal" and not rest:
        return cmd_legal()
    if mode == "fixed" and not rest:
        return cmd_fixed()
    if mode == "generate" and rest in ([], ["--rotate"]):
        return cmd_generate(rotate=bool(rest))
    if mode == "ask" and rest:
        return cmd_ask(rest)
    if mode == "file" and len(rest) == 2:
        name, path = rest
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            return report(name, gh(["secret", "set", name, "--env", ENV], stdin=f.read()))
    print(__doc__.split("\n\n")[0], file=sys.stderr)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
