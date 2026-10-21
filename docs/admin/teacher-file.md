# Teacher File (PD-10, step 1)

Status: **built, step 1 of 3** · Decision: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-10
(closed 2026-10-18)

The administration-only record of a teacher (`chat.teacher`, not `chat.staff`).
Parents and teachers never reach it. A teacher's own schedule and workload
arrive with PD-9 through their own routes, never through this one.

## What step 1 contains

| Section | Source | Status |
|---|---|---|
| Personal information: full name, phone, email, joining date | `chat.teacher.name` + `chat.teacher_file` | built |
| Assigned students | `chat.learner.teacher_id` (the academy's assignment) | built |
| Complaints, with their resolution | `chat.teacher_supervision_entry` | built |
| Monthly performance comment, versioned per month | `chat.teacher_supervision_entry` | built |
| Extra days off, with cancellation | `chat.teacher_supervision_entry` | built |
| Schedule: working hours and the next 14 days' lessons | `GET /teachers/:id/availability`, `GET /lessons?teacherId=` (PD-11) | built (2026-10-21), read-only; edits stay on the Schedules tab |
| Monthly performance: the month's KPIs beside the supervisor's comment | `GET /stats/teachers/:id?month=` (PD-11 T5) | built (2026-10-21) |
| Salary type, monthly salary, bonuses, deductions, financial summary | Jawwid Core, read-only, never stored | step 3, needs a Core API |
| Teaching market, specializations | open: Core or Chat | not decided |

The page says "Not here yet" for the later steps. It never shows a zero, and a
rate the server cannot compute yet is a dash, not 0%.

The Schedule and Monthly performance sections read the same routes as the
Schedules and Statistics tabs, so the file cannot disagree with them. In the
Teachers area they link to those tabs; the super admin's copy
(`/admin/teachers/:id`) has no such tabs and shows no links. `GET /lessons` now
gives the super admin the manager's standing (every lesson of the organization),
the same rule `AuthorizationService.lessonStanding` already applied to a single
lesson. Before, it narrowed the super admin to learners they supervise, so the
file's schedule would have looked empty.

## Who may do what

Decided by `AuthorizationService.teacherFileAccess`
(`apps/api/src/platform/teacher-file-policy.ts`). The caller resolves the
actor's relation to the organization's **Teachers** department (PD-8).

| | View | Edit personal info | Write the timeline | Finance (step 3) |
|---|---|---|---|---|
| Super admin | yes | yes | yes | yes |
| Teachers department manager | yes | yes | yes | no |
| Teachers department member (admin / coverage) | yes | no | yes | no |
| Anyone else: other managers, Operations supervisors, finance / technical / academic staff, teachers, parents | no | no | no | no |

Operations supervisors are excluded as a default adopted when PD-10 was
closed. Widening that is a new decision.

A refused caller gets `403 COMM.TEACHER_FILE_DENIED` **before** any teacher
lookup, so it learns nothing about which ids exist. An authorized caller asking
for another tenant's teacher, an unknown id or a malformed id gets the same
`404 COMM.TEACHER_FILE_NOT_FOUND`.

## Routes

All of them sit behind the global bearer guard. Updates use POST because the
shared admin-web client has no PUT.

| Route | Needs | Returns |
|---|---|---|
| `GET /teacher-files` | view | `{ access, teachers: [{ id, name, isActive, studentCount, openComplaints }] }`. Nothing personal. |
| `GET /teacher-files/:teacherId` | view | `{ access, teacher, personal, assignedStudents, supervision: { complaints, monthlyComments, daysOff } }` |
| `POST /teacher-files/:teacherId/personal` `{ phone?, email?, joinedOn?, reason }` | edit personal info | the file. A field left out is unchanged, and `null` clears it. `reason` is required. |
| `POST /teacher-files/:teacherId/entries` `{ kind, body, month?, dayOffOn?, refersTo?, sourceConversationId?, sourceMessageId? }` | write the timeline | `{ id, kind, createdAt }` |

`kind` is one of the following:

- `complaint`: may name the conversation, and optionally the message, it came
  from. The writer must be able to read that conversation; otherwise it is
  refused exactly like an unknown id.
- `complaint_resolution`: takes `refersTo` (the complaint). There is at most
  one per complaint.
- `monthly_comment`: takes `month` as `YYYY-MM`. The newest entry for a month
  is the current comment, and earlier ones are kept as versions.
- `day_off`: takes `dayOffOn` as `YYYY-MM-DD`. A day can be recorded only once
  while it is not cancelled.
- `day_off_cancellation`: takes `refersTo` (the day off). There is at most one
  per day off.

Validation errors are `400 COMMON.VALIDATION` and name the field. The database
refuses timeline conflicts with `409 COMM.TEACHER_FILE_CONFLICT`: a second
resolution or cancellation, a duplicate day off, a follow-up of the wrong kind
or for another teacher.

## Invariants (database, application bypassed)

- **Append-only.** `UPDATE` or `DELETE` on `chat.teacher_supervision_entry` is
  refused by trigger. A correction is a new entry.
- **Same organization.** The teacher, the author and any source conversation
  must all be in the entry's organization, and the author must be active.
- **No grants.** RLS is on, and no request role (`anon`, `authenticated`,
  `chat_app`) has any privilege on either table. Only the server reads them.
- **Audit.** Each change writes `chat.audit_log`
  (`teacher_file.personal_updated` / `teacher_file.entry_added`). Rows name
  which fields changed and the entry kind. They never contain a phone, an email
  or an entry's text, because the audit trail is read more widely than the
  Teacher File is.

## The phone column and G-07

Phone privacy is structural: no actor or communication entity carries a phone,
so the engine cannot leak one. PD-10 put a teacher's phone in this
administration-only table. Two tests keep the guarantee:

- `test/unit/privacy/no-contact-channel-columns.spec.ts`: its `ALLOWED` list
  names exactly the one SQL declaration and the one Prisma field
  (`adminOnlyPhone`, mapped to `phone`). Any other phone column still fails the
  build. Checked both ways: emptying `ALLOWED` fails on exactly those two
  lines.
- `test/unit/privacy/teacher-file-confinement.spec.ts`: no source outside
  `src/teacher-file/` may name either table, either model or the phone field.
  This is the redaction proof for every surface: messages, conversations,
  calls, notifications, realtime, stories, logs. The engine never holds the
  value.

`test/integration/teacher-file.spec.ts` §7 also checks the result end to end.
After a phone is set, no conversation payload for the teacher or for a parent
of their student contains it.

## Admin Web

- **Super admin:** *People & teams → Teachers* (`/admin/teachers`,
  `/admin/teachers/:teacherId`).
- **Teachers department:** *People & teams → Teachers* (`/teachers`,
  `/teachers/:teacherId`). Who belongs to the department is something only the
  server knows; an Operations supervisor has the same role as a Teachers
  supervisor. So `teachers` is a `CONFIRMED_AREAS` entry
  (`core/permissions/capabilities.ts`). It is routable for manager, admin and
  coverage, but the navigation offers it only after `GET /teacher-files`
  answers 200 for this person. A 403 is cached as an answer and not retried.
- Controls follow the server's `access` flags. A refusal page says that Teacher
  Files are for the Teachers department, instead of a generic "forbidden".

## Rollback

`db/rollback/20261018170000_pd010.down.sql` refuses while any Teacher File row
exists, because those are hand-entered records. Export them first.

## Tests

| Suite | What it proves |
|---|---|
| `apps/api/test/unit/authorization/teacher-file-access.spec.ts` | The whole access matrix, including forged relations, other tenants and inactive actors |
| `apps/api/test/unit/privacy/teacher-file-confinement.spec.ts` | Only `src/teacher-file` reads the tables, and the guard fires on the shapes it exists to catch |
| `apps/api/test/integration/teacher-file.spec.ts` | 35 cases over real HTTP on the seeded PD-8 organization: every role, id probing, assigned students, edits, validation, audit, timeline conflicts, append-only, source-conversation reads, payload privacy, grants |
| `apps/admin-web/src/features/teachers/TeacherFiles.test.tsx` | Navigation follows the server, controls follow `access`, request bodies, the server's conflict shown, calendar dates, Arabic |

## Reconciled with PD-11 (2026-10-19)

The owner-approved plan of 2026-10-19 made PD-11 the one lessons system. For the
Teacher File that means:

- The migration is `20261018170000_chat_pd010_teacher_file.sql` (it first took
  `20261018120000`, which PD-11 T1 also used). It creates `chat.teacher_file` and
  **extends** PD-11's `chat.teacher_supervision_entry` (20261018160000) with
  `complaint_resolution`, `refers_to` and `source_message_id`, instead of creating
  a second timeline table. Monthly comments use PD-11's `period`; authors are
  `created_by`; a complaint's source conversation is `conversation_id`.
- **Days off** are PD-11's `chat.teacher_day_off`: the one record of days off,
  and the one the scheduler and make-up booking read. Recording a day off on the
  Teacher File inserts a row there; cancelling it removes the row (the audit log
  keeps who, when and why), so `cancellation` in the API is always `null` now.
- `teacher-file-confinement.spec` guards only `chat.teacher_file`, its model and
  the phone field. The timeline is shared with `src/lessons` and carries no
  contact channel.
