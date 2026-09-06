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
