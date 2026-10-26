# PD-38: the scheduling calendar

The academy's class schedule for the administration: day, week and month views
over every teacher, with shifts, empty in-shift time, supervisor colors,
combinable filters and a statistics bar. Approved by the department head on
2026-10-26. P1 is the API and the Admin Web academy view. P2 is the teacher's
own calendar in the app and on the teacher web portal.

## Rules

- **The source is the lessons system.** The calendar reads `chat.lesson` rows
  (PD-11 materialized lessons, PD-15 outcomes, PD-31 moves, PD-30 holds), PD-26
  leave and days off, and PD-11 availability. It never expands weekly slots
  itself.
- **Categories.**
  - *Full shift* defaults to 12:00–19:00 and *part shift* to 14:00–18:00, both
    Saturday to Thursday. The defaults live in the config keys
    `schedule.shift.full_shift` and `schedule.shift.part_shift`.
  - Each teacher's windows can be edited, and a split shift is two windows.
  - An *hourly* teacher's working hours are their availability.
  - A teacher with no pattern yet is `unset`: their availability shows as
    working hours, and their empty time is not shown in red.
- **Patterns are effective-dated.** `chat.teacher_work_pattern` holds a
  category, a time zone and `valid_from`/`valid_to`, with
  `chat.teacher_work_window` rows for the shift windows.
  - A change starts **today or later** (academy calendar). It closes the
    pattern in force on that day, so a past month keeps the shift it was
    worked under.
  - A change may not start before the latest pattern began.
  - "Also make these the bookable hours" is offered only for a shift that
    starts today, because bookable hours change at once. The shift and the
    hours are written in **one transaction**.
- **Working hours keep their history.** Availability is still replaced as a
  whole (PD-11), but a trigger archives the removed rows with the span they
  were in force (`chat.teacher_availability_archive`). The capacity reads the
  version in force on each day, so a past month's numbers do not move when
  the hours change. Days before the first recorded version use that first
  version.
- **Teachers who left.** After `left_at`, a teacher has no shift or hours, so
  no red empty time. A teacher who is inactive with no leaving date is not
  listed.
- **What fills a shift.** The shift is split into four parts, in this order:
  1. *Booked*: any lesson reserved for a student, whatever its outcome.
     Trials count; overlapping lessons are merged, so nothing is counted twice.
  2. *Paused*: a suspended lesson, either a staff suspension or a PD-30
     payment hold.
  3. *Leave*: approved leave and days off.
  4. *Empty*: what is left. This is the calendar's red.

  Booked time outside the shift is *outside* and is shown apart.
  `utilization = in-shift booked ÷ (shift − in-shift leave)`.
- **One definition per number.** `chat.calendar_capacity(org, teachers,
  from, to, zone)` computes everything above per teacher and per day of the
  viewer's zone, with multirange arithmetic, so DST is handled. The calendar's
  red blocks, the month cells, the statistics bar and the Teacher File's
  workload all read it.
  - The workload is one partition:
    `available = bookedWithin + pausedWithin + free`, plus `outside`.
  - `scheduledMinutes` keeps its PD-11 meaning (every lesson), so
    available − scheduled is not free.
  - The teacher's own `GET /stats/me` workload changes with it.
- **Performance.** For a month of 100 teachers (24,800 lessons), the capacity
  alone takes about 0.2 s, and stats and the month summary well under a second
  (measured in the integration spec).
  - Each read is **one statement**, so the capacity is computed once.
  - JIT is off for the capacity function.
  - The PD-30 superseded-hold check runs only for system holds.
- **Filters.**
  - *Teacher-level* filters (teacher, category, utilization band, empty hours)
    choose the rows.
  - *Lesson-level* filters (supervisor, student, status, kind, time of day)
    choose the highlighted lessons and the teaching numbers. Lessons that don't
    match are shown as "other bookings".
  - **Capacity always counts every lesson of a shown teacher.** `onlyMatching`
    (default on) hides teachers with no matching lesson.
- **Supervisor colors.** `chat.staff_calendar_color` stores one key from a
  palette of 12 for each Operations supervisor or the Operations Manager.
  The Operations Manager or the super admin sets it. No staff name appears in
  source code (G-20).

## Who sees what

