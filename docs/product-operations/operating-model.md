# Jawwid Chat — Operating Model (normative statement)

**Owner:** AI #8 · **Date:** 2026-09-05 · **Status:** proposed as the operational reference
**Source hierarchy:** PRD v0.1 (not on disk) → `docs/qa/authoritative-scope.md` §3 →
brief §§1,4,5 (operating-model chapter, carried forward) → this document.

This document says what the model *is*, in one place, so that no agent has to infer it.
Where the repository already implements something correctly, it is cited. Where a rule is
mine and not the product owner's, it is marked **[AI #8 RECOMMENDATION]**.

---

## 1. The four roles in a family's day

| Term | Definition | Changes when | Never changes because of |
|---|---|---|---|
| **Primary Owner** | The one staff member permanently responsible for the family relationship. `family.owner_id`, NOT NULL. | Only `transfer_ownership()`, by a manager, with a reason, audited in the same transaction | shift end · coverage · absence · workload · handoff · escalation · assist |
| **Current Handler** | The staff member expected to act *right now*. Derived, never stored as an assignment. | Continuously, with the clock | — |
| **Coverage Admin** | A staff member who is Current Handler for a family they do not own, under a `coverage_rule` or an activated `absence.backup_id`. | per rule/absence window | — |
| **Manager** | Sees everything; the only actor who may transfer ownership, edit shifts/coverage/absences/config, activate a backup, offboard. | — | — |

**Current Handler is a function, not a column:**

```
current_handler(family, now) =
      thread.sticky_handler_id   if sticky_until > now AND sticky handler is online
 else on_duty(family, now)                                  -- brief §4
 else NONE                                                  -- → Unattended
```

Two invariants follow, and they are the whole model:

- **INV-A · Exactly one Current Handler at any instant** — never two, never zero.
  `NONE` is a legitimate value; it means **Unattended** and it is loud, not silent.
- **INV-B · Current Handler ≠ ownership.** No code path may write `family.owner_id` as a
  side effect of resolving a handler. AI #4 already encodes this in the UI vocabulary
  ("Covering for X", never "assigned to"); AI #6 reserves the word *transfer* for ownership
  alone (`docs/design/terminology.md` §5).

### Implementation status

`thread.service.ts::currentHandler()` has the right shape (sticky → `onDuty()` → `null`).
Two defects against the definition above:

- it does not require the sticky handler to be **online** (brief §4: *"and is still online"*);
- `ReferenceCoverageService.onDuty()` returns the owner regardless of shift, so today
  Current Handler ≡ Primary Owner and the model is untested.

---

## 2. Normal operation

Dina owns the family. It is Tuesday 11:00; Dina is in shift.

```
Primary Owner   = Dina
Current Handler = Dina        (on_duty)
on_behalf_mode  = OWNER       (derived, not client-supplied)
UI label        = none        (terminology.md: labelling the normal case makes it look exceptional)
```

Everything about the family is Dina's: reply, cases, tasks, follow-ups, resolution.

---

## 3. Off-shift operation

17:05 Tuesday. Dina's shift ended at 17:00. Radwa covers 17:00–23:00.

```
Primary Owner   = Dina        ← unchanged, and must remain unchanged
Current Handler = Radwa
on_behalf_mode  = COVERAGE
UI label        = "Covering for Dina" / «يغطي عن دينا»
```

Rules (brief §5, carried forward):

- Radwa handles the family **unless** the open case is `owner_locked` and not urgent →
  Radwa **acknowledges only**, and it is deferred to Dina's next shift.
- `owner_locked` and urgent (blocking · class now · payment failed · customer wants to
  renew now) → Radwa acts on the **transactional part only**, never closes the case, flags
  the owner.
- **Coverage never:** changes the owner, closes a relationship case, promises discounts.

Only quiet families stay put. At shift end, every family with `needs_reply = true` moves
into the coverage inbox **with a handoff card** (last 3 messages, open cases, owner note,
subscription, next class). Next morning Dina sees *"What happened while you were away."*

**Current defect (P0, `failure-scenarios.md` FS-02):** the delivery audience
(`identity.service.ts::familyThreadAudience`) is *contacts + owner*. Radwa is not in it.
A message arriving at 17:05 notifies Dina, who is off shift, and not Radwa, who is responsible.

---

## 4. Overload operation

Workload is a **signal to the manager**, not a router.

- Workload never reassigns a family. There is no queue and no "least loaded" outside a
  hypothetical Phase 3 pool (brief §12).
- HIGH workload is an input to two things only: the manager's *Needs your action* list, and
  the assist affordance.
- The escalation trigger *"admin at HIGH workload receives a new NOW item"* is the point at
  which the system asks a human to decide. It does not decide.

