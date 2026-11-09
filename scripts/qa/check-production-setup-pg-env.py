#!/usr/bin/env python3
"""Tests for pg_env / legal_conn_env in scripts/infra/production-setup.py (LR-46 P3-12).

  python3 -I scripts/qa/check-production-setup-pg-env.py

`production-setup.py legal` hands DATABASE_URL to psql as PG* environment
variables (never argv) and forces the session read-only. These cases pin the
parts a later edit could quietly break: '+' must stay '+' (unquote, not
unquote_plus), a socket path must keep its case (no .hostname), the read-only
option must come AFTER the URL's own options, unmapped parameters and several
hosts are refused, and no error message ever carries the password.

Pure: the module is imported by path, nothing connects, psql is never run.
The URLs are built by concatenation so no line reads as a credential URL to
scripts/infra/scan-secrets.sh. All values are fakes.
"""
from __future__ import annotations

import importlib.util
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(ROOT, "scripts", "infra", "production-setup.py")

spec = importlib.util.spec_from_file_location("production_setup", SCRIPT)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)

SECRET = "S3cretPw"  # a fake; must never appear in any error message
failures: list[str] = []


def url(userinfo: str, rest: str, scheme: str = "postgres") -> str:
    return scheme + "://" + userinfo + "@" + rest


def expect(name: str, cond: bool) -> None:
    if not cond:
        failures.append(name)  # the case name only, never a value


def env_of(name: str, u: str) -> dict[str, str]:
    try:
        return ps.pg_env(u)
    except ValueError:
        failures.append(f"{name}: refused a valid URL")
        return {}


def refused(name: str, u: str, *, hidden: tuple[str, ...] = (SECRET,)) -> str:
    """pg_env must raise ValueError; its message must not contain the URL or any `hidden` text."""
    try:
        ps.pg_env(u)
    except ValueError as e:
        msg = str(e)
        expect(f"{name}: message contains the URL", u not in msg)
        for h in hidden:
            expect(f"{name}: message contains a value from the URL", h not in msg)
        # `from None`: a traceback must not chain urlsplit's own message (it quotes the netloc).
        expect(f"{name}: chains the original error", e.__cause__ is None
               and (e.__context__ is None or e.__suppress_context__))
        return msg
    failures.append(f"{name}: accepted")
    return ""


# '+' stays '+' (libpq decodes %XX only).
e = env_of("plus", url("x+y:a+b", "h/db"))
expect("plus: password", e.get("PGPASSWORD") == "a+b")
expect("plus: user", e.get("PGUSER") == "x+y")
e = env_of("plus-encoded", url("u:a%2Bb%20c", "h/db"))
expect("plus-encoded: password", e.get("PGPASSWORD") == "a+b c")

# A percent-encoded socket directory keeps its case.
e = env_of("socket", "postgresql://%2Fvar%2Frun%2FPostgreSQL/App_DB")
expect("socket: host", e.get("PGHOST") == "/var/run/PostgreSQL")
expect("socket: db", e.get("PGDATABASE") == "App_DB")
expect("socket: no port", "PGPORT" not in e)
e = env_of("socket-query", "postgres:///db?host=%2Ftmp%2FPG")
expect("socket-query: host", e.get("PGHOST") == "/tmp/PG")
e = env_of("host-case", url("u:pw", "Db.Example.COM:6543/db"))
expect("host-case: host", e.get("PGHOST") == "Db.Example.COM")
expect("host-case: port", e.get("PGPORT") == "6543")

# IPv6 brackets are stripped.
e = env_of("ipv6", url("u:pw", "[::1]:5432/db"))
expect("ipv6: host", e.get("PGHOST") == "::1")
expect("ipv6: port", e.get("PGPORT") == "5432")
expect("ipv6: db", e.get("PGDATABASE") == "db")

# A query parameter overrides the URI part (libpq).
e = env_of("override", url("u:pw", "h/db?password=other&sslmode=require"))
expect("override: password", e.get("PGPASSWORD") == "other")
expect("override: sslmode", e.get("PGSSLMODE") == "require")

