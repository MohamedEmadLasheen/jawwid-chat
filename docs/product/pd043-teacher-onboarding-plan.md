# PD-43: adding a new teacher (review and plan)

**State:** plan for approval, **revision 3**. On 2026-10-27 the owner answered Q1–Q8 and the follow-ups N1–N3, relayed verbatim by the department head. All are recorded as DECIDED in §8. No feature code has been written.
**Claim:** `docs/product/pd-registry/PD-43.md`. Migration slot `20261028100000` (`chat_pd043_teacher_onboarding`), renumbered by PR-1 from the plan's `20261027180000`: it must run after PD-40's `20261027190000`, whose tables it writes.
**Base:** `main` @ `6709bba7`. PD-40 is read from its open stack: #164 (plan), #167 (account-admin rule, approved), #172 (route keys, `claude/pd40-route-permissions`) and #174 (data model, `claude/pd40-access-model`). PD-42 is read from #173 (plan v2).

The owner's request, verbatim:

> "We need a clear plan for adding teachers to the system. How should a new teacher be added, and what is the complete workflow from creating the teacher's account to assigning their permissions and setting them up in the system?"

---

## What changed in revisions 2 and 3

The owner's answers (§8) change four things:

| Answer | Change in this plan |
|---|---|
| Q1 "Also teacher supervisors" + N1 "They may leave it empty" | A **teacher supervisor** may add a teacher. They either supervise the new teacher themselves or leave the supervisor empty; they may **not** pick another supervisor (§3.2). Choosing or changing a supervisor stays with the Teachers Manager and the super admin (`org.manage`). Supervisors get `teachers.create` but not `teachers.offboard`. Duplicate checks never reveal a teacher outside the adder's scope (§3.4). |
| Q4+Q5 "Supervisor optional; students allowed" + N3 "Yes, Manager covers them" | The supervisor is **optional**. §3.7 defines an **unsupervised teacher**: the Teachers Manager covers them until one is set. Strict scope may be turned on while some teachers are unsupervised. The "Unsupervised" count is a readiness check, not a blocker, and the PD-35 runbook is updated in this PR. Pickers still show "Setup incomplete"; nothing is blocked. |
| Q8 "Super admin and Teachers Manager for now" + N2 "Full teacher finance" | `manager:teachers` gets **`teacher_files.finance`**, and Layer-2 `canViewFinance` is extended to the Teachers Manager (§3.8). Each thing that opens is listed:<ul><li>bank-detail reveals stay audited every time;</li><li>the deduction-default DB guard is widened to the Teachers Manager;</li><li>`canViewAmounts` follows;</li><li>pay-terms and payout-account writes are narrowed in the DB to the super admin or the Teachers Manager.</li></ul>Operations is unchanged. The narrow `teacher_files.pay_terms` key from revision 2 is **dropped**. |
| Q2, Q3, Q6, Q7 | As recommended. |

---

## Summary

- **Nobody can add a teacher today.** The API has no route that creates a teacher or a teacher login. The Admin Web has no form for it. The only code that creates a teacher is the local QA seed, which refuses to run on a live system. A real teacher today needs a developer and SQL (§1.1).
- **A teacher is not a staff member.** It is its own record (`chat.teacher`) with its own login kind (`teacher`). So a teacher does not join a department and holds no permissions of its own. The Teachers department is the *staff* who supervise teachers. "Assigning a teacher's permissions" therefore means two things (§1.3):
  1. which supervisor the teacher has (PD-35);
  2. which students and groups the teacher is given.
  What a teacher may do in the app is fixed by the closed Teacher Account scope (Chats · Schedule · Calls · Settings) and is not configured per person.
- **Proposed workflow** (§3): the **Teachers Manager**, a **teacher supervisor** or the super admin adds the teacher with **one short form**. It asks for name and sign-in e-mail, with supervisor, phone and joining date optional. A supervisor who adds a teacher either becomes that teacher's supervisor or leaves it empty. The server then does everything below in one transaction:
  - creates the teacher, a login that waits for set-up, the Teacher File and, when one is given, the supervisor assignment;
  - opens the supervision chat;
  - produces a **set-up code**.

  The teacher signs in with the code, chooses their own password (minimum 4) and is active. Everything else is completed afterwards, and a **set-up checklist** shows what is missing:
  - pay terms and payout account;
  - leave allowance;
  - shift and availability;
  - the teacher's own profile;
  - the first students.
- **Offboarding** gets a proper action (§3.6). It requires that no students are left. It then closes both the teacher record and the login, ends the supervisor link and is audited. Today a teacher can only leave through the discipline ladder or an operator CLI.
- **Permissions** (§4): two new PD-40 keys and one bundle change:
  - `teachers.create` (new), for the Teachers Manager and teacher supervisors;
  - `teachers.offboard` (new), for the Teachers Manager;
  - `teacher_files.finance`, which already exists, is added to the Teachers Manager's bundle (owner N2).

  Every other step uses keys that already exist (`accounts.administer`, `org.manage`, `teacher_files.*`, `leave.allowance`, `schedule.manage`, `students.manage`).
