# Phase 0 — Reconciliation & Project Recovery: Final Report

Date: 2026-09-07 · Integration branch: `integration/recovery` @ see `git log` · Author: Phase 0 lead
Inputs: the repository at `feat/infrastructure` `148b7a2` (dirty), 16 branches, 17 worktrees.
The audit *"Jawwid Chat: What Is Actually Built"* was not present anywhere on disk; every claim
attributed to it in the Phase 0 brief was re-verified against code and execution before acting.

---

## 1. Executive summary

The repository was built by parallel agents against two product directions
(a Customer Success CRM brief and a communication-platform PRD), with two
database lineages, two domain models for the same thing (`thread` vs
`conversation`), two competing authentication implementations, two competing
tenancy implementations, an Admin Web that shares zero endpoints with the API,
a vendor tree in version control, and 793 lines of security-critical work
sitting uncommitted in worktrees.

Phase 0 turned that into **one linear integration line** (`integration/recovery`,
71 commits over `main`, zero merge commits), with:

* every branch classified and either cherry-picked, extracted, or archived as
  a tag (nothing lost, everything reversible);
* the domain model reconciled in code and schema: `chat.thread` and
  `chat.support_case` are gone, `Conversation` is the only parent of a message,
  and the API, Prisma layer and harness no longer know the old words;
* `organization_id` on every root table (PRD §2.3) with restrictive RLS
  isolation, applied and tested;
* the outbox no longer marks realtime events delivered when nobody received them;
* the header-identity seam (the sole open P0) contained so it cannot start
  outside `local | test | ci`, guarded by a protected test;
* one canonical document per decision — product boundary, architecture,
  identity, authorization, supervisor ownership, tenancy, RLS, API contract,
  vocabulary, database and Admin Web reconciliation — and 32 older documents
  marked Historical / Superseded / Reference;
* a clean working tree, no tracked `node_modules`, anchored `.gitignore`,
  all quality gates preserved and extended.

Every claim in this report that says *verified* was executed in this session;
the exact commands and results are in §11.

---

## 2. Git recovery

```
Before (2026-09-07, freeze)             After
16 branches (+ main)                    2 branches: main, integration/recovery
17 worktrees                            1 worktree (the repository itself)
0 merged into main                      integration/recovery = main + 71 linear commits
dirty tree: 10 modified, 9 untracked    clean (git status: 0 entries)
5,917 node_modules files tracked        0
gitlink to a worktree tracked           0
no remote                               no remote (unchanged; pushing is the owner's call)
                                        17 annotated tags archive/phase0/<branch> (+ freeze point)
```

`integration/recovery` was created at `main` and fast-forwarded to the only
lineage that boots (`feat/infrastructure`, itself linear over `main`); all
other work entered by cherry-pick or extraction, verified after each step.
`main` itself was not moved: merging `integration/recovery` into `main` is a
fast-forward and is the first act of Phase 1 once the owner approves.

---

## 3. Branch disposition

Full detail with evidence: `PHASE-0-BRANCH-LEDGER.md`.

