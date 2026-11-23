#!/usr/bin/env bash
# Temporary, self-removing access to the production database's Trusted Sources
# for ONE GitHub-hosted runner. Docs: docs/infrastructure/backup-recovery.md §9.
#
#   scripts/infra/db-firewall.sh open    # add this runner's public IP, remember exactly what was added
#   scripts/infra/db-firewall.sh close   # remove ONLY that rule (run it with `if: always()`)
#   scripts/infra/db-firewall.sh audit   # fail if any rule is neither the app, an allowed IP, nor a fresh runner rule
#
# Why: once the cluster admits only the App Platform app, a GitHub runner (whose
# IP changes every run) cannot reach it. Each job that connects to the production
# database therefore opens its own IP for the length of its database steps.
#
# Environment
#   DATABASE_CLUSTER_ID           the DigitalOcean database cluster id (a variable, not a secret).
#                                 UNSET = the feature is dormant: open/close do nothing, so merging
#                                 this changes nothing until the owner sets it.
#   DIGITALOCEAN_ACCESS_TOKEN     needs database:read and database:update (the firewall endpoints)
#   DATABASE_FIREWALL_APP_ID      audit only: the App Platform app id that must be a rule (optional)
#   DATABASE_FIREWALL_ALLOW       audit only: comma-separated IPs/CIDRs the owner allows permanently
#   DATABASE_FIREWALL_ENFORCE     audit only: "true" turns "no rules at all (open to everyone)" into a failure
#   DATABASE_FIREWALL_GRACE_MIN   audit only: minutes a runner rule may live before it is a stray (default 90)
#   FIREWALL_SETTLE_SECONDS       wait after adding a rule (default 15)
#
# Never printed: the token, the runner's IP (it is also ::add-mask::ed), any connection string.
# Never done: adding a rule to an EMPTY list (the first rule would close the database to everyone
# else, which is the owner's deliberate step), removing an app rule, removing a rule it did not add,
# or removing the last remaining rule (that would open the database to everyone).
set -euo pipefail

MODE="${1:-}"
DOCTL="${DOCTL:-doctl}"
STATE="${DB_FIREWALL_STATE:-${RUNNER_TEMP:-/tmp}/db-firewall.state}"
SETTLE="${FIREWALL_SETTLE_SECONDS:-15}"
GRACE_MIN="${DATABASE_FIREWALL_GRACE_MIN:-90}"
CLUSTER="${DATABASE_CLUSTER_ID:-}"

note()  { echo "::notice title=Database firewall::$1"; }
fatal() { echo "::error title=Database firewall::$1"; exit 1; }

# Print only the first line of a doctl error, with the token removed.
scrub() { local t="${DIGITALOCEAN_ACCESS_TOKEN:-}"; local l; l="$(printf '%s' "$1" | head -n1)"; [ -n "$t" ] && l="${l//$t/***}"; printf '%s' "$l"; }

ensure_doctl() {
  if ! command -v "$DOCTL" >/dev/null 2>&1; then
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$here/install-doctl.sh" >/dev/null
    export PATH="${RUNNER_TEMP:-$PWD}/bin:$PATH"
  fi
}

# load_rules: sets $rules to the cluster's rules (a JSON array); exits with a clear message on failure.
# (Not run in a subshell: an exit inside $(...) would be swallowed.)
load_rules() {
  local out err rc=0
  err="$(mktemp)"
  out="$("$DOCTL" databases firewalls list "$CLUSTER" -o json 2>"$err")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    local msg; msg="$(scrub "$(cat "$err")")"; rm -f "$err"
    case "$msg" in
      *401*|*403*|*orbidden*|*nauthorized*|*"not authorized"*|*"permission"*)
        fatal "The DigitalOcean token cannot read this database's Trusted Sources. It needs the custom scopes database:read and database:update (see docs/infrastructure/backup-recovery.md §9). DigitalOcean said: $msg" ;;
      *) fatal "Could not list the database's Trusted Sources ($msg). Check DATABASE_CLUSTER_ID." ;;
    esac
  fi
  rm -f "$err"
  [ -n "$out" ] || out='[]'
  rules="$out"
}

# py <json> <program>: tiny JSON helper, no dependencies beyond python3.
py() { python3 -I -c "$2" <<<"$1"; }

