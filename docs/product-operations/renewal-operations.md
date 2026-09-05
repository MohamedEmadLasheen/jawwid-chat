# Renewal Operations Audit

**Owner:** AI #8 · **Date:** 2026-09-05

Renewal is the workflow with the most direct revenue consequence and the least
implementation.

## 1. Specified

- `lifecycle.renewal_due_days_before` = 14 → open a renewal case **for the owner**.
- `attention.points.renewal_window` +10, escalating to `renewal_urgent` +25 at 3 days.
- `renewal` is in `cases.owner_locked_types` — coverage may not close it.
- Family state `renewal_due` exists.
- Coverage may act on the transactional part when urgent: *"send renewal link, record
  request, never close the case, flag owner."*
- Manager's weekly view: renewals due / renewed / no reply / refused.
- Self-service renewal link, billing-permitted contacts only (`can_manage_billing`).

## 2. Implemented

`chat.subscription` (branch `feat/backend-foundation`) with `renewal_due_at`,
`last_payment_status`, an index on `renewal_due_at`, and `contact.can_manage_billing`.
The Admin Web family panel renders a renewal countdown.

**Everything else is absent:** no case table, no lifecycle trigger, no Core sync writing
`chat.subscription`, no renewal link, no manager weekly view.

## 3. Where a renewal can become invisible

| # | Hole | Sev |
|---|---|---|
| **RN-1** | `chat.subscription` has **no producer**. Every renewal signal reads a table nothing writes. Renewals are invisible by construction | **P0** |
| **RN-2** | No lifecycle trigger creates the renewal case at T-14, so nothing is ever due, nothing is `owner_locked`, nothing escalates at T-3 | **P0** |
| **RN-3** | `renewal_urgent` is *"owner only"* — at T-3 the family is not surfaced to the covering admin who is on duty tonight. A renewal expiring over a weekend is seen by nobody until Saturday | **P1** |
| **RN-4** | A **failed payment during renewal** has two signals (`payment_failed` +20, `renewal_urgent` +25) and no defined workflow: no retry, no dunning, no state, no task | **P1** |
| **RN-5** | **Renewal abandoned** has no terminal state. A customer who stops replying moves to `at_risk` by inactivity 14 days later — after the subscription has already lapsed | **P1** |
| **RN-6** | Multi-child: `chat.subscription.learner_id` is nullable, so a family may hold per-child and whole-family subscriptions simultaneously. Which one drives `family.state = renewal_due`? Undefined | **P1** |
| **RN-7** | Renewal is invisible in the **customer's** app: the brief gives self-service *"renewal link"* to billing-permitted contacts, but nothing states what a parent sees when their renewal is 3 days out | **P2** |

## 4. Required operational transitions

```
active ──T-14──► renewal_due            (case opens, owner_locked, owner notified)
renewal_due ──customer confirms──► payment attempted
                                   ├─ success ─► active   (case resolved, family notified)
                                   └─ failure ─► payment_failed  (task for finance + owner follow-up)
renewal_due ──no reply by T-3───► renewal_urgent          (attention +25; visible to Current Handler)
renewal_due ──no reply by T-0───► lapsed → at_risk        (case stays open; NOT auto-resolved)
renewal_due ──customer refuses──► cancellation case       (owner_locked; retention conversation)
```

**RN-8 (P1):** the brief's `timers.auto_resolve_hours` = 168 must never apply to a renewal
case — it is `owner_locked`, and the config comment already says auto-resolve *"never applies
to owner-locked types."* That exclusion must be enforced in code, not only in a comment: a
silently auto-resolved renewal is a silently lost customer.

## 5. Acceptance criteria

1. A Core→Chat sync writes `chat.subscription` with a visible `synced_at`.
2. A daily job opens a renewal case at `renewal_due_days_before`, `owner_locked`, assigned
   to the family's Primary Owner.
3. The renewal is visible to the **Current Handler** at all times; the *close* action stays
   owner-locked.
4. Failed payment creates a finance task **and** an owner follow-up, and never auto-resolves.
5. The manager weekly view reconciles: due = renewed + no-reply + refused + lapsed.
6. A test asserts a renewal case survives a full coverage cycle without being resolved,
   re-dated, or losing its owner.