| Branch | Decision | Reason |
|---|---|---|
| `feat/infrastructure` | KEEP → became `integration/recovery` | the only bootable lineage; linear over main; contains every subsystem |
| `feat/communication-engine` | DROP | 0 unique commits (ancestor of the trunk) |
| `feat/backend-foundation` | EXTRACT docs, DROP | its 13 migrations are byte-identical on the trunk; its `db/tests` target the removed thread/case schema; ADR-001 obsolete |
| `feat/core-integration-boundary` | EXTRACT docs, REWRITE later | sound Core webhook contract, but built on the pre-communication schema with colliding migration numbers and a competing tenancy model |
| `integration/ai2-audit` | CHERRY-PICK `8f43064`, EXTRACT audit doc, DROP migrations | RT-028 fix is the owner's deterministic assertion; its BR-1 migration competes with the verified `093300` |
| `ai4/p1-canonical-foundation` | DROP | byte-identical patch to `ai4/rbac-canonicalization` |
| `ai4/rbac-canonicalization` | CHERRY-PICK (adapted) | `organization_id` on root tables; Thread hunk dropped, Prisma defaults added; uncommitted RBAC migration preserved as evidence |
| `docs/ai8-auth-current-state` | CHERRY-PICK (doc) | historical record |
| `docs/auth-decision-gate` | CHERRY-PICK (doc) | historical record |
| `docs/core-auth-contract-request` | DROP | pointer only; its two docs recovered from the worktree |
| `feat/ai7-runtime-fixes` | CHERRY-PICK D-2; EXTRACT D-6 for Phase 1; DROP D-1 | D-2 fixes silent event loss (verified); D-6 is the Phase 1 authentication baseline; D-1 superseded by OD-01 |
| `fix/ai8-p0-blockers` | EXTRACT guard shape, DROP | NF-06 superseded by OD-01; `090100` silently breaks ownership transfer (AI #10's executed finding); `090200` superseded by `093300` |
| `integration/ai8-auth-subset` | EXTRACT, DROP | as above |
| `integration/current-state-reconciliation` | CHERRY-PICK (doc) | historical record |
| `integration/od-01-reconciliation` | CHERRY-PICK + complete | the domain-model reconciliation; its integration claim was not reproducible and was completed in `1b27075` |
| `integration/prd-reconciliation` | CHERRY-PICK docs; REWRITE role migration in Phase 1 | role migration reads dropped tables and mixes in workload machinery |

---

## 4. Architecture decisions

1. **One API is the application boundary**; clients never touch the database, Redis or storage. (`JAWUID-CHAT-ARCHITECTURE.md` §2)
2. **`AuthorizationService` remains the single decision point**, extended with scope (`AUTHORIZATION-MODEL.md` §4, §6); guards authenticate, services authorize, the database backstops.
3. **Database owns constitutional invariants** (BR-1 both layers, immutable type, append-only logs, no-rewrite, seq, idempotency, owner guard, family scope, org isolation); `supabase/migrations` + `apply.sh` is the only schema authority; Prisma is a client.
4. **Storage**: signed upload/read URLs, bytes never through the API; object-level authz to be added (RT-006).
5. **Realtime**: default namespace, server-named rooms, subscribe re-runs `canRead`, Redis adapter, worker relays through Redis and fails the outbox row if nobody received it (D-2, applied).
6. **Outbox**: at-least-once, never at-most-once; the claim/publish/ack/lease design is specified for Phase 1; "exactly once" is not claimed.
7. **Notifications**: the seven-stage pipeline is canonical; dispatch is not wired today and is Phase 2 work.
8. **CRM integration** is an external boundary (signed webhooks, `core_event` dedupe, `synced_at`), never SQL; re-implemented on the canonical schema later.
9. **Identity**: Chat owns credentials and sessions; teacher becomes `chat.teacher`; account lifecycle provisioned → active → suspended → deactivated (`IDENTITY-MODEL.md`).
10. **Tenancy**: `organization_id` from day one, applied now, restrictive RLS, actor-derived (`TENANCY-MODEL.md`).
11. **RLS** becomes live defence in depth behind the service layer, driven per transaction by the API with two connection roles (`RLS-STRATEGY.md`).
12. **Environment safety**: a build carrying a bring-up seam refuses to start outside local.

---

## 5. Product decisions

| Retained | Deprecated (frozen) | Rejected |
|---|---|---|
| Family communication, typed conversations (4 types), messaging, groups with moderation, calls, attachments, realtime, notifications, audit, supervisor ownership, CRM integration boundary, labels/broadcast as Phase 2 | tasks, shifts/absences/coverage rules, workload and attention scoring, renewal/subscription mirror, `family_state_cache`, Admin Web cases/tasks/coverage/dashboard CRM views | the Customer Success operating-system direction (brief, ADR-001), a Case entity (C-3), a second vocabulary (thread/InboxRow), client-side authorization as a control, Stories (not in the PRD; deferred) |

Open product decisions recorded, not assumed: PD-1 coverage admins in groups,
PD-2 parents starting group calls, PD-3 coverage windows vs explicit assignment,
PD-4 system-created conversations' type, PD-5 `super_admin` (decided yes per PRD).

---

## 6. Database decisions

Full object-level table: `PHASE-0-DATABASE-RECONCILIATION.md` §3.

| Class | Objects |
|---|---|
| **KEEP** | `config`, `organization`, `conversation`, `conversation_member`, `message`, `message_attachment`, `message_reaction`, `message_receipt`, `message_hidden_for`, `conversation_participant_state`, `message_approval`, `call`, `call_participant`, `outbox_event`, `device_token`, `notification`, `notification_template`, `notification_rule`, `quiet_hours`, `event_log`, `audit_log`, `core_event`, `sync_state`; BR-1 triggers (`093000`, `093300`, `094000`), append-only triggers, `message_no_rewrite`, `message_idempotency`, `log_event`/`write_audit`, migration ledger and CI gates |
| **MODIFY (Phase 1)** | `account` (kind teacher, lifecycle), `staff` (role vocabulary, department), `contact`, `learner` (teacher FK), `family` (assignment mirror), `family_note`, `message.client_id` (drop later), RLS policies and authorization helpers, ownership functions, identity helpers, `core_parent_inbox` |
| **DEPRECATE (frozen)** | `shift`, `coverage_rule`, `absence`, `handoff`, `task`, `subscription`, `family_state_cache`, coverage engine functions (`on_duty` etc. — retained as a routing input until Phase 1 replaces it), attention/workload functions, CRM config keys, subscription mapping functions and view |
| **REMOVE LATER** | the deprecated set above, by a numbered migration after PD-3; `db/tests/*` on archived branches that target the old schema |
| **Applied in Phase 0** | `20260905094000` OD-01 (drops `thread`, `support_case`; rehomes task/handoff/attention/workload; C-2 family scope; policies re-derived), `20260906120000` organization |

Migration history was not rewritten; the chain is 22 files, applies from empty, re-applies as a no-op.

---

## 7. Identity & authorization

**Identity** (`IDENTITY-MODEL.md`): Account (opaque subject, kind
staff|teacher|family, lifecycle status, organization) → exactly one principal
(Staff, Teacher, Contact) → Sessions bound to Devices; short-lived access JWT
carrying the session id, rotating hashed refresh tokens, revocation checked per
request; teacher identity in a new `chat.teacher` table with
`learner.teacher_id` as a real FK; offboarding revokes sessions, evicts sockets,
reassigns families, deactivates — nothing deleted. Phase 1 builds on D-6
(`archive/phase0/feat/ai7-runtime-fixes`) with AI #8's guard discipline.

**Authorization** (`AUTHORIZATION-MODEL.md`): roles `parent · student · teacher ·
admin (supervisor) · coverage_admin · manager · super_admin` (PRD §3);
sixteen permission keys with a default role mapping to be stored as data;
`AuthorizationService` preserved and extended with `can(actor, permission,
scope)` and the `visibleFamilies` / `visibleConversationsWhere` predicates;
ten verified defects (blanket staff visibility, global moderation queue,
ownership not used for visibility, hard-coded roles, no `super_admin`, three
actor-less routes, receipt disclosure, object-level authz, authz outside the
transaction, cached socket actor) assigned to Phase 1.

**Supervisor ownership** (`SUPERVISOR-OWNERSHIP.md`): `chat.family_assignment`
with history (primary / temporary, window, `assigned_by`, mandatory reason);
reassignment revokes the previous supervisor's scope immediately (lists,
reads, moderation queue, sockets) and grants the new one's; offboarding
guarantees from `090700` kept; coverage windows become temporary assignments
(PD-3 decides whether schedule-driven or explicit). BR-1 preserved in both
layers and proven by `db/tests/br1_invariants.sql` + `br1-conformance.spec.ts`.

