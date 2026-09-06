# Runtime Integration — what runs, what does not, and why

Owner: AI #7 · Date: 2026-09-06
Method: a real stack was started and driven over real HTTP and a real WebSocket.
Nothing below is inferred from reading code.

**Status: LOCAL RUNTIME — PARTIAL.** The API boots and serves the communication
domain end to end. It is not usable by Admin Web, and it is not deployed.

## 1. What was proven to work

Clean Postgres 17 → 18 SQL migrations (no Core shim, no `public.*`, no
`auth.uid()`) → Redis → NestJS API → HTTP → WebSocket → outbox worker.

| # | Check | Result |
|---|---|---|
| 1 | Migrations apply to a clean Chat-owned database | ✅ 46 tables, 69 config rows |
| 2 | API boots, 32 routes under `/api/v1` | ✅ |
| 3 | `/health/live`, `/health/ready` | ✅ database and redis `up` |
| 4 | Identity resolves for staff, contact, teacher | ✅ |
| 5 | **BR-1: teacher → parent direct refused** | ✅ 403 `COMM.BR1_TEACHER_PARENT_DIRECT` |
| 6 | **BR-1: parent → teacher direct refused** | ✅ 403, same code |
| 7 | Parent ↔ admin direct conversation | ✅ created |
| 8 | WebSocket connect + authorized subscribe | ✅ |
| 9 | Subscribe to an unauthorized conversation | ✅ refused server-side |
| 10 | Parent sends message | ✅ 201 |
| 11 | Message persisted and readable by admin | ✅ |
| 12 | Realtime `message.created` delivered | ✅ *(only in-process — see D-2)* |
| 13 | Read receipts / unread count | ✅ |
| 14 | Admin approval queue readable | ✅ |
| 15 | Parent cannot read the approval queue | ✅ 403 |
| 16 | Student group (the permitted teacher↔parent path) | ✅ teacher, parent, admin all members |
| 17 | Call session creation | ✅ 201 |

22 of 22 assertions pass **with the D-1 fix applied to a scratch database**.

## 2. Defects found by running it

### D-1 · Messages cannot be sent at all — **P0, blocks everything**

*Owner: AI #1 (migration authority).*

`chat.assert_message_author_exists()`, defined in
`20260905090400_chat_conversation_domain.sql`, validates a contact author
against the family of `chat.thread`:

```sql
and c.family_id = (select family_id from chat.thread where id = new.thread_id)
```

Every message written through the **conversation** model has `thread_id = NULL`,
so the subselect is NULL, the comparison is NULL, `NOT EXISTS` is true, and the
trigger raises:

```
message author 3333… is not a contact on this family's thread   (SQLSTATE 23503)
```

The API surfaces this as **HTTP 500**. It is the legacy `thread` model and the
new `conversation` model colliding — the divergence AI #8 tracks, reaching the
runtime.

