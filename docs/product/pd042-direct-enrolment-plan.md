# PD-42: direct enrolment and adding to an existing family (review and plan)

**State:** plan for approval. No feature code has been written.
**Claim:** `docs/product/pd-registry/PD-42.md`. Migration slot `20261027140000` (`chat_pd042_direct_enrolment`).
**Base:** `main` @ `6e809f12`.

## The request

The owner, 2026-10-27:

> "We need a way to add parents and students to the system without going through the trial lesson process, since not all students attend trial lessons."

The department head added a related gap: adding a **second child** (a sibling) to a family that already exists.

## Summary

- **Today every student enters Chat through a trial lesson.** The database chain is `lesson` → `trial_outcome` → `trial_subscription` → `student_enrolment`. Each row is keyed by the trial's lesson id, through foreign keys. There is nowhere to put a form that has no trial.
- **A sibling cannot be added at all.** Assign refuses any parent e-mail that already has an account. `student_enrolment.family_id` is unique, and the list of children on an enrolment can never change. No other staff path creates a learner.
- **The plan generalises the PD-16 form; it does not copy it.**
  - A form may now have `origin = 'direct'`, with no trial.
  - A form may name an **existing family** to add its children to.
  - `student_enrolment` is keyed by the form instead of by the trial.
  - Assign, the supervisor, the family group, the sign-up code, the New Students page and the Admin Web form are all reused.
- **Five PRs.** One migration. The second guardian (PR-4) is optional and can be dropped.

---

## 1. Review: what exists, with evidence

### 1.1 Where a New Students entry comes from

| Step | Evidence |
|---|---|
| A trial lesson is booked by the trial desk (Sales, Operations, or the super admin). | `apps/api/src/lessons/trial.service.ts:151` (`book`); the desk's standing is set at `:676-692`, with Sales, Operations and the super admin all treated as `'sales'` at `:681-685` |
| The teacher reports attendance. | `trial.service.ts:237-286` |
| **Sales records the outcome "subscribed" together with the subscription form.** The trial must already have started (`:405`) and must have been held (`:407-415`). | `trial.service.ts:394-439`. Sales-only check at `:402-404`. The form is written at `:428` (`forms.recordInTx`) |
| Or Sales later corrects an outcome to "subscribed". | `trial.service.ts:448-500`, form written at `:487` |
| The form is stored in `chat.trial_subscription`, keyed by the trial. | `apps/api/src/new-students/new-students.service.ts:102-115` |
| The New Students page lists every live form. | `new-students.service.ts:138-145` (`list`). `present` reads the trial lesson for the prospect, the trial teacher and the trial date (`:178-181`, `:195-198`) |
| The page's API is keyed by `trialId`. | `apps/api/src/lessons/trial.controller.ts:75-121` (`/trials/new-students/:trialId/...`) |

**Can Sales create a form directly?** No. The only writers are `recordInTx`, called from `outcome` and `correct`, and `updateInTx`, called from `updateSubscription` (`trial.service.ts:503-517`). `updateInTx` only edits a live form that already exists (`new-students.service.ts:118-122`). Every one of them is reached through a trial lesson id.

### 1.2 What blocks a non-trial enrolment: all three layers

