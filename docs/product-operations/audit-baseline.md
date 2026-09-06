# Audit Baseline — FROZEN

**Owner:** AI #8 · **Baseline frozen:** 2026-09-05 at commit `d23bf93`
**Mode:** AUDIT / CONFORMANCE. No implementation passes.

This is the immovable reference for the AI #8 audit: **15 conflicts · 7 blocking decisions ·
32 failure scenarios · 20 recommendations.** Findings are never silently rewritten as the
code changes. When a peer changes something, the finding gains a **BEFORE / AFTER /
VERIFIED STATUS** row below and the original text stays.

## Verification status vocabulary

| Status | Meaning |
|---|---|
| **CONFIRMED** | re-verified against the working tree at the re-verification date |
| **FIXED** | a peer's change satisfies the acceptance criteria; evidence cited |
| **PARTIALLY FIXED** | the mechanism changed; the operational gap remains |
| **SUPERSEDED BY REFACTOR** | the code the finding described no longer exists; the finding must be re-raised against the replacement once it stabilises |
| **UNVERIFIED** | cannot be checked today |
| **UNVERIFIED — PRD SOURCE NOT PRESENT** | conformance cannot be judged because PRD v0.1 is not on disk |

---

## Re-verification pass 1 — 2026-09-05, working tree at `d23bf93` + uncommitted peer work

The tree moved substantially between the baseline and this pass. AI #1 landed
`supabase/migrations/20260905093000_chat_communication.sql`, introducing
`chat.conversation`, `chat.conversation_member`, `chat.message_approval`, `chat.call`,
`chat.device_token` and the notification tables, and deleted
`apps/api/src/communication/threads/thread.service.ts`.

### Changed findings

| ID | BEFORE (baseline `d23bf93`) | AFTER (pass 1) | VERIFIED STATUS |
|---|---|---|---|
| **FS-11 / R-06 (assist)** | `authorization.service.ts` allowed `requestedMode: ASSIST` from any family-facing admin unconditionally | `fa53ba7` denies client-supplied ASSIST/ESCALATION outright (`ASSIST_NOT_PERMITTED`). The server-evaluated grant is still unimplemented; `assist.min_wait_fraction` still read by nothing | **PARTIALLY FIXED** — bypass closed, permitted case still unavailable. Downgraded P0 → P1 |
| **FS-05 / X-06 (multi-child groups)** | `Thread @@unique([familyId, kind])` permitted one `STUDENT_GROUP` thread per family | `chat.conversation` is typed (`direct · student_group · class_group · official`) with `create unique index conversation_one_group_per_learner on chat.conversation (learner_id) where type='student_group' and archived_at is null` | **FIXED in the SQL stack.** Prisma still carries the old constraint — see DB-07 |
| **FS-18 / JC-002 (BR-1 structural)** | BR-1 held only because no multi-party conversation could exist | `chat.enforce_direct_conversation_rules()` trigger on `conversation_member` raises on a live `teacher` + `contact` pair in a `direct` conversation, on insert **and** update | **FIXED in the SQL stack** at the DB layer. Enforcement at the API layer and at group→direct promotion remains **UNVERIFIED** |
| **FS-17 / JC-003 (teacher identity)** | `ActorKind` had no teacher; teachers could not authenticate | `ActorKind.TEACHER` exists; `chat.message.author_type` widened to include `teacher`; `conversation_member.actor_kind` includes `teacher` | **PARTIALLY FIXED.** `IdentityService` resolves a teacher by `chat.learner.teacher_id` and hardcodes `isActive: true` — declared by AI #1 as a temporary seam. Re-raised as **CF-08** |
| **FS-06 / X-05 (conversation state)** | `conversationState()` inferred `WAITING_ON_CUSTOMER` whenever staff spoke last | `chat.conversation.state` is a **stored, explicit** column (`open · waiting_on_customer · waiting_on_jawwid · resolved`), default `open` | **FIXED in the SQL stack.** `apps/api/src/communication/contracts/dto.ts` still infers. Whether any writer sets the column correctly is **UNVERIFIED** |
| **FS-01 / X-14 / R-04 (audience)** | `familyThreadAudience()` returned contacts + `family.owner`, excluding the covering admin | The method has been **removed** from `IdentityService`. `message.service.ts:134` still calls it, so the Node stack does not compile. `chat.conversation_member` is the intended replacement | **SUPERSEDED BY REFACTOR** — must be re-raised against `conversation_member` once the Node layer is rebuilt. The operational requirement is unchanged: see CF-01 |
| **FS-13 (coverage resolving owner-locked)** | `thread.service.ts::setResolved()` allowed any family-facing admin to resolve any thread | `thread.service.ts` **deleted** | **SUPERSEDED BY REFACTOR** — re-raise against the replacement |
| **X-02 (`can_message` default)** | SQL `default false` vs Prisma `@default(true)` | Prisma is now `canMessage Boolean @map("can_message")` — no Prisma-side default; the database default governs | **FIXED** |
| **X-01 / OD-02 (two stacks)** | Undecided; two stacks defining the same six tables | **Decided by the product owner 2026-09-05:** one standalone PostgreSQL database, **SQL migrations authoritative**, Core integration via an API/webhook boundary | **DECISION MADE** — reclassified from OPEN PRODUCT DECISION to ARCHITECTURE CONFLICT with a known target. See `database-divergence.md` |

