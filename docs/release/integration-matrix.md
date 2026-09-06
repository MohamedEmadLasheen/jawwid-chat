# Jawwid Chat — Integration Matrix

Owner: AI #10 · Date: 2026-09-05
Status vocabulary (§52): **PASS** · **FAIL** · **BLOCKED** · **NOT TESTED** · **UNVERIFIED** · **KNOWN RISK**

**`VERIFIED` means AI #10 executed both sides of the integration.** A contract
that exists on one side only is never `VERIFIED`, however well written. Nothing
in this matrix is `PASS` today, because no integration has both sides running.

---

## 1. Application integrations

| # | Producer | Consumer | Contract | Verified | Failure Tested | Status |
|---|---|---|---|---|---|---|
| I-1 | Admin Web | API (HTTP `/api/v1`, cookie session) | `endpoints.ts` (34+ paths) + `docs/admin/backend-contract-required.md` | ❌ | ❌ | **FAIL** — 0 of 34+ implemented; backend exposes 3 `/health` routes and no prefix (RC-05) |
| I-2 | Flutter (parent) | API (HTTP, Bearer + refresh) | `api_client.dart`; `docs/mobile/backend-dependencies.md` | ❌ | ❌ | **FAIL** — no endpoints; auth scheme differs from I-1 (RC-03/RC-05) |
| I-3 | Flutter (teacher) | API | same | ❌ | ❌ | **FAIL** — teacher cannot authenticate at all (JC-003) |
| I-4 | Admin Web | Realtime (socket.io `/staff`) | `core/realtime/events.ts`, 11 events | ❌ | ❌ | **FAIL** — wrong namespace, disjoint names, incompatible payloads, CORS `origin:false` (RC-04) |
| I-5 | Flutter | Realtime | assumed; no client wiring exists | ❌ | ❌ | **NOT TESTED** |
| I-6 | API | Realtime gateway | `contracts/events.ts`, 11 events + `room()` helpers | ❌ | ❌ | **BLOCKED** — gateway registered in no module; never instantiated (RC-01) |
| I-7 | API | Outbox table | `OutboxService.enqueue` inside the domain transaction | ✅ write side | ❌ | **FAIL** — no consumer exists (RC-02) |
| I-8 | Outbox | Realtime publisher | `RealtimePublisher` interface | ❌ | ❌ | **FAIL** — nothing drains the outbox |
| I-9 | Outbox | Notification pipeline | `Notification`, `NotificationRule`, `dedupeKey` | ❌ | ❌ | **FAIL** — tables only; no worker, no provider client |
| I-10 | Notification worker | FCM / APNs | env vars declared in the manifest | ❌ | ❌ | **NOT TESTED** — no code |
| I-11 | API | PostgreSQL | Prisma client | ❌ | ❌ | **FAIL** — targets `public`; authority is `chat` (RC-06) |
| I-12 | Migrations | PostgreSQL | `apply.sh` + `chat.schema_migrations` | ⚠️ CI applies + asserts idempotency | ❌ | **UNVERIFIED** — CI proves apply and re-apply, but against a database seeded with a **Core shim that must be deleted** (DB-5); no app starts against it |
| I-13 | API | Redis (socket.io adapter, BullMQ) | wired "in main.ts" | ❌ | ❌ | **BLOCKED** — no `main.ts`; 0 BullMQ imports |
| I-14 | API | Object storage (S3/MinIO/R2) | `object-storage.ts`, `attachment.service.ts` | ⚠️ unit only | ❌ | **UNVERIFIED** — red-team exercises it at the service layer; never against a live bucket |
| I-15 | API | LiveKit | — | ❌ | ❌ | **NOT TESTED** — calling is `DESIGN-ONLY` (JC-001) |
| I-16 | Jawwid Chat | **Jawwid Core** | **integration boundary — API/webhook** per `database-decision.md` D-6 | ❌ | ❌ | **FAIL** — no client, no webhook receiver, no contract. Current code assumes **database co-tenancy**, which is now prohibited (DB-1…DB-6) |
| I-17 | Deploy pipeline | Container runtime | `Dockerfile` `CMD node dist/main.js` | ❌ | ❌ | **FAIL** — the build never emits `main.js`; the image crash-loops (RC-01) |
| I-18 | Deploy pipeline | Worker | `node dist/worker.js` | ❌ | ❌ | **FAIL** — no worker source |
| I-19 | CI | Repository | `.github/workflows/ci.yml` | ✅ workflow exists | n/a | **UNVERIFIED** — never observed executing on a push; the API job runs a suite that is green **only because the BR-1 cases are `it.todo`** |
| I-20 | Backup | PostgreSQL | `backup-db.sh` / `restore-db.sh` | ❌ | ❌ | **NOT TESTED** — never rehearsed (G-41) |
| I-21 | API | Error monitoring / traces | `SENTRY_DSN`, `OTEL_*` required in staging + production | ❌ | ❌ | **FAIL** — 0 imports in `apps/api/src`; required config with no consumer (RC-11) |