---

## 8. API contract

`docs/contracts/API-CONTRACT.md` inventories 35 API routes, 48 Admin Web
definitions and 11 Flutter calls (94 rows) and classifies each. Major
reconciliations:

* **Shape**: API is authoritative — `/api/v1`, camelCase, `{error:{code,message}}`, string `seq`, cursor `{items, nextCursor}` (messages keep `before/after/limit`), `Idempotency-Key` header + `clientMessageId` body.
* **Auth**: bearer tokens on HTTP and `auth.token` on the default Socket.IO namespace (Phase 1); Admin Web's cookie session and `/staff` namespace are obsolete; `x-actor-id` is a deprecated, contained seam.
* **Vocabulary**: `thread` → Conversation; `case` → removed; `InboxRow` → conversation summary; `/families/:id/messages` → `/conversations/:id/messages`; `/inbox?section` → `GET /conversations?section=`.
* **MISSING (Phase 1, specified)**: `/auth/login|refresh|logout`, `/me`, `/me/sessions`, `/config`, `/families`, `/families/:id`, `/families/:id/conversations`, `/families/:id/assignment` (+history), `/staff`, `/audit`.
* **OBSOLETE**: cases, away-summary, shift-banner, snooze, order-feedback, coverage/tonight, team-now, this-week, at-risk/renewals. **DEFERRED**: tasks, shifts/rules/absences (PD-3).
* **RECONCILE**: `GET /conversations` (filters, paging), three actor-less routes, unscoped lists (RT-011), receipt disclosure (RT-012), Flutter reaction DELETE dropping the emoji, `X-Idempotency-Key` rename.