Proposed fix (**not committed — `chat.*` is AI #1's authority**), verified
against a scratch database:

```sql
create or replace function chat.assert_message_author_exists()
returns trigger language plpgsql as $$
declare fam uuid;
begin
  select coalesce(
           (select family_id from chat.conversation where id = new.conversation_id),
           (select family_id from chat.thread       where id = new.thread_id))
    into fam;
  if new.author_type = 'staff'
     and not exists (select 1 from chat.staff s where s.id = new.author_id) then
    raise exception 'message author % is not a staff member', new.author_id
      using errcode = 'foreign_key_violation';
  elsif new.author_type = 'contact'
     and not exists (select 1 from chat.contact c
                     where c.id = new.author_id and c.family_id = fam) then
    raise exception 'message author % is not a contact on this family', new.author_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end; $$;
```

Second gap in the same function: `author_type = 'teacher'` is **not validated at
all** — it falls through every branch. A teacher author is currently unchecked.

### D-2 · Realtime events are silently dropped when the worker is a separate process — **P0**

*Owner: AI #2, with AI #7.*

`RealtimeGateway.publish()` emits via `this.server?.to(...)`. In the worker —
started with `createApplicationContext`, which has no HTTP server — `server` is
`undefined`, so **the optional chain makes the emit a no-op and the outbox row is
still marked `published`**. Events are lost with no error anywhere.

Measured, same code and same event, twice:

| Drain runs in | Outbox row | Client received |
|---|---|---|
| standalone `worker.js` | `published` | **nothing** |
| the process owning the Socket.IO server | `published` | `message.created` ✅ |

This makes the documented API/worker split (ADR-004) currently **unsafe**: it
looks healthy and delivers nothing. Options, cheapest first:

1. Run the drain inside the API process for now — proven to work, no new
   dependency, no horizontal-scaling story.
2. Give the worker a Redis emitter (`@socket.io/redis-emitter`) so it publishes
   into the same Redis rooms the API serves. Correct long-term, adds a dependency.
3. Have the worker mark rows published only after a delivery path confirms it.

Until one lands, **do not run `worker.js` as the only drain**.

### D-3 · An empty actor id returns 500 instead of 401 — P2

*Owner: AI #1.* `ActorId` yields `''`, which reaches
`prisma.staff.findUnique({ where: { id: '' } })` and Prisma raises
`Error creating UUID, invalid length: expected 32, found 0`. Unauthenticated
requests should be rejected as unauthorized, not crash. Reject a missing or
malformed actor id before it reaches the database.

### D-4 · The gateway assigns `client.actor` after `connect` fires — P2

*Owner: AI #2.* `handleConnection` resolves the actor asynchronously, so a
client that emits immediately on `connect` races it and gets
`COMM.UNKNOWN_ACTOR`. Reproduced on the first attempt; a 500 ms delay makes it
pass. Real clients will hit this intermittently — worst on a fast local network,
which is exactly where it will not be noticed. Buffer or reject-and-retry until
the socket is authenticated.

### D-5 · Admin Web cannot talk to this API at all — **P0 for AI #4/#1**

Every endpoint Admin Web calls returns **404**. There is no overlap between what
it needs and what exists:

| Admin Web calls | API provides |
|---|---|
| `/auth/login`, `/auth/logout`, `/me`, `/me/duty`, `/config`, `/inbox`, `/families`, `/staff`, `/tasks`, `/dashboard/*`, `/coverage/*` | `/conversations`, `/approvals`, `/calls`, `/notifications` |

All ten probed endpoints returned 404. The contract in
`docs/admin/backend-contract-required.md` is still "proposed, awaiting sign-off"
and is unimplemented. Admin Web cannot be pointed at the real backend until the
platform surface (auth, identity, inbox, coverage, dashboard) exists.

### D-6 · There is no authentication — **P0 for staging**

*Owner: AI #1.* Identity is the documented seam: HTTP reads `x-actor-id`, the
socket reads `handshake.auth.actorId`. There is no login, no token, no session.

Authorization is genuinely enforced — every service re-resolves the actor and
runs the matrix, so a forged header cannot exceed that actor's permissions — but
**anyone can claim to be any actor**. This is acceptable for local development
and is precisely why the stack must not be exposed publicly in this state.

### D-7 · RLS needs roles that a Chat-owned database does not create — P2

*Owner: AI #1.* `20260905091200_chat_rls.sql` grants to `authenticated`, `anon`
and `service_role`. On a clean Postgres these do not exist and the migration
fails with `role "authenticated" does not exist`. Provisioned here as database
roles (they are provisioning, not schema), but the RLS design assumes a
PostgREST-style deployment where clients connect to Postgres directly. In the
actual architecture — clients → NestJS → Postgres — the API connects as one
role, so these policies do not currently constrain anything unless the API sets
the role and claims per request. Worth an explicit decision.

## 3. Missing configuration found by booting

`STORAGE_SIGNING_SECRET` is **required** — the API refuses to start without at
least 32 characters, which is correct behaviour. It was absent from the
environment contract. Added, with `OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE` and
`OUTBOX_IDLE_BACKOFF_MS`, to `infra/env/manifest.tsv`.

## 4. How to run it locally

```bash
docker run -d --name chat-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=jawwid_chat -p 55500:5432 postgres:17-alpine
docker run -d --name chat-redis -p 6399:6379 redis:7-alpine --appendonly yes

# RLS roles (see D-7)
docker exec -i chat-pg psql -U postgres -d jawwid_chat -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;"

PSQL="docker exec -i chat-pg psql -v ON_ERROR_STOP=1 -U postgres -d jawwid_chat" \
  bash scripts/db/apply.sh

cd apps/api && npx prisma generate && npm run build
DATABASE_URL='postgresql://postgres:postgres@localhost:55500/jawwid_chat?schema=chat' \
REDIS_URL='redis://localhost:6399' \
STORAGE_SIGNING_SECRET='local-development-attachment-signing-secret-0123456789' \
CORS_ALLOWED_ORIGINS='http://localhost:5174' \
  node dist/main.js
```

Then `curl localhost:3000/health/ready`. Sending a message additionally requires
the D-1 fix.

## 5. Status

| Layer | State |
|---|---|
| **Local runtime** | 🟡 PARTIAL — API, DB, Redis, realtime, worker run; blocked by D-1 and D-2 |
| **Staging runtime** | 🔴 NOT STARTED — **BLOCKED: hosting credentials/provider required** |
| **Production readiness** | 🔴 NOT READY — see `production-readiness.md` |

Also blocked: **Flutter cannot be verified.** `pubspec.yaml` now exists, but no
Flutter or Dart SDK is installed on this host, so neither a device build nor
Flutter Web can be compiled or run. No claim is made about the mobile clients.
