> **STATUS: REFERENCE** (Phase 0, 2026-09-07). Product decisions C-1..C-4 are adopted; PD-1/PD-2 remain open in `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4.
> Canonical index: `docs/README.md`.

# OD-01 — Conversation Model · RESOLVED FROM THE PRD

Date: 2026-09-06 · Owner: AI #10 · Status: **RESOLVED (A) with 4 residual product decisions (C)**
Authority: `docs/product/jawwid-chat-prd-v0.1.md` · sha256 `3e63ec…a1b697` · commit `62ff312`

Method: read §3, §4, §5, §6, §7, §9, §12, §13 of the PRD. Nothing below is taken
from `JAWWID_CHAT_BRIEF.pdf`, from `authoritative-scope.md`, from any Second
School document, from the current implementation, or from memory.

Every claim is graded:

- **[A] EXPLICITLY DEFINED BY PRD** — the PRD states it. Cited verbatim.
- **[B] REASONABLE IMPLEMENTATION INTERPRETATION** — follows from [A] but the PRD does not state it. **Not binding.**
- **[C] NOT DEFINED — PRODUCT DECISION REQUIRED.**

**[B] is never promoted to [A] in this document.**

---

## 1. The canonical conversation model — [A]

> §6: *"Conversation | id, **type (`direct`, `student_group`, `class_group`, `official`)**, family, student, members, attention state, assigned handler, last activity | Chat"*

That single row is the answer to OD-01. The PRD defines a **typed, multi-party
conversation entity with an explicit member set**, scoped to a family and
optionally to a student.

Supporting statements:

> §6: *"The model centres on the **Family**, not the phone number or the chat. **Every conversation, task, call and reminder is attached to a family**, and where relevant to a student…"*

> §7.5: *"the full timeline **across all of the family's conversations**"*

> §12.5: *"Database constraint: **a `direct` conversation may not have both a `teacher` member and a `parent` member** (enforced by trigger/check on membership rows), so even a bug in application code cannot create the forbidden relationship."*

> §12.5: *"Single `AuthorizationService.canCommunicate()` called by **every conversation, membership, message, call token and search code path**"*

---

## 2. Conversation types explicitly required — [A]

| Type | MVP? | PRD evidence |
|---|---|---|
| `direct` | **Yes** | §6 enum · §4.1 matrix (Parent↔Admin, Teacher↔Admin) · §12.5 names it in the BR-1 constraint |
| `student_group` | **Yes** | §6 enum · §7.3 · §13 item 2 "**Full**" |
| `class_group` | **Type required in MVP; feature Phase 2** | §7.3: *"Class Groups … are Phase 2; **the model supports them from the start via `conversation.type`**"* · §13 item 2 Phase 2 |
| `official` | **Yes** | §6 enum · BR-7 |

**Exactly four. No other type appears anywhere in the PRD.**

**There is no `family` conversation type.** [A] — Family is an entity in the §6
domain model, listed separately from Conversation, and the type enum does not
contain it.

---

## 3. Is Family a conversation, a routing scope, or both? — [A]

**A routing and context scope. Never a conversation.**

> §6: *"The model centres on the Family, not the phone number or **the chat**."*
> §6: *"**Every conversation** … **is attached to a family**"*
> §5.1: *"Normal shift: parent message ──▶ owner's inbox / Off shift: parent message ──▶ coverage admin's inbox (owner unchanged)"*
> §4.1: Parent→Admin — *"The parent's 'Jawwid' conversation. **Routed by ownership and coverage.**"*

Family carries ownership (BR-4), coverage routing (§5.2) and inbox grouping
(§7.5). It is the scope a conversation *belongs to*, not a thread.

---

## 4. One conversation per family, or multiple? — [A]

**Multiple. Unambiguously.**

> §7.5: *"the full timeline **across all of the family's conversations**"*
> §7.3: *"**One official Student Group per student**"*
> §3 (parent scope): *"own 1:1 **chats** with Jawwid, own Student **Groups**"*

A family with three enrolled children has, at minimum: **one `direct`
conversation + three `student_group` conversations**, plus `official`. A model
that permits one conversation per family cannot represent the PRD's own
worked example.

---

## 5. Student Groups and conversations — [A]

> §7.3: *"**One official Student Group per student**, created automatically from Jawwid Core relationships: **the parent, every assigned teacher, and the family's primary owner**. Coverage admins join automatically during their coverage window (or are permanent silent members, configurable)."*
> §7.3: *"Membership follows the data: a teacher change in Jawwid Core adds the new teacher and removes the old one, **with a system message**. A group is **archived, never deleted**, when a student leaves."*
> §7.3: *"Group names follow a template such as **"Ahmed · Jawwid"** … **No member can add or remove members manually except managers.**"*

A Student Group **is** a conversation of `type = student_group`, keyed to a
**student** (not a family), with derived membership.

**Cardinality is per student, not per family.** [A] This is the single most
consequential detail for the database model.

---

## 6. Official conversations and Student Groups — [A] + [C]

**[A]** They are separate types serving different purposes.

> BR-7: *"Automated reminders and system messages are sent under the official **Jawwid** identity. 1:1 conversations show the name of the person handling the family alongside the Jawwid identity. **Parents can reply to official messages; the reply lands in their normal conversation with Jawwid.**"*
> §4.1: System (Jawwid) → Parent — *"**Official** … Reminders and notifications under the Jawwid identity."*

`official` is **outbound, system-identity**; a parent's reply **does not stay in
it** — it lands in the `direct` conversation.

**[C-1 · unresolved]** The PRD does not state whether `official` is a **distinct
conversation row** the parent sees as its own thread, or a **message origin
rendered inside the `direct` conversation**. §6 lists it as a conversation
`type`, which implies a row; BR-7's reply-redirect implies the parent experiences
one Jawwid thread. Both readings are consistent with the text. See §14.

---

## 7. Admin ↔ customer conversations — [A]

> §4.1: Parent → Admin (owner or coverage): chat **1:1**, call **1:1** — *"The parent's 'Jawwid' conversation. Routed by ownership and coverage."*
> §5.2: *"A conversation handled under coverage is labelled as such in the thread and the family timeline, so the owner sees exactly what happened while she was away, and **the parent sees the same "Jawwid" conversation with a different named person**."*
> BR-7: *"1:1 conversations show the name of the person handling the family alongside the Jawwid identity."*

**There is exactly one persistent parent-facing `direct` conversation per family,
whose handler changes.** [A] — §5.2's *"the same 'Jawwid' conversation with a
different named person"* is decisive: coverage changes the **handler**, not the
conversation. The parent's counterparty is **Jawwid**, not an individual admin.

Teacher↔Admin `direct` is a separate conversation (§4.1: *"Teacher may contact
assigned admins"*).

**[C-2]** Whether Teacher↔Admin is one conversation per *(teacher, admin)* pair
or one per teacher with Jawwid is **not stated**. The plural *"assigned admins"*
suggests per-pair; the parent-side model suggests per-identity. See §14.

---

## 8. Ownership and Current Handler vs conversations — [A]

> BR-4: *"Every family has exactly one primary owner (an admin) at any time. Ownership is permanent until the manager reassigns it. **Coverage and workload routing let other admins handle a family's conversations without changing ownership.**"*
> §6: Conversation carries *"**assigned handler**"*.
> §5.1: *"Ownership … changed only by a manager, with a reason, recorded in the audit log."*

**Ownership lives on the Family. Handler lives on the Conversation.** [A] These
are two different fields on two different entities, and the PRD keeps them apart
deliberately.

---

## 9. Coverage and workload vs conversations — [A]

> §5.2: *"Coverage admins act with the owner's permissions on that family **for the duration of the window**, and nothing more."*
> §5.3: *"workload_score = Σ weight[i] × count[i] over: **active_conversations, waiting_for_admin, follow_ups_due, sla_at_risk, new_conversations,** open_tasks, renewal_cases, escalations"*
> §5.4: *"**Conversations carry an attention state**"*

**Workload counts conversations. Attention is a property of the conversation.**
[A] Coverage grants family-scoped permission for a time window; it does not move
ownership and does not create a separate conversation.

---

## 10. Teacher ↔ Parent communication — [A]

> BR-1: *"Teachers and parents communicate **only inside the official Student Group**, where the assigned admin/supervisor is a member. A teacher cannot start, send, or receive a private conversation or call with a parent; a parent cannot start one with a teacher. **Creating such a conversation, group, or call is rejected server-side regardless of client.**"*
> §4.1: Parent→Teacher and Teacher→Parent — *"**Group only** … admin present. **1:1 forbidden**"*
> §9: 1:1 call, Teacher↔Parent — *"**Rejected server-side** (BR-1)"*; Group call — *"**The official Teacher ↔ Parent call channel**"*
> §12.5: *"a `direct` conversation may not have both a `teacher` member and a `parent` member (enforced by trigger/check on membership rows)"*
> §13 item 3: *"Permissions: communication matrix, RBAC, **BR-1/BR-2 enforced server-side and in DB** — **Full** (MVP)"*
> §16 decision log, 2026-09-05: *"BR-1: no direct Teacher ↔ Parent chat or call; Student Group with admin present is the only channel. **Enforced server-side and in the database.**"*

The PRD requires **both** an application check **and** a database constraint —
not one or the other. Also [A]: teacher↔teacher is *"By permission … Off by
default"* (§4.1, BR-3).

---

## 11. Do operational/admin events get a conversation? — [A]

> §7.5: *"**Conversations created automatically by the system** (onboarding, renewal, payment, schedule change, follow-up) **land in the owner's inbox with their type shown**."*
> §12.4: *"Change events (class rescheduled, payment overdue, teacher changed…) are emitted to the event bus and **drive both automatic conversations and the reminder engine**."*

**Yes — operational events create conversations.** [A]

**[C-3]** Which `type` those automatic conversations carry is **not stated**. The
enum has four values and none is named "case", "issue" or "ticket"; §7.5 says
*"with their type shown"*, which may refer to a conversation `type`, or to a
case/topic classification the PRD does not model. Note the §6 domain model has
**no `case` entity** — the superseded brief's `case` concept does not appear in
the PRD at all. See §14.

Internal notes are **not** conversations: §7.5 lists *"add an internal note
(visible to staff only, never to the parent)"* as a **handler action within a
thread**. [A]

---

## 12. Exact contradictions with the current implementation

Each row is PRD-vs-code. The PRD wins in every one.

| # | Current implementation | PRD requirement | Severity |
|---|---|---|---|
| **X-1** | `chat.thread.family_id uuid not null **unique**` (SQL, `20260905090400`); comment cites *"cases never create a second thread"* | Multiple conversations per family (§7.5); one Student Group **per student** (§7.3) | **BLOCKER** |
| **X-2** | `Thread @@unique([familyId, kind])` (Prisma) — at most one `STUDENT_GROUP` per **family** | One Student Group **per student** (§7.3). A two-child family needs two | **BLOCKER** |
| **X-3** | `ThreadKind = FAMILY \| STUDENT_GROUP \| CLASS_GROUP \| OFFICIAL` (Prisma) | `direct \| student_group \| class_group \| official` (§6). **`FAMILY` is not a PRD type; `direct` is missing** | **BLOCKER** |
| **X-4** | `StudentGroup`, `MessageApproval`, `Call`, `CallParticipant` tagged `/// DESIGN-ONLY. Not implemented.` | §13: Student Groups **Full**, approvals **Simple policy**, 1:1 calling **Full**, group calling **Full** — all MVP | **BLOCKER** (JC-001) |
| **X-5** | `ActorKind = 'STAFF' \| 'CONTACT' \| 'SYSTEM'`; `FAMILY_FACING_ROLES` excludes `ACADEMIC` | §3: `teacher` is a first-class role on Mobile with Student Groups + 1:1 with admins | **BLOCKER** (JC-003) |
| **X-6** | Attention computed **per family** (`chat.family_state_cache`, `chat.attention_score(p_family_id)`) | §5.4: *"**Conversations** carry an attention state"*; §6 lists it on Conversation | **HIGH** — engine is sound, its subject is wrong |
| **X-7** | Workload units counted per **family** | §5.3 counts `active_conversations`, `new_conversations` | **HIGH** |
| **X-8** | `domain.ts`: *"There is no `super_admin` role"* | §3 lists **`super_admin`** as a role | **MEDIUM** |
| **X-9** | SQL role value `'coverage'` | §3 role name `coverage_admin` | **LOW** (naming) |
| **X-10** | No `organization_id` on any entity in either stack | §2.3: *"the data model carries an **`organization_id` on every root entity from day one**"* | **HIGH** — retrofitting later is the "rewrite" §2.3 exists to prevent |
| **X-11** | Partial Core keys (`core_parent_id`, `core_child_id`); no `synced_at` | §12.4: *"Each carries an **`external_id` and `synced_at`**"* | **MEDIUM** |
| **X-12** | AI #6 terminology: *"a conversation is never opened, closed or resolved"* | §7.5: *"Conversation state: open / waiting on customer / waiting on Jawwid / **resolved**, with SLA timers per state"* | **MEDIUM** |
| **X-13** | `chat.support_case` + `message.case_id` (SQL); `Message.caseId` (Prisma) | The §6 domain model contains **no case entity**. Cases are a superseded-brief concept | **MEDIUM** — see [C-3] |
| **X-14** | BR-1 trigger checks `type = 'direct'` only and is bypassable by `UPDATE … SET type='direct'` (**RT-024/RT-025, confirmed at runtime**) | §12.5 requires the constraint to hold *"even [if] a bug in application code"*; §4.1 forbids the pairing in **all** group types | **BLOCKER** |

