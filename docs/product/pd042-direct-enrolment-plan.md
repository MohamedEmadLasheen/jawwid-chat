# PD-42: entering families by hand, without a trial (review and plan, v3)

**State:** revision 3.2, **design complete**. The owner decided Q1–Q5, with five safeguards (§13, §15). Every point from the safeguard-5 check of PD-30 is DECIDED (§16): F1–F3 and F5 by the department head, and F4 by the owner, recorded as `PD-30-amendment-carried-over`. No feature code has been written. Code waits for the head's GO (machine-load cap).
**Claim:** `docs/product/pd-registry/PD-42.md`. Migration slot `20261028110000` (`chat_pd042_direct_enrolment`), renumbered from `20261027140000`, which now sorts before `main`'s `20261027190000`.
**Base:** `main` @ `a547b0e2` (merged in). PD-40 is on `main`: its catalogue is `catalogue.ts` plus the tables `chat.permission` and `chat.legacy_permission_bundle` (`20261027190000_chat_pd040_access_roles.sql`).

## What changed since v1

The owner's answers (2026-10-27, relayed verbatim by the department head) change the shape of the feature:

- **This is mainly a migration intake from Jawwid Core.** Core's data is incomplete. Each **Sales supervisor** and each **Operations supervisor** enters *their own* families and children by hand, and is scoped to those families. Each family records who entered it.
- **The flow is no longer "Sales records, the Operations manager assigns".** A supervisor creates the family directly.
- **Students with a running package** are entered with their total and completed lessons. The server computes the remaining lessons. There is no payment and no reset, and the entry must not trip the PD-30 lock.
- **The form saves with a minimum of fields.**
- **Unchanged answers:** adding a child uses the same form in one click (Q2); the second guardian stays deferred (Q4).

**What v2 drops from v1:**
- the direct form stored in `chat.trial_subscription`, because intake creates the family at once and needs no waiting form;
- the PD-27 `subscription_form_id`.

**What v2 keeps from v1:**
- generalising `student_enrolment`;
- adding children to an existing family and joining its group;
- the duplicate checks;
- the trial-sibling fix.

## Summary

- **One generalised enrolment record, two ways in:**
  - **trial** (PD-16, unchanged): Sales records the form, then the Operations manager assigns;
  - **intake** (new): a supervisor enters a family or a child and it is created immediately.
  - Both reuse PD-16's transaction body (family, parent, children, supervision, schedule, group, sign-up code), extracted into shared functions.
- **Ownership:**
  - PD-8's **Operations supervisor** stays the only "responsible supervisor". That role drives chat reach, the family group, covers and PD-24 transfers.
  - A new **Sales owner** (`chat.family_sales_owner`) gives Sales supervisors their own families.
  - The intake record keeps **who entered** the family, and that never changes.
- **The carried-over package** is one row in PD-30's existing ledger, `chat.learner_subscription`:
  - with a new `source = 'carried_over'`;
  - with a new column `lessons_used_before`.
  - PD-30's counting subtracts it. Remaining = total − completed − lessons held in Chat since intake, computed by the database. There is no parallel balance.
- **Required fields:** the parent's name, a phone **or** an e-mail, and each child's name. Everything else can be completed later.

---

## 1. Review: what exists, with evidence

§1.1–§1.7 are the v1 review, still accurate. §1.8–§1.10 are new for v2.

### 1.1 Where a New Students entry comes from

- **The only source is a trial.** Sales records the outcome "subscribed" with the form (`apps/api/src/lessons/trial.service.ts:394-439`, form written at `:428`), or corrects an outcome to "subscribed" (`:448-500`).
- **Who may.** The trial desk is Sales, Operations and the super admin, all with the `'sales'` standing (`:681-685`).
- **The form** is stored keyed by the trial (`apps/api/src/new-students/new-students.service.ts:102-115`).
- **The page** lists the live forms (`:138-145`), reading the trial lesson for its display (`:178-181`).
- **The API** is keyed by `trialId` (`trial.controller.ts:75-121`).

No route creates a form without a trial.

### 1.2 What blocks a non-trial enrolment: the DB, the API and the UI

- **DB:**
  - `trial_subscription.lesson_id` is the primary key and a foreign key to `trial_outcome` (`20261021100000_chat_trial_journey.sql:373-374`). `trial_outcome` is in turn keyed to `chat.lesson` (`20261019120000_chat_pd011_trials.sql:265-266`).
  - A form is live only while its trial is subscribed (`20261021100000…:431-433`).
  - `student_enrolment.lesson_id` is the primary key and references the form (`20261021140000_chat_new_student_enrolment.sql:99`). The enrolment guard requires a live form (`:127-134`).
- **API:** every writer takes a trial id. Assign reads the lesson length from the trial (`enrolment.service.ts:439-443`).
- **UI:** the form exists only inside the trial card (`TrialCardDialog.tsx:196`) and the edit dialog (`NewStudentsPage.tsx:281`). There is no create button.

### 1.3 PD-16 Assign

`enrolment.service.ts:145-287`:

- **Who may assign.** The Operations manager or the super admin (`:149-151`). The DB enforces the same rule in three places: `is_operations_manager` (`20261021140000…:36-47`), `enrol_learner` (`:71-74`) and the enrolment guard (`:139-142`).
- **One transaction** (`:178-269`) creates:
  - the family, with `owner_id` = the supervisor (`:181-183`);
  - an account whose subject is the e-mail (`:184-186`);
  - the primary-guardian contact (`:187-204`);
  - the PD-17 parent file and family billing (`:206-215`);
  - for each child: `enrol_learner` (`:219-220`), `learner_supervision` (`:221-223`), and the course and stated age (`:224-234`);
  - `student_enrolment` (`:245-255`);
  - the PD-27 payment attachment (`:258`).
- **After the transaction:** the weekly times are set on a best-effort basis (`:271-285`). The supervisor creates the group later (`:308-342`).
- **Fixed afterwards:** the form freezes once enrolled (`20261021140000…:176-191`), and an enrolment's children never change (`:150-156`).

### 1.4 Parent sign-up

- **A code is issued only to a family account that has a `student_enrolment` row.**
  - API: `parent-signup.service.ts:173-185`, with the check at `:179-181`.
  - DB: `20261021140000…:228-232`, re-created by PD-32 at `20261026120000…:217`.
- **The code is relayed** only to whoever is responsible (`enrolment.service.ts:115`, `:130-137`).

### 1.5 PD-17, PD-31, PD-8, PD-35

- **PD-17.** The routes are listed at `parent-record.controller.ts:19-47`. There is **no add-child or add-guardian route**.
  - Who sees what follows `decideBillingAccess` (`platform/pd012-policy.ts:113-131`):
    - the super admin and the Operations manager: every family;
    - an Operations supervisor: the families in reach;
    - **Sales: every family**, read-only for the contact record (`:129`).
- **PD-31.** `applySchedule` is best effort. Moving a child to another teacher (`chat.transfer_learner`) is allowed to the Teachers department or **the child's supervisor** (`20261026110000_chat_pd031_scheduling.sql:500`). That function also adds the new teacher to the child's family groups (`:538-554`).
- **PD-8: one supervisor per family group.**
  - `createFamilyGroup` refuses children with different supervisors (`conversation.service.ts:992-999`) and admits only the anchored children's teachers (`:1017-1027`).
  - The DB checks this on commit (`20261015120000_chat_pd008_org_structure.sql:391-432`).
  - **Anchoring a child into an existing family group is DB-legal** (`:356-381`). Today, group creation is the only API writer of it (`conversation.service.ts:1050`).