**[AI #8 RECOMMENDATION]** The manager's response to overload must be a bounded set of
named actions, so that "who is overloaded" leads to a decision rather than a feeling:
(a) reply as assist on a specific family, (b) activate a backup, (c) extend a coverage
window for tonight, (d) transfer ownership permanently. Anything else is a dashboard that
reports pressure without relieving it. See `workload-audit.md` §5.

---

## 5. Unexpected absence

Auto-detection is a **suggestion**: admin in shift, no activity for
`absence.auto_detect_minutes` (seeded 45), families waiting → warn the manager with a
one-click *Activate backup*. **Never auto-activate in MVP.**

Until the manager acts, `on_duty()` still resolves to the absent admin — the model does not
silently reroute. This is deliberate and correct. It also means the families are, in
practice, unattended while a human is asleep at the keyboard: the *only* mitigation is that
the manager alert is loud. **[AI #8 RECOMMENDATION]** the auto-detect alert must carry the
count of waiting families and the oldest wait, or the manager cannot triage it.

---

## 6. Shift transition

The boundary is the most dangerous minute in the day. Three things happen in order:

1. `shift.end_banner_minutes` (seeded 30) before the end: the owner sees
   *"3 families waiting, 2 follow-ups → snooze to my next shift?"*
2. At the boundary: `needs_reply` families move to the coverage inbox with handoff cards.
   Quiet families do not move.
3. Stickiness bridges the gap **only** for a thread the outgoing admin replied to within
   `handoff.grace_minutes` (seeded 15) **and only while they are still online.**

**Open ambiguity (AI #5 AMB-5):** whether the boundary is inclusive or exclusive. An
exclusive/exclusive pair produces a one-minute window with **zero** handlers — a direct
INV-A breach. This is a product decision with a one-line implementation; see OD-08.

---

## 7. Escalation

Automatic (brief §5): unattended family · response target fully breached with no open ·
complaint `severity=high` · same case type 3rd time in 30 days · admin at HIGH workload
receives a new NOW item · Friday coverage over the workload threshold.

Manual: a button with a **reason**, or the customer asking for a manager.

Escalation moves **attention and visibility**, not ownership. `on_behalf_mode=ESCALATION`
is a label on the message; the manager acting on a family does not become its owner.

---

## 8. Return from coverage

When Dina comes back:

- ownership is where she left it;
- she gets *"What happened while you were away"* — handoffs plus summaries;
- open cases return to her; `owner_locked` cases that coverage deferred are waiting;
- follow-ups that came due while she was away are **overdue**, and must be presented as
  such rather than silently re-dated.

**Current defect:** nothing writes a `Handoff` row. The table exists in Prisma; no service
creates one. The away summary has a UI component (`AwaySummary.tsx`) and an endpoint
constant, and no producer.

---

## 9. Ownership change

The only path is `transfer_ownership(family, new_owner, reason)`, manager-only, writing
`audit_log` **in the same transaction** (brief §12). Legitimate triggers: offboarding, a
deliberate rebalance, a relationship breakdown.

**Current status:** the function does not exist. `transfer_ownership` appears once in the
repository — as a field name in `apps/admin-web/src/shared/types/domain.ts`.
`chat.family.owner_id` is `references chat.staff(id) on delete restrict`, so a staff row
cannot be deleted out from under a family — good — but nothing prevents a plain
`UPDATE chat.family SET owner_id = …`.

---

## 10. Manager intervention

The manager is the only actor who resolves the model's dead ends:

| Dead end | Manager action |
|---|---|
| Unattended family | activate a backup, or handle it |
| Absent admin, no backup configured | activate a backup |
| Coverage admin also overloaded | assist, or extend a window |
| Owner leaving the company | offboard → transfer families |
| Approval pending with the approver off shift | *(undecided — OD-03/OD-11)* |
| Two admins both think the other has it | *(no mechanism exists — see FS-01)* |

The last two rows are the model's current holes.

---

## 11. What the model forbids — the review checklist

- [ ] No path assigns a family to a staff member other than via `on_duty()` (+ stickiness,
      assist, escalation — each logged with a reason).
- [ ] No queue table, no round-robin, no automatic distribution.
- [ ] Owner changes only via `transfer_ownership()`, audited in the same transaction.
- [ ] Every staff message carries `on_behalf_mode`, derived — never client-chosen for
      OWNER/COVERAGE.
- [ ] Attention and workload are computed, never entered; all constants read from `config`.
- [ ] A family is never in two inboxes, and never in none — except Unattended, which is loud.
- [ ] Coverage cannot close `owner_locked` cases or change owners.
- [ ] Workload never reassigns anyone.

Items 4 and 5 are partially honoured today (`authorization.service.ts` derives
OWNER/COVERAGE correctly — AI #5 PF-4). Items 1, 3, 6, 7 and 8 have no implementation to
honour or breach yet. Item 5's second half is breached by `AppConfigService`'s silent
hardcoded fallbacks.