# require_pg: this helper manages the PostgreSQL cluster's Trusted Sources and nothing else. A
# DATABASE_CLUSTER_ID that names another engine (for example the Valkey cluster, whose rule must
# stay "this app only", ADR-015) is refused before any rule is read or changed.
require_pg() {
  local out err rc=0 engine
  err="$(mktemp)"
  out="$("$DOCTL" databases get "$CLUSTER" -o json 2>"$err")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    local msg; msg="$(scrub "$(cat "$err")")"; rm -f "$err"
    case "$msg" in
      *401*|*403*|*orbidden*|*nauthorized*|*"not authorized"*|*"permission"*)
        fatal "The DigitalOcean token cannot read the database cluster. It needs the custom scopes database:read and database:update (see docs/infrastructure/backup-recovery.md §9). DigitalOcean said: $msg" ;;
      *) fatal "Could not read the database cluster ($msg). Check DATABASE_CLUSTER_ID." ;;
    esac
  fi
  rm -f "$err"
  engine="$(py "$out" 'import json,sys
d=json.load(sys.stdin)
d=d[0] if isinstance(d,list) and d else d
print(d.get("engine","") if isinstance(d,dict) else "")')"
  [ "$engine" = "pg" ] || fatal "DATABASE_CLUSTER_ID names a cluster whose engine is '${engine:-unknown}', not 'pg'. This helper only manages the PostgreSQL cluster's Trusted Sources and will not touch any other cluster (the Valkey cluster's rule must stay 'this app only'). Nothing was changed."
}

runner_ip() {
  local ip=""
  for url in ${IP_PROBE_URLS:-https://checkip.amazonaws.com https://api.ipify.org}; do
    ip="$(curl -fsS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]')" || ip=""
    if printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then printf '%s' "$ip"; return 0; fi
  done
  return 1
}

case "$MODE" in
open)
  umask 077
  rm -f "$STATE"
  if [ -z "$CLUSTER" ]; then
    echo SKIPPED > "$STATE"; note "DATABASE_CLUSTER_ID is not set: runner access is not managed here (dormant)."; exit 0
  fi
  [ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || fatal "DATABASE_CLUSTER_ID is set but DIGITALOCEAN_ACCESS_TOKEN is not available to this job. Add the token (database:read + database:update) to this GitHub Environment, or unset DATABASE_CLUSTER_ID."
  ensure_doctl
  require_pg
  load_rules
  count="$(py "$rules" 'import json,sys;print(len(json.load(sys.stdin)))')"
  if [ "$count" = "0" ]; then
    echo SKIPPED > "$STATE"; note "The database has no Trusted Sources (open to every address); nothing to add. Adding a rule would close it to everyone else, so this job leaves it alone."; exit 0
  fi
  ip="$(runner_ip)" || fatal "Could not determine this runner's public IPv4 address."
  echo "::add-mask::$ip"
  present="$(py "$rules" "import json,sys
ip='$ip'
print(any(r.get('type')=='ip_addr' and r.get('value') in (ip, ip+'/32') for r in json.load(sys.stdin)))")"
  if [ "$present" = "True" ]; then
    echo BORROWED > "$STATE"; note "This runner's address is already a Trusted Source (another job); it will not be removed by this job."; exit 0
  fi
  echo "PENDING $ip" > "$STATE"                       # recorded BEFORE the change, so a cancel in between is still cleaned up
  err="$(mktemp)"
  "$DOCTL" databases firewalls append "$CLUSTER" --rule "ip_addr:$ip" >/dev/null 2>"$err" \
    || fatal "Could not add this runner as a Trusted Source ($(scrub "$(cat "$err")")). The token needs database:update."
  rm -f "$err"
  load_rules
  uuid="$(py "$rules" "import json,sys
ip='$ip'
m=[r['uuid'] for r in json.load(sys.stdin) if r.get('type')=='ip_addr' and r.get('value') in (ip, ip+'/32')]
print(m[0] if m else '')")"
  [ -n "$uuid" ] || fatal "The rule was added but is not listed; refusing to continue."
  echo "ADDED $uuid $ip" > "$STATE"
  sleep "$SETTLE"
  note "This runner is a temporary Trusted Source until the close step."
  ;;

close)
  [ -f "$STATE" ] || { note "Nothing to close (no state)."; exit 0; }
  read -r kind a b < "$STATE" || true
  case "$kind" in
    SKIPPED|BORROWED|"") rm -f "$STATE"; note "Nothing to close ($kind)."; exit 0 ;;
    ADDED)   uuid="$a"; ip="$b" ;;
    PENDING) uuid="";   ip="$a" ;;
    *) rm -f "$STATE"; fatal "Unrecognised state; refusing to remove anything." ;;
  esac
  [ -n "$ip" ] && echo "::add-mask::$ip"
  ensure_doctl
  require_pg
  load_rules
  target="$(py "$rules" "import json,sys