- **PD-35 strict scope** narrows only the Teachers department's reach over teachers (`platform/teacher-scope.ts:6-29`). It does not affect who enters families.

### 1.6 Admin Web

- `NewStudentsPage.tsx`:
  - lists the forms (`:45-80`);
  - shows trial fields on each card (`:171-173`);
  - has no create button.
- `SubscriptionForm.tsx` can be reused (`emptyDraft :41`, `draftFrom :46`, `formErrors :69`, `toInput :90`).
- The Assign dialog is `NewStudentSetup.tsx:256-302`.
- `api.ts:164-185` is keyed by `trialId`.

### 1.7 The sibling case today

Assign refuses a parent e-mail that already has an account (`enrolment.service.ts:160-165`, 409).

- **Using a different e-mail** creates a **second family, contact and account** for the same person (`:181-204`). The DB does not stop it, because contacts are unique only per family (`20260905090300_chat_family_domain.sql:87-88`).
- **Attaching is impossible.** `family_id` is unique in `student_enrolment` (`20261021140000…:101`) and `learner_ids` is immutable (`:150-156`).

**Verdict:** Assign fails on the e-mail. If staff work around it, they create a duplicate. It never attaches.

### 1.8 Who owns a family today (new)

- **PD-8 supervision is Operations-only, by DB rule.** `guard_learner_supervision` refuses any supervisor who is not a `position = 'supervisor'` member of an `operations` department (`20261015120000…:207-217`).
- **Reach** (`chat.staff_reaches_family`) is derived only from `learner_supervision`, plus backups and managers (`20261015120000…`, function `staff_reaches_family`). Chat access, the family group, PD-33 covers and PD-24 transfers all hang on it.
- **`family.owner_id`** is a legacy `NOT NULL` staff reference. It changes only through `chat.transfer_ownership` (`20260905090700_chat_ownership_invariants.sql:41-55`). Assign sets it to the Operations supervisor (`enrolment.service.ts:182`), and PD-24 keeps it following the supervisor (`org/org-structure.service.ts:669-670`).
- **Sales owns no family.**
  - `chat.sales_department_role` only says whether someone is the Sales manager or a member (`20261019130000_chat_pd011_trial_group.sql:29-41`).
  - Sales' reach over families is **organization-wide**: `decideBillingAccess` returns `scope: 'all'` for any Sales member (`pd012-policy.ts:129`).
  - **No column or table links a family to a Sales supervisor.**

**Conclusion.** The owner's "each Sales supervisor manages only their families" has no model today. It needs a new ownership record, and Sales' existing org-wide reads must be narrowed (§4.3).

### 1.9 The package model: PD-11, PD-15, PD-27, PD-30 (new)

- **The ledger is `chat.learner_subscription`** (`20261026140000_chat_pd030_subscription_lock.sql:126-160`).
  - Each row has `lessons_included`, `starts_on` and `source ∈ {payment_request, instalment_plan, staff, backfill}`.
  - It is append-only: a row is voided with a reason and never edited (`guard_learner_subscription`, `:168-235`).
  - **Every package in Chat lives here.** A PD-27 payment request paid in full credits a row by trigger (`pd030_request_credits_lessons`, `:706-741`). So does a PD-17 instalment plan with lessons (`billing/billing.service.ts:404`) and a staff "Add subscription" (`billing/subscription-ledger.service.ts:53-90`).
- **Counting.** Used = the child's `regular` and `makeup` lessons with outcome `held` or `student_no_show`, from the earliest standing row's `starts_on` (`learner_lessons_used`, `:408-419`). Balance = Σ included − used (`compute_learner_access`, `:454-459`).
- **A child with no standing row has balance NULL, is "open", and can never be balance-locked** (`:361`, `:458`).
- **PD-15's `learner_enrollment.package_lessons`** was carried into the ledger at PD-30's go-live, starting that day so nothing already taught counted (`:877-890`). Once a ledger row exists, the ledger *is* the package (`lessons/enrollment.service.ts:206-208`).
- **"Lesson N of M"** fills the standing rows in order with the lessons used (`billing/subscription-reads.ts:74-85`). The parent and staff views show included, used, left and state (`:10-24`, `:120-140`).
- **A subscription with no payment** (`source = 'staff'`) is allowed only to the super admin, the Operations manager or the Sales manager. It must carry a reason and start between a week ago and a month ahead (`:108-122`, `:191-199`).

### 1.10 PD-40 (new)

