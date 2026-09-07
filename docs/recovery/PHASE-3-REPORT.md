# Phase 3 — Families, Students, Groups, Supervisors & Labels

**STATUS: CANONICAL.** What Phase 3 built, what it deliberately did not, the
defects found on the way, and the verification record.

Read with `recovery/PHASE-1-REPORT.md` and `recovery/PHASE-2-REPORT.md`, which
this builds on without changing.

---

## 1. The principle

> Current relationships must be mutable without destroying historical truth,
> and a historical relationship must never grant current access.

Everything below follows from those two sentences. `Ahmed → Islam → Mahmoud`
leaves Mahmoud current and Islam queryable. `Zainab → Dina` gives Dina access,
takes it from Zainab, and keeps Zainab in the record.

## 2. What already existed

Phase 3 found more in place than the brief assumed.

* **Supervisor transfer was already correct.** `chat.family_assignment` and
  `chat.assign_family_supervisor()` (Phase 1) already ended the previous
  assignment and opened the new one in one transaction, with a partial unique
  index permitting one live primary. **It was not rebuilt.** Phase 3 added the
  read surfaces, the messaging follow-through and the tests.
* **`chat.family.state` was already the family lifecycle** — six values, with a
  CHECK constraint and no state machine. No second lifecycle was introduced.
* **Scope was already live-read** from the assignment table on every request.
* **Permissions were already data** (`chat.permission` / `chat.role_permission`)
  with a TypeScript mirror asserted equal by test.
* **`syncStudentGroup` already existed** as the membership reconciler. Phase 3
  uses it and adds no second mechanism.

## 3. What Phase 3 added

### Database — four migrations

| Migration | Adds |
|---|---|
| `20260907130000_chat_phase3_family_and_learner.sql` | the Phase 3 `event_log` vocabulary · `chat.family_state_is_active()` · `chat.activate_family()` / `chat.deactivate_family()` · learner `is_active` / `deactivated_at` / `deactivated_reason` · **`chat.learner_teacher_assignment`** with its guard, mirror, backfill and `chat.assign_learner_teacher()` |
| `20260907130100_chat_phase3_groups.sql` | **`chat.group`**, **`chat.group_member`**, **`chat.group_teacher`** · lifecycle and archive-immutability triggers · `close_group` / `archive_group` / `create_replacement_group` |
| `20260907130200_chat_phase3_labels.sql` | **`chat.label`**, **`chat.family_label`** · `chat.delete_label()` (soft) |
| `20260907130300_chat_phase3_rbac_and_runtime.sql` | six permission keys + role mapping · `chat_app` grants · Phase 3 write policies · **three pre-existing policy defects corrected** |

**Why the event vocabulary moved to migration 1.** `chat.event_log.type` is a
closed CHECK. The whole Phase 3 vocabulary — including the group and label types
that migrations 2 and 3 emit — is admitted in the first migration, because
otherwise an operator who applies `130000` and stops has a
`chat.assign_learner_teacher()` that raises a check violation on its own audit
trail. Found by execution.

### The history model

Two assignment tables share one shape, deliberately: an assignment row with a
start, an optional end, a mandatory reason, a **partial unique index** admitting
exactly one live row, a guard trigger, and a mirror trigger keeping the
denormalised column in step.

```
chat.family_assignment           (Phase 1)  family  → supervisor, with history
chat.learner_teacher_assignment  (Phase 3)  learner → teacher,    with history
```

`chat.learner.teacher_id` survives as a **mirror of the live row**, so every
pre-Phase-3 reader keeps working unchanged — including
`chat.guard_teacher_deactivation()` and `ConversationService.syncStudentGroup`.

Group membership and group teachers use the same current/former shape: a
departure is `left_at` / `ended_at` on the row, never a deleted row.

### Backend

`FamilyService` extended (`createFamily`, `updateFamily`, `activateFamily`,
`deactivateFamily`, `lifecycleHistory`, label filtering) · new `LearnerService`,
`GroupService`, `LabelService`, each with a controller. Every mutation:
permission → scope → validation → transaction → mutation → audit + event.

### Admin Web

New areas `directory`, `groups`, `labels`, built on the **committed**
Communication Operations Console conventions: the same `api` client, the same
`qk` registry (extended additively), the same error shape. No second client, no
second key registry, no second event convention.

Current and historical state render through one pair of components
(`CurrentSection` / `HistorySection`), so a former teacher or supervisor is never
shown where the current one belongs — and the distinction is carried by
structure and words, not by colour alone.

## 4. Defects found and closed