### What the PRD *confirms* in the current implementation

Not everything diverges, and this should not be lost:

- **§12.5's `AuthorizationService.canCommunicate()` is exactly AI #1's centralized `AuthorizationService`** — the PRD names the pattern and the single-code-path rule. Keep it.
- **§12.5's database constraint on `direct` membership is exactly what AI #1 implemented** — the *approach* is PRD-mandated; only its completeness fails (X-14).
- **BR-2 phone privacy** matches `Actor` carrying no phone/email/address — and the PRD goes further: *"never included in an API response to a non-admin"* (§3).
- **§5.1/§5.2/§5.3 operating model** matches the SQL coverage and ownership engines closely; `on_duty()`, `transfer_ownership()` and blocked deactivation (§5.1) are all PRD-conformant. **Their subject must change from family to conversation for attention/workload only.**
- **§7.2 reliability** — *"Idempotent send (client message id) · Ordered delivery per conversation · Offline compose queue"* — matches AI #2's implemented sequencing and idempotency exactly.

---

## 13. Recommended canonical model

Stated as a **recommendation to the product owner**, not a decision.

```
Family (routing + context scope; owns ownership, coverage, inbox grouping)
  └── Conversation  type ∈ {direct, student_group, class_group, official}
        ├── family_id      (required for direct/student_group/official; see [B-1])
        ├── student_id     (required for student_group; null otherwise)
        ├── assigned_handler_id     (§6 — distinct from family owner)
        ├── attention_state         (§5.4 — on the conversation)
        ├── state ∈ {open, waiting_on_customer, waiting_on_jawwid, resolved}  (§7.5)
        └── ConversationMember (actor, role, joined_at, left_at, is_silent)
              └── BR-1 constraint over the member set, at INSERT, UPDATE and
                  TYPE MUTATION (§12.5 + RT-024)
```