### Unchanged findings — re-verified CONFIRMED

| ID | Evidence at pass 1 |
|---|---|
| **FS-02 / FS-03 / R-05** (stickiness on every message; presence ignored) | `message.service.ts:199-200` still sets `stickyHandler`/`stickyUntil` on every staff customer-facing message. No `presence` reference exists in `coverage.service.ts` or anywhere in the sticky path. `chat.conversation.sticky_handler_id`/`sticky_until` carry no presence condition |
| **FS-12** (manager mode client-chosen) | `authorization.service.ts:130-131` — `return allow(intent.requestedMode ?? OnBehalfMode.ESCALATION)` unchanged |
| **FS-30 / X-03 / R-12** (config fail-quiet) | `app-config.service.ts:52` — `row?.value ?? COMMUNICATION_CONFIG_DEFAULTS[key]` unchanged. `handoff.grace_minutes` is now seeded **twice** (`090100` scope `coverage`, `093100` scope `communication`), guarded by `on conflict (key) do nothing` |
| **FS-07 / FS-08 / FS-09 / R-09** (no case/task; no producers) | no `chat.support_case` or `chat.task` migration exists on this branch; `chat.subscription` still has no writer |
| **FS-04 / CV-7 / R-14** (Unattended) | still a dropped `null` |
| **FS-15 / OW-1..3 / R-15** (`transfer_ownership`, offboarding) | still absent |
| **FS-31 / R-17** (unscoped inbox) | superseded with `thread.service.ts`; requirement stands |
| **FS-25 / FS-26 / R-16** (Core sync, staleness) | no sync job; now **in scope of the locked API/webhook boundary decision** |
| **AT-1 / R-08** (dead attention signals) | unchanged — no producers |

### New findings raised in pass 1

| ID | Finding | Sev |
|---|---|---|
| **NF-01** | **The Node stack does not compile.** `npx tsc -p tsconfig.json --noEmit` in `apps/api` fails: `Cannot find module '../threads/thread.service'`, `has no exported member 'AuthorType' / 'MessageType' / 'MessageVisibility' / 'MessageOrigin'`, `Property 'canReadThread' does not exist`, plus 10+ DTO errors. The communication layer is mid-migration and currently non-functional | **P0** |
| **NF-02** | **The SQL migration series is not applicable on `feat/infrastructure`.** `20260905093000_chat_communication.sql` references `chat.staff`, `chat.family`, `chat.learner` and `chat.thread` 10 times; none is created on this branch. They live in `20260905090200`, `20260905090300` (branch `feat/backend-foundation`) and `20260905090400_chat_conversation_domain.sql` (not on any branch head reachable here). **A fresh database cannot be built from any single branch** | **P0** |
| **NF-03** | `SqlCoverageService` calls `SELECT chat.on_duty(...)`. **No migration creates `chat.on_duty()`** anywhere in the reachable tree. Coverage resolution will fail at runtime, not degrade | **P0** |
| **NF-04** | `handoff.grace_minutes` is defined in two migrations with two different `scope` values (`coverage`, `communication`). The `on conflict do nothing` guard means the winner depends on migration order | **P2** |
| **CF-08** | Teacher identity is inferred from `chat.learner.teacher_id` with `isActive: true` hardcoded and `displayName: 'Teacher'`. Any uuid appearing in that column resolves as an authenticated actor. AI #1 declares this a temporary seam; it must not reach a deployed environment | **P1** |

