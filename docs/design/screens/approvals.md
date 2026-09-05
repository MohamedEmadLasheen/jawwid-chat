# Screen: Approvals

**Priority:** **CONDITIONAL — blocked on OQ-1** · **Platform:** Admin Web (queue) + Flutter (sender states) · **Owner:** AI #4 / AI #3

> **Read `discovery.md` §4 before building this.**
> AI #3 is building message approvals on mobile (`docs/mobile/decisions.md` D1). AI #4 is
> explicitly **not** building the admin counterpart (`backend-contract-required.md` §10). No
> `approval` entity exists in the brief's data model.
>
> This spec exists so the product decision has something concrete to be made against. **Do not
> build it until OQ-1 is answered.** If the answer is "no approvals", delete this file; nothing
> else in the design depends on it.
>
> **Recommended answer (DD-15):** approvals exist, and the approver is `on_duty(family, now)` —
> the only option that adds no new routing concept to a product whose core invariant is that
> one function decides who is responsible.

---

## 1. Role and purpose

**Roles:** whoever `on_duty()` returns for the student's family; manager always.

**Purpose:** *"is this message safe to send to this family?"* — decided in seconds, not minutes.

**Entry points:** rail → Approvals (badge shows the pending count) · a notification · a family's
Student Group.

**Primary action:** **Approve**. **Secondary:** Reject with a reason · open the group for context.

## 2. Layout

Single pane, one card per pending message, **oldest first** — time pending is the only ordering
that matters, because a teacher is waiting on every one of them.

## 3. ApprovalCard

```
┌──────────────────────────────────────────────────────────┐
│ Teacher T → Yusuf's group · Al-Farsi                     │
│ Waiting 12 minutes                                       │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ the complete message body, never truncated,          │ │
│ │ including attachments and voice notes, playable      │ │
│ └──────────────────────────────────────────────────────┘ │
│                            [ Reject ]  [ Approve ]       │
└──────────────────────────────────────────────────────────┘
```

**The body is never truncated and never collapsed.** You cannot approve what you cannot read;
a "show more" on an approval queue guarantees someone approves blind. Attachments render as
previews; voice notes are playable inline.

Time pending renders as plain elapsed text. Past the config threshold it takes `status.warning`,
then `status.danger` — **with words**, never colour alone.

## 4. Interactions

| Input | Result |
|---|---|
| **Approve** | One click. Optimistic; the card leaves with a toast + **Undo** (5s). |
| **Reject** | Opens an inline **required** reason field. The reason reaches the sender verbatim — it is the only thing that makes a rejection actionable (role brief §16). |
| `j` / `k` | Move between cards. |
| `a` | Approve focused. `r` — reject focused (focuses the reason field). |
| Click the group name | Opens the group in context, preserving the queue position. |

Rejecting is deliberately one step slower than approving. Approving is the common, safe case;
rejecting is a message to a colleague and should be composed, not fired.

## 5. Sender-side states — Flutter (`screens/student-group.md`)

| State | Sender sees | Everyone else sees |
|---|---|---|
| `pending` | Muted bubble, `message.pending.bg`, hourglass, **"Waiting for approval"** | **Nothing at all** — not greyed, absent |
| `approved` | An ordinary sent message. The word "approved" is never shown | The message |
| `rejected` | Muted bubble, **"Not sent"** + the reason + **Edit and resend** | Nothing, ever |

A pending message must never look delivered (DQ-05) and must never be visible to a
non-sender — a "pending" bubble other members can see is a leak of unapproved content.

## 6. States

- **Loading** — 3 skeleton cards.
- **Empty** — *"No messages waiting for approval."* This is the healthy state and should read
  as such: calm, no action, no illustration.
- **Error** — *"We couldn't load approvals."* + Retry.
- **Offline** — banner; decisions queue and are marked pending; **the card does not leave the
  list until the server confirms**, because an approval that silently failed is content that
  never reached a parent.
- **Already decided elsewhere** — the card is replaced in place by *"Approved by {name}"* /
  *"Rejected by {name}"* and fades after 3s. Never an error dialog.

## 7. Permissions *(UX affordances only)*

Only the family's on-duty person (DD-15) and the manager see a given card. An approver who goes
off duty mid-queue keeps the cards they have open but loses the ability to decide them; the
buttons disable with the reason *"{name} is now on duty for this family."*

## 8. Responsive · RTL · Edge cases

**Responsive:** ≥ 1024 cards max 720px wide, centred. < 1024 full-width, actions stacked
full-width at the card foot.
**RTL:** sender → group direction arrow mirrors; the message body uses `unicode-bidi: plaintext`;
Approve sits on the reading-end side; voice-note waveforms **do not** mirror.
**Edge cases:** sender deletes the message while pending → card is removed with a quiet line ·
the family is transferred mid-queue → the card moves to the new on-duty person's queue and the
current holder sees "no longer yours" · a 4000-character message → the card scrolls internally,
still never truncated · queue of 200 → virtualised, oldest-first ordering preserved.

## 9. Backend dependencies — none of these exist yet

An `approval` entity with `pending / approved / rejected` + `rejection_reason` · a per-conversation
approval **policy** returned by the server (the client must never assume approval is on) ·
routing of an approval to `on_duty(family, now)` · realtime `approval.created` /
`approval.decided` · **and a decision about whether approval work counts as a workload unit** —
if it does not, an admin's load silently under-reports (DD-15).