Cardinality per family: **1 `direct` (parent↔Jawwid) + N `student_group` (one per
enrolled student) + `official` + M `direct` (teacher↔admin, family-linked)**.

**[B-1]** `class_group` spans *"several families"* (§7.3), so `family_id` must be
nullable for that type. The PRD does not say this; it follows from the
definition. Not binding.

**[B-2]** `official` and `direct` both being parent-facing suggests the chat list
should present them as one Jawwid thread. **Blocked on [C-1].** Not binding.

---

## 14. Product decisions — RECORDED 2026-09-06 [A, by product-owner decision]

C-1…C-4 were decided by the product owner on 2026-09-06. They are now
**authoritative alongside the PRD** and are recorded here verbatim in substance.

| # | Decision |
|---|---|
| **C-1** | `official` **remains a DISTINCT Conversation type.** It is not modelled as a message origin. Canonical types remain exactly `direct`, `student_group`, `class_group`, `official` — **no fifth type**. BR-7 stands: official Jawwid-originated communication uses `official` semantics; **customer replies route into the persistent `direct` Jawwid conversation.** |
| **C-2** | Teacher↔Admin uses **one persistent `direct` conversation per (Teacher, Admin) pair.** Not one global Jawwid thread per teacher. Teacher A↔Admin B and Teacher A↔Admin C are two conversations. Authorization stays membership-based and server-side. |
| **C-3** | **There is NO `Case` entity in the Jawwid Chat MVP.** The Case concept is removed from the canonical domain model — not preserved because the superseded brief or an existing implementation has one. Its role is served by the PRD's Conversation + Task/Follow-up + Attention + Conversation State model. **No replacement "case type" is to be invented, and no `system` conversation type is to be created.** |
| **C-4** | **Admin presence is required at operation time, on both paths:** posting a Student Group message, and initiating/accepting a Student Group call. A group pairing a teacher with a parent without an authorized admin present must not permit the prohibited interaction. Enforced server-side **and**, where the PRD requires it, at the database layer. Both paths must be tested. UI membership restriction is not enforcement. |