uuid,ip='$uuid','$ip'
rs=json.load(sys.stdin)
m=[r for r in rs if r.get('type')=='ip_addr' and r.get('value') in (ip, ip+'/32') and (not uuid or r.get('uuid')==uuid)]
print(m[0]['uuid'] if m else '')")"
  if [ -z "$target" ]; then rm -f "$STATE"; note "The runner's rule is already gone."; exit 0; fi
  total="$(py "$rules" 'import json,sys;print(len(json.load(sys.stdin)))')"
  if [ "$total" -le 1 ]; then
    fatal "Refusing to remove the only remaining Trusted Source: that would open the database to every address. Remove it by hand after adding the App Platform app (rule uuid $target)."
  fi
  err="$(mktemp)"
  "$DOCTL" databases firewalls remove "$CLUSTER" --uuid "$target" >/dev/null 2>"$err" \
    || fatal "Could not remove this runner's Trusted Source (rule uuid $target): $(scrub "$(cat "$err")"). Remove it by hand; the audit will also flag it."
  rm -f "$err"
  load_rules
  gone="$(py "$rules" "import json,sys
print(all(r.get('uuid')!='$target' for r in json.load(sys.stdin)))")"
  [ "$gone" = "True" ] || fatal "The runner's rule is still listed after removal (rule uuid $target)."
  rm -f "$STATE"
  note "The temporary Trusted Source was removed."
  ;;

audit)
  [ -n "$CLUSTER" ] || { note "DATABASE_CLUSTER_ID is not set: audit is dormant."; exit 0; }
  [ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || fatal "DATABASE_CLUSTER_ID is set but no DIGITALOCEAN_ACCESS_TOKEN is available to the audit."
  ensure_doctl
  require_pg
  load_rules
  verdict="$(APP_ID="${DATABASE_FIREWALL_APP_ID:-}" ALLOW="${DATABASE_FIREWALL_ALLOW:-}" GRACE="$GRACE_MIN" ENFORCE="${DATABASE_FIREWALL_ENFORCE:-}" \
    python3 -I -c '
import json,os,sys,datetime
rs=json.load(sys.stdin)
app=os.environ["APP_ID"]; allow={x.strip() for x in os.environ["ALLOW"].split(",") if x.strip()}
grace=float(os.environ["GRACE"]); enforce=os.environ["ENFORCE"]=="true"
now=datetime.datetime.now(datetime.timezone.utc)
bad=[]; app_ok=False
for r in rs:
    t=r.get("type"); v=r.get("value",""); u=r.get("uuid","?")
    if t=="app":
        if not app or v==app: app_ok=True
        else: bad.append("rule %s: an app other than the production app" % u)
        continue
    if t=="ip_addr" and (v in allow or (v+"/32") in allow or v.split("/")[0] in allow): continue
    ts=r.get("created_at","")
    try: age=(now-datetime.datetime.fromisoformat(ts.replace("Z","+00:00"))).total_seconds()/60
    except Exception: age=1e9
    if t=="ip_addr" and age<=grace: continue
    bad.append("rule %s (%s, created %s) is not the app, not allowed and older than %d minutes" % (u,t,ts or "unknown",grace))
msgs=list(bad)
if rs and not app_ok: msgs.append("the production app is not a Trusted Source: the API and worker would lose the database when they reconnect")
if not rs and enforce: msgs.append("there are no Trusted Sources: the database accepts connections from every address")
print("\n".join(msgs))
' <<<"$rules")" || fatal "The audit could not evaluate the Trusted Sources (unexpected data); treat as failed."
  if [ -n "$verdict" ]; then
    while IFS= read -r l; do echo "::error title=Database firewall audit::$l"; done <<<"$verdict"
    exit 1
  fi
  if [ "$(py "$rules" 'import json,sys;print(len(json.load(sys.stdin)))')" = "0" ]; then
    note "No Trusted Sources yet (open); set DATABASE_FIREWALL_ENFORCE=true once the database is restricted."
  else
    note "Trusted Sources are as expected."
  fi
  ;;

*) echo "usage: db-firewall.sh open|close|audit" >&2; exit 2 ;;
esac
