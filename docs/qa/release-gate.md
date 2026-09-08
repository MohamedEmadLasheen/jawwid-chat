# Jawwid Chat — Release Gate

Date: 2026-09-05 · Owner: AI #5
**Re-verified by execution: 2026-09-08 (Phase 8). See §1a.**
Authoritative scope: `docs/qa/authoritative-scope.md` (PRD v0.1)

A release is **BLOCKED** if any gate is failing **or unverified**. The two are
treated identically: an untested control is not a control.

> ## ⚠ The gate table below (§2–§5) is STALE, in both directions.
>
> It was last edited on 2026-09-05, before Phases 1–7 landed. It records P0
> defects that are **fixed and regression-tested** (JC-008 and JC-010 both have
> passing assertions in `schema-invariants.spec.ts`), and it records gates as
> UNVERIFIED that are now covered by 762 passing integration tests. It is left
> in place rather than rewritten because it is AI #5's artefact and rewriting
> another owner's gate table from outside is how a gate quietly loosens.
>
> **§1a is the current, execution-backed status.** Where the two disagree, §1a
> was measured on 2026-09-08 and §2–§5 were not.

## 1. Current verdict

# 🔴 NOT READY
**Reason: the delivery layer has never run.** Not the application — see §1a.

There is no git remote, so no CI workflow in this repository has ever executed,
and until 2026-09-08 the pipeline was red at its first job and could not have
executed anyway. No environment exists to deploy to. Mobile tests have never run
anywhere.

*Superseded reasons, kept for the record:* the two unmerged migration lineages
and the working tree's inability to build a database on its own are **resolved** —
`supabase/migrations` is the single authority and 52 migrations apply from empty
and are idempotent, verified 2026-09-08.

## 1a. Phase 8 re-verification — measured 2026-09-08

Full detail and evidence: `docs/recovery/PHASE-8-EXTERNAL-GATE.md` (authoritative;
`PHASE-8-CLOSURE.md` and
`PHASE-8-REPORT.md` record how the findings were reached).

Current classification: **PRODUCTION CANDIDATE — EXTERNAL BLOCKERS.** Every
remaining blocker needs a remote, a host, a mobile toolchain or a third party;
no engineering blocker remains open in the backend or web application.

| Gate | 2026-09-05 | 2026-09-08 | Evidence |
|---|---|---|---|
| G-01 BR-1 enforced server-side | FAIL (JC-008) | **PASS** | `schema-invariants.spec.ts` asserts a GROUP→DIRECT conversion is rejected; `br1_invariants.sql` green |
| G-45 one migration lineage, no divergent objects | FAIL (JC-010) | **PASS** | `exactly one actor column exists, and it is not both` passes; 52 migrations apply from empty |
| G-19 migrations apply + idempotent | PARTIAL | **PASS** | Applied from empty on a clean container; re-apply is a no-op |
| G-09 no cross-family/group access; IDOR sweep | UNVERIFIED | **PASS** | `security-regression`, `authz-attacks`, `tenant_isolation.sql`, `phase3-group-roster-security` |
| G-10 realtime delivers only in-scope events | UNVERIFIED | **PASS** | `phase4-realtime`, `realtime-revocation` — subscribe by id, never by naming a room |
| G-17 message/event/audit immutability | UNVERIFIED | **PASS** | `schema-invariants.spec.ts` append-only assertions |
| G-12 one Primary Owner; transfer audited | UNVERIFIED | **PASS** | `assignment_invariants.sql`, `phase3-supervisor-transfer` |
| G-15/G-16 no duplication or loss | UNVERIFIED | **PASS** | `phase2-messaging` idempotency, `phase4-outbox-crash-safety` |
| G-18 no secrets in source or history | PASS | **PASS** | Scanner clean; hard rules proven still active in test paths |
| G-40 observability | UNVERIFIED | **PARTIAL** | Structured JSON logging + health checks implemented and tested; no error tracking, metrics or alerts (BLOCKER-3) |
| G-41 backup and restore rehearsed | FAIL (absent) | **PASS** | Restore was BROKEN, is fixed, and was drilled onto a bare cluster: 6/6 integrity suites on the restored copy |
| G-36 CI runs the gates | PARTIAL | **BLOCKED** | The pipeline was red at its first job; now green locally through every check runnable here. **Never executed on a runner** |
| G-37 every toolchain executable in CI | FAIL | **FAIL** | Mobile job now genuinely runs Flutter; has never executed. No Flutter/Dart/JDK on any known host |
| G-39 zero open P0 / critical P1 | FAIL (5 P0, 2 P1) | **PARTIAL** | The listed application P0s are resolved. Open blockers are now delivery-layer: no remote, no hosting, no mobile execution |
| — abuse limits on authenticated actions | *not a gate* | **PASS (new)** | Added Phase 8; `phase8-abuse-controls` |
| — performance baseline | *not a gate* | **PARTIAL (new)** | First measurement ever taken; `docs/qa/performance-baseline.md` |

