# Database Divergence — Release Blocker

**Owner:** AI #8 (analysis) · **Resolution owner:** AI #1, sequenced by AI #10
**Date:** 2026-09-05 · **Status:** RELEASE BLOCKER

## 0. The decision is already made

Locked by the product owner on 2026-09-05:

1. Jawwid Chat is completely standalone.
2. It does **not** share Second School / Jawwid Core's database.
3. It owns its own PostgreSQL database.
4. There is **one** authoritative migration system.
5. That authority is the **SQL migrations** (`supabase/migrations/*.sql`).
6. Jawwid Core integration happens through an **integration/API/webhook boundary**, never
   direct DB coupling.

**This document does not choose a schema design and does not propose one.** It identifies
what belongs to the authoritative stack, what can be preserved, what must be discarded or
migrated, what AI #1 must reconcile, and what must not be merged.

## 1. Why this is a blocker rather than tidy-up

Two stacks currently define `staff`, `family`, `contact`, `config`, `event_log` and
`audit_log`. Beyond duplication, three facts make the tree undeployable today:

| # | Fact | Evidence |
|---|---|---|
| **NF-01** | The Node stack does not compile | `npx tsc -p tsconfig.json --noEmit` in `apps/api`: missing `../threads/thread.service`, missing `AuthorType`/`MessageType`/`MessageVisibility`/`MessageOrigin` exports, `canReadThread` gone, 10+ DTO errors |
| **NF-02** | No single branch can build a database | `20260905093000_chat_communication.sql` references `chat.staff`/`chat.family`/`chat.learner`/`chat.thread` 10 times; those tables are created in `20260905090200`/`090300` (branch `feat/backend-foundation`) and `20260905090400_chat_conversation_domain.sql` (not reachable from this branch head) |
| **NF-03** | `chat.on_duty()` is called but never created | `SqlCoverageService` issues `SELECT chat.on_duty($1,$2)`; no migration in the reachable tree defines it |

## 2. What currently belongs to the authoritative stack

The SQL series is the authority. Reachable content, across branches:

| Migration | Contents | Branch |
|---|---|---|
| `20260905090000_chat_foundation.sql` | `chat` schema, `set_updated_at()`, `forbid_mutation()`, `chat.config`, typed accessors | all |
| `20260905090100_chat_config_defaults.sql` | attention · SLA · workload · coverage · lifecycle defaults | all |
| `20260905090200_chat_staff_and_coverage_config.sql` | `staff`, `shift`, `coverage_rule`, `absence` | `feat/backend-foundation` only |
| `20260905090300_chat_family_domain.sql` | `family`, `contact`, `learner`, `subscription`, `family_note` | `feat/backend-foundation` only |
| `20260905090400_chat_conversation_domain.sql` | `chat.thread` (and the ops conversation domain) | unreachable from this branch head |
| `20260905093000_chat_communication.sql` | `conversation`, `conversation_member` + BR-1 trigger, `message` extensions, attachments, reactions, receipts, approvals, outbox, device tokens, notifications, calls | `feat/infrastructure` |
| `20260905093100_chat_communication_config.sql` | communication config, notification templates and rules | `feat/infrastructure` |
| `20260905093200_chat_shared_logs.sql` | shared logs | `feat/infrastructure` |

**Assessment.** The authoritative stack is in better shape than the branch topology suggests.
The conversation model landed in it correctly — typed conversations, an explicit participant
set, one live group per learner, and a BR-1 trigger that holds even against a manual SQL
session. What is missing is not design; it is **assembly**.

## 3. Work that can be preserved

Preserve — no rework implied by the decision:

- **Every SQL migration listed above.** The `chat` schema is already standalone: no foreign
  key references `auth` or `public` (ADR-004). The decision to own the database does not
  invalidate a single table.
- **`chat.conversation` + `chat.conversation_member` + `enforce_direct_conversation_rules()`** —
  the corrected conversation model and the BR-1 backstop.
- **`chat.config` and the typed accessors** that raise on a missing key.
- **`chat.forbid_mutation()`** and the append-only log intent.
- **The Node domain logic** — message sequencing under `FOR UPDATE`, `client_message_id`
  idempotency with P2002 recovery, the transactional outbox, receipt monotonicity, the
  centralized `AuthorizationService`, and the phone-privacy-by-construction `Actor` shape.
  These are algorithms, not schema; they survive a persistence change intact.
- **AI #4's Admin Web contract**, **AI #3's Flutter domain and policy**, **AI #5's QA suites**,
  **AI #6's design system and terminology.** Untouched by this decision.
