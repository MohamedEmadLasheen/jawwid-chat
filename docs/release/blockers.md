# Jawwid Chat — Release Blocker Register

Owner: AI #10 · Opened 2026-09-05 · Last verified: 2026-09-05
Severity: **BLOCKER** · **HIGH RISK** · MEDIUM RISK · LOW RISK · KNOWN ACCEPTED RISK · FUTURE IMPROVEMENT
Status: OPEN · IN PROGRESS · **FIXED** (fix landed, author-verified) · **VERIFIED** (AI #10 re-executed the evidence) · WONTFIX

Rules for this register:
- A blocker is removed only when a **verification method executed by AI #10** passes. Not when an agent reports it fixed.
- `NOT TESTED` is never `PASS`. An absent control and an unverified control are graded identically.
- A blocker is never removed for being inconvenient or late.

`RC-*` are AI #10's. `JC-*` are AI #5's. `RT-*` are AI #9's. `DB-*` are consequences of `database-decision.md`.

---

## Verified fixed since reconnaissance

| ID | Title | Verification executed by AI #10 | Result |
|---|---|---|---|
| **JC-005** | `requestedMode: ASSIST`/`ESCALATION` bypassed `on_duty()` | Read `authorization.service.ts:148-176`; ran `npx jest --selectProjects unit`. Both branches now `deny()` with `ASSIST_NOT_PERMITTED` / `ESCALATION_NOT_PERMITTED`. Original assertions are **intact and un-weakened** (checked line by line) | **VERIFIED FIXED** — for ADMIN/COVERAGE. The MANAGER branch is still open as **RT-003** |
| **JC-006** | `canReadInternal()` ignored `isActive` | Read `authorization.service.ts:74-80`; suite green | **VERIFIED FIXED** |

Test suite as of this verification: **7 suites, 39 passed, 23 todo, 0 failed.**
The 23 `it.todo` are the BR-1 conformance cases (`BR1-01…BR1-20`), correctly
declared and **not yet written**. Jest reports them separately from passes; they
are `NOT TESTED` and are tracked under JC-002.

---

## PRD v0.1 — AVAILABLE + AUTHORITATIVE (2026-09-06)

`docs/product/jawwid-chat-prd-v0.1.md` · sha256
`3e63ec0127470b53b65f154651ab707b915771f3ca305a85c4374b9e60a1b697` · 69,331 bytes
· commit `62ff312`.

**This file governs Jawwid Chat.** `docs/JAWWID_CHAT_BRIEF.pdf` is superseded and
retained only as a historical artifact. `docs/qa/authoritative-scope.md` §3 served
as the operative written record and is now **secondary** to the PRD; where the two
differ, the PRD wins and the difference is recorded as a finding.

RC-13 is closed. **No other blocker changes status as a result** — the PRD makes
the remaining work gradeable, it does not perform it.

---

## BLOCKERS

### RC-01 · The API process does not exist
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | Backend bootstrap / deployment |
| **Owner** | **AI #1** (bootstrap, auth wiring) with **AI #7** (container, boot guards) |
| **Status** | OPEN |
| **Evidence** | No `apps/api/src/main.ts`; no root `AppModule`. `HealthModule` and `PlatformModule` are defined and **never imported** by anything. `RealtimeGateway` is registered in no module. `npm start` and `Dockerfile CMD` both run `node dist/main.js`, which the build never emits (`ls apps/api/dist` — no `main.js`). The worker command `node dist/worker.js` has no source at all. Independently confirmed by AI #9, who states the environmental constraint at the top of `findings.md`. |
| **Impact** | The production image builds successfully and then crash-loops. **Every runtime gate in the release charter is unexecutable**, and every downstream verification — E2E, security, red team transport attacks, chaos, recovery, performance — is blocked on this one item. |
| **Exact fix** | Add `src/main.ts`: root module importing `PlatformModule`, `HealthModule` and the realtime gateway; Redis adapter for socket.io; global route prefix matching the client contract; CORS from `CORS_ALLOWED_ORIGINS`; validation pipe; graceful shutdown honouring `SHUTDOWN_GRACE_MS`. Add `src/worker.ts` as a second entrypoint on the same image (per the Dockerfile's stated ADR-004). |
| **Acceptance criteria** | 1. `docker build apps/api && docker run` reaches a steady running state and stays up. 2. `GET /health/live` → 200. 3. `GET /health/ready` → 503 with Postgres down, 200 with it up. 4. `SIGTERM` drains in-flight work and exits 0 within `SHUTDOWN_GRACE_MS`. 5. The container `HEALTHCHECK` reports healthy. |
| **Verification method** | AI #10 builds the image and executes all five, capturing output into `e2e-report.md`. Not accepted on a code diff. |

### RC-02 · The outbox has no consumer
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | Realtime + notification pipeline |
| **Owner** | **AI #2** |
| **Status** | OPEN |
| **Evidence** | `OutboxService` only inserts rows. `grep -rn "bullmq\|new Worker\|new Queue" apps/api/src` → **0 hits**, despite `bullmq` being a declared dependency. Nothing anywhere reads `outbox_event`. |
| **Impact** | Every `message.created`, `thread.updated`, receipt update, reaction and notification is written to a table nothing reads. **Realtime fan-out and the entire notification pipeline are dead by construction** — the transactional-outbox pattern is correctly implemented on the write side and absent on the read side. Journeys 1, 2, 3, 4, 6 and 8 cannot complete. |
| **Exact fix** | A worker that claims PENDING rows (`FOR UPDATE SKIP LOCKED`), publishes to the realtime gateway and the notification pipeline, marks PUBLISHED, and retries FAILED with backoff using `attempts`/`availableAt`, which the schema already provides. |
| **Acceptance criteria** | 1. A committed message produces its realtime event **exactly once**, observed by a subscribed client. 2. Killing the worker mid-drain and restarting loses nothing and duplicates nothing. 3. A permanently failing event lands in FAILED with `lastError` and does not block the queue. 4. Drain latency is observable. |
| **Verification method** | Integration test against a real Postgres + Redis, executed by AI #10, including the kill-restart case. |

### RC-03 · Authentication mismatch and WebSocket identity trust
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | Authentication — all three tiers |
| **Owner** | **AI #1** (scheme + implementation), **AI #3**/**AI #4** (client conformance), **AI #7** (boot guard) |
| **Status** | OPEN |
| **Evidence** | Admin: cookie session, `credentials:'include'`, `Idempotency-Key`, base `/api/v1` (`client.ts`). Mobile: `Authorization: Bearer` + single-flight refresh, `X-Idempotency-Key` (`api_client.dart`). Backend: **neither**. `realtime.gateway.ts:57` — `const userId = String(client.handshake.auth?.userId ?? '')` passed straight to `resolveActor`. `Contact.appUserId`, the column that exists to link a contact to an authenticated account, is read by no code. Confirmed independently as **RT-001 (P0)**. |
| **Impact** | Complete authentication bypass at the only entry point that exists: a client declares who it is. Every other control — all of which are correctly written — is downstream of an identity the attacker chooses. Separately, whichever scheme the backend eventually implements, **one of the two clients is wrong**. |
| **Exact fix** | (a) Decide and document one scheme for both clients, or one per tier with both implemented. (b) Socket identity derives from a verified credential; a raw `handshake.auth.userId` is rejected. (c) Fail closed at boot: refuse to construct the gateway when `APP_ENV !== 'local'` and no token verifier is present. (d) One idempotency header name across both clients. |
| **Acceptance criteria** | 1. A handshake carrying only `auth.userId` is disconnected. 2. Booting with `APP_ENV=staging` and no verifier fails at startup. 3. An expired or revoked session cannot subscribe or send. 4. A role change or deactivation takes effect on the **existing** socket, not only on the next login. 5. Admin and mobile use the same idempotency header. |
| **Verification method** | Red-team regression suite (AI #9) inverting RT-001, plus an AI #10 integration test driving a real socket. |

### RC-04 · Realtime namespace and event contracts are disjoint
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | Realtime contract, admin ↔ backend ↔ mobile |
| **Owner** | **AI #2** (server contract, authoritative) · **AI #4**, **AI #3** (conform) |
| **Status** | OPEN |
| **Evidence** | Admin subscribes on namespace **`/staff`** to 11 snake_case events (`family.updated`, `case.updated`, `task.updated`, `coverage.changed`, `ownership.changed`, `unattended.changed`, `escalation.created`, `shift.ending`, …). Backend emits 11 camelCase events on the **default namespace** (`thread.updated`, `message.receipt.updated`, `reaction.*`, `typing.*`, `notification.created`, …). Only **3 names overlap** and all 3 carry incompatible payloads: `message.created` is `{family_id, message}` vs `{threadId, messageId, seq, …}`; `presence.changed` is `{staff_id, presence}` vs `{userId, state, lastSeenAt}`; `handoff.created` is `{handoff}` vs `{threadId, handoffId, fromStaffId, …}`. The gateway is declared `@WebSocketGateway({ cors: { origin: false } })`, which blocks the admin's cross-origin socket outright. |
| **Impact** | Realtime is inoperative between the only two tiers that exist. The admin inbox never refreshes; nothing in Journey 3 or 4 updates without a manual reload. |
| **Exact fix** | One generated contract, owned by AI #2, from which both clients generate types. Decide namespace (`/staff` vs default) and casing once. Set gateway CORS from `CORS_ALLOWED_ORIGINS`. Add the eight operational events the admin needs, or delete them from the client — not both. |
| **Acceptance criteria** | 1. No hand-written event name in either client. 2. Every event the admin subscribes to is emitted by the server with a matching payload. 3. A cross-origin socket from the configured admin origin connects; one from an unconfigured origin does not. 4. An unauthorized user receives no event for a thread they cannot read. |
| **Verification method** | Contract test asserting client and server event maps are identical, plus a live subscribe/emit integration test. |

### RC-05 · The API surface does not exist relative to Admin Web
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | HTTP contract |
| **Owner** | **AI #1** + **AI #2** (implement) · **AI #4** (contract as specified in `docs/admin/backend-contract-required.md`) |
| **Status** | OPEN |
| **Evidence** | `apps/admin-web/src/core/api/endpoints.ts` calls **34+ distinct paths**. The backend exposes **3 routes, all under `/health`** (`grep @Controller` → one controller), and no `/api/v1` prefix, because there is no `main.ts` to set one. Mobile has no HTTP wiring at all — it runs against `FakeBackend`. |
| **Impact** | Admin Web builds and cannot function. Mobile has never spoken to a real server. |
| **Exact fix** | Implement the contract in `docs/admin/backend-contract-required.md`, routed exclusively through `AuthorizationService`. Casing, error envelope (`{error:{code,message_en,message_ar}}`) and pagination must match what the clients already parse — or the clients change; one of the two, decided and recorded. |
| **Acceptance criteria** | 1. Every path the clients call returns its documented shape or a documented error code. 2. No endpoint makes its own access decision. 3. An unauthenticated call returns 401 and the clients' 401 handlers fire correctly. |
| **Verification method** | Contract test enumerating every client-declared path against the running API; AI #10 executes the Journey 3 flow end to end. |

### RC-06 / RC-07 · Competing schema and migration authorities
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | Database |
| **Owner** | **AI #1** (SQL, authoritative) · **AI #2** (demote Prisma to a query client) |
| **Status** | OPEN — **decision issued**, see `database-decision.md` |
| **Evidence** | Prisma declares 24 models with no `@@schema`/`multiSchema`, and `DATABASE_URL` pins `?schema=public`; all 9 SQL migrations target `chat`. `config` exists in both with **divergent key names** (`timers.no_reply_reminder_hours` vs `automation.no_reply_reminder_hours`) and **opposite failure modes** (`chat.config_num()` raises; `AppConfigService.get()` returns a hardcoded default). `contact.can_message` defaults `false` in SQL, `true` in Prisma. `message` is append-only by trigger in SQL and mutated by `deleteForEveryone()` in Prisma. There is **no `prisma/migrations/` directory** — only `prisma db push`, which has no history and no down path. |
| **Impact** | The two branches merge without textual conflict into a database holding two disjoint, mutually unaware definitions of eight core entities. Neither §11 migration test (fresh DB; upgrade an existing DB) can be run, because no single authority defines "all migrations". |
| **Exact fix** | Execute `database-decision.md` D-3/D-4/D-5: SQL is the authority; delete `prisma:push`; reconcile or introspect `schema.prisma`; adopt the SQL config key names and its **fail-loud** semantics; resolve `can_message` to one default (SQL's `false` is the safer, deny-by-default choice); resolve the append-only conflict (RC-10). |
| **Acceptance criteria** | 1. Exactly one definition of each of `staff`, `family`, `contact`, `config`, `event_log`, `audit_log`, `thread`, `message` in the merged tree. 2. `prisma db push`/`migrate` appear nowhere. 3. Empty DB → apply all → app starts. 4. Realistic populated DB → apply new → app starts, existing data valid. 5. Re-applying is a no-op (already gated in CI). |
| **Verification method** | AI #10 runs both §11 migration tests against a real Postgres, plus a grep-based single-authority assertion added to CI. |

### RC-11 · The system could not be operated (partially addressed)
| | |
|---|---|
| **Severity** | BLOCKER |
| **Area** | CI / observability / recovery / runbooks |
| **Owner** | **AI #7** (observability, runbooks, recovery) · **AI #5** (CI) |
| **Status** | IN PROGRESS |
| **Evidence — resolved since reconnaissance** | `.github/workflows/ci.yml` now exists: G-18 secret gate, G-20 real-employee-name gate, G-31…G-35 Phase-2 scan, API typecheck + unit, Admin typecheck + tests, a `migrations` job with a real Postgres asserting apply-and-idempotency, and an explicit `mobile: BLOCKED` job that reports rather than hides the missing toolchain. `scripts/infra/backup-db.sh` and `restore-db.sh` now exist. |
| **Evidence — still open** | Observability is **not wired**: `grep -i "sentry\|otel\|opentelemetry" apps/api/src` → **0 hits**, though the env manifest requires `SENTRY_DSN` and `OTEL_*` in staging and production; 3 `new Logger()` calls in the entire backend. `docs/infrastructure/` is still an **empty directory** while `.env.example` and the `Dockerfile` cite `environment.md`, `architecture.md`, `decisions.md` (ADR-001/004/005) and `production-runbook.md` inside it. No restore has been rehearsed. No incident runbooks. The CI `migrations` job applies `db/test/00_core_shim.sql`, which **institutionalises the Core coupling that `database-decision.md` removes**. |
| **Exact fix** | Wire structured logging with token/PII redaction, error monitoring and traces; publish the four cited `docs/infrastructure/*` files; rehearse a restore in staging; write the runbooks in §32 of the charter; replace the Core shim in CI with a Chat-only fixture. |
| **Acceptance criteria** | 1. Production can answer the eleven §31 questions. 2. A restore is executed and the application starts against restored data with relationships intact. 3. RPO/RTO stated. 4. No shipped file cites a document that does not exist. 5. CI creates no Core-owned tables. |
| **Verification method** | AI #10 executes a staging restore drill and records it in `deployment-readiness.md`. |

### RC-13 · The governing product contract is not in the repository
| | |
|---|---|
| **Severity** | BLOCKER (documentation / release) |
| **Area** | Product source of truth |
| **Owner** | **Product owner**, escalated by AI #10 |
| **Status** | **VERIFIED RESOLVED — 2026-09-06.** PRD v0.1 committed at `docs/product/jawwid-chat-prd-v0.1.md` (`62ff312`), sha256 `3e63ec…a1b697`, byte-for-byte verified. Approved by the product owner as the source of truth for implementation, notwithstanding its internal "Draft for review" status line. **Downstream re-grading is not yet done:** every gate currently marked `UNVERIFIED (needs PRD)` must now be re-graded against this file. |
| **Evidence** | `docs/qa/authoritative-scope.md` §6: the approved PRD v0.1 is *"not on disk"*. Scope is therefore graded against AI #5's summary of it. `docs/product-operations/discovery.md` §2 records **two mutually inconsistent reconciliations** of the same conflict, both attributed to the product owner on the same day (OD-01). `README.md` still points to `docs/brief/JAWWID_CHAT_BRIEF.md`, a path that does not exist. |
| **Impact** | Every scope-derived gate is graded against a secondary source. This is precisely the failure mode that produced the current divergence — five agents reading five second-hand summaries. |
| **Exact fix** | Add PRD v0.1 to `docs/`. Until then, `authoritative-scope.md` §3 remains the operative written record, per instruction 6. |
| **Acceptance criteria** | PRD v0.1 in `docs/`; every gate re-graded against it; each currently-`UNVERIFIED` scope item resolved to PASS/FAIL. |
| **Verification method** | AI #10 re-grades `release-scorecard.md` against the PRD and marks which conclusions changed. **No requirement will be invented in the meantime** — anything needing the PRD is marked `UNVERIFIED (needs PRD)`. |

### JC-001 · Student Groups, approvals and calling are `DESIGN-ONLY`
| | |
|---|---|
| **Severity** | BLOCKER · **Owner** AI #1 (schema/authz) + AI #2 (engine) · **Status** OPEN |
| **Evidence** | `schema.prisma` §C: `// SECTION C - DESIGN-ONLY (declared, deliberately NOT implemented in MVP)`; `StudentGroup`, `StudentGroupMember`, `MessageApproval`, `Call`, `CallParticipant` each tagged `/// DESIGN-ONLY. Not implemented.` No service reads or writes them. The SQL stack has no equivalent tables at all. |
| **Impact** | Three headline PRD MVP capabilities have no runtime. The Teacher app and the Admin approval UI have no backend to integrate against. |
| **Exact fix** | Implement against the authoritative SQL schema (BF-4), routed through the single `AuthorizationService`. Approval is MVP-simple: approve, reject, **mandatory rejection reason**. Voice only; **no video**. |
| **Acceptance criteria** | A pending message is never delivered, pushed, searchable or emitted; no self-approval; concurrent decisions resolve to one state; a group call authorizes through the same policy as a group message; two children in one family get two Student Groups. |
| **Verification method** | Integration tests per `test-plan.md`; AI #10 executes Journeys 2, 5 and 7. |

### JC-002 · BR-1 is enforced by making Student Groups unrepresentable
| | |
|---|---|
| **Severity** | BLOCKER · **Owner** AI #1 · **Status** OPEN · **Depends on** JC-001, BF-2 |
| **Evidence** | `authorization.service.ts` header: *"There is no user-to-user conversation entity in this system at all… A Teacher↔Parent 1:1 thread is not merely denied, it is unrepresentable."* True — and it equally forbids the Student Group, the one channel BR-1 **requires**. Reinforced in SQL by `chat.thread.family_id uuid not null unique`. Confirmed independently as **RT-002 (P0)**: authorization is a total function of `familyId` alone, so thread kind and participant set are outside its type signature and BR-1 cannot be expressed. **The 23 `BR1-*` conformance tests are `it.todo` — declared, not written.** |
| **Exact fix** | Typed conversations with explicit participant sets; authorization becomes a function of *(actor, conversation, channel, context)*; BR-1 = no 1:1-kind conversation may contain both a teacher and a parent, checked at creation **and at every membership mutation**, over messaging **and** calling, through one policy. |
| **Acceptance criteria** | `BR1-01…BR1-20` written and passing, including group→1:1 promotion, add-member escalation, calling parity, and **BR1-19 with client-side policy disabled**. |
| **Verification method** | AI #10 runs the suite and executes Journey 7 against the running system with the Flutter `CommunicationPolicy` patched out. |

### JC-003 · Teacher is not a first-class actor
| | |
|---|---|
| **Severity** | BLOCKER · **Owner** AI #1 · **Status** OPEN |
| **Evidence** | `types.ts`: `ActorKind = 'STAFF' \| 'CONTACT' \| 'SYSTEM'` — no teacher. `FAMILY_FACING_ROLES` excludes `ACADEMIC`, so a teacher mapped onto that role cannot communicate at all. SQL `chat.staff.role` CHECK omits `teacher`; `chat.learner.teacher_id` is a bare `uuid` with no FK and no identity behind it. `resolveActor()` resolves a Staff row or a Contact row — a teacher is neither (**RT/AI #8 G-I**). |
| **Impact** | The Teacher mobile app cannot authenticate. Teacher↔Admin 1:1 and Student Group membership are both impossible. |
| **Exact fix** | Teacher becomes an authenticated first-class actor, authorized independently of CS back-office staff. QA specifies behaviour, not table design. |
| **Acceptance criteria** | A teacher authenticates; holds Teacher↔Admin 1:1 and calls; participates in Student Groups for assigned learners; **can never obtain a 1:1 channel to a parent**; the "internal back-office staff never message families" rule still holds for finance/technical/academic. |
| **Verification method** | Journey 2 and Journey 7 executed end to end. |

### RC-12 · Red Team coverage is partial, not clear
| | |
|---|---|
| **Severity** | BLOCKER (transport surface) · **Owner** AI #9 · **Status** IN PROGRESS |
| **Evidence — delivered** | `docs/red-team/` now exists: `findings.md` (15 findings, 2×P0, 8×P1), `attack-surface.md`, `race-conditions.md`, `cross-agent-red-team.md`. **Runtime evidence verified by AI #10**: `npx jest --selectProjects unit --testPathPattern red-team` → **2 suites, 12 tests, all executing**. The campaign grades its own findings CONFIRMED(runtime) / CONFIRMED(static) / UNVERIFIED / THEORETICAL and refuses to claim more. |
| **Evidence — still open** | The campaign states its own constraint: with no `main.ts`, no HTTP surface and no worker, **runtime attacks against HTTP, WebSocket, queues and storage are impossible today**. Chaos and recovery campaigns are not run. |
| **Status per instruction 10** | Service-layer adversarial testing: **PARTIAL — evidence verified.** Transport, queue, storage and chaos surfaces: **NOT TESTED.** Neither is `PASS`. |
| **Acceptance criteria** | After RC-01, campaign 2 re-runs every UNVERIFIED finding at the transport layer, plus chaos and recovery; every P0/P1 has an inverted regression test landing in the same commit as its fix. |
| **Verification method** | AI #10 re-executes the red-team suite and confirms each fixed finding's assertion was inverted, not deleted. |

---

## HIGH RISK

### RT-003 · `on_behalf_mode` is client-controlled for a MANAGER
| | |
|---|---|
| **Severity** | HIGH RISK (audit integrity, not privilege escalation) · **Owner** AI #1 · **Status** OPEN |
| **Evidence** | `authorization.service.ts:129` — `return allow(intent.requestedMode ?? OnBehalfMode.ESCALATION)`. All four modes are honoured verbatim for a manager. AI #9 confirmed this at runtime; **AI #10 re-read the line after the JC-005 fix and it is unchanged.** The class contract on the very same file says *"OWNER vs COVERAGE is derived, never trusted."* |
| **Impact** | `on_behalf_mode` is the field distinguishing Primary Owner from Current Handler, written to `audit_log`/`event_log` as fact. A forged `OWNER` stamp corrupts ownership attribution, workload figures and the audit record — the record the product's "the system owns the family history" rule rests on. It survives the JC-005 fix exactly as AI #9 predicted, because the JC-005 test only exercised a non-manager. |
| **Exact fix** | `allow(this.deriveMode(actor, familyOwnerId, intent.requestedMode ?? ESCALATION))`, with `OWNER` reachable only when `actor.userId === familyOwnerId`. Access stays unconditional; attribution stops being client-chosen. |
| **Acceptance criteria** | A manager requesting `OWNER` on a family they do not own may still send, and the message is stamped `ESCALATION`/`COVERAGE`, never `OWNER`. |
| **Verification method** | Invert the RT-003 assertions in `authz-attacks.spec.ts` in the same commit as the fix; AI #10 re-runs. |

### RC-09 · The covering admin is not in the delivery audience
| | |
|---|---|
| **Severity** | HIGH RISK · **Owner** AI #1 (`IdentityService`) + AI #2 (fan-out) · **Status** OPEN |
| **Evidence** | `identity.service.ts::familyThreadAudience()` returns **contacts + the permanent owner** only. Corroborates AI #8 G-B. |
| **Impact** | The on-duty coverage admin gets no receipt row, no realtime fan-out and no notification. An off-shift customer message is delivered to the person who is off shift. **Journey 4 is broken at the delivery layer**, independently of RC-02. Combined with stickiness being applied to every staff reply regardless of presence (AI #8 G-C), two admins can each believe the other is handling a family. |
| **Exact fix** | Audience = contacts + Primary Owner + `on_duty()` handler + sticky handler + any escalation target, computed from the coverage engine rather than from `family.ownerId`. |
| **Acceptance criteria** | With the owner off shift and coverage active, a customer message produces a receipt, a realtime event and a notification for the covering admin; ownership is unchanged; when the owner returns, history is intact. |
| **Verification method** | Journey 4 executed end to end by AI #10. |

### RC-10 · Append-only invariant contradicts shipped behaviour
| | |
|---|---|
| **Severity** | HIGH RISK · **Owner** AI #1 + AI #2 · **Status** OPEN |
| **Evidence** | SQL: `create trigger message_is_immutable before update or delete on chat.message` → `chat.forbid_mutation()`, commented *"a correction is a new message; the customer record is never rewritten."* Prisma: `deleteForEveryone()` **UPDATEs** the message row (`deletedAt`, `deletedBy`, `deletedForAll`, `redactedReason`). |
| **Impact** | If both stacks land, delete-for-everyone throws `restrict_violation` in production. Gate G-17 cannot be satisfied while two definitions of "immutable" coexist. |
| **Exact fix** | Decide once: either delete-for-everyone is a separate append-only redaction record, or `message` is append-only except for an explicitly enumerated redaction column set. Record the decision in `database-decision.md`. |
| **Acceptance criteria** | One definition of message immutability; delete-for-everyone succeeds under it; the original body is unreadable afterwards; the audit trail retains the fact of the deletion and its reason. |
| **Verification method** | Integration test against the authoritative schema with the trigger installed. |

### RC-08 · The production env template fails the deployment's own preflight
| | |
|---|---|
| **Severity** | HIGH RISK · **Owner** AI #7 · **Status** OPEN |
| **Evidence** | `scripts/infra/check-env.sh production --file infra/env/production.env.example` → **34 errors, exit 1**: 25 required variables missing, plus `NODE_ENV must be 'production'` and `APNS_PRODUCTION must be 'true'`. The gate itself is well built and correct; the template it grades is not. |
| **Impact** | The reference production configuration cannot pass the first step of the documented deployment. |
| **Exact fix** | Complete the template so it validates, with placeholders for secrets and real values for non-secrets. |
| **Acceptance criteria** | `check-env.sh production --file infra/env/production.env.example` exits 0; the same for staging; the check runs in CI. |
| **Verification method** | AI #10 re-runs both, and confirms CI invokes them. |

### DB-1…DB-8 · Core-coupling and dual-authority corrections
| | |
|---|---|
| **Severity** | HIGH RISK (BLOCKER in aggregate, as they gate the merge) · **Owner** AI #1 (DB-1…DB-6), AI #2 (DB-7), AI #7 (DB-8) · **Status** OPEN |
| **Evidence & exact fixes** | Enumerated in `database-decision.md` §5. Highest-consequence: **DB-2**, `chat.current_staff_id()` calls Supabase's `auth.uid()`, which does not exist in Chat's own database — it returns NULL there, and every owner guard built on it silently misattributes rather than failing. **DB-5**, CI applies `db/test/00_core_shim.sql`, fabricating Core's `auth.users`/`public.*` tables inside Chat's test database. |
| **Acceptance criteria** | No reference to `auth.uid()`, `auth.users`, `public.profiles/children/subscriptions/payments`, or a `chat.core_*` view anywhere in the tree; CI creates no Core-owned table; `DATABASE_URL` and the migrations agree on the schema; `prisma:push` is gone. |
| **Verification method** | A CI grep gate (added by AI #10) plus the §11 migration tests. |

---

## MEDIUM RISK · carried, owned, not release-gating on their own

| ID | Title | Owner | Source |
|---|---|---|---|
| G-C | Stickiness applied to assist/escalation and ignores presence — a one-off escalation makes a logged-off manager the current handler | AI #2 | AI #8 |
| G-E | `conversationState()` returns `WAITING_ON_CUSTOMER` whenever staff spoke last, filing *"we'll get back to you"* under waiting-on-customer | AI #2 | AI #8 |
| G-F | `Thread @@unique([familyId, kind])` vs `StudentGroup @@unique([learnerId])` — a two-child family cannot have two Student Groups | AI #1/#2 | AI #8 · folded into BF-2 |
| G-G | `class_soon` (+40) and `payment_failed` (+20) are structurally dead: both need Core mirrors with no sync job | AI #1 | AI #8 |
| G-H | `listThreadsForActor()` returns the 200 most recent threads to any family-facing staff member, unscoped and unordered | AI #2 | AI #8 |
| JC-004 | `config_num()`/`config_text()` return NULL for a JSON-`null` value, the exact behaviour their comment says they prevent | AI #1 | AI #5 |
| RT-011…RT-014 | `familyId:'*'` probe; full receipt roster in `MessageDto`; internal notes announced over realtime to customer contacts; authorization computed outside the transaction that acts on it | AI #1/#2 | AI #9 |

---

## Register discipline

1. Nothing moves to VERIFIED without AI #10 executing the stated verification method.
2. A fix that makes a test pass by weakening the test is a regression, not a fix. JC-005's assertions were checked line by line for exactly this and were **found intact**.
3. When a finding is fixed, its adversarial assertion is **inverted in the same commit**, per AI #9's rule. A green red-team suite after a fix means the fix did not land.
4. Blockers are not removed for schedule pressure.
