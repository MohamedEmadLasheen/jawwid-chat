# Jawwid Chat — Supervisor Ownership (Family → Supervisor Assignment)

Status: **CANONICAL** · Locked in Phase 0 (2026-09-07) · Implemented in Phase 1
Companions: `AUTHORIZATION-MODEL.md` §6, `IDENTITY-MODEL.md` §5, `../contracts/API-CONTRACT.md` §3.3.
Product basis: PRD §5 (BR-4 "one family, one primary owner"; reassignment by a manager with a reason and audit; deactivation blocked until every family is reassigned; coverage admins act with the owner's permissions "and nothing more").

---

## 1. The invariant

> **A supervisor can only access families within their current authorized scope.**

Scope is the set of families currently assigned to the supervisor, plus any
family with an *active* temporary assignment to them. It affects the
conversation list, conversation read, messages, the moderation queue, search,
notifications, dashboards, broadcast audiences and (for non-managers) audit
visibility. See `AUTHORIZATION-MODEL.md` §6 for the predicate.

---

## 2. What exists today (verified)

| Element | Where | Status |
|---|---|---|
| `family.owner_id` NOT NULL → `chat.staff` | `20260905090300:17` | the current assignment, no history |
| Owner change only through `transfer_ownership()` (manager-only, reason required, audit + event in-transaction) guarded by a trigger and a transaction-local GUC | `20260905090700:36-109` | keep semantics |
| Deactivation blocked while any family is owned; `offboard_staff()` reassigns then deactivates | `090700:183-287` | keep semantics |
| Coverage windows: `shift`, `coverage_rule`, `absence`, `on_duty()`, `coverage_chain()`, stickiness, `handoff` | `090200`, `090600`, `094000 §7` | routing input to `canSend`; **not** a visibility input; pending PD-3 |
| `AuthorizationService.deriveMode` uses `familyOwnerId` for *attribution* (`owner` vs `coverage` vs `assist`) | `authorization.service.ts:318-333` | keep |
| Visibility ignores ownership entirely (any family-facing staff reads everything) | `authorization.service.ts:134-142` | **the gap** |
| Admin Web filters reassignment recipients to `role === 'admin'` on the client only | `TransferOwnershipDialog.tsx:36-38` | move to the server |

---

## 3. Canonical model

```
Family ──(exactly one current)──► Supervisor Assignment ──► Staff (admin | coverage_admin)
   │
   └──(history)──► Supervisor Assignment rows with ended_at, kind, reason, assigned_by
```

### 3.1 `chat.family_assignment` (NEW, Phase 1)

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | |
| `organization_id` | uuid | tenancy (restrictive RLS as on every root table) |
| `family_id` | uuid → `chat.family` | |
| `staff_id` | uuid → `chat.staff` | the supervisor |
| `kind` | `primary` \| `temporary` | primary = the owner (exactly one active per family); temporary = coverage/holiday cover with an explicit window |
| `starts_at`, `ends_at` | timestamptz | `ends_at` NULL for the active primary; required for temporary |
| `assigned_by` | uuid → `chat.staff` | the manager (or `system` for Core-driven initial assignment, recorded as such) |
| `reason` | text NOT NULL | mandatory, non-blank |
| `ended_by`, `ended_reason`, `ended_at` | | set on reassignment/expiry |
| `created_at` | | |

Constraints: at most one active `primary` per family (partial unique index on
`family_id where kind='primary' and ended_at is null`); `staff_id` must be an
active `admin` or `coverage_admin` (the rule Admin Web currently enforces
client-side — `manager` may hold families only if the product decides so;
default **no**); `family.owner_id` stays as a denormalised mirror of the active
primary assignment maintained by trigger, so every existing reader keeps
working until it is migrated.

### 3.2 Operations

| Operation | Who | Effect | Audit |
|---|---|---|---|
| Initial assignment | manager (`POST /families/:id/assignment`), or the Core-ingestion path that creates the family (`assign_family_owner()`), never guessed | first `primary` row | `family_assigned` |
| Reassignment | manager, reason required | current primary `ended_at=now, ended_by, ended_reason`; new primary row; `family.owner_id` updated by trigger | `ownership_transferred` (existing name kept) |
| Temporary cover | manager | `temporary` row with a window; the primary is untouched | `family_cover_started` / `_ended` |
| Offboarding | manager (`offboard_staff()`) | every active assignment of the staff member ended and reassigned (named target or round-robin, as today) before deactivation | one audit row per family + one for the staff member |
| Expiry | worker | temporary rows past `ends_at` are ended | event |

### 3.3 Access transitions (the part the previous model never did)

| Event | Previous supervisor | New supervisor |
|---|---|---|
| Reassignment commits | loses `families.read`/`conversations.read` scope **immediately**: next list call excludes the family; open sockets receive `conversation.access_revoked` for each of its conversations and are removed from those rooms; pending approvals in those conversations leave their queue | gains scope immediately; existing conversations unchanged (no new conversation is created on handler change — BR-5, `mobile-contract.md`) |
| Temporary cover starts/ends | as above, for the window | as above |
| Offboarding | as reassignment for every family; sessions revoked | as above |

Messages the previous supervisor authored stay attributed; they are simply no
longer readable by them.

---

## 4. Relationship to coverage windows (PD-3)

Today `canSend` routes a family conversation to the *on-duty* admin computed
from shifts and coverage rules (`chat.on_duty()`), independent of ownership.
The canonical model expresses the same need as an **assignment**: an active
`temporary` assignment is what makes a coverage admin in scope. Whether
temporary assignments are created **automatically from a schedule** (the
current engine) or **explicitly by a manager** is product decision PD-3.
Until decided:

* `chat.on_duty()` remains the routing input to `canSend` (no regression);
* it becomes *also* a visibility input by treating "on duty for this family
  right now" as an implicit temporary assignment in `visible_families(actor)`;
* no new code depends on shifts/absences/handoff beyond that.

If PD-3 chooses explicit assignment, the coverage engine becomes REMOVE LATER;
if it chooses schedules, the engine is re-homed to write `temporary`
assignment rows, so the rest of the system only ever reads assignments.

---

## 5. Offboarding guarantees (kept from `090700`)

1. `staff.is_active=false` is refused by trigger while the staff member holds
   any active assignment.
2. `offboard_staff()` reassigns every family first, then deactivates, sets
   `left_at`, sets presence offline, and audits — in one transaction.
3. `on_duty()` / `coverage_chain()` never return an inactive staff member.
4. Phase 1 adds: session revocation and socket eviction in the same operation
   (`IDENTITY-MODEL.md` §5).

---

## 6. What changes in `AuthorizationService` (Phase 1)

* `canRead(actor, conv, membership)` gains the scope check for staff:
  `conv.familyId == null ? membership required : familyId ∈ visible_families(actor)`;
  managers and super_admins pass on organization.
* `deriveMode` reads the assignment instead of `family.owner_id` directly
  (same result while the mirror column exists).
* New `visibleFamilies(actor)` / `visibleConversationsWhere(actor)` used by
  every list endpoint and by the moderation queue.
* Realtime: `conversation.subscribe` uses `canRead` (already) and therefore
  inherits scope; a reassignment publishes `conversation.access_revoked`.

---

## 7. Tests that must exist before Phase 1 closes

| Test | Asserts |
|---|---|
| unit: scope matrix | admin sees own families only; coverage_admin sees covered families only; manager sees all; parent sees own family; teacher sees learners' families through groups |
| unit: reassignment | previous supervisor denied on read/send/approve immediately after; new supervisor allowed; audit row present with reason |
| integration: list scoping | `GET /conversations`, `GET /families`, `GET /approvals/pending` never return an out-of-scope record for any role |
| integration: realtime | subscribe refused after reassignment; `conversation.access_revoked` delivered |
| SQL: `db/tests/assignment_invariants.sql` | exactly one active primary per family; deactivation refused while assigned; temporary requires a window |
| protected | added to `docs/qa/protected-tests.tsv` |
