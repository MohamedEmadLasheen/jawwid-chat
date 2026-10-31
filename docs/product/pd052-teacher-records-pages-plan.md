# PD-52 · Teacher records: the Attendance & Complaints page and the Grants & Testimonials page

**State: PLAN.** Nothing here is built. The owner approves the plan and
answers §11; the department head assigns migration slots and schedules the PRs.
Audited against `main` at `f4062fcc` (2026-10-31).

## 1. The request

The owner asked for two dedicated Admin Portal pages, used by Operations,
Teachers Supervision and Sales:

1. **Attendance, Delays, Excuses & Teacher Complaints.** Teacher leave,
   lateness, excuses and absences, and complaints. A parent's complaint from the
   Parent account appears here by itself. Supervisors of all three departments
   can also record lateness, excuses and absences, and complaints by hand.
2. **Grants & Testimonials.** Teacher grants and testimonials. A parent's praise
   from the Parent account appears here by itself. The same supervisors can add
   grants and testimonials by hand.

It must also give:
- automatic sync of what parents send, and manual entry in the Admin Portal;
- each record linked to its teacher and, where it applies, the student and the
  parent;
- one accurate record per teacher of attendance, complaints and positive
  feedback;
- permissions per department.

## 2. The short answer

**Most of this already exists.** PD-26 (2026-10-22) answered almost the same
request: the owner then asked for "teacher leave, apologies and absences, late
arrivals, grants and rewards, and complaints (from management and from
parents)". The result is the Teacher Supervision page
(`/teachers/supervision`, six sections). PD-32 added the parent's form, and the
PD-26 amendment of 2026-10-27 opened the page to Operations.

What PD-52 really changes:
1. **Two pages instead of one.** The six sections of the PD-26 page are split by
   meaning: negative and attendance records on page A, positive records on
   page B. The page moves out of the Teachers area so that Sales can reach it.
   Nothing is copied: both pages read the records that already exist.
2. **Testimonials are new.** Today a parent's praise only sits in the "Parent
   feedback" inbox, and staff cannot record a testimonial at all.
3. **Sales is new.** Sales has no access to any of this today (§11 b).
4. **Links to the student and the parent** are missing on staff-recorded
   complaints, and on grants and testimonials.
5. **Notifications for parent submissions** are missing. Today only a PD-47 task
   is created.
6. **Permissions** get page-level keys per page, with read, record and decide
   separated.

## 3. What exists on main

