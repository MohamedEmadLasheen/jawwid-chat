# Jawwid Chat — Open Product Decisions

**Owner:** AI #8 · **Date:** 2026-09-05

Every decision here is one that **product must make**, not one an agent may assume.
Where a decision is technical-ambiguity-only, AI #5 already owns it in
`docs/qa/test-plan.md` §21 and it is cross-referenced rather than duplicated.

**BLOCKING** = work is being built in a direction that may have to be thrown away.

---

## OD-01 · Which reconciliation of the brief-vs-PRD conflict governs the conversation model?
- **Status:** **BLOCKING**
- **Current assumption:** each agent has picked a different one.
- **Why unresolved:** two records exist of the same product-owner decision on 2026-09-05.
  (A) `docs/qa/authoritative-scope.md`: PRD supersedes the brief; the brief's communication
  chapter is void, so `thread.family_id UNIQUE` is void. (B) project memory: the brief
  governs the **staff side**, role assignments govern the family/teacher side — under which
  the single family thread survives and Student Groups sit beside it.
- **Options:** (1) A — one typed conversation model, the family thread becomes
  `type=parent_admin`; (2) B — family thread stays as specified, groups are additional
  conversation kinds; (3) restate from PRD v0.1 directly.
- **Recommendation [AI #8]:** (3), then (2)'s data shape. The brief's operating model is
  the product's differentiator and its conversation model is load-bearing for it; the PRD
  adds channels rather than replacing the family relationship.
- **Impact:** schema, authorization, inbox, mobile chat list, every BR-1 test.
- **Owner:** product owner → AI #1. **Deadline:** before any `thread` migration is written.

## OD-02 · One database or two?
- **Status:** **BLOCKING**
- **Current assumption:** both, simultaneously (`cross-agent-audit.md` X-01).
- **Options:** (1) `chat` schema inside Core's Supabase DB — cheap sync, tight coupling,
  contradicts "no direct dependency on Core's database"; (2) separate database + explicit
  sync — matches the stated architecture, needs a real sync service; (3) separate database,
  Supabase only for auth.
- **Recommendation [AI #8]:** (2) or (3). (1) makes Jawwid Chat a Core module, which the
  product context explicitly rejects, and it is the option that is hardest to reverse later.
- **Impact:** migrations, RLS-vs-service authorization, deployment, backup/restore, X-15.
- **Owner:** product owner + AI #1 + AI #7. **Deadline:** before the next migration.

## OD-03 · What does "required admin presence" in a Student Group mean?
- **Status:** **BLOCKING** (= AI #5 AMB-9, restated as a product question)
- **Options:** (a) an admin is a **member** of every group; (b) an admin is a member **and
  on duty**; (c) messages are visible to the on-duty admin without membership;
  (d) approval substitutes for presence.
- **Recommendation [AI #8]:** (a) + approval. Presence must be a *membership* fact, not a
  *liveness* fact — a rule that depends on someone being online cannot be enforced at 02:00,
  and BR-1's permitted case must be enforceable at all times.
- **Impact:** BR-1's entire permitted path; group creation; offboarding (does removing an
  admin invalidate a group?); AI #5 cannot write BR1-09/SG-12 until this is answered.
- **Owner:** product owner. **Deadline:** before Student Groups are implemented.

## OD-04 · Who is authoritative for the teacher↔learner assignment?
- **Status:** **BLOCKING**
- **Current assumption:** none. `chat.learner.teacher_id` is a bare uuid, and its own
  migration comment says *"Jawwid Core has no teacher entity today."*
- **Options:** (1) Core owns it and Chat mirrors; (2) Chat owns it; (3) Chat owns
  communication membership, Core owns the academic assignment.
- **Recommendation [AI #8]:** (1) if Core will have teachers before launch, otherwise (2)
  with an explicit migration path. Group membership must follow the assignment automatically
  — a teacher change that does not update the group is a privacy incident, not a data gap.
- **Impact:** Student Group membership sync, teacher app, Core integration contract.
- **Owner:** product owner + AI #1.

## OD-05 · Is `adminDirect` a second parent↔staff channel?
- **Status:** **BLOCKING** for mobile
- **Current assumption:** AI #3 renders `jawwidSupport` and `adminDirect` as separate kinds,
  both reachable by a parent (`lib/shared/models/conversation.dart`).
- **Recommendation [AI #8]:** a parent has exactly **one** channel to Jawwid — the family
  conversation. `adminDirect` is teacher-only. Two channels split the history the product's
  "one rule" exists to protect and double the ways a customer is missed.
- **Impact:** mobile chat list, attention (which conversation carries `needs_reply`?),
  ownership.
- **Owner:** product owner → AI #3.

## OD-06 · Do Super Admin and a CRITICAL workload level exist?
- **Status:** non-blocking
- **Current assumption:** no — `domain.ts` and `terminology.md` explicitly exclude both;
  this agent's role brief names both.
- **Recommendation [AI #8]:** keep them out. A workload level earns its existence only if
  the manager does something different at that level; HIGH already triggers every action in
  the brief. Add CRITICAL later if the data shows HIGH is too coarse.
- **Owner:** product owner.

## OD-07 · Do waiting-on-customer conversations carry workload?
- **Status:** non-blocking, **decide before the workload engine is written**
- **Current assumption:** the brief's units are counted with no age or state decay; a
  `needs_reply` family weighs 1.0 whether it arrived 2 minutes or 6 days ago.
- **Recommendation [AI #8]:** an active case whose status is `waiting_customer` and whose
  last customer contact is older than a configurable `workload.stale_days` (proposed default
  **7**, an initial hypothesis) contributes **0**, not `active_case = 1.0`. Otherwise the
  admin with the most *dormant* families outranks the admin with the most *urgent* ones —
  the exact inversion this audit was asked to find. See `workload-audit.md` §3.
- **Owner:** product owner + AI #1.

## OD-08 · Are shift boundaries half-open?
- **Status:** non-blocking, trivially cheap now (= AI #5 AMB-5)
- **Recommendation [AI #8]:** `[starts, ends)` everywhere, documented once. Any other
  choice risks a zero-handler minute, which breaches INV-A.
- **Owner:** AI #1.

## OD-09 · Which staff member owns a follow-up when the owner is off shift?
- **Status:** non-blocking, **decide before tasks are built**
- **Recommendation [AI #8]:** a follow-up belongs to the **family and its case**, is *shown*
  to the Current Handler when it comes due, and is *accountable to* the Primary Owner. A
  follow-up that follows the handler will be dropped at every shift change; one that only
  follows the owner will be invisible for 16 hours a day.
- **Owner:** product owner + AI #4.

## OD-10 · What happens to a follow-up that became overdue during coverage?
- **Status:** non-blocking
- **Recommendation [AI #8]:** it stays overdue and appears in *"What happened while you were
  away"* with the elapsed time. Never silently re-date; the overdue count is a real
  operational signal and re-dating destroys it.
- **Owner:** AI #4.

## OD-11 · Who approves a group message when the owner is off duty?
- **Status:** **BLOCKING** for approvals (= AI #5 AMB-11)
- **Recommendation [AI #8]:** any on-duty family-facing admin may approve; the queue is
  shared and shows the pending age. MVP's approval is deliberately simple — but "simple"
  must not mean "single approver", or the first Friday evening produces a teacher message
  stuck for 14 hours with a parent waiting.
- **Owner:** product owner.

## OD-12 · Is a complaint automatically high attention?
- **Status:** non-blocking
- **Current assumption:** correct already — the brief scores `complaint_open` +25 with +15
  more at `severity=high`, and severity is set by a human. The role brief's warning
  ("a complaint is a category, not automatically P1") is already honoured.
- **Recommendation [AI #8]:** keep it. Add one rule the brief only implies: a complaint with
  **no staff reply** for a full response target escalates automatically, independent of
  severity. See `escalation-model.md` §4.
- **Owner:** product owner.

## OD-13 · Is the class-schedule signal in MVP?
- **Status:** **BLOCKING** for the attention engine
- **Current assumption:** it is in `config` (+40, the largest routine weight) and cannot fire
  — `learner.next_class_at` has no producer.
- **Options:** (1) build the Core class-schedule sync; (2) drop the signal from MVP and
  rebalance the other weights; (3) ship it dormant and rebalance later.
- **Recommendation [AI #8]:** (1) if Core exposes a schedule, else (2). **Not (3)** — a
  scoring model whose largest term is permanently zero is not a calibrated model, and the
  60–90 day calibration data collected under it is unusable.
- **Owner:** product owner + AI #1.

## OD-14 · When does a family become "at risk" and who is told?
- **Status:** non-blocking
- **Current assumption:** `lifecycle.inactivity_days` = 14 and payment failure, per the brief;
  no engine.
- **Recommendation [AI #8]:** at-risk opens an `owner_locked` case for the owner and is
  visible on the manager's weekly view **by reason**. At-risk without a named reason is a
  label, not an operation.
- **Owner:** product owner.

## OD-15 · What is the response clock for a message that arrives while Unattended?
- **Status:** non-blocking
- **Current assumption:** the brief says the clock starts at the next covering shift. Nothing
  implements it.
- **Recommendation [AI #8]:** keep the brief's rule, and additionally record the *raw* wait
  so the manager can see the true customer experience alongside the fair staff metric. One
  number for accountability, one for reality.
- **Owner:** product owner + AI #1.

---

## Blocking summary

| ID | Topic | Blocks |
|---|---|---|
| OD-01 | conversation model | every schema and authorization decision |
| OD-02 | one database or two | migrations, deployment, authorization strategy |
| OD-03 | admin presence in groups | BR-1's permitted case; AI #5 BR1-09/SG-12 |
| OD-04 | teacher assignment authority | group membership sync, teacher app |
| OD-05 | `adminDirect` for parents | mobile chat list, attention, ownership |
| OD-11 | approver when owner is off duty | approval workflow |
| OD-13 | class-schedule signal | attention engine calibration |
