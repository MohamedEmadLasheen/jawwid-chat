# Jawwid Chat — Release Gate

Date: 2026-09-05 · Owner: AI #5
A release is **BLOCKED** if any gate below is failing or unverified.
"Unverified" and "failing" are treated identically. An untested control is not a control.

## 1. Current verdict

# 🔴 NOT READY

**Reason: there is nothing to release.** One commit, zero application code, no
stack chosen for any component, no test executable, no CI, no deployment.
Every gate is UNVERIFIED. This is a project-start state, not a release candidate.

---

## 2. P0 gates — hard blockers

| # | Gate | Invariant | Status |
|---|---|---|---|
| G-01 | No code path assigns a family or message to staff except `on_duty()` + stickiness / assist / escalation, each logged with a reason | INV-3 | UNVERIFIED |
| G-02 | A family is in exactly one inbox at every instant — never two, never zero (Unattended counts) — including across shift boundaries, DST, and absence activation | INV-2 | UNVERIFIED |
| G-03 | `family.owner_id` mutates only via `transfer_ownership()`, which writes `audit_log` **in the same transaction**; rollback leaves owner unchanged | INV-1 | UNVERIFIED |
| G-04 | `thread.family_id` UNIQUE enforced at DB level; cases never create a second thread | INV-4 | UNVERIFIED |
| G-05 | Every staff message carries a valid `on_behalf_mode` | INV-5 | UNVERIFIED |
| G-06 | Coverage cannot close `owner_locked` cases or change owners — enforced **server-side**, verified by direct API call | INV-11 | UNVERIFIED |
| G-07 | Internal notes (`visibility=internal`) unreachable customer-side via API, realtime, notification, self-service, or cache | INV-15 | UNVERIFIED |
| G-08 | No cross-family data access for any role or contact; IDOR sweep clean across every entity id | — | UNVERIFIED |
| G-09 | Realtime subscribers receive **only** in-scope events; no internal-visibility content on customer sockets | — | UNVERIFIED |
| G-10 | Manager-only actions unreachable by admin/coverage/department staff | — | UNVERIFIED |
| G-11 | `message`, `event_log`, `audit_log` are immutable/append-only at DB level; `audit_log` readable only by manager | INV-6, INV-7 | UNVERIFIED |
| G-12 | No customer message is lost across restart, reconnect, retry, or duplicate submission; durable server-side persistence | — | UNVERIFIED |
| G-13 | No secrets in source or git history | — | **PASS** (vacuously — no code) |
| G-14 | Database migrations apply cleanly forward, and rollback is defined | — | UNVERIFIED |
| G-15 | No customer-facing AI output; no AI-initiated state change anywhere | INV-14 | UNVERIFIED |
| G-16 | No real employee or customer data in seed data, fixtures, or tests | — | UNVERIFIED |

## 3. P1 gates — architectural non-negotiables

| # | Gate | Invariant | Status |
|---|---|---|---|
| G-17 | No queue table, no round-robin, no "least loaded" anywhere in schema or code | INV-13 | UNVERIFIED |
| G-18 | Attention and workload are computed server-side from `config`; never stored as priority, never client-settable, never recomputed by a frontend | INV-8, INV-9 | UNVERIFIED |
| G-19 | Family count contributes zero to workload | INV-10 | UNVERIFIED |
| G-20 | Every numeric constant in the brief lives in `config`, not in code literals | §12 | UNVERIFIED |
| G-21 | Relationship case types auto-set `owner_locked` from the config list | INV-12 | UNVERIFIED |
| G-22 | Department staff (finance/technical/academic) can never message families and see only their own tasks | §2 | UNVERIFIED |
| G-23 | Contact capability flags enforced server-side for every self-service action | §2, §9 | UNVERIFIED |
| G-24 | At least one Primary Guardian per family, enforced | INV-16 | UNVERIFIED |
| G-25 | Backup is never auto-activated in MVP — suggestion only | §4 | UNVERIFIED |
| G-26 | Escalation, assist, and handoff each write a reason | §5, §12 | UNVERIFIED |
| G-27 | UI shows `top_reason` as text — never a score, never a P1/P2/P3 label | §6 | UNVERIFIED |
| G-28 | Workload level set is exactly LOW/MEDIUM/HIGH — no CRITICAL | §7 | UNVERIFIED |

## 4. Release-process gates

| # | Gate | Status |
|---|---|---|
| G-29 | CI runs lint, typecheck, unit, integration, and security tests on every push | **FAIL — no CI exists** |
| G-30 | Every component's toolchain is installed and its tests are executable in CI | **FAIL — Flutter/Dart absent; no stack chosen** |
| G-31 | Full E2E acceptance suite green (§5 below) | UNVERIFIED |
| G-32 | Zero open P0; zero open critical P1 | UNVERIFIED |
| G-33 | Observability: structured logs, health/readiness checks, error monitoring with token/PII redaction | UNVERIFIED |
| G-34 | Backup and restore procedure documented **and rehearsed**; RPO/RTO stated | **FAIL — does not exist** |
| G-35 | Environments separated; no production credentials or debug mode outside production config | UNVERIFIED |
| G-36 | The eight ambiguities in `test-plan.md` §8 are resolved and reflected in code | **FAIL — all 8 open** |

---

## 5. E2E acceptance flows (must all pass)

| ID | Flow |
|---|---|
| E2E-01 | Customer opens a topic → correct on-duty admin receives it → replies → customer sees reply |
| E2E-02 | Owner off-shift → coverage handles → **owner unchanged** → owner sees "while you were away" |
| E2E-03 | `owner_locked` non-urgent during coverage → acknowledge only, deferred to owner |
| E2E-04 | `owner_locked` urgent during coverage → transactional action taken, case **not** closed, owner flagged |
| E2E-05 | Nobody on duty → Unattended list + manager alert + honest auto-reply; **no silent assignment** |
| E2E-06 | Stickiness holds past shift end, expires, writes handoff, reassigns |
| E2E-07 | Absence with backup / without backup / backup out of shift — all three chain outcomes |
| E2E-08 | Attention crosses TODAY→NOW purely from elapsed time; `top_reason` text correct |
| E2E-09 | Workload crosses LOW→MEDIUM→HIGH; visible to admin and manager; **no ownership change** |
| E2E-10 | Department task completes → last open task closes → case `waiting_internal`→`open` → family to TODAY |
| E2E-11 | Case resolved → auto-closed after `reopen.window_hours` → customer replies inside window → reopens to same handler if on duty |
| E2E-12 | Manager transfers ownership → audit written same transaction → family notified |
| E2E-13 | One-click offboarding → deactivate, redistribute families, flag orphaned coverage rules, notify, audit |
| E2E-14 | Self-service by capability flag: permitted contact gets renewal link, non-permitted is denied |
| E2E-15 | Internal note written → invisible to every customer surface |
| E2E-16 | Batch acknowledgement: rapid customer messages produce **one** acknowledgement, not several |

## 6. Gates deliberately excluded

The AI #5 role assignment lists release gates for **Teacher↔Parent direct
communication**, **phone-number leakage**, **message approval bypass**, and
**LiveKit/call security**. None are gates here: the authoritative brief contains
no teacher actor, no student group, no approval entity, no call feature, and no
phone or email field on `contact`.

Gating on absent features would produce a green board that proves nothing.
If product confirms these features are in scope, the brief must be amended
first — and these gates reinstated — because the brief is currently the only
contract, and it excludes them.
