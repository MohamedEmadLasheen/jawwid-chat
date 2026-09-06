# PRD v0.1 Conformance — Authoritative Re-grade

Date: 2026-09-06 · Auditor: AI #4 · Phase 1: ✅ **RESOLVED** · Overall: 🔴 **NOT READY**

## 1. Phase 1 verification record

| Check | Result |
|---|---|
| Path | `docs/product/jawwid-chat-prd-v0.1.md` ✅ |
| SHA-256 | `3e63ec0127470b53b65f154651ab707b915771f3ca305a85c4374b9e60a1b697` ✅ **exact match** |
| Committed | `62ff312` — by another agent, not this pass ✅ |
| Working-tree modification | none (`git status` clean for the path) ✅ |
| Byte-identical to the recovered original | ✅ `diff -q` clean vs `~/Downloads/jawwid-chat-prd-v0.1.md` |
| Content edited by me | **No.** Recovered, verified, not authored |

Three copies on disk all hash-match. The file was already in place and correct;
this pass **verified** it rather than creating it.

**Source-of-truth hierarchy now in force:** PRD v0.1 → Design Pack → agent implementation.
`docs/JAWWID_CHAT_BRIEF.pdf` is superseded. `docs/qa/authoritative-scope.md` is
demoted from "GOVERNING" to a secondary summary — useful, but **not** authority,
and wrong in at least one material respect (§3).

## 2. What the PRD settles that was previously blocked

### AMB-9 / OD-03 — **RESOLVED BY THE PRD**

> **BR-1:** *"Teachers and parents communicate only inside the official Student
> Group, **where the assigned admin/supervisor is a member**."*
>
> **§7.3:** *"One official Student Group per student, created automatically from
> Jawwid Core relationships: the parent, every assigned teacher, and **the
> family's primary owner**."*

**"Required admin presence" means MEMBERSHIP** — specifically, the family's
primary owner is a member of the group by construction. It is **not** online
status and **not** on-duty status.

Two corollaries the PRD supplies directly:
- The *approver* is a different concept: §7.4 — *"approver = the family's active
  handler (owner, or coverage admin during coverage)"*. Presence = membership;
  approval authority = active handler. **These must not be conflated.**
- A group cannot lose its admin: §5.1 blocks deactivation until the manager
  reassigns every owned family.

**Residual, and explicitly the PRD's own open question #4:** whether coverage
admins are permanent silent members of every group or join only during coverage.
→ **PRODUCT DECISION REQUIRED**, but it does **not** block BR-1.

### B-1 — one official Student Group per student: **RESOLVED — YES**
§7.3, first line. A uniqueness constraint on `(student, official group)` is now
justified. Class Groups are Phase 2 but `conversation.type` must support them
from the start.

### B-5 / AMB-11 — approval scope: **RESOLVED**
§7.4 + BR-6: two switches, `teacher_requires_approval` and
`parent_requires_approval`, per group type, both defaulting **on** for Student
Groups. Admin/coverage/manager messages **never** require approval. Applies to
every message type. Pending messages **never expire** in MVP.

## 3. Corrections — beliefs held by this team that the PRD contradicts

These were all inherited from the superseded brief or from a secondary summary.
Each is now falsified by direct citation.

| # | Belief held | PRD says | Impact |
|---|---|---|---|
| C-1 | *"There is no `super_admin` role"* — `docs/qa/rbac-matrix.md` §1, and my own passing test | §3 lists **`super_admin`** — system owner, with users/roles/policies/templates/automations/integrations/audit | **AI #5's RBAC matrix is wrong**, and my test asserts the error. Both need correcting |
| C-2 | Staff roles include `finance`, `technical`, `academic` | §3 roles are exactly: `parent · student · teacher · admin · coverage_admin · manager · super_admin` | Those three roles **do not exist in the PRD**. My department task-scoping is unsupported |
| C-3 | Attention buckets are `NOW / TODAY / WAITING ON FAMILY / QUIET` | §5.4: **`Needs attention now` / `Needs attention soon` / `Normal`** — three states | My four-bucket vocabulary is brief-derived and **wrong** |
| C-4 | Workload has no `CRITICAL` level | §5.3: **Low / Medium / High / Critical**; Critical notifies the manager and *"can optionally open the owner's families to a coverage admin"* | My `WorkloadLevel` union is **missing a state** |
| C-5 | Conversation states live on a `case` entity | §7.5: state is on the **conversation** — `open / waiting on customer / waiting on Jawwid / resolved`, **with SLA timers per state** | **There is no `case` entity in the PRD** (§6 entity table). My case model is unsupported; my original four states were right |
| C-6 | "SLA" was superseded by "response targets" | SLA is used throughout: §5.4, §7.5, §10.2 (`SLA at risk`, `SLA breached`) | My rename away from SLA was wrong |
| C-7 | Approvals, Student Groups and calling are out of MVP | §13 items 2, 3b, 6, 7: **all Full MVP** | The 2026-09-05 scope decision was taken on a false premise (see §4) |
| C-8 | One thread per family | §7.5: *"the full timeline **across all of the family's conversations**"*; §6 `conversation.type ∈ {direct, student_group, class_group, official}` | Confirms C-2/RT-024 direction; my model is wrong |
| C-9 | Domain model needs no tenancy key | §2.3: **`organization_id` on every root entity from day one** | Absent from every client model I wrote |

