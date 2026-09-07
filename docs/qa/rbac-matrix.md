> **STATUS: SUPERSEDED** (Phase 0, 2026-09-07). Role vocabulary is KNOWN WRONG (no `super_admin`, `coverage` instead of `coverage_admin`, department roles). Superseded by `docs/architecture/AUTHORIZATION-MODEL.md`. The BR-1 matrix rows remain a valid test inventory.
> Canonical index: `docs/README.md`.

# Jawwid Chat — RBAC & Communication Authorization Matrix

Date: 2026-09-05 · Owner: AI #5
Authoritative scope: `docs/qa/authoritative-scope.md` (PRD v0.1)

> **The backend is authoritative.** Every DENY in this document must be verified
> by a direct authenticated API call — never by observing that a button is
> hidden. A UI-only restriction is a cosmetic, not a control, and is recorded as
> a defect.
>
> Every DENY assertion checks **status code *and* response body**. A 403 that
> still returns the record is a data leak, not a denial.

## 1. Actors

| Actor | Authenticates via | Bound to |
|---|---|---|
| **Parent** | Parent mobile app | one family |
| **Teacher** | Teacher mobile app | assigned learners / their Student Groups |
| **Admin (Primary Owner)** | Admin Web | families where they are Primary Owner |
| **Coverage Admin** | Admin Web | families where `on_duty()` currently resolves to them |
| **Manager** | Admin Web | everything, plus ownership/coverage/config/audit |
| **Internal staff** (finance / technical / academic) | Admin Web | their assigned tasks only — **never** message families |
| **System** | — | deterministic templates and timers only |

`on_duty` below means the actor is the currently-resolved handler for that
family (owner in shift, active coverage, stickiness holder, granted assist, or
escalation target). **Primary Owner ≠ Current Handler**, and the matrix treats
them as independent axes.

---

## 2. BR-1 — the communication authorization matrix

This is the single most important table in the project. It governs **messaging
and calling identically** — calling is never more permissive than messaging.

### 2.1 Direct 1:1 channels

| Initiator → Target | 1:1 message | 1:1 voice call |
|---|---|---|
| **Parent → Teacher** | **DENY** | **DENY** |
| **Teacher → Parent** | **DENY** | **DENY** |
| Parent → Admin / Coverage | ALLOW | ALLOW |
| Teacher → Admin / Coverage | ALLOW | ALLOW |
| Admin / Coverage → Parent | ALLOW (if on_duty) | ALLOW (if on_duty) |
| Admin / Coverage → Teacher | ALLOW | ALLOW |
| Manager → Parent / Teacher | ALLOW | ALLOW |
| Parent → Parent (same or other family) | **DENY** | **DENY** |
| Teacher → Teacher | **DENY** | **DENY** |
| Parent / Teacher → internal staff (finance/technical/academic) | **DENY** | **DENY** |
| Internal staff → any family member | **DENY** | **DENY** |
| Anyone → System | **DENY** | **DENY** |

### 2.2 Student Group channels

| Action | Parent (member) | Teacher (member) | Admin/Coverage | Manager | Non-member |
|---|---|---|---|---|---|
| Read group messages | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| Post to group | ALLOW¹ | ALLOW¹ | ALLOW | ALLOW | **DENY** |
| Join group voice call | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| Start group voice call | ALLOW¹ | ALLOW¹ | ALLOW | ALLOW | **DENY** |
| Add a member | **DENY** | **DENY** | ALLOW² | ALLOW | **DENY** |
| Remove a member | **DENY** | **DENY** | ALLOW² | ALLOW | **DENY** |
| Leave group unilaterally | **DENY** | **DENY** | n/a | n/a | n/a |
| Archive group | **DENY** | **DENY** | ALLOW² | ALLOW | **DENY** |
| Read group member **contact details** | **DENY** | **DENY** | display identity only | display identity only | **DENY** |
| Open 1:1 with a co-member | **governed by §2.1 — group membership grants no 1:1 channel** | | | | |

¹ Subject to the approval workflow (§3) where configured.
² Admin/Coverage may administer groups only for families where they are on_duty;
   Manager, always.

### 2.3 The BR-1 invariant

> **No conversation of a 1:1 type may contain both a teacher and a parent.**

Checked at **creation** and at **every membership mutation** — so the forbidden
state cannot be reached by creating a legal conversation and then mutating it.
Enforced in the one centralized authorization service used by both the messaging
and the calling path.

**Required admin presence/authorization** in Student Groups is a PRD condition
that must be given a precise, testable definition — see `test-plan.md` AMB-9.

---

## 3. Approvals (MVP: approve · reject · rejection reason)