### Still PRODUCT DECISION REQUIRED — do not guess

Both are the PRD's own §15.2 open questions and remain explicitly unresolved:

| # | Question | PRD source |
|---|---|---|
| **PD-1** | Are Coverage Admins **permanent silent members** of every Student Group, or do they **join only during coverage windows**? | §15.2 #4 · §7.3 states both as configurable alternatives |
| **PD-2** | May **parents initiate** Student Group calls, or only join? | §15.2 #5 · §9 says *"parent by policy"* |

Neither may be assumed by any agent. They shape conversation membership and call
authorization respectively.

---

## 14b. Residual ambiguity surfaced by C-3 — **STOP CONDITION MET**

C-3 instructs: *"If a specific system-created conversation cannot be mapped
unambiguously to one of the four PRD types, STOP and report the exact ambiguity
rather than inventing semantics."* **One such case exists.** See
`od-01-migration-impact.md` §11 for the full statement. Summary:

> §7.5: *"**Conversations created automatically by the system (onboarding,
> renewal, payment, schedule change, follow-up)** land in the owner's inbox
> **with their type shown**."*

With Case removed (C-3) and the type enum closed at four (C-1), the words
*onboarding · renewal · payment · schedule change · follow-up* have **no
representable `type`**. They are also not `direct`-vs-`official` distinctions.
Independently, §5.2 and C-2 fix **one** persistent parent-facing `direct`
conversation per family, so a system event cannot open a second one.

