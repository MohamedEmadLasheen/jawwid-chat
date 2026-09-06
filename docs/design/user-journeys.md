# Jawwid Chat — User Journeys

**Owner:** AI #6. Synthetic names throughout (`Admin A`, `Coverage B`, `Manager C`, teacher
`Teacher T`, family *Al-Farsi*, student *Yusuf*) — see `decisions.md` DD-18.

Each journey states the trigger, the steps, what the UI must preserve, and where it can fail.
`[BE]` marks a step whose behaviour the backend owns.

---

## J1 — Parent sends a message to Jawwid *(P0)*

1. Parent opens the app → **Home**. The largest element is "Your Jawwid contact — Admin A"
   with a single **Message Jawwid** action.
2. Taps it → the **Jawwid conversation**. One continuous thread; full history, including the
   period when a different person was replying.
3. Types, sends. Bubble appears immediately as `sending`.
4. `[BE]` Automation acknowledges within ~60s with an honest reply time drawn from
   `on_duty()` or, out of hours, the next shift. Rendered as a `SystemCard`, not as a person.
5. Bubble becomes `sent` → `delivered` → `read`.

**Preserve.** The thread id never changes. The parent never learns that a different admin is
handling them tonight — they see "Jawwid", and Admin A's name stays on Home as their contact.
**Fails if.** The acknowledgement looks like a human reply (it must be a `SystemCard`), or the
promised reply time is generic rather than derived from the real duty state.

## J2 — The message reaches the right admin *(P0 — the critical routing journey)*

1. `[BE]` `on_duty(Al-Farsi, now)` runs. Owner Admin A is in shift → the answer is Admin A.
2. `[BE]` The family's bucket recomputes. `needs_reply=true` + waiting time → **NOW**.
3. Admin A's inbox: the *Al-Farsi* row moves to the **Now** section, instantly, no animation.
   Row shows: family name, `top_reason` "New message, waiting 2 minutes", wait time, red dot.
4. Push/desktop notification: "New message from Al-Farsi". Tapping deep-links to the family
   screen with the thread scrolled to the unread divider.
5. Admin A opens the family. Three panes: inbox list (left), thread (centre),
   **Family 360 (right, already populated)** — no second click to see who this family is.
6. Replies. `[BE]` sets `on_behalf_mode=owner`; no mode badge is shown, because owner is normal.
7. `[BE]` `last_staff_message_at` updates → `needs_reply=false` → the family drops to
   **Waiting on family**, collapsed.

**Preserve.** Context. The admin never has to ask "who is this?" — Family 360 loads with the
family, not on demand. **[BE]** AI #4's `GET /families/:id` returns the whole panel in one call
for exactly this reason.
**Fails if.** The row animates (an admin scanning loses their place), or the reply requires
navigating away from the thread to find the student's next class.

## J3 — Coverage: the owner is off shift *(P0 — the critical coverage journey)*

1. 16:45. `[BE]` `shift.ending` fires 15 min before Admin A's shift ends.
2. **End-of-shift banner** in Admin A's inbox: *"Your shift ends in 15 minutes. 3 families
   waiting, 2 follow-ups due."* Actions: **Snooze to my next shift** · **Review**.
3. 17:00. `[BE]` `on_duty(Al-Farsi, now)` now returns Coverage B.
4. Every *Al-Farsi*-like family with `needs_reply=true` appears in **Coverage B's** inbox, in a
   section titled **Families I'm covering now**, each with a `HandoffCard`: last 3 messages,
   open cases, owner's note, subscription, next class. Quiet families do **not** move.
5. Coverage B opens *Al-Farsi*. The header reads:
   `Primary Owner · Admin A` on line 1, `Current Handler · Coverage B — covering` on line 2.
   **Both are visible.**
6. Coverage B replies. `[BE]` tags `on_behalf_mode=coverage`; the message carries a
   **Covering** `ModeBadge`.
7. An `owner_locked` case (a renewal) is open. Its action buttons are **disabled with the
   reason** "Leave for the owner — Admin A's next shift, tomorrow 09:00". Coverage B can
   acknowledge and note, not close.
8. 09:00 next day. Admin A's inbox opens on **What happened while you were away**: the
   handovers, what Coverage B did, and the still-open owner-locked case.

