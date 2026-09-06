# Screen: Teacher Home

**Priority:** **P0 — PRD MVP scope** · **BLOCKED on OQ-2 / C-1 / OD-04** · **Platform:** Flutter (teacher) · **Owner:** AI #3

> **The Teacher mobile app is MVP** (`docs/qa/authoritative-scope.md` §3).
>
> **It is blocked, and the blocker is not a design question.** No teacher principal exists:
> `chat.staff.role` does not include a teacher, and `chat.learner.teacher_id` is a bare `uuid`
> with no FK and no identity behind it. This is correction **C-1** (owner: AI #1) and
> **OD-04** (owner: product owner + AI #1).
>
> **This pack does not propose a teacher identity model** — not a `chat.teacher` table, not a
> role-enum extension, not a Core mirror. Domain authority belongs to the System Architect /
> Backend / Integration Commander. §8 states only what the **interface** requires, observably,
> from whatever model is chosen.

---

## 1. Role and purpose

**Role:** teacher.

**Purpose:** *"what do I need to communicate today?"*

A teacher's app is **not** a smaller version of the admin app. They see their own groups and
their conversation with Jawwid. They do not see families they do not teach, ownership, coverage,
workload, attention, cases, or any operational metric (role brief §17).

**Entry points:** app launch · Home tab · a notification.

**Primary action:** open the group that needs a message.
**Secondary:** message Jawwid · view today's classes.

## 2. Navigation

Bottom tab bar, **3 tabs** — deliberately one fewer than the parent's (DD-08):
**Home · Groups · Settings**.

There is no "Families" tab, no directory, and no search across students a teacher does not
teach. A teacher's world is their groups.

## 3. Layout

```
┌──────────────────────────────────────┐
│  Today                               │
│  09:00  Yusuf · Level 3      ▸       │
│  11:00  Layla · Level 1      ▸       │
├──────────────────────────────────────┤
│  Needs a reply              (2)      │
│  Yusuf's group · 2 unread    ▸       │
│  Sara's group  · 1 unread    ▸       │
├──────────────────────────────────────┤
│  Jawwid                              │
│  Message the Jawwid team      ▸      │
└──────────────────────────────────────┘
```

**"Needs a reply" is unread-driven only.** It is *not* the attention model — no buckets, no
`top_reason`, no response targets, no ordering by a score. A teacher's list is sorted by time.
Importing the operational attention model into the teacher app would leak the staff-side
machinery into a surface that has no use for it (DQ-01).

Empty sections are omitted, not shown empty.

## 4. Permissions *(UX affordances only)*

| Sees | Never sees |
|---|---|
| Their own Student Groups | Any family they do not teach |
| Their students' names and levels | Ownership, on-duty, coverage |
| Their own schedule | Attention, buckets, `top_reason`, response targets |
| Their conversation with Jawwid | Workload, dashboards, other teachers |
| Approval state of **their own** messages *(OQ-1)* | Internal notes, cases, tasks, phone numbers |

**No affordance anywhere starts a private conversation with a parent** (role brief §18). Not
from a group, not from a member profile, not from a student, not from search.

## 5. States

- **Loading** — section skeletons.
- **Empty, no classes today** — *"No classes today."* Calm, no action.
- **Empty, nothing unread** — the section is omitted entirely.
- **Empty, brand new teacher** — *"Your groups will appear here once students are assigned."*
- **Error** — per-section retry.
- **Offline** — banner; cached content with an *"as of"* stamp.

## 6. Responsive · RTL · Accessibility

As `parent-home.md` §9. Class times are LTR runs inside Arabic rows. Unread counts appear in
each row's accessible name. Chevrons mirror.

## 7. Edge cases

- **A teacher with 30 groups** — the unread section caps at 5 with *"Show all"*; the full list
  lives in the Groups tab with search **scoped to their own groups only**.
- **A class starting now** — the row reads *"Starting now"* and sorts to the top of Today.
- **A teacher removed from a group mid-day** — the group leaves the list; history remains
  readable from the Groups tab until access is revoked `[BE]`.
- **A teacher who is also a parent at Jawwid** — out of scope for MVP; flagged so it is a
  decision rather than a surprise. It would require two principals or a role switcher.

## 8. Backend contract required — what the design needs from the teacher model

**Requirements, not a design.** Each row is an observable property the interface depends on. How
it is modelled is AI #1's and the Integration Commander's to decide.

| # | Requirement | Why the interface needs it | Owner |
|---|---|---|---|
| **T1** | **Stable teacher identity** — an id that does not change across sessions, devices, or a change of the students they teach | Message authorship, group membership, unread state, push targeting and call participation all key on it. An identity that changes reassigns history | AI #1 (C-1) |
| **T2** | **Authentication** for that identity, with the same distinguishable failures as every other principal — bad credentials · account disabled · session revoked | `screens/auth.md` §3 renders a different experience for each; collapsing them strands an offboarded teacher retrying a password | AI #1 (C-1) |
| **T3** | **Authorization role**, server-asserted on every session and never trusted from local cache | The app renders the navigation the server says the principal has (`docs/mobile/decisions.md` D3). A teacher must be authorized **independently of CS staff** | AI #1 (C-1) |
| **T4** | **Jawwid Core relationship** — whether the teacher originates in Core and Chat mirrors, or Chat owns the identity, with an explicit sync direction and an explicit migration path if it changes | Determines whether the app can trust a teacher's name and student list, and what a stale read looks like on screen | product owner + AI #1 (**OD-04**) |
| **T5** | **Student assignment** — which learners a teacher teaches, and who is authoritative for that fact | Drives Teacher Home's Today list, the Groups tab, and the scope of a teacher's search. `chat.learner.teacher_id` currently has no authority behind it | product owner + AI #1 (**OD-04**) |
| **T6** | **Student Group membership derived from T5**, not maintained separately | Two sources for "who is in this group" will diverge, and the divergence is a privacy incident | AI #1 (**OD-04**) |
| **T7** | **Teacher-change and sync behaviour** — what happens to group membership, in-flight messages, pending approvals and history when a teacher is reassigned, deactivated or offboarded | `screens/student-group.md` §8 requires that **history is never truncated by a staffing change** while **send access is revoked immediately**. Those two must be separable | AI #1 (**OD-04**) |
| **T8** | **BR-1 enforced server-side** — no teacher↔parent 1:1 conversation or call may be created in either direction, with a stable machine-readable error code | The UI never offers the path; that is cosmetic, and BR-1 is a gate (`docs/qa/release-gate.md` G-01) | AI #1 (C-2 / JC-002) |

Then the ordinary surface contracts: the teacher's groups with unread counts, their schedule,
their teacher↔admin conversation, and push registration.
