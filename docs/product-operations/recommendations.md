# Recommendations

**Owner:** AI #8 · **Date:** 2026-09-05

Each entry states: **Problem · Evidence · Business impact · Recommendation · Priority ·
Owner · Acceptance criteria.** Recommendations that are mine rather than the product
owner's are marked **[REC]**; product decisions are cross-referenced to `open-decisions.md`.

Priorities are deliberately not inflated: 8 × P0, 12 × P1. One finding (R-06's assist
bypass) was fixed by AI #1 while this audit was being written and is marked accordingly.

---

## MUST FIX BEFORE MVP (P0)

### R-01 · Put PRD v0.1 in the repository
**Problem.** The governing document is not on disk; five agents work from second-hand
summaries, and two conflicting records of the same product-owner decision exist.
**Evidence.** `docs/qa/authoritative-scope.md` §6; project memory `jawwid-chat-scope-split`;
`README.md` cites `docs/brief/JAWWID_CHAT_BRIEF.md`, a path that does not exist.
**Business impact.** Eleven of the fifteen entries in `cross-agent-audit.md` have this single
cause. Every day it stays unresolved, more code is written in a direction that may be thrown
away.
**Recommendation.** Commit PRD v0.1 to `docs/`. Fix the README path. Resolve OD-01 explicitly
in one sentence in the PRD: whether `thread.family_id UNIQUE` survives.
**Owner.** Product owner. **Acceptance.** `docs/prd-v0.1.md` exists; README points to it;
OD-01 closed in `decision-log.md`.

### R-02 · Decide one database — OD-02
**Problem.** Two persistence stacks define the same six tables with different columns,
defaults and vocabularies; one lives inside Jawwid Core's Supabase database, the other in a
standalone Postgres.
**Evidence.** `cross-agent-audit.md` X-01/X-02/X-03/X-12; `discovery.md` §1.2.
**Business impact.** Neither stack can be deployed without discarding or rewriting the other;
a `contact.can_message` default differs between them, which is a permission, not a detail.
**Recommendation.** Choose per OD-02 — I recommend a separate database with an explicit Core
sync, because co-tenancy contradicts the product's stated independence and is the hardest
option to reverse. Then delete or subordinate the losing stack in one commit.
**Owner.** Product owner + AI #1 + AI #7. **Acceptance.** One migration path; one config
namespace; one definition of `staff`, `family`, `contact`, `config`, `event_log`, `audit_log`.

### R-03 · Merge the branches, then keep them merged
**Problem.** `main` is an empty initialisation commit; four branches independently redefine
the same tables. The system has never been executed end to end.
**Evidence.** `git branch -a -v`; the two migrations defining `chat.staff`/`chat.family` are
absent from the branch carrying the Admin Web that consumes them.
**Business impact.** Every integration defect in this report is currently *invisible*, and
the first merge will surface them all at once.
**Recommendation.** Integrate to `main` behind CI now, at whatever cost, rather than after
more divergence. **[REC]** Daily integration from this point.
**Owner.** AI #5 + AI #7. **Acceptance.** `main` builds, migrations apply, typecheck passes,
CI runs on every push (release-gate G-36).

### R-04 · The audience must follow the handler, not the owner
**Problem.** `familyThreadAudience()` returns contacts + `family.owner`. During coverage the
responsible admin receives no receipt, no realtime event and no notification.
**Evidence.** `apps/api/src/platform/identity.service.ts`; FS-01; X-14; CV-1.
**Business impact.** Every message that arrives outside the owner's shift — which is most of
the evening, all night and all Friday — is delivered to the wrong person. This alone would
make Jawwid Chat slower than WhatsApp.
**Recommendation.** Audience = contacts + Primary Owner + `currentHandler()` + staff with an
open task on the family, recomputed per message.
**Owner.** AI #1 (identity) + AI #2 (delivery). **Acceptance.** Test: owner off shift,
customer sends a message, the covering admin receives the realtime event, a receipt row and
a push; the owner receives it as context, not as an action.

### R-05 · Restrict stickiness to OWNER and COVERAGE, and require presence
**Problem.** `stickyHandler` is set on **every** staff customer-facing message, including
ASSIST and ESCALATION, and `currentHandler()` never checks `staff.presence` despite the brief
requiring *"and is still online"*.
**Evidence.** `message.service.ts` (`threadPatch.stickyHandler` set unconditionally);
`thread.service.ts::currentHandler()`; FS-02, FS-03; SIM-1, SIM-4.
**Business impact.** A manager who reassures a customer once, or an admin who assists once,
silently becomes the handler — including after logging off. This is the *"two admins each
assume the other has it"* failure, reachable in four steps.
**Recommendation.** Set stickiness only when `onBehalfMode ∈ {OWNER, COVERAGE}`; add
`AND presence='online'` to the sticky branch; expire stickiness on the presence→offline
transition.
**Owner.** AI #2 + AI #1. **Acceptance.** Tests for both: assist does not capture the
handler; going offline releases the thread within one presence TTL.

