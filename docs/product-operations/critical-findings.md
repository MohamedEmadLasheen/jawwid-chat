# Critical Operating-Model Findings

**Owner:** AI #8 · **Date:** 2026-09-05 · **Mode:** conformance — **no redesign**

Seven findings, each stated as: Problem · Business impact · Expected behaviour · Required
invariant · Owner · Acceptance criteria · Blocking status.

**Scope discipline.** These state *what must be true*, not *how to build it*. Where a rule
is not established by `docs/qa/authoritative-scope.md` §3 or the brief's carried-forward
operating-model chapter, it is marked **UNVERIFIED — PRD SOURCE NOT PRESENT** and left as a
product decision. No workload weight, attention score, coverage policy, approval rule,
admin-presence rule or teacher-assignment rule is proposed here.

---

## CF-01 · The covering admin does not receive the family's messages

**Problem.** Message delivery resolved its recipient set from `family.owner_id`
(`identity.service.ts::familyThreadAudience()` returned contacts + owner). The on-duty
coverage admin received no receipt row, no realtime fan-out and no notification.
*Status: SUPERSEDED BY REFACTOR — the method was deleted mid-audit; `message.service.ts:134`
still calls it and the Node stack does not compile. The requirement is unchanged and must
hold against `chat.conversation_member`.*

**Business impact.** Every message arriving outside the owner's shift — the whole evening,
all night, all Friday — is delivered to someone who is off duty, while the person
responsible sees nothing. Compounding: covered families count fully on the coverage admin's
workload (brief §7), so the covering admin carries the load without receiving the work.

**Expected behaviour.** The people notified about a family's message are the people who can
and must act on it: the family's contacts, its Primary Owner (as context), and the **Current
Handler** at the moment the message arrives.

**Required invariant.**
> **INV-CF01** — For every customer-facing message, the delivery audience includes
> `current_handler(family, message.created_at)` whenever that is not NULL. Ownership alone
> never determines delivery.

**Owner.** AI #1 (identity/actor resolution) + AI #2 (delivery, receipts, realtime).

**Acceptance criteria.**
1. Owner off shift, coverage on duty, customer sends a message → the covering admin receives
   the realtime event, a receipt row and a notification; the owner receives it as context.
2. Unattended (`on_duty()` returns NULL) → no silent drop; the message surfaces on the
   Unattended path.
3. Audience is recomputed per message, never cached from `family.owner_id`.
4. A regression test asserts the covering admin is in the audience and the off-shift owner is
   not the sole recipient.

**Blocking status.** **RELEASE BLOCKER.** Not decision-blocked — the rule follows from the
operating model already carried forward in `authoritative-scope.md` §3.

---

## CF-02 · Stickiness captures the handler role and ignores presence

**Problem.** `message.service.ts:199-200` sets `stickyHandler`/`stickyUntil` on **every**
staff customer-facing message, including `ASSIST` and `ESCALATION`. `currentHandler()` tests
only `stickyUntil > now`; nothing reads `staff.presence`, although the brief conditions
stickiness on the replier being *"still online"*. `chat.conversation.sticky_handler_id` /
`sticky_until` carry no presence condition either. *Status: CONFIRMED at pass 1.*

**Business impact.** A manager who sends one reassuring reply, or an admin who assists once,
silently becomes the Current Handler — and keeps that role after logging off. The on-duty
admin's view stops showing the family as theirs while the manager does not consider
themselves responsible. This is the "two admins each assume the other is handling it"
failure, reachable in four steps (`simulations.md` SIM-4).

**Expected behaviour.** Stickiness is a continuity device for the person who is *carrying*
the family — the owner or the covering admin — and only while they are actually present.
A one-off intervention does not transfer responsibility.

**Required invariants.**
> **INV-CF02a** — Stickiness may be established only by a message whose derived
> `on_behalf_mode` is `OWNER` or `COVERAGE`. `ASSIST` and `ESCALATION` never set it.
> **INV-CF02b** — A sticky handler is Current Handler only while present. On loss of
> presence, the family returns to `on_duty()` without waiting for the grace window.

**Owner.** AI #2 (message write path) + AI #1 (`current_handler` resolution, presence).

**Acceptance criteria.**
1. An assist or escalation reply leaves `sticky_handler_id` unchanged.
2. A sticky handler going offline releases the family within one presence TTL.
3. `current_handler()` returns exactly one staff id or an explicit Unattended for 10 000
   random `(family, instant)` pairs, including across sticky expiry (release-gate G-14).
4. The audit trail shows who held the family at each instant and why.

**Blocking status.** **RELEASE BLOCKER.** Not decision-blocked.

---

## CF-03 · A family with two children cannot hold two Student Groups

**Problem.** `Thread @@unique([familyId, kind])` (Prisma) permits one `STUDENT_GROUP`
conversation per **family**, while a group is scoped to a **learner**.
*Status: **FIXED in the authoritative SQL stack** — `chat.conversation` is typed and
`conversation_one_group_per_learner` keys uniqueness on `(learner_id)` where
`type='student_group' and archived_at is null`. `apps/api/prisma/schema.prisma` still carries
the superseded constraint.*

