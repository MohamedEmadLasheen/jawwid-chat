# Screen: Admin Inbox

**Priority:** P0 · **Platform:** Admin Web · **Owner:** AI #4

---

## 1. Role and purpose

**Roles:** admin (owner) · coverage · manager.
Not accessible to finance / technical / academic — they get `screens/tasks.md` instead.

**Purpose:** answer *"which family needs me now?"* without opening a single family.

This is the product's home screen and its most-used surface. Everything else is downstream of
getting this list right.

**It is a list of families, not tickets** (brief §8, `decisions.md` DD-01). One family = one row,
always, everywhere.

**Entry points:** sign-in lands here · logo click · `Esc` from anywhere · every notification
deep-link passes through it.

**Primary action:** open a family (click, or `Enter` on the focused row).
**Secondary:** search · filter · "This order is wrong" · snooze from the shift banner ·
acknowledge a handover.

## 2. Layout

Three panes at ≥ 1280px. This screen owns the left rail and the list; opening a family fills
the workspace and family panel (`screens/admin-conversation.md`, `screens/family-360.md`).

```
┌──────┬───────────────────────┬────────────────────────────┬──────────────────┐
│ Rail │  Inbox list  (380px)  │  Conversation workspace    │  Family 360      │
│ 240  │                       │  (flex)                    │  (400px)         │
│      │  ┌ search ──────────┐ │                            │                  │
│      │  │ filter chips     │ │  empty until a family is   │  empty until a   │
│      │  ├──────────────────┤ │  selected                  │  family is       │
│      │  │ ▸ banners        │ │                            │  selected        │
│      │  │ NOW          (3) │ │                            │                  │
│      │  │   [row]          │ │                            │                  │
│      │  │ TODAY        (7) │ │                            │                  │
│      │  │ COVERING     (2) │ │                            │                  │
│      │  │ WAITING (12) ▸   │ │                            │                  │
│      │  │ QUIET      search│ │                            │                  │
│      │  └──────────────────┘ │                            │                  │
└──────┴───────────────────────┴────────────────────────────┴──────────────────┘
```

Rail items (role-filtered, data-driven registry): **Inbox** · **My follow-ups** · **Tasks** ·
*Approvals (OQ-1)* · **Coverage** *(manager)* · **Team** *(manager)* · **Settings**.

## 3. Section order — this is the information hierarchy

Sections render top to bottom in this fixed order. **The server's order within a section is the
order shown**; the client never re-sorts by anything (brief §6, DD-03).

| # | Section | Sorted by | Default | Shown to |
|---|---|---|---|---|
| 1 | **Banners** — offline · reconnecting · end-of-shift · what happened while you were away · unattended count | — | expanded, dismissible where non-critical | all / owner / manager |
| 2 | **Now** | attention desc, then oldest wait | expanded | all |
| 3 | **Today** | due time asc | expanded | all |
| 4 | **Families I'm covering now** | attention desc | expanded when non-empty | coverage + any admin acting as backup |
| 5 | **Waiting on family** | last staff message desc | **collapsed**, count in header | all |
| 6 | **Quiet** | — | **search-only**; renders a search prompt, not a list | all |

Section headers: `type.h3`, the bucket's `attention.*.fg` colour, count in `text.muted`, and a
quiet **This order is wrong** link on Now and Today only.

Quiet is search-only by design: a scrollable list of every quiet family is a list nobody reads,
and rendering it costs the most on the largest accounts.

## 4. `ConversationListItem` — the most important component in the product

72px tall, 3 lines, `space.4` inline padding, 1px bottom `border.subtle`.

```
┌────────────────────────────────────────────────────────────┐
│ ●  Al-Farsi                                    12:04   [2] │  line 1
│    New message, waiting 6 minutes                          │  line 2
│    Covering · Yusuf · Renewal                              │  line 3 (conditional)
└────────────────────────────────────────────────────────────┘
  ↑ AttentionDot 8px            ↑ time   ↑ UnreadBadge
```

| Slot | Content | Type | Rule |
|---|---|---|---|
| Leading | `AttentionDot` | 8px | The **only** attention affordance. Never a number, never a label. |
| Line 1 start | Family name | `type.body` 600 when unread, 400 when read | Truncates at the logical end. |
| Line 1 end | Last activity time | `type.caption` `text.muted` | Relative under 24h. |
| Line 1 end | `UnreadBadge` | — | `99+` cap. Omitted at zero. |
| Line 2 | **`top_reason`** | `type.caption` `text.secondary` | Server text, verbatim, always this position. Single line, truncates. |
| Line 3 | Up to **three** metadata chips, in this fixed order: mode → student → case type | `type.caption` | Line 3 is **omitted entirely** when there is nothing to say. Never a fourth chip. |

**Metadata chips**, in priority order — the first three that apply, and no more:
`ModeBadge` (Covering / Assist / Escalated / Keeping this) → response-target state (Reply time
running out / Reply overdue) → student name → open case type → `tier=priority` marker.

Everything else an admin might want is one click away in Family 360. A fourth line is how a
list becomes unreadable (role brief §22).