### R-06 · Gate assist on its four preconditions; derive the manager's mode
**Problem.** *(Half fixed during this audit.)* `fa53ba7` (AI #1) closed the client-supplied
assist/escalation bypass — both are now denied outright pending a server-evaluated grant.
Two gaps remain: the grant is unimplemented, so the brief's *permitted* assist case cannot
be exercised at all; and a manager may still send with any mode the client chooses.
**Evidence.** `authorization.service.ts` lines 130-131 (manager path unchanged) and 150-175
(assist now denied); `assist.min_wait_fraction` (0.5) is seeded and read by nothing;
FS-11, FS-12.
**Business impact.** The audit trail can record a manager's escalation as an owner reply.
And with assist closed rather than gated, an admin who *should* be allowed to help a waiting
family cannot — the brief's escape valve for a breached response target is unavailable.
**Recommendation.** Move the brief's §5 gate into `canSendMessage`: family in NOW **and**
waited > `assist.min_wait_fraction` of target **and** the on-duty admin has not opened it —
or the on-duty admin explicitly asked for help. Return the failing precondition as the
denial reason. Notify the on-duty admin. Derive the manager's mode like everyone else's.
**Owner.** AI #1. **Acceptance.** Four negative tests, one positive; assist emits an event to
the on-duty admin.

### R-07 · Fix the Student Group cardinality before the migration is written
**Problem.** `Thread @@unique([familyId, kind])` permits one `STUDENT_GROUP` thread per
family; `StudentGroup @@unique([learnerId])` expects one per learner.
**Evidence.** `apps/api/prisma/schema.prisma`; FS-05; X-06; SIM-5.
**Business impact.** A family with two children cannot have two Student Groups. Multi-child
families are the common case.
**Recommendation.** `(familyId, kind)` uniqueness applies to the FAMILY thread only; group
threads are keyed on the group. Free today, expensive after data exists.
**Owner.** AI #1 + AI #2. **Acceptance.** A family with three learners holds three group
conversations, one family conversation, one owner.

### R-08 · Do not ship the attention engine on two live signals
**Problem.** Eight of fourteen attention signals read tables with no producer; the
highest-weighted routine signal (`class_soon`, +40) reads a column its own migration says
will be null.
**Evidence.** `attention-audit.md` §2; `20260905090300_chat_family_domain.sql` comments on
`next_class_at`; FS-09, FS-10; OD-13.
**Business impact.** The inbox degrades to *"unanswered, by wait"* — a FIFO queue with extra
steps — and the 60–90 days of calibration data collected under it are unusable.
**Recommendation.** Land the case table and the Core subscription/class sync first; or
formally cut the dead signals from MVP and rebalance. Do **not** ship dormant signals.
**Owner.** Product owner + AI #1. **Acceptance.** Every signal in `config` has a producer, or
is removed from `config` with a note in `decision-log.md`.

---

## SHOULD FIX BEFORE PILOT (P1)

### R-09 · Build `case` and `task` next
**Evidence.** `task-followup-audit.md` §2 — cases and tasks are a prerequisite for follow-ups,
`owner_locked`, renewals, complaints, escalation, response targets, 8/14 attention signals,
6/9 workload units, and the entire department-staff surface.
**Recommendation.** Immediately after the conversation model is settled. **Acceptance.** The
disappearing-follow-up test in `task-followup-audit.md` §4 passes end to end.
**Owner.** AI #1 + AI #4.

### R-10 · Conversation state must say who owes the next action **[REC]**
`conversationState()` returns `WAITING_ON_CUSTOMER` whenever staff spoke last, so *"we'll get
back to you"* files the family under the customer's court (FS-06, X-05). State should be set
by the replying admin — reply+snooze / reply+resolve / waiting-on-us — and a staff reply that
creates no follow-up should default to *open*, never *waiting on customer*.
**Owner.** AI #2 + AI #4. **Acceptance.** No conversation can be `WAITING_ON_CUSTOMER` unless
a human said so or the customer was explicitly asked a question.

### R-11 · Workload must decay and must explain itself
OD-07 (staleness) + WL-3 (breakdown). A high-count/low-urgency admin must score below a
low-count/high-urgency one, and every score must render with its components.
**Owner.** AI #1 + AI #4. **Acceptance.** `workload-audit.md` §6.

### R-12 · One config namespace; the Node accessor must raise
`AppConfigService.get()` silently substitutes hardcoded literals, breaking the brief's own
non-negotiable, and the two stacks name the same constants differently (X-03, FS-30).
**Owner.** AI #2. **Acceptance.** Deleting a config key fails loudly in both engines; the
literals become seed data.

### R-13 · Write handoff records and the away summary
Nothing writes a `Handoff` row; `AwaySummary.tsx` and the endpoint constant have no producer
(CV-4). **Owner.** AI #1 + AI #2.

### R-14 · Build the Unattended surface
`onDuty()` returning `null` is consumed by nothing: no list, no manager alert, no honest
auto-reply, no deferred response clock (CV-7, FS-04). This is the model's designated safety
net and it is currently a dropped value. **Owner.** AI #1 + AI #4.

### R-15 · `transfer_ownership()` with a trigger, and offboarding
OW-1/OW-2/OW-3. Ownership must be unchangeable except through the audited function, and no
family may be owned by inactive staff. **Owner.** AI #1. **Acceptance.**
`ownership-audit.md` §4.

### R-16 · Core sync contract, with visible staleness
No sync job exists for `subscription`, `learner`, `next_class_at` or `last_attended_at`; the
`subscription.status` CHECK copies Core's vocabulary verbatim and will break on a Core
release (FS-25, FS-26). Every Core-mirrored panel must show `synced_at`.
**Owner.** AI #1 + AI #6.

### R-17 · Scope the admin inbox
`listThreadsForActor()` returns the 200 most recently active threads company-wide (FS-31).
The inbox must be the family-scoped, attention-ordered, sectioned projection AI #4 already
specified. **Owner.** AI #1 + AI #2.

### R-18 · Missed calls must create follow-ups
A missed inbound call is an unrecorded customer contact (FS-20). When calling ships, a missed
call must create a follow-up owned per OD-09 and an `event_log` row. **Owner.** AI #2.

### R-19 · Decide the approver-on-Friday rule before building approvals
OD-11. MVP approval is deliberately simple, but "simple" must not mean "single approver", or
a teacher's message sits pending for 14 hours with a parent waiting (FS-19).
**Owner.** Product owner.

### R-20 · Escalation must notify someone
Escalation today is a message label plus an audit row; no manager is notified and no surface
shows it (ES-1). An escalation nobody receives is worse than none. **Owner.** AI #2 + AI #4.

---

## GOOD IMPROVEMENT (P2)

- **R-21** `task.owner_id` → `assignee_id`; thread `sticky_handler_id` → `retained_by`
  (`domain-language.md` §1). Free before the tables exist.
- **R-22** One canonical actor id across messages, receipts, read cursors and device tokens
  (X-13).
- **R-23** Model message redaction as an append-only record so both stacks agree (X-12).
- **R-24** Define `staff.capacity_override` semantics or drop the column (WL-5).
- **R-25** Define churn and reactivation behaviour (LC-4) — the product's promise that "the
  customer experience must not reset" is strongest exactly here.

## PHASE 2 — explicitly postponed

AI attention scoring · video calling · labels · broadcast · approval escalation, expiry and
coverage-aware approval · CSAT · predictive churn · auto-activated backups · coverage pools.
**Do not let any of this enter MVP.** The release gate fails on their presence (G-31…G-35),
and this document adds no new MVP scope beyond what `authoritative-scope.md` §3 already lists.

---

## Operational metrics worth building

Every metric must answer *"what decision will the team make because of this number?"*

| Metric | Decision it drives |
|---|---|
| Unattended count (target 0) | activate a backup **now** |
| Families waiting on Jawwid, by age | who gets assisted this hour |
| Overdue follow-ups by owner | where the relationship is slipping |
| Response-target compliance, median first reply **by shift** | whether the shift plan is right |
| Renewals: due / renewed / no reply / refused | this week's revenue action |
| At-risk families **by reason** | whether the cause is teaching, billing or scheduling |
| Workload by handler, **with breakdown** | who needs help and what kind |
| Coverage gaps in the next 7 days | fix the roster before it breaks |
| Reopen count per case type | which resolutions are premature |
| "This order is wrong" submissions | recalibrate the attention weights |

Deliberately excluded as vanity: total messages sent, families per admin (the brief forbids
it as a workload input), average handling time in isolation, staff "response speed"
leaderboards.
