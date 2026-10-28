# PD-47 amendment: task priority and colour (plan)

**State:** **DRAFT for the department head's review.** No code is written. It is built after #228 (PR-1) merges.
**Claim:** `docs/product/pd-registry/PD-47-amendment-priority.md`, which amends `docs/product/pd047-tasks-plan.md`.
**Slot:** this asks for **one new slot** for **PR-1b** (§7). It does not fold into PR-2.

The owner's request (2026-10-28), relayed verbatim by the department head:

> "Tasks should be sorted so that the most important and most urgent tasks appear first, with a color-coded system... Red: High-priority tasks that are urgent and require immediate attention. Yellow: Medium-priority tasks that need attention soon but are not urgent. Green: Low-priority tasks that are less urgent and can be handled later. Tasks should be automatically ordered by priority, with the most urgent and important tasks appearing at the top of the list."

The owner's decisions (2026-10-28), relayed by the department head:
1. **A person sets the colour, and the due date can raise it.**
   - The creator picks High, Medium or Low.
   - The **effective** colour is the higher of that choice and the due-date floor: overdue, or due within 24 h → Red; due within 3 days → at least Yellow.
   - So nothing important can sit Green past its deadline.
2. **Who may change it:** the responsible manager and the super admin, the same people as for the due date. Every change goes in the history.
3. **Order inside a colour:** soonest due first (most overdue first), then tasks with no due date, oldest first.

---

## 1. Data

- **One new column**, `chat.work_task.priority text not null default 'medium' check (priority in ('high', 'medium', 'low'))`. It holds the *manual* priority only.
  - The default covers a manual task created without one, and every existing row.
  - A system task takes its source rule's priority (§5).
- **The effective priority is never stored.** It is computed at read time from `priority`, `due_at`, `state` and a reference time `as_of`, so it cannot go stale.
  - It lives in one SQL function, `chat.work_task_effective(p_priority, p_due_at, p_state, p_as_of) returns (rank int, level text, reason text)`.
  - A TypeScript mirror exists for the clients and the unit spec. A spec proves the two agree at every boundary.

| Pending task | Effective | `reason` |
|---|---|---|
| `due_at < as_of` | high | `overdue` |
| `due_at <= as_of + 24 h` | high | `due_soon` (unless the manual priority is already high) |
| `due_at <= as_of + 3 days` | the greater of manual and medium | `due_soon` if that raised it |
| otherwise, or no due date | manual | `manual` |
| completed / removed | manual (no floor: it is done) | `manual` |

`rank` is 3 for high, 2 for medium and 1 for low. "The greater" means the higher rank. `reason` is `manual` whenever the floor did not raise the level.

---

## 2. Events and the guard

- **A new event kind**, `priority_changed`, with `before { priority }` and `after { priority }`. The history trigger writes it in the same transaction, like every other change.
- **The guard counts a priority change as a recorded change.** It also bumps `activity_at` and `revision`, so the "every change is an event" rule from #228 holds.
- `task.changed` gains `change: 'priority_changed'`.
- **Who:** `POST tasks/:id/priority { priority }`, under `@Requires('tasks.manage')`. `TaskService` allows it for a decider only: the responsible manager (the line manager, or the creating manager per §3.7) or the super admin. It refuses the assignee and a teacher's supervisor, as for the due date.
- **On create:** `POST tasks` accepts `priority`, and defaults to `medium`.

---

## 3. Sort

Every pending list view (`mine`, `team`, `decisions`, `all`) is ordered **by the server**:

```
ORDER BY rank DESC,              -- red, then yellow, then green
         (due_at IS NULL),        -- dated before undated
         due_at ASC,              -- most overdue first, then soonest
         created_at ASC, id ASC   -- undated: oldest first; a total order
```

