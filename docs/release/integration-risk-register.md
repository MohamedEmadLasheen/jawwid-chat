# Integration Risk Register — Multi-Agent Shared Working Tree

Date: 2026-09-05 · Owner: AI #4 · Status: **MERGING FROZEN**
Companion to `cross-agent-product-conformance.md`.

> ## A clean Git merge is NOT evidence of compatibility.
>
> Re-verified today: `feat/infrastructure` merges with `feat/backend-foundation`,
> `feat/communication-engine` and `main` with **zero textual conflict**. Every
> divergence in this register survives that merge silently. Textual
> non-conflict is the *symptom* of the problem — two stacks that never touch the
> same lines because they define the same concepts in different places.

## Severity

`P0` release-blocking · `P1` blocks integration of an area · `P2` correctness/rework debt.

---

## RR-01 · Branch divergence — four heads, none merged, most of the system untracked

**P0.** Four branches exist and none has been merged into another. `main` holds
no application code. The system exists as: SQL migrations on
`feat/backend-foundation`, the Nest engine largely in the working tree, Admin Web
and Flutter on `feat/infrastructure`.

**Why a merge does not fix it:** no single commit has ever contained the whole
system, so "the release candidate" has never been built, started or tested as one
thing. Merging produces a state no one has run.

**Evidence:** `git branch -a`; AI #10 §1–§2.
**Action:** integrate in the sequenced order of §"What must be merged first". Do
not fast-forward everything at once.

---

## RR-02 · Schema divergence — two databases claiming the same entities