| Layer | Block | Evidence |
|---|---|---|
| **DB** | `trial_subscription.lesson_id` is the primary key **and** a foreign key to `trial_outcome(lesson_id)`. | `supabase/migrations/20261021100000_chat_trial_journey.sql:373-374` |
| **DB** | `trial_outcome.lesson_id` is a foreign key to `chat.lesson`. | `supabase/migrations/20261019120000_chat_pd011_trials.sql:265-266` |
| **DB** | The guard refuses a live form unless its trial's outcome is `subscribed`. | `20261021100000_chat_trial_journey.sql:431-433` (inside `guard_trial_subscription`, `:397-436`) |
| **DB** | `student_enrolment.lesson_id` is the primary key and references `trial_subscription(lesson_id)`. | `supabase/migrations/20261021140000_chat_new_student_enrolment.sql:99` |
| **DB** | The enrolment guard requires a live form for that lesson. | `20261021140000…:127-134` |
| **API** | Every form writer takes a trial lesson id (see 1.1). Assign loads the form by `trialId` (`enrolment.service.ts:155`). Lesson length is read from the trial (`:439-443`). | `apps/api/src/new-students/enrolment.service.ts` |
| **UI** | The form appears only inside the trial card's "subscribed" step and in the New Students "edit" dialog. There is no "New student" button. | `apps/admin-web/src/features/trials/TrialCardDialog.tsx:196`, `NewStudentsPage.tsx:281`, `NewStudentsPage.tsx:72-80` |

### 1.3 PD-16 Assign: what it does

`NewStudentEnrolmentService.assign`, `enrolment.service.ts:145-287`:

- **Who may assign.** The Operations manager or the super admin (`:149-151`). The database enforces the same rule:
  - `chat.is_operations_manager`, `20261021140000…:36-47`;
  - `enrol_learner`, `:71-74`;
  - the enrolment guard, `:139-142`.
- **One transaction** (`:178-269`) creates:
  - the family (`:181`);
  - the account, whose subject is the e-mail (`:184`);
  - the contact, as primary guardian with an account (`:187-204`);
  - the PD-17 parent file and family billing (`:206-215`, `seedFromEnrolment` at `parent-record.service.ts:274-305`);
  - for each child (`:218-244`):
    - the child, through `chat.enrol_learner` (`:219-220`);
    - the PD-8 `learner_supervision` row (`:221-223`);
    - the course and the stated age (`:224-234`);
    - an audit row;
  - the `student_enrolment` row (`:245-255`);
  - the PD-27 attachment of pre-Assign payments (`:258`, `payment-ledger.service.ts:257-267`).
- **Weekly times** are set after the transaction, on a best-effort basis (`:271-285`).
- **The family group** is created later by the supervisor (`createGroup`, `:308-342`). Creating it also opens the parent's direct chat with the supervisor (`:332-340`).
- **The form is frozen once it is enrolled** (`20261021140000…:176-191`).
- **An enrolment's children never change.** The guard allows only the group to be added (`:150-156`).

### 1.4 The parent's sign-up code

- `ParentSignupService` is at `apps/api/src/platform/auth/parent-signup.service.ts`.
- **A sign-up is possible only for a family account that has a `student_enrolment` row** (`signupAccount`, `:173-185`; the enrolment check is at `:179-181`).
- The database enforces the same rule for every code that is inserted:
  - first at `20261021140000…:228-232`;
  - re-created by PD-32 at `20261026120000_chat_pd032_parent_feedback_signup_code.sql:217`.
- The code is relayed from the New Students card, and only to the responsible person (`enrolment.service.ts:115`, `:130-137`).

So a second guardian, who has no enrolment row, **cannot sign up today**.

### 1.5 PD-17, PD-30, PD-31 and PD-8

- **PD-17 Parent Profile.** The routes are `GET /parent-profiles`, `GET /parent-profiles/:id`, `POST /parent-profiles/:id` and the photo routes (`parent-record.controller.ts:19-47`).
  - Who may use it is `billingAccessOf` (`parent-record.service.ts:22-44`): the super admin and the Operations manager see every parent; an Operations supervisor sees the families in their reach; Sales reads every parent.
  - Only Operations may edit (`:242-246`).
  - **There is no "add child" and no "add guardian" route.**
