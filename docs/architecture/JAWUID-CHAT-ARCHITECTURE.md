# Jawwid Chat — Canonical Architecture

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07)
Companions: `IDENTITY-MODEL.md`, `AUTHORIZATION-MODEL.md`, `SUPERVISOR-OWNERSHIP.md`,
`TENANCY-MODEL.md`, `../security/RLS-STRATEGY.md`, `../contracts/API-CONTRACT.md`,
`../contracts/DOMAIN-VOCABULARY.md`.
Supersedes as architecture: `backend-contract.md`, `decisions.md` (ADR-001/ADR-005 in particular),
`core-integration-contract.md`, `organization-model.md`, `open-contract-decisions.md` — all retained as **REFERENCE**.

---

## 1. The shape

```
        Parent app / Teacher app (Flutter)            Admin Web (React)
                    │  HTTPS + WSS                           │  HTTPS + WSS
                    ▼                                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │                   API  (NestJS, apps/api)                   │
        │   /api/v1 REST  ·  Socket.IO gateway  ·  worker.ts         │
        │                                                            │
        │   Identity & Sessions ──► AuthorizationService ◄── Coverage│
        │            │                        │                      │
        │   Domain services: conversations · messages · approvals    │
        │                    calls · attachments · notifications     │
        │            │                        │                      │
        │   Platform: Audit · Outbox · Realtime · Storage · Config   │
        │            │                                               │
        │   Integration: Jawwid Core boundary (webhook ingestion)    │
        └──────┬───────────────┬────────────────┬───────────────────┘
               │ Prisma (chat) │ Redis          │ signed URLs / SDK
               ▼               ▼                ▼
        ┌────────────┐   ┌──────────┐    ┌────────────────┐   ┌──────────┐
        │ PostgreSQL │   │  Redis   │    │ Object storage │   │ LiveKit  │
        │ schema chat│   │ pub/sub, │    │ (S3/MinIO)     │   │ media    │
        │ + RLS      │   │ presence │    └────────────────┘   └──────────┘
        └────────────┘   └──────────┘
               ▲
        Jawwid Core ──── signed webhooks ────►  API /integration/core/events (to be re-implemented)
        FCM / APNs  ◄─── push provider seam ──  notifications
```

One API. Two clients. One database the API alone talks to. Everything else is a
boundary.

---

## 2. Layers and what each may and may not do

### 2.1 Mobile (Flutter, `lib/`)

MAY: render conversations, compose and send messages, cache for offline reading,
hold a session (access + rotating refresh token) in secure storage, express BR-1
as *UX* (`lib/core/policy/communication_policy.dart`), connect a Socket.IO client.
MUST NOT: access the database, Redis or object storage directly; decide
authorization; compute delivery state; carry a phone number field; hard-code an
environment URL (`JAWWID_API_BASE_URL` is a `--dart-define`, no default).
Today: HTTP transport verified (11 calls); no auth endpoints; no realtime client
(`lib/core/realtime/` empty). Phase 1 adds auth; Phase 2 adds realtime.

### 2.2 Admin Web (React, `apps/admin-web`)

MAY: render the Communication Operations Console; remove affordances by role
(UX only, `core/permissions/capabilities.ts` says so itself); invalidate queries
on realtime signals.
MUST NOT: encode business authorization decisions (one violation recorded:
`TransferOwnershipDialog` filters recipients client-side — moves to the server);
compute workload/attention; call anything but the canonical API.
Today: shares zero endpoints with the API and speaks a brief-era vocabulary.
Reworked in Phase 2 per `docs/recovery/PHASE-0-ADMIN-WEB-RECONCILIATION.md`.

### 2.3 API (NestJS, `apps/api`) — the primary application boundary

MAY and MUST: authenticate every request (Phase 1), resolve the actor, ask
`AuthorizationService` before every read/write/call/approval, map every response
through explicit DTOs, write audit/event rows in the same transaction as the
action, enqueue outbox events in the same transaction, mint media grants and
signed storage URLs, own the realtime rooms.
MUST NOT: let a client name its own identity (RT-001 — the seam is contained by
`platform/identity-seam.ts` and removed in Phase 1); spread a database row into
a response; expose a phone number; return records outside the actor's scope.

