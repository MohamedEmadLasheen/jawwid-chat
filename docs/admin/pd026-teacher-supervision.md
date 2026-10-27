# PD-26: the Teacher Supervision page

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-26.
Migration: `supabase/migrations/20261022150000_chat_pd026_teacher_supervision.sql`.
Tests: `apps/api/test/integration/pd026-teacher-supervision.spec.ts`,
`apps/admin-web/src/features/teacher-supervision/TeacherSupervision.test.tsx`,
`test/features/messages/teacher_away_banner_test.dart`.

One Admin Web page, **Teachers › Supervision** (`/teachers/supervision`; the super
admin's `/admin/teachers/supervision`), with five sections in the URL
(`?section=leave|absences|lateness|rewards|complaints`). The old
`/teachers/leave` and `/teachers/discipline` links redirect to their section.

Each section is a view over records that already existed. PD-26 adds only what
was missing.

| Section | Reads | Writes | New in PD-26 |
|---|---|---|---|
| Leave | `GET /teacher-leave-overview`, PD-12's leave requests | approve / decline / cancel (PD-12) | the overview; "on leave" status everywhere; assignments refused |
| Apologies & absences | `GET /discipline/violations?kind=absences` | decide (PD-12); `POST /teachers/:id/absences` | absence with no lesson |
| Lateness | `GET /discipline/violations?kind=late` (split by `lesson.kind`) | `POST /lessons/:id/lateness` (trials too) | trial / regular split; trial lateness from the dialog |
| Grants & rewards | `GET /teacher-files/rewards` | `POST /teacher-files/:id/rewards {reason, amount}` (super admin, one transaction); PD-11's `POST /teachers/:id/bonus` without an amount; `POST /teacher-files/finance/deduction-defaults` | the list; amount while recording; default deductions |
| Complaints | `GET /teacher-files/complaints?from=` | entries `complaint` / `complaint_followup` / `complaint_resolution`; `POST /discipline/complaints/:id/uphold` | source, handler, follow-ups, uphold, status |

## Away ("on leave")

`chat.teacher_away(teacher, day)` returns what keeps the teacher away that day
(`suspended` over `leave` over `day_off`) and the last day of the unbroken run of
days off. It is computed from PD-11's `chat.teacher_day_off`, never stored.
`chat.academy_today()` is today in `schedule.timezone`.

- Teacher Files list and detail: `away: {kind, until} | null`.
- `GET /conversations/:id` members: a teacher member who is away carries `away`.
  Staff read the kind; anyone else reads `leave` or `away`. The app draws a
  banner above the thread; **messaging is not blocked**.
- Refused while a teacher is on leave or suspended today (`COMM.LESSON_STATE`,
  naming the day they are back): `POST /learners/:id/transfer` to them, and a
  subscription form naming them. Trial booking and make-ups already refused a
  day off. A plain day off never blocks.

## Incidents that are not a lesson's

`chat.teacher_violation.lesson_id` is now null for two kinds:

- `absence`: `POST /teachers/:id/absences {occurredOn, note}`. The Teachers
  department only; the day is today or earlier; the note is required.
- `complaint`: `POST /discipline/complaints/:entryId/uphold {note?}`. Once per
  complaint (`complaint_entry_id` is unique). It counts in the month the
  complaint was made.

Both are decided like any violation (`POST /discipline/violations/:id/decide`)
and are never withdrawn by a lesson correction, because they have no lesson.

## Deductions reach payroll

`chat.teacher_pay_default (kind deduction_1|deduction_2, currency, amount)` is
append-only, and the newest row per kind and currency wins. Only the super admin
writes it (`GET/POST /teacher-files/finance/deduction-defaults`). The trigger
`chat.price_decided_deduction` runs when a violation is decided as a deduction.
It looks up the teacher's pay currency for the violation's month and inserts one
`teacher_pay_adjustment` at the default amount, created by the decider. With no
terms or no default, or a default of 0, nothing is written and Payroll lists the
deduction as unpriced, as before. The table is confined to `src/teacher-file`
like the rest of payroll.

## Complaints

`chat.teacher_supervision_entry` gained `complaint_source` (`management` |
`parent`), `handled_by` (a Teachers-department supervisor, checked by a trigger)
and the kind `complaint_followup` (`refers_to` a complaint; any number). A
complaint is still resolved once. Its status is computed:

| status | when |
|---|---|
| open | not upheld, not resolved |
| upheld | on the ladder, no decision yet |
| actioned | upheld and decided; the decision is the action taken |
| resolved | it has a resolution |

Complaints recorded before PD-26 have no source or handler.

## Known limits, closed (amendment 2026-10-26)

The three limits recorded at closing were fixed by the owner's request,
without a new PD number.

- **A reward with its amount is one act.** `POST /teacher-files/:id/rewards
  {reason, amount}` (the super admin, PD-18's finance tier) writes PD-11's bonus
  entry, its card and its Core/HR note together with the payroll row that prices
  it, in ONE transaction (`SupervisionService.bonusInTx` +
  `TeacherPayrollService.recordReward`). The month is the one the reward is
  recorded in. With no pay terms for that month the request is refused (409)
  before anything is written: there is no half-recorded reward. A reward with no
  amount stays `POST /teachers/:id/bonus` (the Teachers department), priced later
  in Payroll. `TeacherFileModule` imports `LessonModule` for this; nothing under
  `LessonModule` imports `TeacherFileModule`.
- **Every staff complaint names its source, on every route.** PD-11's
  `POST /teachers/:id/supervision {kind: 'complaint'}` now requires `source`
  (`management` | `parent`), as the Teacher File route does. Both call
  `staffComplaintSource` (`src/supervision/complaint-source.ts`); a complaint
  without one is a 400 `source: must be management or parent`. The writer handles
  it. Complaints written before the rule keep their null source and stay valid.
  `parent_app` stays the parent's own form's (PD-32).
- **The app's "on leave" notice is live, without polling.** The member list is
  read again on the conversation's realtime signals (`conversation.updated`,
  `conversation.membership_changed`) and after a reconnect (the chat realtime
  coordinator invalidates `awayTeachersProvider`, only for a chat that is open),
  when the app returns to the foreground, and once when the last day the notice
  shows is over (one timer, armed only while a notice is shown). A leave that
  cancels lessons already posts cards into the family's chat, which emits
  `conversation.updated`. A leave that starts on a later day shows when the chat
  is next opened or the app next resumes. No new server event was added.