**Preserve.** *Al-Farsi* never learns any of this happened. Admin A is still the owner on every
screen, at every moment (risk R2). The thread is continuous — no "Coverage B joined" ceremony.
**Fails if.** The header shows only Coverage B; if the covering reply carries no mode badge; or
if the owner-locked action is hidden rather than disabled-with-a-reason (DD-10).

## J4 — Coverage ends, the owner returns *(P0)*
Owner opens the away summary (J3.8) → taps a handover → lands on the family thread at the
handover `SystemCard` → reads Coverage B's messages, badged **Covering** → acknowledges. The
`HandoffCard` collapses. Nothing about ownership changed at any point and the UI never
suggested it did.

## J5 — Stickiness: "I'll keep this" *(P0)*
Admin A is mid-conversation at 16:58. Composer overflow → **I'll keep this**. `[BE]` sets
`sticky_handler_id` / `sticky_until`. Header gains a **Keeping this** badge with its expiry.
The family does **not** move to coverage at 17:00. On expiry `[BE]` creates a handover and the
family moves — Admin A sees a toast, not a surprise.

## J6 — Reply as assist *(P0)*
A family is in NOW, has waited past 50% of its response target, and the on-duty admin has not
opened it. Only then is **Reply as assist** enabled for another admin.
Before that it is visible and disabled, reason: *"Available when the on-duty admin hasn't
opened this and the reply is overdue."* On send, `[BE]` tags `assist`, notifies the on-duty
admin, and the message carries an **Assist** badge with its reason. The assisting admin
**cannot close the case**, and the close control says so.

## J7 — Admin resolves a case; the family replies afterwards *(P0)*
Admin resolves via **Reply + resolve** → `case.status=resolved` → the family drops to
**Waiting on family** or **Quiet**. `[BE]` closes it after the reopen window (config, 72h).
A family message inside the window **reopens the case automatically**, to the same handler if
they are on duty. The thread shows a `SystemCard` "Topic reopened". No new thread. No new row.

## J8 — Admin creates a follow-up *(P0)*
Composer overflow → **Follow-up** → a bottom sheet with **three** fields: date/time (with
"Tomorrow" / "Sunday" quick chips), assignee (defaults to self), an optional note. Save.
Toast: "Follow-up created — Sunday 10:00". It appears in the family, in My follow-ups, and
`[BE]` re-buckets the family to **Today** when it comes due, with `top_reason` "Follow-up due".
Everything else about a task is optional and lives behind "More" (role brief §34).

## J9 — Department task *(P0)*
Admin creates a task on a case → assigns to Finance → `[BE]` case becomes `waiting_internal` →
the family leaves NOW. Finance staff see **only their own tasks**, with case context and **no
family thread and no message affordance**. Finance completes it. `[BE]`: last open task done →
case returns to `open`, family moves to **Today** with `top_reason` *"inform family of finance
result"*. The admin did not have to remember.

## J10 — Manager finds an overloaded admin *(P1)*
Dashboard → **Team now** → Admin A shows **Heavy** with a breakdown *beside* it: 7 needs-reply,
3 waiting, 4 follow-ups, 1 reply overdue. The number is never alone. Clicking the badge opens
Admin A's inbox filtered to what makes it heavy. The manager decides; **nothing is automatic**
(role brief §67).