## 4. The scope decision that must be revisited

On 2026-09-05 I asked whether the brief or my role assignment governed, and was
told *"PRD wins — drop approvals, calls and student groups."* **That decision was
correct in principle and wrong in effect**, because at the time "the PRD" was
believed to be the brief. The actual PRD makes all three **Full MVP**.

Ironically my original role assignment was closer to the PRD than the brief was
on attention states, workload levels, conversation states and inbox views. The
brief is what led this team astray, and it did so credibly because it said of
itself *"this brief is the contract for what to build."*

## 5. Admin Web conformance re-grade

Labels: `IMPLEMENTED` (built, PRD-conformant, untested against a server) ·
`VERIFIED` (proven by executable test) · `NOT VERIFIED` · `BLOCKED` ·
`PRODUCT DECISION REQUIRED`.

| Area | PRD ref | Grade | Note |
|---|---|---|---|
| Ownership: owner ≠ handler, manager-only, reason, audit | BR-4, §5.1 | **VERIFIED** | 8 tests. Conformant |
| Coverage: schedule/manual, owner→coverage windows | §5.2, §13-11 | **IMPLEMENTED** | Conformant; workload-triggered coverage is Phase 2 — correctly absent |
| Family panel (parent, children, teachers, next class, subscription, payment, renewal, owner+handler, tasks) | §7.5 | **IMPLEMENTED** | Matches the PRD's enumerated panel. Missing: recent calls, cross-conversation timeline |
| Internal notes, staff-only | §7.5 | **VERIFIED** | 5 tests |
| Phone never rendered | BR-2 | **VERIFIED** | Stricter than PRD (no field at all). Conformant |
| Handoff with a note | §7.5 | **IMPLEMENTED** | Present as pin/defer; PRD also wants explicit "hand off to another admin with a note" |
| Tasks & follow-ups | §7.6 | **IMPLEMENTED** | Types match: follow-up, renewal, payment, complaint, onboarding, custom |
| Manager Dashboard | §10.2 | **PARTIAL** | Load/Responsiveness/Backlog/Coverage present; **Notifications and Calls metrics missing** |
| Inbox views | §7.5 | **PARTIAL** | PRD's 7 views: My families · Waiting for my reply · Under my coverage · Needs attention now · Follow-ups due today · **Pending approvals** · Unassigned. I built 5 and **omit Pending approvals** |
| Attention states | §5.4 | **NOT VERIFIED — REWORK** | C-3: three states, not four buckets |
| Workload states | §5.3 | **NOT VERIFIED — REWORK** | C-4: add `Critical` |
| Conversation state + SLA timers | §7.5 | **NOT VERIFIED — REWORK** | C-5/C-6: move state to conversation, restore SLA naming, drop `case` |
| Role model | §3 | **NOT VERIFIED — REWORK** | C-1/C-2: add `super_admin`, `coverage_admin` naming, `teacher`; remove finance/technical/academic |
| Conversation model | §6, §7.5 | **BLOCKED BY DOMAIN** | C-8. Adopt `conversation.type` + membership |
| Approvals queue | §7.4, §13-3b | **BLOCKED** | Backend produces `approval.requested`; **no admin consumer exists** |
| Student Groups (admin side) | §7.3 | **BLOCKED** | Not built |
| Calling + call history | §9, §13-6/7 | **BLOCKED** | Not built |
| Admin panel modules (Templates, Automations, Notifications log, Reports/Audit, Users/Sessions/Devices, Teachers & assignments) | §10.1 | **NOT BUILT** | Substantially larger surface than delivered |
| `organization_id` | §2.3 | **NOT VERIFIED** | C-9: absent from client models |
| Realtime | §12 | **BLOCKED** | 10 of 11 events have no producer; CORS/namespace block the socket |
| API | — | **BLOCKED** | 0 of 34+ endpoints implemented |

## 6. Still blocked, unchanged by Phase 1

| ID | Status |
|---|---|
| **RT-024 / JC-008** — BR-1 bypass via `UPDATE conversation.type='direct'`; calling identical | **OPEN — P0.** PRD BR-1 says *"enforced server-side and in the database"*, so the trigger gap is a direct PRD violation. Owner **AI #1**; I did not touch the migration or the authorization layer |
| **DA-1 / RT-023** — migration series cannot apply from zero | **OPEN.** Standalone DB conversion is otherwise verified (23 tables, 7 views, 61 functions, 38 RLS policies, 177 assertions, no Supabase/Second School artifacts) |
| **DA-2** — no Prisma migrations directory; two authorities | **OPEN** |
| Realtime operational-event architecture gap | **OPEN** — communication events are conversation-scoped; the Admin Inbox needs family/staff/ownership/coverage/workload events |
| PRD open questions #4, #5, #6 | **PRODUCT DECISION REQUIRED** — coverage-admin group membership mode; whether parents may start group calls; default SLA targets and initial workload weights |

## 7. What I did not do

- Did not author, edit, summarise or replace the PRD.
- Did not touch `supabase/migrations/*` or the authorization layer (AI #1, mid-edit).
- Did not create a competing communication implementation (AI #2).
- Did not implement any Phase 2–8 change. This pass is verification and grading only.
- Did not change a passing test to match a new belief — the `super_admin`
  assertion in `capabilities.test.ts` is now **known-wrong** and is recorded here
  for correction under the normal rework path, not silently edited.