`DOMAIN-VOCABULARY.md` fixes the terms across DB, Prisma, API, Flutter and Admin Web with an alias table.

---

## 9. Admin Web

`PHASE-0-ADMIN-WEB-RECONCILIATION.md`. Today: a Customer Success console
(6,128 lines, 74 tests) whose 48 endpoints the API does not implement.
**Remains (KEEP/REUSE)**: app shell and nav registry, API client/error model,
i18n + RTL, design tokens, realtime provider pattern, shared components,
Composer / Thread (→ ConversationView) / ReasonDialog, login page, session
provider (→ bearer), capabilities helper (→ canonical permission keys).
**Rework**: inbox → conversation queue (needs_reply / pending_approval /
unanswered), family workspace → family + its conversations, ownership dialog →
supervisor assignment (recipient rule moves server-side), `domain.ts` and
realtime event map → canonical contract. **Deprecated**: cases, tasks,
coverage, CRM dashboard (renewals, at-risk, team-now, workload), away-summary,
shift banner, order feedback. **Direction locked, not built**: the
Communication Operations Console dashboard (unanswered conversations, pending
moderation, conversations needing action, activity, alerts). No Admin Web code
was changed in Phase 0; typecheck and 74 tests still pass.

---

## 10. Security

**Fixed or contained in Phase 0 (all verified by execution):**