| Area | What is built | Where |
|---|---|---|
| PD-26 Supervision page | One page, sections `leave · absences · lateness · rewards · complaints · feedback` in `?section=`. Old `/teachers/leave` and `/teachers/discipline` links redirect to it. | `apps/admin-web/src/features/teacher-supervision/TeacherSupervisionPage.tsx`; `docs/admin/pd026-teacher-supervision.md` |
| Leave (PD-12, PD-26) | Requests, approve / decline / cancel, balance = allowance − approved days (computed). "On leave" is computed from `chat.teacher_day_off`. | `apps/api/src/leave/` |
| Lateness (PD-12, PD-26) | `POST /lessons/:id/lateness`, trials and regular lessons. Counts above the threshold. | `apps/api/src/discipline/` |
| Excuses and absences (PD-11, PD-12, PD-26, PD-50) | The teacher's apology (`POST /lessons/:id/teacher-apology`, by the teacher or by staff with `lessons.manage`), a no-show, a late apology, and an absence with no lesson (`POST /teachers/:id/absences`). A PD-50 category (travel, illness, exams, emergency, other) is kept on the lesson for staff and the teacher only. PD-50 #298 is merged. | `apps/api/src/lessons/lesson.service.ts`, `discipline.service.ts` |
| Ladder (PD-12, PD-26) | A violation is suggested a step and decided once: warning, deduction 1 or 2, suspension, permanent, or excused. Reset monthly. A decided deduction is priced from the super admin's default. | `discipline/ladder.ts`, `chat.price_decided_deduction` |
| Complaints (PD-10, PD-26, PD-32) | `chat.teacher_supervision_entry` of kind `complaint` with `complaint_source` `management` / `parent` / `parent_app`, `handled_by`, `complaint_followup`, and one `complaint_resolution`. Upholding one puts it on the ladder. Status (open / upheld / actioned / resolved) is computed. | `apps/api/src/teacher-file/` |
| Parent feedback (PD-32) | The parent picks a child, then a category (praise, suggestion or complaint), and writes. `chat.parent_feedback` stores family, contact (parent), learner, teacher, category, body, status and one reply. A complaint also becomes a PD-26 complaint (`parent_app`). Praise and suggestions are replied to on the Parent feedback list. **The teacher never sees it.** Limited to 3 per child and 10 per family per day. | `parent-feedback.service.ts`; app `lib/features/feedback/`, entry in `lib/features/profile/presentation/my_profile_screen.dart` |
| Grants = rewards (PD-11, PD-18, PD-26) | PD-11's bonus entry (`kind bonus`) gives the reason, date and recorder, and posts a card in the teacher's supervision chat. It is priced in PD-18 payroll. `POST /teacher-files/:id/rewards {reason, amount}` is for the finance tier; `POST /teachers/:id/bonus` has no amount. | `teacher-file/teacher-payroll.service.ts`, `supervision/` |
| Scope (PD-35, PD-26 amendment) | `TeacherScopeService.pageBases`: `super_admin` (every teacher), `teachers` (PD-35 scope), `operations` (teachers of their families plus a 30-day lesson window, narrowed down to the child). The DB backstop is `chat.may_supervise_teacher` / `chat.may_supervise_learner_row`. | `apps/api/src/platform/teacher-scope.ts`; migration `20261027160000` |
| Permissions (PD-40) | `teacher_supervision.view`, `teacher_supervision.record`, `feedback.view`, `leave.allowance`, `teacher_files.*`. These are in the Operations and Teachers bundles; **Sales holds none of them**. The guard runs in shadow mode for legacy tiers and is enforced for specialists. | `apps/api/src/platform/permissions/catalogue.ts`, `legacy-bundles.ts` |
| Follow-up (PD-47, PD-35) | Each complaint and parent feedback opens a task for the teacher's supervisor (else the Teachers manager), due 48 h after filing. A PD-35 case may be opened from a feedback. | migration `20261030000000_chat_pd047_phase_b_decisions.sql` |
| Audit (PD-35 B7) | The action log lists what a staff member did, from `audit:`, `case:` and `task:` lines. Supervision entries, violations and parent feedback are append-only by database guard. | `apps/api/src/action-log/` |
| Certificates (PD-12, PD-41) | Teacher certificates are requested by Teachers Supervision. They are **not** grants (§11 a). | `certificates/` |

## 4. Requirement → existing → gap

| # | Requirement | Existing | Gap |
|---|---|---|---|
| R1 | Leave records on page A | PD-26 Leave section | Moved only. Sales visibility is §11 b. |
| R2 | Lateness records | PD-26 Lateness (trial / regular) | Moved only. Sales would record trial lateness (§11 b). |
| R3 | Excuses and absence reports | PD-26 "Apologies & absences" (apology, no-show, no-lesson absence), PD-50 category | Renamed "Excuses & absences". The PD-50 category becomes a column and a filter (staff only). |
| R4 | Teacher complaints | PD-26 Complaints, all sources | Moved. Staff-recorded complaints gain an optional student and family link (R10). |
| R5 | A parent's complaint appears automatically | PD-32 → `parent_app` complaint | **Already automatic.** No gap, apart from notification (§7). |
| R6 | Manual lateness, excuses, absences and complaints by all three departments | Teachers and Operations can do this; Sales cannot | Sales basis (§5.4), if the owner agrees (§11 b). |
| R7 | Grants on page B | PD-26 "Grants & rewards" (PD-11 bonus) | Moved. "Grants" is assumed to mean these (§11 a). |
| R8 | A parent's praise appears automatically | Praise is in the Parent feedback inbox only | Page B's Testimonials section reads praise directly. No copy is made. |
| R9 | Manual testimonials | None | **New**: a staff-recorded testimonial (§5.3). |
| R10 | Linked to teacher, student and parent | Lateness and excuses come through the lesson. Parent feedback has learner and contact. A staff complaint links a conversation only. Grants link the teacher only. | Optional `learner_id`, `family_id` and `trial_prospect_id` on supervision entries (§5.3). |
| R11 | One unified record per teacher | The Teacher File (Teachers department only) | A per-teacher view on both pages, computed and never stored (§5.5). The Teacher File stays the Teachers department's. |
| R12 | Permissions per department | Two page keys, no Sales | Five page keys with view / record / decide split (§6). |