| # | Defect | How it was found |
|---|---|---|
| **P3-1** | Supervisor reassignment left the outgoing supervisor a **live `conversation_member`** of the family's student groups. `API-CONTRACT.md` §3.3 always specified the re-sync; nothing implemented it. | Reading the contract against the code |
| **P3-2** | `ScopeService.conversationWhere` ORed an **unconditional membership disjunct**, so that stale row returned the family's conversations in the former supervisor's LIST — title, last-message preview, resolved member names — while `canRead` correctly refused to open them. | Tracing what a stale member row still reaches |
| **P3-3** | Concurrent teacher transfers failed with a raw `unique_violation`. The lock was taken on the **live assignment row**, a moving target: once the winner ends it, the loser's `WHERE ended_at is null` matches nothing, so it concludes no assignment exists and inserts blindly. Now locks the **learner** row. | Running two real concurrent transactions |
| **P3-4** | With P3-3 fixed, concurrent transfers then violated `window_ordered`: `now()` is **transaction-start** time, so a transaction that began before the winner committed stamped `ended_at` earlier than the row's `started_at`. Now `clock_timestamp()`. | Re-running the same concurrency test |
| **P3-5** | **`INSERT ... RETURNING` on `chat.family` was impossible under the runtime role.** PostgreSQL applies the SELECT policy to RETURNING; that policy resolves scope through a STABLE function reading the statement-start snapshot, which cannot contain the row being created. Every ORM issues RETURNING, so family creation through `chat_app` could never have worked. Invisible until Phase 3, because `chat_app` held no INSERT on `chat.family` before it. | Granting the INSERT and running the suite as `chat_app` |
| **P3-7** | **Mixed clocks on a history window.** Prisma's `@default(now())` generates the value CLIENT-side, so `joined_at` / `started_at` would have been stamped by the app host while the migration's other boundary uses `clock_timestamp()` on the database. Under host skew a legitimate removal trips `left_at >= joined_at`. Both boundaries are now database-written. | Reading `prisma migrate diff` output rather than trusting it was noise |
| **P3-6** | `family_edited_by_admins` and `learner_edited_by_admins` tested `role in ('admin','coverage','manager')`. **`coverage` has not existed since PD-5** renamed it `coverage_admin`, and `super_admin` was never listed — so a coverage admin and the organization owner matched neither. Dead letters until Phase 3's grants made them reachable; now expressed as a permission key instead of a role list. | Validating the policies before widening the grants |

| **P3-8** | **A write policy that silently granted blanket reads.** `group_written_by_manager`, `group_member_written_by_manager`, `group_teacher_written_by_manager` and `label_written_by_curator` were written `FOR ALL ... USING (permission)`. A `FOR ALL` policy's USING clause governs **SELECT** as well, and permissive policies OR together — so every holder of `groups.manage` read every roster row, defeating the scope-aware `group_member_visible` beside it. A supervisor whose `staff_can_see_family()` said FALSE still read another family's child out of a shared group. RT-011 at the group level, introduced by this phase. Split into `FOR INSERT` + `FOR UPDATE`, with the UPDATE clause mirroring the read scope. | The release-gate roster-security matrix, run as `chat_app` |

### Found and NOT fixed (reported, out of scope)

Eight further policies still carry the stale `'coverage'` literal. Two are
reachable today and both **fail closed** (they deny where they should allow):

* `message_written_by_staff` — a `coverage_admin` or `super_admin` cannot write
  an **internal note** under `chat_app`. Customer-visible sends are unaffected;
  they route through `chat.staff_may_send()`.
* `event_log_visible_to_staff` — the same two roles cannot read the event log.

The rest (`contact`, `family_note`, `handoff`, `task`) are unreachable — the
runtime role holds no DML on those tables. These are pre-existing Phase 1
defects on tables Phase 3 does not touch, so they were left alone rather than
widening this phase's blast radius.

## 5. Security

* **Historical assignment grants nothing.** Both scope predicates filter on
  `ended_at is null`; P3-1 and P3-2 closed the two paths by which a stale row
  still reached something.
* **The group roster is narrower than the group.** A group spans families, so an
  unscoped roster would be red-team A-1/RT-011 at the group level. Roster reads
  are filtered by the same `ScopeService` predicate every family read uses;
  organization-wide roles see all, everyone else sees their own families'
  students, and **a parent has no route to a group row at all** — in the service
  or in RLS.
* **No new disclosure surface for families.** Phase 3 creates **no
  `class_group` conversation**, attaches none, and adds no `conversation_id` to
  `chat.group`. No cross-family parent-to-parent surface exists.
* **Labels are inert.** Nothing in authorization, scope or messaging reads one. A
  label that could grant access would be a role with no audit trail.
* **Least privilege is structural.** `chat_app` was granted INSERT/UPDATE and
  **no DELETE** on family, learner, the two assignment tables, group,
  group_member, group_teacher and label. "Phase 3 never hard-deletes history" is
  therefore a property of the role, not a convention: a bug that tried would fail
  as a privilege error. The single exception is `chat.family_label`, where
  un-filing is not history.

