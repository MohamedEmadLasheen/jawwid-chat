# Screen: Approvals

**Priority:** **P0 — PRD MVP scope** · **Platform:** Admin Web (queue) + Flutter (sender states) · **Owner:** AI #4 / AI #3

> **The message approval workflow is MVP** (`docs/qa/authoritative-scope.md` §3):
> **approve · reject · rejection reason**, intentionally simple. Escalation, expiry and
> **coverage-aware approval are Phase 2** and must not be built now.
>
> **What is open is OQ-1: who the authorized approver is, and how a pending message reaches
> them.** That is an integration/product decision owned by the product owner, AI #1
> (authorization) and AI #2 (routing) — **not a design decision, and not decided here.**
> An earlier revision of this pack recommended `on_duty(family, now)`; that recommendation is
> **withdrawn** (`decisions.md` DD-15), because it is an authorization call and because
> `on_duty()` is coverage-derived, which would have pulled Phase 2 behaviour into MVP.
>
> This spec is therefore written **approver-agnostic**. Every surface says *"the authorized
> approver"*. Naming that role changes no pixel on any screen — it changes only who the server
> routes a pending message to.
>
> **Implementation status is unresolved:** `docs/qa/defects.md` **JC-001** records approvals as
> P0 and currently DESIGN-ONLY in the backend.

---

## 1. Role and purpose

**Roles:** the **authorized approver** for that Student Group `[BE]` — whoever OQ-1 names.
Manager always.

**Purpose:** *"is this message safe to send to this family?"* — decided in seconds, not minutes.

**Entry points:** rail → Approvals (badge shows the pending count) · a notification · a family's
Student Group.

**Primary action:** **Approve**. **Secondary:** Reject with a reason · open the group for context.

### The requirement this screen exists to satisfy: no dead-end pending state

The workflow must be operable end to end:

```
Teacher composes ──► pending ──► an authorized approver sees it ──► approve ──► published
                                                                └─► reject ──► rejected, with a
                                                                               reason the sender sees
```

Three properties must hold under **any** answer to OQ-1, and they are what the design requires
of it:

1. **Every pending message is routed to at least one authorized approver, at all times.** A
   pending message with no reachable approver is a dead end — the teacher's message is neither
   sent nor refused, and nobody is accountable for it. If the routing rule can produce "nobody",
   it needs an explicit fallback, in the way `on_duty()` returning NONE produces the Unattended
   list rather than silence.
2. **Every pending message reaches a terminal outcome** — published, or rejected with a reason.
3. **The sender can always see which of the three states their message is in**, without asking.

Whether approval work counts as a **workload unit** must be decided alongside OQ-1. If it does
not, an approver's load silently under-reports (`decisions.md` DD-15).

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

The server decides who sees a card `[BE]`; the client renders what it is given and never derives
approver eligibility. Managers always see the full queue.

If OQ-1 is answered with a rule under which an approver's eligibility can **change while the
queue is open**, the design's requirement is that the card does not silently vanish: it disables
with an honest reason from `capabilities.*_blocked_reason` (`decisions.md` DD-10) and the card
states who now holds it. That behaviour is specified here so it is not forgotten if the answer
turns out to be time-varying — it is **not** an assumption that the answer will be.

## 8. Responsive · RTL · Edge cases

**Responsive:** ≥ 1024 cards max 720px wide, centred. < 1024 full-width, actions stacked
full-width at the card foot.
**RTL:** sender → group direction arrow mirrors; the message body uses `unicode-bidi: plaintext`;
Approve sits on the reading-end side; voice-note waveforms **do not** mirror.
**Edge cases:** sender deletes the message while pending → card is removed with a quiet line ·
the family is transferred mid-queue → the card moves to the new on-duty person's queue and the
current holder sees "no longer yours" · a 4000-character message → the card scrolls internally,
still never truncated · queue of 200 → virtualised, oldest-first ordering preserved.

## 9. Backend contract required

| # | Requirement | Owner |
|---|---|---|
| A1 | An `approval` state on a message — `pending / approved / rejected` — plus `rejection_reason` on rejection. `ModerationStatus` already declares `PENDING` / `REJECTED` (`docs/qa/defects.md` JC-001, mitigating factor) | AI #2 |
| A2 | A **per-conversation approval policy**, server-supplied. The client must never assume approval is on or off | AI #2 |
| A3 | **Routing of a pending message to an authorized approver** — the OQ-1 answer, expressed as a server-side rule with a defined behaviour when it yields nobody | AI #1 + AI #2 |
| A4 | A pending message is **not delivered to, and not visible to, any member except its sender** | AI #1 |
| A5 | Realtime `approval.created` / `approval.decided` | AI #2 |
| A6 | A decision on whether approval work is a **workload unit** | product owner + AI #2 |

None of these is designed here. A1–A6 are what the interface needs in order to work.
