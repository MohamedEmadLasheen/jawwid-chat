# Jawwid Chat — Release Gate

Date: 2026-09-05 · Owner: AI #5
Authoritative scope: `docs/qa/authoritative-scope.md` (PRD v0.1)

A release is **BLOCKED** if any gate is failing **or unverified**. The two are
treated identically: an untested control is not a control.

## 1. Current verdict

# 🔴 NOT READY
**Reason: implementation is in progress.**
Scope is settled — PRD v0.1 governs. Three P0 defects are open (`defects.md`
JC-001/002/003), the MVP communication layer is not yet built, and no suite has
been executed.

---

## 2. P0 — hard blockers

| # | Gate | Status |
|---|---|---|
| **G-01** | **BR-1: no Teacher↔Parent 1:1 messaging or calling exists, enforced server-side, verified with client-side policy disabled (BR1-19)** | **FAIL — JC-002** |
| **G-02** | Student Groups implemented, with membership derived from Jawwid Core and BR-1 enforced at creation **and** every membership mutation | **FAIL — JC-001** |
| **G-03** | Teacher is a first-class authenticated actor with Teacher↔Admin and group access | **FAIL — JC-003** |
| G-04 | One centralized authorization policy governs messaging **and** calling; no second matrix | UNVERIFIED |
| G-05 | Approvals: approve / reject / mandatory reason; pending never delivered, pushed, searchable or emitted; no self-approval; concurrent decisions resolve to one state | UNVERIFIED |
| G-06 | Voice calling authorized through the same policy; tokens server-generated, short-lived, room-scoped; unauthorized room join denied | UNVERIFIED |
| G-07 | **No phone number** in any API response, realtime event, push payload, call setup/metadata/history, search result, log, cache or export | UNVERIFIED (structural control in place — PF-1) |
| G-08 | Internal notes unreachable by any parent or teacher through any surface | UNVERIFIED |
| G-09 | No cross-family or cross-group access; IDOR sweep clean across every entity id | UNVERIFIED |
| G-10 | Realtime delivers only in-scope events; re-authorized on reconnect and on permission change | UNVERIFIED |
| G-11 | Manager-only actions unreachable by admin, coverage, teacher, parent or internal staff | UNVERIFIED |
| G-12 | Exactly one Primary Owner per family; ownership changes only via `transfer_ownership()` with audit in the same transaction | UNVERIFIED |
| G-13 | Coverage, handoff and workload never change Primary Ownership | UNVERIFIED |
| G-14 | Exactly one current handler at all times — never two, never zero (Unattended counts) | UNVERIFIED |
| G-15 | No message duplication under retry, reconnect or double-submit; idempotency enforced | UNVERIFIED |
| G-16 | No message loss across restart, reconnect, worker crash or client crash | UNVERIFIED |
| G-17 | `message` / `event_log` / `audit_log` immutable or append-only; audit manager-read-only | UNVERIFIED |
| G-18 | No secrets in source or git history | **PASS** (re-checked each release) |
| G-19 | Migrations apply cleanly forward; rollback defined and tested | UNVERIFIED |
| G-20 | No real employee or customer data in seed data, fixtures or tests | UNVERIFIED |
| G-21 | Jawwid Core remains source of truth; boundary views read-only; Chat is not a second source of truth | UNVERIFIED |

## 3. P1 — major workflow gates

| # | Gate | Status |
|---|---|---|
| G-22 | Attention and workload computed server-side from `config`; never client-set; no frontend re-implementation | UNVERIFIED |
| G-23 | No queue, round-robin, or automatic distribution anywhere | UNVERIFIED |
| G-24 | Notifications and reminders: dedupe, status lifecycle, quiet hours, retry, no storms | UNVERIFIED |
| G-25 | Push deep links re-authorized server-side on open; never open unauthorized content | UNVERIFIED |
| G-26 | Tasks and follow-ups; internal staff see only their own tasks and never message families | UNVERIFIED |
| G-27 | Manager Dashboard figures reconcile with backend engines | UNVERIFIED |
| G-28 | Offline queue, reconnect and multi-device convergence | UNVERIFIED |
| G-29 | Contact capability flags enforced server-side for every self-service action | UNVERIFIED |
| G-30 | Core integration failure degrades safely; no fabricated Core data | UNVERIFIED |

## 4. Scope-boundary gates (fail if present in MVP)

| # | Gate | Status |
|---|---|---|
| G-31 | **No** AI attention scoring, drafting, summarization or classification | UNVERIFIED |
| G-32 | **No** video calling | UNVERIFIED |
| G-33 | **No** labels, **no** broadcast | UNVERIFIED |
| G-34 | **No** approval escalation, expiry or coverage-aware approval | UNVERIFIED |
| G-35 | **No** shared queue or automatic routing | UNVERIFIED |

## 5. Process gates

| # | Gate | Status |
|---|---|---|
| G-36 | CI runs lint, typecheck, unit, integration, security and migration validation on every push | **FAIL — no CI** |
| G-37 | Every component's toolchain installed and its tests executable in CI (Flutter/Dart still absent) | **FAIL** |
| G-38 | Full E2E suite green (`test-plan.md` §20) | UNVERIFIED |
| G-39 | Zero open P0; zero open critical P1 | **FAIL — 3 open P0** |
| G-40 | Observability: structured logs, health/readiness, error monitoring with token/PII redaction | UNVERIFIED |
| G-41 | Backup and restore documented **and rehearsed**; RPO/RTO stated | **FAIL — absent** |
| G-42 | Environments separated; no production credentials or debug mode outside production | UNVERIFIED |
| G-43 | Open specification ambiguities resolved (`test-plan.md` §21) — **AMB-9 blocks BR-1 testing** | **FAIL — 9 open** |

---

## 6. Release will FAIL if any of these is true

- Teacher↔Parent direct 1:1 communication or calling is possible by any route
- A phone number is reachable through any product surface
- Unauthorized family, group or conversation access is possible
- Manager permissions are bypassable
- A pending message reaches anyone before approval
- Approval can be bypassed, or rejection accepted without a reason
- Messages duplicate or are lost
- Coverage, handoff or workload changes Primary Ownership
- Production secrets are committed
- Migrations fail, or core E2E flows fail
- Phase 2 functionality (AI scoring, video, labels, broadcast, approval
  escalation) ships in MVP

## 7. Severity policy

**P0** security breach · unauthorized data access · Teacher↔Parent direct
communication · phone leakage · data corruption or loss · broken authentication.
**P1** major workflow broken: approvals, coverage, calling, notifications, Core
integration. **P2** important functional/UX. **P3** minor/cosmetic.

**READY is never declared while any P0 or critical P1 is open.**
