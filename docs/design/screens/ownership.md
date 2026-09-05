# Screen: Change Owner

**Priority:** P0 · **Platform:** Admin Web · **Owner:** AI #4 · **Destructive**

---

## 1. Role and purpose

**Role:** manager only.

**Purpose:** *"move permanent responsibility for this family, deliberately and on the record."*

This is the highest-impact action in the product. `transfer_ownership()` is the **only** path that
changes `family.owner_id`, and it writes `audit_log` in the same transaction (brief §3, §12).

It is a **dialog**, not a screen and not a menu item that fires on click. The word is
**Change owner**, never "assign" and never "reassign" — assignment language is what coverage
uses, and confusing the two is exactly the failure this product exists to prevent
(`terminology.md` §5, role brief §32).

**Entry points:** Family 360 → owner row → **Change owner** · the manager dashboard's workload
view · offboarding (bulk, §6).

**Primary action:** confirm the change. **Secondary:** cancel.

## 2. The flow — four steps in one dialog

```
┌─ Change owner — Al-Farsi ──────────────────────────┐
│                                                    │
│  1  Current owner    Admin A                       │
│                                                    │
│  2  New owner        [ pick ▾ ]                    │
│                      Admin D · Steady · 11 families│  ← load shown in the picker
│                                                    │
│  3  Impact                                         │
│     • 3 open topics move with the family           │
│     • 2 open tasks stay with their assignees       │
│     • Admin D's workload: Steady → Steady          │
│     • Al-Farsi will be told their contact changed  │
│                                                    │
│  4  Reason           [ required ]                  │
│                                                    │
│                        [ Cancel ]  [ Change owner ]│
└────────────────────────────────────────────────────┘
```

**Step 2 — the picker shows each candidate's current workload level and family count.** A
manager choosing a new owner is making a load decision whether or not the UI helps them; showing
the load makes it an informed one.

**Step 3 — impact is fetched, never guessed** `[BE]` `GET /families/:id/transfer-impact`.
It updates when the new owner changes. It states what moves, what does not, and that **the family
will be notified** — because they will be, and a manager should not learn that afterwards.

**Step 4 — the reason is required.** The confirm button stays disabled until it has content.
`audit_log.reason` is `NOT NULL` in the schema; the UI collects it honestly rather than sending
a placeholder.

## 3. What this dialog must never imply

- That coverage does something similar. Coverage has no dialog, no reason field, and no impact
  preview, because it changes nothing permanent (DD-02).
- That the change is reversible by doing it again. The copy is neutral and factual; there is no
  "you can always change it back".
- That the family is a caseload item. The subject line is the family's name.

## 4. States

- **Loading impact** — the impact block skeletons; **confirm stays disabled** until impact
  resolves. Confirming an unknown impact is the failure mode this step exists to prevent.
- **Impact unavailable** — *"We couldn't calculate the impact."* + Retry. Confirm **remains
  disabled**; this is the one place where a degraded path is worse than no path.
- **Same owner selected** — confirm disabled, inline note *"Admin A is already the owner."*
- **Target is inactive or offboarded** — not offered in the picker at all.
- **Submitting** — button spinner, dialog locked, no double-submit (`Idempotency-Key`).
- **Success** — dialog closes · toast *"Owner changed to Admin D"* · Family 360's owner row
  updates · a `SystemCard` appears in the thread · a timeline event with the reason.
- **Error** — inline in the dialog, the reason text preserved, retryable.
- **Conflict** — someone else changed the owner first: *"The owner changed to {name} while this
  was open."* + refresh. Never a blind overwrite.

## 5. Permissions *(UX affordances only)*

Manager only. For every other role the owner row in Family 360 is **plain text with no
affordance at all** — not a disabled button. An admin should not spend a moment wondering
whether they could move a family; the answer is permanently no (AI #5's matrix).

## 6. Offboarding — the bulk case

`Settings → Team → {staff} → Offboard`. One action, four effects (brief §8):
deactivate · transfer their families **evenly or to a named admin** · flag orphaned coverage
rules · notify the affected families. All audited.

The confirmation names the numbers before it is possible to proceed:

> *"Admin A owns 24 families. Distribute evenly across 3 admins, or move all to one person?
> 2 coverage rules reference Admin A and will be flagged. 24 families will be notified."*

Typed confirmation of the staff member's name is required — this is the one action in the
product where a stray click costs a day of manual repair.

## 7. Responsive · RTL

Dialog max 480px, full-screen sheet below 640px with actions pinned to the bottom.
**RTL:** labels lead, values trail; the picker chevron mirrors; the destructive action sits at
the reading end; numbers stay LTR.

## 8. Edge cases

- **Family has an open `owner_locked` case** — impact says so explicitly: *"1 topic is reserved
  for the owner and will move to Admin D."*
- **Family is under active coverage right now** — impact says the coverage continues until the
  window ends and the new owner picks it up after.
- **The new owner is currently absent** — allowed, with a warning: *"Admin D is away until
  Sunday. Coverage will apply until then."*
- **Manager transfers a family to themselves** — allowed; managers can own families.
- **Bulk offboarding while transfers are in flight** — server-serialised; the UI reports the
  final state rather than an optimistic one.

## 9. Backend dependencies

`GET /families/:id/transfer-impact?to_staff_id=` · `POST /families/:id/transfer-ownership`
with a **required** `reason`, audit written in the same transaction, family notified ·
`POST /staff/:id/offboard` · `GET /staff` with workload · realtime `ownership.changed`.