- **PD-30.** A child's lessons come from `chat.learner_subscription` (`20261026140000…:127-152`). Its `source` is one of `payment_request`, `instalment_plan`, `staff` or `backfill`.
  - Assign does **not** create a ledger row. Paid lessons arrive by themselves, from a paid link or an instalment plan (`billing.service.ts:404`, `subscription-ledger.service.ts:19-34`).
  - A new child therefore starts with no lessons on the ledger. When enforcement is on, the child is locked once the grace lessons are used up. This is unchanged by PD-42.
  - The lock is computed per child, and a group is locked for its locked children (`platform/subscription-lock.ts:31-32`, `:64-90`).
- **PD-31.** `applySchedule` sets the weekly times only where the teacher is free. Assign treats this as best effort (`enrolment.service.ts:271-285`).
- **PD-8: one supervisor per family group.**
  - `createFamilyGroup` refuses children who have different supervisors (`conversation.service.ts:992-999`).
  - It admits only teachers of the group's anchored children (`:1017-1027`).
  - The database checks the committed state: a live family group has at least one learner, and all its learners share one supervisor (`20261015120000_chat_pd008_org_structure.sql:391-427`, constraint trigger at `:432`).
  - **A child can be anchored to an existing family group.** The guard requires only the same family and the same organization (`:356-381`).
  - The precedent is PD-31's `chat.transfer_learner`, which adds the new teacher to the child's family groups (`20261026110000_chat_pd031_scheduling.sql:538-554`).
  - Today the only API writer of `conversation_learner` is group creation (`conversation.service.ts:1050`).
- **PD-35 strict scope** (`platform/teacher-scope.ts:6-29`) narrows only which teachers a Teachers-department member works on. The trial desk gets `ALL_TEACHERS` (`trial.service.ts:205`). The form accepts any active teacher who is not away (`new-students.service.ts:82-90`).

### 1.6 Admin Web

- **`NewStudentsPage.tsx`** lists the forms and filters them by status (`:45-80`).
  - Each card shows the prospect, the trial teacher and the trial date (`:171-173`). A direct form has none of these.
  - It has no create button.
- **`SubscriptionForm.tsx`** is the reusable form component:
  - `emptyDraft` at `:41`, `draftFrom` at `:46`, `formErrors` at `:69`, `toInput` at `:90`;
  - **it can be reused as it is.**
- **`NewStudentSetup.tsx`** contains the Assign dialog, with the supervisor and the sign-in e-mail (`:256-302`). It also has the group, code-invalidation and attempt-reset actions (`:82`, `:180`, `:202`).
- **`api.ts:164-185`**: every New Students call is keyed by `trialId`.
- **`area.tsx:20-23`**: the "New students" tab is offered to Sales and Operations.

### 1.7 The sibling case: what happens today

Suppose the same parent comes back later with another child.

1. Their first child took a trial and was assigned, so the family, the parent's contact and an account with subject `normalizeEmail(email)` exist.
2. The sibling has to take a trial too, because there is no other way in. Sales marks it "subscribed" and fills the form with the same parent e-mail.
3. The Operations manager presses Assign. `enrolment.service.ts:160-165` normalizes the e-mail and finds an account → **409 "this e-mail already belongs to an account in Chat".** Nothing is created.
4. The workarounds are both wrong:
   - **A different or blank e-mail.** A blank e-mail is refused at `:162`. A different e-mail passes, and Assign then creates a **second family**, a **second contact** and a **second account** for the same person. The children land in different families, with different groups and separate billing (`:181-204`). Because `contact (family_id, account_id)` is unique only per family (`20260905090300_chat_family_domain.sql:87-88`), the database does not stop this.
   - **Editing the existing enrolment.** Not possible. `learner_ids` is immutable (`20261021140000…:150-156`) and `family_id` is unique (`:101`).
5. **Two siblings at the same trial.** They work, because one form allows 1–10 children (`new-students.service.ts:77-79`). **Two siblings at different trials** with the same parent e-mail run into step 3.

So the honest answer to "duplicate, fail, or attach?" is: **it fails on the e-mail check.** If staff work around the failure, **it creates a duplicate family**. It never attaches.

---

## 2. Design principles

