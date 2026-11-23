#!/usr/bin/env bash
# Does scripts/infra/db-firewall.sh open and close only its own rule, stay dormant
# when it should, explain a missing token scope, and never print the token or the
# runner's address? doctl is stubbed by a rules file in a temporary directory (no
# network, no credential). Also checks that every workflow that connects to the
# production database wires the open and close steps in the right order.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FW="$ROOT/scripts/infra/db-firewall.sh"
FAILED=0
ok()   { echo "  ok  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

SB="$(mktemp -d "${TMPDIR:-/tmp}/jawwid-dbfw.XXXXXX")"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/bin"
TOKEN="dop_v1_secrettokenvalue0123456789"
RUNNER_IP="203.0.113.77"
NOW="$(python3 -I -c 'import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
OLD="2026-01-01T00:00:00Z"

# doctl stub: databases firewalls list|append|remove against $SB/rules.json
cat > "$SB/bin/doctl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
R="$STUB_RULES"
[ "${STUB_DENY:-}" = "1" ] && { echo "Error: GET https://api.digitalocean.com/v2/databases/x/firewall: 403 (request \"abc\") You are not authorized to perform this operation" >&2; exit 1; }
if [ "$1 $2" = "databases get" ]; then echo "[{\"id\":\"c\",\"engine\":\"${STUB_ENGINE:-pg}\"}]"; exit 0; fi
[ "$1 $2" = "databases firewalls" ] || exit 2
op="$3"; shift 3
case "$op" in
  list) cat "$R" ;;
  append)
    shift; rule="$2"; t="${rule%%:*}"; v="${rule#*:}"
    python3 -I - "$R" "$t" "$v" <<'PY'
