> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Integration Reconciliation · Step 2 — Domain Conformance Plan (D-1 … D-7)

**Date:** 2026-09-06 · **Phase:** reconciliation gate · **Status:** PLAN ONLY — nothing implemented
**Baseline:** `docs/integration/01-prd-reconciliation.md`
**Authority:** `docs/product/jawwid-chat-prd-v0.1.md` (SHA-256 `3e63ec01…a1b697`, verified)
**Worktree:** isolated — `integration/prd-reconciliation`. Shared checkout untouched.

---

## 0. Preface

### 0.1 Independent corroboration

`docs/release/prd-conformance-v0.1.md` (AI #4, same day) reaches the same conclusions from an
independent reading: its **C-1…C-9** map onto **D-1…D-7** with no material disagreement. Two
independent readings of the PRD agreeing is strong evidence these are real, not one agent's
misreading. **This document does not restate that re-grade** — it is the execution plan that
follows from it, in the nine fields the gate requires.

Where this document goes further: the Case dependency inventory (D-5), the complete root-entity
list (D-6), connection-level verification of the Core boundary (D-7), and migration authority.

### 0.2 Correction to my own Step 1

**Step 1's D-7 finding was wrong in its severity assessment, and I am correcting it here.**

Step 1 stated *"We are a schema inside [Core's database]"*, citing migration header comments.
That was reading documentation, not code — the same error I criticised in others. Direct
inspection of current artifacts shows the production code does **not** implement co-location:

- **No** production migration creates a view over `public.*` or `auth.*` — verified by grep
  across all 19 migrations.
- The only `chat.core_*` objects created are two ordinary tables, `chat.core_event` and
  `chat.core_parent_inbox` — an ingestion landing pattern, not a Core read-through.
- `public.profiles` / `public.children` / `public.subscriptions` / `public.payments` /
  `auth.users` / `auth.uid` appear **only** in `db/test/00_core_shim.sql`, which states in its
  first line: *"TEST FIXTURE ONLY — never applied to a real database."*
- `docker-compose.yml:15-19` records: *"This changed on 2026-09-05 when the product owner locked
  the database decision: Jawwid Chat is standalone and owns its own PostgreSQL database, and
  Jawwid Core integration goes through an API/webhook boundary."*
- `.env.example` already carries `CORE_BASE_URL`, `CORE_API_KEY`, `CORE_WEBHOOK_SECRETS`,
  `CORE_TIMEOUT_MS`, `CORE_RETRY_MAX`.

**D-7 is therefore largely already satisfied.** What remains is residue and proof, not a
re-architecture. This materially reduces the cost of the gate and changes the implementation
order's first item from "convert" to "verify and clean up". Details in §D-7.

---

## D-1 · Role model

**1. PRD requirement.** §3 defines exactly seven roles: `parent · student · teacher · admin ·
coverage_admin · manager · super_admin`. `super_admin` is *"System owner / technical admin —
Everything, plus users, roles, policies, templates, automations, integrations, audit logs"*.
§11.1 scopes contact data to *"manager and `super_admin` endpoints"*. §7.1 provisions all
accounts from Jawwid Core.

**2. Current implementation.**
- SQL: `chat.staff.role in ('admin','coverage','manager','finance','technical','academic')`
  (`20260905090200_chat_staff_and_coverage_config.sql`).
- Role literals hard-coded in predicates: `20260905090700_chat_ownership_invariants.sql:80,245`;
  `20260905090900_chat_core_integration.sql:188`; `20260905091200_chat_rls.sql` (≈10 policies
  using `chat.current_staff_role() in ('admin','coverage','manager')`).
- API: `apps/api/src/communication/contracts/vocab.ts:18-23` — ADMIN, COVERAGE, MANAGER,
  FINANCE, TECHNICAL, ACADEMIC.
- Admin Web: `src/core/permissions/capabilities.test.ts:19-20` **asserts** `super_admin` absent;
  `src/shared/types/domain.ts:8` documents the absence as intentional.
- Prisma: `role String` — unconstrained, so no Prisma change is forced.

**3. Exact contradiction.** Four distinct defects:
(a) `super_admin` is required by the PRD and is actively asserted absent by a passing test.
(b) The role is named `coverage`, not `coverage_admin` — **zero occurrences of `coverage_admin`
exist anywhere in the repository.**
(c) `finance` / `technical` / `academic` are not PRD roles; they are the superseded brief's
departmental-task model.
(d) `teacher` and `parent` are PRD *roles* in the same system, not external actors — this is the
root of C-1 / OD-04.

**4. Affected artifacts.**

| Area | Files | Evidence |
|---|---|---|
| SQL | 7 (`'coverage'`), 2 (`'finance'`), 3 (`'technical'`), 2 (`'academic'`) | grep by literal |
| API | `vocab.ts` + 1 more per literal; `platform/authorization.service.ts:234,355` | |
| Admin Web | 11 (`coverage`), 5 each (finance/technical/academic), 2 (`super_admin`) | |
| Flutter | 1 (`coverage`) | |
| Tests | 4 (`coverage`), 1 (`finance`), 1 (`academic`), + `capabilities.test.ts` | |
| Docs | `docs/qa/rbac-matrix.md` §1; `docs/design/terminology.md` (forbidden-word list); `docs/product-operations/open-decisions.md` OD-06 | |

**5. Owning agent.** AI #1 (role enum, RLS, authorization) · AI #4 (Admin Web mapping + test) ·
AI #5 (RBAC matrix regeneration) · AI #3 (teacher/parent principals) · AI #6 (terminology, deferred).

**6. Migration impact.**
- New migration widening `chat.staff.role` — **additive first**: add `coverage_admin`,
  `super_admin`, `teacher`, `parent` to the check constraint **before** removing anything.
- Rename `coverage` → `coverage_admin` requires a data migration plus updating ~15 SQL predicate
  sites; the RLS policies must be rewritten in the same transaction or authorization will
  silently narrow mid-migration.
- **Do not drop `finance`/`technical`/`academic` in the same migration.** They have live
  consumers (5 Admin Web files each, the department task surface in
  `docs/design/screens/tasks.md`). Deprecate: stop issuing, keep accepting, remove once
  consumers are gone. Dropping them first would break the task-assignment path with no
  replacement designed.
- **Open question for the product owner:** the PRD has no departmental staff roles at all. What
  happens to department task assignment? This is a genuine PRD gap, surfaced not assumed — see §X.

**7. Test impact.**
- `apps/admin-web/src/core/permissions/capabilities.test.ts:19-20` **must be inverted** — it
  currently encodes the defect as a requirement.
- `docs/qa/rbac-matrix.md` must be regenerated for 7 roles × every action; the current matrix has
  6 columns and is wrong in 2 of them. Every DENY must still be asserted at the API.
- New tests: `super_admin` reaches the endpoints §11.1 grants it and nothing more; `coverage_admin`
  behaves exactly as `coverage` did (rename must be behaviour-neutral).

**8. Dependency.** Blocks D-5 (case removal touches role-scoped task routing), authorization
reconciliation, and Admin Web. Depends on **nothing** — this can start immediately.

**9. Verification criteria.**
- `chat.staff.role` check constraint equals the PRD's seven values (minus any the product owner
  explicitly defers).