**States:** default · hover (`surface.muted`) · **selected** (`brand.subtle` + 3px leading
`brand.primary` edge) · focused (2px focus ring, distinct from selected) · unread (name at 600
+ badge) · loading (skeleton) · updating (no visual change — see DD-12).

**Row overflow menu** (`⋯`, appears on hover/focus): Open · Mark read · This order is wrong ·
Snooze to my next shift *(during the shift-end window)*.

## 5. Banners

| Banner | Trigger | Content | Actions |
|---|---|---|---|
| **End of shift** | `[BE]` `shift.ending`, N min before | "Your shift ends in 15 minutes. 3 families waiting, 2 follow-ups due." | **Snooze to my next shift** · Review · dismiss |
| **What happened while you were away** | owner's first load after a gap | Handover count + summaries | Expands into a list of `HandoffCard`s |
| **Unattended** *(manager)* | count > 0 | "2 families have no one on duty." | View → `screens/manager-dashboard.md` |
| **Offline / Reconnecting** | connectivity | see `cross-platform.md` §3 | — |

Banners are **in flow**, never floating over the list. At most two are visible; the rest queue.

## 6. Search and filters

**Search** (`/` focuses it) — searches family, contact and student names, and message text
`[BE]`. Results show enough context to distinguish families: family name, the student, and the
matched snippet. **Phone numbers are not a search key and never appear in a result** (DQ-04).

**Filter chips** — one row, always visible, four filters only: **Owner · On duty · Bucket ·
Case state**. Everything else (renewal, payment, student, teacher, task state, coverage) lives
behind **More filters** in a popover (role brief §43). Active filters render as removable chips
above the list with a **Clear all**.

Filtering is server-side over the full set, never client-side over a loaded page.

## 7. Interactions

| Input | Result |
|---|---|
| Click a row / `Enter` | Opens the family in the workspace + panel. The row becomes selected. |
| `j` / `k` | Move focus down / up across sections. |
| `/` | Focus search. `Esc` clears and returns focus to the list. |
| `r` | Open the family and focus the composer. |
| Scroll to bottom | Cursor-paginated fetch; a skeleton row appears while loading. |
| Realtime bucket change | **Instant swap, no animation.** If the row is *selected*, it updates in place and re-buckets on deselect (DD-12). |
| New message on a visible row | Row updates in place; unread badge increments. |

## 8. Permissions *(UX affordances only — `decisions.md` DD-17)*

| Role | Sees |
|---|---|
| admin | Own on-duty families, all sections. Can open any family and write internal notes (brief §5). |
| coverage | Same, plus the **Families I'm covering now** section. |
| manager | Everything, plus the unattended banner. |
| finance / technical / academic | **No access.** Rail does not render this item. |

## 9. States

- **Loading** — 8 skeleton rows under skeleton section headers. Never a spinner, never blank.
- **Empty, all sections** — icon, *"Nothing needs your attention."*, and the calm second line
  *"You'll see families here as they need a reply."* No action button; there is nothing to do.
- **Empty, one section** — the header stays with a count of 0 and a single muted line
  (*"No families waiting for a reply."*). Sections do not disappear; a missing section reads
  as a bug.
- **Error** — *"We couldn't load your inbox."* + Retry. Banners and rail stay usable.
- **Offline** — banner; last loaded list stays visible and readable, marked as of a timestamp.
- **Permission denied** on opening a family — *"You don't have permission to access this
  family."* and nothing more. The row remains; the workspace shows the message.

## 10. Responsive

| Width | Behaviour |
|---|---|
| ≥ 1280 | Three panes as drawn. |
| 1024–1279 | Rail → 64px icons. Family panel → right drawer, toggled from the conversation header, state persists per user. |
| < 1024 | One pane. The list is the screen; opening a family pushes; back returns with scroll position preserved. Rail → drawer. |

## 11. RTL

Panes mirror: rail on the right, list beside it, family panel on the left. Row internals mirror
(dot leads, time and badge trail). The selected-row leading edge is on the reading-start side.
`j`/`k` are unchanged — they are vertical. Section headers and counts mirror. Search icon leads.

## 12. Edge cases

- **500+ families** — the list is virtualised; section headers stick.
- **A family qualifies for two sections** — impossible by invariant; if the server ever sends
  one twice, render the higher-priority section only and log it. Never render both (DQ-08).
- **Bucket changes while the row is selected** — see DD-12.
- **All sections empty but the family count is non-zero** — this is the Quiet-only state;
  show the Quiet search prompt, not the global empty state.
- **Handover arrives while the inbox is open** — the covering section gains the row instantly
  and the count updates; no toast (a toast per handover at shift change would be a storm).
- **Very long family name** — truncates at the logical end; full name in the tooltip and in the
  accessible name.

## 13. Backend dependencies

`GET /inbox?section=` returning server-ordered rows with `top_reason` as **text or key+params**
· `GET /inbox/away-summary` · `GET /inbox/shift-banner` · `POST /inbox/snooze-to-next-shift` ·
`POST /inbox/order-feedback` · realtime `family.updated`, `message.created`, `handoff.created`,
`shift.ending`, `unattended.changed` · `GET /config` for every threshold.

The client never computes a bucket, an order, or an attention value.
