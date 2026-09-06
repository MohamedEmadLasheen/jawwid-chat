# Screen: Coverage (shifts, rules, absences)

**Priority:** P0 · **Platform:** Admin Web · **Owner:** AI #4

---

## 1. Role and purpose

**Roles:** manager only. Admins see the *result* of coverage on their own screens; they never
see or edit its configuration.

**Purpose:** *"who is on duty, when, and where are the gaps?"*

This screen configures the three tables that `on_duty(family, now)` reads — `shift`,
`coverage_rule`, `absence`. Nothing else in the product decides who sees a message (brief §1), so
this screen is the only place where routing can be changed, and it must make its consequences
visible **before** they are saved.

**Entry points:** rail → Coverage · the dashboard's coverage section · a gap alert · a
"activate backup" prompt.

**Primary action:** resolve a gap.
**Secondary:** add/edit a shift, rule or absence · activate a backup · view the week.

## 2. Layout

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ Gaps in the next 7 days (2)                           │  ← always first when non-empty
├──────────────────────────────────────────────────────────┤
│  Current Handler right now                               │
│  Admin A → her own families · Coverage B → all owners    │
├──────────────────────────────────────────────────────────┤
│  Week grid   Sat Sun Mon Tue Wed Thu Fri                 │
│  Admin A     ▓▓▓ ▓▓▓ ▓▓▓ ▓▓▓ ▓▓▓ ▓▓▓  ·                  │
│  Coverage B   ░░  ░░  ░░  ░░  ░░  ░░ ▓▓▓                 │
├──────────────────────────────────────────────────────────┤
│  Tabs:  Shifts · Coverage rules · Absences               │
└──────────────────────────────────────────────────────────┘
```

**Gaps come first.** A configuration screen that shows its configuration before its problems is
a screen you have to audit manually. The three editors are below, because you edit them *in
response* to what the top of the screen tells you.

## 3. Gaps

Each gap is a card stating the day, the window, the cause, and one action:

| Cause | Card copy | Action |
|---|---|---|
| Absence with no backup | "Admin A is away Sunday. No backup is set." | Set backup |
| No rule covers a window | "Nobody covers Friday 22:00–23:00." | Add a rule |
| Backup is themselves absent | "Coverage B is the backup for Admin A on Tuesday, but is away that day." | Choose another backup |
| Auto-detected absence `[BE]` | "Admin A has been in shift with no activity for 45 minutes and 3 families are waiting." | **Activate backup** · Dismiss |

**Auto-detected absence never activates a backup on its own** (brief §4, MVP). The card is a
suggestion with a one-click accept, and the copy says what was observed, not what was concluded.

## 4. Week grid

Rows are staff, columns are days, filled blocks are shifts, hatched blocks are coverage windows.
Hovering a block shows who is covered and under which rule. Clicking opens that record's editor.
An **uncovered** window renders as a hatched `status.danger` block **labelled "No cover"** —
the label matters; a red gap in a grid is ambiguous, a labelled one is not.

The grid is a read-and-navigate surface, not a drag-and-drop editor. Dragging a shift is a
five-pixel mistake away from re-routing a customer's messages.

## 5. Editors

Three tabs, each a table + an editor sheet.

**Shifts** — staff, days, start, end, valid from/to.
**Coverage rules** — covering, covered *(empty = all owners)*, days, window
(`outside owner shift` / `all day` / `custom` + times), priority, valid from/to.
**Absences** — staff, from, to, backup, type (`planned` / `sick` / `auto detected`).

Every editor shows a **live preview** above its actions:

```
Preview
Coverage B will handle all owners' families
Saturday–Thursday 17:00–23:00, starting 8 September.
Overlaps: none.
```

**Conflict handling.** Overlap and priority validation is a **server** responsibility `[BE]`.
The UI submits, renders the 409's detail inline against the offending field, and does **not**
re-implement the rule — a second implementation of the coverage rules on the client is a second
source of truth and it will drift.

**No staff member is ever hardcoded.** The pickers are populated from `GET /staff`; the brief's
named roster is initial data, not structure (brief §4, DD-18).

## 6. States

- **Loading** — skeleton gaps, skeleton grid, skeleton table.
- **Empty gaps** — *"No gaps in the next 7 days."* in `status.success` treatment **with a check
  icon and the words** — this is the state the manager is looking for and it should be
  unmistakable.
- **Empty rules** — *"No coverage rules yet. Families outside their owner's shift will be
  unattended."* This empty state carries a consequence, because that one does.
- **Error** — per-section error with Retry; a failing grid does not blank the gap list.
- **Save conflict** — inline, on the field, with the server's detail.
- **Save success** — toast *"Coverage updated"* + the grid re-renders. Changes that affect
  someone on duty **right now** additionally show *"This takes effect immediately"*.

## 7. Permissions *(UX affordances only)*

Manager only. The rail item does not render for other roles. Editing writes `audit_log` with a
required reason `[BE]`.

## 8. Responsive · RTL

≥ 1440 grid and editors side by side · 1024–1439 stacked · < 1024 the grid becomes a per-day
list, because a 7-column grid on a narrow screen is unreadable and a horizontally scrolling
schedule is worse.

**RTL:** the week grid runs right-to-left with Saturday at the reading start. Times inside cells
stay LTR (`17:00–23:00`). Day headers mirror. **The time axis does not invert** — 17:00 is still
before 23:00 within a cell (`cross-platform.md` §4).

## 9. Edge cases

- **Two rules, same priority, same window** — server 409; the UI shows both rules and asks which
  wins, rather than picking.
- **A rule pointing at an offboarded staff member** — flagged as an orphaned rule in gaps, which
  is exactly what one-click offboarding is specified to produce (brief §8).
- **An absence in the past** — read-only, greyed, kept for the audit trail.
- **Editing a rule that is active right now** — a confirmation naming how many families move,
  and when.
- **DST / clock change** — times are wall-clock in Africa/Cairo; a window that would be
  ambiguous shows a warning at save time.

## 10. Backend dependencies

`GET/POST/PATCH/DELETE /coverage/shifts | /coverage/rules | /coverage/absences` ·
`GET /coverage/tonight` · `GET /coverage/gaps?days=7` · `POST /absences/:id/activate-backup` ·
`GET /staff` · server-side overlap validation returning structured 409 detail ·
realtime `coverage.changed`, `unattended.changed`.