- `grep -r coverage_admin` returns hits in SQL, API, Admin Web and tests; `grep -rw "'coverage'"`
  returns none outside migration history.
- `capabilities.test.ts` asserts `super_admin` **present**.
- Regenerated RBAC matrix has 7 role columns, every cell asserted by an API-level test.
- No behaviour change for existing `coverage` users across the rename (proved by the pre-existing
  coverage suite passing unmodified except for the literal).

---

## D-2 · Workload states

**1. PRD requirement.** §5.3: `Low · Medium · High · Critical`. *"State changes to High or
Critical notify the manager; Critical can optionally open the owner's families to a coverage
admin."* §13 row 11 puts **workload-triggered coverage** in Phase 2 — **the state itself is MVP**.
§8.1 lists *"workload High/Critical"* as an MVP operations notification event.

**2. Current implementation.**
- `chat.workload_level()` — `20260905090800_chat_attention_and_workload.sql:438-459` — returns
  three levels from two thresholds.
- Config: `workload.level.medium = 8`, `workload.level.high = 15`
  (`20260905090100_chat_config_defaults.sql:92,94`). No `workload.level.critical`.
- `critical` **does** appear in the codebase, but as **notification priority**
  (`20260905093000_chat_communication.sql:585`, `…093100:103,126,128`) — an unrelated concept.