1. **One form, one Assign.** Direct enrolment is a PD-16 form without a trial. There is no second enrolment service.
2. **One form, two possible targets.** A form creates either a **new family** or **children in an existing family**. Both go through the same Assign.
3. **Keep the separation of duties.**
   - Sales or Operations records the form.
   - The Operations manager or the super admin assigns it. The database still says so, through `enrol_learner`.
   - For someone who holds both rights, one click does both ("Save and assign").
4. **No duplicate people.** A parent is matched by e-mail; that blocks the save. A phone match is only a warning. A child is matched by name (and date of birth, when given) within the family.
5. **G-07 confinement is unchanged.**
   - The form, with its phone and e-mail, stays in `chat.trial_subscription`, read only from `src/new-students`.
   - The parent file stays in `src/parent-profile`.

## 3. Data model: one migration, slot `20261027140000`

### 3.1 `chat.trial_subscription` becomes "the subscription form"

- Add `id uuid not null default gen_random_uuid()` and backfill it. **The primary key moves to `id`.**
- `lesson_id` becomes nullable and gets `UNIQUE`. A plain unique constraint still backs the incoming foreign keys and allows many nulls.
- Add `origin text not null default 'trial' check (origin in ('trial','direct'))`, and the check `(origin = 'trial') = (lesson_id is not null)`.
- Add `target_family_id uuid null references chat.family(id)`, meaning "add these children to this family". It is allowed on both origins. This also fixes two siblings coming from two different trials.
- The guard:
  - **A trial form** follows today's rule: live exactly while the trial is subscribed.
  - **A direct form** is live until it is withdrawn. It is recorded by staff of its organization. Withdrawing it is explicit, because there is no outcome to correct.
  - The target family must belong to the same organization.
  - When `target_family_id` is set, the parent's name, e-mail and phone are those of the target family's primary contact. The service copies them; the form does not take them from the request.
- The child JSON gains two optional fields:
  - `durationMinutes` (15–240). A direct form has no trial to take the length from. For a trial form, `trialMinutes` remains the fallback.
  - `birthDate` (an ISO date), written to `learner_enrollment.birth_date` (`schema.prisma:1460`). It replaces the stated age only when both are given.
- **The table name stays.** The confinement spec, PD-17's backfill (`20261021150000…:285-291`) and the Prisma model all name it. A rename would be churn, so a comment records the wider meaning instead.

### 3.2 `chat.student_enrolment` is keyed by the form

- Add `form_id uuid references chat.trial_subscription(id)` and backfill it from `lesson_id`. **The primary key moves to `form_id`.** `lesson_id` becomes nullable and stays unique.
- Add `kind text not null default 'new_family' check (kind in ('new_family','added_children'))`.
- **Drop `UNIQUE (family_id)`.** Replace it with a partial unique index on `(family_id) where kind = 'new_family'`: a family is created once, but children may be added many times.
- The guard:
  - **`new_family`** follows today's rule: the contact belongs to the family and owns the account.
  - **`added_children`** requires `form.target_family_id = family_id`. `contact_id` is the family's primary contact. `account_id` is that contact's account, or null for a family made before PD-16 that has no account. `account_id` is therefore nullable for this kind only.
  - `learner_ids` stays immutable. Each addition is a new row, so history is never rewritten.
- `freeze_enrolled_subscription` and `parent_signup_code`'s "has an enrolment" check keep working by `account_id`.

### 3.3 PD-27: payment before Assign for a direct form

`payment_request`, `payment` and `invoice` gain `subscription_form_id uuid`.

- It has no foreign key, following PD-30's rule for money tables, which keeps them truncatable.
- `payment_request_has_a_payer` becomes `family_id OR trial_lesson_id OR subscription_form_id`.
- `attachTrial` becomes `attachForm`, matching either key.
- Old rows keep `trial_lesson_id`.
- A form that targets an existing family asks for payment on the family, as PD-27 already does.