## 2. Cross-cutting policy integrations

| # | Integration | Contract | Verified | Failure Tested | Status |
|---|---|---|---|---|---|
| P-1 | All surfaces → `AuthorizationService` | "No controller, gateway, or worker may make its own access decision" | ⚠️ service layer only | ✅ adversarially, at the service layer | **UNVERIFIED** — the contract is right and there are no controllers yet to violate it |
| P-2 | Messaging **and** calling → one policy | charter §13, JC-002 | ❌ | ❌ | **FAIL** — calling is unimplemented; the policy cannot express conversation kind (RT-002) |
| P-3 | Realtime subscribe → same policy as REST | `thread.subscribe` calls `canReadThread` | ✅ code path correct | ❌ | **UNVERIFIED** — correct by construction, downstream of a forged identity (RC-03) |
| P-4 | Phone privacy by construction | `Actor` has no phone/email/address; `Contact` has no phone column; DTOs enumerate fields explicitly | ✅ **executing test**: `test/unit/privacy/no-contact-channel-columns.spec.ts` | ✅ red-team probed | **PASS at the model layer** — the strongest control in the codebase. Still `NOT TESTED` across call setup, push payloads, search and logs, which do not exist |
| P-5 | BR-1 server-side enforcement | `BR1-01…BR1-20` | ❌ **23 cases are `it.todo`** | ❌ | **NOT TESTED** — declared, not written (JC-002) |
| P-6 | `on_duty()` sole authority for acting on a family | charter §16, G-44 | ⚠️ partial | ✅ JC-005 fixed and re-verified | **UNVERIFIED** — fail-closed for admin/coverage; **manager attribution still client-chosen** (RT-003); the real assist predicate is unimplemented |
| P-7 | Ownership changes only via `transfer_ownership()` | SQL guards + in-transaction audit | ⚠️ SQL tests exist on an unmerged branch | ❌ | **BLOCKED** — the engine is not on the branch that could run it |
| P-8 | Idempotency, client → server | `X-Idempotency-Key` (mobile) vs `Idempotency-Key` (admin) | ❌ | ❌ | **FAIL** — two header names, no server implementation |

---

## 3. What this matrix says about release readiness

Of 29 integrations: **0 PASS end-to-end**, 1 PASS at a single layer (P-4), 12 FAIL,
4 BLOCKED, 8 UNVERIFIED, 4 NOT TESTED.

The pattern is consistent and worth stating plainly: **the individual components
are largely well built, and almost nothing is connected.** Six components pass
their own checks in isolation — Admin Web builds, the API typechecks, the SQL
engines have real tests, phone privacy is enforced by construction, the outbox
write side is correct, the env gate works. Not one of them has been observed
working *with* another. That is the exact condition §3 of the release charter
exists to catch.

The single highest-leverage item remains **RC-01**. Fourteen rows in this matrix
change from `BLOCKED`/`NOT TESTED` to testable the moment the application boots.
