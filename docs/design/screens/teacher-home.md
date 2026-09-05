# Screen: Teacher Home

**Priority:** P0 for mobile · **CONDITIONAL — depends on OQ-2** · **Platform:** Flutter (teacher) · **Owner:** AI #3

> **OQ-2 is unresolved:** no teacher principal exists in the brief. `learner.teacher_id` is a
> bare field. Until AI #1 decides what a teacher *is* and how one authenticates, this screen
> cannot be built — AI #3 named it *"the single largest unmodelled dependency in the mobile
> scope"* and this spec agrees.

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

## 8. Backend dependencies

**A teacher principal and its authentication (OQ-2) — blocking.** Then: the teacher's groups
with unread counts, their schedule, their Jawwid conversation, push registration, and a
server-enforced prohibition on any teacher → parent 1:1 path with a stable error code.