| Viewer | Calendar | Children's names | Shifts | Colors |
|---|---|---|---|---|
| Super admin | academy | all | edit | edit |
| Teachers Manager | academy | all | edit | — |
| Teachers department member | academy (PD-35 will narrow this to assigned teachers) | all | — | — |
| Operations Manager | academy | all | — | edit |
| Operations supervisor | academy capacity | own children only; other lessons are anonymous colored blocks | — | — |
| Teacher, parent, Sales | refused (`COMM.LESSON_DENIED`) | | | |

An Operations supervisor who filters by a child outside their scope gets
`COMM.LESSON_NOT_FOUND`. `GET /lessons/access` returns `calendar: true` to
everyone in the first five rows.

## API

All reads take `from` and `to` as days in the academy's zone (`to` is
exclusive; the window is at most 42 days). They also take the filters
`teacherIds`, `categories` (`full_shift,part_shift,hourly,unset`),
`supervisorIds` (uuids, or `none`), `learnerIds`, `statuses`
(`active,trial,paused,moved`; the default leaves out `moved`), `kinds`,
`weekdays` (ISO), `timeFrom`, `timeTo`, `utilization` (`lt50,50to80,gte80`),
`emptyMinutesGte` and `onlyMatching`. Lists are comma-separated.

| Route | Returns |
|---|---|
| `GET /calendar/options` | zone; viewer `{staffId, scope, canEditShifts, canEditColors}`; palette; teachers (with their current category); Operations supervisors with `colorKey`; the learners the viewer may filter by |
| `GET /calendar` | `teachers[]` (category, totals, utilization); `days[]` per teacher and day: `shift`, `work`, `leave`, `empty`, `free` as `[[from, to], …]`; `lessons[]` (status, `colorKey`, `matches`, `outsideShift`; named or `anonymous`) |
| `GET /calendar/summary` | `teachers[]`, plus `cells[]` per teacher and day: minutes, utilization, lesson and match counts |
| `GET /calendar/stats` | `teaching {lessons, bookedMinutes, heldMinutes}`; `students {distinct, trial, paused}`; `capacity {…minutes, utilization}`; `teachers[]` |
| `GET /teachers/:id/work-pattern` | `today` (the earliest start), patterns newest first, and the category defaults. A change's `reason` is shown to the Teachers department and the super admin only |
| `POST /teachers/:id/work-pattern` | `{category, timezone, validFrom, windows?, reason?, applyToAvailability?}`. For a shift, `windows` defaults to the category's default. `applyToAvailability` (default on) also makes the shift the bookable hours |
| `POST /org/staff/:id/calendar-color` | `{colorKey}`, or `null` to clear it |

## Admin Web (`/schedule`)

- **Navigation:** offered under People when `GET /lessons/access` says
  `calendar`. The super admin has it beside the portal's sections.
- **Views:**
  - Day: teacher rows × hours.
  - Week: Saturday–Friday, each cell a strip of that day.
  - Month: teacher × day heat cells from `/calendar/summary`; clicking a
    cell opens that day.
  - Times are on the academy's clock and labelled as such.
- **One state, in the URL:** the view, the date and every filter, so a
  filtered view can be shared. The calendar and the stats bar send the same
  query string.
- **Operations supervisors** open on their own students (`supervisorIds`
  defaults to them once per visit). Clearing the filter shows the academy.
- **Built in-house**, with no calendar library:
  - CSS grid with logical properties, so `dir="rtl"` mirrors the time axis;
  - rows use `content-visibility: auto`, so 100+ teachers stay cheap.
- **Legend**, matching the owner's reference:
  - supervisor chips (clicking one filters);
  - a red outline for empty time, grey for outside the shift, hatching
    for leave;
  - solid, dashed or dotted borders for active, trial or paused lessons.

  Every state is a shape as well as a color.
- **Palette:** `features/schedule/palette.tsx` holds every fill, border and
  text color for light and dark, and generates the CSS. `palette.test.ts`
  measures each one: text at least 4.5:1, borders at least 3:1.
- **Teacher File → Shift:** the category and windows by day, plus
  history. The Teachers Manager and the super admin can change it.
- **Organization → Operations → Schedule colors:** a swatch per supervisor.
  The Operations Manager and the super admin can change it.

## Rollback

`db/rollback/20261026210000_pd038.down.sql` drops the patterns and the colors.
Lessons, availability and leave are untouched.