Module map (as built):

| Module | Path | Responsibility |
|---|---|---|
| Platform | `src/platform` | Prisma client, IdentityService (actor resolution), AuthorizationService, AuditService, CoverageService, AppConfigService, identity-seam guard |
| Communication | `src/communication/{conversations,messages,approvals,calls,attachments,notifications,outbox,realtime,api,contracts}` | domain services, controllers, DTO/event/vocab contracts |
| Infra | `src/infra/{http,realtime,health}` | security headers, CORS, graceful shutdown, Socket.IO Redis adapter, relay publisher, health probes, build info |
| Integration | *(archived on `archive/phase0/feat/core-integration-boundary`)* | Jawwid Core webhook ingestion — re-implemented in a later phase |
| Entrypoints | `src/main.ts` (API), `src/worker.ts` (outbox drain) | same image, different command |

### 2.4 Database (PostgreSQL 17, schema `chat`)

OWNS: the critical invariants — BR-1 (both the immediate and the deferred
constraint triggers), immutable conversation/call `type`, append-only
`event_log`/`audit_log`, message no-rewrite, monotonic `seq` under row lock,
single idempotency index, owner-change guard, deactivation guard, family scope
(C-2), organization isolation (restrictive RLS).
MUST NOT: be reached by any client, worker or script other than the API and the
migration runner; contain any foreign key or view into another product's tables
(asserted by `db/tests/schema_acceptance.sql`).
Schema authority: `supabase/migrations/*.sql` applied by `scripts/db/apply.sh`.
Prisma is a typed client, never a schema authority (`db push`/`migrate` are
prohibited).

### 2.5 Storage

Attachments live in S3-compatible object storage. The API validates MIME/size,
mints **signed upload URLs** before an object key exists and **signed, expiring
read URLs** per read; the bytes never transit the API. Today
`SignedLocalObjectStorage` signs but nothing serves the bytes and
`STORAGE_ENDPOINT` defaults to a path the API does not serve. Canonical boundary:

```
client ──POST /conversations/:id/messages/attachments/authorize──► API ──► {objectKey, uploadUrl}
client ──PUT bytes──► object storage (signed)
client ──POST message with objectKey──► API (validates, links)
client ◄──MessageDto.attachments[].url (signed, TTL)── API
client ──GET──► object storage (signed)
```

Phase 2 replaces the local signer with the S3/MinIO implementation behind the
same `ObjectStorage` interface and adds object-level authorization to
`signUrlsForMessages` (RT-006).

### 2.6 Realtime

Socket.IO on the **default namespace**, Redis adapter for multi-instance
fan-out, rooms `conversation:<id>` and `actor:<id>` named only by the server.
Contract: `docs/contracts/API-CONTRACT.md` §4. Rules the gateway must keep:

| Concern | Rule | Today |
|---|---|---|
| Authentication | handshake `auth: { token }` verified like HTTP (Phase 1) | `auth.actorId` seam (RT-001, contained) |
| Authorization | `conversation.subscribe` re-runs `AuthorizationService.canRead` on the real conversation + membership; never a client-named room | implemented |
| Room membership | join on subscribe, leave on unsubscribe/membership removal | join/leave implemented; removal-driven eviction Phase 1 |
| Revocation / deactivation | a session revoke or account deactivation disconnects every socket of that actor (`actor:<id>` room) and re-evaluates identity on reconnect (RT-009) | Phase 1 |
| Reconnect | client resumes with `GET …/messages?after=<seq>`; events are at-least-once signals, never state | implemented server-side; Flutter client Phase 2 |
| Tenant isolation | rooms are implicitly tenant-scoped through the conversation; the actor's organization is checked at subscribe (Phase 1) | single tenant |
| Redis fan-out | Socket.IO Redis adapter in the API; the worker publishes through `RelayRealtimePublisher` and fails the outbox row if no API instance received it (D-2) | implemented, tested |

### 2.7 Notifications

Pipeline (canonical; the seams exist, the loop does not yet run):