**3. Exact contradiction.** A required state does not exist. Worse, `docs/design/design-qa.md`
**gate DQ-06** requires that *"No 'Critical' string exists in either codebase"* — a P0 release
gate that would **fail PRD-conformant code**.

**4. Affected artifacts.** `20260905090800…sql` (function), `20260905090100…sql` (config),
`docs/design/design-qa.md` DQ-06, `docs/admin/backend-contract-required.md` §7, Admin Web
`WorkloadLevel` union + badge, Manager Dashboard, `docs/qa/rbac-matrix.md` (workload visibility).

**5. Owning agent.** AI #1 (function + config) · AI #4 (Admin Web) · AI #5 (gate) ·
AI #6 (design pack, deferred).

**6. Migration impact.** Small and additive: one config row `workload.level.critical`, one branch
in `chat.workload_level()`. **No data migration** — the level is computed, never stored.
The `notification.priority` enum must **not** be touched; conflating the two `critical`s is the
main risk in this gate.

**7. Test impact.** Existing workload tests assert three levels and will fail — they encode the
defect. New boundary tests at medium/high/critical thresholds. A test asserting the manager is
notified on transition **into** Critical (§5.3). Do **not** test workload-triggered coverage —
that is Phase 2 and building it now is a scope defect.

**8. Dependency.** Independent of D-1, D-5, D-6. Can proceed in parallel. Must precede Manager
Dashboard work.

**9. Verification criteria.** Four levels returned by `chat.workload_level()`; threshold values
read from `config`, never literals; DQ-06 rewritten to assert Critical **exists**;
`notification.priority` unchanged; a score above the critical threshold produces `Critical` and a
manager notification.

---

## D-3 · Attention states

**1. PRD requirement.** §5.4: exactly three rule-based states — **`Needs attention now` ·
`Needs attention soon` · `Normal`** — with enumerated triggers per state. *"The state drives inbox
ordering, notification priority, and dashboard counts."* §13 row 12b: rule-based in MVP, AI
classification Phase 2 as a **suggestion** only.

**2. Current implementation.** Four buckets from the superseded brief — `now` / `today` /
`quiet` / `waiting_family` — computed from a weighted attention **score** with a `top_reason`
string (`20260905090800_chat_attention_and_workload.sql`). Vocabulary counts across
API + Admin Web + Flutter: `now` 13, `today` 6, `quiet` 4, `waiting_family` 3, `normal` 1.

**3. Exact contradiction.** Not a rename — **a different model**. The PRD specifies a *state with
enumerated triggers*; the implementation is a *score with a hidden reason string*, bucketed four
ways. `waiting_family` and `quiet` have no PRD counterpart; `soon` has no implementation.

**Design note (not a decision):** the PRD's triggers for *"needs attention now"* are concrete
(message during or within 15 min of a class; service-blocking state in Core; SLA about to breach;
admin-flagged complaint; message marked Urgent). A rules engine over those is a smaller, more
testable artifact than the current score. Whether the score is retained *underneath* a
PRD-conformant state is an implementation choice for AI #1/#2, not a product one.

**4. Affected artifacts.** `20260905090800…sql` (signals, score, bucket, `family_state_cache`),
`20260905090100…sql` (`attention.points.*` config), API attention payloads, Admin Web inbox
sections + ordering + dashboard counts, Flutter (1 site), `docs/design/` (inbox spec, terminology,
cross-platform register), `docs/qa/` attention tests.

**5. Owning agent.** AI #1 (rules + cache) · AI #2 (payloads, realtime) · AI #4 (inbox) ·
AI #3 (Flutter) · AI #5 (tests) · AI #6 (design pack, deferred).

**6. Migration impact.** Largest of the seven. `chat.family_state_cache.bucket` changes domain;
the recompute triggers change; `attention.points.*` config keys are superseded by trigger rules.
**Sequence:** add the new state alongside the old bucket, dual-write, migrate readers, then drop.
A cutover in one migration would blank every inbox between deploy and cache recompute.

