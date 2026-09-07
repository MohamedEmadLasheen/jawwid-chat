> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Integration Reconciliation · Step 1 — PRD

**Date:** 2026-09-06 · **Phase:** system integration reconciliation, step 1 of 12
**Method:** direct inspection of the current repository. No agent report was taken on trust.
**Worktree:** isolated — `integration/prd-reconciliation` @ `c0d755a`. Nothing in the shared
checkout was modified.

---

## 1. PRD verification — B-1 is CLOSED

| Check | Result |
|---|---|
| Path | `docs/product/jawwid-chat-prd-v0.1.md` — **not** the repo root as reported |
| `test -f` | present |
| SHA-256 | `3e63ec0127470b53b65f154651ab707b915771f3ca305a85c4374b9e60a1b697` |
| Expected | `3e63ec0127470b53b65f154651ab707b915771f3ca305a85c4374b9e60a1b697` — **✅ exact match** |
| Size | 69,331 bytes · 574 lines |
| Tracked | yes — `62ff312 docs(product): add approved Jawwid Chat PRD v0.1 as the product source of truth` |
| Working tree | clean for that path |

A byte-identical copy also exists at `~/Downloads/jawwid-chat-prd-v0.1.md` (same hash).

**No action taken and none required:** the file is already in an agreed docs location, already
tracked, already byte-exact. No move, no copy, no commit. `docs/design/FREEZE.md` **B-1
("PRD not on disk") is closed.**

**The PRD has now been read in full for the first time by any agent.** Sections 1–16. Everything
below follows from that reading.

## 2. The headline finding

For the entire project to date, every agent has graded its work against
`docs/JAWWID_CHAT_BRIEF.pdf` or against `docs/qa/authoritative-scope.md` — AI #5's
*second-hand summary* of a PRD nobody had read. AI #5 said so plainly and asked for the file.

That summary is good, and it got the big structural calls right (BR-1, phone privacy, Student
Groups / approvals / calling in MVP, permanent ownership). **But it is not the PRD, and on
seven points the repository now contradicts the actual document.** Five of those seven are
places where the *superseded brief* won by default, because the summary carried the brief's
vocabulary forward.

**My own frozen design pack is among the artifacts that are wrong.** Two of its release gates
would actively block PRD-conformant code. Details in §3; I have not modified the frozen pack.

## 3. PRD conformance deltas — P0

Each row: what the PRD requires, what the repository does, and the evidence.

### D-1 · Role model is wrong · **P0**
**PRD §3** defines seven roles: `parent · student · teacher · admin · coverage_admin ·
manager · super_admin`.
**Repo:** `chat.staff.role in ('admin','coverage','manager','finance','technical','academic')`
(`supabase/migrations/20260905090200_chat_staff_and_coverage_config.sql`), echoed in
`supabase/migrations/20260905091200_chat_rls.sql:95`.

Four separate defects:
- **`super_admin` exists in the PRD.** `docs/qa/rbac-matrix.md` states *"There is no
  `super_admin`"*; `docs/design/terminology.md` lists it as a forbidden word;
  `docs/product-operations/open-decisions.md` OD-06 records the current assumption as "no".
  **All three are wrong.** PRD §3 gives it *"Everything, plus users, roles, policies,
  templates, automations, integrations, audit logs"*, and §11.1 scopes contact data to
  *"manager and super_admin endpoints"*.
- **`coverage_admin`**, not `coverage`.
- **`teacher` and `parent` are roles**, not external actors bolted on later. This is the root
  of C-1 / OD-04, and the PRD answers it: teachers and parents are *users* in the same role
  system, provisioned from Jawwid Core (§7.1).
- **`finance` / `technical` / `academic` are not PRD roles at all.** They come from the
  superseded brief's departmental-task model. `docs/design/screens/tasks.md` builds a whole
  department surface on them.

### D-2 · Workload has four states, not three · **P0**
**PRD §5.3:** `Low · Medium · High · Critical`, and *"Critical can optionally open the owner's
families to a coverage admin."* Workload-triggered coverage is Phase 2 (§13 row 11), the
**state itself is MVP**.
**Repo:** no `critical` anywhere in workload code. `docs/qa/rbac-matrix.md`,
`docs/admin/backend-contract-required.md` §7 and `docs/design/` all assert three levels.
**`docs/design/design-qa.md` gate DQ-06 requires that the string "Critical" not exist in either
codebase.** That gate is wrong and would fail conformant code.

### D-3 · Attention states are wrong · **P0**
**PRD §5.4:** `Needs attention now · Needs attention soon · Normal` — three rule-based states
driving *"inbox ordering, notification priority, and dashboard counts"*.
**Repo:** `'now' · 'today' · 'quiet'` (+ waiting-on-family), the superseded brief's four
buckets, in `supabase/migrations/20260905090800_chat_attention_and_workload.sql`.
The brief's computed-score-and-`top_reason` model is a *different design*: PRD attention is a
state with enumerated triggers, not a score with a hidden reason string.