```
Domain event (outbox)  →  Notification decision (recipient roles, dedupeKey, quiet hours)
   →  Schedule (chat.notification, status scheduled, sendAt)
   →  Queue (worker dispatchDue — NOT WIRED TODAY)
   →  Provider (PushProvider seam; LoggingPushProvider today; FCM/APNs Phase 2)
   →  Device (chat.device_token, multi-device, VoIP for calls)
   →  Delivery / open tracking (POST /notifications/:id/delivered|opened — recipient-scoped in Phase 1)
```

Rules: delivery state is never fabricated (`deliver` keeps `SENT` until a
platform acknowledgement); quiet hours defer, never drop; `dedupeKey` is the
uniqueness guarantee; reminder rules are data (`chat.notification_rule`).
Phase 2 wires `dispatchDue` into the worker loop and a real provider.

### 2.8 Outbox and workers

Transactional outbox: the domain service enqueues in the same transaction as
the change; `worker.ts` polls `OutboxWorker.drain()`.

Delivery semantics (canonical): **at-least-once, never at-most-once.** A row
may be published twice; it must never be lost. The current claim
(`status='published'` *before* `publish()`) is safe only because D-2 made
`publish()` throw when nothing received the event, which returns the row to
`pending`. A crash between the claim and the publish still loses the row. The
correct design, to implement in Phase 1 with a migration:

```
pending ──claim (status=publishing, leased_until=now+lease, attempts+1)──► publishing
publishing ──publish ok──► published (published_at)
publishing ──publish threw──► pending (available_at=backoff) | failed (attempts≥5)
publishing ──lease expired (crash)──► reclaimed by the next drain as pending
```

Consumers must be idempotent on the event id. "Exactly once" is not claimed
anywhere and must not be.

### 2.9 CRM integration boundary (Jawwid Core)

Jawwid Core owns students, parents, teachers, schedules, enrolments,
subscriptions and payments. Chat integrates **only** through a contract:
signed webhooks (`chat.core_event` dedupe on `(source, external_event_id)`),
optional polling through `chat.sync_state`, mirrored facts carrying
`core_*_id` + `synced_at`, conflicts resolved in favour of Core. Never a
database link, view, or foreign key into Core. The reference contract
(`core-integration-contract.md`) is sound and is re-implemented against the
canonical schema in a later phase; the archived code is on
`archive/phase0/feat/core-integration-boundary`.

---

## 3. Cross-cutting rules

1. **One decision point.** `AuthorizationService` is the only place an access
   decision is made. Guards authenticate; services authorize; the database
   backstops. Scattered `if (role === …)` checks are defects.
2. **Explicit DTOs.** Every response is built field by field in
   `contracts/dto.ts` or an equivalent explicit mapper. No spreads.
3. **No contact channels.** No phone/email column, field or claim anywhere;
   enforced by `test/unit/privacy/no-contact-channel-columns.spec.ts`.
4. **Audit in-transaction.** A sensitive action and its audit row commit
   together or not at all; reasons are mandatory.
5. **Migrations are history.** Never edited; superseded by a later migration.
6. **Protected tests** (`docs/qa/protected-tests.tsv`) are removed only by a
   reviewed change to that file, with the invariant re-protected elsewhere.
7. **Environment safety.** A build that still carries a bring-up seam refuses
   to start outside `local | test | ci`.

---

## 4. Verified state of each boundary (2026-09-07)

| Boundary | Verified by | Result |
|---|---|---|
| Empty DB → 22 migrations → gates | `scripts/db/integration-db.sh reset && verify` | PASS |
| API typecheck / unit / integration | `npm run typecheck`, `test:unit` (104), `test:int` (77 + 4 realtime) | PASS |
| Admin Web typecheck / tests | `npm run typecheck`, `npx vitest run` (74) | PASS |
| Flutter tests | `flutter test` with the local SDK | see `PHASE-0-REPORT.md` §11 |
| API boots and answers HTTP | `/health/live`, `/health/ready` (recorded by AI #9/AI #10 on the same tree) | PASS (not re-run in Phase 0) |
| Mobile / Admin Web against the live API | — | **NOT exercised** |
| Realtime end to end with a client | — | **NOT exercised** (relay path unit/integration-tested only) |