**7. Test impact.** Every attention test is rewritten — they assert bucket names and score
arithmetic. New per-trigger tests, one per §5.4 row. Inbox-ordering tests change. This gate has
the largest test-rewrite cost of the seven, and the tests are currently the only executable
evidence the attention engine works — **do not delete them before replacements pass**
(cf. JC-011).

**8. Dependency.** Depends on **D-4** (SLA-about-to-breach is a §5.4 trigger, so attention cannot
be finished before SLA exists). Blocks inbox, dashboard, notification priority.

**9. Verification criteria.** Three states only; each §5.4 trigger has a passing test; ordering
and dashboard counts derive from the state; no `today` / `quiet` / `waiting_family` outside
migration history; no AI/keyword classification in MVP beyond what §5.4 lists.

---

## D-4 · SLA

**1. PRD requirement.** SLA is authoritative vocabulary and a functional requirement:
§5.3 `sla_at_risk` is a workload input · §5.4 *"SLA about to breach"* triggers *needs attention
now* · **§7.5 *"Conversation state: open / waiting on customer / waiting on Jawwid / resolved,
with SLA timers per state, both configurable"*** · §8.1 *"SLA at risk"* is an MVP operations
notification · §10.2 dashboard metrics *"SLA at risk, SLA breached"* · §15.2 Q6 leaves the
**default targets** open (a product decision, not a blocker on the mechanism).

**2. Current implementation.** SLA exists **only as configuration constants and one attention
signal**:
- `response_target.*` config keys scoped `'sla'` (`…090100:73-79`), `attention.points.sla_70pct`
  (`:45`), `attention.points.sla_breached` (`:47`), `workload.weights.sla_risk` (`:86`).
- One signal emitter: `…090800:395 select 'sla_risk', …`.
- **Word-boundary counts: migrations 15 · `apps/api/src` 0 · Admin Web 1 · Flutter 0.**

**3. Exact contradiction.** Two defects.
(a) **There is no SLA implementation above the database.** No timer, no per-state target, no
conversation-state clock, no API surface, no dashboard metric. The PRD's §7.5 *"SLA timers per
state"* does not exist in any layer.
(b) `docs/design/design-qa.md` **gate DQ-07** requires that *"the string 'SLA' appears in no
user-facing copy in either language"*, and `docs/design/terminology.md` lists SLA as a forbidden
word. Both are wrong.

**Why the API has zero SLA — the actual cause, not a guess:** SLA was never implemented as SLA.
The superseded brief called this concept *"response target"* and modelled it as an **attention
signal** (points at 70% elapsed and at breach) rather than as a **timer on conversation state**.
The config keys are literally named `response_target.*` and carry `'[brief]'` provenance markers.
So the database has the brief's model, the API has nothing, and the PRD's model exists nowhere.
**This is not a renaming exercise** — the PRD requires a per-state timer with configurable
targets, which is new behaviour.

**4. Affected artifacts.** `…090100…sql` (config keys + naming), `…090800…sql:395` (signal),
new: conversation-state timer, API surface, dashboard metrics, notification rule;
`docs/design/design-qa.md` DQ-07, `docs/design/terminology.md`, `docs/design/decisions.md` DD-04
(*"countdown timers are banned"* — reconcile against §7.5), Admin Web inbox + dashboard.

**5. Owning agent.** AI #1 (timers, state) · AI #2 (API, notifications) · AI #4 (dashboard,
inbox) · AI #5 (gate DQ-07) · AI #6 (design pack, deferred).

**6. Migration impact.** New: per-conversation-state SLA target config (four states × the
day/night/Friday dimension already present), and a timer anchored to conversation-state
transitions. The existing `response_target.*` keys should be **renamed and re-scoped**, not
deleted — they carry tuned values. Requires D-5 first: SLA timers attach to **conversation
state**, which does not exist while state lives on `support_case`.

**7. Test impact.** New suites: timer starts/stops on state transition; at-risk and breached
thresholds; configurability; dashboard aggregation; the §5.4 attention trigger. Existing
`sla_risk` attention tests are retained but re-anchored.