## 5. Proposal

### 5.1 Two pages, one source of records

```
Page A  /teacher-attendance       "Attendance & Complaints"   (ar: الحضور والتأخير والأعذار والشكاوى)
        ?section=leave | lateness | excuses | complaints   &teacher=<id> &month=YYYY-MM
Page B  /teacher-grants           "Grants & Testimonials"     (ar: المنح والشهادات الطيبة)
        ?section=grants | testimonials                    &teacher=<id> &month=YYYY-MM
super admin: /admin/teacher-attendance, /admin/teacher-grants
```

- Both pages are **top-level nav entries** under one group, "Teacher records".
  Each is offered when `GET /teacher-records/access` says so, never from the
  client's guess. They are no longer inside the Teachers area, because Sales has
  no Teachers area.
- The Teachers area keeps a "Supervision" tab, which links to page A.
- **Redirects.** Old links redirect to the new sections:
  `/teachers/supervision?section=leave|absences|lateness|complaints` goes to
  page A, `rewards` to page B grants, and `feedback` by category (complaint and
  suggestion to page A complaints, praise to page B testimonials). The older
  `/teachers/leave` and `/teachers/discipline` redirects follow.
- **The component code moves; it is not copied.** The section components in
  `features/teacher-supervision/` are re-homed under two page shells.
  `TeacherSupervisionPage` becomes the redirect.
- **Suggestions.** They sit on page A's Complaints section behind a
  "Suggestions" filter. They are never on the ladder (§11 f).

### 5.2 Page A sections

| Section | Rows | Actions (by key) |
|---|---|---|
| Leave | PD-12 requests plus the overview. The balance is shown only to the Teachers department. | decide: approve / decline / cancel |
| Lateness | trial and regular, with the delay, the threshold and the ladder state | record: lateness on a held lesson; decide: the ladder step |
| Excuses & absences | teacher apology, no-show, late apology, no-lesson absence, with the PD-50 category | record: an absence with no lesson, or a teacher apology for a lesson (existing ticket); decide: the step, or excuse it |
| Complaints | every source (`management`, `parent`, `parent_app`), handler, follow-ups, status; filter for suggestions | record: complaint and follow-up; decide: take, uphold, resolve, reply to the parent |

Each row shows the teacher and, where known, the student and the family. It
also shows who recorded it and when, and the decision with who decided and when.

### 5.3 Page B sections

| Section | Rows | Actions |
|---|---|---|
| Grants | PD-11 bonus entries (reason, date, recorder). The amount is shown only to the finance tier (super admin, Teachers manager). | record: a grant without an amount. finance tier: with an amount (PD-26 one-transaction route). |
| Testimonials | (1) the parent's praise from `chat.parent_feedback` where `category = 'praise'`, read in place; (2) staff-recorded testimonials (new) | record: a testimonial; decide: reply to the parent's praise (existing); optionally share with the teacher (§11 c) |

**Data model (one migration, slot from the head):**

```
chat.teacher_supervision_entry
  + kind 'testimonial'                 staff-recorded positive feedback
  + kind 'entry_void'                  refers_to one complaint|testimonial entry, reason required,
                                       unique per target; the target is hidden by default, never deleted
  + testimonial_source text            'parent_message' | 'parent_call' | 'staff_observation' | 'other'
                                       (required iff kind = testimonial)
  + learner_id uuid null               the student, where it applies
  + family_id uuid null                the family (the parent), where it applies
  + trial_prospect_id uuid null        a trial family not yet enrolled (Sales)
  guard: learner_id belongs to family_id; the teacher is or was that learner's teacher
         (current, or a lesson in the 30-day window); same organization; at most one of
         family_id / trial_prospect_id
```

