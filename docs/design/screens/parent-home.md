# Screen: Parent Home

**Priority:** P0 · **Platform:** Flutter (parent) · **Owner:** AI #3

---

## 1. Role and purpose

**Role:** parent / family contact.

**Purpose:** *"what do I need to know or respond to?"* — answered in one glance, before any
scrolling.

The parent should close this app thinking **"Jawwid is handling my children's education."**
Not **"I am using a CRM."** Everything the operations side of this product does — ownership,
coverage, buckets, attention, workload, cases, response targets, internal notes — is invisible
here. Not simplified. **Absent.**

**Entry points:** app launch · the Home tab · a notification with no more specific target.

**Primary action:** the single most useful thing right now — usually **Message Jawwid**, or
responding to whatever is in the Action needed card.
**Secondary:** open a child's group · view the next class · self-service actions.

## 2. Navigation

Bottom tab bar, **4 tabs**, icon + label always visible (never icon-only, `design-system.md` §7.5):

**Home · Jawwid · Groups · Settings**

The parent and teacher shells are **different** (DD-08). A parent's centre of gravity is
"my children"; a teacher's is "my groups".

## 3. Layout — a fixed section order, not a feed

```
┌──────────────────────────────────────┐
│  Next class                          │  ← only when one exists in the window
│  Yusuf · Level 3 · in 40 minutes     │
├──────────────────────────────────────┤
│  Action needed                       │  ← only when there is one; at most one
│  Your subscription renews in 3 days  │
│                          [ Renew ]   │
├──────────────────────────────────────┤
│  Jawwid                              │
│  ◐ Admin A — your Jawwid contact     │
│  "..." last message · 2 unread       │
│                  [ Message Jawwid ]  │
├──────────────────────────────────────┤
│  Your children                       │
│  Yusuf   Level 3 · Teacher T  ▸ 1    │
│  Layla   Level 1 · Teacher R  ▸      │
├──────────────────────────────────────┤
│  Quick actions        (by permission)│
│  My subscription · Next class ·      │
│  Invoice · Renewal link              │
└──────────────────────────────────────┘
```

**At most one "Action needed" card.** If three things need attention, the app shows the most
urgent and the rest live in their natural homes. A home screen with a queue on it is an inbox,
and a parent should not have an inbox (role brief §13).

Sections that have nothing to say are **omitted entirely**, not shown empty. A parent with no
class today should not read "No class today" three times a week.

## 4. The Jawwid card

This is the brief's *"Your Jawwid team"* (§8), and it is the emotional centre of the parent
experience:

- **Owner name and photo.** Always the **owner**, even when someone else is on duty and even
  when someone else sent the last reply. The parent has one person at Jawwid, and that person
  does not change at 17:00.
- Last message preview + unread count.
- **An honest expected reply time** `[BE]`, derived from `on_duty()` or the next shift —
  *"Usually replies within 30 minutes"* / *"Replies from 9:00 tomorrow"*. Never a generic promise.

The parent is never told who is on duty, that coverage exists, or that anyone was covering
(journey J3). If the owner changes permanently, they are told once, plainly, as a message —
because that is a real change to their relationship.

## 5. Children and topics

Each child: name, level, teacher, next class, and unread count for their Student Group *(OQ-3)*.
Tapping opens the group.

**Open topics** (`case`, rendered as *Topic*, `terminology.md` §3) appear inside the Jawwid
conversation, not on Home, with plain-language status only:
*"We're on it" · "We're waiting for your reply" · "We're checking with our team" · "Done"*.
Never a case type, never a severity, never `at_risk`, never `owner_locked`, never an
escalation marker (DD-14).

## 6. Quick actions — gated by capability flags

Rendered **only** where the contact's flags permit `[BE]`:
`can_manage_billing` → invoice, renewal link · `can_view_progress` → progress ·
`can_manage_schedule` → schedule change · `can_cancel` → cancel.

An action a contact may not perform is **not rendered at all** — this is a role boundary, not a
temporary condition, so DD-10's "disable with a reason" does not apply. A secondary read-only
contact must not see a greyed-out Cancel subscription and wonder.

**Backend dependency:** the preset ↔ flag mapping is unpublished (OQ-5). Until it lands, the
client renders from server-supplied flags and never derives them from a preset name.

## 7. States

- **Loading** — skeletons matching the section shapes, in order.
- **Empty** (new family, nothing scheduled) — the Jawwid card alone, with a warm one-liner:
  *"Welcome. Message us any time."* Never a blank screen and never an illustrated mascot.
- **Error** — a per-section inline retry. A failing next-class card must not blank Home;
  the ability to message Jawwid is the last thing to degrade.
- **Offline** — banner; cached content readable with an *"as of"* stamp; **Message Jawwid**
  stays enabled and the message queues.
- **Success** — self-service actions confirm inline (*"Invoice sent to your email"*), not with
  a screen change.

## 8. Permissions *(UX affordances only)*

Only the caller's own family, always `[BE]`. No staff identities beyond the owner's name and
photo. No internal labels. **No phone numbers** (DQ-04).

## 9. Responsive · RTL · Accessibility

Design target 360×640, verified at 320 and at 200% text scale. One-handed: the primary action
sits in the bottom half; the tab bar clears the gesture bar.

**RTL** is the default. Cards, avatars, unread badges and chevrons mirror. Times and dates stay
LTR runs inside Arabic sentences. Relative time localises with ICU plurals — Arabic's dual and
3–10 forms are exercised (`design-qa.md` §B).

**Accessibility:** 44×44 targets, labelled icons, the unread count in the accessible name of
each row, no status by colour alone.

## 10. Edge cases

- **4 children** — the list caps at 3 with *"Show all"*.
- **No owner photo** — initials avatar in `brand.subtle`. Never a generic silhouette; a
  silhouette reads as "nobody".
- **Owner changed** — the card updates and a message explains it once, in plain language.
- **Class starting right now** — the next-class card says *"Starting now"* and, where a join
  action exists, promotes it above Message Jawwid. This is the one case that outranks messaging.
- **Renewal overdue and a class in 10 minutes** — the class wins the single Action-needed slot;
  renewal moves to Quick actions with a marker.
- **A contact with `can_message=false`** — the Jawwid card renders read-only with
  *"Contact your family's primary guardian to send a message"*, and the Jawwid tab is
  read-only rather than absent, so the parent can still follow along.

## 11. Backend dependencies

A parent home payload: next class per learner, the owner's name + photo, thread preview +
unread, open topics in **customer-safe** status text, subscription and renewal state, and the
caller's capability flags · an honest reply-time estimate derived from duty state · realtime
message and conversation updates · **customer-safe status strings supplied server-side**, not
mapped on the client (DD-14).
