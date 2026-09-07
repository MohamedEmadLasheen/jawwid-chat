> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). The freeze it describes was executed by Phase 0; see `docs/recovery/PHASE-0-BRANCH-LEDGER.md` and `PHASE-0-REPORT.md`.
> Canonical index: `docs/README.md`.

# Jawwid Chat — AI #10 Handoff

Date: 2026-09-06 · Owner: AI #10 (Release & Integration Commander)
Status: **WORK FROZEN AT AUDIT / RECONCILIATION STATE** by product-owner instruction.

Release verdict unchanged: **🔴 NOT READY.**

## Scope of this freeze

No further implementation by AI #10. Specifically untouched: database migrations,
CI, deployment configuration, application code. Nothing committed. The five
release documents stand as written:

`reconnaissance.md` · `database-decision.md` · `branch-reconciliation.md` ·
`blockers.md` · `integration-matrix.md` · `release-scorecard.md`

(`cross-agent-product-conformance.md` and `integration-risk-register.md` in this
directory are AI #4's and independently corroborate the same conclusions.)

---

## 1. Definitively decided

| # | Decision | Record |
|---|---|---|
| D-1 | Jawwid Chat owns its **own PostgreSQL database** | `database-decision.md` |
| D-2 | Independent of Second School and Jawwid Core — no shared database, auth, infrastructure, secrets or deployment | `database-decision.md` |
| D-3 | Exactly **one** authoritative schema and migration system | `database-decision.md` |
| D-4 | **OD-02 is closed: SQL migrations are that authority** | `database-decision.md` |
| D-5 | No competing migration authority. Prisma is a **query client only**; `prisma db push`/`migrate` prohibited | `database-decision.md` |
| D-6 | Jawwid Core is an **API/webhook integration boundary**, never a database relationship | `database-decision.md` |
| D-7 | PRD v0.1 is the product source of truth; the PDF brief is superseded — its **operating-model chapter survives**, its communication chapter does not | `authoritative-scope.md` §3 |
| B-1 | Branch verdicts: `main` KEEP · `feat/backend-foundation` KEEP AS DB AUTHORITY, REWORK FIRST · `feat/communication-engine` DISCARD THE BRANCH NOT THE WORK (0 unique commits, verified) · `feat/infrastructure` KEEP AS INTEGRATION BRANCH | `branch-reconciliation.md` |
| B-2 | **No merge on the strength of a clean `git merge`.** Textual non-conflict is the symptom, not the clearance | `branch-reconciliation.md` |

**Closed by execution, not assertion** — the only two gates this project has
actually closed:

- **JC-005** — assist/escalation privilege escalation. Fixed, fail-closed, original assertions verified intact.
- **JC-006** — offboarded staff retaining internal-note access. Fixed.

---

## 2. Still blocked

**Product decisions — not mine to make, and no assumption has been recorded**

- **OD-01** — which reconciliation governs the conversation model. Two conflicting owner statements are on record. Every downstream item marked `UNVERIFIED (needs PRD)` waits here. **I have made no assumption about it and BF-2 is written as a requirement, not a design.**
- **OD-03/04/05** and the remaining domain questions — retained under release authority pending PRD v0.1, per instruction 9. Not delegated, not assumed.
- **RC-13** — PRD v0.1 is not in the repository. Scope is graded against a secondary source. This is the single largest correctness risk in every document I have written.

**Engineering blockers — owners assigned, fixes and acceptance criteria specified in `blockers.md`**

| ID | Title | Owner |
|---|---|---|
| RC-01 | No API process; production container crash-loops | AI #1 + AI #7 |
| RC-02 | Outbox has no consumer — realtime and notifications dead | AI #2 |
| RC-03 | Auth mismatch + WebSocket accepts client-declared identity (RT-001, P0) | AI #1 |
| RC-04 | Realtime namespace and event contracts disjoint | AI #2 + AI #4 |
| RC-05 | 34+ admin endpoints, 3 backend routes | AI #1 + AI #2 |
| RC-06/07 | Competing schema/migration authorities — **decision issued, not executed** | AI #1 + AI #2 |
| RC-11 | No observability, no rehearsed recovery, no runbooks | AI #7 |
| RC-12 | Red Team transport/queue/storage/chaos surfaces **NOT TESTED** | AI #9 |
| JC-001/002/003 | Student Groups, approvals, calling, Teacher-as-actor | AI #1 + AI #2 |
| RT-003 | Manager `on_behalf_mode` still client-chosen — audit integrity | AI #1 |
| RC-08/09/10 | Prod env template fails its own gate · covering admin absent from delivery audience · append-only conflict | AI #7 · AI #1/#2 |

**Not a pass, and must not be reported as one:** the 23 `BR1-01…BR1-20`
conformance cases are `it.todo` — declared, never written. Red Team is PARTIAL.
Mobile is BLOCKED (no Flutter toolchain on any host). Zero areas on the scorecard
are PASS.

---

## 3. Before implementation resumes

In order. Steps 1–2 are not engineering work.

1. **PRD v0.1 into `docs/`.** Product owner. Until then no scope gate can move off `UNVERIFIED`.
2. **OD-01 answered in writing.** Product + architecture. BF-2, JC-001, JC-002 and the whole conversation model wait on it; none should be started before it.
3. **BF-1 — remove the Core-database premise** from the SQL stack: `auth.uid()`, `auth_user_id` as a Core identity, the verbatim `public.subscriptions.status` CHECK mirror, the promised `chat.core_*` views, `db/test/00_core_shim.sql`, and the CI step that applies it. *Note for whoever picks this up:* `chat.current_staff_id()` calling `auth.uid()` does not fail in Chat's own database — it returns NULL, so every ownership guard built on it misattributes silently. It is a data-integrity bug wearing a security control's clothes.
4. **Demote Prisma** to a query client: delete `prisma:push`, reconcile `schema.prisma` to the SQL schema, adopt the SQL config keys and their fail-loud semantics.
5. **Merge `feat/backend-foundation` → `feat/infrastructure`** — only after a human confirms **in writing** that the merged tree contains exactly one definition of each of `staff`, `family`, `contact`, `config`, `event_log`, `audit_log`, `thread`, `message`. A green `git merge` is explicitly not that confirmation.
6. **Then, and only then:** RC-01 (the app boots) → RC-02 → RC-03/04/05. RC-01 is the highest-leverage item in the project: fourteen rows of `integration-matrix.md` become testable the moment the application starts, and AI #9's deferred campaign, all E2E journeys, chaos and recovery are all downstream of it.

**Standing rule carried forward:** no agent may add a second implementation of a
domain that already has one. A second schema authority, authorization matrix,
attention engine, conversation model or migration path is a release blocker on
sight, regardless of quality or of who wrote it first.

---

# Addendum — 2026-09-06 · STEP 1 BLOCKED

## BLOCKED — EXACT APPROVED PRD REQUIRED

Step 1 requires PRD v0.1 to exist as an actual repository artifact. It does not,
and I will not reconstruct it. Steps 2, 3 and 7 (`domain-reconciliation.md`,
OD-01, `entity-authority-matrix.md`) are therefore **not started**: each would
require me to assert product requirements I cannot source.

### Search performed (2026-09-06)

| Where | Result |
|---|---|
| Working tree, all paths | no file matching `*prd*` |
| All four branches (`git ls-tree -r`) | none on any branch |
| Full git history, all refs (36 commits) | **never tracked; `--diff-filter=D` shows none was ever deleted** |
| Stashes | none |

The PRD has never been in this repository at any point in its history. Its
absence is not an accident of the current checkout.

**Not used, deliberately:** the superseded `docs/JAWWID_CHAT_BRIEF.pdf`, and the
Second School PRDs under `~/Documents/ss-*` / `second-school*` (a different
product; opening them would corrupt this one's scope). The operative record
remains `docs/qa/authoritative-scope.md` §3 — AI #5's summary, a **secondary
source** — and every conclusion graded against it stays `UNVERIFIED (needs PRD)`.

**Required to unblock:** the exact approved PRD v0.1 content, placed in `docs/`.
Nothing else substitutes for it.

---

## New evidence since the freeze — one prior statement of mine is now wrong

I described the SQL stack as coherent and its migrations as a sound foundation.
**That is no longer accurate and the correction matters**, because the merge
sequence in `branch-reconciliation.md` §5 assumes a migration chain that applies.

**RT-023 (P0, AI #9, CONFIRMED at runtime) — the migration series does not apply
to an empty database.** I re-verified it statically, without touching any
database:

```
referenced by FK but created by no migration:
  chat.family   chat.learner   chat.message   chat.staff   chat.thread
```

Root cause is the branch split itself: those five tables exist only on
`feat/backend-foundation`, while the working tree carries `chat_foundation`,
`chat_config_defaults` and three **new** communication migrations. The chain is
incomplete on the integration branch. RC-07's acceptance criterion "empty DB →
apply all → app starts" now has a proven failure, not merely an untested one.

Consequences for the plan already recorded:
- `branch-reconciliation.md` §5 step 3 (merge `feat/backend-foundation` →
  `feat/infrastructure`) is now also the **repair** of the migration chain, not
  just a schema-authority decision. It cannot be sequenced after step 4.
- CI gate G-19 is failing for this reason, not for a configuration reason.

**Governance observation, offered as fact rather than as a request.** The working
tree has gained `chat.conversation`, `chat.conversation_member`, `chat.call`,
`chat.call_participant`, `chat.message_approval` and `chat.device_token` —
a typed conversation model with `direct` / `student_group` / `class_group` types
and BR-1 enforcement triggers. This is implementation of exactly the model OD-01
is meant to decide, landing **before** the PRD that would settle it. AI #9 has
already attacked it and found two P0s in it (**RT-024**: a `student_group`
containing a teacher and a parent can be `UPDATE`d to `type='direct'`, defeating
the BR-1 trigger, with calling identically bypassable; **RT-025**: the trigger
checks `type='direct'` only, so `class_group` is entirely out of scope). Both are
confirmed by execution.

I have changed nothing in response. Recording it because the freeze applies to
me, and other agents in this shared tree are continuing to write the domain model
that Steps 2 and 3 exist to reconcile.

---

## Status

# NOT READY — RECONCILIATION BLOCKED
# STEP 1 BLOCKED — EXACT APPROVED PRD REQUIRED

Frozen at audit/reconciliation state. No migration, CI, deployment or
application file modified by AI #10.

**Correction on commit state.** I stated earlier that the release documents were
uncommitted. They are now committed — **not by me**. Another agent working in
this shared tree swept them into `aaca900 docs(release): branch reconciliation
plan and database decision`, and this file into `37108eb`. All nine files in
`docs/release/` are now tracked. AI #10 has run no `git add`, `commit`, `reset`
or `clean`. This is the shared-worktree hazard already recorded in
`integration-risk-register.md`, observed happening.

---

# Addendum — 2026-09-06 · STEP 1 CLEARED

## PRD v0.1 = AVAILABLE + AUTHORITATIVE

| | |
|---|---|
| Path | `docs/product/jawwid-chat-prd-v0.1.md` |
| sha256 | `3e63ec0127470b53b65f154651ab707b915771f3ca305a85c4374b9e60a1b697` |
| Size | 69,331 bytes · 574 lines (no trailing newline) |
| Commit | `62ff312b841eb8906e6fec6001dcbedf8dedffb0` — **one file, nothing else** |
| Verification | source vs destination `cmp` → identical; hash confirmed before the move, after the move, and **on the committed git blob itself** (`git show HEAD:… \| shasum -a 256`), proving no line-ending or newline normalisation occurred |
| Copies in tree | exactly one — the root copy was removed after verification |

**RC-13 is closed.** It was the only blocker on the product source of truth, and
the root cause of the divergence that produced two conflicting communication
models built by five agents from second-hand summaries.

Approved by the product owner as the source of truth for implementation,
notwithstanding the document's internal "Draft for review" status line. That
approval is recorded here because the discrepancy is on the record.

### What this does and does not change

**Does:** `docs/product/jawwid-chat-prd-v0.1.md` now governs Jawwid Chat.
`JAWWID_CHAT_BRIEF.pdf` is superseded, retained as a historical artifact only.
`docs/qa/authoritative-scope.md` §3 is now **secondary**; where it and the PRD
differ, the PRD wins and the difference is a finding to record.

**Does not:** no other blocker changes status. Every gate marked
`UNVERIFIED (needs PRD)` is still unverified — the PRD makes that work
*possible*, it does not perform it. OD-01 is still open; it must be resolved
**only** by reading this file, and I have not read it for that purpose.

Release status is unchanged: **NOT READY — RECONCILIATION BLOCKED.**

### Note on commit scope

Per instruction, commit `62ff312` contains **only** the PRD. The three
reconciliation documents updated to record this status — `blockers.md`,
`release-scorecard.md` and this file — are **left uncommitted** and are
unstaged. No branch was merged, no cleanup performed, no other agent's work
touched. Staging used explicit paths only; no `git add -A`, `reset` or `clean`.
