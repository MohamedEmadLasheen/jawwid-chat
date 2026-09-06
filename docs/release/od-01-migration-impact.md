# OD-01 — Migration Impact Note

Date: 2026-09-06 · Owner: AI #10 · Status: **ANALYSIS ONLY — NO MIGRATION WRITTEN**
Authority: `docs/product/jawwid-chat-prd-v0.1.md` + product decisions C-1…C-4 (2026-09-06)
Reconciled against: working tree at `ecf4192`, **including AI #1/#2 uncommitted work**

> **Nothing in this note has been implemented.** No migration was written, no
> schema changed, and **no AI #1 or AI #2 file was modified**. Only two new files
> in `docs/release/` (AI #10's namespace) were created, so there is no overwrite
> surface and no worktree isolation was needed. No `git add -A` was used;
> nothing was committed.

---

## 0. Reconciliation against AI #1/#2's latest state — they have moved a long way toward the PRD

This must be said before any impact list, because the delta is much smaller than
it was at reconnaissance. Verified in the working tree today:

| Landed | Evidence |
|---|---|
| `chat.conversation` with **exactly the four PRD types** | `20260905093000_chat_communication.sql:45` — `check (type in ('direct','student_group','class_group','official'))` |
| Conversation state matching PRD §7.5 verbatim | `check (state in ('open','waiting_on_customer','waiting_on_jawwid','resolved'))` |
| `learner_id` required for `student_group` | `check (type <> 'student_group' or learner_id is not null)` — **satisfies §7.3 one-group-per-student** |
| `direct_key` unique, "two participant ids sorted and joined" | **already the exact mechanism C-2 requires** |
| Approval flags `teacher_requires_approval` / `parent_requires_approval` | matches §7.4's two switches |
| `ActorKind` includes `TEACHER` | `vocab.ts` — JC-003 addressed |
| API bootstrap + outbox worker | `main.ts`, `app.module.ts`, `worker.ts`, `outbox.worker.ts` — **RC-01 and RC-02 being closed** |
| BR-1 structural backstop | `20260905093300_chat_br1_structural_backstop.sql` — type immutability on `conversation` **and** `call`, deferred constraint triggers spanning both tables, admin presence required on **every** group type, and the admin must be `actor_kind='staff'`. **This closes RT-024 and RT-025 at the database layer and implements the DB half of C-4.** |

**The remaining work below is correction and removal, not construction.**

---

## 1. Existing `Thread` model — **REMOVE (the largest single item)**

`chat.thread` still exists **alongside** `chat.conversation`, and
`chat.conversation.thread_id` references it, commented *"The family's continuous
record… the relationship belongs to the family."*

That is the superseded brief's one-thread-per-family invariant surviving inside
the PRD-conformant model. **PRD §6 has no `thread` entity.** Family already
carries the continuity (ownership BR-4, coverage §5.2, inbox grouping §7.5), and
§5.2's *"the same 'Jawwid' conversation with a different named person"* places
continuity on the `direct` **conversation**, not on a separate thread row.

Dependencies to unwind (all verified):
- `chat.conversation.thread_id` FK
- `chat.message.thread_id` (messages must hang off `conversation_id`)
- `chat.support_case.thread_id`, `chat.handoff.thread_id`
- `chat.coverage_engine`: `effective_handler()` and `extend_stickiness()` read/update `chat.thread` (`20260905090600:190,214`)
- `chat.core_integration`: `insert into chat.thread (family_id)` on family creation (`20260905090900:204`)
- **RLS**: `thread_visible_to_staff`, `thread_edited_by_admins`, and **five** further policies in `20260905091200_chat_rls.sql` that resolve family scope *through* `chat.thread` (lines 126, 128, 144, 160, 182, 280, 325)

**Impact: high.** The RLS layer currently derives family scope from `thread`. Each
policy must re-derive it from `conversation.family_id`. This is the item most
likely to introduce a silent authorization regression, and it must be re-attacked
by AI #9 after the change, not merely re-tested.

## 2. Conversation model — **KEEP, extend**

Add per PRD §6 / §5.4: `assigned_handler_id` (distinct from family owner, BR-4)
and `attention_state` on the conversation. Add `organization_id` (§2.3, *"on
every root entity from day one"*). `sticky_handler_id` already exists and is
compatible with, but is not the same thing as, `assigned_handler_id`.

## 3. `direct` conversations — **KEEP, no structural change**

`direct_key unique` already guarantees C-2's per-pair identity and makes
get-or-create idempotent. Parent↔Jawwid: exactly one persistent conversation per
family whose **handler** rotates (§5.2). Teacher↔Admin: one row per pair.

## 4. Student Groups — **KEEP**

`learner_id` NOT NULL for `student_group` + the partial unique index on
`(learner_id) where type='student_group' and archived_at is null` already
delivers §7.3's *"one official Student Group per student"* **and** permits a
multi-child family to hold several. Archive-not-delete is present.

## 5. `class_group` — **KEEP type, no feature**

§7.3: Phase 2, *"the model supports them from the start via `conversation.type`"*.
The type exists; nothing more is built in MVP. `family_id` **must remain
nullable** for it — a class group spans *"several families"*.

## 6. `official` — **KEEP as a distinct type (C-1)**

No change to the enum. Required behaviour, currently unimplemented: a customer
reply to an `official` message **routes into that family's persistent `direct`
conversation** (BR-7). That is a routing rule in the message-send path, not a
schema change. **Not yet built — no code was found that implements the redirect.**

## 7. Family association — **RETAIN NULLABLE (schema implication of C-2)**

C-2 asks for the exact implication if the schema cannot represent Teacher↔Admin
cleanly. It **can**, but only because `conversation.family_id` is nullable
(*"Null for staff-only conversations"*).

**The implication, stated precisely:** a Teacher↔Admin `direct` conversation is
**not family-scoped** — a teacher teaches students across many families, so no
single `family_id` is correct. PRD §6 lists `family` as a Conversation attribute
without marking it optional, so nullability is an **[B] interpretation**, forced
by C-2 plus §7.3. Consequences: every family-scoped query, RLS policy and inbox
view must tolerate `family_id IS NULL`, and the Admin Inbox's family grouping
(§7.5) will not contain teacher conversations. Flagged rather than assumed.

## 8. Members — **KEEP**

`chat.conversation_member` with `actor_kind` + `member_role` is the PRD §12.5
membership-row model. Membership derives from Core (§7.3); manual add/remove is
manager-only. **Blocked on PD-1** for coverage-admin membership semantics.

## 9. Handlers — **ADD**

`assigned_handler_id` on conversation (§6). Distinct from `family.owner_id`
(BR-4) and from `sticky_handler_id`. Coverage changes handler, never ownership.

## 10. Ownership — **NO CHANGE**

Stays on Family. `transfer_ownership()`, owner guards and blocked deactivation
(§5.1) are PRD-conformant and are **preserved as they are**.

## 11. Attention — **CHANGE OF SUBJECT (family → conversation)**

> §5.4: *"**Conversations** carry an attention state"* · §6 lists it on Conversation
> §5.3: workload counts `active_conversations`, `new_conversations`

`chat.attention_score(p_family_id)`, `chat.attention_bucket()` and
`chat.family_state_cache` are all keyed on **family**. The scoring logic is sound
and config-driven; **its subject is wrong.** Re-key to conversation, with the
family-level rollup retained for the inbox's family grouping (§7.5).

**Note the PRD states both:** attention is *on the conversation* (§5.4/§6) while
the Admin Inbox is *"organised by family and by attention"* (§7.5). Both are
needed; conversation is the primitive, family is the rollup.

## 12. Tasks — **CHANGE (forced by C-3)**

§7.6: *"Tasks belong to a **family** (optionally a **student** and a
**conversation**)"*. Current: `chat.task.case_id uuid **not null** references
chat.support_case on delete cascade` (`20260905090400:233`).

**This is a hard blocker on removing Case.** A task today cannot exist without a
case. Required: drop `case_id`; make `family_id` the required scope; add nullable
`learner_id` and `conversation_id`. Also `task_case_idx` and the cascade
behaviour change — today deleting a case deletes its tasks; after the change
tasks follow the family.

## 13. Removal of Case (C-3) — **REMOVE `chat.support_case` entirely**

The PRD §6 domain model contains no Case entity. Full dependency list:

| Dependent | Line | Action |
|---|---|---|
| `chat.task.case_id` **NOT NULL** | `090400:233` | drop column; re-scope to family (§12) |
| `chat.message.case_id` | `090400:127` + `message_case_idx:159` | drop column + index |
| `chat.event_log.case_id` + `event_log_case_idx` | `090500:14,50` | drop column + index |
| `chat.log_event(p_case_id …)` | `090500:92,99` | drop parameter — **signature change, all callers** |
| `chat.support_case` table, 4 indexes, `set_updated_at` trigger, `assert_case_thread_matches_family()` trigger | `090400:47-117` | drop |
| `guard_owner_locked_case_closure()`, `apply_owner_lock()` | `090700` | **owner-locking is defined in terms of case types** — must be re-expressed against conversation/attention or dropped |
| RLS grants naming `chat.support_case` | `091200:86` | remove |
| Prisma `Message.caseId` | `schema.prisma` | remove |
| Admin Web `Case`, `caseApi`, `CaseCards.tsx`, `case.updated` event | `domain.ts`, `endpoints.ts`, `features/family/` | **AI #4 rework — a visible feature disappears** |

**Impact: high, and it reaches the Admin UI.** `owner_locked` deserves explicit
product attention: it is a real operating-model behaviour (§5.1 ownership
permanence) currently implemented *through* case types. Removing Case without
re-expressing it silently drops the behaviour.

## 14. Teacher↔Admin direct (C-2) — **NO SCHEMA CHANGE**

Representable today via `direct_key` + nullable `family_id` (§7). Only §7's
nullable-family implication needs recording. Authorization stays membership-based
and server-side.

## 15. Calling — **DB HALF DONE (C-4)**

`20260905093300` already delivers: `call.type` immutability, deferred constraint
triggers on `chat.call` and its participants, admin presence on every group type,
and the `actor_kind='staff'` tie so a teacher cannot self-satisfy the rule.

**Outstanding for C-4:** the decision requires evaluation **at operation time** on
**both** paths. The database backstop constrains *committed membership state*; it
is not the same as evaluating presence at the moment a message is posted or a
call token is minted. Required:
- `canCommunicate(actor, target, channel, context)` (§12.5) checks live admin presence when **posting** into a group and when **minting a call token / accepting**;
- LiveKit tokens minted only after that check (§12.5);
- **tests on both the message path and the call path** (C-4 is explicit).
- **Blocked on PD-2** for parent-initiated group calls.

---

## 16. Sequencing

1. Record decisions *(done — this note and `od-01-conversation-model.md`)*
2. **Resolve the §17 ambiguity** — it decides whether Case removal is clean
3. Resolve PD-1 and PD-2
4. Remove Case (§13) — largest blast radius, reaches AI #4's UI
5. Remove `thread` (§1) — **re-derive every RLS policy**, then AI #9 re-attacks
6. Re-key attention/workload (§11)
7. Add `assigned_handler_id`, `attention_state`, `organization_id` (§2)
8. Complete C-4 operation-time enforcement + both test paths (§15)
9. Implement BR-7 official→direct reply routing (§6)

**Do not start at step 4.** Steps 2 and 3 change the shape of what is built.

---

## 17. STOP CONDITION — ambiguity C-3 anticipated

C-3: *"If a specific system-created conversation cannot be mapped unambiguously
to one of the four PRD types, STOP and report the exact ambiguity rather than
inventing semantics."* It cannot be mapped. Reporting, not inventing.

**The PRD text:**

> §7.5: *"**Conversations created automatically by the system (onboarding,
> renewal, payment, schedule change, follow-up)** land in the owner's inbox
> **with their type shown**."*
> §12.4: *"Change events … drive both **automatic conversations** and the reminder engine."*

**Why it does not resolve:**

1. The five names — onboarding, renewal, payment, schedule change, follow-up — are **not** values of `conversation.type`, and C-1 forbids a fifth type.
2. They were previously carried by `chat.support_case.type` (`'technical','billing','schedule','renewal','cancellation','complaint','onboarding','at_risk','academic','general'`). **C-3 removes that table**, and forbids inventing a replacement.
3. They cannot become new `direct` conversations: §5.2 + C-2 fix **one** persistent parent-facing `direct` conversation per family.
4. So *"with their type shown"* has no referent in the post-C-3 model.

**Observation, offered as evidence and not as a decision:** §7.6 defines Task
types as *"follow-up, renewal, payment, complaint, onboarding, custom"* — nearly
the same list as §7.5's. That is consistent with system events creating a **Task**
plus a message into the existing `direct` conversation, rather than creating a
conversation. **The PRD does not say this**, §7.5 says *"conversations"*
explicitly, and §12.4 repeats *"automatic conversations"*. I am not adopting it.

**The smallest decision needed** — one sentence:

> *"System events create a Task (§7.6 type) plus a message in the family's
> existing `direct` conversation; §7.5's 'type shown' is the Task type."*

**or**

> *"System events create `official` conversations, one per event class, and
> 'type shown' is a display label carried on the conversation."*

Until answered, **§13 (Case removal) cannot be completed correctly**, because the
first option needs no replacement for `support_case.type` and the second needs a
label column. Everything else in this note is unaffected and may proceed once
PD-1/PD-2 are answered.