---

## 2. P0 — hard blockers

| # | Gate | Status |
|---|---|---|
| **G-01** | **BR-1: no Teacher↔Parent 1:1 messaging or calling exists, enforced server-side, verified with client-side policy disabled (BR1-19)** | **FAIL — JC-008.** Materially improved: BR-1 is now a DB constraint trigger and blocks the member path (verified). It does **not** guard `conversation.type`, so a group converts to a forbidden 1:1 by `UPDATE` (reproduced). |
| **G-02** | Student Groups implemented, with membership derived from Jawwid Core and BR-1 enforced at creation **and** every membership mutation | **FAIL — JC-001** |
| **G-03** | Teacher is a first-class authenticated actor with Teacher↔Admin and group access | **FAIL — JC-003** |
| G-04 | One centralized authorization policy governs messaging **and** calling; no second matrix; **no client-supplied field widens authority** | **PASS (messaging)** — JC-005 fixed, regression-tested. Calling unverified. |
| G-05 | Approvals: approve / reject / mandatory reason; pending never delivered, pushed, searchable or emitted; no self-approval; concurrent decisions resolve to one state | UNVERIFIED |
| G-06 | Voice calling authorized through the same policy; tokens server-generated, short-lived, room-scoped; unauthorized room join denied | UNVERIFIED |
| G-07 | **No phone number** in any API response, realtime event, push payload, call setup/metadata/history, search result, log, cache or export | PARTIAL — structural control now **guarded in CI** (`no-contact-channel-columns.spec.ts`: schema, migrations, Actor seam, DTO/event contracts). Runtime surfaces still unverified. |
| G-08 | Internal notes unreachable by any parent or teacher through any surface | PARTIAL — contacts and deactivated actors denied (verified, JC-006 fixed); other surfaces unverified |
| G-09 | No cross-family or cross-group access; IDOR sweep clean across every entity id | UNVERIFIED |
| G-10 | Realtime delivers only in-scope events; re-authorized on reconnect and on permission change | UNVERIFIED |
| G-11 | Manager-only actions unreachable by admin, coverage, teacher, parent or internal staff | UNVERIFIED |
| **G-44** | `on_duty()` is the sole authority for acting on a family; assist and escalation are gated by server-evaluated preconditions | **FAIL — JC-007**: now fail-closed (not bypassable) but the real predicate is not implemented |
| G-12 | Exactly one Primary Owner per family; ownership changes only via `transfer_ownership()` with audit in the same transaction | UNVERIFIED |
| G-13 | Coverage, handoff and workload never change Primary Ownership | UNVERIFIED |
| G-14 | Exactly one current handler at all times — never two, never zero (Unattended counts) | UNVERIFIED |
| G-15 | No message duplication under retry, reconnect or double-submit; idempotency enforced | UNVERIFIED |
| G-16 | No message loss across restart, reconnect, worker crash or client crash | UNVERIFIED |
| G-17 | `message` / `event_log` / `audit_log` immutable or append-only; audit manager-read-only | UNVERIFIED |
| G-18 | No secrets in source or git history | **PASS** (re-checked each release) |
| G-19 | Migrations apply cleanly forward; rollback defined and tested | PARTIAL — forward apply + idempotency gated in CI **and verified locally against postgres:17**. Requires cross-branch composition: the working tree alone fails with `relation "chat.family" does not exist`. **Rollback still undefined.** |
| G-20 | No real employee or customer data in seed data, fixtures or tests | UNVERIFIED |
| **G-21** | Chat owns its own database; Core integration via the approved boundary; single migration authority | **FAIL — JC-009.** `090900_chat_core_integration` reads `public.profiles` over SQL; `091200_chat_rls` depends on it. Prisma remains a second schema authority. |

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
| G-36 | CI runs typecheck, unit, security and migration validation on every push | **PASS (partial)** — `.github/workflows/ci.yml`: fast release-gate guards (G-18/G-20/G-31..35), API typecheck+unit, Admin Web typecheck+tests, migration apply + idempotency. Integration job self-skips until specs exist; no linter configured in any package yet. |
| G-37 | Every component's toolchain installed and its tests executable in CI (Flutter/Dart still absent) | **FAIL** |
| G-38 | Full E2E suite green (`test-plan.md` §20) | UNVERIFIED |
| **G-45** | Branch reconciliation complete; one migration lineage; no silently-divergent schema objects | **FAIL — JC-010.** Two `chat.event_log` definitions; `create table if not exists` hides the conflict and it surfaces only at runtime. `docs/release/branch-reconciliation.md`. |
| G-39 | Zero open P0; zero open critical P1 | **FAIL — 5 open P0 (JC-001/002/003/009/010), 2 open P1 (JC-007/008)** |
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
