# Runtime-Integration Dependency Map

Date: 2026-09-06 · Author: AI #4 · Baseline: PRD v0.1 (`3e63ec01…b697`)
Scope: **only** blockers that must close before runtime integration. Nothing below is implemented by this pass.

## Status changes since the last audit — verify before acting

Two items I previously reported as blockers have **moved**. Acting on the stale
version would waste work or duplicate a fix already landed.

| Item | Previous | Now | Evidence |
|---|---|---|---|
| **RT-024 / JC-008** BR-1 mutation bypass | 🔴 OPEN P0 | 🟢 **CLOSED IN CODE** — `chat.enforce_conversation_type_immutable()` rejects *any* `conversation.type` change (fail-closed), with a BR-1-specific message when members are teacher+contact. Membership trigger already covers `insert or update`. | `20260905093000_chat_communication.sql:210-238` |
| **RC-01** API does not start | 🔴 BLOCKER | 🟡 **LIKELY CLOSED** — `main.ts` + `app.module.ts` exist; `setGlobalPrefix('api/v1')`; `app.listen(port,'0.0.0.0')`. Prefix now matches the Admin Web client. **Runtime start still unproven.** | `apps/api/src/main.ts:4,23,33,53` |

**RT-024 is `NOT VERIFIED` rather than `VERIFIED`**: its regression test cannot
execute because the migration series still cannot apply to an empty database
(D-1). Fix landed, proof blocked — those are different things.

---

## Priority 1 — blocks all runtime integration

| # | PRD requirement | Owner | Current implementation | Contradiction | Required fix | Dependency | Verification test |
|---|---|---|---|---|---|---|---|
| **D-1** | §13 · a deployable system | **AI #1** | SQL series + `chat.schema_migrations`; `scripts/db/test-db.sh reset` **fails** | Series cannot apply to an empty DB; omits platform tables it depends on | Make the series self-contained from zero | none — **head of the chain** | `test-db.sh reset` on empty Postgres 17 → exit 0 |
| **D-2** | §12 · one reproducible schema | **AI #1 + AI #2** | Two authorities: SQL series (ledger, BR-1 triggers) **vs** Prisma (`multiSchema`, `schemas=["chat"]`, **no `prisma/migrations/`**) | `prisma db push` has no ordering, history or down path | Ratify SQL series as authority; demote Prisma to client generation **or** generate a real migration history | D-1 | empty→migrate→API starts; populated→migrate→data valid |
| **D-3** | BR-1 *"enforced server-side **and in the database**"* | **AI #1** | Type-immutability + membership triggers landed | Fix unproven; RT-024/RT-025 regression suite cannot run | Execute the BR-1 suite once D-1 lands | **D-1** | RT-024 promotion attack rejected; `BR1-01…19` server-side with client policy disabled |

## Priority 2 — blocks client integration

| # | PRD requirement | Owner | Current implementation | Contradiction | Required fix | Dependency | Verification test |
|---|---|---|---|---|---|---|---|
| **D-4** | §3 · `teacher` is a first-class actor; §4.1 Teacher↔Admin 1:1 | **AI #1** | `learner.teacher_id` is a bare uuid; schema comment concedes *"AI #1 owns teacher identity (correction C-1). Bare uuid until it lands."* | A teacher cannot authenticate. BR-1 currently "holds" only by the teacher's absence — that is absence, not enforcement | Teacher identity + auth, distinct from `staff`; never grantable a parent 1:1 | D-2 | teacher signs in; teacher↔parent `direct` rejected at API **and** DB |
| **D-5** | §12 realtime; §7.5 Admin Inbox | **AI #2** | Fan-out is **conversation-room scoped** only (`room.conversation(id)`) | Ownership / coverage / workload / attention / unattended / shift events are family- and staff-scoped. **They have no room to be delivered to.** 10 of 11 Admin events have no producer | Add a server-assigned operational room dimension (`room.staff`, `room.family`) + operational events in the canonical contract | D-2 | admin receives `ownership.changed` for an owned family and **not** for another owner's |
| **D-6** | §12 · one contract | **AI #2** (contract) · #3 · #4 (consumers) | 3 auth schemes; gateway `cors:{origin:false}`, default namespace vs admin's `/staff`; admin payloads `snake_case` vs backend `camelCase` | Admin socket cannot connect at all today | Publish one generated API+event contract; both clients regenerate | D-5 | zero hand-written event/endpoint names in either client; socket connects cross-origin |
| **D-7** | §2.3 · `organization_id` on **every root entity from day one** | **AI #1** | **0 occurrences** in `supabase/migrations/` and in `schema.prisma` | Direct PRD violation. Retrofitting a tenancy key across 23 tables, 38 RLS policies and every client model later is the rewrite §2.3 exists to prevent | Add `organization_id` to root entities + RLS predicates now | D-1, D-2 | every root table has it NOT NULL; RLS denies cross-organization reads |

