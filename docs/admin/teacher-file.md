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

**`POST /teachers/:id/first-login-code`** (`teachers.create`) issues a new code while the teacher has not signed in. Once the teacher has signed in, it answers `COMM.TEACHER_ALREADY_SIGNED_IN` (409): use a password reset instead.

**A sign-in or contact already in use** (409):

| Error | When |
|---|---|
| `COMM.TEACHER_ALREADY_ADDED` | the e-mail signs in a teacher the caller reaches; `error.detail.teacher` names them |
| `COMM.TEACHER_EMAIL_UNAVAILABLE` | the e-mail belongs to anyone else: another organization's account, a parent, staff, or a teacher out of the caller's reach. It is one identical answer, so it tells nobody what exists. There is no e-mail-check endpoint. |
| `COMM.TEACHER_CONTACT_TAKEN` | the phone or e-mail is on another teacher's file; that teacher is named only when the caller reaches them |