| Action | Parent | Teacher | Admin/Coverage (on_duty) | Admin (not on_duty) | Manager |
|---|---|---|---|---|---|
| Submit a message that enters PENDING | ALLOW¹ | ALLOW¹ | n/a | n/a | n/a |
| See own pending message (as pending) | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| See **another actor's** pending message | **DENY** | **DENY** | ALLOW | **DENY** | ALLOW |
| Approve | **DENY** | **DENY** | ALLOW | **DENY** | ALLOW |
| Reject | **DENY** | **DENY** | ALLOW | **DENY** | ALLOW |
| Reject **without** a reason | **DENY (all roles — reason is mandatory)** | | | | |
| Edit a pending message | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** |
| Approve one's own message | **DENY (self-approval forbidden)** | | | | |

¹ Governed by `teacherRequiresApproval` / `parentRequiresApproval` on the group.

**Hard rule:** a PENDING message is **never** delivered, pushed, surfaced in
search, emitted on realtime, or included in a group read — to anyone except its
author and an authorized approver. Escalation, expiry and coverage-aware
approval are **Phase 2** and must not appear in MVP.

---

## 4. Operational actions

| Action | Parent | Teacher | Admin (on_duty) | Admin (not on_duty) | Coverage (on_duty) | Manager | Internal staff |
|---|---|---|---|---|---|---|---|
| Log in | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| View own family | ALLOW | **DENY** | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| View **another** family | **DENY** | **DENY** | ALLOW (read) | ALLOW (read) | ALLOW (read) | ALLOW | **DENY** |
| View Family 360 | **DENY** | **DENY** | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| Send customer-visible message | ALLOW | group only | ALLOW | **DENY** | ALLOW | ALLOW | **DENY** |
| Write **internal note** | **DENY** | **DENY** | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| **Read** internal note | **DENY (P0)** | **DENY (P0)** | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| Search | own family only | own groups only | permitted families | permitted families | permitted families | all | own tasks only |
| Create task / follow-up | **DENY** | **DENY** | ALLOW | **DENY** | ALLOW | ALLOW | **DENY** |
| View tasks | **DENY** | **DENY** | own families | own families | covered families | all | **own assigned only** |
| Complete task | **DENY** | **DENY** | ALLOW | **DENY** | ALLOW | ALLOW | ALLOW (own only) |
| View **own** workload | **DENY** | **DENY** | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** |
| View **team** workload / Manager Dashboard | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| View Unattended list | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| **Transfer Primary Ownership** | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| Configure shifts / coverage / absences | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| Edit config weights / thresholds | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| Read audit log | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| Offboard an admin | **DENY** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** |
| Set attention / priority / workload directly | **DENY — all roles, always. These are computed, never entered.** | | | | | | |
| Register a push device token | own device | own device | own device | own device | own device | own device | own device |

**Coverage-specific limits** (coverage has admin-equivalent permissions, but):
coverage never changes Primary Ownership, never closes owner-locked relationship
cases, and never promises discounts or exceptions.

---

## 5. Family-side capability flags

Parents are authorized by **capability flags**, not by preset. Presets are
display sugar — **test the flags**.

| Action | Gate |
|---|---|
| Send a message / open a topic | `can_message` |
| View learner progress | `can_view_progress` |
| Change schedule | `can_manage_schedule` |
| View / resend invoice, get renewal link | `can_manage_billing` |
| Add or edit contacts | `can_manage_contacts` |
| Cancel subscription | `can_cancel` |

Preset→flag defaults are **not published in any document available to QA** and
must be confirmed by product before seeding (`test-plan.md` AMB-10). Until then,
tests assert flags directly and treat preset seeding as unverified.

Universal parent/teacher DENYs, all presets, always: read another family's data ·
read any internal-visibility message · read staff phone numbers or personal
contact details · see attention scores, workload, case internals or operational
labels · mutate ownership, coverage, config or approval state.

---

## 6. Phone privacy (cross-cutting)

Phone numbers must never appear in: API responses · realtime events · push
notification payloads · **call setup or call metadata** · call history · search
results · deep links · error messages · logs · client caches · exports.

Current implementation enforces this **by construction** — `Actor` and the
`Contact` shell carry no phone column, so the communication engine has no code
path that can obtain one (`defects.md` PF-1). That property is a release gate:
it must survive the JC-002 refactor and must extend to call signalling, where
telephony integrations most commonly reintroduce a number.

---

## 7. Test construction rules

1. Every cell is one automated test asserted against the **API**, not the UI.
2. Every DENY asserts status **and** empty body.
3. Each role is exercised with a **valid session for that role** — never by
   stripping or corrupting a token, which tests authentication instead of
   authorization.
4. `on_duty` / `not on_duty` states are produced by **moving fixture clock
   time**, never by editing assignment state directly — there is no assignment
   state to edit.
5. Fixtures use **synthetic** people (`parent_a`, `teacher_b`, `admin_c`,
   `coverage_d`, `manager_e`) with synthetic schedules. Real employee or
   customer names must never appear in seed data, fixtures or assertions.
6. Every 1:1 row in §2.1 is additionally exercised through the **calling** path,
   not only the messaging path. Calling parity is where BR-1 is most likely to
   regress.
