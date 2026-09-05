# Screen: Family 360 (side panel)

**Priority:** P0 · **Platform:** Admin Web · **Owner:** AI #4

---

## 1. Role and purpose

**Roles:** admin · coverage · manager.

**Purpose:** *"who is this family, and what is true about them right now?"* — answered without
asking, without clicking, and without leaving the conversation.

The panel is **always visible** alongside the thread (brief §8). It is not a drawer you open when
you get curious; it loads with the family. An admin replying to a parent must be able to see the
student's next class without navigating anywhere (journey J2).

**Entry points:** it appears whenever a family is selected. No independent entry.

**Primary action:** none — this panel is for *reading*. Its actions are secondary by design;
the primary action on this screen is always the reply in the centre pane.
**Secondary:** change owner *(manager)* · pin a note · open a case · open a task · view the full
timeline · call *(OQ-4)*.

## 2. Layout

400px fixed (420px ≥ 1920, 360px at 1280). Scrolls independently of the thread. Sections in
this fixed order — the order is the hierarchy, and it does not reorder per family:

```
┌───────────────────────────────┐
│ 1  Responsibility             │  owner, on duty, coverage, tier, state
│ 2  Students                   │  next class is the highest-value fact here
│ 3  Subscription               │
│ 4  Contacts                   │
│ 5  Pinned notes               │
│ 6  Open tasks                 │
│ 7  Recent cases (5)           │
│ 8  Timeline  →                │
└───────────────────────────────┘
```

Sections 5–7 collapse when empty (they say so in one muted line); sections 1–4 never collapse —
a missing responsibility block reads as a bug, not as an absence.

## 3. Section 1 — Responsibility

The most important block in the admin product.

```
Owner            Admin A                       [Change owner]   ← manager only
On duty          Coverage B  · Covering                          ← only when ≠ owner
                 Until 23:00 · covering for Admin A
Tier             Priority · long-standing customer
State            At risk · payment failed 2 days ago
```

- **Owner is a permanent row.** It is present for every family in every state, including
  unattended (DD-02).
- **On duty is an additional row**, present only when it differs. It carries the `ModeBadge`,
  the window it applies to, and who it is covering for. The phrase is *"covering for Admin A"*,
  never *"assigned to Coverage B"* (`terminology.md` §1).
- **Unattended** renders here as a `status.danger` row — *"No one is on duty for this family"* —
  **manager only**. An admin must never see it, because it would read as an invitation to act
  outside `on_duty()`.
- **Tier** and **state** always show their reason (`tier_reason`, `state_reason`). A state
  without a reason is a label; a state with a reason is information.

## 4. Sections 2–4

**Students** — per learner: name, level, teacher, **next class** (relative if within 24h:
*"in 40 minutes"*), last attended, consecutive absences. Three or more consecutive absences
renders in `status.warning` **with the word "absences"**, never colour alone.
*Next class is the single most-used fact in this panel* — it is the first line of each student
card, not buried in a detail row.

**Subscription** — plan, status, ends, renewal due (relative when within the config window),
last payment status + date. A failed payment renders `status.danger` with the word "failed".
Money is right-aligned and LTR in both locales.