| Finding | Action |
|---|---|
| RT-023 migration chain could not build an empty DB | closed (AI #9's uncommitted work committed; stubs and cross-branch composition removed; CI gate G-19 + schema acceptance) |
| RT-024 / RT-025 BR-1 bypass by type mutation / missing admin presence | closed (`093300`, `db/tests/br1_invariants.sql`, CI gate G-01), and C-4 operation-time admin presence in `AuthorizationService` (OD-01) |
| RT-028 flaky phone-privacy assertion | closed with the owner's stronger deterministic assertion |
| D-2 outbox events marked published and delivered to nobody | closed (`RelayRealtimePublisher`, 4 integration tests) |
| RT-001 header identity (sole P0) | **contained, not closed**: process refuses to start outside `local\|test\|ci` (`identity-seam.ts`, protected test); closed by Phase 1 |
| Test harnesses that fabricated Core tables / an `auth` schema | removed (T-01/T-03/T-04/T-06) |
| A thread-era author-validation trigger that rejected every conversation message | removed with the thread model (OD-01) |
| Tenant isolation | restrictive RLS on every root table + cross-org trigger (inert until RLS engages; tested via SQL as `authenticated`) |

**Remaining (assigned):** RT-001 (Phase 1), RT-006 object-level storage authz,
RT-009 socket re-validation, RT-010 remainder (a header comment in `090000`),
RT-011 unscoped staff lists, RT-012 receipt disclosure, RT-013 internal-note
fan-out, RT-014 authz outside the transaction, RT-016..022 (P3), RLS inert at
runtime, three actor-less routes, global moderation queue, protected tests still
pass but the JC-011 SQL count includes helper definitions (cosmetic).

---

## 11. Tests — exact commands and results (2026-09-07, final tree `integration/recovery`)

| Command | Result |
|---|---|
| `JAWWID_INT_CONTAINER=jawwid-chat-p0 JAWWID_INT_PORT=55434 bash scripts/db/integration-db.sh reset` | 22 migrations applied from an empty `postgres:17` |
| `… integration-db.sh up` (re-apply) | 0 applied — no-op |
| `… integration-db.sh verify` | `FRESH DATABASE ACCEPTANCE PASSED` · `ALL BR-1 INVARIANT TESTS PASSED` |
| `psql … < db/tests/od01_conversation_model.sql` | `ALL OD-01 CONVERSATION MODEL TESTS PASSED` |
| `psql … < db/tests/tenant_isolation.sql` | 9 PASS notices, exit 0 |
| `apps/api: npm run typecheck` | clean |
| `apps/api: npm run test:unit` | 8 suites, **104 passed** |
| `apps/api: npx jest --selectProjects integration --runInBand communication-engine groups-approval-calls realtime-delivery` (DATABASE_URL, REDIS_URL set) | 3 suites, **69 passed** |
| `apps/api: env -u DATABASE_URL npx jest … schema-invariants.spec.ts` (docker psql path; the host has no `psql`) | **12 passed** |
| `apps/admin-web: npm run typecheck` | clean |
| `apps/admin-web: npx vitest run` | 11 files, **74 passed** |
| `flutter test` (SDK at `~/development/flutter/bin`, Flutter 3.47.2) | **224 passed, 10 skipped** (the live-backend group skips without env), 0 failed — after fixing one recovered test that hung under FakeAsync |
| `bash scripts/qa/check-protected-tests.sh` | `JC-011 guard: pass` — 9 protected suites at or above floor |
| `bash scripts/infra/scan-secrets.sh` | `secret scan: clean (0 findings)` |
| `git status --short` / `git ls-files -ci --exclude-standard` / `git ls-files \| grep -c node_modules` | 0 / 0 / 0 |

Not executed in Phase 0 (stated, not claimed): the API image build and
non-root check (CI job), the backup/restore drill (CI job), the API boot smoke
against HTTP (recorded by AI #9/#10 on the same code; not re-run here), the two
clients against the live API, realtime end to end with a client, `npm audit`.

---

## 12. Files changed (categorised)

* **Git/hygiene**: `.gitignore` (rewritten, anchored); 5,927 index removals (`node_modules`, `dist`, `.dart_tool`, `.flutter-plugins-dependencies`, `*.iml`, `tsbuildinfo`, a gitlink).
* **Database**: `+20260905094000_chat_od01_conversation_reconciliation.sql`, `+20260906120000_chat_organization.sql`; `db/tests/{schema_acceptance (OD-01 variant), od01_conversation_model, tenant_isolation}.sql`; `−db/integration/*.sql`, `−db/test/00_core_shim.sql`.
* **Scripts/CI**: `scripts/db/integration-db.sh` (+`verify`, no composition), `−scripts/db/test-db.sh`, `scripts/qa/check-protected-tests.sh` (SQL idiom), `.github/workflows/ci.yml` (G-19/G-01 steps, no stubs).
* **API**: `prisma/schema.prisma` (Thread/case removed; `organizationId` + Organization), `platform/{authorization.service, audit.service, identity-seam}.ts`, `communication/{conversations,messages,calls}/…service.ts`, `contracts/dto.ts`, `api/{message.controller,actor.decorator}.ts`, `realtime/realtime.gateway.ts`, `infra/realtime/{relay.publisher,realtime-relay.service,realtime-channel}.ts`, `communication.module.ts`, `main.ts`, `platform/errors.ts`; tests: `+unit/auth/identity-seam.spec.ts`, `+unit/authorization/br1-admin-presence.spec.ts`, `+integration/realtime-delivery.spec.ts`, `integration/{harness,communication-engine.spec,groups-approval-calls.spec,schema-invariants.spec}.ts`.
* **Mobile**: `+test/app/startup_routing_test.dart` (recovered, fixed).
* **Docs — canonical (new)**: `docs/README.md`, `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`, `architecture/{JAWUID-CHAT-ARCHITECTURE,IDENTITY-MODEL,AUTHORIZATION-MODEL,SUPERVISOR-OWNERSHIP,TENANCY-MODEL}.md`, `contracts/{API-CONTRACT,DOMAIN-VOCABULARY}.md`, `security/RLS-STRATEGY.md`, `recovery/{PHASE-0-BRANCH-LEDGER,PHASE-0-DATABASE-RECONCILIATION,PHASE-0-ADMIN-WEB-RECONCILIATION,PHASE-0-REPORT}.md`, `recovery/evidence/uncommitted/*`.
* **Docs — recovered/extracted**: 9 under `docs/integration/`, 2 under `docs/release/od-01-*`, `docs/infrastructure/api-contract-reconciliation.md`, `docs/communication/integration-audit.md`, 5 under `docs/architecture/` (reference), `docs/qa/protected-tests.tsv` (+5 entries), `docs/red-team/{findings,handoff-to-release}.md`.
* **Docs — status banners**: 32 files; `README.md` header.

---

## 13. Remaining risks (intentionally deferred)

| Risk | Mitigation in place | Owner phase |
|---|---|---|
| RT-001: identity is still a header | boot refusal outside local; protected test | 1 |
| Staff see every conversation; moderation queue global | documented predicate; database backstops only BR-1/family/org | 1 |
| RLS inert at runtime | strategy fixed; parity tests specified | 1 |
| Teacher identity synthesized, always active | model fixed; membership rows unaffected | 1 |
| Role vocabulary in code/DB is brief-era (`coverage`, departments, no `super_admin`) | vocabulary locked; two migration drafts preserved | 1 |
| Coverage engine still routes `canSend` (`on_duty()`) while classified deprecated | frozen; PD-3 recorded | product + 1 |
| Outbox claim-before-publish window on crash | D-2 removes the silent-loss case; lease design specified | 1 |
| Notifications never dispatch; storage never serves bytes; no Flutter realtime client | pipelines documented as not wired | 2 |
| Admin Web is disconnected from the API | full migration map; no code changed | 2 |
| Core ingestion not on the integration line | reference contract kept; archived code | later |
| No remote / no backup of the repository outside this machine | archive tags exist locally only | owner |
| Docker containers from other agent sessions (`jawwid-*`, 10 of them) still running | untouched — not repository state | owner |
| Second tenant would collide on natural keys (push tokens, room names, dedupe keys, `account.subject`) | recorded (TENANCY M-2) | 1–2 |

---

## 14. Phase 1 readiness

> Is the repository now ready to begin PHASE 1 — Identity, Authentication & Authorization?

```
READY
```

with these entry conditions, all satisfiable without further reconciliation:

1. Check out `integration/recovery` (or fast-forward `main` to it); everything
   else is archived under `archive/phase0/*`.
2. Build authentication on D-6 (`archive/phase0/feat/ai7-runtime-fixes`)
   per `IDENTITY-MODEL.md` §7, in this order: `chat.teacher` + learner FK →
   account lifecycle + credential + session + device (migration after
   `20260906120000`) → `AuthenticatedGuard` on HTTP and the socket → delete
   `identity-seam.ts` and the header seam → role migration per
   `AUTHORIZATION-MODEL.md` §2 → `chat.family_assignment` per
   `SUPERVISOR-OWNERSHIP.md` → scope predicate in `AuthorizationService` and
   every list endpoint → `PrismaService.withActor` + `chat_app` role per
   `RLS-STRATEGY.md` → parity and scope tests, all added to
   `docs/qa/protected-tests.tsv`.
3. Product answers needed *during* Phase 1, not before it: PD-3 (coverage
   windows), PD-5 is decided (`super_admin` exists); PD-1/PD-2/PD-4 can wait
   for Phase 2.
4. Do not start Admin Web rework, notification dispatch, storage serving or
   the Flutter realtime client in Phase 1; they are Phase 2 and depend on the
   contract Phase 1 completes.
