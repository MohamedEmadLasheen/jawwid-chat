# Hand-off to AI #10 — Release Commander

**From:** AI #8 (Product · Business Operations · Domain Logic · Cross-Agent Intelligence)
**Date:** 2026-09-05 · **Baseline commit:** `d23bf93`
**Status of the sender:** AUDIT / CONFORMANCE mode. No implementation, no branch
reconciliation, no new business rules.

You own final reconciliation. This is everything I have, in the order I would use it.

---

## 0. One-paragraph situation

Scope is settled on paper and the architecture decision is now locked (standalone PostgreSQL,
SQL migrations authoritative, Core via an API/webhook boundary). The blocker is no longer
*what to build* — it is that **nine agents built in one working tree without an integration
point**, so the authoritative stack is spread across branches that cannot individually build a
database, the Node layer does not compile, and `main` is an empty initialisation commit.
Nothing has ever run end to end.

---

## 1. Top 15 conflicts

Full register: `cross-agent-audit.md`. Classification: `conflict-classification.md`.
Status as of pass 1: `audit-baseline.md`.

| # | Conflict | Class | Status |
|---|---|---|---|
| X-01 | Two persistence stacks own the same six tables | ARCHITECTURE CONFLICT | **decision made** — execution pending |
| X-02 | `can_message` default `false` vs `true` | IMPLEMENTATION BUG | **FIXED** |
| X-03 | Config namespaces diverge; Node fails quiet | IMPLEMENTATION BUG | CONFIRMED OPEN |
| X-04 | Thread `RESOLVED` vs "a conversation is never resolved" | CROSS-AGENT CONTRACT | partially resolved |
| X-05 | `WAITING_ON_CUSTOMER` inferred from who spoke last | IMPLEMENTATION BUG | FIXED in SQL · open in Node |
| X-06 | One group thread per family vs one per learner | **PRD VIOLATION** | FIXED in SQL · Prisma contradicts |
| X-07 | `jawwidSupport` **and** `adminDirect` for parents | OPEN PRODUCT DECISION | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| X-08 | Teacher barred from all family communication | SUPERSEDED-BRIEF ARTIFACT | partially fixed |
| X-09 | `FamilyDetail.capabilities` consumed, never produced | CROSS-AGENT CONTRACT | CONFIRMED OPEN |
| X-10 | Super Admin / CRITICAL workload | OPEN PRODUCT DECISION | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| X-11 | 3-state vs 4-bucket attention vocabulary | OPEN PRODUCT DECISION | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| X-12 | `message` append-only vs mutable soft-delete | ARCHITECTURE CONFLICT | CONFIRMED OPEN |
| X-13 | `userId` means two different ids | IMPLEMENTATION BUG | superseded by refactor |
| X-14 | Delivery audience follows the owner, not the handler | IMPLEMENTATION BUG | superseded → restated as **CF-01** |
| X-15 | Supabase/RLS vs Nest service authorization | ARCHITECTURE CONFLICT | CONFIRMED OPEN |

---

## 2. Seven blocking decisions

`open-decisions.md`. **OD-02 is now closed** by the locked architecture decision; six remain,
plus the AMB-9 restatement which must not be guessed.

| ID | Decision | Blocks | Note |
|---|---|---|---|
| OD-01 | Which reconciliation governs the conversation model | schema + authorization + all BR-1 tests | **partly overtaken by events** — AI #1 has landed a typed `chat.conversation`. Needs product ratification, not redesign |
| ~~OD-02~~ | ~~one database or two~~ | — | **CLOSED 2026-09-05** — standalone PostgreSQL, SQL authoritative, Core via API/webhook |
| OD-03 | What "required admin presence" in a Student Group means | BR-1's permitted case; AI #5 BR1-09 / SG-12 | **= AMB-9. Must NOT be guessed.** No recommendation is offered |
| OD-04 | Who is authoritative for teacher↔learner assignment | group membership, teacher app | now interacts with the Core API/webhook boundary |
| OD-05 | Is `adminDirect` a second parent↔staff channel | mobile chat list, attention, ownership | **UNVERIFIED — PRD SOURCE NOT PRESENT** |
| OD-11 | Who approves a group message when the owner is off duty | approvals | approval tables now exist in SQL; the rule does not |
| OD-13 | Is the class-schedule signal in MVP | attention engine calibration | depends on what the Core boundary can supply |

Non-blocking but decision-required: OD-06 (Super Admin / CRITICAL), OD-07 (workload
staleness), OD-08 (shift-boundary inclusivity), OD-09/OD-10 (follow-up ownership and overdue
handling), OD-12, OD-14, OD-15.

---

## 3. Critical operating-model gaps

Full statements — Problem · Business impact · Expected behaviour · Required invariant ·
Owner · Acceptance criteria · Blocking status — in `critical-findings.md`.

