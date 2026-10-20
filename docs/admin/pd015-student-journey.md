# PD-15 — the student's journey after enrolment

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-15. Built on PD-9 /
PD-11 (one lesson row, one outcome, statistics as queries) — nothing here is a
parallel lesson record.

## The workflow, end to end

| Step | Who | Where | Record |
|---|---|---|---|
| Assign the responsible supervisor | Operations manager | Admin Web → Trials & new students → New students → **Assign** (or Organization → Children) | `chat.learner_supervision` + `audit_log learner.supervisor_assigned` |
| Create the permanent group | The child's supervisor | New students → **Create group** (prefilled) or Chat → New family group | `family_group`, named "Teacher — Child · Child" |
| Record the child's details | The child's supervisor | New students → **Details**, or the group's info panel → Children → Edit details | `chat.learner_enrollment` (date of birth, course, package) + `audit_log learner.enrollment_set` |
| Report a lesson | The teacher | App → group → "+" → **Lesson report** → Student attended / did not attend | `held` + `chat.lesson_report` + card, or `student_no_show` + card |
| Student excuse | The child's supervisor | Admin Web → group → "+" → **Student excuse** → before / after the start | `student_apology` + `apology_timing`; after the start also a `late_apology` ruling decided `excused` |
| Teacher excuse | The child's supervisor (or the teacher) | "+" → **Teacher excuse** | `teacher_apology` (and a PD-12 violation) |
| Make-up | Teacher, supervisor (or the parent, from free times) | "+" → **Reschedule a make-up class** | a `makeup` lesson, `makeup_for` the missed one |
| Correct an outcome | Teachers dept, Operations, super admin | Admin Web → a lesson card's menu → **Lesson record** → Correct outcome | `chat.lesson_correction` + `audit_log lesson.outcome_corrected` |
| Edit / delete / resend a report | Edit: the teacher (own) or supervisors; delete: supervisors | App card → Edit report; Admin Web → Lesson record | `chat.lesson_report_revision` (+ `audit_log`) |

## Routes (all behind the bearer guard; the services decide)

| Method | Path | Body / answer |
|---|---|---|
| GET | `/conversations/:id/lesson-tickets` | `{ tickets: [{ ticket, lessonId, learner, startsAt, endsAt, suggestedLessonNumber? }] }` — now also for staff (`apology`, `late_excuse`, `teacher_apology`, `book_makeup`) |
| POST | `/lessons/:id/report` | `{ lessonNumber?, coveredTopics[], covered?, rating?, nextTasks[], homework?, note? }` — topics or covered required |
| POST | `/lessons/:id/apology` | `{ reason }` (family: required; supervisor: optional) |
| POST | `/lessons/:id/late-excuse` | `{ reason }` — supervisor, after the start, excused at once |
| POST | `/lessons/:id/teacher-apology` | `{ reason }` |
| POST | `/lessons/:id/makeup` | `{ startsAt }` — family: a free slot; teacher / staff: any agreed future time, not a day off |
| POST | `/lessons/:id/correction` | `{ outcome, reason, apologyTiming?, report? }` |
| POST | `/lessons/:id/report/edit` | the whole report |
| POST | `/lessons/:id/report/delete` | `{ reason, resend: boolean, report? }` |
| GET | `/lessons/:id/history` | staff: `{ corrections[], reportRevisions[] }` |
| GET | `/conversations/:id/learners` | `{ learners: [{ id, name, age, birthDate? (staff), course, packageLessons, teacher, schedule[], canEdit }] }` |
| POST | `/learners/:id/enrollment` | `{ birthDate?, courseId?, packageLessons? }` — a present field is written, null clears |
| GET / POST | `/courses`, `/courses/:id` | the course list; add / rename / retire (Operations manager, super admin) |

`GET /stats/teachers` and `/stats/teachers/:id` gain `summary` (see
`StatsService.monthSummary`): total scheduled, conducted (= student attended,
regular + make-up), no-shows, student excuses before / after, teacher excuses,
teacher absences, cancellations, pending (to come / awaiting a report),
make-ups completed / scheduled.

## Database rules worth knowing

- `chat.guard_lesson` accepts an outcome change only with an excusing ruling or
  a `chat.lesson_correction` row written **in the same transaction** (`txid`).
  A correction from another transaction authorizes nothing.
- `voided` is final and is excluded from every statistics function.
- A report, its card payload and its card body change only with a
  `chat.lesson_report_revision` of the same transaction; the body also needs a
  `chat.message_revision` (as any edit). A held lesson always has a live report
  (deferred check).
- `chat.can_correct_lessons` is the floor: super admin, Teachers or Operations
  department. The API narrows Operations to the child's supervisor and the
  Operations manager.
- A report card is never removed with "delete for everyone"
  (`COMM.MESSAGE_NOT_EDITABLE`).

## Known limits

- The topic / next-lesson lists are a starting set (`report-vocab.ts`, mirrored
  in Admin Web `journey/api.ts` and the app's `report_vocab.dart`).
- Course retirement has no screen yet beyond "add" in the details dialog; the
  route exists (`POST /courses/:id { isActive: false }`).
- Core is told through `lesson.closed` (`correction: true`) — the outbound
  transport to Core does not exist yet (PD-12 S3 note).