**8. Dependency.** **Depends on D-5** (state must be on the conversation). **Blocks D-3** (SLA is
an attention trigger). Product input needed on §15.2 Q6 default targets — but the mechanism can
be built with placeholder config, since every value is config-driven by design.

**9. Verification criteria.** Per-state SLA targets in `config`; timers observable via the API;
`SLA at risk` / `SLA breached` on the dashboard and as notifications; DQ-07 deleted and
`terminology.md` corrected; `grep -rw sla apps/api/src` non-zero; no hardcoded target values.

---

## D-5 · Case entity removal

**1. PRD requirement.** §6's entity table lists: Family · User · Student · Enrollment/Class
session · **Conversation** · Message · Approval · Ownership/Coverage rule · **Task/Follow-up** ·
Reminder/Notification · Call. **There is no Case entity.** §7.5 puts state on the conversation;
§7.6 defines Tasks and Follow-ups. What the superseded brief modelled as a *case*, the PRD splits
into **conversation state + task/follow-up**.

**2. Current implementation.** `chat.support_case`
(`20260905090400_chat_conversation_domain.sql:47`) with `thread_id`, `family_id`, `learner_id`,
`type` (10 values), `severity`, `is_blocking`, `status` (6 values), plus `owner_locked`,
escalation, resolution columns. `chat.task` exists separately (`:231`) and is `case_id`-scoped.

**Dependency inventory (measured):**

| Area | References | Files |
|---|---|---|
| SQL migrations | 9 | 4 |
| `apps/api/src` | 8 | 4 |
| **Admin Web** | **57** | **12** |
| Flutter | 0 | 0 |
| `db/` SQL tests | 0 | 0 |
| `apps/api/test` | 0 | 0 |

Admin Web files: `core/realtime/events.ts`, `core/api/endpoints.ts`, `test/utils.tsx`,
`features/tasks/CreateTaskDialog.tsx`, `features/family/{CaseCards,CaseCards.test,
FamilyWorkspace,FamilyActions,hooks,Composer,Composer.test}.tsx`, `shared/types/domain.ts`.

**3. Exact contradiction.** A competing domain abstraction that the PRD does not define, carrying
behaviour the PRD assigns to two other places. It also carries brief-only concepts —
`owner_locked`, `is_blocking`, the 10 case types — with no PRD basis.

**4. Affected artifacts.** As inventoried. Note Flutter has **zero** dependency: this is an
admin-side and backend-side removal only.

**5. Owning agent.** AI #1 (schema) · AI #2 (services) · AI #4 (12 Admin Web files) ·
AI #5 (tests) · AI #6 (design pack — 6 screen specs reference cases, deferred).

**6. Migration impact — deprecation plan, not a drop.**
- **Step 1.** Add PRD conversation state to `chat.conversation`:
  `open / waiting_on_customer / waiting_on_jawwid / resolved`.
- **Step 2.** Backfill from `support_case.status`, mapping the six brief statuses onto the four
  PRD states. **`scheduled` and `closed` have no PRD target** — mapping needs a product answer
  (see §X). Do not invent it.
- **Step 3.** Repoint `chat.task.case_id` → `conversation_id` (+ optional `learner_id`), per §7.6
  *"Tasks belong to a family (optionally a student and a conversation)"*.
- **Step 4.** Migrate the 12 Admin Web files off case reads.
- **Step 5.** Only then drop `chat.support_case`.
- **Preserve** `is_blocking` and complaint flagging somewhere — §5.4 names both as attention
  triggers. They must survive the removal or D-3 loses two triggers.

**7. Test impact.** `CaseCards.test.tsx` and `Composer.test.tsx` are case-shaped and will be
rewritten. There are **no SQL tests** for `support_case` — so the schema change has no executable
safety net today; SQL tests for the new conversation state should be written **before** the
backfill, not after.

**8. Dependency.** **Blocks D-4** (SLA timers attach to conversation state). Depends on D-1 only
where task assignment is role-scoped. This is the **critical path** for the communication domain.

