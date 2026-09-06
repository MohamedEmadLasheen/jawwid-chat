# Communication Engine — integration audit

Auditor: AI #2 · Date: 2026-09-06 · Branch: `integration/ai2-audit`
Evidence environment: isolated worktree + dedicated container `jawwid-ai2-audit`

**Status: INTEGRATION BLOCKED.** Four blockers, none of them inside the
communication domain. Detail in §9.

Reproduce everything below:

```bash
scripts/db/audit-db.sh                       # 19 migrations onto an EMPTY db + seed
cd apps/api && npm run build
DATABASE_URL=... PORT=3999 node dist/main.js  # boots
scripts/smoke/api-smoke.sh                   # 19 HTTP checks against the running server
```

## 1 · PRD v0.1 conformance

INTEGRATED = reachable over HTTP against a running server with evidence.
IMPLEMENTED = code + tests, but no consumer or no runtime path.

| Capability | PRD | Status | Evidence / gap |
|---|---|---|---|
| Direct conversations (Parent↔Admin, Teacher↔Admin) | required | **INTEGRATED** | smoke: get-or-create, idempotent, non-member 403 |
| Student Groups | required | **INTEGRATED** | smoke: created from Core relationships, admin auto-included |
| Class groups | Phase 2 | **PARTIAL** | modelled and now covered by BR-1 triggers; no producer |
| Official conversations | required | **PARTIAL** | type exists; the parent-facing "Jawwid" channel is served as `direct`. No separate producer. |
| Messages | required | **INTEGRATED** | send/list/delete over HTTP |
| Attachments | required | **IMPLEMENTED** | authorize→PUT→send is coded and unit-tested; **no storage route or S3 adapter exists** (RT-022), so no byte ever moves. Not integrated. |
| Replies | required | **INTEGRATED** | cross-conversation reply refused |
| Reactions | required | **IMPLEMENTED** | service + integration tests; no HTTP smoke |
| Receipts | required | **INTEGRATED** | monotonic; verified sent→delivered→read |
| Typing / presence | required | **IMPLEMENTED** | Redis-backed, gateway handlers; **no websocket client has connected** |
| Offline / idempotency | required | **INTEGRATED** | same `clientMessageId` returns the original message over HTTP |
| Notifications | required | **INTEGRATED** | worker produced rows at runtime; **push provider is a logger**, so nothing leaves the process |
| Reminders | required | **IMPLEMENTED** | rules seeded, dedupe proven; no producer emits `class_scheduled` etc. |
| Calling | required | **INTEGRATED** | call started and LiveKit token minted over HTTP; non-participant refused |
| **BR-1** | required | **INTEGRATED** | 4 enforcement points; refused over HTTP and against raw SQL |
| Phone privacy | required | **INTEGRATED** | structural: no contact-channel column in `chat`; AI #1's `chat.account` holds none either |
| Approvals | required | **INTEGRATED** | held, contained, queued, decided — over HTTP |

## 2 · Database reconciliation

Resolved on this branch. One authoritative definition each.

| Object | Before | Resolution |
|---|---|---|
| `chat.event_log` / `audit_log` | defined in AI #1's `090500` **and** my `093200` | **my `093200` deleted.** AI #1's is authoritative; one `actor_type` column. |
| Message idempotency | `message_client_id_uniq (thread_id, client_id)` **and** `message_idempotency` | **`message_client_id_uniq` dropped** (`093400`). `client_id` is dead (no code writes it) but the **column stays** — `chat.my_messages` selects it. AI #1: drop it from that view, then drop the column. |
| Message immutability | AI #1's blanket `message_is_immutable` | replaced by column-level `message_no_rewrite`; body/author/conversation/seq immutable, approval + soft delete possible. Two tests prove it was narrowed, not removed. |
| `audit_log.actor_id` FK | FK to `chat.staff` | **dropped.** Parents and teachers take auditable actions and are not staff. |
| `conversation`, `conversation_member`, `call`, `call_participant`, `message_approval`, `device_token` | AI #2 only | single definition; no conflict |
| `chat.message` | AI #1's table | **extended in place**, never recreated — every AI #1 index, constraint and FK still holds |

**RT-023 is a branch divergence, not missing work.** AI #1's 13 platform
migrations are committed on `feat/backend-foundation`; `feat/infrastructure`
has 2. With both present, all 19 apply to an empty database and re-running is a
no-op. The red team's "they were never committed" is inaccurate — but its
conclusion stands for anyone on the default branch.

## 3 · Teacher identity — the required boundary

Today: `PrismaIdentityService` recognises a teacher as any id appearing in
`chat.learner.teacher_id`. A teacher has no name, no locale and no active flag,
and cannot authenticate. AI #1's new `chat.account` has `kind in ('staff','family')` —
**no teacher**, so C-1 is still open at the identity layer.