# An empty password is still passed (libpq treats it as given).
e = env_of("empty-password", url("u:", "h/db"))
expect("empty-password", e.get("PGPASSWORD") == "")

# A comma in the user name or password is not a host list (P3-1).
e = env_of("comma-password", url("u,v:pa,ss", "h/db"))
expect("comma-password: password", e.get("PGPASSWORD") == "pa,ss")
expect("comma-password: user", e.get("PGUSER") == "u,v")

# The TLS and other mapped settings reach their PG* variable (P3-3).
for key, var in (("sslnegotiation", "PGSSLNEGOTIATION"),
                 ("ssl_min_protocol_version", "PGSSLMINPROTOCOLVERSION"),
                 ("ssl_max_protocol_version", "PGSSLMAXPROTOCOLVERSION"),
                 ("require_auth", "PGREQUIREAUTH"),
                 ("sslcertmode", "PGSSLCERTMODE"),
                 ("sslsni", "PGSSLSNI"),
                 ("sslcrldir", "PGSSLCRLDIR"),
                 ("passfile", "PGPASSFILE"),
                 ("load_balance_hosts", "PGLOADBALANCEHOSTS")):
    e = env_of(f"mapped {key}", url("u:pw", f"h/db?{key}=v1"))
    expect(f"mapped {key}", e.get(var) == "v1")

# Read-only always, appended AFTER the URL's own options so it wins.
ro = ps.PG_READ_ONLY
expect("read-only constant", ro == "-c default_transaction_read_only=on")
c = ps.legal_conn_env(url("u:pw", "h/db"))
expect("read-only alone", c.get("PGOPTIONS") == ro)
c = ps.legal_conn_env(url("u:pw", "h/db?options=-c%20search_path%3Dx"))
expect("read-only after options", c.get("PGOPTIONS") == "-c search_path=x " + ro)
c = ps.legal_conn_env(url("u:pw", "h/db?options=-c%20default_transaction_read_only%3Doff"))
opts = c.get("PGOPTIONS", "")
expect("read-only beats an 'off' in the URL",
       opts.endswith(ro) and opts.index("default_transaction_read_only=off") < opts.rindex(ro))

# Refusals, none of which may echo the password or the URL.
refused("bad port", url("u:" + SECRET, "h:bad/db"))
refused("port out of range", url("u:" + SECRET, "h:99999/db"))
refused("broken IPv6", url("u:" + SECRET, "[::1/db"))
refused("scheme", url("u:" + SECRET, "h/db", scheme="mysql"))
refused("fragment", url("u:" + SECRET, "h/db#" + SECRET))
refused("unmapped", url("u:" + SECRET, "h/db?foo=1"))
refused("unmapped sslpassword", url("u:" + SECRET, "h/db?sslpassword=" + SECRET))
refused("service (a service file would beat PGOPTIONS)", url("u:" + SECRET, "h/db?service=prod"))
refused("secret as a parameter name", url("u:" + SECRET, "h/db?" + SECRET + "=1"))
refused("repeated", url("u:" + SECRET, "h/db?sslmode=require&sslmode=disable"))
refused("several hosts", url("u:" + SECRET, "h1,h2/db"))
refused("several hosts, encoded comma", url("u:" + SECRET, "h1%2Ch2/db"))
refused("several hosts with ports", url("u:" + SECRET, "h1:5432,h2:5433/db"))
for key, value in (("host", "a,b"), ("host", "a%2Cb"), ("hostaddr", "10.0.0.1,10.0.0.2"), ("port", "5432,5433")):
    refused(f"several in {key}=", url("u:" + SECRET, f"h/db?{key}={value}"))

# P3-5: a parameter with no value is not named (it could be a pasted secret).
refused("no value", url("u:" + SECRET, "h/db?topsecretword"), hidden=(SECRET, "topsecretword"))
refused("no value, mapped name", url("u:" + SECRET, "h/db?sslmode"), hidden=(SECRET, "sslmode"))

if failures:
    for f in failures:
        print(f"FAIL {f}")
    print(f"check-production-setup-pg-env: {len(failures)} failure(s)")
    sys.exit(1)
print("check-production-setup-pg-env: ok")