- The parent's praise is **not copied** into a testimonial. Page B unions the two
  sources at read time, as complaints already do with `parent_feedback_id`. No
  sync job runs, so nothing can drift.
- Existing rows keep null links. A parent complaint's family is still computed
  as today (`complaint-family.ts`). No backfill is done.
- Grants stay PD-11 `bonus` entries. A grant entered by mistake is corrected in
  PD-18 payroll, as today, and is not voided here.

### 5.4 Who sees what (scope per department)

| Basis | Teachers | Rows down to the child | Rights |
|---|---|---|---|
| super admin | all | all | all, amounts |
| Teachers department | PD-35 scope (unchanged) | all of those teachers | view, record, decide; the Teacher File; the leave balance |
| Operations | PD-26 amendment, unchanged: teachers of their families plus the 30-day window | only their own families' child rows | view, record, decide as PD-26 amendment; no balance, no Teacher File, no amounts |
| **Sales (new, if §11 b = yes)** | teachers of a trial Sales can read on its Trials page in the last 30 days, and the current teachers of families Sales owns (PD-42 owner) | only rows about those trials and families; teacher-level rows (leave, no-lesson absence, management complaint) **hidden** | view and record (trial lateness, complaint, testimonial, grant without amount); **no decide**, no ladder step, no deductions, no balance |

Sales is a new basis in `TeacherScopeService.pageBases`, with one SQL function
`chat.sales_teacher_ids(staff, org)` read by the service. The database backstop
is a new `chat.may_record_teacher_row(staff, teacher, learner, prospect, org)`
used only in the insert guards of `teacher_supervision_entry` (complaint,
follow-up, testimonial, bonus without amount) and of lateness on a trial.
`chat.may_supervise_teacher` is **not** widened, so Sales can never decide, take
or uphold. An out-of-scope teacher or row answers 404, as in PD-35.

### 5.5 One record per teacher

Choosing a teacher (`&teacher=`) on either page shows a header strip. It is
computed on read from the same records, never stored:
- leave status and next return;
- this month's ladder count and step;
- open complaints;
- this year's grants and testimonials;
- a link to the Teacher File for those who may open it (`useOpensTeacherFiles`).

The strip respects the caller's narrowing: Operations and Sales counts cover
only rows they can see, **except the ladder count**, which stays the teacher's
(as PD-26 amendment).

Route: `GET /teacher-records/teachers/:id/summary`.

### 5.6 API surface

Existing routes are reused. New or changed routes:

```
GET  /teacher-records/access                      which pages and which actions, per basis
GET  /teacher-records/testimonials?teacher=&month= praise ∪ staff testimonials, narrowed
POST /teachers/:id/testimonials                   {body, source, learnerId?, familyId?, prospectId?, conversationId?}
POST /teacher-records/entries/:id/void            {reason}   complaint or testimonial, once
GET  /teacher-records/teachers/:id/summary
POST /teacher-files/:id/entries (complaint)       + learnerId?, familyId?, prospectId?
POST /lessons/:id/lateness                        + Sales on a trial in reach
GET  /teacher-supervision/directory               + Sales basis
```

`GET /lessons/access.supervisionPage` stays for one release, then goes.

## 6. Permissions (PD-40)

New catalogue keys:

| Key | Meaning | Risk |
|---|---|---|
| `teacher_attendance.view` | see page A | pii |
| `teacher_attendance.record` | record lateness, absences, excuses, complaints, follow-ups | pii |
| `teacher_attendance.decide` | leave decisions, ladder decisions, take / uphold / resolve, reply to a parent | pii |
| `teacher_grants.view` | see page B | pii |
| `teacher_grants.record` | record a grant (no amount) or a testimonial; void a testimonial; reply to praise | pii |

Amounts stay `teacher_files.finance`, and the balance stays `leave.allowance` /
the Teachers department.

Legacy bundles (the services still narrow by basis):

| Bundle | A view | A record | A decide | B view | B record |
|---|---|---|---|---|---|
| supervisor / manager @teachers | ✓ | ✓ | ✓ | ✓ | ✓ |
| supervisor / manager @operations | ✓ | ✓ | ✓ | ✓ | ✓ |
| supervisor / manager @sales (§11 b) | ✓ | ✓ | — | ✓ | ✓ |