## Priority 3 — canonical-model conformance (sequence carefully)

| # | PRD requirement | Owner | Current implementation | Contradiction | Required fix | Dependency | Verification test |
|---|---|---|---|---|---|---|---|
| **D-8** | §6 · **no `case` entity**; §7.5 state on the conversation | **AI #1** | `chat.support_case` is load-bearing across **7 migrations** — conversation domain, RLS, authorization, ownership invariants, attention/workload, logs | Not a stray table. Removal touches authorization and RLS | **Do not delete opportunistically.** Plan: move `open / waiting on customer / waiting on Jawwid / resolved` + SLA timers onto `conversation`, migrate, then retire | D-2; blocks D-9 | conversation carries state + SLA; no `support_case` reference in authorization or RLS |
| **D-9** | §6 · `type ∈ direct, student_group, class_group, official` | **AI #1 + AI #2** | `chat.conversation` + `conversation_member` exists and is closest to the PRD | Admin Web still models one thread per family | Ratify as canonical; clients adopt | D-8 | family timeline spans **all** its conversations (§7.5) |

## Explicitly NOT blockers for runtime integration

Real gaps, correctly deferred until the contracts above settle — **do not patch opportunistically**:
Admin role/attention/workload/SLA vocabulary · missing *Pending approvals* inbox view ·
dashboard Notifications+Calls metrics · Student Groups / Approvals / Calling admin UI ·
`organization_id` in client models.

## Open product decisions — do not guess

| # | Question | Source | Blocks |
|---|---|---|---|
| **P-1** | Coverage admin: (A) permanent silent Student Group member, or (B) joins only during the coverage window | PRD §15.2 Q4 | group membership sync. **Does not block BR-1** — the required admin/supervisor membership rule stands either way |
| **P-2** | May parents *start* group calls, or only join? | PRD §15.2 Q5 | call-initiation authorization |
| **P-3** | Default SLA targets per attention state; initial workload weights/thresholds | PRD §15.2 Q6 | `config` seed values only — not the engines |

## Handoff — required conformance correction (not actioned here)

**To the owner of the RBAC implementation and tests (AI #1 / AI #5):**

1. `apps/admin-web/src/core/permissions/capabilities.test.ts` asserts
   *"has no super_admin role"*. **KNOWN WRONG** — PRD §3 lists `super_admin`.
   Left passing and unedited deliberately; must be corrected together with the
   role list, not silently.
2. `docs/qa/rbac-matrix.md` §1 states *"There is no `super_admin`"* — same defect,
   and it is the upstream source of (1).
3. Authoritative roles (PRD §3): `parent · student · teacher · admin ·
   coverage_admin · manager · super_admin`. **`finance`, `technical` and
   `academic` are not PRD roles** and appear in both the matrix and Admin Web.

## Process

No `git add -A`, `reset` or `clean` used. Explicit-path staging only. No AI #1 or
AI #2 file modified by this pass. PRD unmodified — hash re-verified after commit.