| ID | Gap | Owner | Release blocker |
|---|---|---|---|
| **CF-01** | Delivery audience follows ownership, not the Current Handler | AI #1 + AI #2 | **yes** |
| **CF-02** | Stickiness captures the handler role and ignores presence | AI #2 + AI #1 | **yes** |
| **CF-03** | Prisma still contradicts the SQL one-group-per-learner rule | AI #2 + AI #10 | **yes** |
| **CF-04** | Workload: no producers, no decay rule, no breakdown | AI #1 + AI #4 | no (P1) |
| **CF-05** | Conversation state can blame the customer for Jawwid's obligation | AI #2 + AI #4 | **yes** (Node) |
| **CF-06** | Renewal has no producer; auto-resolve exclusion unenforced | AI #1 | **yes** |
| **CF-07** | No case/task layer, so nothing can be overdue | AI #1 + AI #4 | **yes** |
| **CF-08** | Teacher identity inferred from `learner.teacher_id`, `isActive` hardcoded | AI #1 | **yes** before any deploy |

---

## 4. Database divergence

Full analysis: `database-divergence.md`. Three hard facts:

- **NF-01** — `apps/api` does not typecheck. Mid-refactor: `thread.service.ts` deleted while
  `message.service.ts` still imports it; Prisma enum exports gone.
- **NF-02** — **No branch can build a database from empty.** `20260905093000` references
  `chat.staff` / `chat.family` / `chat.learner` / `chat.thread`, created only in migrations
  that live on other branches.
- **NF-03** — `chat.on_duty()` is called by `SqlCoverageService` and **created by no migration**.

Eight things that must not be merged are listed as DB-M1 … DB-M8. The most important:
**no Prisma model may define a table that `chat.*` owns, and no `prisma migrate` step may
enter CI** — that would recreate a second migration authority the day after the decision to
have one.

---

## 5. Shared working-tree risk

Full document: `shared-working-tree-risk.md`. Three observed incidents: a cross-agent commit
that swept 15 of my files into `fa53ba7`, a stale finding published against already-fixed
code, and analysis invalidated by files deleted underneath it.

The two controls with the highest value, both yours to decide: **per-agent worktrees or
branches**, and **CI that blocks a merge on `typecheck` + `migrations apply from empty`** —
which would have caught NF-01 and NF-02 automatically, on the commit that introduced them.

---

## 6. Exact artifacts to inspect

**Read first, in this order:**
1. `docs/qa/authoritative-scope.md` — the operative scope record while PRD v0.1 is absent
2. `docs/product-operations/audit-baseline.md` — frozen findings + verification status
3. `docs/product-operations/database-divergence.md` — the release blocker
4. `docs/product-operations/critical-findings.md` — the seven operating-model gaps
5. `docs/product-operations/shared-working-tree-risk.md`
6. `docs/qa/release-gate.md` and `docs/qa/defects.md` — AI #5's gate and P0s
7. `docs/product-operations/conflict-classification.md` and `cross-agent-audit.md`
8. `docs/product-operations/open-decisions.md` and `decision-log.md`

**Verify these code facts yourself — they are the blocker's evidence:**
- `cd apps/api && npx tsc -p tsconfig.json --noEmit` → expect failure (NF-01)
- `ls supabase/migrations/` on each branch; grep `chat.staff|chat.family|chat.thread` in
  `20260905093000_chat_communication.sql` → expect unsatisfied references (NF-02)
- `grep -rn "chat.on_duty" supabase/migrations apps/api/src` → called, never created (NF-03)
- `apps/api/src/communication/messages/message.service.ts:199-200` → stickiness on every
  staff message (CF-02)
- `apps/api/src/platform/authorization.service.ts:130-131` → manager mode client-chosen (FS-12)
- `apps/api/src/platform/app-config.service.ts:52` → silent hardcoded fallback (X-03)
- `apps/api/prisma/schema.prisma` → `Thread @@unique([familyId, kind])` and Section C
  `/// DESIGN-ONLY` models still present (CF-03, DB-M2, DB-M8)
- `supabase/migrations/20260905093000_chat_communication.sql` →
  `conversation_one_group_per_learner` and `enforce_direct_conversation_rules()`: **the two
  best controls in the repository. Do not lose them in reconciliation.**

**Branch topology:**
`main` = empty init · `feat/backend-foundation` = staff/coverage/family migrations ·
`feat/communication-engine` · `feat/infrastructure` = current checkout, QA, Admin Web,
Flutter, communication migrations.

---

## 7. What I am explicitly not doing

- Not reconciling branches, and not merging anything.
- Not choosing a schema design.
- Not introducing business rules for Student Groups, approvals, calling, assist/escalation,
  workload weights, attention scoring, coverage policy, admin presence, or teacher assignment.
  All are documented as decisions, not implemented.
- Not guessing AMB-9 / OD-03.
- Not asserting conformance to PRD v0.1 where the PRD cannot be read. Those items carry
  **UNVERIFIED — PRD SOURCE NOT PRESENT**.

I remain in audit/conformance mode and will re-verify on request. Ownership of reconciliation
is yours.