Required boundary — no direct Core DB dependency at any hop:

```
Jawwid Core (system of record for people and assignments)
      │  outbound webhook / polled API, Core-owned payload
      ▼
Chat integration worker            docs: AI #1 owns this hop
      │  upsert by stable external id; no FK, no cross-database read
      ▼
chat.account   kind ∈ (staff, family, teacher)      ← C-1: add 'teacher'
chat.teacher   id, account_id, display_name, locale, is_active, core_teacher_id UNIQUE
      │
      ▼
IdentityService.resolveActor() → Actor{kind:'teacher', displayName, locale, isActive}
      │
      ▼
Communication engine — unchanged
```

The engine already reasons only about `Actor`, so when this lands **one method
body changes** and nothing else. `conversation_member.actor_id` stays un-FK'd
(polymorphic across three kinds, and ADR-004 forbids cross-schema FKs); the
`actor_kind` discriminator is what makes it safe, and the BR-1 triggers key on it.

## 4 · Workers: IMPLEMENTED vs EXECUTED BY RUNTIME

Previously: both were IMPLEMENTED and **executed by nothing** — a deployed system
would have committed messages that never fanned out and scheduled reminders that
never sent.

`WorkerScheduler` (`outbox/worker.scheduler.ts`) now invokes both on an interval,
started from `onApplicationBootstrap`. Chosen over BullMQ because both methods
already claim work with a conditional UPDATE, so they are safe across instances
and restarts; an interval is sufficient and adds no infrastructure. BullMQ
remains the right answer for backoff visibility and metrics.

Evidence at runtime: `outbox_event` pending → 0 within 3s; `chat.notification`
rows created by the worker, not by a test.

| Path | Status |
|---|---|
| Outbox → realtime fan-out | **EXECUTED** (in-process; multi-instance needs the Redis adapter, wired but unverified) |
| Reminder scheduling | **EXECUTED**, but **no producer** emits the anchor events |
| Push dispatch | **EXECUTED to a logger.** `LoggingPushProvider` is the bound implementation; no FCM/APNs adapter exists |
| Attachment bytes | **NOT EXECUTED** — no storage route, no S3 adapter (RT-022) |

## 5 · API bootability — was the blocker, now verified

`main.ts` and `AppModule` did not exist; nothing could start. Both now exist and
the server boots with all controllers, the gateway and the workers.

`scripts/smoke/api-smoke.sh` — **19/19 pass** against a running server: liveness,
readiness with a live DB probe, AI #7's security headers, 401s, BR-1 403 with the
right code, idempotent retry, non-member 403, approval containment, LiveKit token
issued to a participant and refused to a non-participant, and workers draining.

Defect found only by booting: an absent or malformed `x-actor-id` reached Prisma
and surfaced as **500 instead of 401** (P2023). Fixed at the identity seam, so
every caller is covered.

## 6 · Security — re-run against the current implementation

| ID | Status | Evidence |
|---|---|---|
| RT-003 | **CLOSED** | manager asking for `owner` gets `assist`/`escalation`; asserted in `authz-attacks.spec.ts` and observed over HTTP |
| RT-004 | **CLOSED** | non-owner, non-on-duty internal note → `assist`, never `coverage`; the regression the finding warned about did not ship |
| RT-005 | **CLOSED** | no default secret; construction throws below 32 chars; expiry, key-swap and method-swap all fail verification |
| RT-007 | **CLOSED** | limits enforced inside `MessageService.send()`, the path every caller takes |
| RT-008 | **CLOSED** | non-system actors cannot author `type: system` or set `origin` |
| RT-023 | **RESOLVED BY RECONCILIATION** | 19 migrations onto an empty DB; idempotent re-run. Still open for anyone on `feat/infrastructure` alone |
| RT-024 | **CLOSED** | `conversation.type` and `call.type` are both immutable; `call.conversation_id` too. 4 tests |
| RT-025 | **CLOSED** | admin presence required for any teacher+parent room **and** call, on INSERT/UPDATE/DELETE, all types. 6 tests |
| RT-026 | **CLOSED** | 15 source files target `chat.conversation`; the running app is the model the triggers guard |
| RT-027 | **STALE** | the unit suite compiles; 170 tests run |
| JC-008 | **CLOSED** | superseded by RT-024's broader fix |
| RT-016, RT-017, RT-018, RT-019, RT-022 | **OPEN** | timing-safe compare; `BigInt()` on unvalidated input; `before`+`after` both sent; unbounded `messageIds[]`; no storage transport |

## 7 · Cross-agent integration matrix

