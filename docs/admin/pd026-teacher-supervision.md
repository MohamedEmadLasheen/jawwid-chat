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

## Operations access (amendment 2026-10-27)

The owner opened the page to the Operations Supervision team: "they will also
use them to record teacher delays and excuses". It covers the whole page, with
the Teachers department's rights, for the teachers of their families.

**Who, for which teachers.** `TeacherScopeService.pageBases` says which bases a
caller holds, and `pageBasis` the strongest of them (the rights):

| Basis | Who | Which teachers |
|---|---|---|
| `super_admin` | the super admin | every teacher |
| `teachers` | the Teachers department (role re-checked as PD-12) | PD-35's scope, as before |
| `operations` | an Operations member (admin, coverage) or the Operations manager, of their own organization's department | `chat.operations_teacher_ids`: the current teacher of each of `chat.operations_learner_ids` (learners whose PD-8 supervisor is in `chat.staff_principals`: themself, an active backup cover, a managed department's members), and the teacher of each of their lessons from `chat.operations_lesson_window()` (30 days) ago on |

The window lets a substitute (a former teacher, after a transfer) be recorded on
while their lessons are recent; after 30 days they drop out. A lesson called off
or never stood (`admin_cancelled`, `rescheduled`, `student_apology`,
`suspended`, `voided`) ties nobody; a teacher's own apology or no-show does.

Someone holding both bases gets the Teachers department's rights and both sets
of teachers. (One department per staff member, so in practice that is a manager
of both, whose Teachers scope is already every teacher.) An out-of-scope teacher
answers 404, like an unknown one.

**Down to the child** (`pageRowsOf`, `pageRowVisible`). A teacher reached only
through Operations shows their teacher-level rows whole: leave, suspensions, an
absence with no lesson, a management complaint. Of their rows about one child
or family, only the caller's own show: held lessons in the lateness picker,
lateness and lesson-linked violations, complaints from a parent (the family of
the PD-32 feedback, or of the conversation it was taken from), parent feedback.
Writing on another family's lesson or complaint (lateness, deciding, a
follow-up, upholding, take, reply) answers 404. The ladder's count stays the
teacher's: it includes the rows the caller does not see. In a leave request's
colliding lessons, another family's child is not named.

**Leave allowance.** The allowance, the days used, the balance and the
allowance history are the Teachers department's. The server leaves them out
(absent, not null) for a teacher the caller reaches only through Operations, in
the overview, one teacher's leave, and a request's balance. Admin Web drops the
column.

**Routes that admit Operations** (each narrowed by `pageScopeOf`):

- Leave: `GET /teacher-leave-overview`, `GET /teacher-leave-requests`, approve /
  decline / cancel a request.
- Discipline: `GET /discipline/violations`, decide, `POST /lessons/:id/lateness`,
  `POST /teachers/:id/absences`, `POST /discipline/complaints/:id/uphold`,
  `GET /teachers/:id/discipline`.
- Complaints and rewards: `GET /teacher-files/complaints`,
  `POST /teacher-files/:id/entries` (only `complaint`, `complaint_followup`,
  `complaint_resolution`), `GET /teacher-files/rewards` (no amounts),
  `POST /teachers/:id/bonus` (without an amount).
- Parent feedback: `GET /parent-feedback`, take, reply.
- New, for every basis: `GET /teacher-supervision/directory` (the caller's
  teachers, who is away, and who may handle a complaint) and
  `GET /teacher-supervision/teachers/:id/held-lessons?kind=regular|trial` (the
  lateness picker; Operations does not read Sales' trial lists).
- `GET /lessons/access` adds `supervisionPage`.

**Unchanged and refused to Operations.** `GET /teacher-files` (the Teacher Files
list) and a file's detail; personal record; monthly comments and days off;
the leave allowance; every `/teacher-files/:id/finance*` route; deduction
defaults; `POST /teacher-files/:id/rewards` (a reward WITH an amount); PD-11's
timeline and supervision chat.

**Money.** Nothing about money changes. An Operations supervisor records a
reward without an amount, and decides a deduction without naming one. A
decided deduction is priced from the super admin's default (PD-26), exactly as
when the Teachers department decides it. Amounts are shown to the super admin
only.

**Database.** `chat.may_supervise_teacher(staff, teacher, org)` is
`chat.is_lesson_manager` OR the teacher is in `chat.operations_teacher_ids`. It
replaces `is_lesson_manager` in the guards of: an absence or upheld complaint
recorded, a violation decided, a suspension, a supervision entry, PD-32's take
of an app complaint, and a complaint's handler. For a row about one child,
`chat.may_supervise_learner_row(staff, teacher, learner, org)` also needs the
child to be the caller's (`chat.operations_learner_ids`): lateness on a lesson
(`guard_teacher_violation`) and a reply to a parent (`guard_parent_feedback`).

**Admin Web.** The Teachers entry is offered when `GET /lessons/access` says
`lessonManager` or `supervisionPage`. Without `lessonManager` it leads to
`/teachers/supervision`, the tab strip shows Supervision only, and teacher names
are not links to Teacher Files (`TeacherName`, `useOpensTeacherFiles`).

**Rights per teacher.** Someone holding both bases has the Teachers
department's rights (monthly comments, days off, the allowance, the Teacher
File) only for teachers in its PD-35 scope (`whole`); for teachers it reaches
only through Operations, Operations' rights. `TeacherFileService.requireTeacher`
resolves the Teachers scope for the Teacher File's routes and the page scope
(`'page'`) for the page's.

**A parent's complaint** (`complaintAbout`): management's is teacher-level; a
parent's is about the family of its PD-32 feedback or of its source
conversation. When that family is unknown, an Operations-only caller does not
see it and cannot follow it up, resolve or uphold it (404). Operations files a
parent's complaint only with `sourceConversationId`, a conversation with one of
its own families. Admin Web's complaint dialog asks for it ("Family chat it came
from") when the directory marks the teacher `operationsOnly`; the directory's
`familyChats` lists the caller's own families' student groups.

**Known limits (recorded).** The database confines Operations to its own
families for lateness and replies to a parent only; a complaint's follow-up,
resolution, upholding, take and handler are per teacher in the database and
per family in the server. A leftover lesson of a family (an open lesson the
previous teacher kept after a transfer) keeps that teacher in scope until it
is 30 days past or closed.

**Known effects.** A suspension decided by an Operations supervisor cancels the
lessons in its window through `LessonService.cancel` as that supervisor. A
lesson of a family they do not supervise is not cancelled; it is reported back
and stays on the Teachers department's needs-action list, as any lesson that
cannot be cancelled.