- **Core migration** (§5): Core has no teacher entity, so there is nothing to import. Existing teachers are entered with the same form by the Teachers Manager or their teacher supervisors. Teacher rows already in Chat without a login get **Give sign-in**. Teachers should be entered **before** PD-42's family intake, so supervisors can pick them.
- **Six small PRs** (§7), each with its tests. **All owner questions are DECIDED**: Q1–Q8 and the follow-ups N1–N3 (§8).

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
| 1. Add the teacher (one form) | **Teachers Manager**, a **teacher supervisor** (Q1), or the super admin | day 0 |
| 2. Hand over the set-up code | whoever added the teacher | day 0 |
| 3. Set own password, sign in | **the teacher** | within 72 h |
| 4. Pay terms, payout account, bonus and deduction amounts | **Teachers Manager** or the super admin (Q8, N2; §3.8) | before the first payroll month |
| 0. A supervisor, if none was set when the teacher was added | **Teachers Manager** or the super admin (§3.7) | any time |
| 5. Leave allowance for the year | Teachers Manager | first week |
| 6. Shift and category (PD-38), then availability (PD-31) | Teachers Manager (shift); Teachers department (availability, days off) | before students |
| 7. Professional profile and photo | **the teacher** | first week |
| 8. First students | **Sales** (subscription form) for new families; **Operations or Teachers department** via Change teacher for existing children | when ready |
| 9. Supervisor's first check-in in the supervision chat | **the teacher supervisor** | first week |

