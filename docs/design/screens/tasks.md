# Screen: Tasks & Follow-ups

**Priority:** P0 · **Platform:** Admin Web · **Owner:** AI #4

Two audiences share one component set and get two different screens.

---

## 1. Roles and purpose

| Audience | Purpose | Sees |
|---|---|---|
| **admin / coverage** — *My follow-ups* | *"what did I promise, and when?"* | Their own follow-ups and the tasks they created |
| **finance / technical / academic** — *My tasks* | *"what work is waiting on my department?"* | **Only tasks assigned to them.** No families, no threads, no inbox, **no composer anywhere** |
| **manager** | Both, plus a department view with the delay breakdown |

The department view is the one place in the product where a staff member sees family data
without being able to message a family. That boundary is absolute (brief §2: *"Never message
families"*) and the design enforces it by **not rendering a composer, a reply affordance, or a
link into the thread anywhere on this screen**.

**Entry points:** rail → Tasks / My follow-ups · a family's open-tasks section · a notification ·
the manager dashboard's department delay metric.

**Primary action:** complete a task (department) / open the family (admin).
**Secondary:** change due date · reassign · add a result · cancel.

## 2. Layout

Single pane, list-first. No three-pane shell — a task is small enough to expand in place.

```
┌──────────────────────────────────────────────────┐
│ Tabs:  Due today (4) · Overdue (1) · Open · Done │
│ Filters:  Type · Assignee · Family               │
├──────────────────────────────────────────────────┤
│  TaskCard                                        │
│  TaskCard                                        │
└──────────────────────────────────────────────────┘
```

**Overdue is a tab, not a filter.** It is the only thing on this screen that can be late, and it
should be one click from anywhere.

## 3. TaskCard

```
┌────────────────────────────────────────────────────┐
│ [Finance]  Confirm the refund was issued           │
│ Al-Farsi · Yusuf · Billing case                    │
│ ⚠ Overdue by 1 day · Assigned to Finance C         │
│                                    [Complete]      │
└────────────────────────────────────────────────────┘
```

Line 1: type chip + title (`type.body` 600). Line 2: family · student · case context.
Line 3: due date — overdue renders `status.danger` fg **with a warning icon and the word
"Overdue"** (never colour alone, DQ-F). Trailing: one primary action.

Expanding a card shows details, the case's recent activity as **read-only context**, and a
result field. For department staff the family name is text, not a link.

**States:** default · hover · expanded · completing (button spinner) · done (moves to the Done
tab with a toast + Undo) · cancelled · error.

## 4. Follow-up creation — the lightweight path

Follow-ups are created from the conversation composer, never from this screen, and they are
deliberately **three fields** (role brief §34, journey J8):

```
When       [ Tomorrow ] [ Sunday ] [ Next week ]  or  a date-time picker
Who        defaults to me
Note       optional, one line
                                    [ Cancel ]  [ Create ]
```

Everything else — type, details, linking to a different case, a checklist — is behind **More**
and is collapsed by default. An admin promising "I'll check on Sunday" must be able to record
that in under three seconds or they will not record it at all.

Task creation (assigning work to another department) uses the same sheet with **Department**
promoted to a required field.

## 5. The department round-trip — the behaviour that makes this screen matter

`[BE]` When the **last** open task on a case is completed, the case returns
`waiting_internal → open` and the family moves to **Today** with `top_reason`
*"inform family of finance result"* (brief §8, journey J9).

The design consequence: completing a task must feel like **handing work back**, not like
finishing it in isolation. The completion toast says so:
*"Done. Al-Farsi is back in the admin's inbox."*

The department staff member never sees the family's inbox, the thread, or the reply. They see
that their part landed.

## 6. Permissions *(UX affordances only)*

| Role | Scope |
|---|---|
| admin / coverage | Own follow-ups; tasks they created; tasks on families they are on duty for |
| finance / technical / academic | **Only tasks assigned to them.** No family list, no thread, no message affordance |
| manager | All tasks, plus per-department delay |

**Task SLA** is 1 business day `[BE]`, config-driven, and delays surface on the manager dashboard
by department — not as a countdown on the card (DD-04).

## 7. States

- **Loading** — 5 skeleton cards under skeleton tabs.
- **Empty, Due today** — *"No follow-ups due today."* Calm, no action.
- **Empty, Overdue** — *"Nothing is overdue."* This one is worth saying; its absence is good news.
- **Empty, department** — *"No tasks are waiting on you."*
- **Empty, Done** — *"Nothing completed yet."*
- **Error** — *"We couldn't load your tasks."* + Retry.
- **Offline** — banner; the list stays readable; **Complete** queues and shows as pending.
- **Success** — toast with **Undo** for 5 seconds; the card moves tabs after the undo window.

## 8. Responsive

≥ 1024: two-column card grid. < 1024: single column, tabs become a scrollable strip, the
primary action goes full-width at the bottom of each expanded card.

## 9. RTL

Type chip leads, action trails. The overdue icon precedes its text on the reading-start side.
Dates are LTR runs. Tab order and the tab strip's scroll direction mirror.

## 10. Edge cases

- **Task on a case that was closed** — the card shows *"This topic is closed"* as context and
  completion is still allowed; the round-trip in §5 simply does not fire.
- **Task assigned to a deactivated staff member** — surfaces in the manager's view as
  *"Unassigned — {name} was offboarded"*, never silently disappearing.
- **Two people complete the same task** — the second sees *"Already completed by {name}"*, not
  an error. `Idempotency-Key` covers the double-submit case.
- **Very long title** — wraps to two lines, then truncates.
- **A department staff member follows a deep link to a family** — permission denied with the
  generic message; they are returned to their task list.

## 11. Backend dependencies

`GET /tasks?scope=mine|team|department` — the `department` scope must return **only** the
caller's assigned tasks, enforced server-side · `POST /tasks` · `PATCH /tasks/:id` ·
`POST /cases/:id/follow-up` · realtime `task.updated`, `case.updated` · the case round-trip in
§5 is a server transition the UI learns about, never one it performs.
