# Jawwid Chat — AI #8 Discovery Report

**Owner:** AI #8 (Product · Business Operations · Domain Logic · Cross-Agent Intelligence)
**Date:** 2026-09-05 · **Status:** COMPLETE (first pass)
**Method:** static inspection of every tracked file on all four branches, plus the working tree.
Nothing below is asserted from documentation alone; every claim cites a file.

---

## 0. Headline

The repository contains **three internally-coherent systems that do not fit together**:

1. A **staff-side CS console** (SQL migrations, Admin Web) built faithfully from the
   superseded PDF brief.
2. A **communication engine** (NestJS + Prisma) built from the same brief, which explicitly
   marks Student Groups, approvals and calling as *"DESIGN-ONLY. Not implemented."*
3. A **parent + teacher mobile app** built from the PRD scope, which requires exactly those
   three things.

AI #5 has already recorded the scope divergence (`docs/qa/authoritative-scope.md`,
`defects.md` JC-001/002/003) and I do not restate it. **What this report adds is the
operational layer:** the operating model that the product is named for — permanent
ownership, coverage, attention, workload, cases, tasks, follow-ups, renewals, handoffs —
**has no executable implementation anywhere in the repository.** It exists as config rows,
TypeScript type declarations and API endpoint constants.

---

## 1. Current repository state

### 1.1 Branch topology — nothing is integrated

| Branch | Head | Contains |
|---|---|---|
| `main` | `eeca866` | initial commit only — **empty** |
| `feat/backend-foundation` | `73ccb39` | `chat.staff`, `shift`, `coverage_rule`, `absence`, `family`, `contact`, `learner`, `subscription`, `family_note` migrations |
| `feat/communication-engine` | `be77391` | (QA docs at head; the Prisma/Nest engine is in the working tree) |
| `feat/infrastructure` | `7597ee6` | current checkout; QA docs, infra, Admin Web, Flutter app |

`main` is an empty initialisation commit. **No agent's work has been merged with any
other agent's work.** The two migrations that define `chat.staff` and `chat.family` are
not present on the branch where the Admin Web that consumes them lives.

*Operational consequence:* no one has ever executed the system end-to-end. Every
"it works" statement in the repository is a statement about one branch in isolation.

### 1.2 Two incompatible persistence stacks for the same entities

| Entity | Stack A — `supabase/migrations/*.sql` (AI #1) | Stack B — `apps/api/prisma/schema.prisma` (AI #2) |
|---|---|---|
| Location | `chat` schema **inside Jawwid Core's Supabase database** | standalone Postgres, default schema |
| `staff.role` | `check (role in ('admin','coverage','manager','finance','technical','academic'))` | `enum StaffRole { ADMIN … ACADEMIC }` |
| `contact.can_message` | `boolean not null default **false**` | `canMessage Boolean @default(**true**)` |
| `family` | 15 columns incl. `state`, `tier`, `manual_flag`, `core_parent_id` | 6 columns — no state, no flag, no Core id |
| `message` | *(not created)* — but `chat.forbid_mutation()` exists to make it append-only | mutable: soft delete, `redactedReason`, `deletedForAll` |
| Config keys | `timers.no_reply_reminder_hours`, `reopen.window_hours`, `automation.batch_ack_seconds` | `automation.no_reply_reminder_hours`, `automation.reopen_window_hours`, `automation.ack_batch_seconds` |
| Missing config behaviour | `chat.config_num()` **raises** `no_data_found` | `AppConfigService.get()` **silently returns a hardcoded default** |

These are not two layers of one system. They are two systems that both believe they own
`staff`, `family`, `contact`, `config`, `event_log` and `audit_log`.

### 1.3 Jawwid Core coupling — contradicts the stated architecture

`supabase/migrations/20260905090000_chat_foundation.sql` header:

> *"It lives in the `chat` schema **inside the Jawwid Core Supabase database**. Core (the
> `public` schema) stays the source of truth…"*

and `20260905090300_chat_family_domain.sql`:

> *"Mirrors `public.subscriptions.status` verbatim so the boundary needs no translation
> table. **If Core widens its vocabulary this CHECK must widen too.**"*

Same-database, same-cluster co-tenancy with a hand-copied CHECK constraint is a tighter
coupling than "a dedicated integration boundary". The mitigation chosen (no foreign keys
to `public`/`auth`) prevents *referential* coupling but not *operational* coupling: a Core
release that adds a subscription status writes rows Chat's CHECK rejects. Stack B, meanwhile,
assumes an entirely separate database. **Which of the two is the architecture is undecided.**

---

## 2. Product source of truth — still unresolved

