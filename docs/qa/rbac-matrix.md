# Jawwid Chat — RBAC Test Matrix

Date: 2026-09-05 · Owner: AI #5 · Source: brief §2, §5, §8
**The backend is authoritative.** A UI-only restriction is a defect, not a control.
Every DENY must be verified by direct API call, not by observing a hidden button.

## 1. Staff roles

Roles are exactly: `admin` · `coverage` · `manager` · `finance` · `technical` ·
`academic` · `system`. There is **no `super_admin`**.

`on_duty` below means `on_duty(family, now) == actor` (or actor holds
stickiness / a granted assist / an escalation).

| Action | admin (on_duty) | admin (not on_duty) | coverage (on_duty) | coverage (not on_duty) | manager | finance/technical/academic | system |
|---|---|---|---|---|---|---|---|
| Log in | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | n/a |
| Open any family record | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** | n/a |
| Write internal note (any family) | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | **DENY** | DENY |
| Send customer-visible message | ALLOW | **DENY** | ALLOW | **DENY** | ALLOW | **DENY** | templates only |
| Reply as assist | conditional¹ | conditional¹ | conditional¹ | conditional¹ | ALLOW | DENY | DENY |
| Open / edit case | ALLOW | DENY | ALLOW | DENY | ALLOW | DENY | lifecycle only |
| Close/resolve **non**-`owner_locked` case | ALLOW | DENY | ALLOW | DENY | ALLOW | DENY | auto-resolve² |
| Close/resolve **`owner_locked`** case | ALLOW (owner) | DENY | **DENY** | **DENY** | ALLOW | DENY | **DENY**² |
| Act on transactional part of urgent `owner_locked` case | ALLOW | DENY | ALLOW (no close) | DENY | ALLOW | DENY | DENY |
| Create internal task | ALLOW | DENY | ALLOW | DENY | ALLOW | DENY | DENY |
| View tasks | own families | own families | covered families | — | ALL | **only own assigned** | n/a |
| Complete task | ALLOW | DENY | ALLOW | DENY | ALLOW | ALLOW (own only) | DENY |
| Escalate (manual, with reason) | ALLOW | DENY | ALLOW | DENY | n/a | DENY | auto only |
| Pin handler ("I'll keep this") | ALLOW | DENY | ALLOW | DENY | ALLOW | DENY | DENY |
| Defer to owner ("for owner") | ALLOW | DENY | ALLOW | DENY | ALLOW | DENY | DENY |
| View own workload / inbox | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | n/a | n/a |
| View **team** workload / manager dashboard | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | DENY | n/a |
| View Unattended list | DENY | DENY | DENY | DENY | ALLOW | DENY | n/a |
| **Transfer ownership** | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | **DENY** | **DENY** |
| Edit shifts / coverage rules / absences | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | DENY | DENY |
| Activate backup | DENY | DENY | DENY | DENY | ALLOW | DENY | **DENY** (suggest only, MVP) |
| Edit `config` weights / thresholds | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | DENY | DENY |
| Read `audit_log` | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | DENY | n/a |
| Offboard admin | **DENY** | **DENY** | **DENY** | **DENY** | ALLOW | DENY | DENY |
| Set attention / priority / workload directly | **DENY (all roles — computed only, INV-8/9)** | | | | **DENY** | **DENY** | **DENY** |

¹ Assist requires **all** of: family in NOW bucket · waited >50% of response
target · on-duty admin has not opened it — **or** on-duty explicitly requested
help. Enforced server-side; tagged `assist`; on-duty notified.
² Operational auto-resolve after 168h **never** applies to `owner_locked` types —
it becomes an owner follow-up instead.

`coverage` has "same permissions as admin — role label only" (§2). The DENYs in
its columns are therefore not role-derived; they are the §5 rule *"Coverage
never: changes owner, closes relationship cases, promises discounts/exceptions."*

## 2. Family-side contacts

Capability flags, not roles. Presets are display sugar over the six flags —
**test the flags, not the presets.**

| Action | Gate | Preset defaults (Primary Guardian / Billing Authorized / Authorized Contact / Secondary Read-only) |
|---|---|---|
| Send a message / open a topic | `can_message` | ✓ / ✓ / ✓ / ✗ |
| View learner progress | `can_view_progress` | ✓ / — / — / ✓ |
| Change schedule | `can_manage_schedule` | ✓ / ✗ / ✗ / ✗ |
| View invoice, resend invoice, get renewal link | `can_manage_billing` | ✓ / ✓ / ✗ / ✗ |
| Add / edit contacts | `can_manage_contacts` | ✓ / ✗ / ✗ / ✗ |
| Cancel subscription | `can_cancel` | ✓ / ✗ / ✗ / ✗ |

Preset↔flag defaults above are **inferred from role names and require product
confirmation** — the brief lists the six flags and the four preset names but does
not publish the mapping. Until confirmed, test flags directly and treat preset
seeding as unverified.

Universal contact DENYs (all presets, always):
- Read any other family's data — DENY
- Read any `visibility=internal` message — **DENY (P0 if reachable)**
- Read staff identities beyond owner name/photo (§8 customer screen) — DENY
- See internal labels, case types, attention scores, or workload — DENY
- Mutate `owner_id`, case status, task state, or config — DENY

## 3. Test construction rules

1. Every cell is one automated test, asserted against the **API**.
2. Every DENY asserts both status code **and** an empty/absent body — a 403 that
   still returns the record is a leak.
3. Fixtures use synthetic staff (`admin_a`, `coverage_b`, `manager_c`) and
   synthetic schedules. **Real employee names from the brief must never appear in
   seed data, fixtures, or assertions** (see `system-inventory.md` §4).
4. Each role is exercised with a **valid** session for that role — never by
   stripping a token, which tests authentication instead of authorization.
5. `on_duty` / `not on_duty` cells are produced by moving fixture clock time, not
   by editing assignment state directly (there is no assignment state to edit —
   INV-3).