**Business impact.** Multi-child families are the common case, not the edge case. Under the
old constraint two siblings would share one official channel or one would have none — a
privacy problem as much as an operational one, since a group is scoped to one student's
teacher.

**Expected behaviour.** One official group per live student; one family; one Primary Owner;
student-level context preserved without fragmenting the customer relationship.

**Required invariant.**
> **INV-CF03** — At most one live `student_group` conversation exists per learner, and a
> family may hold as many as it has learners. Group cardinality never constrains the family.

**Owner.** AI #1 (done in SQL) · AI #2 (remove the superseded Prisma constraint) · AI #10
(ensure the Prisma model is not merged as authoritative — see `database-divergence.md`).

**Acceptance criteria.**
1. A family with three learners holds three live group conversations, one family
   conversation, one owner.
2. Archiving a group frees the learner for a new one; the archived group stays readable
   under RBAC.
3. No Prisma constraint contradicts the SQL constraint in the merged tree.

**Blocking status.** **RELEASE BLOCKER until the Prisma/SQL contradiction is removed.**
The rule itself is settled.

---

## CF-04 · Workload has no producers, no decay rule and no explanation

**Problem.** Nine weights and two thresholds are seeded in `chat.config`; `TeamNowRow` is
typed; `Badge.tsx` renders a level. **No engine computes a score.** Six of the nine units
depend on `case`/`task` tables that do not exist. The returned shape carries a score and a
level and **no breakdown**. *Status: CONFIRMED at pass 1.*

**Business impact.** The manager's central question — *"who needs help, and what kind?"* —
has no answer. Worse, on the units that could be computed today, an admin holding many
dormant conversations outranks an admin holding few urgent ones, so the manager would offer
help to the wrong person (`simulations.md` SIM-2). A number a manager cannot explain is a
number they stop trusting, and then the dashboard is furniture.

**Expected behaviour.** Workload represents **current operational pressure**, is computed
server-side from `config`, is never an input to automatic assignment, and is always
presented with the components that produced it.

**Required invariants.**
> **INV-CF04a** — Workload is computed server-side from `chat.config`; no client
> re-implements it (release-gate G-22).
> **INV-CF04b** — Workload never causes a reassignment of any kind.
> **INV-CF04c** — Every workload level is returned with the unit-level breakdown that
> produced it.

**Open, and deliberately not decided here.** Whether and how a `waiting_customer` or stale
case is discounted is a **product decision** (OD-07). My baseline proposal
(`workload-audit.md` §3) is a labelled recommendation only. **No weight is changed by this
audit.**

**Owner.** AI #1 (engine) + AI #4 (presentation) · product owner (OD-07).

**Acceptance criteria.**
1. `workload(admin, now)` returns `{score, level, breakdown[]}`.
2. Changing a weight in `chat.config` changes the output with no deploy.
3. Once OD-07 is decided, a test asserts a high-count/low-urgency admin scores below a
   low-count/high-urgency one.
4. No code path uses workload to select a handler.

**Blocking status.** **NOT a release blocker by itself; blocked on OD-07 for correctness.**
Shipping a manager dashboard without a breakdown is a P1 product defect, not a P0.

---

## CF-05 · Conversation state can say the customer owes the next action when Jawwid does

**Problem.** `dto.ts::conversationState()` returns `WAITING_ON_CUSTOMER` whenever
`lastStaffMessageAt` is the more recent timestamp. An admin replying *"we'll check this and
get back to you"* files the family under the customer's court.
*Status: **FIXED in the authoritative SQL stack** — `chat.conversation.state` is an explicit
stored column defaulting to `open`. **CONFIRMED OPEN in the Node DTO.** Whether any writer
sets the column correctly is **UNVERIFIED** — no writer exists yet.*

**Business impact.** This is the mechanism by which customers are forgotten. A family filed
as waiting-on-customer generates no attention, no follow-up and no escalation; it simply
stops being visible, and the only person who notices is the parent.

**Expected behaviour.** State reflects **who owes the next action**, and is set by the human
who knows — not inferred from message order.

**Required invariants.**
> **INV-CF05a** — `waiting_on_customer` is reachable only by an explicit act (a staff member
> saying so, or a system rule that established the customer was asked something), never by
> inference from who spoke last.
> **INV-CF05b** — A staff reply that creates no follow-up leaves the conversation `open`,
> never `waiting_on_customer`.

**Owner.** AI #2 (state writer) + AI #4 (composer affordances: reply / reply+snooze /
reply+resolve).

**Acceptance criteria.**
1. A staff reply with no explicit state choice and no follow-up leaves the state `open`.
2. No code path derives `waiting_on_customer` from timestamp comparison.
3. A conversation cannot remain `waiting_on_jawwid` past a response target without producing
   an attention signal (once the attention engine exists).

