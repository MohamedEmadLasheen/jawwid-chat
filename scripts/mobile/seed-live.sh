#!/usr/bin/env bash
# Seed the minimum rows the mobile live-integration suite needs, and print the
# environment it wants.
#
# Owner: AI #3 (mobile). Touches test data only -- never application code.
#
# Synthetic identities only (QA gate G-16): no real staff names, no real
# schedules, no real phone numbers. There is no phone column to populate.
#
# NOTE: this defaults to the QA integration database, which `npm run test:int`
# truncates. If a peer runs the backend integration suite, these rows disappear
# and the live suite fails with COMM.UNKNOWN_ACTOR -- just re-run this script.
#
#   scripts/mobile/seed-live.sh > /tmp/jawwid-live.env
#   set -a; . /tmp/jawwid-live.env; set +a
#   flutter test test/integration/live_backend_test.dart
set -euo pipefail

CONTAINER="${PG_CONTAINER:-jawwid-chat-int}"
DB="${PG_DATABASE:-jawwid_chat_int}"
API="${JAWWID_LIVE_API:-http://127.0.0.1:3100/api/v1}"

uuid() { uuidgen | tr 'A-Z' 'a-z'; }

ADMIN="$(uuid)"; FAMILY="$(uuid)"; PARENT="$(uuid)"
LEARNER="$(uuid)"; TEACHER="$(uuid)"; THREAD="$(uuid)"

# ORDER MATTERS. chat.thread must exist BEFORE any conversation is created:
# POST /conversations/direct snapshots thread_id at creation time, and a
# conversation created with a null thread_id can never accept a message -- the
# chat.assert_message_author_exists() trigger rejects every send. See
# docs/mobile/http-integration.md defect B3.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" >/dev/null <<SQL
insert into chat.staff (id, name, role, is_active)
  values ('$ADMIN'::uuid, 'admin_live', 'admin', true);
insert into chat.family (id, display_name, owner_id, language)
  values ('$FAMILY'::uuid, 'family_live', '$ADMIN'::uuid, 'ar');
insert into chat.thread (id, family_id)
  values ('$THREAD'::uuid, '$FAMILY'::uuid);
insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
  values ('$PARENT'::uuid, '$FAMILY'::uuid, 'parent_live', 'primary_guardian', true, true);
insert into chat.learner (id, family_id, name, teacher_id)
  values ('$LEARNER'::uuid, '$FAMILY'::uuid, 'learner_live', '$TEACHER'::uuid);
SQL

# The conversation is created through the API, not by SQL, so it is built the
# way the product builds it -- including its BR-1 checks and membership rows.
CONV="$(curl -sS -X POST "$API/conversations/direct" \
  -H "x-actor-id: $PARENT" -H 'Content-Type: application/json' \
  -d "{\"withActorId\":\"$ADMIN\"}" |
  /usr/bin/python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"

cat <<ENV
export JAWWID_LIVE_API="$API"
export JAWWID_LIVE_PARENT="$PARENT"
export JAWWID_LIVE_ADMIN="$ADMIN"
export JAWWID_LIVE_TEACHER="$TEACHER"
export JAWWID_LIVE_CONVERSATION="$CONV"
ENV