---

## Baseline inventory (frozen — do not edit)

| Artifact | Count | Location |
|---|---|---|
| Cross-agent conflicts | **15** (X-01 … X-15) | `cross-agent-audit.md` |
| Open decisions | **15**, of which **7 blocking** | `open-decisions.md` |
| Failure scenarios | **32** (FS-01 … FS-32) | `failure-scenarios.md` |
| Recommendations | **20** (R-01 … R-20) + 5 × P2 (R-21 … R-25) | `recommendations.md` |
| Operational simulations | **5** (SIM-1 … SIM-5) | `simulations.md` |
| Positive findings preserved | **8** | `positive-controls.md` |

## Rules for this baseline

1. A finding is closed only by **evidence**, never by a peer's assertion that it is fixed.
2. A finding whose subject code is deleted becomes **SUPERSEDED BY REFACTOR**, not FIXED.
   The operational requirement survives the refactor and must be re-raised.
3. Severity may be downgraded on evidence; the original severity stays visible.
4. Anything that cannot be judged because PRD v0.1 is absent is marked
   **UNVERIFIED — PRD SOURCE NOT PRESENT**. It is never guessed.
5. Each re-verification pass appends a new dated section. Previous passes are not edited.

---

## Re-verification pass 2 — 2026-09-06

Two things changed the picture since pass 1: **AI #1's `feat/backend-foundation` advanced from
`73ccb39` to `a5258cf`** (4 migrations → **14**), and **AI #10 became active**, independently
verifying and in one case correcting this audit.

### Corrections accepted from AI #10

AI #10's `docs/release/reconnaissance.md` corrects §1.1 of `discovery.md`. **Verified
independently before acceptance** (my own rule: a finding closes on evidence, not assertion):

```
git log --oneline -1 feat/backend-foundation          → a5258cf
git ls-tree -r --name-only feat/backend-foundation -- supabase/migrations → 14 migrations
git grep -l "function chat.on_duty|chat.transfer_ownership" feat/backend-foundation
        → 20260905090600_chat_coverage_engine.sql, 20260905090700_chat_ownership_invariants.sql
```

**The correction is accepted.** My baseline recorded these as *missing*; they are **written but
unmerged**. The operational conclusion is unchanged — no branch that could execute them
contains them — but the characterisation was wrong and is corrected here rather than quietly.

### Findings whose status changes because the work exists on `feat/backend-foundation`