- **Stable paging.** `rank` depends on time, so the **first page fixes `as_of`** (the server's `now()`), and the cursor carries it. The cursor is `{ as_of, rank, has_due, due_at, created_at, id }`. Every later page computes the rank with the same `as_of`, so paging a list never skips or repeats a row while it crosses a boundary. A fresh load re-sorts with the new time.
- **The index.** No index can hold a time-dependent rank, so the sort is computed over the view's pending rows. Those are bounded: a person's own list is tens of rows, and the super admin's All view is the organization's pending set.
  - New partial index: `work_task_pending_due_idx on (organization_id, due_at nulls last, created_at, id) where state in ('open', 'awaiting_decision')`.
  - The existing per-assignee pending indexes gain `due_at` the same way.
  - A perf spec seeds 20,000 pending tasks and asserts the All view's first page stays under a fixed budget. The plan is read with `EXPLAIN (ANALYZE)` in the integration spec.
- **The Closed tab** keeps `closed_at DESC`. A finished task has no urgency.
- **A filter** `?level=high|medium|low` on the effective level, so each Dashboard tile has a list that equals it (§6).

---

## 4. The API shape

Each task in a list or detail response gains these fields:

```
manualPriority:    'high' | 'medium' | 'low'
effectivePriority: 'high' | 'medium' | 'low'
priorityReason:    'manual' | 'due_soon' | 'overdue'
```

Every value is computed with the response's `asOf`, which the list returns too. The clients never compute the colour themselves; they draw what the server sent.

---

## 5. System tasks: priority by source

All defaults are Medium unless the source says otherwise. The due date then raises the colour.

| Source (plan §3.6) | Manual priority | Due date | Effect |
|---|---|---|---|
| `lesson_report` | medium | lesson end + 24 h (Q10) | **Red from the moment it is created** (due within 24 h). See Q-P1. |
| `report_correction` | medium | request + 48 h | Yellow, then Red in the last 24 h |
| `lesson_ruling` | medium | ruling + 48 h | as above |
| `leave_decision` | **high** if the leave starts within 3 days, else medium | the day before the first leave day, or request + 48 h if that is earlier | |
| `violation_decision` | medium | recorded + 3 days | |
| `case` | medium | the case's `due_on` (end of that academy day), none if unset | |
| `family_unsupervised` | **high** | created + 24 h | a family nobody answers |
| `teacher_unsupervised` | medium | created + 3 days | |
| `teacher_setup` | low | the teacher's first lesson, if any | |
| `new_student_assign` | **high** | created + 24 h | |
| `new_student_group` | medium | created + 48 h | |
| `trial_outcome` | medium | trial end + 24 h | |
| `instalment_overdue` | **high** | the instalment's due date | already overdue, so Red |
| `receipt_review` | medium | uploaded + 48 h | |
| `renewal_request` | medium | requested + 48 h | |
| `certificate` | low | per PD-41 | |
| `complaint`, `parent_feedback` | **high** / medium | received + 48 h | an open complaint is the more urgent |
| `makeup_owed`, `schedule_change` | medium | the makeup window's end; request + 48 h | |

The rules live in each adapter, one value each, and the adapter spec asserts them.

---

## 6. Interface

### 6.1 Never colour alone

Every task row carries a **priority chip** with three parts:
- **an icon:**
  - High: a filled triangle with "!";
  - Medium: a clock;
  - Low: a down-chevron in a circle.
- **a text label:** High / Medium / Low, in ar: عالية / متوسطة / منخفضة.
- **when the date raised the level, a reason suffix:** "Overdue" / "متأخرة", or "Due soon" / "قريبة الموعد", with the due time beside it in the viewer's zone (12-hour).

The icon is `aria-hidden`. The chip's accessible name is the full text, for example "High priority, overdue". A 3 px leading stripe in the colour is decorative only.

### 6.2 Colour tokens and contrast

These are new design tokens. Their text and icon pairs meet **4.5:1 in light and dark** (and 3:1 for the icon and stripe as non-text):

| Level | Light: chip text / chip background | Dark: chip text / chip background |
|---|---|---|
| High (red) | `danger-700` on `danger-50` | `danger-200` on `danger-950` |
| Medium (yellow) | **`accent-700`** on `accent-50` (the gold rule: only accent-700 carries text) | neutral `text-strong` on `accent-900`, with the icon in `accent-300` (non-text, ≥ 3:1). No gold text: only accent-700 may carry it, and it fails on a dark background |
| Low (green) | `success-700` on `success-50` | `success-200` on `success-950` |

The exact hex values are picked in PR-3, and a contrast spec computes every pair against WCAG 2.1. The build fails below 4.5:1 for text and 3:1 for the icon and stripe.

### 6.3 Surfaces

- **Admin Web Tasks page (PR-3):**
  - rows in server order (the client never re-sorts);
  - the chip leads the row (on the right in RTL), and icons are not mirrored;
  - a filter by level;
  - in the detail drawer, a High / Medium / Low segmented control for deciders only, with every change in the history timeline ("priority Medium → High by …").
- **The Flutter teacher "To do" (PR-5):** the same chip as a widget, in ar and en and RTL. The teacher sees the level and cannot change it.
- **The Dashboard (PR-4 tiles, already in #228's `GET /dashboard/tasks`):** new tiles `tasks.mine_urgent`, `tasks.team_urgent` and, for the super admin, `tasks.all_urgent`. Each counts effective **High** and equals `list(view, level=high)`. The existing `*_overdue` tiles equal `list(view, overdue=true)`, a filter added beside `level`.

---

## 7. Delivery

**Recommendation: a new small PR-1b on its own slot, landing between PR-1 (#228) and PR-2.** I am not folding it into PR-2, for three reasons:
- **It is user-visible on its own.** Manual tasks get colours as soon as PR-3 ships, without waiting for the sources.
- **It is small and reviewable alone:** one column, one function, one event kind, a guard and trigger redefinition, the sort, the routes and the filter.
- **It keeps PR-2 focused** on the sources and their completion triggers. PR-2 then only sets each adapter's priority from §5.

| PR | Content | Slot |
|---|---|---|
| **PR-1b** | `priority` column; `chat.work_task_effective`; `priority_changed` in the history trigger and the guard; indexes; the sort plus `as_of` keyset; `?level=` and `?overdue=`; `POST tasks/:id/priority`; create accepts `priority`; DTO fields; the urgent Dashboard tiles; integration and unit specs | **one new slot, requested** |
| PR-2 | as planned, plus each adapter's priority and due date per §5 | `20261029170000` (as assigned) |
| PR-3 / PR-5 | the chip and the tokens, as in §6 | none |

---

## 8. Tests

- **Unit:** the TypeScript mirror of the rule at each boundary:
  - overdue by 1 s;
  - exactly 24 h, and 24 h + 1 s;
  - exactly 3 days, and 3 days + 1 s;
  - no due date;
  - each manual level;
  - a closed task.
  Its outputs are compared with the SQL function's over the same grid (integration).
- **Integration:**
  - **sort:** a mixed set in the expected order in every view;
  - **paging:** stable with `as_of` across a boundary crossing;
  - **who may change it:** the responsible manager, the creating manager and the super admin may; the assignee, a teacher's supervisor and another organization may not;
  - **history:** the `priority_changed` event is written, and a direct UPDATE of `priority` without an actor is refused;
  - **Dashboard parity:** each `*_urgent` and `*_overdue` tile equals its filtered list, for a member, a manager and the super admin;
  - **performance:** the perf budget above.
- **Admin Web (PR-3):**
  - the chip renders the icon, label and reason with its accessible name;
  - RTL renders correctly;
  - the contrast spec passes for every token pair, light and dark;
  - only deciders see the priority control.
- **Flutter (PR-5):** a widget test of the chip in ar and en, light and dark.

---

## 9. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| **Q-P1** | A lesson report is due 24 h after the lesson (Q10). By the floor rule it is **Red from the moment the lesson ends**, so a teacher's list is mostly Red right after teaching. | **Accept it.** An unfiled report is the most urgent thing a teacher owes, and the task leaves their list as soon as the report is filed. The alternative is moving the report's due date to end + 48 h: Yellow for the first day, Red only in the second. That changes Q10, so it would need the owner. |
| Q-P2 | Should "Due soon" mean within 24 h (Red) and within 3 days (Yellow), measured to the minute? Or by calendar day in the viewer's time zone? | **To the minute.** It is the same everywhere and never ambiguous across zones. The due time is shown beside the label. |