**Moving from the old keys.** One migration seeds the five keys and copies every
`access_role_permission` row: `teacher_supervision.view` gives both `*.view`
keys, and `teacher_supervision.record` gives both `*.record` keys plus
`teacher_attendance.decide`. Routes accept `@Requires.any(old, new)` for one
release. A later PR removes the old keys once the query
`select … where permission in (old)` returns nothing. The catalogue/DB equality
spec and `pd040-route-permissions.md` are regenerated in each PR.

## 7. Notifications

There are none today for parent feedback, apart from the PD-47 task.

New rules (each new `ruleKey` needs a `chat.notification_rule` row, which means
a migration slot):

| Rule | When | To |
|---|---|---|
| `inbox.teacher_complaint_received` | a parent files a complaint (`parent_app`), or a staff complaint names a family | the teacher's PD-35 supervisor (else the Teachers manager) and the family's PD-8 Operations supervisor |
| `inbox.teacher_praise_received` | a parent files praise | the teacher's supervisor, as an inbox item only, with no push |

- They are sent through the PD-34 outbox, deduplicated by feedback id, and keep
  PD-34 quiet hours.
- The PD-47 task is unchanged. The inbox item links to the row on the new page.
- **The teacher is never notified** of a complaint or praise unless staff share
  it (§11 c).
- A grant still posts its existing card in the teacher's supervision chat.

## 8. Audit trail

- Every record stays **append-only by database guard**:
  - supervision entries: `forbid_change`;
  - violations: decided once;
  - parent feedback: the text never changes, and the status only moves forward;
  - leave: PD-12's states.
- A mistake is corrected by a new row, never by an edit:
  - a complaint or testimonial: `entry_void`, with a reason;
  - lateness or excuses: PD-35 report correction or the ladder's "excused";
  - grants: PD-18 correction.
- Each row carries who recorded it, when, and its basis.
- New writes call the existing audit service, so they show in the PD-35 B7
  action log as `audit:` lines.
- An action taken in a PD-21 support session is marked as such.

## 9. PR breakdown (small, in order)

| PR | Content | Migration | Depends |
|---|---|---|---|
| PR-0 | This plan and `pd-registry/PD-52.md` | — | — |
| PR-1 | API: the five keys, grant copy, `@Requires.any` on existing routes, bundles, `GET /teacher-records/access`. No behaviour change. | slot 1 | owner OK |
| PR-2 | API: entry links (learner / family / prospect), `testimonial`, `entry_void`, testimonials list and record, teacher summary | slot 2 | PR-1 |
| PR-3 | Admin Web: page A (re-homed sections, PD-50 column, suggestions filter), nav group, redirects | — | PR-1 |
| PR-4 | Admin Web: page B (grants, testimonials, record dialog, summary strip) | — | PR-2, PR-3 |
| PR-5 | API + Admin Web: the Sales basis (scope function, guards, directory, trial lateness) | slot 3 | §11 b, PR-2 |
| PR-6 | Notifications: two rule rows and the producer on parent feedback and staff complaint | slot 4 | PR-2 |
| PR-7 | App (optional, §11 g): two entry points on the child's profile that preselect the category; ar/en strings | — | — |
| PR-8 | (optional, §11 c) "Share with the teacher" for praise: a card in the teacher's supervision chat | — | owner, PR-2 |
| PR-9 | Close-out: boundary §4 PD-52, `docs/admin/pd052-teacher-records.md`, remove the old keys | — | all |

- Migration slots are **not chosen here**. The department head assigns 3 or 4.
- Route-adding PRs merge one at a time, re-merging `main` and regenerating the
  route table each time.
- PR-3 and PR-4 do not touch the API, so they can run beside PR-2 and PR-5.

## 10. Tests

New integration spec `apps/api/test/integration/pd052-teacher-records.spec.ts`:
- A parent complaint appears on page A for the teacher's supervisor and the
  family's Operations supervisor. It does not appear for an Operations
  supervisor of another family.
