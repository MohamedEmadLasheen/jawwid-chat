#!/usr/bin/env bash
# Jawwid Chat -- HTTP smoke test against a RUNNING API.
#
# Service-layer tests do not prove the API is integrated. This drives the real
# server over HTTP: boot, health, security headers, authentication, BR-1,
# idempotency, approval containment, and LiveKit token authorization.
#
#   API_URL=http://localhost:3999 scripts/smoke/api-smoke.sh
set -uo pipefail

A="${API_URL:-http://localhost:3999}"
PSQL="${PSQL:-docker exec -i jawwid-ai2-audit psql -q -t -A -U postgres -d jawwid_audit}"
ADMIN=50000000-0000-0000-0000-000000000001
MANAGER=50000000-0000-0000-0000-000000000003
PARENT=c0000000-0000-0000-0000-000000000001
TEACHER=70000000-0000-0000-0000-000000000001
LEARNER=10000000-0000-0000-0000-000000000001

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then printf '  ok    %-58s %s\n' "$1" "$3"; pass=$((pass+1));
  else printf '  FAIL  %-58s expected=%s got=%s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
jqf()  { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo "ERR"; }

echo "== liveness =="
check "GET /health/live" 200 "$(code "$A/health/live")"
check "GET /health/ready" 200 "$(code "$A/health/ready")"
check "database probe up" up "$(curl -s "$A/health/ready" | jqf "d['checks']['database']['status']")"

echo "== security headers (AI #7) =="
H=$(curl -s -D- -o /dev/null "$A/health/live")
check "X-Content-Type-Options" nosniff "$(echo "$H" | grep -i '^x-content-type-options' | tr -d '\r' | awk '{print $2}')"
check "frame-ancestors none" present "$(echo "$H" | grep -qi "frame-ancestors 'none'" && echo present || echo missing)"

echo "== authentication =="
check "no actor header -> 401" 401 "$(code "$A/conversations")"
check "malformed actor id -> 401" 401 "$(code -H 'x-actor-id: not-a-uuid' "$A/conversations")"

echo "== BR-1 =="
check "teacher<->parent direct -> 403" 403 \
  "$(code -X POST "$A/conversations/direct" -H 'content-type: application/json' -H "x-actor-id: $TEACHER" -d "{\"withActorId\":\"$PARENT\"}")"
check "BR-1 error code" COMM.BR1_TEACHER_PARENT_DIRECT \
  "$(curl -s -X POST "$A/conversations/direct" -H 'content-type: application/json' -H "x-actor-id: $TEACHER" -d "{\"withActorId\":\"$PARENT\"}" | jqf "d['error']['code']")"

echo "== direct conversation + idempotency =="
CONV=$(curl -s -X POST "$A/conversations/direct" -H 'content-type: application/json' -H "x-actor-id: $PARENT" -d "{\"withActorId\":\"$ADMIN\"}" | jqf "d['id']")
KEY="smoke-$RANDOM"
M1=$(curl -s -X POST "$A/conversations/$CONV/messages" -H 'content-type: application/json' -H "x-actor-id: $PARENT" -d "{\"type\":\"text\",\"body\":\"smoke\",\"clientMessageId\":\"$KEY\"}" | jqf "d['id']")
M2=$(curl -s -X POST "$A/conversations/$CONV/messages" -H 'content-type: application/json' -H "x-actor-id: $PARENT" -d "{\"type\":\"text\",\"body\":\"smoke\",\"clientMessageId\":\"$KEY\"}" | jqf "d['id']")
check "retry returns the same message" "$M1" "$M2"
check "non-member read -> 403" 403 "$(code -H "x-actor-id: $TEACHER" "$A/conversations/$CONV/messages")"

echo "== student group + approval containment =="
GRP=$(curl -s -X POST "$A/conversations/student-group" -H 'content-type: application/json' -H "x-actor-id: $MANAGER" -d "{\"learnerId\":\"$LEARNER\"}" | jqf "d['id']")
check "group created" ok "$([ -n "$GRP" ] && [ "$GRP" != ERR ] && echo ok || echo missing)"
check "teacher message held" pending \
  "$(curl -s -X POST "$A/conversations/$GRP/messages" -H 'content-type: application/json' -H "x-actor-id: $TEACHER" -d '{"type":"text","body":"homework"}' | jqf "d['moderation']")"
check "parent cannot see pending body" absent \
  "$(curl -s "$A/conversations/$GRP/messages" -H "x-actor-id: $PARENT" | jqf "'present' if any(m['body']=='homework' for m in d['messages']) else 'absent'")"
check "approver sees it queued" 1 \
  "$(curl -s "$A/approvals/pending" -H "x-actor-id: $MANAGER" | jqf "len(d['approvals'])")"

echo "== calling =="
CALL=$(curl -s -X POST "$A/calls" -H 'content-type: application/json' -H "x-actor-id: $MANAGER" -d "{\"conversationId\":\"$GRP\"}")
CID=$(echo "$CALL" | jqf "d['callId']")
check "participant gets a token" True \
  "$(curl -s -X POST "$A/calls/$CID/token" -H "x-actor-id: $TEACHER" | jqf "bool(d.get('token'))")"
check "non-participant refused" 403 "$(code -X POST "$A/calls/$CID/token" -H "x-actor-id: $ADMIN")"

echo "== workers actually run =="
sleep 3
check "outbox drained" 0 "$($PSQL -c "select count(*) from chat.outbox_event where status='pending'" | tr -d '[:space:]')"
check "notifications produced" yes \
  "$([ "$($PSQL -c 'select count(*) from chat.notification' | tr -d '[:space:]')" -gt 0 ] && echo yes || echo no)"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
