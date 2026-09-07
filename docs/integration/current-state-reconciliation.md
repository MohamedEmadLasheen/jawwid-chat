> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Current-state reconciliation

Auditor: AI #2 · Date: 2026-09-06 · **Verification only — no implementation.**
Method: isolated worktree at the current tip, dedicated container
`jawwid-recon-pg` (stock `postgres:17`), executable probes. Older reports and
commit messages were not trusted; every claim below was re-run.

## 1 · Current HEAD and branch

| | |
|---|---|
| Branch (de facto integration line) | `feat/infrastructure` |
| HEAD | `0270f05` — *docs(mobile): record the verified HTTP integration and the auth blocker* |
| Migrations in tree | **19** |
| `main` | `eeca866` (empty init, 48 behind) — **not** the integration line |

## 2 · Branch topology

Measured against HEAD.

| Branch | Merge-base | Commits not in HEAD | Carries |
|---|---|---|---|
| `feat/backend-foundation` (AI #1) | `ebbbc93` | **7** | standalone identity/database refactor |
| `feat/core-integration-boundary` | `c0d755a` | **10** | Core boundary ratification |
| `ai4/p1-canonical-foundation` | `03d4119` | **1** | **`organization_id` on every root entity (PRD §2.3)** |
| `fix/ai8-p0-blockers` | `03d4119` | **1** | **JWT auth (NF-08), RT-025, RT-024 call bypass** |
| `feat/ai7-runtime-fixes` | `7e0c6a3` | **2** | outbox published only if delivered |
| `integration/prd-reconciliation` | `7e0c6a3` | **2** | domain conformance plan |
| `integration/od-01-reconciliation` | `03d4119` | **2** | OD-01 type assertion |
| `integration/ai2-audit` (AI #2) | `71e55cc` | **3** | BR-1 hardening, worker scheduler, 401 guard |
| `feat/communication-engine` | `be77391` | 0 | fully merged |

**Two branches independently fix the same two findings.** `fix/ai8-p0-blockers`
adds `20260906090100_chat_student_group_owner_presence` and
`20260906090200_chat_call_type_immutable`; `integration/ai2-audit` adds
`20260905093300_chat_br1_hardening`. Merging both would apply two overlapping
sets of triggers to the same tables. **One must be chosen before either merges.**

## 3 · Migration-from-zero evidence

Executed against a brand-new `postgres:17` database, **no stubs, no fixtures**:

```
PSQL="docker exec -i jawwid-recon-pg psql -v ON_ERROR_STOP=1 -U postgres -d recon" \
  bash scripts/db/apply.sh
→ all 19 migrations applied
→ re-run: 0 re-applied (idempotent)
→ 39 tables in schema `chat`
```

The stubs in `db/integration/` are **no longer required** — this is stronger than
the previous audit, where they were. RT-023 is genuinely closed on this line.

## 4 · API runtime evidence

Boots. `apps/api/src/main.ts` and `app.module.ts` exist at the tip (`7e0c6a3`).

- `GET /health/live` → **200**
- Routes are served under a **global prefix `/api/v1`** (new since the published
  contracts, which document unprefixed paths — see §10/§11).
- `POST /api/v1/conversations/direct` → 201; `POST …/messages` → 201.
- **No worker runs.** Zero scheduler lines in the boot log; `chat.outbox_event`
  sat at **2 pending** and never drained. `WorkerScheduler` exists only on
  `integration/ai2-audit`.
- **Unauthenticated request → 500, not 401.** Empty and malformed `x-actor-id`
  both reach Prisma (P2023) and surface as a server error. The guard exists only
  on `integration/ai2-audit`.

## 5 · Authentication evidence

| Check | Current tip |
|---|---|
| `chat.account` | **exists** — `id, subject, kind, is_active, created_at, updated_at` |
| `chat.account.subject` | **exists**, unique, opaque token subject |
| `chat.session` | **absent** |
| `chat.credential` | **absent** |
| AuthGuard | **none** — no `CanActivate` anywhere in `apps/api/src` |
| JWT | **none** — no `jwt`/`Bearer` reference in `apps/api/src` |
| `x-actor-id` | **the only HTTP identity**, read verbatim in `actor.decorator.ts` |
| WebSocket handshake | `client.handshake.auth.actorId`, **verbatim, unverified** |

There is no user authentication on the integration line. Any caller may assert
any actor id over HTTP and over the socket. The Core→Chat integration boundary
is a *service* boundary and is explicitly **not** user authentication.

**RT-001: OPEN.** JWT verification exists only on `fix/ai8-p0-blockers`, unmerged.

## 6 · Teacher identity evidence

| Hop | State |
|---|---|
| Core teacher identifier | **not defined in any Core payload contract found** |
| `chat.teacher` | **absent** |
| `chat.account.kind` | `CHECK (kind = ANY (ARRAY['staff','family']))` — **no `teacher`** |
| Authenticated subject for a teacher | impossible — no account kind to hold it |
| Teacher App | cannot authenticate |

Resolution today is a stub: `PrismaIdentityService` treats any id appearing in
`chat.learner.teacher_id` as a teacher, with no name, locale or active flag.

**This is a contract blocker, not just a schema gap.** Core does not publish a
teacher identifier or a teacher-assignment event, so even adding
`kind='teacher'` would have nothing to key on. The missing contract element must
come from Core before the chain can be closed.

**C-1: OPEN.**

## 7 · `organization_id` evidence

```sql
select table_name from information_schema.columns
 where table_schema='chat' and column_name='organization_id';
→ (none)
select table_name from information_schema.tables
 where table_schema='chat' and table_name like '%organi%';
→ (none)
```

Absent from all 39 tables. PRD §2.3 tenancy is **unimplemented on this line**.
It exists on `ai4/p1-canonical-foundation` (1 commit, unmerged).

**Schema-foundation blocker: OPEN.** Retrofitting a tenancy key across 39 tables
after data exists is materially harder than before, so this gates the others.

## 8 · Core boundary evidence

The ADR-004 violation is gone: `20260905090900` no longer creates `chat.core_*`
views over another product's `public` schema. It now materialises Core-sourced
facts into Chat-owned tables keyed by `core_*_id`, with idempotent upserts.
Present: `sync_state`, `sync_health`, `core_event`, `core_parent_inbox`.

Chat queries no other database. **Boundary: sound in shape.** Its payload
contract does not yet carry a teacher identifier (§6).

## 9 · Realtime evidence

Proved with a real Socket.IO client, not by inspecting the worker.

```
conversation created ......................... ok
websocket connected .......................... true
conversation.subscribe (immediately) ......... {"ok":false,"code":"COMM.UNKNOWN_ACTOR"}
conversation.subscribe (after 1.5s settle) ... {"ok":true}
POST /api/v1/…/messages ...................... 201
events received by the connected client ...... 0
chat.outbox_event ............................ 2 pending, never drained
```

**REALTIME: UNVERIFIED — and demonstrably not delivering**, for two independent
reasons:

1. **No worker drains the outbox** on this line, so nothing reaches the transport.
2. **Handshake race (new finding).** `handleConnection` is `async`, and Socket.IO
   does not await it before dispatching frames. A client that subscribes
   immediately on `connect` — the natural implementation — is rejected with
   `COMM.UNKNOWN_ACTOR` even though the same actor works over HTTP. It succeeds
   only if the client happens to wait. This is a race, not a permission error,
   and it will present as an intermittent "cannot subscribe" bug.

## 10 · Admin Web ↔ API contract comparison

| | |
|---|---|
| Base path expected | `/api/v1` — **matches** |
| Auth expected | **cookie session** (`credentials: 'include'`, `/auth/login`, `/auth/logout`) |
| Auth exposed | `x-actor-id` header |

Endpoints Admin calls that the API **does not expose**: `/auth/login`,
`/auth/logout`, `/inbox`, `/inbox/away-summary`, `/families`,
`/families/{id}/messages`, `/cases/{id}`, `/config`, `/coverage/{rules,shifts,absences,gaps,tonight}`,
`/dashboard/{header,team-now,needs-action,this-week,unattended}`.

Endpoints the API exposes that Admin calls: **none.**

Realtime — Admin expects 11 events, the API emits 19, overlap is **2**
(`message.created`, `presence.changed`):

- Expected by Admin, emitted by nobody: `case.updated`, `coverage.changed`,
  `escalation.created`, `family.updated`, `handoff.created`, `ownership.changed`,
  `shift.ending`, `task.updated`, `unattended.changed` (all AI #1 ops-domain).
- Emitted, unconsumed by Admin: `approval.*`, `call.*`, `reaction.*`, `typing.*`,
  `conversation.updated`, `conversation.membership_changed`, `message.deleted`,
  `message.receipt.updated`, `notification.created`.

**Conformance defect:** Admin's routing still records `/approvals` and `/calls`
as "in no part of the product brief" and leaves them unbuilt. PRD v0.1 requires
both. The superseded PDF is being treated as authority; it is not.

## 11 · Flutter ↔ API contract comparison

| | |
|---|---|
| Base path | configurable (`JAWWID_API_BASE_URL`); must include `/api/v1` |
| Auth expected | `Authorization: Bearer` **with refresh**, plus an explicit `x-actor-id` stopgap that documents itself as temporary |
| Auth exposed | `x-actor-id` only |

Endpoints — mostly aligned: `/conversations`, `/conversations/{id}`,
`/conversations/{id}/messages`, `…/messages/read`, `…/messages/unread`,
`…/preferences` all exist.

**One path mismatch:** Flutter calls `'/messages/{messageId}/reactions'`; the API
exposes `/conversations/{conversationId}/messages/{messageId}/reactions`.

**Realtime: not implemented in Flutter.** `web_socket_channel` is declared in
`pubspec.yaml` but no file uses it. Note that it is a **raw WebSocket** client
while the server is **Socket.IO**, which is a protocol on top of WebSocket — a
raw client cannot speak it. This is a transport decision that has not been made,
not merely unfinished wiring.

Three components, three different auth mechanisms: header (API), cookie (Admin),
bearer (Flutter). None interoperate today.

## 12 · Finding status

| Finding | Status | Evidence |
|---|---|---|
| **RT-023** empty database | **VERIFIED CLOSED** | 19/19 applied to an empty `postgres:17`, no stubs; idempotent re-run |
| **RT-024** conversation mutation | **VERIFIED CLOSED** | `update … set type='direct'` on a teacher+parent group → refused, BR-1 violation |
| **RT-024** call mutation | **OPEN** | `update chat.call set type='direct'` on a group call with `{teacher, contact}` → **ALLOWED** |
| **RT-025** Student Group admin invariant | **OPEN** | all three variants **ALLOWED**: group with `{teacher,parent}` and no admin; removing the last admin; `class_group` with `{teacher,parent}` |
| **RT-001** authentication | **OPEN** | no guard, no JWT, `x-actor-id` verbatim on HTTP and socket |
| **C-1** teacher identity | **OPEN** (contract blocker) | `account.kind` is `staff|family`; no `chat.teacher`; no Core teacher identifier |
| **organization_id** | **OPEN** | absent from all 39 tables |
| **Core integration boundary** | **VERIFIED CLOSED (shape)** | no cross-database views; materialised, idempotent, `core_*_id`-keyed |
| **Prisma migration authority** | **VERIFIED CLOSED** | `apps/api/prisma/` has `schema.prisma` only, no `migrations/`; 50 mapping directives. SQL is authoritative |
| **Admin/API contract** | **OPEN** | zero endpoint overlap; auth mechanisms differ |
| **Flutter/API contract** | **OPEN** | one path mismatch; no realtime; auth mismatch |
| **Realtime worker delivery** | **UNVERIFIED / not delivering** | connected client received 0 events; outbox 2 pending |
| RT-003, RT-004, RT-005, RT-007, RT-008, RT-026, JC-008 | **STALE** | fixed in merged commits; re-verified in the previous audit and unchanged here |
| RT-027 (suite uncompilable) | **STALE** | suite compiles and runs |

Nothing was downgraded because code exists; RT-024-call and RT-025 have fixes
written on unmerged branches and are still reported **OPEN**, because the
integration line does not have them.

## 13 · Can the integration line build independently?

**Yes, for database + API + tests. No, for a working product.**

A fresh checkout of `feat/infrastructure` gives: empty PostgreSQL → all 19
migrations (no other branch needed) → API builds and boots → tests run. That
property holds today and is the one genuine improvement since the last audit.

It does **not** give a working system: no authentication, no worker, no realtime
delivery, no tenancy.

Required from unmerged branches, with the exact commits:

| Need | Branch | Commit |
|---|---|---|
| Tenancy (`organization_id`) | `ai4/p1-canonical-foundation` | `f9f3eca` |
| Authentication + RT-024-call + RT-025 | `fix/ai8-p0-blockers` | `80765dc` |
| Outbox delivery semantics | `feat/ai7-runtime-fixes` | `4b2d3a5` |
| Worker scheduler, 401 guard, BR-1 hardening | `integration/ai2-audit` | `950e2a3`, `8f43064` |

## 14 · Test-integrity conflicts (reported, not edited)

**File:** `apps/api/test/integration/schema-invariants.spec.ts` — **owned by AI #5.**

- Line ~76: *"allows a teacher and a parent to share a GROUP conversation"* builds
  `class_group` + `addMember(teacher)` + `addMember(parent)` with **no admin**.
- Line ~92: the JC-008 test builds the same no-admin shape.

**Conflict:** both fixtures encode the pre-RT-025 contract. Once the admin-presence
invariant merges — from either `fix/ai8-p0-blockers` or `integration/ai2-audit` —
these inserts are refused and both tests fail at setup.

**Not edited here.** AI #5 owns them; the fixtures need one `addMember(id,'staff','admin')`
and the member-count assertion updated from 2 to 3.

## 15 · Recommended dependency order

Each step is blocked by the one above it.

1. **Choose one RT-024/RT-025 fix.** Two branches implement it; decide before
   either merges, or the same triggers land twice. *(Owner: release control.)*
2. **Merge `organization_id` first.** It touches every root table; every later
   migration is cheaper before it than after. *(AI #4 → AI #1.)*
3. **Merge authentication.** Unblocks Admin, Flutter and the WebSocket handshake
   at once, and is the precondition for any honest E2E. *(AI #8 → AI #1.)*
4. **Fix the Core teacher contract, then teacher identity.** Core must publish a
   teacher identifier and assignment event; then `account.kind='teacher'` and
   `chat.teacher`. Until step 4, BR-1's *permitted* path cannot be exercised.
5. **Merge the worker + outbox delivery semantics, then re-prove realtime** with
   a connected client. Also fix the `handleConnection` race (§9).
6. **Decide the Flutter realtime transport** — Socket.IO client, or a raw-WebSocket
   gateway. This is a decision, not a task.
7. **Reconcile the Admin contract against PRD v0.1**, treating its use of the
   superseded PDF as the defect it is.
8. **Update AI #5's fixtures** (§14), by AI #5.
9. Only then: E2E across API + Admin + Flutter.
