# PD-24: the Teacher Supervision page

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-24.
Migration: `supabase/migrations/20261022150000_chat_pd024_teacher_supervision.sql`.
Tests: `apps/api/test/integration/pd024-teacher-supervision.spec.ts`,
`apps/admin-web/src/features/teacher-supervision/TeacherSupervision.test.tsx`,
`test/features/messages/teacher_away_banner_test.dart`.

One Admin Web page, **Teachers › Supervision** (`/teachers/supervision`; the super
admin's `/admin/teachers/supervision`), with five sections in the URL
(`?section=leave|absences|lateness|rewards|complaints`). The old
`/teachers/leave` and `/teachers/discipline` links redirect to their section.

Each section is a view over records that already existed. PD-24 adds only what
was missing.

| Section | Reads | Writes | New in PD-24 |
|---|---|---|---|
| Leave | `GET /teacher-leave-overview`, PD-12's leave requests | approve / decline / cancel (PD-12) | the overview; "on leave" status everywhere; assignments refused |
| Apologies & absences | `GET /discipline/violations?kind=absences` | decide (PD-12); `POST /teachers/:id/absences` | absence with no lesson |
| Lateness | `GET /discipline/violations?kind=late` (split by `lesson.kind`) | `POST /lessons/:id/lateness` (trials too) | trial / regular split; trial lateness from the dialog |
| Grants & rewards | `GET /teacher-files/rewards` | PD-11's bonus + PD-18's amount; `POST /teacher-files/finance/deduction-defaults` | the list; amount while recording; default deductions |
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

Complaints recorded before PD-24 have no source or handler.

## Known limits

- Recording a reward with an amount is two requests: the bonus, then its
  amount. If the second fails (for example, no pay terms that month), the reward
  stays recorded and the dialog says to set the amount in Payroll.
- PD-11's `POST /teachers/:id/supervision` can still write a complaint without a
  source; Admin Web uses the Teacher File route, which requires one.
- The parent-app banner reads the conversation's member list once, when the chat
  opens. It does not update live.