### 3.4 PR-4 only: who may sign up

- Add `chat.parent_account_issue (account_id pk, contact_id, family_id, source in ('enrolment','added_guardian'), issued_by, issued_at)`, backfilled from `student_enrolment`.
- The sign-up gate (`parent-signup.service.ts:179`) and the code guard read it in place of `student_enrolment`.
- This is the one place that records "Chat created this parent's account and they have not signed up yet".

## 4. API

### 4.1 Direct form (PR-2)

All of these live in `src/new-students`, because the form is confined there.

| Route | Who | What |
|---|---|---|
| `POST /new-students` `{ id?, subscription, targetFamilyId? }` | the trial desk standing (Sales, Operations, super admin) | Records a direct form. A client-chosen `id` makes a double submit return the same form. |
| `POST /new-students/:formId` `{ subscription }` | same | Edits a live, unassigned form. |
| `POST /new-students/:formId/withdraw` `{ reason }` | same | Direct forms only. Trial forms are still withdrawn by correcting the outcome. |
| `GET /trials/new-students` | unchanged | Each entry adds `formId`, `origin` and `targetFamily: { familyId, parentName, childrenCount } \| null`. The trial fields are null for a direct form. |
| `/trials/new-students/:id/{assign,supervisor,payment-requests,group,signup-code/invalidate,signup-attempts/reset}` | unchanged rules | `:id` accepts a **form id** and, for one release, a trial id as an alias. The Admin Web moves to form ids. |

### 4.2 Assign, two kinds (PR-2 and PR-3)

- **`new_family`** works as today.
  - The parent e-mail check (`enrolment.service.ts:163-165`) now answers `409 PARENT_EXISTS` with `{ contactId, familyId, parentName }` when the e-mail belongs to a **family** account. Every caller of Assign can already see every parent (§6), so this reveals nothing new.
  - The UI then offers "Add to this family instead", which sets `target_family_id`.
  - A staff or teacher e-mail keeps a plain 409.
- **`added_children`**: the form has a target family.
  - **The supervisor** is fixed to the family's current supervisor (the one `learner_supervision` supervisor of its children), so the family group stays coherent.
    - If the family has no supervised child, the Operations manager chooses one.
    - If its children have more than one supervisor, the manager picks which of those supervisors' groups the new child joins.
    - Moving the whole family to another supervisor is still PD-24 (`changeSupervisor`).
  - **Created in one transaction:**
    - each child, through `enrol_learner`;
    - their `learner_supervision` row;
    - their course, age or date of birth;
    - the `student_enrolment(kind='added_children')` row;
    - an audit row `family.children_added`.
  - **Not created:** no family, no account, no contact, no parent file and no family billing, because they already exist.
  - **The parent's sign-up is untouched.** If the parent has signed up, the new child appears in their app. If they have not, their live code still works.
  - The weekly times are set as today, using `durationMinutes` or else the trial length.
- **Concurrency.** Assign takes `pg_advisory_xact_lock` on the normalized parent e-mail, and on the target family. It also reads the form `FOR UPDATE`. Two forms for the same parent can then never both create a family; the second one gets `PARENT_EXISTS` and is offered "add to that family". Today, the check at `:157` and the insert at `:245` are not serialized against each other.

### 4.3 The family group for added children (PR-3)

- `createGroup` on an `added_children` enrolment:
  - **if the family has a live family group with that supervisor:** `ConversationService.addLearnersToFamilyGroup`. In one transaction it anchors the children (`conversation_learner`), adds any new teachers as members, posts the system message `group.learner_added`, writes the audit row `family_group.learners_added`, and sends the outbox event `MEMBERSHIP_CHANGED`. It is authorised exactly like `createFamilyGroup`: the children's supervisor, their active backup, their manager or the super admin.
  - **otherwise:** it creates a new group, as today.
- The group's id is recorded on the enrolment, as today.

