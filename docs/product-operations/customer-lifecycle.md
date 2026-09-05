# Customer Lifecycle Audit

**Owner:** AI #8 · **Date:** 2026-09-05

Each stage answers: who **owns**, who **handles**, what **creates** the conversation, what
the **next action** is, and how it can be **lost**.

`family.state` supports `onboarding · active · at_risk · renewal_due · paused · churned`
(`chat.family`). **No engine writes it.** Every transition below is specification.

---

## 1. New family / first contact
Owner: assigned at import ("import current owner assignments as-is"). Handler: `on_duty()`.
Creates: the family thread. Next action: acknowledge with an honest reply time.
**Gap (LC-1, P1):** there is no defined path for a family created *after* import. Who
becomes the owner of a family that Core creates at 22:00 on a Friday? `family.owner_id` is
`NOT NULL`, so **a family cannot be created without an owner** — and no rule says who that is.
*Recommendation:* an explicit, configurable default owner (a manager, or round-robin **at
creation only** — which is not routing, because it never repeats). This must be decided
before the Core integration writes its first family.

## 2. Qualification / enrollment
Onboarding case opens on first payment; `owner_locked`. Next action: the owner's.
**Gap:** no case table, no payment event.

## 3. Active family / daily support
The family thread carries everything; cases layer on it. Handler = `on_duty()`.
**Gap (LC-2, P0):** during coverage the handler is not notified (FS-01).

## 4. Scheduling and teacher issues
Schedule case; may be `is_blocking` when a class is imminent. Teacher-related matters flow
through the Student Group, never a teacher↔parent 1:1.
**Gap:** groups unbuilt; teachers cannot authenticate; `learner.teacher_id` has no producer.

## 5. Payment issue
`payment_failed` +20 for 48h; finance task; owner follow-up.
**Gap:** no payment event source, no tasks.

## 6. Renewal
See `renewal-operations.md`. **Invisible today.**

## 7. Complaint / escalation
See `escalation-model.md`. **No case, no severity, no escalation routing.**

## 8. Follow-up and resolution
Cases resolve; conversations do not (`terminology.md` §2 — contradicted by AI #2's
`setResolved`, X-04). Resolved → closed after `reopen.window_hours` (72).
**Gap (LC-3, P1):** `timers.auto_resolve_hours` (168) auto-resolves operational cases. With
no `owner_locked` enforcement in code, an auto-resolve sweep would silently close renewal,
cancellation, onboarding and at-risk cases — the four the config comment says it must never
touch. This must be enforced by the query, not by the comment.

## 9. Customer replies after resolution
Reopens; same handler if on duty.
**Partly correct:** `message.service.ts` clears `thread.resolvedAt` on a contact message.
**Gap:** no reopen event, no `reopen_count`, no handler restoration (FS-14).

## 10. Inactive / at risk
`lifecycle.inactivity_days` = 14 without attendance → `at_risk`, +15 attention, case for the
owner. **Gap:** needs `learner.last_attended_at`, which has no producer (no Core sync).

## 11. Churn and reactivation
`churned` state exists. **Gap (LC-4, P2):** nothing defines what happens to a churned
family's owner, thread, groups or tasks — or what a returning family reactivates into. The
product's core promise is *"people can change; the customer experience must not reset"*;
that promise is strongest at reactivation and there is currently no rule for it.

---

## Cross-cutting lifecycle questions

| Question | Answer today |
|---|---|
| What if the customer never replies? | `timers.no_reply_reminder_hours` [24, 72] seeded; no timer runtime |
| What if Jawwid never replies? | response targets seeded; no target engine; nothing escalates |
| Owner off shift? | coverage handles — but is not notified (FS-01) |
| Owner overloaded? | manager decides — with no workload engine |
| Owner absent? | manager activates a backup — with no detection |
| Several issues at once? | multiple cases on one thread — no case table |
| Payment/renewal event? | nothing; no Core event stream |

## Findings

| # | Finding | Sev |
|---|---|---|
| LC-1 | No owner-assignment rule for families created after import, though `owner_id` is `NOT NULL` | **P1** |
| LC-2 | Handler not notified during coverage (= FS-01) | **P0** |
| LC-3 | Auto-resolve has no `owner_locked` exclusion in code | **P1** |
| LC-4 | Churn/reactivation has no defined operational behaviour | **P2** |
| LC-5 | `family.state` has no writer, so five of six states are unreachable | **P1** |