- **The authorization regression tests** in `apps/api/test/unit/red-team/`.

## 4. Work that must be discarded or migrated

| Item | Disposition | Note |
|---|---|---|
| `apps/api/prisma/schema.prisma` **as a schema authority** | **discard as authority** | it may survive as a generated client mapping onto `chat.*`, but it must stop being a place where tables are *defined* |
| Prisma `Thread @@unique([familyId, kind])` | **discard** | contradicts `conversation_one_group_per_learner` (CF-03) |
| Prisma Section C `/// DESIGN-ONLY` models (`StudentGroup`, `MessageApproval`, `Call`, participants) | **discard** | superseded by real SQL tables; keeping them invites a second definition |
| Prisma-side column defaults that duplicate SQL defaults | **discard** | `can_message` already corrected; sweep for others |
| `AppConfigService`'s hardcoded fallback literals | **migrate to seed data** | they must stop acting as runtime defaults (X-03) |
| Node config key namespace (`automation.*`) | **migrate** to the seeded SQL keys | `timers.*`, `reopen.*`, `automation.batch_ack_seconds` |
| Dangling Node references (`thread.service.ts`, `familyThreadAudience`, Prisma enum imports) | **migrate** to the `chat.conversation` model | currently a compile failure (NF-01) |
| `docker-compose.yml` / `.env.example` assumptions about the database | **reconcile** with "Chat owns its own PostgreSQL" | AI #7 |
| Any migration header or doc claiming Chat lives *inside* Core's Supabase database | **correct** | `20260905090000` header and `20260905090300` comments now contradict the locked decision |

## 5. What AI #1 must reconcile

1. **Assemble one applicable series.** Every migration on one branch, applying cleanly from
   an empty database, in order. Today no branch can do this (NF-02).
2. **Create `chat.on_duty()`** — it is called by the API and does not exist (NF-03).
3. **Declare the authorization strategy** (X-15). With Chat owning its database and a Nest
   service in front of it, state explicitly whether RLS is the primary control or defence in
   depth. Both are defensible; the ambiguity is not.
4. **Reconcile message immutability** (X-12). `chat.forbid_mutation()` exists to make
   `message` append-only, while `20260905093000` adds `deleted_at`, `deleted_for_all` and
   `redacted_reason` columns to it. Decide deliberately.
5. **Resolve the duplicate `handoff.grace_minutes` seed** across scopes `coverage` and
   `communication` (NF-04).
6. **Correct the Core-coupling statements** in migration headers, and define the API/webhook
   boundary that now replaces them — including which entity is authoritative for what, and
   what happens when the boundary is unavailable or returns an unknown vocabulary (FS-25,
   FS-26).
7. **Replace the teacher-identity seam** (`chat.learner.teacher_id` resolving as an
   authenticated actor with `isActive: true` hardcoded — CF-08).

## 6. What must NOT be merged

| # | Do not merge | Reason |
|---|---|---|
| **DB-M1** | Any Prisma model as a **source of truth** for a table that exists in `chat.*` | violates locked decision 4/5 — one authoritative migration system |
| **DB-M2** | `Thread @@unique([familyId, kind])` in any form | re-breaks multi-child families (CF-03) |
| **DB-M3** | Any `prisma migrate` / `prisma db push` step in CI or deployment | would make Prisma a second migration authority |
| **DB-M4** | `AppConfigService` fallbacks as runtime defaults | breaks "every constant reads from config" |
| **DB-M5** | Any schema, view or FK reaching into Core's `public`/`auth` | violates locked decisions 1–3 and 6 |
| **DB-M6** | The Node communication layer while it does not compile | NF-01 — a merge would break `main` |
| **DB-M7** | A second authorization matrix for groups or calls | release-gate G-04; the SQL BR-1 trigger is a backstop, not a substitute for the single API-side policy |
| **DB-M8** | Superseded `/// DESIGN-ONLY` models for Student Groups, approvals or calling | they now contradict real tables |

## 7. Exit criteria for this blocker

1. One branch builds a database from empty, applying every migration in order.
2. `chat.on_duty()` exists and `SqlCoverageService` resolves against it.
3. `apps/api` typechecks and its test suites run.
4. No Prisma model defines a table that `chat.*` owns; no `prisma migrate` in CI.
5. No documentation or migration header states that Chat lives inside Core's database.
6. The Core integration boundary is documented as API/webhook, with a named producer for
   every mirrored entity.
7. AI #5 re-runs the release gate; G-19 (migrations apply cleanly, rollback defined) and
   G-21 (Core boundary) can be evaluated for the first time.