**9. Verification criteria.** `chat.support_case` dropped; conversation state has the four PRD
values; tasks reference conversations; `grep -rn case_id` returns nothing outside migration
history; `is_blocking` and complaint flagging still drive attention; backfill row-count reconciles
exactly; Admin Web renders state from the conversation.

---

## D-6 · `organization_id`

**1. PRD requirement.** §2.3: *"Not multi-tenant, but the data model carries an
`organization_id` on every root entity from day one so a future SaaS conversion is a migration,
not a rewrite."* §6 lists it as Family's first attribute after `id`.

**2. Current implementation.** **Zero occurrences.** `organization_id` / `organizationId`:
0 in `supabase/migrations/`, 0 in `apps/api/src`, 0 in `apps/api/prisma/schema.prisma`,
0 in Admin Web, 0 in Flutter.

**3. Exact contradiction.** A day-one requirement absent from every layer. The PRD sentence exists
precisely to prevent the situation the repository is now in.

**4. Affected artifacts — complete root-entity list (38 `chat.*` tables).**

**Root entities requiring `organization_id`** (own identity, not a child row):
`account` · `audit_log` · `call` · `config` · `conversation` · `core_event` ·
`core_parent_inbox` · `coverage_rule` · `event_log` · `family` · `family_note` · `handoff` ·
`learner` · `message` · `notification` · `notification_rule` · `notification_template` ·
`outbox_event` · `shift` · `staff` · `subscription` · `support_case`¹ · `sync_state` · `task` ·
`thread`¹ · `absence` · `contact` · `device_token` · `quiet_hours`

