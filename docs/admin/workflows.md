# Admin Web — Operational Workflows

How each job is actually done in the UI, and which rule from the brief governs it.

## 1. Handling a customer message

1. Inbox opens on **NOW**, ordered by the server.
2. The row states the situation in words — *"class started 5 minutes ago"* — so
   the operator can triage without opening anything.
3. Click → the family opens: cases on top, one continuous thread, Family 360
   beside it.
4. Reply in the composer. Enter sends.
5. Optionally *Reply* then resolve the case, or attach a follow-up.

The server sets `on_behalf_mode` from `on_duty()`. The client never sends it.

## 2. Working a family you are covering

Covered families appear in their **own** inbox section, and every row carries
*"You are covering this family."* The Family 360 panel shows Owner and On-duty on
separate lines.

Coverage may not close an `owner_locked` case (renewal, cancellation, high
complaint, onboarding, at_risk). The UI does not hide the control silently — it
shows *"Owner-locked — deferred to the owner's next shift."* For an urgent
owner-locked case, coverage acts on the transactional part and the case stays
open for the owner.

## 3. Handing a thread on

There is no generic "handoff" button, because that is not the decision an
operator makes. The two real controls are:

- **"I'll keep this"** → sets `sticky_handler_id`, keeping the thread past shift
  end while she is still online.
- **"For owner"** → defers to the owner's next shift.

Automatic handoffs at shift end are produced by the backend and surface as
handoff cards in **"What happened while you were away."**

**Neither control changes ownership.** Conversation handling and family ownership
are different things.

## 4. Transferring ownership (manager only)

`Open family → Transfer ownership → pick new owner → read the impact → write a
reason → confirm.`

The impact preview shows the target's families, open cases, open tasks and
current workload level, so a manager rebalancing load does not discover
afterwards that she moved a family onto an already-HIGH admin.

The reason is required. The server writes `audit_log` in the same transaction and
notifies the family. This is the only path that may change `family.owner_id`.

Two gates must both pass: the role must be `manager` **and** the server must
report `capabilities.can_transfer_ownership`. Tested both ways.

## 5. Creating a task

From the conversation: **Internal task** → type (finance / technical / academic /
other), title, assignee, due date, details.

Departments see only their own tasks and can never message a family. When the
last open task on a case is completed, the backend moves the case
`waiting_internal → open` and the family to TODAY with the reason *"inform family
of finance result"*. That is a server transition; the UI learns it from
`case.updated` and refreshes the inbox.

## 6. Creating a follow-up

One action from the case: pick a date, write a reason. It becomes a task, is
assigned, appears in the inbox, and notifies the assignee.

## 7. Escalating

Manual escalation requires a written reason. Automatic escalations (unattended
family, breached response target with no open, high-severity complaint, same case
type a third time in 30 days, HIGH admin receiving a NOW item, Friday coverage
over threshold) are raised by the backend and land in the manager's **Needs your
action**.

## 8. Resolving a conversation

Resolve the case from its card. If the customer replies inside
`reopen.window_hours`, the backend reopens it — the same thread, the same family,
the same history. The client never creates a second thread.

## 9. Coverage configuration (manager only)

`Coverage` shows tonight's duty chain, gaps in the next 7 days, shifts, rules and
absences. Everything is read from and written to backend config tables — no
schedule, name or time is hardcoded anywhere in this application.

Overlap validation is the server's; a `409` surfaces its conflict detail. Saving
invalidates duty **and** the inbox, because changing a rule changes who
`on_duty()` returns and therefore whose inbox a family sits in.

Absence auto-detection **suggests**; the manager activates a backup with one
click. Never automatic in MVP.

## 10. Manager intervention

The dashboard header targets **Unattended = 0**, and says so out loud when it is
zero. Team-now lists presence, NOW/TODAY counts, late replies and workload level
per admin. Every number is a link into the list behind it.

---

## Keyboard

| Key | Action |
|---|---|
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `Escape` | Close dialog (focus returns to the trigger) |

## What an operator is never shown

An attention score · a P1/P2/P3 label · an internal rule name · a workload
formula · a phone number · a stack trace.