This is reported, not resolved. No semantics invented.

---

## 15. Superseded — original open questions [C], retained for the record

The PRD resolves OD-01's structure completely. Four questions remain, and **three
of them are the PRD's own open questions**, not gaps I am inventing.

| # | Question | Source | Smallest decision needed |
|---|---|---|---|
| **C-1** | Is `official` a **separate conversation row**, or a **message origin inside `direct`**? | §6 enum vs BR-7 reply-redirect | One sentence: *"official is a distinct conversation"* **or** *"official is an origin on messages in the direct conversation"* |
| **C-2** | Teacher↔Admin `direct`: one per *(teacher, admin)* pair, or one per teacher with Jawwid? | §4.1 *"assigned admins"* (plural) vs the parent-side single-Jawwid-thread model | *"per pair"* or *"one Jawwid thread per teacher"* |
| **C-3** | What `type` do system-created conversations (onboarding, renewal, payment, schedule change, follow-up) carry, and **do cases exist at all?** The §6 domain model has no case entity, yet both stacks have implemented one | §7.5 *"with their type shown"* · §6 entity list | *"system conversations are `direct`/`official` and there is no case entity"* **or** *"cases exist as a topic layer on a conversation"* |
| **C-4** | Is *"admin present"* enforced **at post time and call time**, and what happens when a manager removes the last admin from a group? | BR-1 *"where the assigned admin/supervisor is a member"* · §7.3 *"No member can add or remove members manually except managers"* · **RT-025 proves it is currently unenforced** | *"a group with no active admin member rejects sends and call tokens"* — or the alternative |