**Child/junction rows — inherit via parent, do NOT add** (subject to AI #1's ruling):
`call_participant` · `conversation_member` · `conversation_participant_state` ·
`family_state_cache` · `message_approval` · `message_attachment` · `message_hidden_for` ·
`message_reaction` · `message_receipt`

¹ `support_case` and `thread` are themselves subject to D-5 / the conversation-model
reconciliation — do not add a column to a table scheduled for removal.

**Other layers:** Prisma has **25 models against 38 tables** — a pre-existing drift finding
(missing: `absence`, `coverage_rule`, `shift`, `support_case`, `family_note`,
`family_state_cache`, `handoff`, `sync_state`, `core_*`, `account`, `subscription`, `task`,
`contact`, `learner`, `notification*`…). Adding `organization_id` will expose this. Also:
NestJS DTOs/services, Admin Web types, Flutter contracts, all fixtures, and Core integration
payloads (`external_id` + `synced_at` per §12.4 are related and also worth auditing).

**5. Owning agent.** AI #1 (schema + backfill) · AI #2 (payloads) · AI #4 · AI #3 · AI #5
(fixtures) · AI #7 (Prisma drift).

**6. Migration impact.** One migration touching ~29 tables. Sequence: add nullable → backfill a
single constant organization → set `NOT NULL` → add composite indexes where the column will be a
query predicate. **Cost grows with every table added, so this should land early** — but **after**
D-5, so it is not applied to `support_case`. FK targets and unique constraints that will become
per-tenant should be identified now even though enforcement is deferred.

**7. Test impact.** Low behavioural risk, broad mechanical churn: every fixture and factory gains
the column. Add one guard test asserting **no root table lacks `organization_id`**, so the
requirement cannot silently regress as tables are added — this is the cheapest durable protection
in the whole plan.

**8. Dependency.** Should follow D-5 (avoid columns on doomed tables) and D-1 (staff role churn
touches the same tables). Blocks nothing functionally; blocks *cheapness* — every day costs more.

**9. Verification criteria.** Every root table has `organization_id NOT NULL`; the guard test
passes; Prisma models match SQL (drift check green); API payloads carry it; a second organization
can be inserted without schema change (proving the SaaS path without enabling multi-tenancy).

---

## D-7 · Two-database Core boundary

**1. PRD requirement.** §2.3: *"Jawwid Chat integrates through an API or a dedicated integration
layer, **never by reading Jawwid Core's database directly**."* §12.4: *"A dedicated **integration
service** owns all traffic with Jawwid Core… Jawwid Chat application code never touches Jawwid
Core's database."* Synced entities carry `external_id` and `synced_at`; conflicts resolve in
Core's favour; change events drive the event bus; sync health is visible and alerts.

**2. Current implementation — better than Step 1 reported.**

| Check | Result |
|---|---|
| Production migrations creating views over `public.*` / `auth.*` | **none** |
| `chat.core_*` objects | two ordinary tables: `core_event`, `core_parent_inbox` (ingestion landing) |
| `public.profiles/children/subscriptions/payments`, `auth.users`, `auth.uid` in migrations or API | **0** |
| Those symbols in `db/test/00_core_shim.sql` | present — file declares *"TEST FIXTURE ONLY — never applied to a real database"* |
| Own database | `docker-compose.yml` runs `postgres:17-alpine` as `jawwid-chat-postgres`; `.env.example` defines its own `POSTGRES_DB` / `DATABASE_URL` |
| API integration config | `CORE_BASE_URL`, `CORE_API_KEY`, `CORE_WEBHOOK_SECRETS`, `CORE_TIMEOUT_MS`, `CORE_RETRY_MAX` present |
| Recorded decision | `docker-compose.yml:15-19` — standalone DB + API/webhook boundary, locked by the product owner 2026-09-05 |

**3. Exact contradiction — residue only.**
(a) **Stale documentation inside migrations** asserting the superseded architecture:
`20260905090000_chat_foundation.sql:17` (*"Reads Jawwid Core only via chat.core_* views"*) and
`20260905091150_chat_application_roles.sql:53`. No such views exist. A future reader will
implement to the comment.
(b) **`db/test/00_core_shim.sql` models Second School's live schema** — its header cites
`second-school`'s migration filenames as the column-shape source. Second School is **out of
scope**; the shim binds Chat's test fixtures to an unrelated product's schema.
(c) **No connection-level proof exists.** No test asserts that `DATABASE_URL` is not Core's
database, and nothing fails if someone points it at Core.
(d) The integration service itself — §12.4's sync, conflict resolution, and **sync health
visibility/alerting** — has config but needs verification that it is implemented.

**4. Affected artifacts.** The two migration comments; `db/test/00_core_shim.sql`;
`docs/design/discovery.md` E1 (records the superseded premise); any doc still describing
co-location; the integration service; `chat.sync_state` / `chat.core_event`.

**5. Owning agent.** AI #1 (boundary, comments) · AI #7 (infrastructure, connection proof) ·
AI #5 (shim, guard test) · AI #2 (sync events).

**6. Migration impact.** **None to the schema.** Two comment corrections. The shim is a test
fixture, not a migration. This gate is far cheaper than Step 1 implied.

**7. Test impact.**
- Add a **connection-level guard**: assert the target database contains no `public.profiles` /
  `public.children` / `public.subscriptions` / `public.payments` and no `auth.users`, and fail
  startup or CI if it does. This is the *"verified at the database/connection level, not merely
  schema level"* requirement, and it is a ~10-line test.
- Re-source the shim from Chat's **own** documented Core API contract rather than from Second
  School's migrations.
- Add sync-health tests per §12.4.

**8. Dependency.** Independent — can start immediately and in parallel. Nothing blocks it.

**9. Verification criteria.** Empty database + migrations → a schema containing **only** `chat.*`;
the connection guard passes against Chat's DB and **fails** against a Core-shaped DB (negative
test); no migration comment describes co-location; no artifact references `second-school`;
integration traffic is HTTP/webhook only; sync health surfaces in the admin panel.

---

## Migration authority

**Requirement.** SQL migrations are the sole schema authority. Prisma is a query client:
`generate` only, no `db push`, no `migrate`, no migration authority.

**Current state — mostly conformant, two gaps.**

