# Screen: Notifications

**Priority:** P0 · **Platform:** Flutter + Admin Web · **Owner:** AI #3 / AI #4

---

## 1. Role and purpose

**All roles**, with a different vocabulary per role.

**Purpose:** *"tell me the one thing I need to know, and take me straight to it."*

**Do not make everything urgent** (role brief §37). A product that pushes every event trains its
users to disable push, and then the operationally important notifications — an unattended
family, a breached response target — arrive nowhere.

## 2. Three levels, and what earns each

| Level | Behaviour | Earns it |
|---|---|---|
| **Urgent** | Sound + banner + badge; bypasses grouping | Incoming call *(OQ-4)* · class starting in 5 minutes · a family unattended *(manager)* · a response target breached with no reply *(on-duty)* |
| **Important** | Banner + badge, grouped per conversation | A new message · an approval decided on your message · a follow-up due now · an escalation *(manager)* · a handover you now own |
| **Normal** | Badge only, batched | Task updates · renewal reminders · schedule changes · coverage configuration changes · a completed task's round-trip |

Anything not on this list is **not a notification**. It is a badge, or it is nothing.

## 3. Content rules

Every notification says **what happened**, **who it is about**, and **what to do**, in that
order, in one line where possible:

- *"Al-Farsi sent a message."*
- *"Yusuf's class starts in 30 minutes."*
- *"Follow-up due: Al-Farsi renewal."*
- *"Al-Farsi has waited 45 minutes for a reply."*
- *"2 families have no one on duty."* *(manager)*

Never: a bare *"New activity"* · a case type or severity to a family · an attention score to
anyone (DQ-01) · a staff identity to a family beyond the owner's name · **a phone number** ·
a message body in a payload beyond the visible preview.

**Parent-facing notification copy uses the customer vocabulary** (`terminology.md` §3). A parent
never receives the word *case*, *escalated*, *at risk* or *owner_locked*.

## 4. Deep links

**Every notification opens its target directly** (journey J22): the family thread at the unread
divider · the group at the unread divider · the task · the approval · the call · the manager's
unattended list. Never a generic home screen — a notification that lands you on Home has wasted
the tap it earned.

Payload carries **only** notification id, type, and target entity id `[BE]`. The client fetches
the detail after the tap. If the target is gone or now forbidden: a calm
*"This is no longer available."* and the relevant list. Never a raw error, never a 403 screen.

## 5. In-app notification centre

**Mobile:** a Notifications item within Settings, plus badges on the tabs. Not its own tab —
a parent's notifications belong on the thing they are about, and a fifth tab would compete with
the four that matter.

**Admin:** a bell in the top bar with a popover, grouped by family. It is a **backstop**, not the
work surface — the inbox is the work surface, and any notification the admin needs to act on
already appears there as a row or a banner.

Each entry: icon, one line, relative time, read state. Actions: mark all read · open.

## 6. Settings — per role

**Parent:** new messages · class reminders (with a lead-time choice) · payment and renewal ·
quiet hours. Everything is opt-out except class reminders and payment failures.

**Teacher:** group messages · approval results · schedule changes · quiet hours.

**Staff:** new messages · follow-ups due · handovers · escalations *(manager)* ·
unattended *(manager)* · shift-end banner. **Response-target and unattended notifications cannot
be disabled** for the roles they apply to — they are the operational floor, and a product whose
core promise is response time cannot let its staff silence the response-time alarm.

**Quiet hours** apply to Normal and Important, never to Urgent.

## 7. States

- **Loading** — 5 skeleton rows.
- **Empty** — *"No notifications."* Calm.
- **Error** — inline retry; badges keep their last known value.
- **Offline** — the list is readable; new notifications arrive on reconnect; the badge may be stale
  and is stamped as such.
- **Permission not granted (OS)** — one in-app card explaining what will be missed, with a link
  to settings. Shown **once**, dismissible, never nagging.

## 8. RTL · Accessibility

Icon leads, time trails, both mirror. Counts stay LTR. Notification text uses ICU plurals in
Arabic. Screen readers announce new in-app notifications politely; a realtime disconnection is
announced assertively. The badge count is in the accessible name of its tab or bell.

## 9. Edge cases

- **20 messages from one family in a minute** — grouped into one notification with a count.
  `[BE]` also batches the family-facing acknowledgement (~60s).
- **Multiple devices** — the read state is shared; dismissing on one clears the others.
- **A notification for a family that was transferred** — opens for the new owner; the previous
  owner's copy resolves to *"This is no longer available."*
- **Class reminder for a cancelled class** — cancelled `[BE]`; if it already fired, the deep
  link lands on the schedule with the cancellation visible.
- **Push token revoked** — the client re-registers silently on next launch.

## 10. Backend dependencies

Push token registration per device · a payload schema carrying **only id, type and target id** ·
a shared read state across devices · notification levels assigned server-side (the client must
not decide what is urgent) · localised or key+params notification bodies · grouping and batching
server-side · quiet-hours honoured server-side, because a queued push that fires at 02:00 was
never the client's to suppress.
