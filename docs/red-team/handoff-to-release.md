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

27 findings. **18 open, 8 resolved, 1 closed.**

| Severity | Total | Open |
|---|---|---|
| P0 | 5 | **3** — RT-001, RT-023, RT-024 |
| P1 | 9 | 4 — RT-006, RT-009, RT-010 (partial), RT-025 |
| P2 | 5 | 5 — RT-011, RT-012, RT-013, RT-014, RT-027 |
| P3 | 7 | 7 — RT-020 partial |

**Red team position: RED TEAM FAILED** — two blockers stand, both proven by
execution.

Resolved during the audit, with the evidence that closed each recorded in
`findings.md`: **RT-002, RT-003, RT-004, RT-005, RT-007, RT-008, RT-026** and
**RT-027**, plus **RT-015** closed earlier. That is real progress on the
authorization and message-integrity surfaces, and it happened fast.

---

## 1. Release blockers — must be RESOLVED. Acceptance is not available.

| ID | Finding | Why it cannot be accepted |
|---|---|---|
| **RT-023** | The migration series cannot apply to an empty database. `chat.family`, `chat.staff`, `chat.learner`, `chat.thread`, `chat.message` are referenced by foreign keys and created by no migration. Still true at `b634fe8`. | No environment can be built from the repository. Every database-level control — the BR-1 triggers, the append-only log triggers, message immutability, the approval constraints — is installed **nowhere**. Accepting this means accepting that no reviewed database control exists in production. CI's own G-19 gate cannot pass. |
| **RT-024** | The BR-1 database backstop is bypassed by mutation: a legal Student Group becomes a teacher↔parent 1:1 channel with one `UPDATE chat.conversation SET type='direct'`. Calling has the identical bypass. | BR-1 is the product's constitutional rule. The control exists specifically to hold when the API is compromised and its own comment claims it does. Proven by execution against Supabase Postgres 17.6; the trigger set is unchanged at `b634fe8`. |

**Exit criteria.** `bash scripts/db/test-db.sh reset` succeeds on an empty volume
and is a no-op on re-run; G-19 is green; and the BR-1 invariant raises on the
**type-change path** as well as the insert path, for `chat.conversation` **and**
`chat.call`.

---

## 2. Must be resolved or explicitly accepted

### P0 — one open, and it is the whole authentication story

| ID | Finding | Status | If accepted, what ships |
|---|---|---|---|
| **RT-001** | The only runtime entry point takes self-asserted identity. `realtime.gateway.ts:57` reads `client.handshake.auth?.actorId` and treats it as an authenticated principal. **The field was renamed from `userId` to `actorId` during the refactor; nothing else changed.** | OPEN · CONFIRMED (static) | A complete authentication bypass. Every other control is downstream of an identity the caller chooses. Acceptable **only** if the gateway cannot start outside local — that guard does not exist. |

### P1 — four open

| ID | Finding | Status |
|---|---|---|
| **RT-025** | BR-1's "required admin presence" is unenforced. A `student_group` — or `class_group`, which the trigger does not cover at all — containing exactly one teacher and one parent and no admin is permitted. | OPEN · CONFIRMED (runtime) |
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
(authorization still decided before the transaction that acts on it).

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

## 5. What was never tested, and why

Not clearances — untested surfaces:

| Area | Blocked by |
|---|---|
| HTTP-layer attacks (REST IDOR, CORS, CSRF, rate limiting) | No `main.ts`, no `AppModule` at the time of testing; `/health` was the only controller. `applyInfrastructure()` is written, correct, and called by nothing. **Re-check — `src/communication/api/` appeared in the working tree during the audit.** |
| Chaos / recovery, queue and worker attacks | Nothing to kill: `docker-compose.yml` provisions Postgres, Redis and MinIO but no API container. No queue, worker or job exists. Database-layer chaos *was* possible and produced RT-023/024/025. |
| Notification and search attacks | `notifications/` and `handoff/` were empty directories; no search exists. |
| Calling attacks beyond the database trigger | `calls/call.service.ts` appeared during the audit and was not attacked at runtime. |
| Jawwid Core integration attacks | No integration code; `CORE_*` environment variables only. Webhook replay, ordering and authenticity all unaddressed. |

**Re-run the campaign once the application boots.** Reproduction commands are in
[`README.md`](README.md). Given how fast this tree moves, treat any finding older
than a few commits as needing re-verification before you act on it.

---

## 6. Recommended order — advisory

1. **RT-023** — cheap, unblocks G-19, and until it lands no database fix reaches any environment. **Blocker.**
2. **RT-024**, then **RT-025** — the BR-1 gaps. RT-023 must land first for the fix to exist anywhere. **RT-024 is a blocker.**
3. **RT-027** — re-point the specs; this is also the fix validation for the six findings closed without a guard.
4. **RT-001** — the cheapest single break in the attack chain (`cross-agent-red-team.md`).
5. **RT-010** — the tenancy decision. **Not this audit's call.**
6. **RT-006, RT-009**, then the P2s.
