# PD-43: adding a new teacher (review and plan)

**State:** plan for approval. No feature code has been written.
**Claim:** `docs/product/pd-registry/PD-43.md`. Migration slot `20261027180000` (`chat_pd043_teacher_onboarding`), later than every slot on `main` and on every open PR (the highest is #176's `20261027170000`).
**Base:** `main` @ `6709bba7`. PD-40 is read from its open stack: #164 (plan), #167 (account-admin rule, approved), #172 (route keys, `claude/pd40-route-permissions`) and #174 (data model, `claude/pd40-access-model`). PD-42 is read from #173 (plan v2).

The owner's request, verbatim:

> "We need a clear plan for adding teachers to the system. How should a new teacher be added, and what is the complete workflow from creating the teacher's account to assigning their permissions and setting them up in the system?"

---

## Summary

- **Nobody can add a teacher today.** The API has no route that creates a teacher or a teacher login. The Admin Web has no form for it. The only code that creates a teacher is the local QA seed, which refuses to run on a live system. A real teacher today needs a developer and SQL (§1.1).
- **A teacher is not a staff member.** It is its own record (`chat.teacher`) with its own login kind (`teacher`). So a teacher does not join a department and holds no permissions of its own. The Teachers department is the *staff* who supervise teachers. "Assigning a teacher's permissions" therefore means two things (§1.3):
  1. which supervisor the teacher has (PD-35);
  2. which students and groups the teacher is given.
  What a teacher may do in the app is fixed by the closed Teacher Account scope (Chats · Schedule · Calls · Settings) and is not configured per person.
- **Proposed workflow** (§3): the **Teachers Manager** (or the super admin) adds the teacher with **one short form**. It asks for name, sign-in e-mail and supervisor, with phone and joining date optional. The server then does everything below in one transaction:
  - creates the teacher, a login that waits for set-up, the Teacher File and the supervisor assignment;
  - opens the supervision chat;
  - produces a **set-up code**.

  The teacher signs in with the code, chooses their own password (minimum 4) and is active. Everything else is completed afterwards, and a **set-up checklist** shows what is missing:
  - pay terms;
  - leave allowance;
  - shift and availability;
  - the teacher's own profile;
  - the first students.
- **Offboarding** gets a proper action (§3.6). It requires that no students are left. It then closes both the teacher record and the login, ends the supervisor link and is audited. Today a teacher can only leave through the discipline ladder or an operator CLI.
- **Permissions** (§4): two new PD-40 keys, `teachers.create` and `teachers.offboard`. Every other step uses keys that already exist (`accounts.administer`, `org.manage`, `teacher_files.*`, `leave.allowance`, `schedule.manage`, `students.manage`).
- **Core migration** (§5): Core has no teacher entity, so there is nothing to import. Existing teachers are entered with the same form by the Teachers Manager. Teacher rows already in Chat without a login get **Give sign-in**. Teachers should be entered **before** PD-42's family intake, so supervisors can pick them.
- **Six small PRs** (§7), each with its tests. **Eight owner questions** (§8), each with a recommendation.

---

## 1. Review: what exists on `main`, with evidence

Migrations are under `supabase/migrations/` and are cited by timestamp.

### 1.1 How a teacher comes to exist

| Fact | Evidence |
|---|---|
| A teacher is its own table, **not** a staff role. The table comment says: "Do not fix this by adding teacher to staff.role". | `20260910120000_chat_teacher_identity.sql:30-57` |
| `chat.teacher.account_id` is nullable. A teacher without a login "can be assigned to a learner and appear in a group, but can never authenticate". | same file `:35-39`, `:59-61` |
| A login is a `chat.account` row of kind `teacher`, with `status` one of `provisioned`, `active`, `suspended` or `deactivated`. `is_active` must equal `status = 'active'`. | same file `:90-93`, `:110-121` |
| `chat.staff.role` has no `teacher` value. | `20261013120000_chat_super_admin_role.sql:46-48` |
| **The API has no create route.** `/admin/accounts` only lists, reads, resets, suspends, reactivates and manages sessions. | `apps/api/src/account-admin/account-admin.controller.ts:28-99` |
| The only code that creates teachers is the **QA seed**: account, credential, then `prisma.teacher.create`. | `apps/api/src/cli/org-chat-seed.ts:304-311` |
| The seed refuses a live system. It says that "real staff are created on the live system by an administrator, never seeded". | `apps/api/src/cli/seed-org-chat.ts:22-23` |
| The super-admin bootstrap CLI creates the super admin only. | `apps/api/src/cli/super-admin-bootstrap.ts:228-300` |
| The known gap is already written down: "`chat.teacher.account_id` is never populated, so a teacher cannot sign in. The Teacher app needs a provisioning path that does not exist." | `docs/architecture/core-integration-contract.md:336-337` |
| On paper, "Provisioning and offboarding (deactivation) stay the super admin's". No code implements it. | `docs/architecture/AUTHORIZATION-MODEL.md:92` |
| PD-40's own review reached the same finding: "There is no API to create a staff account". | #164, `pd040-admin-accounts-plan.md` §1 F3 |
| **Admin Web has no create form.** The Accounts subtitle is "Reset a password or set an account inactive". | `apps/admin-web/src/features/accounts/copy.ts:14-17` |
| The super admin's Users section says "Creating, suspending and resetting accounts is not built yet". | `apps/admin-web/src/features/admin/sections.ts:194-207` |
| Core has no teacher entity. `core_teacher_id` is unused. | `20260910120000:42-45`; `apps/api/src/communication/teacher-profile/teacher-profile.service.ts:159` |

**Consequence:** every real teacher on a live system today was inserted with SQL by a developer. This plan cannot tell how many exist in production, or in which state, because it reads only code. §5 handles that.

### 1.2 What a teacher record carries, and when each part is created

None of these rows is created automatically. Nothing fires on a `chat.teacher` insert except `updated_at` and the revocation journal (`20260910120000:69`; `20261014150000:264-272`).

| Part | Table | Created | Written by | Evidence |
|---|---|---|---|---|
| Name, active flag, photo | `chat.teacher` | by whoever inserts the teacher | staff (none today); the teacher renames themself | `20260910120000:30-53`; `PATCH /me/teacher-profile/name` |
| Login | `chat.account` + `chat.account_credential` | never, except by the seed | — | §1.1 |
| Teacher File (phone, e-mail, joining date, teaching market) | `chat.teacher_file` | lazily, on the first staff edit (upsert) | super admin, Teachers Manager | `20261018170000_chat_pd010_teacher_file.sql:39-47`; `apps/api/src/teacher-file/teacher-file.service.ts:305`; `apps/api/src/platform/teacher-file-policy.ts:40-57` |
| Supervisor (PD-35) | `chat.teacher_supervisor_assignment` | when staff assign one | Teachers Manager, super admin | `20261026160004:46-53`; `apps/api/src/teacher-supervisors/teacher-supervisor.service.ts:125-160` |
| Professional profile (bio, specialization, languages) | `chat.teacher_professional_profile` | lazily, on the teacher's first save | the teacher only | `20261021000000:109-125`; `teacher-profile.service.ts:122` |
| Pay terms (PD-18): `shift` (monthly amount) or `hourly` (rate), plus currency | `chat.teacher_pay_terms` | when staff set them | **super admin only** (`canViewFinance`) | `20261021160000_chat_pd018_teacher_payroll.sql:47-66`; `teacher-file-policy.ts:47-48`; `apps/admin-web/src/features/teacher-files/Payroll.tsx:28-35` |
| Payout account | `chat.teacher_payout_account` | when staff set it | super admin | `20261021160000:77` |
| Leave allowance (PD-12) | `chat.teacher_leave_allowance` | when staff set it; no default row | Teachers Manager | `20261019090000:460-475` |
| Availability and days off (PD-31) | `chat.teacher_availability` (has its own `timezone`), `chat.teacher_day_off` | when staff set them | Teachers department | `20261018140000:51-106` |
| Shift and category (PD-38) | `chat.teacher_work_pattern` (has its own `timezone`), `chat.teacher_work_window` | when staff set them | Teachers Manager, super admin | `20261026210000:37-69`; `apps/admin-web/src/features/schedule/ShiftSection.tsx:14-25` |
| Time zone (PD-22) | `chat.actor_time_zone` | when the teacher's app first reports the phone's zone | the person only | `apps/api/src/platform/time-zone.service.ts:34-58`; the fallback is the academy zone (`:92-96`) |
| Supervision chat | `teacher_supervision` conversation | lazily: on the first ticket, when either side opens it, or by "ensure all" | — | `apps/api/src/supervision/supervision-conversation.service.ts:87-135` (`ensureOwn`, `ensureForTeacher`, `ensureAll`, `ensureInTx`) |
| Trial group | `trial_group` conversation | when the teacher's first trial is booked | — | `apps/api/src/lessons/trial-group.service.ts:50-53,93` |
| Subjects or levels | **none** | — | — | only the free-text `specialization` and `languages[]` on the profile |

**Payroll with missing terms** does not fail. It shows `base`, `currency` and `net` as empty (`apps/api/src/teacher-file/teacher-payroll.service.ts:565`). Recording a bonus or deduction does refuse with 409 until terms exist.

### 1.3 How a teacher is placed

- **Department.** A teacher never joins a department. `chat.department_member.staff_id` references `chat.staff`, and members must be `admin` or `coverage` (`20261015120000_chat_pd008_org_structure.sql:98-135`). The "Teachers department" is the staff who supervise teachers (`chat.teachers_department_role`, `20261019090000:49-61`). Department rooms refuse teachers (`20261027100000:25-26`).
- **Teacher supervisor (PD-35).**
  - Each teacher has one supervisor, who must be a primary supervisor of the Teachers department (`20261026160004:60-94`).
  - It is set on Organization → Teachers & supervisors. The select saves at once, with no reason field (`apps/admin-web/src/features/organization/OrganizationPage.tsx:127-138`).
  - The page counts and flags teachers with no supervisor, and shows "Former supervisor" when a supervisor has left (`:100-102`, `:118-142`).
  - With strict scope ON, a teacher with no supervisor is seen only by the Teachers Manager and the super admin. Strict scope is OFF everywhere today; the owner decides when to turn it on.
- **Operations side.** There is none for the teacher. Operations owns families (PD-8). It reaches a teacher only through the teacher's students; PD-26 #175 adds Operations' view of "teachers of their families".
- **Students** (`learner.teacher_id`) are guarded by the learner-assignment gate. Only two SQL writers may set it:
  - `chat.enrol_learner` (PD-16; Sales picks the teacher in the subscription form): `20261021140000:53-92`;
  - `chat.transfer_learner` (PD-31 Change teacher): `20261026110000:469-594`.

  Both check only that the teacher is in the organization, active and not left (`20261021140000:76-81`; `20261026110000:503-509`). **They do not check** for a login, a supervisor, pay terms, availability, or whether the teacher is on leave.
- **Groups.** A transfer adds the new teacher to the learner's family groups and swaps them into the student group (`20261026110000:520-555`). A family group created at enrolment includes the children's teachers (`apps/api/src/new-students/enrolment.service.ts:307-327`).

### 1.4 How a teacher signs in

- `POST /auth/login` uses `subject` (the sign-in name) plus password (`apps/api/src/platform/auth/auth.controller.ts:60-95`).
  - The subject is only trimmed, so it is **case-sensitive** (`auth.service.ts:194`).
  - `chat.account.subject` is globally unique but not case-insensitive (`20260905090050_chat_identity.sql:16`).
- Login refuses an account whose status is not `active` (`auth.service.ts:236`), and a principal that is inactive (`:251-254`). **So a `provisioned` login cannot sign in.**
- **The password minimum is 4** (owner decision, #171). This is `PASSWORD_MIN_LENGTH = 4` in `apps/api/src/platform/auth/password-policy.ts:19`, mirrored in Admin Web and Flutter. The database does not enforce it.
- **A one-time code (PD-21).** Staff issue a 6-digit code (`POST /admin/accounts/:id/password-reset`). The person completes it at `POST /auth/password-reset`.
  - The code lasts 10 minutes and allows 5 tries (`apps/api/src/platform/auth/password-reset.service.ts:13-17,53`).
  - Completing it upserts the credential, so it already works for an account that never had a password. It **does not** move a `provisioned` login to `active`.
  - The code is shown once to the administrator, who hands it over by hand (`docs/admin/pd021-account-administration.md`).
- **Mobile and the teacher web portal** (`/teacher/`, PD-28) share the same login. Teachers count as "family" for session limits: 30 days idle in the app, and 12 h, or 7 d / 30 d when remembered, on the web (`apps/api/src/platform/auth/session-policy.ts:13-21,62-64`). A non-teacher in the portal is refused (`lib/features/auth/presentation/web_portal_gate.dart`).
- **PD-23 app lock** is offered once to a teacher after their first password sign-in (`lib/features/app_lock/application/app_lock_controller.dart:112-115,216-223`).
- **No first-sign-in step exists**: no forced password change, no profile, no terms. The teacher lands on Chats (`lib/app/router.dart:432-435`).

### 1.5 What a teacher can and cannot do

- The Teacher Account is **CLOSED/FROZEN as a communication app**, not an operations app (boundary doc). PD-9/PD-10 reopened it only for the teacher's own schedule and workload. The tabs are Chats · Schedule · Calls · Settings (`lib/app/shells/app_shell.dart`).
- A teacher **cannot** publish stories, start a new chat from a directory, see other teachers' students, or see their own pay.
- On a brand-new teacher's first day:
  - **Chats** shows "No conversations yet". The supervision chat is created lazily, family groups only arrive with students, and department rooms are staff-only.
  - **Schedule** shows "No lessons in the next two weeks".

### 1.6 Leaving the academy today

| Path | What it does | What it misses |
|---|---|---|
| Accounts → **Set inactive** (PD-21 suspend) | Suspends the **login**, revokes sessions and audits (`apps/api/src/account-admin/account-admin.service.ts:214-232`). | `chat.teacher.is_active` stays `true`. The teacher is still offered for new students, because both writers check only the teacher row (§1.3). The students stay. |
| Discipline ladder → **permanent suspension** | Refuses while the teacher still has students (`apps/api/src/discipline/discipline.service.ts:314-317`). Cancels colliding lessons on request (`:321-328`). Calls `chat.deactivate_principal('teacher')` (`:422-428`). | It is a *disciplinary* record, which is wrong for a resignation. The login's `status` stays `active`; sign-in is refused only because the principal is inactive. The students check is API-only: no DB guard exists. |
| Operator CLI `deactivate-principal --kind teacher` | Deactivates the teacher (`apps/api/src/cli/deactivate-principal.ts:11-28`). | It needs a developer. It does not check for students and does not cancel lessons. |
| `staffApi.offboard` / `POST /staff/:id/offboard` | Exists in the Admin Web client (`apps/admin-web/src/core/api/endpoints.ts:296-299`). | **Staff** only, and no UI calls it. |

What `deactivate_principal('teacher')` leaves behind (`20261014150000:289-373`, the update at `:331`):
- `learner.teacher_id`;
- conversation member rows (access ends only because the predicates check `is_active`);
- the supervisor assignment;
- the Teacher File;
- the pay rows.

`chat.teacher` has no check that `is_active` and `left_at` agree. `chat.staff` has one (`20260905090200:31`).

### 1.7 Gaps

| # | Gap | Today |
|---|---|---|
| G1 | No way to add a teacher or give one a login | developer + SQL |
| G2 | A `provisioned` login cannot be activated, even by a reset code | developer + SQL |
| G3 | No duplicate check: `subject` is case-sensitive, the Teacher File e-mail and phone are not unique, and creation writes no audit row | — |
| G4 | A new teacher can exist with no Teacher File, no supervisor, no pay terms, no availability or shift, and no login, while already having students | nothing shows it, apart from the "no supervisor" banner |
| G5 | A new teacher's Chats tab is empty: the supervision chat is lazy | — |
| G6 | Three unrelated time zones: the person's, availability's and the shift's | — |
| G7 | The PD-38 category (`hourly`) and the PD-18 salary type (`shift`) can contradict each other | — |
| G8 | A login suspended through Accounts leaves the teacher assignable | — |
| G9 | No non-disciplinary offboarding; the students check is API-only; offboarding leaves the login `active` | discipline ladder or CLI |
| G10 | Supervisor changes take no reason and write no audit row | — |

---

## 2. Design principles

1. **Reuse, don't parallel.** Use PD-21's one-time code for the first sign-in, PD-35's assignment for the supervisor, PD-10's Teacher File for contact details, PD-40's keys for permission, and `deactivate_principal` for leaving.
2. **The minimum makes a teacher usable; the rest is a visible checklist, not a wizard.** Core's data is incomplete, and the migration must not stall on a missing payout IBAN.
3. **Nobody but the teacher ever knows the password** (the PD-21 principle). Staff hand over a set-up code, never a password.
4. **The database refuses what the API refuses.** Creation, activation and offboarding are SQL writers that check and audit, as in PD-40 PR-2.
5. **The Teacher Account stays frozen.** No new teacher screens. The existing "I have a code" path is the whole client change.
6. **Setup state is computed, never stored**, so it cannot drift from the real rows.

---

## 3. The proposed workflow

### 3.1 Who does what

| Step | Who | When |
|---|---|---|
| 1. Add the teacher (one form) | **Teachers Manager**, or the super admin | day 0 |
| 2. Hand over the set-up code | whoever added the teacher | day 0 |
| 3. Set own password, sign in | **the teacher** | within 72 h |
| 4. Pay terms and payout account | **super admin** (only they hold `teacher_files.finance` today) | before the first payroll month |
| 5. Leave allowance for the year | Teachers Manager | first week |
| 6. Shift and category (PD-38), then availability (PD-31) | Teachers Manager (shift); Teachers department (availability, days off) | before students |
| 7. Professional profile and photo | **the teacher** | first week |
| 8. First students | **Sales** (subscription form) for new families; **Operations or Teachers department** via Change teacher for existing children | when ready |
| 9. Supervisor's first check-in in the supervision chat | **the teacher supervisor** | first week |

No HR or finance department exists in Chat. `finance` is a legacy staff role with no bundle (#174, `legacy-bundles.ts`). Payroll stays with the super admin until PD-40 adds an Accountant specialist (§8 Q8).

### 3.2 Step 1: Add a teacher (the minimum)

**Where:**
- Teacher Files → **Add teacher**;
- the same button on Organization → Teachers & supervisors;
- the super admin's `/admin/teachers`.

**The form:**

| Field | Required | Why |
|---|---|---|
| Full name | **yes**, 1–120 characters | `chat.teacher.name` is `NOT NULL`. Every chat surface shows it. The teacher may rename themself later. |
| Sign-in e-mail | **yes** (§8 Q2) | It becomes `chat.account.subject`, stored trimmed and lower-cased. It is also saved as the Teacher File e-mail. |
| Teacher supervisor | **yes**, unless the Teachers department has no supervisor yet (§8 Q4) | Keeps PD-35's strict-scope precondition ("every active teacher has a supervisor") true by construction. |
| Phone | no | Teacher File, admin-only (`20261018170000:42`) |
| Joining date | no, defaults to today | Teacher File `joined_on` |
| Teaching market | no | Teacher File |
| Note | no | added to the audit reason "teacher added" |

**`POST /api/v1/teachers`** (new) does all of the following in **one transaction**, through a SQL writer `chat.create_teacher(...)`:
1. Duplicate checks (§3.4), under `pg_advisory_xact_lock` on the normalized e-mail.
2. `chat.account`: kind `teacher`, status **`provisioned`**, so `is_active` is false.
3. `chat.teacher`: `account_id`, name, active.
4. `chat.teacher_file`: e-mail, phone, joining date, market.
5. `chat.teacher_supervisor_assignment`.
6. The **supervision chat**, created at once (`ensureInTx`). The teacher's Chats tab is never empty, and the supervisor has a place to welcome them (closes G5).
7. A **set-up code**: PD-21's `password_reset_code` with a new `purpose = 'first_login'`, valid **72 h**, 5 tries (§8 Q3).
8. Audit rows `teacher.created` and `teacher.setup_code_issued`, with actor, reason and the resolved fields. Phone and e-mail are never written into the audit text.

The response returns the teacher, and the code **once**.

### 3.3 Steps 2–3: Set-up code and first sign-in

- The creator sees the code once, with its expiry: "Give this code to the teacher. It works once, for 72 hours." If PD-40 Q5 is answered "e-mail it", the same mailer sends it to the sign-in address.
- The teacher opens the app, or `/teacher/` on a computer, and taps **"I have a code"**. This is the existing reset screen (`lib/features/auth/presentation/password_reset_screen.dart`). They enter the e-mail, the code and their own password (minimum 4).
- **The new server branch:** completing a `first_login` code also moves the login from `provisioned` to **`active`**. This is guarded in SQL, so only that path makes the move. It audits `teacher.activated` (closes G2).
- On first sign-in, the app already reports the phone's time zone (PD-22) and offers the app lock (PD-23). Nothing else is forced.
- **Code lost or expired:** **Send a new set-up code** on the Teacher File or in Accounts. This is the existing PD-21 reset route; for a `provisioned` login it issues a `first_login` code.
- **A wrong e-mail before first sign-in:** **Change sign-in e-mail** is allowed while the login is still `provisioned`. After that, it is super admin only.

### 3.4 Duplicate checks

| Case | Rule |
|---|---|
| The e-mail is already the sign-in of **any** account (any kind, compared case-insensitively) | **Blocks** with `ACCOUNT_EXISTS`. If it is a former teacher of this organization: "This person was a teacher here. Reactivate them instead" (§3.6). Otherwise: "This e-mail already signs in to Chat." No name, kind or family is disclosed. |
| The same e-mail or phone (E.164) is on another **teacher's** file | **Blocks**, naming the teacher (staff with this key may see teachers). |
| The same normalized name as an active teacher | **Warns** ("Possibly already added: «name»"). The creator may continue. Name normalization is PD-42's §7 rule. |
| Double submit | A client-chosen `id`: `on conflict do nothing`, returning the first result. |
| Two staff adding the same e-mail at once | The advisory lock; the second gets `ACCOUNT_EXISTS`. |

**Known limit:** login stays case-sensitive (`auth.service.ts:194`). PD-43 stores teacher sign-ins in lower case, and the form shows the exact sign-in. Making login case-insensitive for every kind is a separate, wider change; it is recorded as a follow-up, not done here.

### 3.5 The set-up checklist (closes G4)

Computed by `chat.teacher_setup_state(teacher_id)`, read-only, from the real rows:

| Item | Done when | Owner |
|---|---|---|
| Signed in | login `active` | teacher |
| Supervisor | an assignment to a live primary supervisor | Teachers Manager |
| Contact | Teacher File has a phone or an e-mail | Teachers Manager |
| Pay terms | a `teacher_pay_terms` row effective this month | super admin |
| Payout account | a payout row | super admin |
| Leave allowance | a row for this year | Teachers Manager |
| Shift | a current `teacher_work_pattern`; an `hourly` category matches an `hourly` salary type (closes G7 as a **warning**) | Teachers Manager |
| Availability | at least one window, or category `hourly` | Teachers department |
| Profile | a professional profile saved | teacher |

Where it shows:
- **Teacher File list:** a "Setup incomplete (n)" badge and filter.
- **Teacher File detail:** a checklist card, each line linking to the existing section.
- **Teacher pickers** (Sales subscription form, Change teacher preview): a "Setup incomplete" or "Not signed in yet" note. This is a **warning, not a block** (§8 Q5).
- The super admin sees the pay items; others see "Pay: set by the super admin" with no amounts.

**Time zones (G6), kept small.** The shift and availability forms default their zone to the teacher's reported zone when one exists, else the academy zone. They are not merged into one column; that would be its own decision.

### 3.6 Offboarding (closes G8, G9)

**Offboard teacher** (non-disciplinary: resignation, end of contract) on the Teacher File:

1. **Preview** (`GET /teachers/:id/offboard-preview`) lists:
   - students still assigned, each with **Change teacher**;
   - open lessons and trials from today;
   - an open leave request;
   - the current payroll month (super admin).
2. **Refused while any student remains.** This is the discipline ladder's rule, now also in SQL.
3. `POST /teachers/:id/offboard {reason, lastDay?, cancelOpenLessons}` does, in one transaction through `chat.offboard_teacher(...)`:
   - `deactivate_principal('teacher', …, 'deactivated')`;
   - the **login** → `deactivated`, and every session revoked;
   - the supervisor assignment ended; the "Former supervisor" display already exists;
   - open lessons cancelled, as the ladder does;
   - the audit row `teacher.offboarded`.
4. **Kept:** the Teacher File, the pay history, the supervision timeline and evaluations, all read-only. The supervision chat stays readable for staff.
5. **Rejoining:** **Reactivate teacher** (`POST /teachers/:id/reactivate`) brings back the same record and history with a new set-up code. Super admin only (§8 Q6).

**Fixes on the way:**
- Accounts → **Set inactive** on a teacher login also marks the teacher "Login suspended" in the pickers (G8). It stays a warning, because suspension is temporary.
- `chat.teacher` gains the `is_active`/`left_at` agreement check. It is added `not valid`, then validated after a pre-flight query.
- The supervisor assignment takes an optional reason and is audited (`teacher.supervisor_changed`, G10).

---

## 4. Permissions (PD-40 keys; deny by default; row scope in Layer 2)

Teachers are not staff accounts, so PD-40 PR-3's `/admin/staff-accounts` and its hierarchy rules (H1–H10) do not apply to them. Teacher accounts are administered under #167's approved rule: **the super admin and the Teachers department**. The keys below follow #172's catalogue. **Two are new.**

| Action | Route | Key | Bundles (#174) | Layer-2 rule |
|---|---|---|---|---|
| Add a teacher | `POST /teachers` (new) | **`teachers.create`** (new; risk `admin`, introduced by PD-43, non-delegable) | `manager:teachers` (+ super admin `*`) | Teachers Manager of the same organization, or super admin |
| Give sign-in to an existing teacher without one | `POST /teachers/:id/sign-in` (new) | `teachers.create` | as above | the teacher has no `account_id` |
| Change sign-in e-mail before first sign-in | `PATCH /teachers/:id/sign-in` (new) | `teachers.create` | as above | login still `provisioned`; afterwards super admin only |
| Send a new set-up code / reset | `POST /admin/accounts/:id/password-reset` (exists) | `accounts.administer` (exists) | `supervisor:teachers`, `manager:teachers` | #167 `accountAdminActs(kind 'teacher')`; issues `first_login` for a `provisioned` login |
| Suspend / reactivate the login | `/admin/accounts/:id/suspend` and `…/reactivate` (exist) | `accounts.administer` | as above | #167 |
| Assign or change the supervisor | `POST /org/teachers/:id/supervisor` (exists) | `org.manage` (exists) | `manager:*` | `TeacherSupervisorService.requireAssigner`: Teachers Manager or super admin |
| Personal record | `POST /teacher-files/:id/personal` (exists) | `teacher_files.edit` | `manager:teachers` | `decideTeacherFileAccess` |
| Leave allowance | `POST /teacher-files/:id/leave-allowance` (exists) | `leave.allowance` | `manager:teachers` | unchanged |
| Pay terms, payout account | `/teacher-files/:id/finance/*` (exist) | `teacher_files.finance` | super admin only | `canViewFinance` |
| Shift | `POST /teachers/:id/work-pattern` (exists) | `schedule.manage` | Teachers and Operations | `canEditShifts`: Teachers Manager, super admin |
| Availability, days off | `/teachers/:id/availability`, `…/days-off` (exist) | `schedule.manage` | as above | unchanged |
| Open the supervision chat | `POST /teachers/:id/supervision-conversation` (exists) | `supervision.chats` | Teachers | unchanged (also done inside `POST /teachers`) |
| First students: Change teacher | `POST /learners/:id/transfer` (exists) | `students.manage` | Operations, Teachers | `chat.transfer_learner` |
| First students: Sales form | `GET /trials/teachers`, `POST /trials/:id/subscription` (exist) | `trials.view` / `trials.manage` | Sales, Operations, Teachers | `chat.enrol_learner` |
| Read the checklist | `GET /teachers/:id/setup` (new); a summary on `GET /teacher-files` | `teacher_files.view` | Teachers | Teachers scope (PD-35 strict when ON) |
| Teacher history (audit) | `GET /teachers/:id/history` (new) | `teacher_files.view` | Teachers | as above |
| Offboard preview, offboard | `GET /teachers/:id/offboard-preview`, `POST /teachers/:id/offboard` (new) | **`teachers.offboard`** (new; risk `admin`, PD-43, non-delegable) | `manager:teachers` (+ super admin) | Teachers Manager or super admin; no students left |
| Reactivate a former teacher | `POST /teachers/:id/reactivate` (new) | `teachers.offboard` | super admin only (Layer 2) | §8 Q6 |
| Permanent suspension (disciplinary) | `/discipline/violations/:id/decide` (exists) | `discipline.manage` (`teacher_supervision.record` after #175) | Teachers | unchanged |

**Catalogue entries to add** (handed to the PD-40 session; whichever lands second adds them):

```
'teachers.create':   { label: { en: 'Add teachers and give them a sign-in', ar: 'إضافة المعلمين ومنحهم حساب الدخول' }, risk: 'admin', introducedBy: 'PD-43' },
'teachers.offboard': { label: { en: 'Offboard and reactivate teachers',     ar: 'إنهاء عمل المعلمين وإعادة تفعيلهم' }, risk: 'admin', introducedBy: 'PD-43' },
```

Both go only into `manager:teachers`. If PD-43 lands after #174, its migration seeds them into `chat.permission` and the bundle table (`PD040_WRITE_SEED=1`). The route table is regenerated (`PD040_WRITE_ROUTE_TABLE=1`).

**Why not reuse `accounts.administer` for creation?** It is held by every Teachers **supervisor** and by Operations and Sales (for parents). Creating a person is a hiring act, not account support.

---

## 5. Existing teachers and the Core migration

- **There is nothing to import from Core.** Core has no teacher entity (`20260910120000:42-45`; `teacher-profile.service.ts:159`), so PD-42's question of "enter by hand or import" does not arise the same way. Teachers are tens of people, not hundreds of families.
- **Recommendation: no bulk tool.** The Teachers Manager enters each current teacher with the **same Add teacher form**, then completes the checklist. A CSV import is not worth its validation and duplicate-handling cost at this size (§8 Q7).
- **Teacher rows already in Chat** (inserted by SQL) get:
  - **Give sign-in** when they have no login;
  - the checklist for everything else.

  A one-off read-only report on the Teacher File list ("Setup incomplete", "Not signed in", "No supervisor") replaces any SQL audit.
- **Order with PD-42.** Teachers should be entered **before** supervisors start PD-42's family intake. The intake's teacher field is optional (PD-42 §6), but a family entered without a teacher needs a second pass. So PD-43 PR-2 and PR-3 should merge before or with PD-42 PR-2.
- **Strict scope.** Requiring a supervisor at creation means the strict-scope precondition holds for every teacher added through PD-43. Rows inserted before PD-43 still need the existing Organization screen.

---

## 6. How it meets the other decisions

- **PD-21 / #167.** Teacher logins are administered by the super admin and the Teachers department. PD-43 adds creation and offboarding as separate, manager-level keys.
- **PD-40.**
  - Two keys are added to the catalogue.
  - The `first_login` code purpose is **the same primitive PD-40 PR-3 plans for staff** (#164 §6.1). Whichever PR lands first builds it, and the other reuses it. This is a coordination item with the PD-40 session.
  - Staff keep PD-40's own minimum. Teachers keep 4 (owner, #171).
- **PD-22.** The teacher's zone is automatic from their phone. PD-43 only defaults the shift and availability zones from it.
- **PD-26 / #175.** The Teacher Supervision page and the discipline ladder are unchanged. Disciplinary permanent suspension stays separate from offboarding.
- **PD-35.**
  - A supervisor is set at creation. The assignment gains an optional reason and an audit row.
  - Strict scope applies to the checklist and the new reads as it does to the Teacher File.
- **PD-31 / PD-38.** They are unchanged. The checklist reads their rows.
- **PD-18.** It is unchanged. Pay stays super admin only (§8 Q8).
- **Teacher Account (frozen).** No new screen. The client change is copy on the existing code screen, so "I have a code" reads as set-up as well as reset.
- **Frozen call workstreams W1–W8.** Not touched.

---

## 7. PR breakdown (each merged by hand after green CI)

| PR | Contents | Tests | Depends on |
|---|---|---|---|
| **PR-0** (this) | the plan, the PD-43 claim, slot `20261027180000` | `guards.sh` | — |
| **PR-1, data** | Migration `20261027180000_chat_pd043_teacher_onboarding`: `password_reset_code.purpose` (`reset`/`first_login`) with its TTL; activation `provisioned → active` only through a `first_login` completion (SQL guard); `chat.create_teacher`, `chat.offboard_teacher` (students guard in SQL), `chat.reactivate_teacher`; `chat.teacher_setup_state`; the `is_active`/`left_at` check (`not valid`, then validated); audit of supervisor changes; seed rows for the two keys if #174 is in the base | Integration spec `pd043-teacher-onboarding` (CI G-19): each writer refuses a request role, a duplicate, a cross-organization supervisor, and offboarding with students. A provisioned login cannot sign in until the code is completed. The migration re-applies as a no-op. | coordinate the code purpose with PD-40 PR-3 |
| **PR-2, API** | `TeacherOnboardingService`: create, give sign-in, change sign-in, setup, history, offboard preview, offboard, reactivate. A DB-free `decideTeacherOnboarding` matrix. Duplicate checks and the lock. Reset issues `first_login` for provisioned logins. Catalogue keys, bundles, `@Requires` on every new route, a regenerated route table. API contract and error codes. | Unit: the decision matrix, duplicates, normalization. Route spec plus the `pd040-routes` guard. Integration: create → code → login → `/me` → the supervision chat exists, with the supervisor in it. | PR-1; #172 merged |
| **PR-3, Admin Web** | The Add teacher dialog (Teacher Files, Organization, `/admin/teachers`); the one-time code panel; the checklist card and list badge and filter; the "Setup incomplete" / "Not signed in" notes in the Sales form and the Change teacher preview; Give sign-in; Change sign-in e-mail; the supervisor reason field | Vitest: the form's validation, the code shown once, checklist rendering per role (no pay amounts for non-super-admins), buttons hidden without a key | PR-2 |
| **PR-4, offboarding UI** | The Offboard dialog with preview and links to Change teacher; Reactivate (super admin); the Accounts "Login suspended" note | Vitest; one integration case for the offboard refusal in PR-1/2's spec | PR-2 |
| **PR-5, client copy** | The Flutter code screen reads "I have a set-up or reset code" (ar and en) | Flutter widget test, run locally (CI runs no Flutter) | — |
| **PR-6, docs** | PD-43 in boundary doc §4; `docs/admin/pd043-adding-a-teacher.md` (the checklist runbook for the Teachers Manager); `AUTHORIZATION-MODEL.md` footnote 5 updated; `core-integration-contract.md` gap 5 closed | `guards.sh` | PR-2 |

PR-3 and PR-4 can be built side by side once PR-2's contract is frozen. Within the machine-load rules, at most two builder sessions run at once.

---

## 8. Owner questions (each with a recommendation)

1. **Who may add a teacher?**
   *Recommendation:* the **Teachers Manager and the super admin**. Teacher supervisors complete parts of the checklist but do not hire. Alternative: any Teachers department member.
2. **What does a teacher sign in with?**
   *Recommendation:* **their e-mail**, required, stored in lower case. A phone stays in the Teacher File as contact only. Alternative: a phone number as the sign-in, for teachers without an e-mail. It works, but it rules out e-mail self-recovery later.
3. **How does the teacher receive the set-up code, and for how long is it valid?**
   *Recommendation:* **shown once to the person who added them**, to hand over in person or by WhatsApp, valid **72 hours**, 5 tries. Also e-mailed if the owner answers PD-40 Q5 "e-mail it", so staff and teachers work the same way.
4. **Is a supervisor required when adding a teacher?**
   *Recommendation:* **yes**. This keeps strict scope safe to turn on. The only exception is while the Teachers department has no supervisor at all.
5. **May a teacher whose set-up is incomplete be given students?**
   *Recommendation:* **yes, with a visible warning** ("Setup incomplete", "Not signed in yet") in the Sales form and Change teacher. A hard block would stall the migration. Alternative: block until signed in.
6. **Offboarding: who, and what happens?**
   *Recommendation:*
   - the Teachers Manager or the super admin may offboard;
   - students must be moved first;
   - the login is closed and all history is kept read-only;
   - **only the super admin** may reactivate a former teacher, with the same record and a new set-up code.
7. **Existing teachers for the Core migration: a bulk import, or by hand?**
   *Recommendation:* **by hand, with the same form**. Core holds no teacher records, and there are tens of teachers. Enter them before PD-42's family intake starts.
8. **Who sets a teacher's pay?**
   *Recommendation:* **the super admin, as today**. When PD-40 adds an Accountant specialist role, grant it `teacher_files.finance`; no PD-43 change is needed.

---

## 9. Out of scope

- Subjects and levels as structured data (only free text exists).
- Case-insensitive login for every account kind (the follow-up in §3.4).
- Merging the three time-zone columns.
- Teacher self-service password recovery by e-mail. PD-25 is for parents; it could be extended later.
- Moving all of a teacher's students in one action. Offboarding links to Change teacher per student.
- Any change to what a teacher can do in the app.