| ID | BEFORE (baseline) | AFTER (pass 2) | VERIFIED STATUS |
|---|---|---|---|
| **OW-1 / R-15** | `transfer_ownership()` does not exist | `20260905090700_chat_ownership_invariants.sql` defines `transfer_ownership()`, `guard_owner_change()` + `family_owner_is_guarded` trigger, `apply_owner_lock()`, `guard_owner_locked_case_closure()`, `guard_staff_deactivation()` | **WRITTEN, UNMERGED.** Satisfies OW-1 **and** OW-2 (trigger-enforced) on that branch. Not verifiable in any runnable tree |
| **NF-03 / CV-*** | `chat.on_duty()` called but created by no migration | `20260905090600_chat_coverage_engine.sql` defines `local_at`, `window_contains`, `in_shift`, `is_absent`, `absence_backup`, `coverage_chain`, `on_duty`, `effective_handler`, `extend_stickiness` | **WRITTEN, UNMERGED.** NF-03 was accurate for the reachable tree and is **narrowed**: the function is absent from the branch that calls it, not absent from the project |
| **CF-04 / WL-1** | no workload engine | `20260905090800_chat_attention_and_workload.sql` defines `attention_signals`, `attention_score`, `attention_top_reason`, `attention_bucket`, `response_target_minutes`, `families_on_duty`, `workload_units`, `recompute_family_state` | **WRITTEN, UNMERGED.** INV-CF04c (breakdown) and OD-07 (staleness) remain **UNVERIFIED** — not yet read |
| **CF-07 / R-09** | no `case`/`task` layer anywhere | `feat/backend-foundation` carries `support_case`, `task`, `handoff`, `family_state_cache` per AI #10's inventory | **WRITTEN, UNMERGED** — contents not yet audited by AI #8 |
| **FS-16** | `on_duty()` must skip inactive staff at every link | `guard_staff_deactivation()` exists | **UNVERIFIED** — needs reading |

**Baseline discipline note.** None of these is marked FIXED. Work on an unmerged branch that
no runnable tree contains is **WRITTEN, UNMERGED** — a distinct status, added here, because
grading it FIXED would let a release gate pass on code that cannot execute.

### New finding — conformance breach against a locked decision

| ID | Finding | Sev |
|---|---|---|
| **CF-09** | **The Jawwid Core integration boundary is direct database coupling, contrary to locked decisions 1, 2, 3 and 6.** `20260905090900_chat_core_integration.sql` creates `chat.core_parent`, `chat.core_child` and `chat.core_subscription` as **views over `public.profiles`, `public.children`, `public.subscriptions` and `public.payments`**. Its own header states: *"The two share a database but not a namespace."* | **P0 — RELEASE BLOCKER** |

**In fairness to AI #1:** this migration predates the locked decision, it confines the entire
Core surface to three views, and its header anticipates exactly this remediation — *"keeps the
surface small enough to re-point at an HTTP client or a separate database later without
touching the domain."* `chat.core_event` + `record_core_event()` + `mark_core_event_processed()`
are already webhook-shaped and idempotent. **The design absorbed the change it now needs.**

**Required invariant.**
> **INV-CF09** — No object in the `chat` schema references `public.*` or `auth.*`. Core data
> enters only through the API/webhook boundary and lands in Chat-owned tables.

**Owner.** AI #1, sequenced by AI #10.
**Acceptance criteria.** (1) `grep -rn "public\.\|auth\." supabase/migrations` returns no
dependency; (2) the three `core_*` views are replaced by Chat-owned tables fed by the
boundary; (3) every mirrored entity has a named producer and a visible `synced_at`;
(4) release-gate G-21 becomes evaluable for the first time.
**Do not merge:** **DB-M9** — any object referencing `public.*` or `auth.*`.

### Corroborated by AI #10, not duplicated

- **RC-01** (no `main.ts`, no `AppModule`; `HealthModule`/`PlatformModule` imported by nothing)
  — verified independently: `ls apps/api/src/main.ts` → absent; `grep -rl "class AppModule"` →
  none. **Supersedes and subsumes my NF-01**: the Node stack neither compiles nor has a process.
- AI #10's `blockers.md` records JC-005 and JC-006 as VERIFIED FIXED, and keeps the MANAGER
  branch open as **RT-003** — the same defect this baseline carries as **FS-12**. Converging
  independently on the same finding from three agents (AI #8, AI #9, AI #10) raises confidence.

### Unchanged and re-verified CONFIRMED at pass 2

**CF-01** (audience), **CF-02** (stickiness scope + presence), **CF-05** (Node state inference),
**CF-06** (renewal producers), **FS-12** (manager mode), **X-03** (config fail-quiet),
**NF-02** (no branch builds a database) — all unchanged in the working tree.