**Blocking status.** **RELEASE BLOCKER for the Node layer.** Settled in SQL.

---

## CF-06 · Renewal has no producer and can become invisible end to end

**Problem.** `chat.subscription` exists with `renewal_due_at`, `last_payment_status` and an
index — and **no writer**. There is no lifecycle job to open a renewal case, no
`chat.support_case` table for it to open into, and no Core sync feeding the mirror.
*Status: CONFIRMED at pass 1.*

**Business impact.** The workflow with the most direct revenue consequence is invisible by
construction. A paying family lapses and the first person to notice is the parent
(`simulations.md` SIM-3). Additionally, the brief's `timers.auto_resolve_hours` (168) would
silently close a renewal case if the `owner_locked` exclusion — currently only a comment —
is not enforced in code.

**Expected behaviour.** A renewal becomes a tracked, owned, time-bounded obligation from the
moment it enters its window until it reaches a terminal state, and it is visible to whoever
is on duty even though the closing action stays owner-locked.

**Required invariants.**
> **INV-CF06a** — A renewal obligation is never resolved, re-dated or lost by a coverage
> transition, a handoff, or an automated sweep.
> **INV-CF06b** — Auto-resolve never applies to an owner-locked case type; enforced by the
> query, not by a comment.
> **INV-CF06c** — Every renewal-derived attention or workload signal reads a field with a
> live producer, or the signal is not enabled.

**Open, and deliberately not decided here.** Whether renewal state is visible to the Current
Handler as well as the owner, and what a parent sees in-app, are product decisions
(OD-13-adjacent; `renewal-operations.md` RN-3, RN-7). **UNVERIFIED — PRD SOURCE NOT PRESENT.**

**Owner.** AI #1 (Core integration boundary + subscription mirror + case table) ·
product owner (visibility rules).

**Acceptance criteria.**
1. `chat.subscription` has a named producer through the Core API/webhook boundary, with a
   visible `synced_at`.
2. A renewal case survives a full coverage cycle without being resolved, re-dated, or losing
   its owner.
3. An auto-resolve sweep provably skips every `owner_locked` type, with a test per type.
4. The manager's renewal view reconciles: due = renewed + no-reply + refused + lapsed.

**Blocking status.** **RELEASE BLOCKER.** Depends on the Core integration boundary, which is
now a locked architectural decision.

---

## CF-07 · There is no follow-up engine, so nothing can be overdue

**Problem.** No `case` and no `task` table exists in the authoritative stack.
`message.caseId` is an unconstrained nullable column. `attention.points.follow_up_due` and
`workload.weights.follow_up_due_today` are seeded and read by nothing.
*Status: CONFIRMED at pass 1.*

**Business impact.** This is the single largest MVP gap. Without cases and tasks there are
no follow-ups, no `owner_locked` enforcement, no response targets, no complaint severity, no
escalation state, no department-staff surface, and 8 of 14 attention signals and 6 of 9
workload units have nothing to read. Operationally: **nothing can come due, so nothing can be
late, so nothing alerts.** A commitment made to a parent has no representation in the system.

**Expected behaviour.** Every commitment Jawwid makes is a dated obligation attached to the
family and its case, visible to whoever is on duty when it comes due, accountable to the
Primary Owner, and never silently re-dated.

**Required invariants.**
> **INV-CF07a** — A follow-up is never silently re-dated; an overdue follow-up stays overdue
> with its original date.
> **INV-CF07b** — A follow-up survives every coverage transition and appears in the owner's
> return summary.
> **INV-CF07c** — Department staff (`finance`/`technical`/`academic`) see only their own
> tasks and can never message a family (release-gate G-26).

**Open, and deliberately not decided here.** Whether a follow-up is shown to the Current
Handler, the Primary Owner, or both, is a product decision (OD-09/OD-10). My baseline
proposal is a labelled recommendation only.

**Owner.** AI #1 (schema) + AI #4 (workflows) · product owner (OD-09, OD-10).

**Acceptance criteria.**
1. The disappearing-follow-up sequence in `task-followup-audit.md` §4 passes end to end.
2. An overdue follow-up appears in the handler's inbox, the owner's return summary, and the
   manager dashboard, with its original due date.
3. Per-case calibration logging exists from day one (brief §7): staff message count, time to
   first reply, handling time excluding waiting-on-customer, reopen count.

**Blocking status.** **RELEASE BLOCKER for MVP scope.** Partly decision-blocked (OD-09/OD-10),
but the schema is not blocked and should not wait.

---

## Blocking summary

| ID | Release blocker | Decision-blocked |
|---|---|---|
| CF-01 audience follows the handler | **yes** | no |
| CF-02 stickiness scope + presence | **yes** | no |
| CF-03 group cardinality (Prisma contradiction) | **yes** | no |
| CF-04 workload | no (P1) | yes — OD-07 |
| CF-05 conversation state (Node) | **yes** | no |
| CF-06 renewal producers | **yes** | partly |
| CF-07 follow-up engine | **yes** | partly — OD-09/OD-10 |