| Check | Evidence | Verdict |
|---|---|---|
| Prisma declares SQL authoritative | `schema.prisma:3-5` — *"THE SQL MIGRATIONS IN supabase/migrations ARE AUTHORITATIVE FOR DDL… it never defines the schema"* | ✅ |
| Datasource scoped | `schemas = ["chat"]` | ✅ |
| CI runs no Prisma DDL | `.github/workflows/ci.yml:127,235` — `npx prisma generate` only; no `migrate`/`push` anywhere | ✅ |
| Migration runner | `scripts/db/apply.sh` — own ledger `chat.schema_migrations`, `ON_ERROR_STOP=1`, applies `supabase/migrations/*.sql` in order | ✅ |
| **`prisma:push` script exists** | `apps/api/package.json` — `"prisma:push": "prisma db push --skip-generate"` | ❌ **remove** — the capability is one command from destroying the authority model |
| **`db:drift` does not exist** | `schema.prisma:6` claims *"`npm run db:drift` proves the two agree"*. The script is **not defined in any package.json, CI job, or script** | ❌ **the drift guarantee is asserted but not implemented** |

**Actions (small, low-risk, no schema change):** delete `prisma:push`; implement `db:drift` or
delete the claim; wire drift into CI. The drift gap matters immediately — D-6 will add a column
to ~29 tables and Prisma already models only 25 of 38.

---

## §X · Genuinely missing PRD decisions — STOP items

Per the standing instruction, these are surfaced and **not** assumed. Each blocks a specific step.

| # | Decision | Blocks | Why the PRD does not answer it |
|---|---|---|---|
| **X-1** | **What replaces `finance` / `technical` / `academic`?** The PRD has no departmental staff roles, but department task assignment is built and designed. Are these dropped, mapped to `admin` scopes, or is the PRD silent-by-omission? | D-1 completion; `docs/design/screens/tasks.md` | §3's role list is exact and excludes them; §7.6 does not say who tasks are assigned to |
| **X-2** | **How do `support_case.status` values `scheduled` and `closed` map onto the PRD's four conversation states?** | D-5 Step 2 backfill | §7.5 lists four states; the brief had six. Two have no target |
| **X-3** | **Default SLA targets per attention state** (PRD §15.2 Q6, explicitly open) | D-4 tuning, not mechanism | The PRD defers it to M0 |
| **X-4** | **Are coverage admins permanent silent Student Group members, or join during coverage?** (PRD §15.2 Q4, explicitly open) | Group membership sync | The PRD defers it; AI #4 confirms it does not block BR-1 |
| **X-5** | **May parents start group calls, or only join?** (PRD §15.2 Q5, explicitly open) | Calling authorization | The PRD defers it |

X-3, X-4 and X-5 are the PRD's **own** open questions for M0 — they are not gaps in this analysis.
X-1 and X-2 are consequences of removing brief-derived structures and need a product answer before
those removals complete.

---

## Implementation order (as instructed), annotated with what changed

| # | Gate | Revised assessment |
|---|---|---|
| 1 | **D-7** two-database boundary | **Much cheaper than expected** — production code is already conformant. Two comments, one shim re-source, one connection guard. Can start now, in parallel. |
| 2 | **D-1** roles | Additive-first. Blocked only by **X-1** for the deletion half; the additive half can start now. |
| 3 | **D-6** `organization_id` | Should follow D-5 so it is not applied to `support_case`. Cost grows daily. |
| 4 | **D-5** Case removal | **Critical path.** Blocked by **X-2**. Five-step deprecation; write SQL tests before the backfill. |
| 5 | **D-3** attention | Largest test-rewrite cost. **Depends on D-4**, so the stated order needs D-4 first or the SLA trigger cannot be implemented. |
| 6 | **D-2** workload | Small and independent; could land any time. |
| 7 | **D-4** SLA | **Depends on D-5.** Real new behaviour, not a rename. |

**One ordering conflict to resolve:** the instructed order runs D-3 (attention) before D-4 (SLA),
but *"SLA about to breach"* is a §5.4 attention trigger, so attention cannot be completed before
SLA exists. **Recommendation: D-5 → D-4 → D-3.** Flagged rather than silently reordered.

---

## What this document did not do

No schema, migration, authorization rule, service, UI or test was modified. No role was deleted.
No gate was edited — including the two defective ones (DQ-06, DQ-07), which live in the frozen
Design Pack and are recorded for later revision per instruction. Admin Web was not patched.
Steps 3–12 were not begun.

**Status:** 🔴 NOT READY · Phase 1 🟢 VERIFIED · PRD conformance 🔴 BLOCKED · Runtime 🔴 NOT VERIFIED