No HR or finance department exists in Chat. `finance` is a legacy staff role with no bundle (#174, `legacy-bundles.ts`). Teacher payroll (`teacher_files.finance`) belongs to the super admin and the Teachers Manager now. Later, an Accountant specialist role is granted the same key, with no PD-43 change (Q8).

### 3.2 Step 1: Add a teacher (the minimum)

**Who:** the Teachers Manager, a **primary** teacher supervisor (`position = 'supervisor'` in the Teachers department, the only position that can hold teachers), or the super admin. Q1 made teacher supervisors eligible.

**Where:**
- Teacher Files → **Add teacher**;
- the same button on Organization → Teachers & supervisors;
- the super admin's `/admin/teachers`.

**The form:**

| Field | Required | Why |
|---|---|---|
| Full name | **yes**, 1–120 characters | `chat.teacher.name` is `NOT NULL`. Every chat surface shows it. The teacher may rename themself later. |
| Sign-in e-mail | **yes** (§8 Q2) | It becomes `chat.account.subject`, stored trimmed and lower-cased. It is also saved as the Teacher File e-mail. |
| Teacher supervisor | **optional** (Q4). The form behaves differently by who is adding: | |
| | the **Teachers Manager / super admin**: a picker of primary supervisors, empty by default, with "No supervisor yet" allowed | An unsupervised teacher is handled as in §3.7. The form warns: "Until a supervisor is set, the Teachers Manager is responsible for this teacher." |
| | a **teacher supervisor**: two choices only, **"Me"** (the default) or **"No supervisor yet"**. They cannot pick another supervisor (N1). | With "Me", the supervisor keeps sight of the teacher under strict scope. With "No supervisor yet", the Teachers Manager covers the teacher and is notified (§3.7). **Under strict scope the adding supervisor then no longer sees the teacher they added**: this is expected, and was the owner's choice. The form says so before saving. Only the Teachers Manager or the super admin may later set or change a supervisor (`org.manage`, unchanged). |
| Phone | no | Teacher File, admin-only (`20261018170000:42`) |
| Joining date | no, defaults to today | Teacher File `joined_on` |
| Teaching market | no | Teacher File |
| Note | no | added to the audit reason "teacher added" |

**`POST /api/v1/teachers`** (new) does all of the following in **one transaction**, through a SQL writer `chat.create_teacher(...)`:
1. Duplicate checks (§3.4), under `pg_advisory_xact_lock` on the normalized e-mail.
2. `chat.account`: kind `teacher`, status **`provisioned`**, so `is_active` is false.
3. `chat.teacher`: `account_id`, name, active.
4. `chat.teacher_file`: e-mail, phone, joining date, market.
5. `chat.teacher_supervisor_assignment`, when a supervisor is given. For a supervisor adding the teacher, the writer accepts **only the actor or none** and refuses any other supervisor. That is the one way a supervisor writes an assignment; the existing assignment guard still requires a primary supervisor (`20261026160004:60-94`).
6. The **supervision chat**, created at once (`ensureInTx`). The teacher's Chats tab is never empty, and the supervisor, or the Teachers Manager for an unsupervised teacher, has a place to welcome them (closes G5).
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

**Scope rule (Q1).** A check may name a teacher only if the adder could already open that teacher's Teacher File:
- the Teachers Manager and the super admin see every teacher;
- a teacher supervisor sees the teachers in their scope: every teacher with strict scope OFF, only their own with it ON (PD-35 `TeacherScopeService`; `chat.staff_teacher_scope`, `20261026160006:81-116`).

Outside that scope the answer is the same generic refusal whether or not a match exists. The Teachers Manager gets a notification naming both teachers, so the case is resolved by someone who may see it.

| Case | Adder sees the match | Adder does not see the match |
|---|---|---|
| The e-mail is already the sign-in of **any** account (any kind, compared case-insensitively) | **Blocks** with `ACCOUNT_EXISTS`. For a former teacher of this organization, the Manager and the super admin see: "This person was a teacher here. Reactivate them instead" (§3.6). | **Blocks** with `ACCOUNT_EXISTS`: "This e-mail already signs in to Chat. Ask the Teachers Manager." No name, kind or family is disclosed. This is the same answer for a parent, staff or teacher account. |
| The same e-mail or phone (E.164) is on another **teacher's** file | **Blocks**, naming the teacher | **Blocks**: "This contact is already on a teacher's file. Ask the Teachers Manager." |
| The same normalized name as an active teacher | **Warns** ("Possibly already added: «name»"). The adder may continue. Normalization is PD-42's §7 rule. | **No warning.** A name match alone is too weak to justify a refusal, and naming it would disclose. |
| Double submit | A client-chosen `id`: `on conflict do nothing`, returning the first result. |
| Two staff adding the same e-mail at once | The advisory lock; the second gets `ACCOUNT_EXISTS`. |

**Known limit:** login stays case-sensitive (`auth.service.ts:194`). PD-43 stores teacher sign-ins in lower case, and the form shows the exact sign-in. Making login case-insensitive for every kind is a separate, wider change; it is recorded as a follow-up, not done here.

### 3.5 The set-up checklist (closes G4)

Computed by `chat.teacher_setup_state(teacher_id)`, read-only, from the real rows:

| Item | Done when | Owner |
|---|---|---|
| Signed in | login `active` | teacher |
| Supervisor | an assignment to a live primary supervisor. Optional (Q4), so this is a **warning** item: "Supervised by the Teachers Manager until one is set". | Teachers Manager |
| Contact | Teacher File has a phone or an e-mail | Teachers Manager |
| Pay terms | a `teacher_pay_terms` row effective this month | Teachers Manager or super admin (Q8) |
| Payout account | a payout row | Teachers Manager or super admin |
| Leave allowance | a row for this year | Teachers Manager |
| Shift | a current `teacher_work_pattern`; an `hourly` category matches an `hourly` salary type (closes G7 as a **warning**) | Teachers Manager |
| Availability | at least one window, or category `hourly` | Teachers department |
| Profile | a professional profile saved | teacher |

Where it shows:
- **Teacher File list:** a "Setup incomplete (n)" badge and filter.
- **Teacher File detail:** a checklist card, each line linking to the existing section.
- **Teacher pickers** (Sales subscription form, Change teacher preview): a "Setup incomplete", "Not signed in yet" or "No supervisor" note. This is a **warning, not a block** (Q5: "students allowed").
- The pay items show only **done / not done**, never an amount. Each item names who completes it.

**Time zones (G6), kept small.** The shift and availability forms default their zone to the teacher's reported zone when one exists, else the academy zone. They are not merged into one column; that would be its own decision.

### 3.6 Offboarding (closes G8, G9)

**Offboard teacher** (non-disciplinary: resignation, end of contract) on the Teacher File:

1. **Preview** (`GET /teachers/:id/offboard-preview`) lists:
   - students still assigned, each with **Change teacher**;
   - open lessons and trials from today;
   - an open leave request;
   - the current payroll month (Teachers Manager, super admin).
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

### 3.7 An unsupervised teacher (Q4: "Supervisor optional")

**Definition.** A teacher is **unsupervised** when no live primary supervisor holds them. That is either:
- no `teacher_supervisor_assignment` row; or
- a row whose supervisor has left the Teachers department or is no longer active.

`chat.staff_teacher_scope` already treats both the same way: "an assignment left behind grants nothing" (`20261026160006:106-114`). This is exactly the "Unassigned" state the Organization page shows today.

**The rule: until a supervisor is set, the Teachers Manager is that teacher's supervisor.** This is what the code already does under strict scope. PD-43 makes it explicit and visible.

| Surface | Strict scope **OFF** (today, everywhere) | Strict scope **ON** |
|---|---|---|
| Who works on the teacher (Teacher File, leave, discipline, lessons, statistics, Change teacher) | the whole Teachers department, as for every teacher | the **Teachers Manager** and the super admin only. Discipline and leave already require `canSupervise` plus `requireTeacherInScope` (`apps/api/src/discipline/discipline.service.ts:587-600`). |
| Supervision chat | the teacher plus the whole department (PD-12) | the teacher plus the **Teachers Manager**. Re-seating keeps "the teacher's own supervisor and the Teachers Manager" (`docs/admin/pd035-teacher-supervisors.md`, Re-seating), and here there is no own supervisor. |
| Trial group | the whole department | the Teachers Manager |
| A leave request | any department member decides | the Teachers Manager decides |
| Join a family or student group (`supervision` seat) | only the teacher's own supervisor or the Manager, in both modes (PD-35) | the Teachers Manager |

**Where the Teachers Manager sees them:**
- **Teacher Files → filter "Unsupervised"**. The filter, a count badge and an **Assign supervisor** shortcut are visible to the Manager and the super admin; the shortcut uses `org.manage`.
- **Organization → Teachers & supervisors** keeps its existing "{n} teachers have no supervisor" banner (`OrganizationPage.tsx:100-102`).
- The **set-up checklist** shows "Supervised by the Teachers Manager until one is set" (§3.5).
- A **notification to the Teachers Manager** when:
  - a teacher is added without a supervisor, by anyone, including a supervisor who chose "No supervisor yet"; or
  - a supervisor leaves the department or is deactivated with teachers still assigned. That cannot happen silently today for a department move, which the guard refuses (`20261026160004:98-112`), but it can when the supervisor is deactivated.

**Pickers.** Students are allowed (Q5). The Sales form and Change teacher show "No supervisor" beside "Setup incomplete", as a warning only.

**Strict scope readiness (N3, DECIDED).** Strict scope may be turned on while some teachers are unsupervised; the Teachers Manager covers them. The "Unsupervised" count, on Organization and in the Teacher Files filter, is the **readiness check, not a blocker**. This PR updates the precondition in `docs/admin/pd035-teacher-supervisors.md` to match.

### 3.8 Pay: the Teachers Manager gets full teacher finance (Q8, N2)

**DECIDED (N2, "Full teacher finance").** `manager:teachers` gets `teacher_files.finance`, and Layer 2's `canViewFinance` is extended to the Teachers Manager. A key is necessary, never sufficient, so without the second change the key would grant nothing. Today `canViewFinance` is **super admin only** (`apps/api/src/platform/teacher-file-policy.ts:47-48`; the service header at `apps/api/src/teacher-file/teacher-payroll.service.ts:12-30`).

**Everything that opens to the Teachers Manager, item by item:**

| Route (#174 route table) | What it reveals or does | Under "full" | Evidence |
|---|---|---|---|
| `GET /teacher-files/:id/finance` | all pay terms (type, amount, currency, reason, author); the payout method and last 4 digits; every bonus and deduction amount with its reason; unpriced bonuses and deductions; the monthly summary (paid minutes, base, bonuses, deductions, net) | the Manager sees it all | `teacher-payroll.service.ts:66-122` |
| `POST …/finance/terms` | sets pay terms | the Manager may write. **The DB is narrowed** to the super admin or the Teachers manager; today any active staff may write a pay row (`20261021160000:155-160`). | `:127` |
| `POST …/finance/payout-account` | sets the payout account | the Manager may write; **the DB is narrowed** the same way | `:168` |
| `POST …/finance/payout-account/reveal` | shows the full bank or wallet details | the Manager may reveal. **Every reveal stays audited with its reason**, unchanged. The audit row names what was revealed, never the details. | `:202-219` ("Every reveal is audited with its reason") |
| `POST …/finance/adjustments` | prices a bonus or deduction, or adds one | the Manager may write. The DB rule is **not** narrowed, because PD-26's automatic pricing writes these rows as the supervisor who decided the deduction (`chat.price_decided_deduction`, `20261022150000:238-274`, `created_by = decided_by`). | `:231` |
| `POST /teacher-files/:id/rewards` | a reward with its amount (PD-26 #144) | the Manager may write | `:432` |
| `GET` / `POST /teacher-files/finance/deduction-defaults` | the default deduction amounts | the Manager may read and set them. **The DB guard is widened explicitly**: `chat.guard_teacher_pay_default` allows the super admin only today (`20261022150000:213-226`); PD-43 adds the Teachers manager. | `:319`, `:345` |
| `POST /teachers/:id/bonus` | a reward without an amount | not part of this. #172 maps it to `teacher_files.finance`; the #175 agreement moves it to `teacher_supervision.record`. | #172 route table |
| `canViewAmounts` (a flag, no route) | amounts on `GET /teacher-files/rewards` and the Teacher Supervision page's amount column | **follows `canViewFinance`**, so the Manager sees amounts. Supervisors and Operations still do not. | `teacher-payroll.service.ts:397-408`; `apps/admin-web/src/features/teacher-supervision/RewardsAndComplaints.tsx:60` |

**Unchanged:**
- **Operations.** `OPERATIONS_MEMBER` does not get the key (#174 `legacy-bundles.ts:69-93`), and PD-26's "no amounts for Operations" holds.
- **Teacher supervisors** (`supervisor:teachers`): no key, `canViewFinance` false, no amounts.
- **Admin Web.** The Payroll section is already gated by `canViewFinance` (`apps/admin-web/src/features/teacher-files/Payroll.tsx:28-35`), so it appears for the Manager with no client change. The tests pin that it shows for the Manager and not for a supervisor.

**Later:** an Accountant specialist is granted `teacher_files.finance`. Its Layer-2 basis is then "holds the key" rather than "Teachers Manager". That is one more branch in `decideTeacherFileAccess`, decided when PD-40 adds the role.

---

### 3.9 Give sign-in: a teacher who exists but has no login (department head, 2026-10-28)

Teachers inserted before PD-43 have a `chat.teacher` row and no `account_id`, so they can never sign in (§1.1). PD-43 gives them a login **in place**: same teacher, same students, same history.

**Who** (department head, #198): the **reissue** rule, because an existing teacher is a live identity:
- the super admin and the Teachers Manager, for any teacher of the organization;
- the teacher's **current** supervisor, whatever the strict switch says (`chat.may_give_teacher_sign_in`).

The code is always e-mailed, and only the Manager and the super admin see it.

**`chat.give_teacher_sign_in(p_teacher, p_email, p_reason, p_actor_id)`**, in slot `20261028160000`:
- **Refused when:**
  - the teacher is inactive or has left;
  - the teacher already has a login (*"this teacher already has a sign-in"*): a provisioned login gets a new code instead, and an active one gets a reset;
  - the caller may not reach the teacher. This refusal reads as *not found*.
- **Duplicates:** the e-mail and contact checks of `chat.create_teacher` (§3.4), excluding the teacher's own file. The same scoped answers apply in the API (gate P2-5).
- **Writes,** in one transaction, under an advisory lock on the teacher, so two calls at once make one login:
  - a `provisioned` login (`kind = 'teacher'`), linked as `chat.teacher.account_id`;
  - the Teacher File's e-mail, **only if it has none**: an e-mail already on file is not overwritten;
  - the audit row `teacher.sign_in_given`, which never contains the e-mail.
- **Errors:** `check_violation` for every refusal, never `unique_violation` (Prisma drops that message).

**`POST /teachers/:id/sign-in`** (`teachers.create`) takes `{ email, reason? }`. In one transaction it runs the writer, then `issueInTx` for the first sign-in code. It answers `{ teacherId, signIn, firstLogin: { code, expiresAt, emailed } }` with `no-store`. The code is e-mailed after the commit, exactly as for a new teacher.

| Refusal | Answer |
|---|---|
| The teacher already has a login | 409 `COMM.TEACHER_HAS_SIGN_IN` |
| The teacher is inactive or has left | 409 `COMM.TEACHER_FILE_CONFLICT` |
| The teacher is out of the caller's reach, or unknown | 404 `COMM.TEACHER_FILE_NOT_FOUND` |

**Admin Web, on the Teacher File.** The file's detail gains `signIn: { status: 'none' | 'provisioned' | 'active' | 'suspended' | 'deactivated' }` and `access.canManageSignIn`.
- **No login:** a **Give sign-in** button. It asks for the sign-in e-mail, then shows the code once.
- **A login that has never been used:** **Send a new first sign-in code**, which calls #195's `POST /teachers/:id/first-login-code`.
- **Teacher Files list:** a "No sign-in" badge, so the migration intake has a work list.

## 4. Permissions (PD-40 keys; deny by default; row scope in Layer 2)

Teachers are not staff accounts, so PD-40 PR-3's `/admin/staff-accounts` and its hierarchy rules (H1–H10) do not apply to them. Teacher accounts are administered under #167's approved rule: **the super admin and the Teachers department**. The keys below follow #172's catalogue. **Two are new**: `teachers.create` and `teachers.offboard`. One existing key, `teacher_files.finance`, **joins `manager:teachers`**.

| Action | Route | Key | Bundles (#174) | Layer-2 rule |
|---|---|---|---|---|
| Add a teacher | `POST /teachers` (new) | **`teachers.create`** (new; risk `admin`, introduced by PD-43, non-delegable) | `manager:teachers`, **`supervisor:teachers`** (+ super admin `*`) | Teachers Manager, or super admin, with any supervisor or none. A **primary** teacher supervisor only with themselves or none, never another supervisor (§3.2, N1). Duplicate answers are scoped (§3.4). |
| Give sign-in to an existing teacher without one | `POST /teachers/:id/sign-in` (new) | `teachers.create` | as above | the teacher has no `account_id`; a supervisor only for a teacher **in their scope** |
| Change sign-in e-mail before first sign-in | `PATCH /teachers/:id/sign-in` (new) | `teachers.create` | as above | login still `provisioned`; a supervisor only in scope; after first sign-in, super admin only |
| Send a new set-up code / reset | `POST /admin/accounts/:id/password-reset` (exists) | `accounts.administer` (exists) | `supervisor:teachers`, `manager:teachers` | #167 `accountAdminActs(kind 'teacher')`; issues `first_login` for a `provisioned` login |
| Suspend / reactivate the login | `/admin/accounts/:id/suspend` and `…/reactivate` (exist) | `accounts.administer` | as above | #167 |
| Assign or change the supervisor | `POST /org/teachers/:id/supervisor` (exists) | `org.manage` (exists) | `manager:*` | `TeacherSupervisorService.requireAssigner`: Teachers Manager or super admin. **Unchanged:** a supervisor's self-link at creation is written by `chat.create_teacher`, not by this route. |
| Personal record | `POST /teacher-files/:id/personal` (exists) | `teacher_files.edit` | `manager:teachers` | `decideTeacherFileAccess` |
| Leave allowance | `POST /teacher-files/:id/leave-allowance` (exists) | `leave.allowance` | `manager:teachers` | unchanged |
| Pay terms, payout account (and reveal), amounts, payroll, deduction defaults | `/teacher-files/:id/finance/*`, `…/rewards`, `…/finance/deduction-defaults` (exist) | `teacher_files.finance` (exists) | **`manager:teachers` (added)** + super admin | `canViewFinance` **extended to the Teachers Manager**; DB guards per §3.8 |
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

**Bundle changes:**
- `teachers.create` goes into `manager:teachers` and `supervisor:teachers`;
- `teachers.offboard` goes into `manager:teachers` only;
- `teacher_files.finance` (existing) is **added to `manager:teachers`**;
- `OPERATIONS_MEMBER` and `SALES_MEMBER` are unchanged.

The `pd040-legacy-bundles` spec gains the matching Layer-2 rows:
- `teachers.create` ⇔ the Teachers Manager or a Teachers member (Layer 2 then narrows a backup to nothing, and a primary supervisor to self-assignment);
- `teacher_files.finance` ⇔ `canViewFinance`: true for the super admin and the Teachers Manager, false for Teachers members and for Operations.

**These go to the PD-40 session (`local_7ce02ea3…`) only after the department head confirms revision 3.** If PD-43 lands after #174, its migration seeds them into `chat.permission` and the bundle table (`PD040_WRITE_SEED=1`). The route table is regenerated (`PD040_WRITE_ROUTE_TABLE=1`).

**Why not reuse `accounts.administer` for creation?** It is held by every Teachers **supervisor** and by Operations and Sales (for parents). Creating a person is a hiring act, not account support.

---

## 5. Existing teachers and the Core migration

- **There is nothing to import from Core.** Core has no teacher entity (`20260910120000:42-45`; `teacher-profile.service.ts:159`), so PD-42's question of "enter by hand or import" does not arise the same way. Teachers are tens of people, not hundreds of families.
- **DECIDED (Q7): by hand, before families.** There is no bulk tool. Each current teacher is entered with the **same Add teacher form**, then the checklist is completed. A CSV import is not worth its validation and duplicate-handling cost at this size (§8 Q7).
- **Teacher rows already in Chat** (inserted by SQL) get:
  - **Give sign-in** when they have no login;
  - the checklist for everything else.

  A one-off read-only report on the Teacher File list ("Setup incomplete", "Not signed in", "No supervisor") replaces any SQL audit.
- **Order with PD-42.** Teachers should be entered **before** supervisors start PD-42's family intake. The intake's teacher field is optional (PD-42 §6), but a family entered without a teacher needs a second pass. So PD-43 PR-2 and PR-3 should merge before or with PD-42 PR-2.
- **Strict scope.** Supervisors are optional (Q4), so migrated teachers may arrive unsupervised. They are the Teachers Manager's until one is set (§3.7). The "Unsupervised" filter is the work list for finishing the migration. Teachers a supervisor enters are theirs from the start.
- **Who enters them (Q1).** Each teacher supervisor may enter their own teachers, exactly as PD-42 has supervisors enter their own families. The Teachers Manager enters the rest and any teacher whose supervisor is not decided yet.

---

## 6. How it meets the other decisions

- **PD-21 / #167.** Teacher logins are administered by the super admin and the Teachers department. PD-43 adds creation (Manager and supervisors) and offboarding (Manager) as separate keys.
- **PD-40.**
  - Two keys are added to the catalogue, and `teacher_files.finance` joins `manager:teachers`.
  - The `first_login` code purpose is **the same primitive PD-40 PR-3 plans for staff** (#164 §6.1). Whichever PR lands first builds it, and the other reuses it. This is a coordination item with the PD-40 session.
  - Staff keep PD-40's own minimum. Teachers keep 4 (owner, #171).
- **PD-22.** The teacher's zone is automatic from their phone. PD-43 only defaults the shift and availability zones from it.
- **PD-26 / #175.**
  - The Teacher Supervision page and the discipline ladder are unchanged. Disciplinary permanent suspension stays separate from offboarding.
  - Operations' access is unchanged: no pay key, and no amounts.
- **PD-35.**
  - The supervisor is optional. A supervisor who adds a teacher may link the teacher to themselves or leave it empty; only the Manager or the super admin chooses anyone else.
  - The runbook's strict-scope precondition becomes a readiness check (N3), updated in this PR.
  - The assignment gains an optional reason and an audit row.
  - An unsupervised teacher is the Manager's (§3.7).
  - Strict scope applies to the checklist, the duplicate answers and the new reads, as it does to the Teacher File.
- **PD-31 / PD-38.** They are unchanged. The checklist reads their rows.
- **PD-18.** Widened: the Teachers Manager holds full teacher finance, as the super admin does. Reveals stay audited. The DB guards for terms, payout account and deduction defaults name exactly those two (§3.8).
- **Teacher Account (frozen).** No new screen. The client change is copy on the existing code screen, so "I have a code" reads as set-up as well as reset.
- **Frozen call workstreams W1–W8.** Not touched.

---

## 7. PR breakdown (each merged by hand after green CI)

| PR | Contents | Tests | Depends on |
|---|---|---|---|
| **PR-0** (#180, merged) | the plan, the PD-43 claim, slot `20261027180000` (renumbered by PR-1) | `guards.sh` | — |
| **PR-1, data + keys** (as built) | Migration `20261028100000_chat_pd043_teacher_onboarding`: the PD-43 catalogue rows in their own generated block (`teachers.create` for `manager:teachers` and `supervisor:teachers`; `teachers.offboard` and `teacher_files.finance` for `manager:teachers`) with `chat.pd040_catalogue_change`; `password_reset_code.purpose` (`reset`/`first_login`, 72 h); `chat.activate_account_with_code` and the `account_activation_is_by_first_login` guard (provisioned → active only); `chat.create_teacher` (supervisor: any or none for the Manager and super admin, self or none for a primary teacher supervisor); `chat.is_teacher_payroll_author`: terms and payout writes narrowed, the deduction-default guard widened, to the super admin or the Teachers manager. In TypeScript: the two catalogue keys and bundles, `canViewFinance` for the Teachers manager (same commit), `decideTeacherOnboarding`, and `PasswordResetService` issuing and completing `first_login` (generic `account.activated` audit, for PD-40 PR-3 to reuse) | Unit: `pd043-teacher-onboarding-policy`, `pd043-first-login-code`, `pd040-legacy-bundles` rows, `teacher-file-access`, `pd040-catalogue-seed` (the applied 190000 block stays frozen; later rows have their own block). Integration `pd043-teacher-onboarding` (CI G-19), plus `teacher-payroll` and `pd026-teacher-supervision` updated for the Manager holding payroll | the PD-40 stack (merged a547b0e2) |
| **PR-2b, Give sign-in** (next, before the Core-migration intake) | Migration `20261028160000_chat_pd043_give_sign_in`: `chat.give_teacher_sign_in(teacher, email, reason, actor)`. `POST /teachers/:id/sign-in`. The Teacher File page's "Give sign-in" and "Send a new first sign-in code". See §3.9. | Integration `pd043-give-sign-in-http` (CI G-19); Admin Web vitest | PR-2 (#195) |
| **PR-1b, offboarding data** | Own sub-slot (`2026102810xxxx`, claimed when written): `chat.offboard_teacher` (students guard in SQL), `chat.reactivate_teacher`, `chat.teacher_setup_state`, the `is_active`/`left_at` check (`not valid`, then validated), audit of supervisor changes | Integration cases in `pd043-teacher-onboarding` | PR-1 |
| **PR-2, API** | `TeacherOnboardingService`: create, give sign-in, change sign-in, setup, history, offboard preview, offboard, reactivate. A DB-free `decideTeacherOnboarding` matrix: adder × supervisor choice × strict scope. Scoped duplicate checks and the lock. Reset issues `first_login` for provisioned logins. `canViewFinance` extended to the Teachers Manager. Manager notifications for unsupervised teachers. Catalogue keys, bundles, `@Requires` on every new route, a regenerated route table. API contract and error codes. | Unit: the decision matrix. Duplicate answers identical in and out of scope for a strict-scope supervisor, with no disclosure. Normalization. `decideTeacherFileAccess`: `canViewFinance` is true for the super admin and the Teachers Manager, false for Teachers members and for Ops. Route spec plus the `pd040-routes` guard. Integration: create → code → login → `/me` → the supervision chat exists with the supervisor, or with the Manager when unsupervised. The Manager reads `/finance`, and a reveal writes an audit row. A supervisor gets 403 on `/finance`, and rewards come back without amounts for supervisors and Ops. | PR-1; #172 merged |
| **PR-3, Admin Web** | The Add teacher dialog (Teacher Files, Organization, `/admin/teachers`), with the supervisor field: a picker for the Manager, "Me" / "No supervisor yet" for a supervisor, with the strict-scope notice; the one-time code panel; the checklist card, list badge and filters ("Setup incomplete", "Unsupervised"); the "Setup incomplete" / "Not signed in" / "No supervisor" notes in the Sales form and the Change teacher preview; Give sign-in; Change sign-in e-mail; the supervisor reason field | Vitest: the form's validation, the supervisor field per role, the code shown once, checklist rendering per role, the Payroll section shown for the Manager and hidden for a supervisor, buttons hidden without a key | PR-2 |
| **PR-4, offboarding UI** | The Offboard dialog with preview and links to Change teacher; Reactivate (super admin); the Accounts "Login suspended" note | Vitest; one integration case for the offboard refusal in PR-1/2's spec | PR-2 |
| **PR-5, client copy** | The Flutter code screen reads "I have a set-up or reset code" (ar and en) | Flutter widget test, run locally (CI runs no Flutter) | — |
| **PR-6, docs** | PD-43 in boundary doc §4; `docs/admin/pd043-adding-a-teacher.md` (the checklist runbook for the Teachers Manager); `AUTHORIZATION-MODEL.md` footnote 5 updated; `core-integration-contract.md` gap 5 closed | `guards.sh` | PR-2 |

**PR-2 gates** (from the department head's review of #184, and PD-40's review against the owner's rules for the initial code; each needs a test in PR-2):
- **P2-5.** The duplicate-e-mail answer never reveals that an account exists in **another organization**, and there is no e-mail-check endpoint.
- **P2-7.** The supervision chat is created with `ensureInTx` in the **same transaction** as `chat.create_teacher`.
- **Payout reveal.** A test that the Teachers Manager's reveal of payout details writes its audit row (owner N2).
- **G2, delivery.** The first sign-in code is **e-mailed** to the sign-in address (PD-25's `selectRecoveryMailer`, an Arabic and English first-login template, sent after commit) **and** shown once to the person who added the teacher. On failure only the code id is logged, and the response says `emailed: false`.

PR-1 as merged also keys **every** one-time code (reset and first sign-in) under the new secret `RESET_CODE_HASH_SECRET` (required in staging and production; locally derived from `JWT_REFRESH_SECRET`), and retires codes stored the old way.

PR-3 and PR-4 can be built side by side once PR-2's contract is frozen. Within the machine-load rules, at most two builder sessions run at once.

---

## 8. Owner questions

### 8.1 DECIDED (owner, 2026-10-27, relayed verbatim by the department head)

| # | Question | Owner's answer (verbatim) | Where it lands |
|---|---|---|---|
| Q1 | Who may add a teacher? | "Also teacher supervisors" (the Teachers Manager, the super admin **and** teacher supervisors) | §3.2, §3.4, §4 |
| Q2 | What does a teacher sign in with? | "E-mail + one-time code (Recommended)" | §3.2, §3.3 |
| Q3 | How is the set-up code delivered, and for how long? | "E-mail + one-time code (Recommended)": shown once to the adder, 72 h, 5 tries; also e-mailed if PD-40 Q5 says so | §3.3 |
| Q4 | Is a supervisor required when adding a teacher? | "Supervisor optional; students allowed" | §3.2, §3.7 |
| Q5 | May a teacher whose set-up is incomplete get students? | "Supervisor optional; students allowed" (the warning stays; nothing blocks) | §3.5, §3.7 |
| Q6 | Offboarding: who, and what happens? | "Manager or super admin, after students move (Recommended)" | §3.6 |
| Q7 | Existing teachers for the migration: bulk or by hand? | "By hand, before families (Recommended)" | §5 |
| Q8 | Who sets a teacher's pay? | "Super admin and Teachers Manager for now Later an Accountant role can be given the teacher-finance permission." | §3.8 |

### 8.2 DECIDED follow-ups (owner, 2026-10-27, relayed verbatim by the department head)

| # | Question | Owner's answer (verbatim) | Where it lands |
|---|---|---|---|
| N1 | A teacher supervisor who adds a teacher: is the supervisor link always themselves? | "They may leave it empty". Themselves or empty, never another supervisor; empty means the Manager covers them and is notified, and under strict scope the adder no longer sees the teacher. | §3.2, §3.7, §4 |
| N2 | The Teachers Manager and pay: pay terms only, or the whole teacher payroll? | "Full teacher finance" | §3.8, §4 |
| N3 | May strict scope be turned on while some teachers have no supervisor? | "Yes, Manager covers them (Recommended)" | §3.7; `docs/admin/pd035-teacher-supervisors.md` |

No questions remain open.

---

## 9. Out of scope

- Subjects and levels as structured data (only free text exists).
- Case-insensitive login for every account kind (the follow-up in §3.4).
- Merging the three time-zone columns.
- Teacher self-service password recovery by e-mail. PD-25 is for parents; it could be extended later.
- Moving all of a teacher's students in one action. Offboarding links to Change teacher per student.
- Any change to what a teacher can do in the app.