**PRD §15.2 additionally leaves open, by its own statement:** #4 whether coverage
admins are permanent silent members of every Student Group or join only during
coverage windows (this changes the membership model directly), and #5 whether
parents may start group calls. Both are M0 questions the PRD explicitly defers.

---

## 15. Impact assessment

### AI #2 — Communication Engine
`Thread` becomes `Conversation` with a four-value type and an explicit member
table. `ThreadKind.FAMILY` is deleted; `direct` is added. `@@unique([familyId,
kind])` is removed. §C `DESIGN-ONLY` models are promoted to implemented.
`AuthorizationService` gains conversation and channel in its signature —
`canCommunicate(actor, target, channel, context)` per §12.5 — resolving RT-002.
**Preserved unchanged:** sequencing under row lock, client-message-id idempotency,
monotonic receipts, transactional outbox, explicit DTO mappers. §7.2 mandates
those behaviours.

### Admin Web (AI #4)
`domain.ts` gains `super_admin` (X-8) and `coverage_admin` (X-9). The family
panel already shows *"the full timeline across all of the family's
conversations"* (§7.5) — that becomes correct rather than aspirational. The
inbox must show **per-conversation** attention, not per-family (X-6). Endpoints
keyed `/families/{id}/messages` need a conversation dimension.

### Realtime / event routing
Rooms key on `conversation_id`, not `thread_id`-per-family. Membership changes
emit system messages (§7.3). Approval transitions need events (§7.4). A pending
message is **visible only to its sender and to approvers** (§7.4) — realtime
fan-out must respect moderation status, which today it does not.

### Database model
`chat.thread` → `chat.conversation` + `chat.conversation_member`; drop
`family_id UNIQUE`; add `student_id`, `assigned_handler_id`, `attention_state`,
`state`; add `organization_id` to every root entity (X-10); add `external_id` +
`synced_at` (X-11); move attention/workload subject from family to conversation
(X-6, X-7); extend the BR-1 trigger to cover UPDATE and type mutation and all
group types (X-14). Resolve whether `chat.support_case` survives ([C-3]).

### Migration implications
- **Not a data migration — a greenfield schema correction.** There is no
  production data; `chat.thread` and `chat.message` are not created by any
  migration currently on the integration branch (RT-023).
- The corrected conversation model **must land before** RC-01 (API bootstrap),
  or the API boots against a schema the PRD contradicts.
- `organization_id` must be added **now**, not later: §2.3 requires it *"from day
  one"* precisely so a future SaaS conversion is *"a migration, not a rewrite."*
- **Do not implement yet.** [C-1]…[C-4] change the table shape. C-3 in
  particular determines whether an entire table (`chat.support_case`) exists.

---

## 16. Status

**OD-01 = RESOLVED. C-1, C-2, C-3, C-4 = RESOLVED** (product owner, 2026-09-06).
**PD-1 and PD-2 remain PRODUCT DECISION REQUIRED.** One residual ambiguity
(§14b) is surfaced under C-3's own stop condition.

**OD-01 = RESOLVED.** The canonical model is §6's typed, member-based
Conversation with four types, multiple per family, Student Groups keyed per
student. The superseded brief's *"one thread per family"* has **no basis in the
PRD** and is contradicted by §7.3, §7.5 and §3.

Four residual product decisions (C-1…C-4) block **implementation**, not the
model. Release status unchanged: **🔴 NOT READY — RECONCILIATION IN PROGRESS.**