## J11 — Manager changes the owner *(P0, destructive)*
Family 360 → owner row → **Change owner**. A dialog, not a menu:
current owner → new owner (picker showing each candidate's current workload) → **impact
preview** (`[BE]` families affected, open cases, open tasks, target's resulting load) →
**required reason** → confirm.
`[BE]` writes `audit_log` in the same transaction and notifies the family.
The thread gets a `SystemCard`. The word used is **Change owner**, never "assign" (DD-01/§32).

## J12 — Manager edits coverage *(P0)*
Coverage screen → a week grid of who covers whom → edit a rule → **conflicts are shown before
saving** (`[BE]` returns 409 with detail; the UI renders it, it does not re-implement the rule).
Gaps in the next 7 days are a permanent section, not a report you have to run.

## J13 — Unattended family *(P0)*
`[BE]` `on_duty()` returns NONE. The family appears **only** in the manager's **Unattended**
list, never silently in someone's inbox. The manager's dashboard header shows the count with a
target of 0 and it is the first thing on the screen. The parent gets an honest out-of-hours
acknowledgement with the next shift time; their response clock starts then.

## J14 — Escalation *(P0)*
Manual: composer overflow → **Escalate to manager** → reason required → `[BE]` notifies the
manager and the case shows an **Escalated** badge.
Automatic `[BE]`: unattended family, target fully breached with no open, high-severity
complaint, third repeat of a case type in 30 days, a Heavy admin receiving a NOW item. These
land in the manager's **Needs your action**, each carrying the reason it fired.

## J15 — "This order is wrong" *(P0, MVP-required)*
Any inbox section header carries a quiet **This order is wrong** link. Tapping a row's overflow
→ same action. A small sheet: "What would you have done first?" → pick a family → optional note.
`[BE]` logs it as calibration data. **No visible effect on the order** — and the copy says so:
*"Thanks. This helps us tune the order; it won't change today's list."* Anything else would be
a lie, or a priority field by the back door.

## J16 — Parent Home *(P0)*
Home answers "what do I need to know?" in one screen: next class (with the student's name),
one action-needed card if any, the Jawwid contact, unread count per child's group, and
self-service actions the contact's capability flags permit. Nothing else. No ownership, no
workload, no coverage, no case types, no internal labels.

## J17 — Teacher sends a group message *(P0; blocked on C-1/C-2)*
Teacher opens **Groups** → *Yusuf's group* → sends. The group header names the student, the
teacher, and the family, and there is **no affordance anywhere to start a private chat with a
parent** — not disabled, absent. `[BE]` enforces it; the UI simply never suggests it (role
brief §18).

## J18 — Teacher message requires approval *(P0; the approver is OQ-1)*
Teacher sends → the bubble shows **Waiting for approval** in a muted treatment, clearly not
delivered. Other members see nothing. `[BE]` routes it to the family's on-duty admin (DD-15).
- **Approved** → the bubble becomes an ordinary message; the word "approved" is never shown,
  because a sent message is just a sent message.
- **Rejected** → the bubble becomes muted with **Not sent** and the reason, always the reason
  (role brief §16). The teacher can edit and resend from that bubble.

## J19 — The authorized approver decides an approval *(P0; who that is, is OQ-1)*
Approvals queue, sorted by time pending. Each card: sender, student, family, **the full message
body** (never truncated — you cannot approve what you cannot read), time pending, group.
**Approve** is one tap. **Reject** opens a reason field, required. Keyboard: `a` approve,
`r` reject, `j`/`k` move. Empty state: *"No messages waiting for approval."*

## J20 — Admin starts a call *(P0; implementation status is OQ-4)*
Family 360 → **Call**, enabled only where `[BE]` authorizes it. Connecting → Connected →
controls: mute, speaker, end. On end, a `SystemCard` in the thread with duration and outcome.
No recording UI. **No phone number is displayed at any point** — people are named, never dialled.

## J21 — Group call *(P0; implementation status is OQ-4)*
From a Student Group header. Participants shown by name and role. Joining and leaving are
`SystemCard`s in the group. Same control set; a participant list replaces the single avatar.

## J22 — Notification deep link *(P0)*
Every notification carries only an id, a type, and a target id `[BE]`. Tapping opens the target
directly — the family thread at the unread divider, the task, the approval, the call — never a
generic home screen. If the target is gone or forbidden, the app shows a calm
*"This is no longer available"* and lands on the relevant list, never a raw error.

## J23 — Offline and recovery *(P0)*
Losing connectivity: an in-flow banner, the UI stays fully interactive, sends become `queued`
with a clock glyph, below the last confirmed message. On recovery: queued messages send in
order with their original `client_message_id`; the banner is replaced by a brief "Back online".
A permanent failure keeps the bubble in place with a red border and an inline **Retry** — a
failed message is never silently dropped and never silently retried forever.

## J24 — Session expired *(P0)*
`[BE]` returns a distinguishable code. The app shows a sheet: *"Your session ended. Sign in to
continue."* — **the draft in the composer is preserved** and restored after sign-in. Sensitive
local state clears. This is different from *account disabled*, which says so and offers a
contact route, and from *bad credentials*, which stays on the sign-in form.