import json,sys,uuid,datetime
p,t,v=sys.argv[1:4]
rs=json.load(open(p)); rs.append({"uuid":str(uuid.uuid4()),"cluster_uuid":"c","type":t,"value":v,"created_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
json.dump(rs,open(p,"w"))
PY
    echo '[]' ;;
  remove)
    shift; [ "$1" = "--uuid" ] && u="$2"
    python3 -I - "$R" "$u" <<'PY'
import json,sys
p,u=sys.argv[1:3]
json.dump([r for r in json.load(open(p)) if r["uuid"]!=u],open(p,"w"))
PY
    ;;
esac
STUB
chmod +x "$SB/bin/doctl"
# curl stub: the runner's address
cat > "$SB/bin/curl" <<STUB
#!/usr/bin/env bash
echo "$RUNNER_IP"
STUB
chmod +x "$SB/bin/curl"

export PATH="$SB/bin:$PATH" STUB_RULES="$SB/rules.json" DB_FIREWALL_STATE="$SB/state" \
       DIGITALOCEAN_ACCESS_TOKEN="$TOKEN" FIREWALL_SETTLE_SECONDS=0 RUNNER_TEMP="$SB"
APP='{"uuid":"app-1","type":"app","value":"APP123","created_at":"'$OLD'"}'
rules() { echo "[$1]" > "$STUB_RULES"; }
run() { DATABASE_CLUSTER_ID="${CL-cluster}" bash "$FW" "$@" 2>&1; }
count() { python3 -I -c "import json;print(len(json.load(open('$STUB_RULES'))))"; }
has_ip() { python3 -I -c "import json;print(any(r['value']=='$RUNNER_IP' for r in json.load(open('$STUB_RULES'))))"; }

# 1. dormant without a cluster id: nothing listed, nothing added, close is a no-op
rules "$APP"; out="$(CL= run open)"
[ "$(count)" = 1 ] && echo "$out" | grep -q "dormant" && ok "dormant without DATABASE_CLUSTER_ID" || fail "dormant without DATABASE_CLUSTER_ID"
out="$(CL= run close)"; [ "$(count)" = 1 ] && ok "close after a dormant open is a no-op" || fail "close after dormant"

# 2. open database (no rules): skipped, and crucially NOT closed by adding a rule
echo '[]' > "$STUB_RULES"; out="$(run open)"
[ "$(count)" = 0 ] && echo "$out" | grep -q "open to every address" && ok "no rules: skipped, no rule added" || fail "no rules: must not add a rule"
run close >/dev/null; [ "$(count)" = 0 ] && ok "no rules: close is a no-op" || fail "no rules: close"

# 3. restricted database: open adds the runner, close removes only it
rules "$APP"; out="$(run open)"
[ "$(count)" = 2 ] && [ "$(has_ip)" = "True" ] && ok "open adds this runner's address" || fail "open adds the runner"
out2="$(run close)"
[ "$(count)" = 1 ] && [ "$(has_ip)" = "False" ] && grep -q APP123 "$STUB_RULES" && ok "close removes only the runner's rule, the app rule stays" || fail "close removes only its rule"
[ ! -f "$DB_FIREWALL_STATE" ] && ok "state file removed after close" || fail "state file removed"

# 4. nothing printed that is secret
echo "$out$out2" | grep -q "$TOKEN" && fail "the token was printed" || ok "the token is never printed"
echo "$out$out2" | grep -q "$RUNNER_IP" && echo "$out$out2" | grep -v "::add-mask::" | grep -q "$RUNNER_IP" && fail "the runner address was printed" || ok "the runner address is only ever in ::add-mask::"

# 5. an address that was already a rule is borrowed, never removed by us
rules "$APP,{\"uuid\":\"u-mine\",\"type\":\"ip_addr\",\"value\":\"$RUNNER_IP\",\"created_at\":\"$NOW\"}"
run open >/dev/null; run close >/dev/null
[ "$(count)" = 2 ] && ok "an already-present rule is borrowed, not removed" || fail "borrowed rule removed"

# 6. a cancelled run that wrote PENDING before the change is still cleaned up
rules "$APP,{\"uuid\":\"u-x\",\"type\":\"ip_addr\",\"value\":\"$RUNNER_IP\",\"created_at\":\"$NOW\"}"
echo "PENDING $RUNNER_IP" > "$DB_FIREWALL_STATE"; run close >/dev/null
[ "$(count)" = 1 ] && [ "$(has_ip)" = "False" ] && ok "PENDING state is cleaned up" || fail "PENDING cleanup"

# 7. never removes another rule: state names an address not in the list -> nothing removed
rules "$APP"; echo "ADDED u-gone 198.51.100.9" > "$DB_FIREWALL_STATE"; run close >/dev/null
[ "$(count)" = 1 ] && ok "a rule it did not add is never removed" || fail "removed a foreign rule"

# 8. never removes the last rule (that would open the database)
rules "{\"uuid\":\"u-only\",\"type\":\"ip_addr\",\"value\":\"$RUNNER_IP\",\"created_at\":\"$NOW\"}"
echo "ADDED u-only $RUNNER_IP" > "$DB_FIREWALL_STATE"; out="$(run close || true)"
[ "$(count)" = 1 ] && echo "$out" | grep -q "only remaining" && ok "refuses to remove the last rule" || fail "last rule removed"
rm -f "$DB_FIREWALL_STATE"

# 9. a token without database scope: a clear explanation, not a mystery
rules "$APP"; out="$(STUB_DENY=1 run open || true)"
echo "$out" | grep -q "database:read and database:update" && ok "missing scope is explained" || fail "missing scope not explained"
echo "$out" | grep -q "$TOKEN" && fail "token in scope error" || ok "no token in the scope error"
out="$(DIGITALOCEAN_ACCESS_TOKEN= run open || true)"; echo "$out" | grep -q "DIGITALOCEAN_ACCESS_TOKEN is not available" && ok "configured but no token: refuses clearly" || fail "no-token message"

# 9b. only a PostgreSQL cluster is ever touched: a Valkey (or any other) cluster id is refused,
# for open, close and audit, and its rules are left exactly as they were
rules "$APP"; before="$(cat "$STUB_RULES")"
for m in open audit; do
  out="$(STUB_ENGINE=valkey run $m || true)"
  echo "$out" | grep -q "engine is 'valkey', not 'pg'" && [ "$(cat "$STUB_RULES")" = "$before" ] && ok "$m refuses a non-pg cluster and changes nothing" || fail "$m on a non-pg cluster"
done
echo "ADDED u-x 198.51.100.9" > "$DB_FIREWALL_STATE"; out="$(STUB_ENGINE=valkey run close || true)"
echo "$out" | grep -q "not 'pg'" && [ "$(cat "$STUB_RULES")" = "$before" ] && ok "close refuses a non-pg cluster and changes nothing" || fail "close on a non-pg cluster"
rm -f "$DB_FIREWALL_STATE"
STUB_ENGINE=pg run audit >/dev/null && ok "a pg cluster is accepted" || fail "pg cluster accepted"

# 10. audit
rules "$APP"; run audit >/dev/null && ok "audit passes with only the app rule" || fail "audit app only"
rules "$APP,{\"uuid\":\"u-stray\",\"type\":\"ip_addr\",\"value\":\"192.0.2.1\",\"created_at\":\"$OLD\"}"
out="$(run audit || true)"; echo "$out" | grep -q "u-stray" && ! echo "$out" | grep -q "192.0.2.1" && ok "audit fails on a stray rule without printing its address" || fail "audit stray"
rules "$APP,{\"uuid\":\"u-new\",\"type\":\"ip_addr\",\"value\":\"192.0.2.2\",\"created_at\":\"$NOW\"}"
run audit >/dev/null && ok "audit tolerates a fresh runner rule (a job in flight)" || fail "audit grace"
rules "$APP,{\"uuid\":\"u-home\",\"type\":\"ip_addr\",\"value\":\"192.0.2.3\",\"created_at\":\"$OLD\"}"
DATABASE_FIREWALL_ALLOW="192.0.2.3" run audit >/dev/null && ok "audit accepts an owner-allowed address" || fail "audit allow"
rules "{\"uuid\":\"u-1\",\"type\":\"ip_addr\",\"value\":\"192.0.2.4\",\"created_at\":\"$NOW\"}"
DATABASE_FIREWALL_APP_ID=APP123 run audit >/dev/null && fail "audit must fail when the app is not a rule" || ok "audit fails when the app is not a Trusted Source"
echo '[]' > "$STUB_RULES"; run audit >/dev/null && ok "audit: no rules is only a notice by default" || fail "audit empty default"
DATABASE_FIREWALL_ENFORCE=true run audit >/dev/null && fail "audit enforce must fail on empty" || ok "audit: no rules fails once enforcement is on"
rules "$APP"; DATABASE_FIREWALL_APP_ID=OTHER run audit >/dev/null && fail "other app must fail" || ok "audit fails on a different app rule"

# 11. workflow wiring: every workflow that uses the production database opens first and always closes
python3 -I - "$ROOT" <<'PY' || FAILED=1
import re,sys,os
root=sys.argv[1]
wf=['deploy-production.yml','production-terms-config.yml','review-cohort.yml','backup-daily.yml','backup-weekly.yml']
bad=0
for f in wf:
    s=open(os.path.join(root,'.github/workflows',f)).read()
    steps=re.split(r'\n      - ',s)
    idx_open=[i for i,t in enumerate(steps) if 'db-firewall.sh open' in t]
    idx_close=[i for i,t in enumerate(steps) if 'db-firewall.sh close' in t]
    first_db=[i for i,t in enumerate(steps) if re.search(r'psql|backup-db\.sh|preflight-role-capability|load-quran|production-setup\.py legal|Provision the review cohort',t) and 'db-firewall.sh' not in t]
    if not (len(idx_open)==1 and len(idx_close)==1): print('  FAIL  %s: expected exactly one open and one close step'%f); bad=1; continue
    if not first_db or idx_open[0]>min(first_db): print('  FAIL  %s: open must come before the first database step'%f); bad=1
    if idx_close[0]<max(first_db): print('  FAIL  %s: close must come after the last database step'%f); bad=1
    if 'if: always()' not in steps[idx_close[0]]: print('  FAIL  %s: close must be if: always()'%f); bad=1
    for i in (idx_open[0],idx_close[0]):
        if 'DIGITALOCEAN_ACCESS_TOKEN' not in steps[i] or 'DATABASE_CLUSTER_ID' not in steps[i]: print('  FAIL  %s: a step lacks the token or cluster id env'%f); bad=1
    if not bad: print('  ok  %s: open before the first database step, close (always) after the last'%f)
if os.path.exists(os.path.join(root,'.github/workflows/db-firewall-audit.yml')):
    print('  ok  db-firewall-audit.yml present')
else:
    print('  FAIL  db-firewall-audit.yml missing'); bad=1
sys.exit(bad)
PY

[ "$FAILED" = 0 ] && echo "db-firewall: all checks passed" || { echo "db-firewall: FAILED"; exit 1; }