**Contacts** — name, relationship, and **role preset** with the six capability flags on hover or
expand. Flags are the truth; presets are display sugar (AI #5 §2). `is_active=false` contacts
render muted at the end of the list.
**No phone numbers. No email addresses. Ever.** (DQ-04). If a contact cannot be reached in-app,
that is a product problem to solve in-app.
**Backend dependency:** preset ↔ flag mapping is unpublished (OQ-5); until it lands, presets
render from the server's own label, never derived client-side.

## 5. Sections 5–8

**Pinned notes** — violet block treatment, same as internal notes, with author and date. Pin and
unpin inline. This is where "always tell this parent about invoices in writing" lives.

**Open tasks** — `TaskCard`s: title, type, assignee, due. Overdue shows `status.danger` fg,
an icon, **and the word "Overdue"**.

**Recent cases** — the last five, resolved and closed included, each with `StatusBadge`, type
and dates. "Same case type within 30 days" is an attention signal, so a repeat renders with a
quiet **Repeat** marker — the admin should see the pattern the score already saw.

**Timeline** — a link to the full unified timeline, not the timeline itself. Section 8 shows the
last three events as a preview.

## 6. Family timeline (expanded view)

Opens as a wide overlay over the workspace, or a full screen below 1024px.

One vertical rail, chronological, newest first, with a filter bar:
**All · Conversation · Cases & tasks · Ownership & coverage · Billing · System**.

| Event | Marker | Colour |
|---|---|---|
| Message (customer-facing) | filled dot | `text.secondary` |
| **Internal note** | **hollow dot** | **violet** |
| Case opened / changed / resolved | filled square | case status colour |
| Task created / completed | filled square | `text.secondary` |
| Follow-up created / due | filled square | `status.warning` when overdue |
| Handover | filled diamond | `status.info` |
| Coverage changed | filled diamond | `status.info` |
| **Owner changed** | **filled diamond, larger** | `brand.primary`, always with the reason |
| Payment / renewal | filled square | success or danger |
| Schedule / teacher change | filled square | `text.secondary` |
| Approval decided *(OQ-1)* | filled square | success or danger, always with the reason |
| Call *(OQ-4)* | filled circle-outline | `text.secondary` |
| System | filled dot | `text.muted` |

**Customer-facing and internal events share the rail but never the marker or the colour.** A
filled marker means the family could see it; a hollow violet marker means they could not
(DD-05, risk R3). That distinction is the timeline's entire job beyond chronology.

## 7. States

- **Loading** — skeletons matching each section's shape, in order. Sections do not pop in
  individually; the panel resolves as one, because a panel that assembles itself in six stages
  is more distracting than a 400ms wait.
- **Empty family** (no students, no subscription) — each empty section renders one muted line:
  *"No students recorded."* The responsibility block is never empty.
- **Error** — the panel shows its own error with Retry; the thread stays usable.
- **Partial** — if one section's data is unavailable, that section shows its own inline error.
  One failing section never blanks the panel.
- **Permission denied** — the whole family surface shows the single generic message; the panel
  renders nothing.

## 8. Responsive

≥ 1280 always visible · 1024–1279 right drawer, toggled from the conversation header, open/closed
state persists per user · < 1024 full-screen modal from a **Family** button.

## 9. RTL

The panel sits on the reading-start-opposite side (left in Arabic). Labels lead, values trail.
The timeline rail moves to the reading-start edge and markers stay on it. Dates and money remain
LTR runs. Relative times localise. Chevrons mirror.

## 10. Edge cases

- **6 contacts, 4 students** — sections 2 and 4 cap at 3 visible with a *"Show all"*; the panel
  must not become a scroll maze (role brief §51).
- **Owner changed while open** — the responsibility block updates and a timeline event appears.
- **Coverage window ends while open** — the on-duty row updates live; if it disappears (owner is
  back), line 3 is removed, and the owner row was there the whole time.
- **Unattended appears while open, admin is viewing** — nothing changes for the admin; only the
  manager's view gains the row.
- **A family with no owner** — impossible by invariant (`owner_id NOT NULL`). If it ever
  happens, the row shows *"Owner missing"* in `status.danger` rather than an empty space, and
  it should page someone.

## 11. Backend dependencies

`GET /families/:id` returning the **entire panel in one call** — separate calls per section
would produce the staged assembly this spec forbids · `GET /families/:id/timeline` (cursor,
filterable) · `GET /families/:id/transfer-impact` · `POST /families/:id/transfer-ownership` ·
`POST /families/:id/notes` · realtime `ownership.changed`, `coverage.changed`, `case.updated`,
`task.updated` · preset ↔ flag mapping (OQ-5).
