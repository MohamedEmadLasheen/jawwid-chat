# Screen: Student Group

**Priority:** P0 for mobile · **CONDITIONAL — depends on OQ-3** · **Platform:** Flutter (parent + teacher) · **Owner:** AI #3

> **Backend dependency, unresolved.** No Student Group entity exists in the brief's data model,
> whose conversation model is deliberately one thread per family (`thread.family_id UNIQUE`,
> *"cases never create a second thread"*). AI #3 raised this as C8; **OQ-3** must be answered
> before this is built.
> **Recommended answer (`discovery.md` §6):** a Student Group is a **separate entity beside
> `thread`**, never merged into it. Merging would put teacher-visible content on the staff
> thread, which breaks the internal/customer visibility boundary that DQ-03 exists to protect.

---

## 1. Role and purpose

**Roles:** parent (family contacts with `can_message`) · teacher · authorised admin / coverage.

**Purpose:** *"the official channel about this student."*

One group per student. It is named after the student, because that is the only thing everyone in
it has in common.

**This is the only place a teacher and a parent communicate.** There is no private teacher ↔
parent channel, and the interface must never suggest one exists (role brief §18): tapping a
member opens a profile with **no message action and no call action**. Not disabled — absent.
`[BE]` enforces it; the UI simply never offers it.

**Entry points:** Groups tab · a child's row on Parent Home · a notification.

**Primary action:** send a message.
**Secondary:** attach · voice note · reply · react · group info · group call *(OQ-4)*.

## 2. Layout

```
┌──────────────────────────────────────┐
│ ‹  Yusuf · Level 3               [☎] │
│    Teacher T · Al-Farsi family    ⓘ  │
├──────────────────────────────────────┤
│   messages                           │
│   ─────── Unread ───────             │
├──────────────────────────────────────┤
│ [+]  Message…                   [▶]  │
└──────────────────────────────────────┘
```

**Header** is the student's identity first (name + level), then who is in the room. Tapping
opens **Group info**: the student, the teacher(s), the family contacts, and — only when one is
present — the admin. Members show **name, role and avatar only. Never a phone number, never an
email** (DQ-04).

**Membership is not editable by parents or teachers.** No add, no remove, no leave. The group
exists because the student exists.

## 3. Messages

Standard bubbles with the author's name and role (*Teacher* / a parent's relationship /
*Jawwid*). Group system cards: a teacher change, a schedule change, a student's level change,
call started/ended *(OQ-4)*.

**Approval states** *(OQ-1, see `screens/approvals.md` §5)*:

| State | The sender sees | Every other member sees |
|---|---|---|
| `pending` | Muted bubble, hourglass, **"Waiting for approval"** | **Nothing** — the message is absent, not greyed |
| `approved` | An ordinary message | The message |
| `rejected` | Muted bubble, **"Not sent"**, the reason, **Edit and resend** | Nothing, ever |

A pending message that other members can see is unapproved content that has already been
delivered — the exact failure approval exists to prevent.

## 4. Composer

Same as `parent-chat.md` §6: `+` → photo · file · voice note · *(call, OQ-4)*, then the field,
then send. Keyboard-anchored, never jumps, drafts persist.

Where approval is on `[BE]` (policy is **per conversation, server-supplied** — the client never
assumes), the send button's helper line reads *"Messages are reviewed before they're sent."*
Said once, up front, quietly. A sender who learns about approval only after their message hangs
in "pending" feels censored; a sender told beforehand feels supported.

## 5. States

- **Loading** — header from cache, message skeletons.
- **Empty** — *"This is the start of Yusuf's group."* + who is in it. Calm.
- **Error** · **Offline** · **Send failed** — identical to `parent-chat.md` §7.
- **Read-only** (a contact without `can_message`) — history readable, composer replaced by one
  explanatory line.
- **Teacher removed / student inactive** — the group becomes read-only with a plain system card.
  History is never deleted.

## 6. Permissions *(UX affordances only)*

| Actor | Can |
|---|---|
| Parent contact with `can_message` | Read, send, attach, voice, reply, react, join a group call *(OQ-4)* |
| Parent contact without | Read only |
| Teacher | Read, send, attach, voice, reply, react, join a group call. **Cannot** start a 1:1 with a parent — the affordance does not exist |
| Admin / coverage | Read; send where authorised; the group is visible in the family's context |
| Any member | **Cannot** edit membership |

## 7. Responsive · RTL · Accessibility

As `parent-chat.md` §8. Member avatars and role labels mirror; **voice-note waveforms do not**.
Group system cards are centred and direction-neutral. Each member row's accessible name carries
the role, so a screen-reader user knows who is a teacher without relying on a visual chip.

## 8. Edge cases

- **A student with two teachers** — both in the header, both in group info; messages are
  attributed individually.
- **A family with several contacts in the group** — each renders with their relationship, so
  "Mother" and "Father" are distinguishable without a phone number.
- **A student changes teacher** — a system card; the old teacher loses send access; **history
  stays**. A group's history is the student's record and is never truncated by a staffing change.
- **A parent tries to reach a teacher privately** — there is no path. Member profile has no
  message and no call action.
- **Approval is off for this group but on for another** — policy is per conversation and comes
  from the server; the helper line in §4 renders only where it applies.
- **A teacher's message is rejected while they are offline** — they see the rejection with its
  reason on next open, in place, with Edit and resend.

## 9. Backend dependencies — several do not exist yet

A **Student Group entity** and its membership (OQ-3) · a **teacher principal** — the brief has
`learner.teacher_id` as a bare field with no actor behind it (OQ-2, AI #3's C2) · the
**approval entity and per-conversation policy** (OQ-1) · a server-enforced prohibition on
teacher ↔ parent 1:1 conversations and calls, with a stable machine-readable error code ·
**no phone numbers in any group-member payload** · group call authorization (OQ-4).