- Parent praise appears on page B. It is never copied (count rows).
- A staff testimonial with a learner of another family is refused by the
  trigger. A learner the teacher never taught is refused.
- `entry_void` works once per target. UPDATE and DELETE are refused on every
  table.
- Sales:
  - reads trial rows in reach;
  - gets 404 on a regular lesson's lateness, another teacher, or leave;
  - gets 403 on decide, uphold and take;
  - sees no balance, step or amount.
- No teacher-reachable route returns parent feedback or a testimonial (route
  walk). The confinement to `src/teacher-file` holds.

Existing specs must stay green: PD-26, PD-26 amendment, PD-32, PD-35, PD-47,
PD-40 bundles, catalogue = DB, and route permissions.

Admin Web:
- page A and page B section tests (moved from `TeacherSupervision.test.tsx`);
- redirects from every old URL;
- the nav shown only on the server's access answer;
- Sales sees no decide buttons and no balance column;
- RTL and dark snapshots.

App (PR-7 only): a widget test that each entry point preselects its category,
and the ar/en l10n guard. G-20 is not triggered, since no staff names appear in
strings.

## 11. Open owner questions

**(a) What does "grants" mean?**
- Options: PD-11/PD-18 bonuses (rewards, priced in payroll); PD-41 teacher
  certificates; or a new non-money award.
- **Recommendation: bonuses.** PD-26 already titled that section "Grants &
  rewards" from the owner's own wording. Certificates keep their own page; page
  B may link to a teacher's certificates.

**(b) Should Sales see and record teacher lateness, absences and complaints, and
with which scope?**
- **Recommendation: yes, narrowly.**
  - Sales sees and records rows about the trials it can already read and the
    families it owns: trial lateness, complaints, testimonials, and grants
    without an amount.
  - Sales never decides on the ladder, never sees leave balances, deductions or
    a teacher's regular-lesson discipline, and never sees teacher-level rows.
- Alternative: give Sales the Operations scope and rights. Not recommended:
  Sales supervises no PD-8 learners (it only owns families' contact and
  billing, PD-42), and discipline decisions are a supervision matter.

**(c) Do parents' complaints and praise become visible to the teacher, and when?**
- **Recommendation: keep PD-32 for complaints.** The teacher never sees them
  automatically. Staff relay the substance in the supervision chat as today; an
  upheld complaint's decision already reaches the teacher as a ladder card.
- **Praise: add "Share with the teacher"** (PR-8). Staff choose to post it as a
  card in the teacher's supervision chat, with the child's first name and the
  text, never the parent's name.
- Teacher-side impact: none in the app if the existing card renderer is used.
  This needs to be confirmed before PR-8, because the Teacher Account scope is
  frozen.

**(d) Retention, and who may edit or delete.**
- **Recommendation: append-only, never deleted by anyone.**
  - Corrections are new rows with a reason (`entry_void`, report correction,
    "excused", PD-18 correction).
  - Records are kept for as long as the academy keeps the teacher's file,
    including after offboarding (PD-43), where they are read-only.
- A retention period is set later, with the privacy policy, before production.
  Only a database operator could purge, under a written policy.

**(e) Are testimonials internal, or shown publicly** (for example on the
teacher's profile or in Stories)?
- **Recommendation: internal for now.** Publishing a parent's words needs that
  parent's consent, as for certificate Stories (PD-41), and belongs in a later
  decision.

**(f) Where do parents' "suggestions" go?**
- **Recommendation: page A, Complaints section, behind a "Suggestions" filter.**
  They are not on the ladder and are replied to as today.

**(g) The Parent account has one "Feedback about the teacher" form with a
category, not separate Complaints and Praise sections. Keep it?**
- **Recommendation: keep the one form**, and optionally add two shortcuts on the
  child's profile, "Praise the teacher" and "Report a problem", that open it
  with the category chosen (PR-7). The rate limits stay.

## 12. Out of scope

- Jawwid Core.
- Payroll rules: PD-18 and PD-26 are unchanged.
- The ladder's steps and threshold.
- The Teacher File's own sections.
- Any teacher-app screen.
- PD-44 dashboard KPIs (a later card could read the summary).