**P0. The most dangerous item here.** Stack A (AI #1) targets the `chat` schema
via `supabase/migrations` + `scripts/db/apply.sh`. Stack B (AI #2) targets
`public` via Prisma with `?schema=public` and no `@@schema`.

Applied together they create **two disjoint, mutually unaware definitions** of
`staff`, `family`, `contact`, `config`, `event_log`, `audit_log`, `thread` and
`message`. They merge cleanly *because* they never touch the same file.

Divergences already visible: `contact.can_message` defaults `false` in A and
`true` in B — opposite defaults on a **capability flag that gates whether a
parent may speak**. `config` diverges in key names *and* failure mode
(`chat.config_num()` raises on a missing key; `AppConfigService.get()` silently
returns a hardcoded default — which also violates "all constants read from
config").

**Evidence:** `schema.prisma:20`; `20260905090000_chat_foundation.sql:13`;
AI #10 RC-06.
**Action:** resolve OD-02 (one database) **before** any merge. `docs/release/database-decision.md` exists untracked — surface it.

---

## RR-03 · API contract divergence — three parties, no shared contract

**P0.** Admin Web declares 34+ endpoints under `/api/v1`; the backend exposes 3
routes, all under `/health`, with no `/api/v1` prefix. Mobile declares its own
third set. Each client invented a contract in good faith because none existed.

**Compounding:** casing (`snake_case` admin vs `camelCase` backend), idempotency
header (`Idempotency-Key` vs `X-Idempotency-Key`), and error envelope all differ.

**Evidence:** `apps/admin-web/src/core/api/endpoints.ts`; `grep @Controller` →
health only; `api_client.dart`.
**Action:** one generated contract; both clients regenerate. My endpoint file was
always labelled *"proposed, awaiting sign-off"* — it is a proposal to discard or
adopt, not a position to defend.

---

## RR-04 · Role divergence — Teacher is not an actor

**P0.** The PRD requires a Teacher mobile app, Teacher↔Admin conversations and
teacher membership in Student Groups. Today: `chat.staff.role` excludes teacher;
`chat.learner.teacher_id` is a bare `uuid` with no FK and no identity behind it;
`ActorKind` has no teacher; `FAMILY_FACING_ROLES` bars ACADEMIC staff from family
communication; Admin Web's `StaffRole` has no teacher.

**Consequence:** BR-1 currently "holds" only because the teacher cannot
authenticate at all. That is not enforcement — it is absence.

**Evidence:** AI #5 C-1, JC-003; `apps/admin-web/src/shared/types/domain.ts`.
**Action:** AI #1 makes teacher a first-class actor; clients follow. Teacher is
**not** CS staff — do not solve this by widening the staff-role enum in the admin
UI.

---

## RR-05 · Realtime divergence — two vocabularies, one overlapping name with an incompatible payload

**P0.** Admin subscribes on namespace `/staff` to 11 snake_case events. AI #2
emits 11 events on the **default** namespace with camelCase payloads. Only
`message.created`, `presence.changed` and `handoff.created` overlap by name, and
their payloads disagree (`{family_id, message}` vs `{threadId, messageId, seq}`).

**8 of the admin's 11 events have no producer at all**: `family.updated`,
`case.updated`, `task.updated`, `coverage.changed`, `ownership.changed`,
`unattended.changed`, `escalation.created`, `shift.ending`. The inbox's entire
freshness model depends on them.

The gateway is additionally declared `cors:{origin:false}`, which blocks the
admin's cross-origin socket outright, and `handleConnection` trusts a
client-supplied `handshake.auth.userId` — **any client may impersonate any user
over the socket** (RC-03).

**Evidence:** `apps/api/src/communication/contracts/events.ts`;
`apps/admin-web/src/core/realtime/events.ts`; `realtime.gateway.ts:36,63`.
**Action:** AI #2's contract file already states clients generate from it — do
that. The socket-auth bypass is a **security defect**, not an integration one;
fix it independently of this freeze.

---

## RR-06 · Domain-model divergence — three conversation models

**P0.** Three incompatible models coexist:

| Party | Model | PRD-conformant? |
|---|---|---|
| AI #4 | `thread.family_id UNIQUE`, one thread per family, cases layered | ❌ C-2 |
| AI #3 | `ConversationKind{jawwidSupport, studentGroup, adminDirect}` | ✅ closest |
| AI #1/#2 | `thread` in two schemas, no `kind`, no participant set | ❌ |

BR-1 must be evaluated over *(actor, conversation, channel)*. **None of the three
carries a participant set**, so BR-1 is currently unenforceable in all of them.

**Action:** adopt AI #3's kinded model, add explicit participants, make it the
single authorization path for messaging **and** calling.

---

## RR-07 · Migration divergence — two authorities, one with no history

**P0.** Stack A: `apply.sh` + `chat.schema_migrations` (sound). Stack B:
`prisma db push` only — **no `prisma/migrations/` directory**, no history, no
down path. There is no single definition of "all migrations", so the mandatory
fresh-DB and upgrade tests cannot be written, let alone run.

**Action:** one authority. If Prisma wins it needs a real migration history
generated before any deploy; `db push` is not a migration strategy.

---

## RR-08 · Environment / configuration divergence

**P1.** `check-env.sh production --file infra/env/production.env.example` →
**34 errors, exit 1** (25 required vars missing, `NODE_ENV` not `production`,
`APNS_PRODUCTION` not `true`). The gate is well-built; the template it grades is
not. `docs/infrastructure/` is an **empty directory** while `.env.example` and
the `Dockerfile` cite five files inside it. `DATABASE_URL` pins `?schema=public`,
silently choosing Stack B (RR-02).

Admin Web needs `VITE_API_BASE_URL` and `VITE_REALTIME_URL`, which no shared
manifest declares.

---

## RR-09 · Shared-working-tree hazards *(the category that produced this audit)*

**P1 — and the one most likely to recur.** Five-plus agents commit into **one**
working tree, not separate worktrees. Observed today, not hypothesised:

1. **`git add -A` cross-contamination.** A peer's blanket stage swept AI #4's
   uncommitted `docs/admin/discovery-report.md` into commit `4c923da`, attributed
   to another agent.
2. **A `.gitignore` written by one agent silently deleted another's feature.**
   My own `coverage/` rule matched `apps/admin-web/src/features/coverage/`.
   Commit `cac9dac` claimed the Coverage screen shipped; it did not. **The build
   kept passing because Vite reads from disk**, so a fresh clone would not build.
   Undetected for four commits. (AI4-D1, now fixed.)
3. **Reports go stale within minutes.** AI #10 records "Admin Web tests — none
   exist"; 74 now exist and pass. AI #10 also had to correct AI #8 on a branch
   head that moved mid-audit.
4. **The tree changed underneath this very audit** — `docs/release/`,
   `docs/red-team/` and `scripts/infra/backup-db.sh` appeared while it ran.

**Actions:** stage explicit paths, never `git add -A`; `.gitignore` rules must be
anchored (`/coverage/`, `apps/admin-web/coverage/`) never bare; treat every
cross-agent report as valid only at its stated commit; verify claims against the
tree before acting.

---

## RR-10 · Scope divergence from an absent authority

**P0.** PRD v0.1 is **not in the repository**. Scope is graded against AI #5's
summary, and AI #8 records a second, partly conflicting reconciliation. Three
agents independently read the superseded PDF as authoritative and built from it —
that was not carelessness, it was the predictable result of the governing
document being unavailable while a document claiming to be *"the contract for
what to build"* sat in `docs/`.

**Until PRD v0.1 is on disk, every conformance verdict in the companion document
is provisional.**

**Action (product owner):** add PRD v0.1 to `docs/`. This is the cheapest
blocker on the list and it gates the value of all the others.

---

## RR-11 · Verification divergence — green locally, unrunnable together

**P2, corrosive.** Each agent's checks pass in isolation: Admin Web builds and
runs 74 tests; API typechecks. Yet **no API process exists** (`main.ts` absent,
`Dockerfile CMD` runs a file the build never produces), the outbox has **no
consumer**, and 0 of 34+ admin endpoints are implemented.

**Every green check in this repo is a unit-level check.** Not one exercises two
agents' code together. My own 74 tests prove the Admin Web is internally
consistent and prove **nothing** about whether it works against the real backend.
Treating that suite as integration evidence would be the same error as trusting
the clean merge.

---

## Freeze status

| Action | Status |
|---|---|
| Broad cross-agent merging / reconciliation | 🔴 **FROZEN** |
| Continued isolated work behind declared seams | 🟢 permitted |
| Narrow fixes to already-written work (e.g. AI4-D1) | 🟢 permitted |
| Any code resolving AMB-9 | 🔴 **FORBIDDEN** |
| Any new client-side contract invention | 🔴 **FORBIDDEN** — unify first |
