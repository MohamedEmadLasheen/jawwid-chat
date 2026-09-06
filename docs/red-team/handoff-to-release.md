# Red Team → Release · Handoff to Agent #10

From: AI #9 (Adversarial Red Team) · 2026-09-06
Evidence: [`findings.md`](findings.md) · Status: **EVIDENCE FROZEN at `b634fe8`**

This is the release-decision list. Every item is either **RESOLVED** (the
invariant holds) or must be **explicitly accepted** by a named owner with a
reason and a date. Nothing may reach release undecided.

This document does not prescribe remediation, does not choose the database
architecture, does not redesign the authorization model, and does not touch the
PRD. Those are your calls and AI #1's work.

> **Read the anchor before acting.** All statuses were re-verified at commit
> `b634fe8`, with 35 files uncommitted in the working tree. **This tree moved five
> times during the audit and eight findings were fixed while the report was being
> written.** Anything read from an older copy of these documents is stale.

## Where this stands

28 findings. **15 open, 12 resolved, 1 closed.**

| Severity | Total | Open |
|---|---|---|
| P0 | 5 | **1** — RT-001 |
| P1 | 9 | 3 — RT-006, RT-009, RT-010 (partial) |
| P2 | 6 | 5 — RT-011, RT-012, RT-013, RT-014, RT-028 |
| P3 | 7 | 7 (RT-020 partial) |

**Red team status: still FAILED — one P0 stands.**

Both previous release blockers are closed, verified by execution rather than by
code inspection:

* **RT-023 · RESOLVED.** The chain builds a bare `postgres:17` from empty:
  20 migrations in deterministic order, re-apply is a 20-skip no-op,
  `db/tests/schema_acceptance.sql` passes 58 structural assertions, and the
  database contains **no non-`chat` tables and no `auth` schema**. Branch
  composition, the Core shim and the identity stub are gone from CI and from the
  local harness.
* **RT-024 · RESOLVED**, and **RT-025 with it.** `type` is immutable on
  `chat.conversation` and `chat.call`, and the invariant is re-checked from both
  tables it spans by deferred constraint triggers. Proven at a real `COMMIT`
  with no `SET CONSTRAINTS` assistance, and against the running system with the
  application bypassed entirely: direct SQL injecting a parent into a live
  Teacher↔Admin conversation is refused.

**The acceptance chain now runs end to end.** Empty database → migrations →
running backend → HTTP → database → BR-1 enforcement. Against the live API:
Teacher→Parent and Parent→Teacher direct conversations return **403
`COMM.BR1_TEACHER_PARENT_DIRECT`**; Teacher→Admin and Parent→Admin are created
normally.

**The link that does not hold is AUTH.**

---

## 1. Release blockers

| ID | Finding | Status |
|---|---|---|
| ~~RT-023~~ | Migration chain could not build an empty database | **CLEARED** — verified from zero on a bare `postgres:17` |
| ~~RT-024~~ | BR-1 backstop bypassed by `type` mutation, messaging and calling | **CLEARED** — verified by executable SQL tests at a real commit |

### The blocker that replaces them

| ID | Finding | Why it cannot be accepted |
|---|---|---|
| **RT-001** | Identity is a request header. `curl -H 'x-actor-id: <admin uuid>' /api/v1/conversations` returns that admin's conversation list, HTTP 200, with no credential of any kind. | It was one WebSocket handshake when this audit opened. The API now exposes **six controllers**, so this is the entire REST surface. Every control this reconciliation just proved — BR-1, RBAC, coverage, approvals — is evaluated for an actor the caller names. The database backstop still holds against it, which is precisely why the backstop was worth building; nothing else does. |

**Exit criteria.** `x-actor-id` and `handshake.auth.actorId` are replaced by a
verified credential, and the reference implementations refuse to construct
outside `APP_ENV=local`. Until then no environment reachable by an untrusted
network may run this build.

---

## 2. Must be resolved or explicitly accepted

### P0 — RT-001 is covered in §1 above.

### P1 — three open

| ID | Finding | Status |
|---|---|---|
| ~~RT-025~~ | BR-1's required admin presence | **RESOLVED** — enforced on every conversation type, on add, remove and delete; the admin must be `actor_kind='staff'` with `member_role='admin'`, so a teacher cannot claim the role |
| **RT-006** | `signUrlsForMessages(messageIds)` still takes no actor: object-level authorization absent by shape. No caller exists yet, so it is free to fix now. | OPEN · CONFIRMED (static) |
| **RT-009** | A realtime session never re-evaluates identity. `resolveActor` is still called exactly once per socket; the `Actor` is cached for the connection's lifetime. Offboarding does not offboard. | OPEN · CONFIRMED (static) |
| **RT-010** | **Half closed.** `schema.prisma` is now `schemas = ["chat"]`, so the duplicate `public`-schema model is gone and the two definitions agree. **Unchanged:** the foundation migration still states Jawwid Chat lives "inside the Jawwid Core Supabase database", contradicting `docs/qa/authoritative-scope.md` §2. | OPEN (partial) |

> **RT-010's remainder is a product-owner decision on tenancy, not a red-team
> one.** This audit deliberately does not choose. Note it is now a smaller
> decision than it was: only the tenancy question is left.

### P2 — five open