### 4.4 Second guardian (PR-4, optional)

- `POST /parent-profiles/:contactId/guardians` `{ name, relationship, email, phone }`. Who: the PD-17 editors (`canEditParent`, which is Operations).
- **It creates:**
  - a contact (`role_preset 'authorized_contact'`, may message and view progress);
  - an account whose subject is the e-mail. A matching e-mail is refused, whether it is in this family or another;
  - the parent file;
  - the row `parent_account_issue('added_guardian')`;
  - an audit row `parent.guardian_added`.
- **It adds** the contact to the family's live family groups and opens their direct chat with the supervisor.
- **The sign-up code** is relayed from the Parent Profile, only to the responsible person, with the same invalidate and reset actions as New Students.

## 5. Duplicate detection and idempotency

| Case | Rule | Strength |
|---|---|---|
| Same parent e-mail as an existing **family account** | `PARENT_EXISTS`, then convert the form to "add to that family". Checked on save and at Assign. | **blocks** |
| Same parent e-mail as a **staff or teacher** account | 409, as today | **blocks** |
| Same e-mail on another **live, unassigned form** | A warning on both cards: "another form for this e-mail awaits Assign". The second Assign then turns into "add to the family just created". | warns |
| Same phone as a parent on file | `ParentPhoneDirectory` (PD-25), exact E.164 match. Warns "a parent with this phone exists" and offers to open the profile. The number is never returned (`parent-phone-directory.ts`). | warns |
| Same child in the family: the normalized name, plus the date of birth when both have one | `CHILD_EXISTS`, unless `confirmDuplicate: true`. Names are compared after trimming and folding case, removing tatweel, and unifying أ/إ/آ→ا, ى→ي and ة→ه. | blocks, overridable |
| The same child twice on one form | 400 | **blocks** |
| Double submit | A client-chosen form `id`: `on conflict do nothing`, then return the existing form | idempotent |
| Assign twice | The primary key on `form_id`, plus the advisory lock. The second call gets 409 "already assigned", as today. | idempotent |

**Audit trail.** Every audit row omits the phone and the e-mail, as today. The rows are:
- `new_student.form_recorded`, with origin and target;
- `new_student.form_updated`;
- `new_student.form_withdrawn`;
- `new_student.enrolled`, with its kind;
- `family.children_added`;
- `family_group.learners_added`;
- `parent.guardian_added`;
- `learner.supervisor_assigned`, as today.

## 6. Who may do what: PD-8, PD-35, PD-30, PD-40

### 6.1 Permissions

These names are for PD-40's catalogue. PD-42 enforces them now through today's Layer-2 checks, so it does **not** wait for PD-40's guard.

| Permission | Allows | Legacy bundles that get it | Layer-2 check today | Risk |
|---|---|---|---|---|
| `new_students.view` | the New Students page (unassigned forms; assigned forms in scope) | `*@sales`, `*@operations`, `super_admin` | `page()` (`enrolment.service.ts:68-70`) | family_contact |
| `new_students.record` | record, edit or withdraw a form, direct or from "Add child" | `manager@sales`, `supervisor@sales`, `manager@operations`, `supervisor@operations`, `super_admin` | the trial desk standing (`trial.service.ts:681-685`) | family_contact |
| `new_students.assign` | Assign and change the supervisor | `manager@operations`, `super_admin`. **Delegable only by the super admin.** | `is_operations_manager`, in the API and the DB | admin |
| `new_students.signup_relay` | see, invalidate and reset a parent's sign-up code | `supervisor@operations`, `manager@operations`, `super_admin` | `responsibleFor` (the children's supervisor or backup) | family_contact |
| `parents.add_guardian` (PR-4) | add a second guardian | `manager@operations`, `supervisor@operations` in reach, `super_admin` | `canEditParent` | family_contact |