| Artifact | On disk | Status |
|---|---|---|
| `docs/JAWWID_CHAT_BRIEF.pdf` / `.txt` | yes | declares itself the contract; AI #5 declares it superseded |
| **PRD v0.1** | **no** | governing per `docs/qa/authoritative-scope.md` §6, *"not on disk"* |
| `docs/qa/authoritative-scope.md` §3 | yes | the *de facto* operative record of scope |
| `README.md` | yes | still points to `docs/brief/JAWWID_CHAT_BRIEF.md` — **a path that does not exist** |

There are also **two mutually inconsistent reconciliations on record** of the same conflict,
both attributed to the product owner on the same day:

- **A (`docs/qa/authoritative-scope.md`):** PRD v0.1 supersedes the brief; the brief's
  *communication* chapter is void, its *operating model* chapter survives.
- **B (project memory, `jawwid-chat-scope-split`):** the brief governs the **staff side**;
  the role assignments govern the **family/teacher side**.

A and B agree the mobile app is in scope. They disagree on whether
`thread.family_id UNIQUE` — the staff-side conversation model — still stands. Stack B's
schema comment cites the brief's non-negotiable ("thread is UNIQUE per family") as binding;
AI #5's C-2 says it is void. **This is OD-01 and it is blocking** (see `open-decisions.md`).

---

## 3. Agent outputs found

| Agent | Delivered | Nature |
|---|---|---|
| AI #1 | 4 SQL migrations (2 unmerged); `src/platform/*` seams | schema + interfaces. **No engine.** |
| AI #2 | Prisma schema, `thread`/`message`/`outbox`/`realtime`/`attachment` services | the only executable business logic in the repo |
| AI #3 | Flutter models, `CommunicationPolicy`, outbox, message log, 5 test files | client domain + policy, against a fake backend |
| AI #4 | Admin Web shell, `domain.ts`, `capabilities.ts`, `endpoints.ts`, inbox/family features | a complete API **contract** for a backend nobody has written |
| AI #5 | authoritative-scope, defects, rbac-matrix, release-gate, test-plan, system-inventory | strongest documentation in the repo; verdict **NOT READY** |
| AI #6 | design system, terminology (EN/AR), user journeys, cross-platform, decisions | authoritative UI vocabulary |
| AI #7 | `docker-compose.yml`, `infra/docker/`, `.github/` | local stack |

---

## 4. Current product reality — verified feature-by-feature

Verified by `grep -ril` across `apps/api/src`, `apps/admin-web/src`, `lib`, `supabase`, `db`.

| Capability | Schema | Backend logic | HTTP surface | UI | Verdict |
|---|---|---|---|---|---|
| Family / contact / learner / subscription | ✅ (both stacks, divergent) | — | — | types | **partial** |
| Thread + message + receipts + reactions | ✅ B | ✅ | ❌ | — | **partial, no API** |
| Realtime + outbox + presence + typing | ✅ B | ✅ | gateway | provider | **partial** |
| Attachments | ✅ B | ✅ | ❌ | — | partial |
| `on_duty()` coverage engine | ✅ A (tables) | ❌ **stub returns the owner** | ❌ | types | **missing** |
| `transfer_ownership()` | ❌ | ❌ | ❌ | one type name | **missing** |
| Case | ❌ | ❌ (`message.caseId` is an unconstrained nullable string) | ❌ | types | **missing** |
| Task / follow-up | ❌ | ❌ | ❌ | types + endpoints | **missing** |
| Handoff / "while you were away" | ✅ B (table) | ❌ nothing writes it | ❌ | UI component | **missing** |
| Attention engine | config rows only | ❌ | ❌ | types + inbox UI | **missing** |
| Workload engine | config rows only | ❌ | ❌ | types + badge | **missing** |
| Unattended list | — | returns `null` | ❌ | endpoint const | **missing** |
| Manager dashboard | — | ❌ | ❌ | endpoints | **missing** |
| Student Groups | ⚠️ B `/// DESIGN-ONLY` | ❌ | ❌ | ✅ mobile | **conflicting** |
| Approvals | ⚠️ B `/// DESIGN-ONLY` | ❌ | ❌ | ✅ mobile + route | **conflicting** |
| Voice / group calling | ⚠️ B `/// DESIGN-ONLY` | ❌ | ❌ | strings + route | **conflicting** |
| Teacher as an actor | ❌ barred by construction | ❌ | ❌ | ✅ mobile `UserRole.teacher` | **conflicting** |
| Push / device tokens / reminders | ✅ B (tables) | ❌ | ❌ | — | **missing** |
| Jawwid Core sync | boundary named, **no view, no job** | ❌ | ❌ | — | **missing** |

**Executable HTTP surface today:** `health.controller.ts` and `realtime.gateway.ts`. That is all.
`apps/admin-web/src/core/api/endpoints.ts` calls roughly forty endpoints, **none** of which exist.

---

## 5. Major gaps (operational, not covered by AI #5)

- **G-A · The operating model is a document, not a system.** Ownership transfer, coverage
  resolution, attention, workload, cases, tasks, follow-ups, handoffs and the Unattended
  list are the product's entire reason for existing over WhatsApp. None runs.