RT-011 (staff conversation listing still `take: 200` with no
coverage scope — the `familyId: '*'` probe is gone with `thread.service.ts`, the
unbounded scope is not), RT-012 (receipt roster still discloses staff ids and read
times to contacts; field renamed `userId` → `actorId`, disclosure unchanged),
RT-013 (internal-note existence still fanned out to the whole thread room —
CONFIRMED in contract, UNVERIFIED at runtime, no drain worker), RT-014
(authorization still decided before the transaction that acts on it), and
**RT-028** — a phone-privacy assertion in the integration suite that false-positives
on random UUIDs containing seven consecutive digits, reddening CI intermittently.
It was deliberately left alone: loosening a privacy pattern is an owner decision,
not a red-team edit.

### P3 — seven open

RT-016, RT-017, RT-018, RT-019, RT-020 (partial), RT-021, RT-022. Acceptable to
ship with a recorded decision. **RT-020 is worth reading first:** five documents
cited as authoritative by code still do not exist, and RT-005 was a direct
consequence of one of them before it was fixed.

### Closed

**RT-015** — CI now exists (`bf279a7`). Retained as the record that the control
was added, not deleted as though it never applied.

---

## 3. RT-027 — resolved, and the one thing to watch

For a period during this audit both red-team specs failed to compile against the
refactored API, so CI's `test:unit` could not distinguish *"the invariant holds"*
from *"nothing ran"*, and six findings were closed without their guard executing.

**This is now closed.** The specs were re-pointed and their assertions
**inverted**: `RT-002 (fixed)`, `RT-003 (fixed)`, `RT-004 (fixed)`,
`RT-005 (fixed)`, `RT-007 (fixed)` and `RT-008 (fixed)` now assert the *secure*
behaviour and fail loudly if the vulnerability returns, plus a new
`conversation-type confusion` section. Full unit suite: **6 suites, 81 tests,
green.**

**The one thing to watch.** During that inversion the `RT-008` section was
dropped while the file header still listed it — a fixed finding left with no
regression guard. It was caught only because the header disagreed with the
contents, and has been restored. Expect this failure mode again: when a spec is
re-pointed, check that every section named in its header still exists.

### RT-004 — a regression that was caught and closed, kept on the record

Mid-audit the refactor reduced `deriveMode` to `{ return fallback; }` with both
parameters unused, stamping **`OWNER`** on every family for every family-facing
admin — an affirmative false ownership claim in the audit trail, worse than the
`COVERAGE` it replaced. It is **now fixed** (`authorization.service.ts:311-326`:
async, `OWNER` only for the actual owner, `onDuty()` consulted for `COVERAGE`,
`ASSIST` otherwise) and was fixed **before it was committed**.

It stays on the record because the near-miss is the lesson: the regression and
the spec that proved it would have disappeared in the same commit. That is the
failure mode RT-027 describes, and it nearly landed.

---

## 4. The rule that governs every fix

`apps/api/test/unit/red-team/` holds **security regression tests** — 24
assertions across 6 sections, currently intact and unmodified in substance.

> A fix must make the invariant hold, and the assertion must be inverted in the
> same commit. A test must never be deleted, skipped, renamed away, or weakened
> because the implementation fails it.

A red-team spec relaxed to go green is a regression in the audit, not a fix in
the product.

---

## 5. What is now tested, and what still is not

The acceptance chain was executed, not inferred:

| Link | Result |
|---|---|
| EMPTY DATABASE → MIGRATIONS | ✅ 20 migrations from zero on a bare `postgres:17`; re-apply is a no-op |
| MIGRATIONS → SCHEMA | ✅ 58 structural assertions; no non-`chat` tables, no `auth` schema |
| → RUNNING BACKEND | ✅ boots; `/health/ready` reports `database: up, redis: up` |
| → AUTH | ❌ **RT-001** — a header names the actor |
| → HTTP | ✅ 6 controllers mapped and answering |
| → DATABASE | ✅ reads and writes through the running API |
| → BR-1 ENFORCEMENT | ✅ 403 at the API, and refused by the database with the application bypassed |
| → REALTIME | ⚠️ gateway boots and is registered; **not exercised end to end** |
| → MOBILE / ADMIN CLIENT | ❌ **not exercised against the running API** |

Still untested, and not clearances:

| Area | Blocked by |
|---|---|
| Realtime end to end | Not driven by a client in this pass. The gateway's auth is RT-001. |
| Mobile and Admin Web against the live API | Neither client was run against it; contract drift between them and the six new controllers is unverified. |
| Chaos / recovery, queue and worker attacks | `worker.ts` now exists and was not exercised. No chaos was injected. |
| Jawwid Core integration | `chat.core_event` ingestion exists; webhook replay, ordering and authenticity were not attacked. |
| RLS policies | `20260905091200_chat_rls` applies, but no policy was tested from an unprivileged role. The API connects as owner, so RLS is currently inert in practice. |

## 6. Recommended order — advisory

1. **RT-001** — now the only P0, and the only broken link in the acceptance
   chain. Everything else in this report is downstream of it.
2. **RT-006, RT-009** — the remaining authorization P1s.
3. **RT-010** — the tenancy decision. Smaller than it was: the schema divergence
   is gone, only the "inside Core's database" claim in the foundation migration
   header remains. **Not this audit's call.**
4. **RT-028** — decide the privacy assertion; it will red CI intermittently until
   someone owns it.
5. Exercise **realtime and the two clients** against the running API. That is the
   part of the acceptance chain this pass could not reach.
6. The remaining P2s and P3s.
