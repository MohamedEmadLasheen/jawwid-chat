#!/usr/bin/env bash
# Isolated audit database: stubs + the FULL reconciled migration set + seed.
# Deliberately its own container so a peer resetting a shared one cannot destroy
# an audit mid-run (which happened once during this audit).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
C=${JAWWID_AUDIT_CONTAINER:-jawwid-ai2-audit}
DB=${JAWWID_AUDIT_DB:-jawwid_audit}
PORT=${JAWWID_AUDIT_PORT:-55440}

if ! docker ps --format '{{.Names}}' | grep -qx "$C"; then
  docker rm -f "$C" >/dev/null 2>&1 || true
  docker run -d --name "$C" -e POSTGRES_PASSWORD=postgres -p "$PORT":5432 postgres:17 >/dev/null
  for _ in $(seq 1 60); do docker exec "$C" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
fi

# Terminate stragglers (a previously booted API holds connections).
docker exec -i "$C" psql -q -U postgres -d postgres \
  -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB'" >/dev/null 2>&1 || true
docker exec -i "$C" psql -q -U postgres -d postgres -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
for f in "$ROOT"/db/integration/*.sql; do docker exec -i "$C" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" < "$f" >/dev/null; done
PSQL="docker exec -i $C psql -v ON_ERROR_STOP=1 -U postgres -d $DB" bash "$ROOT/scripts/db/apply.sh" >/dev/null

docker exec -i "$C" psql -q -U postgres -d "$DB" >/dev/null <<'SQL'
insert into chat.account (id, subject, kind) values
 ('a0000000-0000-0000-0000-000000000001','staff-admin-a','staff'),
 ('a0000000-0000-0000-0000-000000000002','family-parent-p','family'),
 ('a0000000-0000-0000-0000-000000000003','staff-manager-c','staff') on conflict do nothing;
insert into chat.staff (id, account_id, name, role, is_active) values
 ('50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','admin_a','admin',true),
 ('50000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003','manager_c','manager',true) on conflict do nothing;
insert into chat.family (id, display_name, owner_id, language) values
 ('f0000000-0000-0000-0000-000000000001','family_x','50000000-0000-0000-0000-000000000001','ar') on conflict do nothing;
insert into chat.contact (id, family_id, account_id, name, role_preset, can_message, is_active) values
 ('c0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','parent_p','primary_guardian',true,true) on conflict do nothing;
insert into chat.learner (id, family_id, name, teacher_id) values
 ('10000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','learner_l','70000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into chat.thread (id, family_id) values
 ('20000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001') on conflict do nothing;
SQL
echo "audit db ready: postgres://postgres:postgres@localhost:$PORT/$DB"