- **G-B · The covering admin is not in the delivery audience.**
  `identity.service.ts::familyThreadAudience()` returns *contacts + the permanent owner*.
  The on-duty coverage admin receives no receipt row, no realtime fan-out and no
  notification. Off-shift customer messages are delivered to the person who is off shift.
- **G-C · Stickiness is applied to assist and escalation, and ignores presence.**
  `message.service.ts` sets `stickyHandler` on **every** staff customer-facing message.
  The brief conditions stickiness on the replier being *"still online"*; nothing reads
  `staff.presence`. A manager who escalates once, or an admin who assists once, silently
  becomes the current handler — including after they log off.
- **G-D · Assist has no preconditions.** `authorization.service.ts` allows
  `requestedMode: ASSIST` from any family-facing admin unconditionally. The brief's gate
  (family in NOW, waited > 50% of target, on-duty admin has not opened it) is not
  implemented; `assist.min_wait_fraction` is seeded and read by nothing.
- **G-E · Conversation state mislabels Jawwid's own obligations.**
  `dto.ts::conversationState()` returns `WAITING_ON_CUSTOMER` whenever staff spoke last.
  *"We'll check and get back to you"* files the family under waiting-on-customer.
- **G-F · One Student Group per family.** `Thread @@unique([familyId, kind])` permits at
  most one `STUDENT_GROUP` thread per family, while `StudentGroup @@unique([learnerId])`
  expects one per student. **A family with two children cannot have two Student Groups.**
- **G-G · Two headline attention signals are structurally dead at launch.**
  `class_soon` (+40) needs `learner.next_class_at`; `payment_failed` (+20) and the renewal
  signals need `chat.subscription`. Both are Core mirrors with **no sync job**. The
  migration comment concedes `next_class_at` stays *"null while Core has no class schedule
  to sync."* The two loudest signals will never fire.
- **G-H · No admin-facing scoping.** `thread.service.ts::listThreadsForActor()` returns
  the 200 most recently active threads to any family-facing staff member, unordered by
  attention and unscoped by duty.
- **G-I · Teachers cannot authenticate.** `IdentityService.resolveActor()` resolves a
  `Staff` row or a `Contact` row. A teacher is neither.

---

## 6. Major conflicts

Full register in `cross-agent-audit.md`. The five that change what gets built:

1. **Two databases, two truths** (§1.2) — AI #1 vs AI #2.
2. **Thread model** — `UNIQUE(family)` (AI #1/#2, brief) vs typed multi-conversation
   (AI #3/#5, PRD).
3. **Teacher** — barred from all family communication (AI #2) vs a first-class app user (AI #3).
4. **Resolution** — AI #6 terminology: a conversation *"is never opened, closed or
   resolved"*; AI #2 ships `ThreadDto.state = RESOLVED` and `setResolved()`.
5. **Config namespace and failure mode** — divergent keys; fail-loud vs fail-quiet.

---

## 7. Open decisions

15 recorded in `open-decisions.md`. Blocking: **OD-01** (which reconciliation governs the
thread model), **OD-02** (one database or two), **OD-03** (what "required admin presence"
in a Student Group means — AI #5's AMB-9 restated as a product question), **OD-04** (who is
authoritative for teacher↔learner assignment), **OD-05** (does the family thread survive
alongside Parent↔Admin 1:1, or are they the same conversation).

---

## 8. Operational risks

| # | Risk | Why it matters |
|---|---|---|
| R-1 | Two admins each believe the other is handling a family | G-B + G-C: the owner is notified but off shift; the assistant is sticky handler but logged off |
| R-2 | Customers silently forgotten | G-E + no case/follow-up engine: nothing is due, nothing is overdue, nothing alerts |
| R-3 | Renewals invisible | renewal is a case type; the case table does not exist; the subscription mirror is unsynced |
| R-4 | Attention ranks by signals that cannot fire | G-G: the inbox order will be dominated by "unanswered" alone |
| R-5 | Multi-child families fragment or collide | G-F |
| R-6 | Merge collision destroys work | §1.1: four unmerged branches redefining the same tables |
| R-7 | Launch with an unusable admin inbox | G-H: no scoping, no sections, no ordering |

---

## 9. Proposed audit plan (next passes)

1. **Executed, in this pass:** operating model, ownership, coverage, workload, attention,
   conversation state, tasks/follow-ups, renewals, escalation, multi-child, domain language,
   failure scenarios, cross-agent register, simulations, open decisions, MVP readiness.
2. **Next, once OD-01/OD-02 are answered:** re-audit the corrected conversation model
   against BR-1 at *membership-mutation* time, and the Core sync contract entity by entity.
3. **Before pilot:** re-run the five simulations in `simulations.md` against running code,
   not documents. Every finding here is a static finding until then.