- **Catalogue keys on #174** that PD-42 uses: `new_students.view`, `new_students.manage`, `parents.view`, `parents.edit`, `students.view`, `students.manage`, `subscriptions.view`, `subscriptions.manage`, `billing.view`, `billing.record`, `org.manage`.
- **Bundles** (`legacy-bundles.ts` on #174):
  - `supervisor:operations` and `supervisor:sales` both hold `new_students.manage`;
  - only the managers hold `subscriptions.manage`;
  - `supervisor:sales` lacks `parents.edit`.
- **Design rule.** A key is necessary, never sufficient. Row scope stays in Layer 2.

---

## 2. Design principles

1. **One enrolment record, two origins.** Trial and intake share PD-16's transaction body. There is no second enrolment service.
2. **Responsibility does not move.** PD-8's Operations supervisor stays the one responsible supervisor. Sales ownership is added beside it and does not replace it, so chat access, groups, covers and transfers are unchanged.
3. **Scoped by default.** A supervisor enters and edits only families they own or supervise. Managers act for their department. The super admin acts for everyone.
4. **No parallel money.** The carried-over package is a PD-30 ledger row. The database does the counting.
5. **Incomplete is allowed; duplicate is not.** The minimum needed to make a real record is required. Everything else is optional. Duplicates are blocked or warned about before anything is created.
6. **G-07 is unchanged.** Phone and e-mail go only to the PD-17 parent file, through `seedFromEnrolment`, in `src/parent-profile`.

## 3. Ownership model

| Record | Meaning | Who | Changes by |
|---|---|---|---|
| `chat.learner_supervision` (PD-8, unchanged) | The **responsible Operations supervisor** of each child: chat reach, family group, covers | an Operations supervisor (DB rule) | PD-8 assign; PD-24 transfer (`changeSupervisor`/`transferLearners`) |
| **`chat.family_sales_owner`** (new) | The **Sales supervisor accountable** for the family: renewals, payments, the intake data they entered | a member of a `sales` department, in the same organization (DB guard) | the Sales manager or the super admin (`org.manage`), audited `family.sales_owner_changed` |
| **`student_enrolment.entered_by`, `entered_at`** (today's `assigned_by`, `assigned_at`, given a wider meaning) | **Who entered** the family or children, and when. Immutable. | whoever performed the intake (or the Assign) | never |
| `family.owner_id` (legacy, `NOT NULL`) | Follows the Operations supervisor, as PD-24 does today | — | `chat.transfer_ownership` |

**One family can have both owners.** A family may have an Operations supervisor and a Sales owner, either one, or both.

- **Entered by an Operations supervisor:** they become the supervisor of its children. A Sales owner is optional, and the Sales manager can set it later.
- **Entered by a Sales supervisor:**
  - they become its Sales owner;
  - its children have **no Operations supervisor** until one is set (§4.2);
  - `family.owner_id` is the entering Sales supervisor until then, because the column is `NOT NULL`. It moves through `transfer_ownership` when the Operations supervisor is set.
- **Families made through PD-16:**
  - `family_sales_owner` is backfilled from `trial_subscription.recorded_by` when that person is a Sales member. Otherwise it is left empty.
  - `entered_by` = `assigned_by`.

## 4. Workflows

### 4.1 Enter a family (intake)

**Who:** holders of `new_students.manage` who are:
- an **Operations supervisor** (`position = 'supervisor'` in an operations department);
- a **Sales department member**;
- the **Operations manager**, the **Sales manager**, or the **super admin**, acting for someone in their department, who is named as the owner.

**Where:** a new **"Add family"** button on the Parents list, and on New Students.

**One request, one transaction.** It reuses PD-16's body, extracted as `createFamilyInTx` and `enrolChildrenInTx`, and creates:
- the family;
- the primary-guardian contact;
- **an account only if an e-mail was given** (§4.5);
- the parent file (phone, e-mail) and family billing (method and currency, when given);
- for each child:
  - `enrol_learner` (the teacher is optional, see §6);
  - `learner_enrollment` (course, date of birth or stated age);
  - the carried-over package, if entered (§5);
- the PD-8 supervision: **the entering Operations supervisor themself**, and nobody else;
- `family_sales_owner`: **the entering Sales member**, or the owner a manager names;
- `student_enrolment(origin='intake', kind='new_family', entered_by=actor)`;
- the audit rows `family.entered` and `learner.supervisor_assigned` (when set), plus `subscription.carried_over` per package.

**After the transaction:**
- the weekly times, best effort, when a teacher and times were given;
- for an Operations-supervised family, a prompt: **"Create the family group"** (PD-16 `createGroup`, unchanged).

**No Assign gate for the entering supervisor (recommended).** The reasons:
- The owner asked for supervisors to self-serve, so a manager gate would bottleneck a migration of every existing family.
- The risks a gate would catch are covered elsewhere:
  - duplicates by §7;
  - a wrong supervisor by PD-24's transfer;
  - accountability by `entered_by`, the audit trail and a **"Recently entered"** filter for the Operations and Sales managers. That filter is a review list, not a gate.
- **One step is still a manager's.** Placing children on an Operations supervisor who is *someone else* stays the Operations manager's decision (PD-8's `canAssignSupervision`). So a Sales-entered family waits for §4.2.

### 4.2 A Sales-entered family needs an Operations supervisor

- It appears on New Students as **"Needs an Operations supervisor"**.
- The Operations manager (or the super admin) picks one. This is today's Assign dialog with nothing left to create.
  - It writes `learner_supervision` for each child and calls `transfer_ownership`.
  - The family group can then be created.
- **Until then:**
  - the parent can sign up, with the code relayed by the Sales owner;
  - Sales and the managers can see and edit the family;
  - no group exists, because PD-8 refuses a group with an unsupervised child.
- **The Sales supervisor may suggest a supervisor** (free choice, shown to the manager). They do not set it. **This is owner question Q1.**

### 4.3 Scope: "only the families they are authorized to handle"

| Actor | Enter a family | Read and edit families, add a child, carried-over package | Relay the sign-up code |
|---|---|---|---|
| Operations supervisor | yes, supervised by self | families in **reach** (PD-8: self, backup, cover) | families in reach |
| Sales member | yes, owned by self | families they **own** (`family_sales_owner = self`) | families they own |
| Operations manager | yes, for an Operations supervisor | every family | every family |
| Sales manager | yes, for a Sales member | every family **with a Sales owner** in their department; read-only elsewhere | own department's families |
| super admin | yes | every family | every family |
| anyone else, including Teachers and teachers | **no** (403 before any lookup) | no | no |

**Sales' existing org-wide reads.** Today Sales reads every parent and records payments for every family (`pd012-policy.ts:129`). The owner's item 6 requires narrowing that.

- **Recommendation:** a switch `SALES_FAMILY_SCOPE=all|own`, default `all`. Under `own`, a Sales member keeps every family they own *and* every **unassigned trial form**, because trials remain everyone's desk. The Sales manager keeps everything.
- **Why a switch:** turning it on before the migration intake is complete would hide families from the Sales staff who serve them today. It is the same rollout PD-35's strict scope used.
- **This is owner question Q2.**
- PD-42's own new actions (enter, edit, add child, carried-over package) are scoped `own` **from day one**, whatever the switch says.

### 4.4 Add a child to an existing family (the owner's Q2: "same form + one-click")

- **"Add child"** on the Parent Profile opens the same form with the parent block read-only. One click creates the child in the family:
  - **supervisor:** the family's current Operations supervisor, if it has one;
  - **otherwise:** the Sales owner path (§4.2);
  - `student_enrolment(kind='added_children')`.
- **If the family has a live group with that supervisor**, the child joins it through `ConversationService.addLearnersToFamilyGroup`, with the same authority as `createFamilyGroup`:
  - the child is anchored to the group;
  - their teacher joins;
  - the system message `group.learner_added`;
  - the audit row `family_group.learners_added`;
  - the outbox event `MEMBERSHIP_CHANGED`.
- **Who:** anyone who may edit that family (§4.3).
- **The trial sibling.** On Assign, `PARENT_EXISTS` now offers **"Add to «parent»'s family"**, which runs the same `added_children` path. This fixes §1.7.

### 4.5 Parent without an e-mail

The e-mail is optional at intake, because Core is incomplete.

- **Without one:** the contact has no account, and New Students and the Parent Profile show **"No sign-in e-mail"**.
- **Later:** **"Set sign-in e-mail"** on the Parent Profile (§4.3 editors) creates the account, links the contact and records it on the intake row. `student_enrolment.account_id` is nullable, and may be set from null **once**. The sign-up code then works as today.

## 5. The carried-over package

### 5.1 Where it lives

**It lives in `chat.learner_subscription`, PD-30's one ledger.** No new balance table is added.

| Change | Detail |
|---|---|
| `source` gains `'carried_over'` | It has no `request_id` and no `plan_ref`. `created_by` is required. |
| new column `lessons_used_before integer not null default 0` | `check (lessons_used_before between 0 and 1000)`, and `check (source = 'carried_over' or lessons_used_before = 0)`. **Completed may exceed the total** (§16 F1), with a manager's confirmation. |
| at most one standing per child | partial unique index `(learner_id) where source = 'carried_over' and voided_at is null`. **Refused if the child has any other standing row** (§16 F2). |
| `starts_on` = **the child's intake day** (academy date), even when the package is entered later | Lessons held in Chat since intake count against it; nothing is counted twice or given free (§16 F5) |
| `plan_months` optional; 1–24 for this source | as entered, never rounded to PD-30's set (§16 F3) |
| guard | The five conditions of `PD-30-amendment-carried-over` (§16 F4): origin `intake`; `created_by` = the child's `entered_by`; within 14 days; no other standing row; may handle the family **and** holds `subscriptions.carry_over`. Otherwise, one of PD-30's three roles (`can_grant_subscription_exception`). |

### 5.2 Counting

`compute_learner_access` (`:454-459`) becomes:

```
balance = Σ lessons_included − Σ lessons_used_before − learner_lessons_used(learner, min(starts_on))
```

Both sums are over standing rows.

- **Positions.** `positionOf` and `lessonPosition` (`subscription-reads.ts:74-93`) add Σ `lessons_used_before` to `used`. The next lesson after "12 of 20 done" reads **"Lesson 13 of 20"**.
- **Rows without the new column are unaffected.** For every existing row, `lessons_used_before = 0`, so their arithmetic is identical. PR-1 proves this with a before-and-after spec over the PD-30 suite.

### 5.3 What staff and parents see

These are server-computed and never entered:

- **Total** = `lessons_included`.
- **Completed** = `lessons_used_before` + lessons held in Chat since intake.
- **Remaining** = total − completed. With 20 entered and 12 completed, Remaining shows **8**.
- **Package status:** `active` while remaining > 0, otherwise `used_up`. This is shown beside PD-30's lock state (open, grace or locked).

**`ChildSubscription` gains `lessonsUsedBefore`.** The parent's Payments screen and the staff views read the same fields.

### 5.4 No payment, no reset, no lock

- **No payment.** No payment request, invoice or instalment is created. A later paid renewal adds a row after it, as for any child.
- **No reset.** The row is append-only. Re-entering means voiding the row (with a reason) and adding a new one; the lessons held in Chat since intake still count.
- **No lock at entry.**
  - Remaining > 0 → balance > 0 → state `open`.
  - A package entered as fully used (completed = total) gives balance 0, which is `grace`. That is PD-30's normal two grace lessons, then `locked` **only if `SUBSCRIPTION_LOCK_ENFORCED` is on**, which it is not in production.
  - **Whether a migrated used-up package should get a longer grace is owner question Q3.**
- **Already on instalments in Core?** Staff create the remaining instalments with PD-17's plan **without lessons**, so the package is not credited twice. The form says so.

### 5.5 Who enters it, correction, and audit

- **Entering:** at intake, or afterwards from the Student Profile within 14 days, **by the supervisor who entered the child**, for their own family (`PD-30-amendment-carried-over`, §16 F4). This uses a new key, **`subscriptions.carry_over`** (§8). Anyone else needs one of the three managers.
- **Correcting:** void and re-add, with a reason. **Raising the entitlement** (a larger total or a smaller completed) after the child has held any lesson in Chat needs PD-30's three roles, whatever the window (§15 S1).
  - **Within 14 days of the child's intake:** the same editors.
  - **After 14 days:** only PD-30's three roles (`subscriptions.manage`). Changing an opening balance late is then the same as granting free lessons.
- **Audit:**
  - the row itself keeps `created_by`, `created_at`, `voided_by`, `voided_at` and `void_reason`;
  - audit rows `subscription.carried_over` (total, completed, plan months) and `subscription.voided` (reason) are written in the same transaction;
  - the Student Profile's ledger already lists voided rows for staff.

## 6. Required fields

The form saves with this minimum. The rest is completed later, on the screens that already exist.

| Field | Required | Why |
|---|---|---|
| Parent name | **yes** | Every chat surface and the family's display name show it. `contact.name` and `family.display_name` are `NOT NULL`. |
| Parent phone **or** e-mail (at least one) | **yes** | Without either, the family can never be invited or reached, and duplicate detection has only a name to match, which is too weak at migration scale. Both are confined to the parent file. |
| Child name (one or more children) | **yes** | The child is the unit of supervision, schedule and package (`enrol_learner` checks 1–120 characters). |
| Parent e-mail | no | Needed only to sign up (§4.5) |
| Teacher | no | `learner.teacher_id` is nullable. It is set later by the supervisor (PD-31 `transfer_learner` allows it, `:500`). Without a teacher there are no weekly times and no teacher in the group. |
| Weekly times, lesson length | no | Need a teacher; best effort |
| Course, date of birth or age | no | PD-15 Student Profile |
| Payment method, currency | no | PD-17 family billing; nullable columns |
| Carried-over package | no | When given: total (1–1000) is required and completed (0–total) is required. Remaining is never entered. |
| Country | no | PD-17 Parent Profile |

## 7. Duplicates and idempotency

| Case | Rule |
|---|---|
| E-mail already a **family** account | **Blocks** with `PARENT_EXISTS`. If the actor may edit that family: "Add the children to «parent»'s family". If not: "This parent is already in Chat. Ask your manager". That second message gives no name, family or supervisor. Both managers get a notification. |
| E-mail of a staff or teacher account | **Blocks** (409, as today) |
| Same phone as a parent on file (`ParentPhoneDirectory`, exact E.164) | **Blocks**, with the same two answers as e-mail. Phone is the most reliable key in Core's data. The number is never returned. |
| Same normalized parent name *and* a child with the same normalized name, in a family the actor can see | **Warns** ("Possibly already entered: «family»"); the actor may continue |
| Same child in the target family (normalized name, plus date of birth when both are given) | **Blocks** with `CHILD_EXISTS`, overridable with `confirmDuplicate` (twins) |
| Double submit | A client-chosen enrolment `id`: `on conflict do nothing`, returning the first result |
| Two supervisors entering the same parent at the same time | `pg_advisory_xact_lock` on the normalized e-mail and the E.164 phone inside the intake transaction. The second gets `PARENT_EXISTS`. |

**Name normalization:** trim; fold case; remove tatweel; unify أ/إ/آ→ا, ى→ي, ة→ه.

## 8. Permissions (PD-40 keys; deny by default; row scope in Layer 2)

| Key | Status | Bundles | Layer-2 row scope |
|---|---|---|---|
| `new_students.view` | exists (#174) | as #174 | enrolments in scope (§4.3) |
| `new_students.manage` | exists | `supervisor:operations`, `supervisor:sales`, `manager:operations`, `manager:sales` (+ super admin) | enter a family; add a child; set a sign-in e-mail. Own families (§4.3). |
| **`subscriptions.carry_over`** | **new** | the same four bundles | only the supervisor who entered the child, for their own family, within 14 days, with no other standing row (`PD-30-amendment-carried-over`) |
| `subscriptions.manage` | exists (managers) | unchanged | late corrections (PD-30's three roles) |
| `parents.edit` | exists | **add to `supervisor:sales`, in PR-2 or PR-4** (its own `LATER` catalogue block, with the `decideBillingAccess` change; not PR-1) | Sales: owned families only. PD-17's `canEditParent` gains a "Sales owner of this family" basis. |
| `org.manage` | exists (managers) | unchanged | the Operations manager sets an Operations supervisor (§4.2); the Sales manager changes a Sales owner |

**Deny by default:**
- a key alone reaches no family; the scope is decided per request;
- `CHILD_EXISTS` and `PARENT_EXISTS` answers never disclose a family the actor cannot reach;
- an actor with no scope gets 403 **before** any lookup, as PD-17 does.

**How the two changes land, now that PD-40 is merged.** PD-40's consistency rule is one catalogue row plus one migration row. PD-42 makes both changes itself:
- PR-1's migration inserts `subscriptions.carry_over` into `chat.permission` (risk `finance`, **not delegable** like every key until PD-40 PR-3 verifies the bundles, `introduced_by` PD-42). It inserts `(supervisor|manager, operations|sales, subscriptions.carry_over)` into `chat.legacy_permission_bundle`.
- `(supervisor, sales, parents.edit)` is **deferred to PR-2 or PR-4**. PD-40's bundle spec pins each bundle to its Layer-2 policy, so the row lands in a `LATER` block of its own, in the same PR as the `decideBillingAccess` change that lets a Sales owner edit their families. A later migration can always add bundle rows; nothing is frozen by deferring it.
- `catalogue.ts` and `legacy-bundles.ts` get the same rows. PD-40's seed spec (`pd040-catalogue-seed.spec.ts`) and `pd040-access-roles.spec.ts` prove the code and the tables are equal.
- New routes declare `@Requires(...)`, so the `pd040-routes` guard and the route table pass. The route table is regenerated with `PD040_WRITE_ROUTE_TABLE=1`.
- The **DB layer** asks the same question through `chat.staff_has_permission(staff, key)` (`20261027190000…:541-549`). The intake and carried-over guards call it, so a key that is missing refuses at the database as well (§15, S3).
- The PD-40 guard is in SHADOW mode for legacy tiers. The Layer-2 row scope is what enforces today, and it is never shadowed.

## 9. How it meets the other decisions

- **PD-8.** It is unchanged. An Operations supervisor can only place children on **themselves**. Anyone else is still placed by the Operations manager. Group coherence holds, because an added child joins the family's existing supervisor.
- **PD-24.** A transfer moves the children, the group and `owner_id` as today. A Sales owner is moved separately (`org.manage`).
- **PD-30.** See §5. The carried-over row is just another ledger row. The lock follows the balance.
- **PD-31.** Weekly times are best effort. A teacher can be set later by the supervisor.
- **PD-35.** No interplay. The teacher list is every active teacher, and the teacher supervisor reaches the child through the teacher.
- **PD-16 trial path.** It is unchanged, except that the trial-sibling Assign attaches to the existing family (§4.4).
- **PD-17.**
  - Phone and e-mail stay confined to the parent file.
  - The Parent Profile gains **Add child**, **Set sign-in e-mail**, the **Sales owner** field, and the carried-over package on the Student Profile.

## 10. Admin Web UX

1. **"Add family"** on Parents and New Students (for `new_students.manage`).
   - It is the same `SubscriptionForm`, with its fields made optional to match §6, and a red marker on the three required fields.
   - Each child has a **"Current package"** block with:
     - total lessons;
     - completed lessons;
     - **remaining (read-only, computed live)**;
     - a status chip (Active / Used up);
     - plan months (optional).
   - The supervisor or owner line is read-only and shows the actor. A manager gets an "On behalf of" picker limited to their department.
2. **Duplicate answers** appear inline before anything is created (§7).
3. **New Students** becomes enrolment-centred:
   - **Filters:** "Awaiting Assign" (trial forms), "Needs an Operations supervisor", "Waiting for sign-up", "Signed up", "Recently entered" (managers only).
   - **Cards show the origin:** "Trial · teacher · date" or "Entered by «name» · date".
4. **Parent Profile:** Add child; Set sign-in e-mail; the Sales owner field (the Sales manager can change it); the sign-up code relay for the responsible person.
5. **Student Profile:** a "Current package" panel with total, completed, remaining and status, plus Correct (within the window, with a reason).
6. **Copy:** Arabic first, in RTL, checked at phone width.

## 11. Tests

- **Intake, as an Operations supervisor:** a family with a minimal record (name + phone + one child) → the supervisor is self → group → set e-mail later → sign-up.
- **Intake, as a Sales member:** Sales owner = self, no supervisor → "Needs an Operations supervisor" → the Operations manager sets one → `owner_id` moves → group.
- **Scope matrix:**
  - Sales member A cannot see, edit, add a child to or carry over for B's family: 404;
  - an Operations supervisor outside their reach: 404;
  - Teachers and teachers: 403;
  - a manager cannot act outside their department;
  - with `SALES_FAMILY_SCOPE=own`, the PD-17 and PD-27 reads narrow and the Sales manager still sees everything.
- **Carried-over package:**
  - 20 entered and 12 completed shows 8; one lesson held in Chat shows 7 and "Lesson 14 of 20" next;
  - a paid renewal afterwards adds on top;
  - an entry of 20/20 is in grace, not locked;
  - no `payment_request`, `invoice` or `family_instalment` is created;
  - the void-and-re-add correction respects the 14-day window, then needs the three roles;
  - the audit rows are present;
  - completed > total needs a manager's confirmation and leaves the right grace (21 of 20 → one grace lesson);
  - the DB refuses a second standing carried-over row, a carried-over row for a child with another standing row, one outside the 14-day intake window, and an unentitled `created_by`;
  - the safeguard tests in §15 (S1–S4).
- **PD-30 equivalence:** the full PD-30 suite still passes with the new compute, because every row has `lessons_used_before = 0`.
- **Duplicates:**
  - `PARENT_EXISTS` by e-mail and by phone, with each answer limited by scope;
  - concurrent intakes of one parent create one family;
  - `CHILD_EXISTS` with the Arabic name folding;
  - a double submit is idempotent.
- **Sibling:**
  - Add child joins the existing group with the new teacher;
  - a trial sibling's Assign attaches; one family, one account.
- **DB as the backstop:** raw SQL is refused for an intake enrolment entered by someone not entitled, a second `new_family` row for a family, a non-Sales `family_sales_owner`, and an Operations supervisor placing someone else's children.
- **Migration:** every PD-16 row is preserved; the `family_sales_owner` backfill is correct.
- **Privacy:** the confinement specs stay green; audit rows carry no phone or e-mail; `PARENT_EXISTS` leaks nothing out of scope.
- **Admin Web:** the form's required-field markers, the live remaining count, the duplicate answers, the filters and the profile actions.
- **Load:** integration tests on a private DB, with capped workers. No simulator is needed.

## 12. PR breakdown

| PR | Contents | Depends on |
|---|---|---|
| **PR-1, data** (waits for the GO) | Migration `20261028110000`, plus the Prisma model. No behaviour change. It contains: `student_enrolment` with `id` as primary key, `origin`, `kind`, a nullable `lesson_id` and `account_id`, `entered_*`, and the new guards; `enrol_learner` widened (intake authority, optional teacher); `chat.family_sales_owner` and its backfill; `chat.family_contact_key` (S1); `chat.staff_may_handle_family` and `chat.sales_family_scope()` (S3; the setting stays `all`); `learner_subscription` with `carried_over`, `lessons_used_before`, the 1–24 plan length and the new compute (F1–F5); the `subscriptions.carry_over` key and bundle rows (§8); the PD-30 amendment record; the PD-30 equivalence spec. | — |
| **PR-2, intake and the Sales switch** (as built, 2026-10-28) | API: `FamilyIntakeService` at `/family-intake` -- enter a family (as an Operations supervisor, a Sales member, or a manager for one of them), add children, the carried-over package and its correction, the sign-in e-mail; HMAC contact keys from the lower-cased e-mail and the E.164 number, under advisory locks; a replayed intake id answers the first result. The Sales switch: `SALES_FAMILY_SCOPE` (written to `chat.config` at boot), `decideBillingAccess`'s `'owned'` scope in every PD-17 / PD-27 / PD-30 read, the database write guards (migration `20261028210000`), and `parents.edit` for the Sales bundles (`LATER` block `pd042b`), limited to the families a Sales account owns. Admin Web: "Add family" (Parents) and "Add child" (Parent Profile), one form with the review step. Review of #202: the `family-contact-keys-backfill` CLI (dry run by default; `--apply` sets `intake.contact_keys_ready`, which opens `/family-intake` -- closed until then, `INTAKE_NOT_READY`); PD-16 Assign keys its parents; a replay must match its payload hash; a local number needs its country unless it is an Egyptian mobile; one answer for every parent the caller may not act on, the family named only to its owner; 'own' also for parent accounts (list, open, reset, sign-out) and the contact name, photo and family country (guards keyed on `chat.acting_staff_id`); `SALES_FAMILY_SCOPE` not defaulted by deploys, an unknown value refuses to boot. | PR-1 |
| **PR-3, the Operations side and the rest** (as built, 2026-10-29) | API at `/family-intake`: `entered` (New Students' families entered by hand, to whoever owns them; the Sales manager sees the Sales-owned ones; no contact channel); `families/:id` (sign-in, owners, what the viewer may do); `families/:id/operations-supervisor` (`org.manage`: the Operations manager or the super admin places a family's waiting children, on the family's own supervisor when some are placed -- siblings share one; `family.owner_id` follows; once, PD-24 moves it later); `families/:id/supervisor-suggestion` (D1: the Sales owner suggests a name; `chat.family_supervisor_suggestion`, migration `20261029120000`); `families/:id/sales-owner` (`org.manage`: the Sales manager or the super admin, audited from → to with a reason); `learners/:id/carried-over` (GET, the package panel). `ConversationService.addLearnersToFamilyGroup`: an added or newly placed child joins the family's live group (`group.learner_added`, `family_group.learners_added`). PD-16 Assign: a parent already in Chat answers `PARENT_EXISTS` naming the family; Assign with `familyId` adds the form's children there (`origin trial`, `kind added_children`), only to the family the trial's parent is in. The `pd042-ownership-report` CLI (S3, D2): read-only, exit 1 while any family has neither an Operations supervisor nor a Sales owner. Admin Web: the entered families on New Students with their filters, Choose / Suggest the supervisor, "Add to «parent»'s family" on Assign, Set sign-in e-mail and the Sales owner on the Parent Profile, the Current package panel on the Student Profile. The app words `group.learner_added`. | PR-2. The backfill (PR-2) runs before intake opens; the switch goes on only after the report is clean, signed off, and a GO (D2) |
| **PR-5, docs** | PD-42 in the boundary doc §4; `docs/admin/` intake guide for supervisors; catalogue rows handed to PD-40 | PR-2 |

The second guardian is deferred (owner Q4) and is not in these PRs.

## 13. Owner decisions

**2026-10-27:**
- Q2 (adding a child): "Same form + one-click".
- Q4 (second guardian): "Later".
- Q1 and Q3: Sales supervisors and Operations supervisors both enter the families assigned to them, scoped to those families. The full text is in the department head's relay, summarised in "What changed since v1".
- Q5: running packages carry over, with total, completed and remaining lessons, no reset and no new payment.

**2026-10-28: v2's Q1–Q5 DECIDED.** The owner's answer, verbatim:

> "Approve all 5 recommendations, with the following safeguards:
> 1. Make the migration idempotent. Re-running it must not create duplicate families, duplicate assignments, or grant the 2 grace lessons more than once.
> 2. Validate package balances carefully. Preserve the original total lessons, completed lessons, remaining balance, and plan length. Do not invent or silently alter package entitlements.
> 3. Enforce Sales supervisor access restrictions at the API and database authorization layers, not only in the UI. Enable the restriction only after migration is complete and verified. The Sales manager must retain access to all families.
> 4. Preserve a clear audit trail recording who created each family, who owns it, who assigned the Operations supervisor, and when these actions occurred.
> 5. Before implementation, verify the existing package rules and grace-lesson behavior. If any recommendation conflicts with existing production behavior or data, flag it before making changes.
> Important: Do not modify any Jawwid Core production code or database. Implement changes only in the intended system and follow the existing project safeguards."

**What is now decided:**

| # | Decision |
|---|---|
| D1 | A Sales-entered family gets its Operations supervisor from the Operations manager, through the "Needs an Operations supervisor" list. The Sales supervisor may suggest a name. |
| D2 | Sales' access narrows to their own families, behind `SALES_FAMILY_SCOPE`. The switch is turned on only after the intake is complete and verified. The Sales manager keeps every family. |
| D3 | A package entered as used up follows PD-30's normal rule: two grace lessons, then renewal. |
| D4 | Core expiry dates are not carried over. Total, completed and plan length are. |
| D5 | The Operations manager and the Sales manager may enter a family on behalf of a supervisor. The supervisor is the owner, and the manager is recorded as the one who entered it. |
| D6 | **Nothing in Jawwid Core is read or changed.** Intake is manual entry in Chat only. No Core code, database, API or export is touched, and no Core id is required. |

## 14. Out of scope

- The second guardian (deferred by the owner).
- Bulk import from a Core export. Core's data is incomplete by the owner's account, and entry is by hand. A CSV import could be a later PD.
- Merging duplicate families that already exist.
- An adult learner who is their own parent.
- Flutter changes. The parent's Payments screen already shows included, used and left. `lessonsUsed` is computed from the balance, so it already includes the completed-before lessons with no client change.

## 15. The owner's safeguards: mechanism and test for each

### S1. Idempotent; no duplicate families or assignments; grace never granted twice

| Risk | Mechanism | Test |
|---|---|---|
| A retried or double-submitted intake | The client generates `intake_id` (uuid), which **is** `student_enrolment.id`. The intake runs `insert … on conflict (id) do nothing`. A replay by the same actor returns the stored result and creates nothing. A replay by anyone else gets 409. | The same request sent twice, and sent concurrently, yields one family, one contact, one account, N children, one carried-over row per child, and **one** set of audit rows. |
| The same parent entered twice, by one or two supervisors | (a) An advisory lock on the normalized e-mail and on the E.164 phone, held inside the transaction. (b) **New `chat.family_contact_key (key_hash text primary key, family_id, kind ∈ {email, phone}, created_at)`**, where `key_hash` = sha-256 of the normalized e-mail or the E.164 phone. It holds no plain PII, which is G-07-safe. Intake and "Set sign-in e-mail" insert into it. The primary key makes a second family with the same phone or e-mail **impossible at the DB**. (c) `account.subject` is already unique. (d) A partial unique index on `student_enrolment (family_id) where kind = 'new_family'`. | Two concurrent intakes with the same phone: one family, and the other gets `PARENT_EXISTS`. Raw SQL inserting a second key fails. |
| Families that existed before PD-42 | Before intake opens, a one-off CLI `family-contact-keys:backfill` fills `family_contact_key` from every parent file (E.164 parse, as `ParentPhoneDirectory` does). It is run on staging and then production by the operator. It is **read-only towards everything else**, and it reports the collisions it finds without merging them. | A backfill spec over seeded parent files; a collision report for two families that share a phone. |
| A duplicate Operations-supervisor assignment | `learner_supervision` is keyed by `learner_id` (one supervisor per child, PD-8). Assigning the supervisor a child already has is a **no-op**: no write, no audit row. | Assign twice: one row, one audit row. |
| A duplicate Sales owner | `family_sales_owner` is keyed by `family_id`. Setting the same owner again is a no-op. | The same. |
| A duplicate carried-over package | A partial unique index: one **standing** `carried_over` row per child. It is allowed only when the child has **no other standing ledger row** (§16 F2). | A second insert fails at the DB; so does an insert for a child with a backfill row. |
| **Grace granted twice** | **PD-30 never stores grace. It derives it** from the cumulative balance: `grace_left = grace + balance` once the balance is ≤ 0, and grace lessons used are taken from the next package (`20261026140000…:25-29`, `:459-466`). Grace could only be given again by inflating the balance. That needs either a duplicate carried-over row (blocked above) or a void-and-re-add with a larger total or smaller completed. **Such a re-add, once the child has held any lesson in Chat or 14 days have passed, needs PD-30's three roles** (`subscriptions.manage`) and a reason. | Enter 20/20, hold 2 lessons (grace used up, state `locked`); a supervisor's void-and-re-add of 20/18 is refused and a manager's is allowed and audited. A void-and-re-add with identical numbers leaves `balance` and `grace_left` unchanged. |

### S2. Package balances preserved exactly; nothing invented or silently altered

- **Stored exactly as entered:** `lessons_included` (total), `lessons_used_before` (completed) and the plan length (§16 F3). Remaining is **never stored or typed**. It is derived by PD-30's compute (§5.2).
- **No clamping, ever.** An out-of-range value is **refused** with a message; it is never adjusted. Integers only. Total 1–1000. Completed ≥ 0. Above the total is §16 F1.
- **Confirmation step.** Before saving, the form shows "Total 20 · Completed 12 · Remaining 8 · 3 months" and must be confirmed.
- **No edits.** The row is immutable (`guard_learner_subscription`). A correction is void-and-new, with a reason, both audited (§5.5, S1).
- **No new entitlement appears silently.** Intake writes no `payment_request`, invoice, instalment, exception or `staff` row.
- **Tests:**
  - round-trip of the entered numbers;
  - every out-of-range value refused (none clamped);
  - remaining = total − completed − held-in-Chat, across holds and no-shows;
  - "Lesson 13 of 20";
  - no other ledger or money rows written;
  - the before-and-after equality spec over PD-30's suite for rows with `lessons_used_before = 0`.

### S3. The Sales restriction at the API and DB layers, switched on only after verification; the Sales manager keeps everything

- **One setting, written in one place.** `SALES_FAMILY_SCOPE=all|own` is read at boot and written to `chat.config ('sales.family_scope')`. It follows PD-35's strict-scope pattern (`platform/teacher-scope.ts:9-16`): only an explicit value is written, and a change is logged loudly. The API and the DB read that one row through `chat.sales_family_scope()`, so they cannot disagree.
- **API layer:**
  - `decideBillingAccess` (`pd012-policy.ts:113-131`) gains a scope `'owned'` for Sales members when the setting is `own`.
  - Every PD-17, PD-27, PD-30 and New Students read, and every PD-42 action, uses it.
  - The Sales manager stays `'all'`.
  - The PD-40 Layer-1 keys come first; then the Layer-2 scope, which is never shadowed.
- **DB layer:**
  - New `chat.staff_may_handle_family(staff, family)` = super admin, **or** PD-8 reach (`staff_reaches_family`), **or** the Operations manager, **or** the Sales manager, **or** (Sales member **and** (`sales.family_scope = 'all'` **or** `family_sales_owner.staff_id = staff`)).
  - It is called by the **write guards** of every family-scoped table a Sales member can write: `parent_file`, `family_billing`, `family_instalment`, `payment_request`, `payment`, `learner_subscription` (the `carried_over` and `staff` sources), `student_enrolment` (intake), `family_sales_owner`, `contact` (name and photo edits).
  - Reads are already server-side only (no request-role grants), so a read can only come through the API gate.
  - A raw write as a Sales member against a family they do not own is refused **whatever the API does**.
- **Switching on (D2).** The switch stays `all` until:
  1. a verification report (a CLI, read-only) shows every family has an Operations supervisor or a Sales owner, with counts per supervisor;
  2. the Operations manager and the Sales manager sign the counts off;
  3. the head and owner give a GO.
  Switching back to `all` is a restart.
- **Tests:**
  - the full matrix under `all` and under `own`;
  - the Sales manager reaches every family in both modes;
  - raw-SQL writes refused under `own`;
  - API and DB agree on every row of a seeded matrix;
  - the verification CLI reports unowned families.

### S4. Audit trail: who created, who owns, who assigned the Operations supervisor, and when

| Fact | Durable columns (current state) | Audit action (history; in the same transaction; no phone or e-mail) |
|---|---|---|
| Who created the family or children, and when | `student_enrolment.entered_by`, `entered_at` (immutable), `origin`, `kind` | `family.entered` / `family.children_added` (`{ origin, kind, learnerIds, onBehalfOf? }`) |
| Who owns it (Sales) | `family_sales_owner.staff_id`, `assigned_by`, `assigned_at` | `family.sales_owner_set` and `family.sales_owner_changed` (`{ from, to, reason }`) |
| Who assigned the Operations supervisor, and when | `learner_supervision.supervisor_id`, `assigned_by`, `assigned_at` (they exist) | `learner.supervisor_assigned` per child (exists), plus `family.operations_supervisor_set` (`{ supervisorId, learnerIds }`) for the family |
| The carried-over package | `learner_subscription.created_by`, `created_at`, `voided_by`, `voided_at`, `void_reason` | `subscription.carried_over` (`{ total, completed, planMonths }`), `subscription.voided` |
| Entered on behalf of someone (D5) | `entered_by` = the manager | `onBehalfOf` = the owner, on `family.entered` |

- **Reading it.** A **"Family history"** panel on the Parent Profile reads these audit rows for the family and its children. It is in scope (§4.3) and shows actor name, action and time.
- **Tests:**
  - each action writes exactly one audit row with actor and time;
  - the panel lists them in order;
  - a replay (S1) adds none;
  - no audit row contains a phone or an e-mail (the existing privacy spec, extended).

### S5. Verify the existing package and grace rules first

Done; see §16. The conflicts it found are **flagged** there, each with a recommendation. They are to be decided before any code.

## 16. Safeguard 5: PD-30 on `main` checked against this plan

**Checked:** `main` @ `a547b0e2`. `20261026140000_chat_pd030_subscription_lock.sql` is the only migration defining the ledger, the counting, the state and the grace rule. Nothing after it redefines them. Also checked: `subscription-effects.service.ts` and `subscription-reads.ts`.

### 16.1 What the existing rules are, and where the plan agrees

| Rule on `main` | Evidence | Plan |
|---|---|---|
| A child with **no** standing ledger row has `balance` NULL, is `open`, and is never balance-locked | `:361`, `:454-458` | agrees: a child entered without a package is never locked |
| Used = `regular` + `makeup` lessons with outcome `held` **or `student_no_show`**, from the earliest standing row's `starts_on` | `:408-419` | agrees. A Chat no-show uses a lesson, as for every child. **The form tells staff to enter Core's *used* count, no-shows included if Core counted them.** |
| Balance = Σ included − used | `:454-459` | extended by − Σ `lessons_used_before`. It is identical when that is 0 (S2 equivalence spec). |
| Grace = `subscription.grace_lessons` (default **2**). It is derived, not stored: `grace_left = greatest(grace + balance, 0)` once balance ≤ 0, and **grace lessons used are taken from the next package** | `:94-101`, `:459-466`, header `:25-29` | agrees. This is why grace cannot be granted twice except by inflating the balance (S1). |
| `locked` when balance has passed the grace, or an instalment due on or after go-live is overdue, unless an exception covers it | `:466-492`, `:85-92` | agrees |
| **Enforcement off (production):** state is computed, every event is marked applied **with no card and no push**. On the first enforced pass, every child already in grace or locked is **announced** | `subscription-effects.service.ts:88-126`, `:158` | agrees. **Note:** packages entered as used up during the migration will be announced to their families when enforcement is first turned on. |
| A subscription with **no payment** (`source = 'staff'`) is allowed only to the super admin, the Operations manager or the Sales manager, with a reason, starting between −7 and +30 days | `:103-122`, `:191-199` (owner decision 2026-10-26) | **conflict, F4** |
| `plan_months ∈ {1, 3, 6, 12}` | `:132` | **conflict, F3** |
| PD-30's go-live **backfill** created a ledger row from PD-15's `package_lessons` for every child that had one | `:877-890` | **conflict, F2** |
| Once a ledger row exists, the ledger is the package. `package_lessons` is no longer edited | `lessons/enrollment.service.ts:206-208` | agrees: intake writes no `package_lessons` |

### 16.2 Flagged before code, and the decisions

| Flag | Status (2026-10-28) |
|---|---|
| F1 | **DECIDED** by the department head, under the owner's safeguard 2: completed is stored exactly as entered, the form shows "Over by N", a manager confirms, and PD-30 counts the grace once. |
| F2 | **DECIDED**: carry-over only for a child with **no** standing ledger row, enforced in the DB. QA sizes it on systest with the read-only count below. A production count, if needed, is an owner-run query relayed by the head. |
| F3 | **DECIDED**: `plan_months` 1–24 for `source = 'carried_over'` only. |
| F4 | **DECIDED by the owner**, verbatim: "Allow, tightly limited (Recommended)". Supervisors may carry over a package **only** for a child they entered through the new form, **only** within 14 days of entering them, **only** if the child has no other package, and **only** for their own families. Everything else stays with the three managers. It is recorded as `docs/product/pd-registry/PD-30-amendment-carried-over.md`, and all five conditions are enforced in the DB (below). |
| F5 | **DECIDED** (agreed): `starts_on` is the child's intake day. |

The original analysis of each flag follows, unchanged.

**F1. A Core student already past their total (already into grace, or over it).** *(DECIDED: the recommendation.)*
- **The issue.** v2 capped completed at the total. That cannot represent a student who has used 21 of 20, and capping would silently alter their entitlement (S2).
- **Recommendation:** accept any completed ≥ 0, exactly as entered.
  - When completed > total, the form shows "Over by N". It needs a confirmation from the Operations manager or the Sales manager (the PD-30 three roles), recorded in the audit row.
  - PD-30's derived grace then counts the over-use: 21 of 20 leaves one grace lesson, so the grace is still given once in total.
  - Over the grace, the child is `locked` when enforcement is on, which is the truth.
- **Alternative:** refuse above the total and require an exception. That loses the real count.

**F2. Children who already have a ledger row in Chat.** *(DECIDED: the recommendation.)*
- **The issue.** PD-30's go-live backfill (`:877-890`), and any paid request or instalment plan since, gave some existing children a standing row. A carried-over row on top would **double their package**.
- **Recommendation:** a carried-over row is allowed **only for a child with no standing ledger row** (DB-enforced). A child with one shows their ledger and offers no carry-over. If the backfilled row is wrong, a PD-30 role voids it first, with a reason.
- **To check before PR-2.** I cannot read production. The head or the operator should run this read-only query on production and on systest:
  `select source, count(*) from chat.learner_subscription where voided_at is null group by source;`
  It shows how many children this affects. If production has none (likely, before go-live), F2 is only a guard.

**F3. Plan length.** *(DECIDED: the recommendation.)*
- **The issue.** PD-30 allows only 1, 3, 6 or 12 months (`:132`). A Core plan of another length (2 months, 4 months) **cannot be preserved** as S2 requires.
- **Recommendation:** for `source = 'carried_over'` only, allow 1–24 months. That is a single CHECK change (`plan_months in (1,3,6,12) or (source = 'carried_over' and plan_months between 1 and 24)`). **Readers checked:** Admin Web's `planLabel` (`features/profiles/copy.ts:185-191`) and Flutter's `billingPlanMonths` and `subscriptionMonthCount` (ICU plurals, `app_ar.arb:1168`, used by `payment_sections.dart:17-33`) already render any number of months. The CHECK is the only change.
- **Alternative:** keep the set, and store a length outside it in the note with `plan_months` null. This loses the structured value.

**F4. Supervisors recording lessons with no payment conflicts with PD-30's owner decision of 2026-10-26.** *(DECIDED by the owner: allowed, tightly limited. See the decided wording at the end of this item.)*
- **The issue.** PD-30 says only the super admin, the Operations manager and the Sales manager may add lessons with no payment behind them. The DB enforces this (`can_grant_subscription_exception`). The approved PD-42 design lets **every Sales and Operations supervisor** record a carried-over package, which is also lessons with no Chat payment. The owner approved it on 2026-10-28, but it is an exception to a standing decision.
- **Recommendation:** record it as a **PD-30 amendment** (`PD-30-amendment-carried-over`) and bound it narrowly, all DB-enforced:
  - source `carried_over` only;
  - only for a child whose `student_enrolment` has origin `intake`;
  - only within 14 days of that intake;
  - only when the child has no other standing row (F2);
  - only by someone who may handle the family (`staff_may_handle_family`) and holds `subscriptions.carry_over`.
  - Anything else stays with the three roles.
- **Decided wording (owner, 2026-10-28; `PD-30-amendment-carried-over`).** `guard_learner_subscription` refuses a supervisor's `carried_over` row unless **all** of these hold:
  1. the child's `student_enrolment` has origin `intake`, so the child was entered through the new form;
  2. **`created_by` = that enrolment's `entered_by`**. This is narrower than v3's proposal: the supervisor who entered the child, not anyone who handles the family;
  3. `now()` is within 14 days of `entered_at`;
  4. the child has **no other standing ledger row**;
  5. `chat.staff_may_handle_family(created_by, family)` **and** `chat.staff_has_permission(created_by, 'subscriptions.carry_over')`.
  
  Anything else that adds lessons with no payment needs `can_grant_subscription_exception` (the three managers), as PD-30 decided. That includes a manager who entered a family on behalf of a supervisor (D5): they are one of the three anyway.
- **Tests:** one refusal per condition (wrong origin, another supervisor, day 15, an existing row, a family out of scope, a missing key); one success; and success for each of the three managers outside all five conditions.

**F5. Lessons held in Chat before the package is entered.** *(DECIDED: agreed.)*
- **The issue.** If a child is entered without a package and the package is added days later, the lessons held in between would not count, because the counting starts at the row's `starts_on`. That would be free lessons.
- **Recommendation:** `starts_on` = **the child's intake day**, always, even when the package is entered later (within the 14 days). The form asks for "completed lessons **before «intake date»**". Lessons held in Chat since then count automatically.
- PD-30's guard allows a backdated `starts_on` only for `staff` rows (−7 days). The `carried_over` rule above takes the intake day instead.
- **No decision needed** unless the head disagrees.

**No conflict found with:**
- the lock, overdue instalments, exceptions or renewal requests;
- "Lesson N of M" (the report keeps its M, `:259-262`);
- the materializer hold (only when enforced);
- go-live (`subscription.overdue_from`): migrated instalment plans created in Chat with due dates before go-live never lock, which is the existing rule.