**Recommendation, as asked:** Sales, the Operations manager and the super admin may **create** a form. Operations supervisors already share the trial desk, so they keep that right; Q3 asks whether they should. **Assigning** stays with the Operations manager and the super admin. **"Add child"** on the Parent Profile is shown to anyone who holds `new_students.record` *and* can open that parent. For an Operations supervisor, that means only the families in their reach.

### 6.2 How PD-42 meets the other decisions

- **PD-8.** An added child joins the family's existing supervisor, so the coherence trigger is never tested. Page visibility after Assign is unchanged: the children's supervisor (and backup), the Operations manager and the super admin.
- **PD-35 strict scope.** No change. The form's teacher list stays every active teacher, because the trial desk is not Teachers-department scoped. The new child's teacher supervisor reaches the child through the teacher assignment, as they reach any other student.
- **PD-30 lock.**
  - Assign does not create ledger rows. A form's prices are what Sales noted; lessons arrive with payment (a PD-27 link or a PD-17 instalment plan) or a PD-30 staff grant.
  - **Recommendation:** when the target family already has a child locked for payment, Assign and group-join show a warning naming that child. Adding a child does not unlock the group.
- **PD-31.** Weekly times are best effort, as today. The result names any child whose times were not set.

## 7. Admin Web UX

1. **New Students page** (`NewStudentsPage.tsx`):
   - A **"New student (no trial)"** button for `new_students.record` holders. It opens `SubscriptionForm` with `emptyDraft()` and a lesson-length field per child.
   - On save, `PARENT_EXISTS` shows "This parent is already in Chat: «name», N children. **Add to this family** / Cancel".
   - A phone match shows a non-blocking banner with "Open profile".
   - Cards show **"Direct"** or **"Trial · teacher · date"**, and **"Adds to «family»"** when there is a target.
   - A filter chip for origin.
2. **Holding both rights.** For the Operations manager and the super admin, the button reads **"Save and assign"**. It opens the Assign dialog straight after the save. If Assign fails, the form remains as a normal unassigned entry.
3. **Assign dialog** (`NewStudentSetup.tsx`):
   - For an added-children form, the supervisor is preselected and locked, with "Change family supervisor" linking to PD-24.
   - There is no e-mail field, because the parent already exists.
   - It shows the lock warning (§6.2).
4. **Parent Profile.**
   - An **"Add child"** button opens the same `SubscriptionForm`, with the parent block read-only from the family and `targetFamilyId` set.
   - A "Second guardian" panel appears in PR-4.
5. **After an added-children Assign,** the group action reads **"Add to the family group"** instead of "Create group".
6. **Copy.** Arabic first, with English, in `newStudentsCopy.ts`. It is checked at phone width and in RTL, as PD-16 and PD-32 were.

## 8. Tests

- **Integration** (`new-student-enrolment-pd016.spec.ts`, extended, plus a new `pd042-direct-enrolment.spec.ts`):
  - **Direct form:** record → page → Assign → family, contact, account, children, supervision → group → sign-up code → the parent signs up.
  - **Sibling, later:** a trial form with an e-mail that exists gets `PARENT_EXISTS`. It converts to "added children", gets Assign, and the child joins the existing group with the new teacher as a member. There is exactly one family, one contact and one account.
  - **Two trials, same e-mail, both pending:** the second Assign attaches to the family the first created.
  - **Concurrent Assigns** of two forms with the same e-mail: one family is created.
  - **Families made before PD-16:** a family with no account takes added children.
  - `CHILD_EXISTS`, the Arabic name folding, and `confirmDuplicate`.
  - **Withdraw:** a direct form can be withdrawn, and is frozen once enrolled.
- **The DB is the backstop.** Raw SQL that bypasses the API is refused for each of these:
  - a direct form with a `lesson_id`;
  - an `added_children` enrolment whose family is not the form's target;
  - a second `new_family` row for the same family;
  - a change to `learner_ids`;
  - a group anchor from another family.
