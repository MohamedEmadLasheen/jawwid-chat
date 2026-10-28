# Teacher File (PD-10, PD-18)

Status: **built** · Decisions: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-10
(closed 2026-10-18) and PD-18 (payroll, closed 2026-10-21)

The administration-only record of a teacher (`chat.teacher`, not `chat.staff`).
Parents and teachers never reach it. A teacher's own schedule and workload
arrive with PD-9 through their own routes, never through this one.

## What it contains

| Section | Source | Status |
|---|---|---|
| Personal information: full name, phone, email, joining date | `chat.teacher.name` + `chat.teacher_file` | built |
| Assigned students | `chat.learner.teacher_id` (the academy's assignment) | built |
| Complaints, with their resolution | `chat.teacher_supervision_entry` | built |
| Monthly performance comment, versioned per month | `chat.teacher_supervision_entry` | built |
| Extra days off, with cancellation | `chat.teacher_supervision_entry` | built |
| Schedule: working hours and the next 14 days' lessons | `GET /teachers/:id/availability`, `GET /lessons?teacherId=` (PD-11) | built (2026-10-21), read-only; edits stay on the Schedules tab |
| Monthly performance: the month's KPIs beside the supervisor's comment | `GET /stats/teachers/:id?month=` (PD-11 T5) | built (2026-10-21) |
| Teaching market, current students | `chat.teacher_file.teaching_market`, `chat.learner.teacher_id` | built (PD-18, 2026-10-21) |
| Salary type, currency, monthly salary or hourly rate | `chat.teacher_pay_terms`, versioned by effective month | built (PD-18); super admin and Teachers manager (PD-43) |
| Salary payment method and account details | `chat.teacher_payout_account`, details sealed with AES-256-GCM | built (PD-18); super admin and Teachers manager (PD-43) |
| Bonus and deduction history | PD-11 bonus entries, PD-12 deduction decisions, plus `chat.teacher_pay_adjustment` for the amounts | built (PD-18); the amounts are for the super admin and the Teachers manager (PD-43) |
| Financial summary | computed on every read: salary + bonuses − deductions | built (PD-18); super admin and Teachers manager (PD-43) |
| Specializations | open: Core or Chat | not decided |

The page never shows a zero for something it does not know. A rate or amount
the server cannot compute is a dash, not 0 or 0%.

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

| | View | Edit personal info and teaching market | Write the timeline | Payroll (PD-18) |
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
| `GET /teacher-files/:teacherId/finance?month=YYYY-MM` | payroll | `{ month, keyConfigured, terms, currentTerms, payoutAccount: { method, last4 } \| null, adjustments, unpriced, summary }`. The summary covers six months ending at `month` (default: this payroll month). `Cache-Control: no-store`. |
| `POST /teacher-files/:teacherId/finance/terms` `{ effectiveMonth, salaryType: shift\|hourly, currency, monthlyAmount \| hourlyRate, reason }` | payroll | the new version |
| `POST /teacher-files/:teacherId/finance/payout-account` `{ method, details, reason }` | payroll | `{ method, last4 }`. Without a key: `503 COMM.TEACHER_PAYROLL_UNAVAILABLE` |
| `POST /teacher-files/:teacherId/finance/payout-account/reveal` `{ reason }` | payroll | `{ method, details }`, audited with the reason. `Cache-Control: no-store`. |
| `POST /teacher-files/:teacherId/finance/adjustments` `{ kind?, amount, month?, reason, bonusEntryId?, violationId?, replaces? }` | payroll | `{ id, kind, month, amount, currency }` |

`GET /teacher-files/:teacherId` also returns `employment: { teachingMarket,
studentCount }` and `history: { bonuses, deductions }`. These are what was
recorded (date, reason, who), and no amounts, for every reader of the file.
`access.canViewFinance` tells the page whether to show the payroll sections.

Payout `details` by method: `e_wallet` `{ provider, walletNumber }`,
`instapay` `{ address }`, `bank_transfer` `{ bankName, accountHolder,
accountNumber, iban?, swift? }`. Unknown fields are refused. Amounts are
strings with at most two decimals. An amount is in the currency of that
month's terms, so a month with no terms refuses an amount (409).

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

## Payroll (PD-18)

- **Who.** The super admin and, since PD-43 (owner N2, "Full teacher
  finance"), the Teachers manager. Teacher supervisors and Operations see the
  recorded bonuses and deductions, never an amount. The database names the same
  two for pay terms, the payout account and the default deduction amounts
  (`chat.is_teacher_payroll_author`); every reveal of payout details stays
  audited with its reason.
- **Append-only.** `chat.teacher_pay_terms` and `chat.teacher_pay_adjustment`
  refuse `UPDATE` and `DELETE` by trigger. A change of terms is a new version.
  A corrected amount is a new row that `replaces` the old one, and zero cancels.
  A recorded bonus or deduction decision is priced by at most one original row,
  and a row is replaced at most once.
- **Sealed details.** `details_sealed` holds iv ‖ tag ‖ AES-256-GCM ciphertext.
  The additional authenticated data names the organization, the teacher and the
  method, so a value copied onto another row does not open. Only `method` and
  `last4` are stored in clear.
- **Key.** `TEACHER_PAYOUT_KEYS=keyid:base64key[,keyid:base64key…]`, each key
  32 bytes. The first key seals and every listed key opens. To rotate, put the
  new key first and keep the old one until every account has been re-saved.
  Without the variable, saving and revealing are refused (503); the rest of
  payroll still works. **Back the key up with the database backups.** Losing it
  loses every saved account.
- **Audit.** `teacher_file.pay_terms_set`, `.payout_account_set`,
  `.payout_account_revealed` (with the reason) and `.pay_adjustment_added`.
  None of them contains an amount or an account detail.
- **The summary.** A shift salary is its monthly amount. An hourly salary is the
  rate times the minutes of the teacher's lessons in that payroll month
  (`chat.academy_month`) that closed `held` or `student_no_show`. Bonuses and
  deductions are the live amounts of that month. Everything is computed in
  hundredths, never in floating point.
- **Confinement.** `teacher-file-confinement.spec.ts` fails the build if any
  source outside `src/teacher-file/` names a payroll table, model, the sealed
  column or the key variable.
- **Rollback.** `db/rollback/20261021160000_pd018.down.sql` refuses while any
  payroll row or teaching market exists.

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

## Adding a teacher (PD-43)

**Teacher Files → Add teacher.** The button appears only when `GET /teacher-files` returns `onboarding.canAdd`.

| Who | May add | Supervisor they may name |
|---|---|---|
| Super admin, Teachers Manager | yes | any primary teacher supervisor, or none |
| A primary teacher supervisor | yes (owner Q1) | themselves (`"self"`) or none (owner N1) |
| Anyone else | no (`COMM.TEACHER_ONBOARDING_DENIED`, 403) | — |

**`POST /teachers`** (`teachers.create`) takes `{ id, name, email, phone?, joinedOn?, teachingMarket?, supervisorId?: uuid | "self" | null, note? }`. In ONE transaction it runs:
- `chat.create_teacher`: the provisioned login, the teacher, the Teacher File and the assignment;
- the teacher's supervision chat;
- a first sign-in code (72 h, five tries).

It answers `{ teacher, signIn, firstLogin: { code, expiresAt, emailed } }` with `Cache-Control: no-store`. The code appears in this response once, and never again.

After the commit, the code is e-mailed to the sign-in address when the e-mail channel (`SMTP_URL` + `RECOVERY_MAIL_FROM`) is configured. Otherwise `emailed` is false, and the person who added the teacher hands the code over. The same `id` sent twice is the same teacher, with a fresh code that kills the first.

**`POST /teachers/:id/first-login-code`** (`teachers.create`) issues a new code while the teacher has not signed in. The owner set the rule on 2026-10-28: "E-mail only; managers can see".
- **Who:** only the super admin, the Teachers Manager and the teacher's **current** supervisor, as decided by `chat.may_issue_teacher_first_login` (migration `20261028170000`). A former supervisor, or the supervisor who merely added the teacher, gets 404, before any other answer.
- **The code:** it is always e-mailed to the teacher. Only the Manager and the super admin see it in the response; a supervisor gets `{ expiresAt, emailed }`, and is told to ask the Manager when it could not be e-mailed.
- **After sign-in:** `COMM.TEACHER_ALREADY_SIGNED_IN` (409); use a password reset. A suspended login answers `COMM.TEACHER_SIGN_IN_SUSPENDED` (409).
- **Limit:** ten codes an hour per login, counting the first.
- **Delivery:** the e-mail is sent after the commit and waits at most 10 seconds; the subject never carries the code.

**A sign-in or contact already in use** (409):

| Error | When |
|---|---|
| `COMM.TEACHER_ALREADY_ADDED` | the e-mail signs in a teacher the caller reaches; `error.detail.teacher` names them |
| `COMM.TEACHER_EMAIL_UNAVAILABLE` | the e-mail, or the phone, belongs to anyone else: another organization's account, a parent, staff, or a teacher out of the caller's reach. It is one identical answer, so it tells nobody what exists. There is no e-mail-check endpoint. |
| `COMM.TEACHER_CONTACT_TAKEN` | the phone or e-mail is on the file of a teacher the caller reaches, named in `error.detail.teacher` |

### Give sign-in: a teacher who exists but has no login

Teachers inserted before PD-43, and the Core-migration intake, have a teacher row and no login. On their Teacher File, **Give sign-in** gives them one in place: the same teacher, students and history. The Teacher Files list marks them "No sign-in"; that list is the intake's work list.

**`POST /teachers/:id/sign-in`** (`teachers.create`) takes `{ email, reason? }`.
- **Who:** the super admin, the Teachers Manager, or the teacher's **current** supervisor, whatever the strict switch says. The rule is `chat.may_give_teacher_sign_in`.
- **In one transaction:** `chat.give_teacher_sign_in` (migration `20261028160000`) and the first sign-in code.
- **The code** follows the reissue rule, because an existing teacher is a live identity: it is always e-mailed, and only the Manager and the super admin see it. A supervisor gets `{ expiresAt, emailed }`.
- **The Teacher File's e-mail** is filled only when it has none.

| Refusal | Answer |
|---|---|
| The teacher already has a login | 409 `COMM.TEACHER_HAS_SIGN_IN`; send a new first sign-in code, or reset the password |
| The teacher is inactive | 409 `COMM.TEACHER_FILE_CONFLICT` |
| The teacher is out of the caller's reach, or unknown | 404 |
| A sign-in already in use | the same scoped answers as when adding a teacher |

## Offboarding and reactivating a teacher (PD-43 PR-1b)

Migration `20261028200000_chat_pd043_offboarding_and_setup.sql`. Nothing is deleted: the Teacher File and its history stay readable.

| Route | Who | What |
|---|---|---|
| `GET /teachers/:id/offboard-preview` | Teachers manager, super admin | `{ teacherId, isActive, students: [{id, name}], openLessons: [{id, kind, startsAt, endsAt}], canOffboard }` |
| `POST /teachers/:id/offboard` `{ reason, cancelOpenLessons? }` | Teachers manager, super admin | 201 `{ teacherId, cancelledLessons, notCancelled }` |
| `POST /teachers/:id/reactivate` `{ reason }` | super admin only (owner Q6) | 201 `{ teacherId, signIn, firstLogin: { code, expiresAt, emailed } }`, `Cache-Control: no-store` |

All three carry PD-40 key `teachers.offboard`; reactivation is narrowed to the super admin in the service and in `chat.reactivate_teacher`.

The lessons ahead come first. With no student left they are trials and the like: the preview lists each one, and they are cancelled only when the actor confirms it (`cancelOpenLessons: true`), while the teacher is still live, each with the family's card and its own audit row (`trial.cancelled`, `lesson.admin_cancelled`). The card never carries the offboarding reason. If any cannot be cancelled, nothing is offboarded (409 `TEACHER_HAS_OPEN_LESSONS`, `error.detail.notCancelled`).

Then one transaction: `chat.offboard_teacher` refuses over any lesson still open, closes the teacher (`is_active = false`, `left_at`) and the login (`deactivated`, whether it had signed in or not), retires any waiting first sign-in code, ends the supervisor assignment and audits `teacher.offboarded` with the cancelled lesson ids; every session is revoked in the same transaction and the realtime barrier runs after it.

Reactivation brings back the same teacher with no supervisor: the login waits again (`provisioned`) and a new first sign-in code is issued in the same transaction, shown to the super admin and e-mailed. The old password never comes back.

| Error | When |
|---|---|
| `COMM.TEACHER_HAS_STUDENTS` | a student is still assigned; `error.detail.students` lists them. Refused in SQL too. |
| `COMM.TEACHER_HAS_OPEN_LESSONS` | lessons ahead and `cancelOpenLessons` not set (`error.detail.openLessons`), or one could not be cancelled (`error.detail.notCancelled`; nothing offboarded). Refused in SQL too. |
| `COMM.TEACHER_FILE_CONFLICT` | offboarding a teacher who has left; reactivating one who is active |
| `COMM.TEACHER_ONBOARDING_DENIED` | anyone else |

There is no `is_active`/`left_at` check on `chat.teacher`: PD-38 reads an inactive teacher with no leaving date as never listed, so a date made up by a trigger or a backfill would rewrite the calendar's history. The writers here set both.

### The set-up checklist

`GET /teacher-files/:id` carries `setup`: `signedIn`, `supervisor`, `contact`, `payTerms`, `payoutAccount`, `leaveAllowance` (this academy year), `shift` (a current PD-38 pattern), `availability` (hourly teachers count as having it), `profile`, `payMatchesShift` (an hourly pattern with hourly pay, and the reverse), and `missing` (how many are not done). `GET /teacher-files` carries `setupMissing` per teacher. Read live from `chat.teacher_setup_state`, never stored, and never an amount.

### On the Admin Web

`GET /teacher-files/:id` carries `onboarding: { canOffboard, canReactivate }` (from `decideTeacherOnboarding`; the routes re-check), and the Teacher File offers:

- **Offboard** (Teachers manager, super admin; active teachers). The dialog loads the preview: the students still assigned are listed and block it; otherwise each lesson ahead is listed and the teacher is offboarded only once the actor ticks "Cancel this lesson / these lessons" and gives a reason.
- **Reactivate** (super admin; teachers who left). A reason, then the new first sign-in code is shown once, in the same dialog as when adding a teacher.
- **Set-up checklist**, a card at the top of an active teacher's file while any step is open (or the pay type and the shift category disagree). The list shows a **Setup incomplete** badge and a **Setup incomplete only** filter.

A dialog that shows a first sign-in code (Give sign-in, Reactivate) stays mounted when the reloaded file no longer offers its button, so the code survives the reload.

### Where a teacher is picked, and unsupervised teachers (PD-43 §3.5-§3.7)

Warnings only: every teacher stays pickable (owner Q5, "students allowed").

- `GET /teachers/candidates` (Change teacher) and `GET /trials/teachers` (trial booking, the Sales subscription form) carry `readiness: { setupIncomplete, notSignedIn, noSupervisor, loginSuspended }` per teacher, from `apps/api/src/platform/teacher-readiness.ts` (`chat.teacher_setup_state` and the login's status). `loginSuspended` is a login suspended through Accounts (G8).
- Change teacher shows the notes beside the name ("Setup incomplete · Not signed in yet · No supervisor", or "Login suspended"); the radio stays enabled. The subscription form puts them in the option's label, and once such a teacher is chosen says "This teacher's set-up is not finished. Students are allowed; this is a warning."
- `GET /teacher-files` rows carry `unsupervised` (active, no live primary supervisor). Every reader sees a **No supervisor** badge; the Teachers Manager and the super admin also get an "{n} unsupervised" count, an **Unsupervised only** filter and an **Assign supervisor** link to Organization's Teachers & supervisors tab (`/organization?tab=teachers`, or `/admin/teams?tab=teachers` in the Admin Portal).
- The offboard preview's students link to their page, where Change teacher is.