## 6. The family lifecycle decision

`chat.family.state` remains the ONE authoritative source. **No `is_active`
column was added**; ACTIVE/INACTIVE is derived by
`chat.family_state_is_active()` and mirrored once in TypeScript.

| State | Classification | Settable in Phase 3 |
|---|---|---|
| `onboarding`, `active` | ACTIVE | yes (`active` only, via reactivation) |
| `at_risk`, `renewal_due` | ACTIVE — still a customer | **no** |
| `paused`, `churned` | INACTIVE | yes |

There is deliberately **no `setFamilyState(any, any)`**. Two named operations
exist, and `chat.deactivate_family()` validates its target against a two-value
allow-list — so the frozen renewal states cannot be manufactured by hand, and
`chat.activate_family()` leaves any already-active state untouched rather than
flattening it. Both are asserted by test.

**Lifecycle is not authorization.** Deactivating a family does not change scope,
does not touch a conversation, and does not alter Phase 2 messaging. The
supervisor keeps the family — they must, to wind it down or bring it back.

## 7. Messaging integration

Confined to the existing per-learner student group. No group ever gets a
conversation.

| Phase 3 mutation | Follow-through |
|---|---|
| Teacher transferred | `syncStudentGroup` — new teacher in, former teacher out (`left_at`) |
| Supervisor transferred | `syncStudentGroup` — **new; closes P3-1** |
| Learner deactivated | `archiveStudentGroup` — Phase 2's terminal state; history stays readable |
| Any group mutation | **none** |

`conversation_one_group_per_learner` is partial on `archived_at is null`, so
archiving frees the slot by design: a returning student gets a fresh group
rather than a resurrected one. That is Phase 2's design, verified rather than
assumed.

**Future extension point.** If a group ever needs a conversation, it arrives as
a `chat.group_conversation` join table — no change to `chat.group`, and no
change to its stable id. It is deliberately **not** built now, and no
speculative column exists.

## 8. Verification

| Gate | Result |
|---|---|
| API typecheck | PASS |
| API build | PASS |
| API tests | **607 / 619 PASS.** The 12 failures are `schema-invariants`, which shells to `psql` (`spawnSync psql ENOENT`) — absent on this host, and failing identically before Phase 3 |
| Baseline before Phase 3 | 493 / 505, same 12 failures — **+114 tests, 0 regressions** |
| Phase 3 suites | supervisor-transfer 7 · teacher-transfer 7 · family-and-students 16 · groups 17 · labels 14 · runtime-rls 19 · clock-consistency 7 · roster-security 14 · acceptance 1 = **102** |
| Migrations from EMPTY | PASS — 36 migrations |
| Structural gates (`schema_acceptance`, `br1_invariants`) | PASS |
| Admin Web typecheck | PASS |
| Admin Web build | PASS |
| Admin Web tests | PASS — 91 / 91 |
| RLS as `chat_app` | PASS — 19 / 19 |
| Concurrency (two real transactions) | PASS — one live row, contiguous chain, no backwards window |

### The critical scenarios, each asserted by a test

```
Teacher transfer   Ahmed → Islam → Mahmoud      current Mahmoud · Islam historical
Supervisor         Zainab → Dina                Dina current · Zainab has NO access,
                                                 and does not see the family in her list
Group              Active → Closed → Archived → Replacement (new id, old id intact)
Labels             multiple per family · bulk with per-family outcomes · VIP + Renewal
```

The full §22 workflow runs as one test:
`apps/api/test/integration/phase3-acceptance.spec.ts`.

## 9. What Phase 3 did NOT do

* **No class-group conversations.** Locked by decision; the type stays valid and
  dormant.
* **No group → conversation link of any kind**, not even a nullable column.
* **The eight remaining stale-`coverage` policies** (§4) are reported, not fixed.
* **`chat.assign_family_supervisor()` still locks the assignment row**, so it
  carries the P3-3 shape. **Measured at the release gate**, on unmodified Phase 1
  code: two overlapping supervisor transfers leave exactly **one** live primary
  assignment — the invariant holds, enforced by
  `family_assignment_one_live_primary` — but the losing transaction surfaces
  `duplicate key value violates unique constraint` rather than serialising and
  applying second. This is a **pre-existing Phase 1 ergonomics limitation, not a
  Phase 3 defect**: no Phase 3 change causes it, no data integrity is at risk,
  and §23's requirement ("never two current primary supervisors") is met. The
  one-line remedy is the same as P3-3's — lock `chat.family` rather than the
  assignment row — and is deliberately left for a Phase 1 change.
* **No broadcast, no AI, no scheduling, attendance, grading or payments.**