| Agent | Agreed | Mismatch |
|---|---|---|
| **AI #1** backend | `chat.on_duty()` consumed, never reimplemented; `chat.account` is the identity anchor; migrations compose | `chat.account.kind` has no `teacher` (C-1). `chat.my_messages` still selects the retired `client_id`. Auth is still a header stub. Assist/escalation grant not supplied, so that path fails closed |
| **AI #3** mobile | `ApiClient` implements exactly the contract's retry rule — automatic retry only for requests carrying a client key | **No endpoint is bound.** No repository calls `/conversations`, `/messages`, `/approvals`, `/calls`; no socket event name appears in `lib/`. Mobile expects **bearer tokens**; the API accepts `x-actor-id`. Not integrated |
| **AI #4** admin | `on_behalf_mode` values match exactly; consumes `message.created`, `presence.changed` | `/approvals` and `/calls` **deliberately unbuilt** — the code comments say they are "in no part of the product brief", i.e. AI #4 is still working from the **superseded PDF**. Their roles list has no `teacher`. Expects 9 events nobody emits (`case.updated`, `coverage.changed`, `handoff.created`, `ownership.changed`, `shift.ending`, `task.updated`, `unattended.changed`, `escalation.created`, `family.updated` — all AI #1 ops events). Consumes none of `conversation.updated`, `approval.*`, `call.*`, `reaction.*`, `typing.*`, `message.receipt.updated` |
| **AI #5** QA | invariants suite passes against the reconciled schema; their composition tooling was reused rather than duplicated | Their `psqlArgv` prefers a local `psql` whenever `DATABASE_URL` is set, so the suite fails on any host without the client installed. Two of their BR-1 fixtures encoded the pre-RT-025 contract and were updated |
| **AI #7** infra | `applyInfrastructure` and `HealthModule` adopted unchanged; headers verified over HTTP | `CORS_ALLOWED_ORIGINS`, `STORAGE_SIGNING_SECRET`, `LIVEKIT_*`, `WORKERS_ENABLED`, `OUTBOX_POLL_MS`, `NOTIFICATION_POLL_MS` need to reach the deployment environment doc |
| **AI #9** red team | six findings closed with executable evidence; assertions inverted in place as their suites instruct | RT-016/17/18/19/22 remain open |
| **AI #6** design, **AI #8** product ops | — | no interface with this domain was found in the tree |

## 7b · A flaky security test, found and fixed

The call-token privacy assertion scanned the LiveKit claims for `/\d{7,}/` as a
phone-number check. A uuid hex segment can be all digits (`206f67036934`), so it
failed about one run in four while the behaviour was always correct.

Worth recording for two reasons: a flaky *security* test is worse than no test,
because it teaches people to re-run rather than read it; and this is the kind of
defect that only appears when a suite is run repeatedly, which an audit does and
ordinary development does not. Replaced with structural assertions — 5
consecutive green runs against 2 failures in the previous 9.

## 8 · Integration hygiene

Worked in `.claude/worktrees/ai2-integration-audit` on `integration/ai2-audit`.
No `git add -A`, no `reset`, no `clean`, no peer branch switched, no peer file
overwritten except two QA fixtures updated in place for the stronger BR-1 rule.

The shared-tree risk is real and was observed twice during this audit: a peer's
container reset destroyed the audit database mid-run, which is why
`scripts/db/audit-db.sh` uses a dedicated container.

## 9 · Blockers

1. **Teacher identity (C-1)** — `chat.account.kind` has no `teacher`. The Teacher
   app cannot authenticate, so BR-1's *permitted* path cannot be exercised E2E.
   Owner: AI #1.
2. **Authentication** — `x-actor-id` is a development seam. Mobile is built for
   bearer tokens. No real authentication exists anywhere. Owner: AI #1.
3. **Branch divergence** — the platform migrations and the communication domain
   live on different branches. Neither branch alone builds a working database.
   Owner: AI #1 + AI #7.
4. **AI #4 is building from the superseded brief** — approvals and calling are
   deliberately unbuilt because they are "in no part of the product brief". PRD
   v0.1 requires both. Owner: product, then AI #4.

Secondary, not blocking a decision but blocking a working product: no push
adapter, no storage transport, no producer for reminder anchor events.

## 10 · What "READY" requires

- [x] PRD conformance classified
- [x] one authoritative database definition
- [x] BR-1 enforced across API, membership, type and calling
- [x] API boots; HTTP smoke passes
- [x] workers executed by the runtime
- [x] six red-team findings closed with evidence
- [x] test suite stable across repeated runs (one flaky assertion fixed)
- [ ] teacher identity real
- [ ] authentication real
- [ ] branches merged; one branch builds the database
- [ ] mobile bound to the API
- [ ] admin approvals + calling built against PRD v0.1
- [ ] push and storage transports
- [ ] E2E across mobile + admin + API