Note: the original AI #3/#4/#6 role assignments all said "needs attention now / soon / normal".
**They were right.** They were overruled in favour of the brief, by me among others.

### D-4 · "SLA" is PRD vocabulary · **P0 (gate defect)**
**PRD** uses SLA throughout: §5.3 `sla_at_risk` as a workload input; §5.4 *"SLA about to
breach"*; §7.5 *"SLA timers per state"*; §8.1 *"SLA at risk"* as an operations event; §10.2
*"SLA at risk, SLA breached"* as dashboard metrics.
**Repo:** `docs/design/design-qa.md` gate **DQ-07** requires that *"the string 'SLA' appears in
no user-facing copy in either language"*, and `docs/design/terminology.md` lists it forbidden.
19 SLA references exist in migrations; **zero** in `apps/api/src`.
Two defects: a QA gate that forbids required vocabulary, and an SLA engine that stops at the
database.

### D-5 · Conversation state model is wrong · **P0**
**PRD §7.5:** conversation state is `open / waiting on customer / waiting on Jawwid / resolved`,
**with SLA timers per state, both configurable**, on the *conversation*.
**Repo:** the brief's `case` entity with `open/waiting_customer/waiting_internal/scheduled/
resolved/closed`. **The PRD has no `case` entity at all** — §6's domain model lists
Conversation, Message, Approval, Task/Follow-up, Call, and no case. What the brief called a
case, the PRD splits into conversation state (§7.5) plus Task/Follow-up (§7.6).
This is a domain-model divergence, not a naming one, and it propagates into every admin screen.

### D-6 · `organization_id` is entirely absent · **P0**
**PRD §2.3:** *"the data model carries an `organization_id` on every root entity from day one so
a future SaaS conversion is a migration, not a rewrite."* §6 lists it as the first attribute of
Family.
**Repo evidence:** `organization_id` / `organizationId` — **0 occurrences** in
`supabase/migrations/`, **0** in `apps/api/src`, **0** in `apps/api/prisma/schema.prisma`.
This is the cheapest defect to fix now and among the most expensive later; it is exactly the
scenario the PRD sentence was written to prevent.

### D-7 · Jawwid Core coupling violates the PRD · **P0 — confirms CF-09**
**PRD §2.3:** *"Jawwid Chat integrates through an API or a dedicated integration layer, **never
by reading Jawwid Core's database directly**."*
**PRD §12.4:** *"A dedicated **integration service** owns all traffic with Jawwid Core… Jawwid
Chat application code never touches Jawwid Core's database."*
**Repo:** the architecture is a `chat` schema **inside the Jawwid Core database**, reading Core
through `chat.core_*` boundary views —
`supabase/migrations/20260905090000_chat_foundation.sql:7,17` and
`20260905090900_chat_core_integration.sql`.

The boundary views are careful, well-commented work. They are also the precise architecture the
PRD forbids. **OD-02 ("one database or two?") is not an open question — the PRD answers it:
two, with an integration service.** This also invalidates the premise recorded as E1 in
`docs/design/discovery.md`.

## 4. PRD conformance deltas — P1

| # | PRD | Repo | Note |
|---|---|---|---|
| **D-8** | §7.4: approver = **the family's active handler (owner, or coverage admin during coverage)** | OQ-1 recorded as an open decision across `docs/design/`, `open-decisions.md` | **OQ-1 is CLOSED by the PRD.** My withdrawn recommendation was substantively right; I withdrew it partly for fear it constituted Phase 2 "coverage-aware approver" — the PRD's Phase 2 item is *approver by shift and coverage **rules***, which is a different, richer thing |
| **D-9** | §7.4: a pending message is *"visible only to the sender"* **and** *"to approvers in an Approvals queue **and in the group thread**"* | `docs/design/cross-platform.md` §2 and `screens/approvals.md` §5 say pending is invisible to everyone but the sender | Approvers must see pending messages inline in the thread |
| **D-10** | §7.3: coverage admins join Student Groups automatically during coverage **or are permanent silent members, configurable** | OD-03 treats "required admin presence" as undecided | PRD §15.2 Q4 keeps the *default* open, but the *mechanism* is specified |
| **D-11** | §6: conversation types `direct · student_group · class_group · official` | `vocab.ts:40-42` has student_group/class_group/official ✅ but DB is `check (type in ('direct','group'))` — `20260905093000_chat_communication.sql:656` | **Code and schema disagree on the type enum.** Directly relevant to RT-024 (BR-1 type-mutation bypass) |
| **D-12** | §12.5: DB constraint — a `direct` conversation *"may not have both a teacher member and a parent member"*, by trigger/check on membership rows | To verify in step 4 | The PRD specifies the defence-in-depth RT-024 needs |

## 5. Repository integrity finding — a silent cross-branch schema import

Not a PRD question, but it materially affects "database authority/reconciliation", and it was
found while establishing which migrations are real.

`c0d755a` — **"ci(qa): guard protected security regression tests against deletion (JC-011)"** —
changed **30 files, +3,384 lines**, of which **14 are database migrations added wholesale**:
identity, staff/coverage config, family domain, conversation domain, logs, coverage engine,
ownership invariants, attention/workload, Core integration, idempotency, authorization,
application roles, RLS, policy privileges.

Those migrations originate on `feat/backend-foundation` (`3c2c9a6 feat(db): attention and
workload engines` and siblings), which is **not an ancestor** of the commit before it. So the
entire database layer arrived on `feat/infrastructure` inside a commit whose message describes
a CI guard. **A reviewer reading the log would not know the schema had moved branches.**

Two consequences:

1. **The schema arrived without most of its tests.** `feat/backend-foundation` carries **10**
   files under `db/`; `feat/infrastructure` carries **3**. Seven SQL test files — the executable
   evidence for coverage, ownership, attention and workload — were left behind.
2. **The good news:** the 15 shared migrations are **byte-identical** between the two branches.
   `git diff feat/backend-foundation c0d755a -- supabase/migrations/` shows only the 4
   communication migrations that infrastructure adds. There is no schema divergence to
   reconcile — only a provenance and test-coverage gap.

This is the sixth recorded cross-agent incident (`7e7de45 docs(release): record incident I-6`).
It is also why this reconciliation runs in an isolated worktree.

## 6. Consequences for the ordered reconciliation

| Step | Effect of §3–§4 |
|---|---|
| **2 Domain** | Blocked until D-1 (roles), D-5 (no `case` entity; conversation state + tasks) and D-6 (`organization_id`) are settled. The domain model in PRD §6 is the target, and it is not what is built. |
| **3 Database** | D-6 is a migration touching every root table — **do it before more tables exist**. D-7 decides whether the schema lives in Core's database at all, which is upstream of every other schema question. D-11's enum mismatch is a correctness bug. The 7 missing SQL tests must come across with the schema. |
| **4 Authorization** | PRD §12.5 specifies a single `canCommunicate(actor, target, channel, context)` plus a DB-level membership constraint. RT-024 and JC-002 are both instances of that not existing yet. D-1 changes the role enum this layer switches on. |
| **5–7 Communication / Realtime / API** | D-3, D-4, D-5 change attention, SLA and conversation state — i.e. the payloads of the inbox, the dashboard and every realtime event. Reconciling these before D-3/D-4/D-5 are settled would be rework. |
| **8 Infrastructure** | D-7 decides deployment topology (one managed Postgres for Chat + an integration service, vs a schema inside Core). |
| **9–10 Mobile / Admin** | Both render attention states, workload levels and conversation state. All three change. The token reconciliation (`docs/design/token-reconciliation.md`) is unaffected and can proceed independently. |
| **11–12 E2E / Red Team** | `docs/qa/rbac-matrix.md` must be regenerated against seven roles including `super_admin`. Design gates **DQ-06** and **DQ-07** must be corrected before they are adopted, or they will fail conformant code. |

## 7. What I did not do

- Did not modify the frozen design pack, despite finding conformance defects in it (D-2, D-3,
  D-4, D-5, D-1's `super_admin`). They are reported here for the owner to action.
- Did not modify any schema, migration, authorization rule, or application code.
- Did not resolve OD-01, OD-02, OD-03 or OD-04. §3 shows the PRD *already answers* OD-02 and
  OD-04's identity half, and §4 shows it answers OQ-1 — but recording that is the product
  owner's call, not mine.
- Did not touch the shared checkout, and used no `git add -A`, `git reset` or `git clean`.
- Did not proceed to steps 2–12. Doing so before D-1…D-7 are decided would produce rework, and
  several of them are product decisions rather than integration ones.

## 8. Recommended immediate sequence

1. **Product owner confirms D-1 … D-7** — these are readings of the PRD, but five of them
   reverse decisions the team has already built on, so they should be confirmed, not assumed.
2. **D-6 (`organization_id`) lands first.** It is cheap now and touches every root table.
3. **D-7 (Core coupling) is decided next** — it is upstream of all remaining schema work.
4. **Correct DQ-06 and DQ-07** before AI #5 adopts them as release gates.
5. **Bring the 7 missing SQL tests** across with the schema they validate.
6. Only then continue to step 2 (Domain).

**Release status is unchanged: NOT READY — SYSTEM INTEGRATION BLOCKED.** Nothing in this step
was an executable-proof activity; the empty-DB → migrations → API → auth → HTTP → Postgres →
realtime → workers → mobile/admin → E2E → security chain has not been demonstrated.
