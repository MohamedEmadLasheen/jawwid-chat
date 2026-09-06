# Screen: Student Group

**Priority:** **P0 — PRD MVP scope** · **Platform:** Flutter (parent + teacher) · **Owner:** AI #3

> **Student Groups are MVP** (`docs/qa/authoritative-scope.md` §3). They are the **only**
> permitted Teacher↔Parent communication path — **BR-1**.
>
> **Corrected on review.** An earlier revision framed this screen as conditional on the brief's
> one-thread-per-family model and recommended a data shape. Both are **withdrawn**: the brief's
> communication chapter is superseded, and the conversation model is correction **C-2** /
> **OD-01**, owned by the product owner, AI #1 and AI #2. **This pack proposes no schema.**
>
> **Implementation status is unresolved:** `docs/qa/defects.md` **JC-001** and **JC-002** record
> Student Groups as P0 and currently unrepresentable in the backend.

### Cardinality the interface requires — a restatement of PRD scope, not a design decision

| Concept | Is | Cardinality |
|---|---|---|
| **Family** | the customer / account context — the unit of ownership and of the admin inbox row | 1 |
| **Student** | the learner | **1..n per family** |
| **Student Group** | the official communication channel **for that student** | **exactly 1 per student → 1..n per family** |

**A family with two students has two Student Groups**, concurrently, with distinct membership —
different teachers, potentially different authorised contacts. Neither is a view of the other,
and neither is a view of the parent↔admin conversation.

*One family, one Primary Owner* is a statement about **ownership**, not about conversation
count. Conflating the two axes is what produced `thread.family_id UNIQUE`
(correction **C-2**, defect **JC-002**).

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
**Secondary:** attach · voice note · reply · react · group info · group call.

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
opens **Group info**: the student, the teacher(s), the family contacts, and the admin. Members
show **name, role and avatar only. Never a phone number, never an email** (DQ-04).

> **Open — OD-03 / OQ-8.** BR-1 permits Teacher↔Parent communication *"through the official
> Student Group, with the required admin presence/authorization."* **What "required admin
> presence" means is an open product decision** (`docs/product-operations/open-decisions.md`
> OD-03): an admin as a permanent member, a member who is also on duty, visibility without
> membership, or approval substituting for presence.
>
> The spec currently renders the admin **conditionally** — present in the header and member list
> when the server reports one. **If OD-03 lands on permanent membership, this becomes
> unconditional**, and the header always names an admin. That is a one-line change here and a
> significant one for the backend; it is flagged rather than assumed.

**Membership is not editable by parents or teachers.** No add, no remove, no leave. The group
exists because the student exists.

## 3. Messages

Standard bubbles with the author's name and role (*Teacher* / a parent's relationship /
*Jawwid*). Group system cards: a teacher change, a schedule change, a student's level change,
call started/ended.

**Approval states** *(see `screens/approvals.md` §5)*:

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
| Parent contact with `can_message` | Read, send, attach, voice, reply, react, join a group call |
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

## 9. Backend contract required

| # | Requirement | Owner |
|---|---|---|
| G1 | A **Student Group** entity and membership, supporting **one group per student** and therefore several concurrent groups per family | AI #1 / AI #2 (C-2) |
| G2 | A **teacher principal** — see `screens/teacher-home.md` §8 (C-1 / OD-04) | AI #1 |
| G3 | Group membership that **follows the teacher↔learner assignment automatically**. A teacher change that does not update membership is a privacy incident, not a data gap | AI #1 (OD-04) |
| G4 | **BR-1 enforced server-side** on a single *(actor, conversation, channel)* path covering messaging **and** calling, with a stable machine-readable error code | AI #1 (C-2 / JC-002) |
| G5 | A resolution of **"required admin presence"** (OD-03) | product owner |
| G6 | Approval state + per-conversation policy — `screens/approvals.md` §9 | AI #2 |
| G7 | Group call authorization — `screens/call.md` §8 | AI #1 |
| G8 | **No phone number in any group-member payload** | AI #1 |

None of these is designed here.