- **Migration test.** The backfill keeps every PD-16 row, and `form_id = id` of its form. The New Students page answers the same before and after on the seeded fixture.
- **Authorization matrix** for `/new-students*` and `/parent-profiles/:id/guardians`:
  - teacher, parent and Teachers department → 403;
  - an Operations supervisor outside their reach → 404;
  - Sales → may record, may not assign.
- **Unit tests:** form validation (`durationMinutes`, `birthDate`), name folding, and the `PARENT_EXISTS` mapping.
- **Privacy:**
  - `new-students-confinement.spec` and `parent-file-confinement.spec` stay green with no new allowed lines outside the two modules;
  - `no-contact-channel-columns.spec` stays green;
  - audit rows carry no phone or e-mail.
- **Admin Web:** `TrialsPages.test.tsx` covers the create button by permission, the `PARENT_EXISTS` conversion, the direct and target labels, the locked supervisor, "Save and assign", and "Add child" on the Parent Profile.
- **Guards:** `scripts/qa/guards.sh` passes, including the slot claim.
- **Load.** Integration runs follow the machine rules: capped workers and a private DB. No simulator is needed, because there is no Flutter change; parents see new children through existing screens.

## 9. PR breakdown

| PR | Contents | Depends on |
|---|---|---|
| **PR-1, data** | The migration `20261027140000`: form `id`, `origin` and `target_family_id`; `student_enrolment.form_id` and `kind`; the payment `subscription_form_id`; backfill; guards; the Prisma model. Every existing PD-16 spec stays green, with no behaviour change. | — |
| **PR-2, direct form API + UI** | `POST /new-students` (+ edit, withdraw); routes keyed by form id with the trial-id alias; `PARENT_EXISTS`, the phone warning and `CHILD_EXISTS`; Assign lock and `FOR UPDATE`; `attachForm`; the "New student (no trial)" button and "Save and assign". **This alone answers the owner's request.** | PR-1 |
| **PR-3, add to an existing family** | Assign `added_children`; `addLearnersToFamilyGroup`; "Add child" on the Parent Profile; the converted-form flow; the lock warning. | PR-2 |
| **PR-4, second guardian** (optional) | `parent_account_issue` (folded into PR-1's migration if approved in time, otherwise its own slot); the guardians route; the relay on the Parent Profile. | PR-1 |
| **PR-5, docs** | PD-42 in the boundary doc §4; `docs/admin/` operator note; permission rows handed to PD-40's catalogue. | PR-2 |

## 10. Owner questions (each has a recommendation)

1. **May Sales record a direct form on its own, or only after the Operations manager agrees?**
   *Recommendation:* Sales records it and the Operations manager assigns, as for trials. Assign is already the approval step.
2. **Adding a child to an existing family: must it always go through New Students and Assign, or may the Operations manager do it in one step from the Parent Profile?**
   *Recommendation:* the same form and the same Assign, so the record is identical. The Operations manager and the super admin get one-click "Save and assign".
3. **Should Operations supervisors also be able to record direct forms?** Today they share the trial desk with Sales.
   *Recommendation:* yes, but only for families in their reach when using "Add child". Brand-new families from them are fine, because the Operations manager still assigns.
4. **A second guardian (PR-4): now, or later?**
   *Recommendation:* later, unless a family is waiting for it. PR-2 and PR-3 answer the request; PR-4 also changes the sign-up gate.
5. **May Sales ask for payment before Assign on a direct form, as it can for a trial?**
   *Recommendation:* yes. It is a small change (§3.3) and keeps the two paths identical.

## 11. Out of scope

- Any change to how a parent signs up in the app, or to the WhatsApp relay.
- Merging duplicate families that already exist. If any are found, that is a one-off operational script, with the owner's approval.
- Students without a parent account (an adult learner who is their own parent). The form still requires a parent; this would be a separate decision.
- Flutter changes. Parents and teachers see new children through the screens they already have.
