# PD-47: one Tasks page for everyone (plan)

**State:** **APPROVED.** On 2026-10-28 the owner answered Q1–Q13 "Approve all 13 (Recommended)", relayed verbatim by the department head (§8). No feature code is written. PR-1 waits for the department head's GO (machine load).
**Claim:** `docs/product/pd-registry/PD-47.md`. **Migration slots, assigned by the department head:** PR-1 `20261029160000` (`chat_pd047_work_tasks`), PR-2 `20261029210000` (`chat_pd047_task_sources`; moved from `20261029170000`, released, so it runs after the priority amendment's PR-1b `20261029200000`), claimed in `docs/product/migration-slots/`. PR-4 asks for its own slot if it needs one.
**Base:** `main` @ `08bfd9dd`. Paths are relative to the repository root. `mig/` is `supabase/migrations/`.
**Frozen, not touched:** the call workstreams W1–W8; legacy `chat.task` (§1.1); Jawwid Core.

The owner's request, verbatim (2026-10-28):

> Regarding the Tasks page, we need it to include all tasks assigned to every person in the system, including teachers.
> For example:
> * Teachers: Their Tasks page should show pending tasks, such as a lesson for which they have not submitted a lesson report.
> * Supervisors: They should see the tasks assigned to them.
> * Managers: They should see their own tasks as well as the tasks assigned to their teams.
> * Super Admin: The Super Admin should have their own tasks and be able to monitor all tasks across the entire system.
>
> Task Completion and Removal Rules
> A task must not disappear from the Tasks page unless one of the following four actions occurs:
> 1. The assigned person completes the task. Once the required action has been completed, the task is marked as completed and removed from their pending tasks.
> 2. The assigned person comments that the task is outside their scope of responsibility. The comment must be visible to the Super Admin and the relevant manager. They will decide whether to remove the task or return it to the assigned person with clear instructions on how to complete it.
> 3. The Super Admin or the responsible manager removes the task. Only authorized managers and the Super Admin can remove tasks, subject to their permissions.
> 4. The task is reassigned to another person. The responsible manager or the Super Admin can transfer the task to another person, and the task should then appear in the new assignee's Tasks page.
>
> Important Requirement
> Tasks must remain visible and trackable until one of these four actions is taken. They must not disappear automatically because of a page refresh, a status change, or a temporary system issue.
> The system should maintain a clear task history, including who completed, removed, commented on, or reassigned each task, along with timestamps and any relevant instructions.
> The goal is to make the Tasks page the central place for managing responsibilities across the entire academy, ensuring that every person knows what they need to do and that managers and the Super Admin can track progress and accountability.

---

## Summary

- **Nothing on `main` is a task today.** About fifteen "someone must do this" signals exist (§1.2). Every one of them is worked out by a query when a page loads (a null column, or a status value), and each lives on its own page. Most produce no event. So today a pending item **does** disappear when its page's query changes, when a scope changes, or when the reader is not looking at that page. That is exactly what the owner forbids.
- **The Admin Web Tasks page is dead.** It calls `GET/PATCH /tasks`, which no controller serves. The legacy table `chat.task` behind the old design is frozen by **PD-4**. It also still feeds live RLS (`chat.staff_can_see_family`) and the frozen attention engine (§1.1). **It must not be revived.** PD-47 builds a new table.
- **Design (§3):**
  - **One durable record per task**, `chat.work_task` (working name). It holds an assignee (staff or teacher), a state, a due date, and either a *source* (system task) or a title and text written by a manager (manual task).
  - **Four states.** `open` and `awaiting_decision` are pending. `completed` and `removed` are final. **Reassigning** keeps a task open under a new assignee. Nothing is ever deleted.
  - **Only the owner's four exits** move a task out of someone's list: complete, out of scope then a decision, remove, reassign. The database enforces the transitions and who made them.
  - **An append-only history**, `chat.work_task_event`. Every change is written by the database in the same transaction, with the actor, the time and any instructions. It is built exactly like PD-35's case events.
  - **System tasks are keyed by their source** (for example `lesson_report:<lessonId>`). The key is unique for ever, so a task is created at most once. A task is **completed only by positive evidence** that the underlying work was done (for example, the lesson has an outcome). A trigger on the source table records that evidence in the same transaction. **Nothing removes a task automatically**: not a refresh, not a sweep, not an error.
  - **Visibility:** Mine for everyone; Team for managers (PD-8 department plus the Teachers manager's teachers); All for the super admin. Who may remove, reassign or decide is checked live.
  - **The work stays on its own page.** A task links to the leave request, the lesson report or the case; it does not copy their forms. The Tasks page is the index of responsibilities and the place of accountability.
- **Interplay:** a `task.changed` refetch signal through the outbox (the PD-46 pattern); PD-34 notifications in the existing `task` category, which finally fills the Notification Center's empty "Action" tab; and a Tasks tile on the PD-44 Dashboard.
- **Two boundary decisions are reopened, narrowly, by the owner's answers:** PD-4 (a task entity for staff and teacher accountability, Q1) and the frozen Teacher Account (a teacher "To do" list inside the Schedule tab, Q2).
- **Seven small PRs** (§7). PR-1 and PR-2 have their slots.
- **All thirteen owner questions are DECIDED** as recommended (§8).

---

## 1. Audit: what exists on `main`

### 1.1 Tasks today: four dead or half-built pieces

| Piece | Evidence | State |
|---|---|---|
| Admin Web Tasks page | `apps/admin-web/src/features/tasks/TasksPage.tsx` (140 lines) and `hooks.ts`; route `apps/admin-web/src/app/AppRoutes.tsx:124`; `taskApi` `apps/admin-web/src/core/api/endpoints.ts:116-127` (`GET /tasks?scope=mine\|team\|department`, `PATCH /tasks/:id`); `Task` type `shared/types/domain.ts:38`; realtime `task.updated` `RealtimeProvider.tsx:45` | **Dead.** No API controller serves `/tasks`. The legacy department roles `finance`, `technical` and `academic` *land* on it (`homeFor`, `AppRoutes.tsx:66-72`; `core/permissions/capabilities.ts:43,120-124`; `app/Navigation.test.tsx:132-151`). |
| Legacy `chat.task` | `mig/20260905090400_chat_conversation_domain.sql:231-258`, reshaped by `mig/20260905094000_chat_od01_conversation_reconciliation.sql:150-176` (`family_id` required; types follow_up, renewal, payment, complaint, onboarding, custom). No Prisma model. | **Frozen by PD-4** (`docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md:60,112,289-322`). **And still read:** `chat.staff_can_see_family` (`mig/20260905091100_chat_authorization.sql:51-66`) grants a family to any staff who owns a task row of it, and that function still backs live RLS policies (`mig/20260905091200_chat_rls.sql:92-201`; only `chat.message`'s were replaced, `mig/20261015120000_chat_pd008_org_structure.sql:829-841`). The frozen attention engine reads it too (`094000:389,407,466-493,958`). **Writing a row would widen family visibility.** Hence a new table. |
| PD-34 task columns | `chat.notification_item.requires_action`, `owner_id`, `due_at`, `task_status` (`mig/20261026190000_chat_pd034_notifications.sql:68-71`); the Center's "Action" tab filters on them (`apps/api/src/communication/notifications/notification-inbox.service.ts:380`) | **Never written.** No producer sets `requires_action`. `NotificationPipeline.emit` has no owner, due or status input (`notification-pipeline.service.ts:98-157`). The only `task`-category entry is `subscription_renewal_requested` (`notification-catalog.ts:82`), sent to *every* Sales member. |
| Dashboard "Needs action" | `apps/admin-web/src/features/dashboard/DashboardPage.tsx:47` calls `/dashboard/needs-action` (`endpoints.ts:157`) | **Dead.** No route. PD-44 (#211) is replacing the Dashboard with per-section counts and has no tasks tile (`docs/product/pd044-manager-dashboard-plan.md:83,469`). |

Also relevant: **PD-35's case events are enqueued and delivered to no one.** `case.opened`, `case.assigned` and `case.due_soon` carry no `conversationId`, so the outbox worker's `default:` branch only logs them (`apps/api/src/communication/outbox/outbox.worker.ts:304-312`). The same happens to every actor-addressed event, so a task event needs its own `case` in the worker (§3.10).

The `case.*` gap itself is **not fixed by PD-47**. The department head routed it separately to PD-35's owner (2026-10-28). PD-47's `case:<caseId>` source (§3.6) does not depend on that fix, because its completion trigger reads `chat.supervision_case` directly.

### 1.2 Every signal that could become a task

"Derived" means that pending is worked out by a query at read time, and nothing records it.

| # | Signal | Where it lives | Who acts today | How it is resolved | Pending is | Event today |
|---|---|---|---|---|---|---|
| S1 | **Lesson report missing** (PD-9/PD-11) | `chat.lesson.outcome IS NULL` past its end (`mig/20261018120000_chat_pd011_lessons.sql:41`); `phaseOf` `apps/api/src/lessons/lesson.service.ts:1370-1375` (overdue after `lesson.escalation_after_minutes` = 1440, `platform/app-config.service.ts:108`); there is no deadline, only a 60-day lookback (`lesson.service.ts:99-106`) | The **lesson's teacher** files it: `POST lessons/:id/report` (`lesson.controller.ts:62`). Teacher: Schedule "Needs report" filter (`lib/features/lessons/presentation/teacher_schedule_screen.dart:16-50,193`), "+" "Other unreported lessons" (`lib/features/messages/presentation/message_composer.dart:435`). Supervisors: `GET lessons/needs-action` (`lesson.controller.ts:35`, `lesson.service.ts:342`), page `apps/admin-web/src/features/teachers/NeedsActionPage.tsx`; Teachers department only, narrowed by `TeacherScopeService.scopeOf` (`platform/teacher-scope.ts:96`) | Report filed → `outcome = held` (`lesson.service.ts:611,936`), or another outcome recorded | derived | `lesson.closed`, Core-only (`lesson.service.ts:997`); nothing when it becomes overdue |
| S2 | **Report correction requested** | `chat.report_correction_request` (`mig/20261026160005_chat_pd035_reports_evaluations.sql:39`), one open per lesson (:66) | Teacher. Requested by a supervisor or manager standing to the lesson (`lessons/report-correction.service.ts:76`); `GET me/correction-requests` `@SelfService` (`report-correction.controller.ts:37`) | **DB trigger** `resolve_report_correction` when the report is filed or edited (`160005:141-172`); or withdrawn by the requester | stored | card into the teacher's supervision chat (`report-correction.service.ts:105`) |
| S3 | **Late-apology ruling** | `chat.lesson_ruling.decision IS NULL` (`mig/20261018120000:101`) | Teachers department: `POST lesson-rulings/:id/decide` (`lesson.controller.ts:104`) | decided | stored | card |
| S4 | **Teacher leave request** (PD-12 S1/PD-26) | `chat.teacher_leave_request.state = 'requested'` (`mig/20261019090000_chat_pd012_s1.sql:500`) | Teachers department or an Operations supervisor of the teacher's families: `requireSupervisor` (`leave/leave.service.ts:605`) → `decidePd012PageAccess` (`platform/pd012-policy.ts:163`), scope `pageRowsOf` (`teacher-scope.ts:177`). Page `features/supervision/LeaveRequestsPage.tsx` | approve / decline (`leave.service.ts:321-398`), or withdrawn by the teacher | stored | cards `leave_*` into the supervision chat (`leave.service.ts:131,517-528`) |
| S5 | **Violation awaiting a decision** (PD-12 S2/PD-26) | `chat.teacher_violation.decision IS NULL` (`mig/20261019140000_chat_pd012_s2_discipline.sql:120,159`); created by trigger from an outcome (:244-260) or by hand | same gate as S4 (`discipline/discipline.service.ts:683`); `POST discipline/violations/:id/decide` (`discipline.controller.ts:30`); ladder `discipline/ladder.ts:36-74` | decided | stored | card on decide; nothing on create |
| S6 | **Complaint open** (PD-10/PD-26) | `chat.teacher_supervision_entry` kind complaint with no `complaint_resolution` (`teacher-file/teacher-file.service.ts:819-831`) | Teachers department or Operations (`pageGate`, `teacher-file.service.ts:619`) | a resolution entry (`POST teacher-files/:teacherId/entries`) | derived | none |
| S7 | **Parent feedback** (PD-32) | `chat.parent_feedback.status` received / in_review (`mig/20261026120000_chat_pd032_parent_feedback_signup_code.sql:45-56`) | whoever takes it: `POST parent-feedback/:id/take`, `/reply` (`teacher-file/parent-feedback.controller.ts:20-60`); no owner until taken | resolved (praise/suggestion) or through its complaint (`parent-feedback.service.ts:203-262`) | stored | none |
| S8 | **Escalation case** (PD-35 B5) | `chat.supervision_case` (`mig/20261026160007_chat_pd035_supervision_cases.sql:35-62`) with `owner_id`, `due_on`, status | the owner, the target manager, the super admin (`cases/supervision-case.service.ts:452-465`) | resolved / cancelled with a note | stored | `case.*` enqueued, **delivered nowhere** (§1.1) |
| S9 | **Certificate request** (PD-12; PD-41 designed) | `chat.learner_certificate.state = 'requested'` (`mig/20261019090000:299-347`); PD-41's richer states `docs/product/pd041-certificates-design.md:95-120` | Teachers department + super admin (`certificates/certificate.service.ts:329-337`); keys `certificates.view/design/deliver` | issued / declined | stored | cards; PD-41 plans four `task` notifications (`pd041…:525`) |
| S10 | **Makeup owed, schedule-change request, blocked weekly lesson** | `owedMakeups` (`lesson.service.ts:423`, 7-day window); `chat.schedule_change_request.status = 'pending'` (`mig/20261018140000_chat_pd011_scheduling.sql:434`); `chat.lesson_blocked_occurrence` (`mig/20261026110000…:286`) | Teachers department (`schedule.manage`; `scheduling.controller.ts:82,93,131`) | makeup booked/resolved; request decided | derived / stored / stored | `lesson.makeup_resolved` Core-only (`scheduling.service.ts:649`) |
| S11 | **Trial awaiting an outcome; new student waiting** (PD-15/16/42) | trial: no outcome after start (`lessons/trial.service.ts:740`); new student: no `chat.student_enrolment` (`mig/20261021140000…:98`), group missing, parent sign-up not done (`new-students/enrolment.service.ts:89-141`) | trial: teacher (attendance) / Sales (outcome) (`trial.service.ts:394-406`); Assign: Operations manager or super admin; group + code: the children's supervisor (`enrolment.service.ts:148,321,422`) | outcome recorded; assigned; group opened; parent signed up | derived | trial cards only; New Students polls every 15 s (`features/trials/hooks.ts:36`) |
| S12 | **Family with no Operations supervisor** (PD-8/PD-24/PD-42) | no `chat.learner_supervision` row (`mig/20261015120000:172`); `GET org/learners?unassigned=true` (`org/org-structure.service.ts:140-169`); intake `needs_operations_supervisor` (`new-students/intake.service.ts:195,260`); **open PR #214** adds `GET family-intake/entered` and `POST families/:id/operations-supervisor` | Operations manager or super admin (`platform/authorization.service.ts:1472`) | a supervisor assigned | derived | none |
| S13 | **Teacher with no supervisor; set-up incomplete; not signed in** (PD-35/PD-43) | no `chat.teacher_supervisor_assignment` (`mig/20261026160004…:46`); `chat.teacher_setup_state(teacher)` (`mig/20261028200000_chat_pd043_offboarding_and_setup.sql:150`); sign-in derived (`teacher-file.service.ts:539`); **open PR #215** adds `platform/teacher-readiness.ts` and an Unsupervised filter | Teachers manager (supervisor); manager or supervisor (set-up); super admin or manager (pay) | the missing piece is filled in | derived | none |
| S14 | **Instalment overdue; receipt to review; renewal request** (PD-17/27/30) | `chat.family_instalment` (`mig/20261021150000…:149`), status derived (`billing/instalment.ts:15`), `responsibleSupervisor` (`billing/billing.service.ts:203-218`); `chat.payment_receipt.status = 'pending'` (`mig/20261022170000_chat_pd027_payments.sql:206`); `chat.renewal_request` (`mig/20261026140000_chat_pd030_subscription_lock.sql:803`) | the child's or family's billing supervisor; anyone with `billing.record`; Sales | paid / void; approved / rejected; renewed | derived / stored / derived | parents only for reminders (`billing/payment-reminders.service.ts:14-30`); renewal → `task` push to **every** Sales member (`subscriptions/subscription-effects.service.ts:407`) |
| — | Not a source | PD-25 recovery is self-service with no request row (`account-recovery/`); staff resets start on the staff side | — | — | — | — |

### 1.3 What the audit means for the design

1. **No signal has a single accountable person.** Most are "the Teachers department" or "anyone with the key". A task needs exactly one assignee, so every source gets an assignee rule (§3.6).
2. **Pending is mostly derived**, so a task cannot simply *be* a query, or it would disappear as the query changes. The task must be stored, and completed from **positive evidence**, never from the absence of a row.
3. **The good pattern already exists twice:**
   - PD-35's cases: a guarded row, a database-written history, an actor required, `chat.forbid_change` on events (`160007:111-275`, `mig/20261018160000…:201`).
   - PD-35's correction requests: resolved by a **trigger on the source table** when the real work happens (`160005:141-172`).
   PD-47 reuses both.
4. **The pages where work is done are good and stay.** Leave, Discipline, Needs action, Cases, New Students and Instalments each have the right form and the right gate. A task links to them.
5. **The outbox cannot reach a person without a `case`** in the worker (§1.1). The PD-46 keyed-event design (`docs/product/pd046-schedule-chat-integration-plan.md` §3.3–3.4) is approved but not yet built.

---

## 2. Boundary: what PD-47 reopens

- **PD-4 and boundary §1.2** say Chat is "not a generic task-management system" and `chat.task` is "frozen, not to be revived". PD-47 proposes a **narrow** reopening (Q1):
  - Tasks are **accountability items for staff and teachers about Chat's own records**: lessons, leave, cases, families, payments.
  - They are **not** CRM routing, pipelines, workload scoring or SLAs.
  - System events that reach a *family* stay PD-4 system messages.
  - Legacy `chat.task` stays frozen and untouched. Its removal remains a separate, later decision.
- **The Teacher Account** is frozen as "a communication app" (PD-10's reopening covers only the teacher's own schedule and workload). A teacher's "To do" list is new teacher scope (Q2). The proposal keeps it inside the Schedule tab, which already shows "Needs report", so no new tab is added.

---

## 3. Design

### 3.1 One record, two kinds

`chat.work_task` (working name; `chat.task` is taken by the frozen legacy table):

| Column | Meaning |
|---|---|
| `id`, `organization_id` | |
| `kind` | `system` (made from a source) or `manual` (written by a manager or the super admin) |
| `source_type`, `source_id`, `source_key` | System only. For example `lesson_report`, `<lessonId>`, `lesson_report:<lessonId>`. **`unique (organization_id, source_key)`, for ever.** A source that can recur takes an occurrence in its key (`report_correction:<requestId>` is new each time). |
| `assignee_staff_id` / `assignee_teacher_id` | Exactly one is set (CHECK). Teachers are their own principals, not staff. |
| `state` | `open` · `awaiting_decision` · `completed` · `removed` |
| `outcome` | On `completed`: `done` (the work was done) or `acknowledged` (the work no longer exists and the assignee confirmed it, Q4) |
| `source_state` | System only: `pending` or `withdrawn` (the source went away without the work being done: lesson cancelled, leave withdrawn) |
| `title`, `body` | Manual only (≤ 200 / ≤ 4000). A system task's title is rendered at read time from its source by the source's adapter, so a label is never frozen and never shown to someone who lost standing. |
| `subject_kind`, `subject_id` | Optional link: teacher, learner, family, lesson, conversation, case. Checked against the creator's scope for a manual task. |
| `due_at`, `instructions` | `instructions` holds the latest "return with instructions" text, shown as a banner. Every version is in the history. |
| `created_by`, `created_at`, `closed_by`, `closed_at`, `close_reason` | `closed_*` is set once, on `completed` or `removed` |
| `revision` | Bumped by trigger on every change (PD-46 §3.2), for the realtime signal |

RLS is on, with no grant to any request role (fail closed, like every PD-35 table). Only the server reads it.

### 3.2 States and the four exits

```
                 ┌──────────── reassign (exit 4) ─────────────┐
                 v                                            │
 created ──> open ──── complete (exit 1) ───────────────> completed
                 │ ^                                          ^
   out of scope  │ │ return with instructions               │ the work is done
   (exit 2 asks) │ │ (manager / super admin)                 │ while awaiting
                 v │                                          │
          awaiting_decision ─────────────────────────────────┘
                 │
                 └── remove (exit 3) / reassign (exit 4) ──> removed / open (new assignee)
 open ── remove (exit 3, manager / super admin, reason) ──> removed
```

| Exit | Who | Rule |
|---|---|---|
| **1. Complete** | **System task:** whoever does the underlying work, recorded as `closed_by`. There is **no "Done" button**, so a report cannot be marked done without being filed. **Manual task:** the assignee, with an optional note. | A system task is completed by its source's completion trigger (§3.5), in the same transaction as the work. |
| **2. Out of scope** | The assignee only. A comment is required. | `open → awaiting_decision`. The task **stays in the assignee's list**, labelled "Waiting for a decision". It appears in **Decisions** for the responsible managers (§3.7) and the super admin. They choose: **remove** (a reason), **return** (instructions required, back to `open` with the banner), or **reassign**. If the work gets done in the meantime, the task completes and the pending decision is closed in the history. |
| **3. Remove** | A responsible manager holding `tasks.manage`, or the super admin. A reason is required. | `→ removed`. For a system task, **the source is not touched**: the leave request is still pending on its page. Its key stays used, so the task is never re-created. |
| **4. Reassign** | A responsible manager holding `tasks.manage`, or the super admin. Instructions are optional. | Same task, same history, new assignee. It leaves the old list and appears in the new one in the same transaction. For a system task, the new assignee must be **eligible for the source** (the adapter's rule: for example, a leave decision needs someone who stands to that teacher). A lesson report can only be done by the lesson's teacher, so its task is not reassignable here: changing the lesson's teacher (Schedule) moves it. |

Two more rules:
- **A change of owner at the source is exit 4.** A PD-24 supervisor transfer, a lesson's teacher change or a case reassignment moves the task, attributed to the person who did it.
- **Comments** may be added at any time by anyone who sees the task. They change nothing else.

**The database enforces this,** as `guard_supervision_case` does (`160007:111-201`):
- every write needs the GUC `chat.task_actor`, naming a live principal of the task's organization;
- only the transitions above are allowed;
- `completed` and `removed` are final;
- DELETE is refused;
- `remove`, `return` and `decide` require a reason or instructions.

### 3.3 History

`chat.work_task_event` stores `task_id`, `organization_id`, `at = clock_timestamp()`, `actor_kind` (staff, teacher or system), `actor_id`, `kind`, `from_assignee`, `to_assignee`, `body`, `before`/`after`.
- **Kinds:** `created`, `reassigned`, `commented`, `out_of_scope`, `returned`, `completed`, `removed`, `due_changed`, `source_withdrawn`.
- **It is written by an AFTER trigger on `chat.work_task`**, in the same transaction, from `chat.task_actor` and `chat.task_note`. A comment is a direct insert.
- **It is append-only:** `BEFORE UPDATE OR DELETE → chat.forbid_change()`, plus an insert guard requiring a live actor.
- **`actor_kind = system`** is allowed only for `created` and `source_withdrawn`. Every exit names a person.

The task detail shows the whole history: who, what, when, and the instructions or reason. The B7 action log (`apps/api/src/action-log/`) gains task events as a third source, so a person's log shows their task actions.

### 3.4 Never disappearing

The owner's "Important requirement", turned into rules that tests prove:

| Threat | Rule |
|---|---|
| Page refresh | The list is `select … from chat.work_task where assignee = me and state in ('open','awaiting_decision')`. It does not join the source's state, and it does not depend on which page was loaded. |
| A status change at the source | Only positive evidence completes a task (§3.5). A source that went away without the work being done sets `source_state = 'withdrawn'` and **keeps the task** (Q4). |
| A scope change | The assignee always sees their own tasks. Team and All visibility are computed live, so a reorganization moves *who can watch*, never *whose task it is*. |
| A transient error | The sweep (§3.5) only creates tasks (`ON CONFLICT DO NOTHING`) and only completes on evidence it re-read. A failed read skips that row; it never counts as "done". The clients keep the last good list on a failed refetch and say "Couldn't refresh — showing the list from 10:42". Rows leave a client list only when the server returns them as closed, or after a confirmed mutation. Realtime only invalidates. |
| A worker crash or a missed signal | Completion triggers run in the source's own transaction. The sweep re-checks open tasks every 5 minutes. Keys make every step idempotent. |
| An inactive assignee | Tasks stay assigned. They show in the manager's **Needs reassignment** filter and on the Dashboard (Q11). |

### 3.5 System tasks: sources

Each source is one adapter in `apps/api/src/tasks/sources/`. An adapter implements:
- `key(row)`;
- `assignee(row)`: live, at creation;
- `eligible(principal, row)`: for reassignment;
- `label(viewer, row)`: the title, or "Restricted" without standing;
- `link(row)`: an `action { kind, ids }`, PD-34's deep-link shape;
- the SQL completion and withdrawal predicates.

**Creation** happens in two ways:
1. **In the source's own transaction**, where one writer exists: a leave request filed, a violation recorded, a correction requested, a case opened.
2. **The worker sweep**, every 5 minutes, for time-based signals: a lesson that ended, an instalment that became overdue, a family left with no supervisor. It runs `insert … on conflict (organization_id, source_key) do nothing`.

**Completion** is one AFTER trigger **per source table** that sets the task `completed / done` with the source's actor, in the same transaction as the real work. This is the `resolve_report_correction` pattern. One function per table avoids the PL/pgSQL shared-trigger `NEW.field` trap. The sweep also completes, as a safety net, but only on evidence it has just re-read.

A guard spec asserts that every adapter has a completion trigger and a test where the work is done outside the service.

### 3.6 The sources, phased

**Assignee rule** used below, "the teacher's supervisor": the teacher's PD-35 primary supervisor (`chat.teacher_supervisor_assignment`); if there is none, the Teachers manager (PD-43's unsupervised rule).

**Phase A (PR-2):** the teacher's own work and the Teachers department's decisions.

| Source key | Assignee | Created | Completed (evidence) | Withdrawn |
|---|---|---|---|---|
| `lesson_report:<lessonId>` | the lesson's teacher | lesson end (sweep; Q10) | `lesson.outcome` set | lesson cancelled / moved before it was held |
| `report_correction:<requestId>` | the lesson's teacher | request created | DB resolves it (`160005:141`) | requester withdraws |
| `lesson_ruling:<rulingId>` | the teacher's supervisor | ruling created | `decision` set | — |
| `leave_decision:<requestId>` | the teacher's supervisor | request filed | state leaves `requested` by approve/decline | teacher withdraws |
| `violation_decision:<violationId>` | the teacher's supervisor | violation recorded | `decision` set | violation's lesson outcome corrected away |
| `case:<caseId>` | the case owner | case opened | resolved / cancelled | — |

**Phase B (PR-6, one source per commit, in this order):**

| Source key | Assignee | Done when |
|---|---|---|
| `family_unsupervised:<familyId>` | Operations manager | every child has a supervisor (needs PD-42 PR-3, #214) |
| `teacher_unsupervised:<teacherId>` | Teachers manager | a supervisor assigned |
| `teacher_setup:<teacherId>` | the teacher's supervisor | `chat.teacher_setup_state` all done (one task, the checklist inside) |
| `new_student_assign:<subscriptionId>`, `new_student_group:<enrolmentId>` | Operations manager; the children's supervisor | assigned; group opened |
| `trial_outcome:<lessonId>` | the teacher (attendance), then the family's Sales owner (outcome) | recorded |
| `instalment_overdue:<instalmentId>` | `responsibleSupervisor`, else the Operations manager | paid / void |
| `receipt_review:<receiptId>` | the family's billing supervisor, else the Operations manager | approved / rejected |
| `renewal_request:<id>` | the family's Sales owner, else the Sales manager (**replaces the push to every Sales member**) | renewed |
| `certificate:<id>` | per PD-41's states (the Designer, the requester); built **with** PD-41, whose four `task` notifications become tasks | sent / declined |
| `complaint:<entryId>`, `parent_feedback:<id>` | the teacher's supervisor | resolved |
| `makeup_owed:<lessonId>`, `schedule_change:<id>` | the teacher's supervisor | booked / decided |

The **Needs action** page and the other source pages stay as they are. A task is the "you, by name" layer over them.

**Phase B decisions (department head, 2026-10-29).**
- **Already built:** `instalment_overdue`, `receipt_review` and `renewal_request` became PR-2b's financial sources (`instalment`, `receipt_review`, `renewal_request`; §5.1 of the priority amendment).
- **PR-6a** (slot `20261029235800`): `family_unsupervised`, `teacher_setup`, `new_student_assign` / `new_student_group`.
- **PR-6b** (slot `20261029235900`): `teacher_unsupervised`, `trial_attendance` / `trial_outcome`, `certificate` (the owner's answers below).
- **PR-6c** (slot `20261030000000`): `complaint`, `parent_feedback`, `schedule_change`, `makeup_owed`. Both branch off `main` after PR-6a, one commit per source.
- **Complaints and parent feedback** use the records that already exist; no new state.
  - `complaint:<entryId>`: a Teacher File entry (`chat.teacher_supervision_entry`, kind `complaint`). Its task is **done when a `complaint_resolution` entry refers to it** (`refers_to`, unique per complaint). It goes to the teacher's supervisor, else the Teachers manager.
  - `parent_feedback:<feedbackId>`: PD-32's `chat.parent_feedback`. Its task is **done when that record reaches its closed state, `status = 'resolved'`**. It goes to the teacher's supervisor, else the Teachers manager.
  - `schedule_change:<requestId>` (PD-11's `chat.schedule_change_request`) goes with these.
- **`makeup_owed`** follows its design note below, as decided by the department head on 2026-10-29.

**`makeup_owed` -- design note (agreed by the department head, 2026-10-29).**
- **What record means "a make-up is owed".** No new record is needed: the **original lesson** owes one, exactly by the rule `LessonService.owedMakeups` already applies (`apps/api/src/lessons/lesson.service.ts`, repeated by the database in `guard_lesson`). A lesson owes a make-up when all of these hold:
  - it is not a trial;
  - its outcome is a make-up cause: `teacher_apology` or `teacher_no_show`, and `student_apology` only where the academy's policy owes one for it;
  - no **live** make-up replaces it (`lesson_one_live_makeup`: a `kind = 'makeup'` lesson with `makeup_for` = it, whose own outcome is not `teacher_apology`, `teacher_no_show`, `admin_cancelled` or `rescheduled`);
  - no `lesson_ruling` of kind `makeup_followup` settles it.
- **Key:** `makeup_owed:<lessonId>`, the original lesson.
- **Who it goes to:** the teacher's supervisor, else the Teachers manager (`work_task_teacher_owner`). This is the same department that already sees `makeupsOverdue` on Needs action.
- **Who creates it, and when:** the source itself, the moment the lesson's outcome is recorded as a cause. A trigger on `chat.lesson`, plus the sweep as a backstop. Under the 14-day cut-off, a lesson owed from before switch-on stays on Needs action only.
- **Floor:** `overdue_only`, with `due_at` = the lesson's end + `lesson.makeup_window_days` (7). Yellow while there is time, Red once past the window (the moment Needs action lists it as overdue).
- **When it ends:**
  - **Done** when a live make-up is booked (`SchedulingService.bookMakeup`; actor = whoever booked it), or when a `makeup_followup` ruling settles it (`resolveMakeup`: substitute teacher, family credit, package extension or waived; actor = whoever decided).
  - **Withdrawn** when the lesson's outcome is corrected away from a cause.
  - **If a booked make-up is itself cancelled** (`teacher_apology`, `teacher_no_show`, `admin_cancelled`, `rescheduled`), the original lesson owes again. That should be a **fresh** task, because the first one was completed by the booking. One way is an episode per booked make-up, as PR-2b did for packages.
- **Department-head decisions, 2026-10-29** (the three questions this note asked):
  1. **Done at booking.** The work is arranged then. A booked make-up that is itself cancelled re-owes as a **fresh episode** task, as above.
  2. **`student_apology` follows exactly the rule `LessonService.owedMakeups` / `guard_lesson` already applies.** No new policy: the task source calls the same rule and never re-implements it. A spec proves that the set of lessons with an open `makeup_owed` task equals `owedMakeups`' set.
  3. **Two tasks.** `lesson_ruling` is "decide"; `makeup_owed` is "make sure it is made up". The one `makeup_followup` decision completes **both**, with the same actor. A spec proves it.

**Owner's answers, 2026-10-29** (relayed verbatim by the department head). These three are **PR-6b** (slot `20261029235900`), each source in its own commit.
- **`teacher_unsupervised`: "Replace it".** The task replaces PD-43's two notices to the Teachers manager, `teacher_added_unsupervised` (the API, `teacher-onboarding.service.ts`) and `teacher_supervisor_left` (the trigger on `chat.staff`, `mig/20261029150000`), the way Q-F6 replaced the renewal push. The manager hears of it once, through the task's own `task_assigned`. `teacher_duplicate_hidden` is not a task and stays a notice.
- **`trial_outcome`: "Two tasks".** The **teacher** gets an attendance task (`trial_attendance:<lessonId>`), done when attendance is recorded. Only **then** does the family's **Sales owner** get an outcome task (`trial_outcome:<lessonId>`), done when the outcome is recorded. Each sees only their own step: the teacher never sees the outcome task, and Sales never sees the attendance task.
- **`certificate`: "Yes, replace them".** Each PD-41 step that needs someone to act becomes a task for that person, and the four `task` notifications (`certificate_requested`, `certificate_returned`, `certificate_uploaded`, `certificate_suggestion_decided`) stop. PD-47 owns the change in PD-41's emitters (`certificate.service.ts`). **PD-41's state machine and its tests stay intact**: only who is told, and how, changes.

**PR-6b -- design note (approved by the department head, 2026-10-29).**
- **`teacher_unsupervised:<teacherId>`.** An active teacher with no live PD-35 supervisor of the Teachers department (the same test as `work_task_teacher_owner`'s first branch). Goes to the Teachers manager, else the super admin. Raised by the sweep (a teacher added unsupervised; a supervisor who leaves leaves each of their teachers unsupervised). Done when a supervisor is assigned (trigger on `chat.teacher_supervisor_assignment`, actor = `assigned_by`). Withdrawn when the teacher leaves. A supervisor who leaves again later starts a **fresh** task (one key per unsupervised spell, as PR-2b's episodes). The two PD-43 notices are removed: the API call in `teacher-onboarding.service.ts` and the `chat.staff` trigger (dropped in this migration; its text rows stay for history).
- **`trial_attendance:<lessonId>`.** The trial's teacher, due at the trial's end + 24 h. Done when the lesson's attendance is recorded (`held` or `student_no_show`, by whoever recorded it, the teacher or Sales' `no_show`). Withdrawn when the trial is rescheduled or cancelled.
- **`trial_outcome:<lessonId>`.** Raised only when attendance is `held`, due + 48 h. Done when `chat.trial_outcome` is written (actor = `recorded_by`). Withdrawn if Sales corrects the attendance to `student_no_show`; restored if corrected back. Neither task carries prospect or form data (G-07): ids only, as all tasks.
  - **(A) Who is the "family's Sales owner" for a trial?** A prospect has no family until it subscribes, so `chat.family_sales_owner` has no row. **Recommended:** the prospect's creator (`trial_prospect.created_by`, always a Sales member or manager) while live, else the live Sales manager, else the super admin. **Approved by the department head, 2026-10-29.** Prospects record no Sales owner of their own; only families do (`chat.family_sales_owner`).
- **`certificate`: one task per step that waits on a person**, keyed on the PD-41 event that opened the step (`chat.appreciation_certificate_event.id`), so a certificate that loops back gets a fresh task each round:

  | Step (state) | Task type | Who | Done by |
  |---|---|---|---|
  | `proposed` | `certificate_accept` | the learner's Operations supervisor or cover (safeguard 5) | accept / decline |
  | `requested` (unclaimed) | `certificate_design` | **(B)** | moves to the Designer at `start` |
  | `in_design` | `certificate_design` | the assigned Designer (reassign moves it) | upload |
  | `changes_requested` | `certificate_resubmit` | the requester of record (`certificate_responsible`) | resubmit |
  | `uploaded` | `certificate_review` | the requester of record | approve / redesign |
  | `approved` | `certificate_send` | the requester of record | send |

  Cancel withdraws the open step's task. `certificate_suggestion_decided` is information, not an action: its push stops and PD-12's card in the teacher's supervision chat remains their notice.
  - **(B), approved by the department head 2026-10-29. Who holds an unclaimed request?** Every `certificates.design` holder may claim it, but a task has one assignee. **Recommended:** the category's overseer (the Operations manager for `student`, the Teachers manager for `teacher`, else the super admin): the one person who may already reassign the Designer. A claim (`start`) completes that step, by the Designer, and opens the Designer's own `in_design` step.
  - **As built:** every state change completes the open step by whoever made it, except a cancel, which withdraws it. Each step is raised at once by a trigger on `chat.appreciation_certificate_event`, with the sweep as the backstop. The sweep also moves a pending step to its person when that person changes, for example a learner's new supervisor or a Designer who left. Certificate steps follow their source: PD-41 safeguard 1 means a manual hand-on would give someone work they may not do. Due: the step's start + 48 h.
  - **(B) REVISED by the department head, 2026-10-29** (review of #271). The overseer may not start or assign a request under PD-41, so the first rule gave its holder work they could not do.
    - If the organization has exactly one live staff member given `certificates.design` by an explicit PD-40 access-role grant (for example the `designer` template), the unclaimed request goes straight to them. Two kinds of holder are not counted: PD-40's legacy bundle gives the key to the Teachers department's manager and supervisors, and the super admin holds every key (department head, 2026-10-29). They may all still design, so the hand-on picker lists every live holder.
    - Otherwise it goes to the overseer. The overseer, or the super admin, may hand that step by hand to a live `certificates.design` holder only (`chat.work_task_certificate_hand_on`; the guard allows exactly that). The sweep leaves a step handed to a Designer where it is.
    - When a Designer starts, the step closes and their own design step opens, as before.
  - **The review step when the requester uploaded the design.** PD-41 forbids the uploader approving (`guard_appreciation_certificate`: "the person who uploaded a design does not approve it"). Approval is the requester of record's or their active PD-33 cover's (`chat.certificate_acts_as`). So the review task goes to that cover. With no cover, PD-41 leaves only a redesign or a cancel. **Open PD-41 question (department head, 2026-10-29; to the owner):** who approves when the requester of record uploaded the design and has no cover? PD-41 is unchanged in this PR, and the task stays with the requester.
  - **The picker.** For a design hand-on, the Tasks page offers live Designers only and no department. For an orphan, the super admin is offered anyone live (`TaskService.assignees`, the same `rulesFor`).
  - **Spells begin when the supervisor is lost.** PD-43's `assign(null)` deletes the assignment row, so the records alone would date the spell from the teacher's creation. Triggers on the assignment (DELETE, and an UPDATE that leaves them unsupervised) and on `chat.staff` (a supervisor deactivated) open the spell at that moment. A supervisor cannot leave the Teachers department while holding teachers (PD-35), so that path needs no trigger.
  - **Orphans.** While the sweep has recorded a task as `orphaned:`, the super admin may hand it to anyone live, even a task that follows its source. The issue says so.
  - **The race accepted.** An assignment that commits while the sweep raises its task is accepted: the settle window makes it rare, and the next reconcile completes it.
  - **As PR-6a, after its review:** the sweep raises nothing younger than the settle window. A task whose assignee left moves to its source's owner now (`chat.work_task_handover_owner`); with nobody live to follow, it gets an `orphaned:` issue.
  - **Known noise:** a Designer who claims a request is told of the `in_design` step they just took, because a raise has no actor to leave out (`work_task_raise` signals with `actorId` null).

#### 3.6.1 As built in PR-2 (#241)

- **Day-one backfill.** Owner, 2026-10-29: "Yes, but only recent ones". At switch-on, only source items from the **last 14 days** become tasks, and older open items are left as they are.
  - Each source has its own cut-off, `tasks.since.<source>` in `chat.config`.
  - It is set on first use to that moment minus 14 days.
  - It replaces the never-applied `tasks.lesson_report_since` of an earlier PR-2 draft.
- **Violations corrected away** (PD-15): a violation whose lesson's outcome was corrected away can no longer be decided (`DisciplineService.standing`).
  - Its task is withdrawn, by the lesson trigger and by the sweep.
  - A violation already corrected away is never raised.
  - A lesson corrected **back** to the violation's outcome makes the same violation stand again, because it is unique per lesson and kind. Its withdrawn task is then **pending again**, recorded as `source_restored`, rather than raised a second time.
- **Other sources:**
  - A **trial lesson** (no learner) raises no report task; trials are Phase B's `trial_outcome`.
  - A **"missing" correction** whose lesson already has a report task raises none of its own.
- **Owners that change:**
  - A lesson given to another teacher moves its report task, and its open correction tasks, as a reassignment by the system.
  - A case whose owner left moves to its department's manager.
  - Lesson-report, correction and case tasks are moved only by their source. The database guard enforces this.
- **Nothing is silent:**
  - A source occurrence that has no assignee, or whose trigger or sweep step failed, is recorded in `chat.work_task_source_issue`.
  - It is warned once, then retried with a back-off: one hour, doubling, at most a day.
    - A raise that declines is recorded the same way, so the batch is never starved.
    - So an occurrence that waited for a manager is raised **at most 24 h after** one becomes live again.
  - The record is deleted when the occurrence resolves in any way: its task raised, completed, withdrawn or moved, or its source decided or gone.
  - The sweep returns its counts, and the worker logs any failures.
- **The sweep** runs in batches of at most 60 rows under an advisory lock, and the source triggers wait at most 2 s for a lock.

#### 3.6.2 As built in PR-6a (slot `20261029235800`)

Migration `20261029235800_chat_pd047_phase_b_sources.sql`. The four set-up sources are all operational and Medium, with the generic floor, and a person may reassign them.

| Source | Key | Assignee | Due | Done (actor) | Withdrawn |
|---|---|---|---|---|---|
| `family_unsupervised` | the family | the Operations manager, else the super admin | first waiting child + 48 h | every child has a `learner_supervision` row (who placed the last; an academy import names nobody) | the family has no children left |
| `teacher_setup` | the teacher | `work_task_teacher_owner` | added + 7 days | `teacher_setup_state` all true (nobody: many people fill it in) | the teacher leaves; back if reactivated unfinished |
| `new_student_assign` | the trial (the form's key) | the Operations manager, else the super admin | recorded + 24 h | its `student_enrolment` exists (`assigned_by`) | the outcome is corrected away; back if corrected back |
| `new_student_group` | the enrolment (`new_family` only) | the children's live supervisor, else as above | entered + 24 h | `group_conversation_id` set (`group_created_by`) | -- |

- **Raised by `chat.work_task_sweep_setup()`**, the third sweep that `TaskService.sweep` runs, with its own lock and batches. These sources are not raised at once by a trigger. Each one is a state that is often settled in the same request that creates it: a family entered together with its supervisor, or an enrolment that joins an existing group. A raise at once would announce work that is already done.
- **Completed at once** by triggers on `learner_supervision`, `student_enrolment` and `trial_subscription`, in the source's own transaction and never blocking it. The sweep re-reads the evidence as a safety net.
- **The settle window** (department head review, 2026-10-29). The sweep leaves an occurrence alone until it is 2 minutes old (`chat.work_task_settle_window()`; config `tasks.raise_after_seconds`). Without it, a sweep that read the source just before a concurrent request settled it would raise and announce a task that request's trigger could not see. The reconcile would complete it a minute later, but the push would already be out.
- **An assignee who leaves.** The sweep moves an open task whose assignee is no longer live to its source's owner now (`chat.work_task_setup_owner`). With nobody live to follow, it records an `orphaned:` issue, as PR-2b does. A live assignee keeps the task, so a person's hand-on stands.
- **"Back if reactivated" has a limit.** It works only while the withdrawn task is still open. Once the assignee has acknowledged it, a teacher who comes back with the set-up unfinished gets no second task, because the key is spent. The Teachers manager sees them on the PD-43 set-up list. Keying per episode was weighed and not chosen: a returning teacher is rare, and the list already shows them.
- **The guard** now lets the system complete two more source types without an actor: `teacher_setup` and `family_unsupervised`. Every other source still names its actor.
- **One task per family, ever.** A child added later and left unsupervised shows on New Students only.
- **Delivery:** no new rule key. Each task is announced once with the generic `task_assigned` (ids only).
- **Privacy (G-07):** the form's contents never reach a task. The title names the trial's prospect, read behind sign-in. `src/` still names `trial_subscription` only in `new-students/`.
- **Spec:** `tasks-setup-pd047.spec.ts`.
- **Admin Web:** each source links to where its work is done: New Students, or the teacher's file.

### 3.7 Manual tasks, and who is responsible

- **Create** (`tasks.create`): a manager for anyone in their team; the super admin for anyone; a teacher supervisor for their teachers (Q5). There is no peer-to-peer creation.
- **Responsible managers** of a task are computed live:
  - for a staff assignee: the manager of their department (`chat.department.manager_id`);
  - for a teacher: the Teachers manager;
  - for a manager assignee: the super admin only.
  - The super admin is always responsible.
  - A manual task's creator, if a manager, also stays responsible. **Confirmed by the owner 2026-10-28** ("Keep it"): the creating manager keeps remove, return and due-date rights wherever the task goes.
  - **Amendment from the department head's review of #228 (2026-10-28), confirmed by the owner 2026-10-28** ("Allow it"). A task sent to a department lands with that department's manager. Under PD-8 a manager belongs to no department, so nobody but the super admin stands over them. **As the assignee, a department's manager may reassign their own task**: within their team, or onward to another department. They may not remove or return it. Without this, Q6's "send to another department" dead-ends with the super admin.
- **Across departments** (Q6): a manager reassigns within their team. "Send to another department" assigns the task to that department's manager, who distributes it. The super admin may assign anywhere.

### 3.8 Visibility

| Who | Mine | Team | Decisions | All |
|---|---|---|---|---|
| Teacher | own | — | — | — |
| Supervisor / specialist / legacy department role | own | PD-35 teacher supervisors: their teachers' tasks, **read-only** (Q3) | — | — |
| Manager | own | members of the department they manage (`staff_principals`/`department_member`, `mig/20261015120000:98,603-619`); the Teachers manager also gets every teacher of the department (`staff_teacher_scope = 'manager'`, `mig/20261026160006…:81`) | tasks awaiting decision where they are responsible | — |
| Super admin | own | — | all awaiting decision | every task, filterable by department, person, source, state, overdue |

Outside these rules a task reads as `TASK_NOT_FOUND`. Every list is keyset-paged and filterable by state, source, overdue and due date. The **Closed** tab shows completed and removed tasks with their history (default 90 days; Q13).

### 3.9 Permissions (PD-40)

| Key | Grants | Default bundles |
|---|---|---|
| (none, `@SelfService`) | `GET /me/tasks`, `GET /tasks/:id`, `POST /tasks/:id/complete` (manual), `/out-of-scope`, `/comments`, `/acknowledge` | every staff member and teacher; Layer 2 checks the assignee |
| `tasks.team` | `GET /tasks?view=team` (and the PD-35 read-only view) | `DEPARTMENT_MANAGER`; teacher supervisors if Q3 |
| `tasks.manage` | `POST /tasks/:id/remove`, `/reassign`, `/return`, `/due` | `DEPARTMENT_MANAGER`; not delegable |
| `tasks.create` | `POST /tasks` | `DEPARTMENT_MANAGER`; teacher supervisors if Q5 |
| (super admin) | `GET /tasks?view=all`, `view=decisions` across the organization | super admin |

- Keys are added the PD-40 way: `catalogue.ts`, `legacy-bundles.ts`, a LATER generated block in PR-1's migration, and the regenerated route table.
- **A key is necessary, never sufficient.** Layer 2 checks "responsible for *this* task", live.

### 3.10 Realtime

- **The signal:** every task change enqueues `task.changed { taskId, revision, change }` in the same transaction. It is a signal, not content: clients refetch through their authorized routes and drop a lower revision.
- **The worker** gets an explicit `case`, fixing the dead `default:` path for this event. It sends to the actor rooms (`RealtimePublisher.toUsers`, `communication/contracts/events.ts:487-494`) of: the assignee, the previous assignee, the responsible managers, and the super admin for decisions.
- **The idempotency key** is `task:<id>:<revision>`, using `outbox_event.idempotency_key` if PD-46 PR-1 has landed. If it has not, duplicates are harmless, because the signal only causes a refetch.
- **Admin Web** registers the handler beside the live ones and removes the dead `task.updated` one. **Flutter** adds a `chat_signal.dart` kind, without touching the frozen call files (PD-46 §3.6).

### 3.11 Notifications (PD-34) and the Dashboard (PD-44)

- **Notifications.** PD-47 emits a `task`-category notification on these events: assigned or reassigned (to the new assignee), returned (to the assignee, with the instructions), out of scope (to the responsible managers), and overdue (once per due date, B5's notice-table pattern).
  - It sets `requires_action`, `owner_id`, `due_at`, `task_status` and `subject_type = 'task'`. The `action` field opens the task. This finally fills the Center's "Action" tab.
  - When a task leaves a person, their item is marked acted (`acted_at`) or cancelled. The Center **mirrors** the task; **the Tasks page is the truth.**
  - Pushes respect quiet hours. Lesson-report tasks send **no push when created** (the teacher just taught the lesson), and **one push when overdue** (Q10).
- **Dashboard.** PD-47 adds `GET /dashboard/tasks` with these tiles, in PD-44's tile shape `{key, count, oldestAt, capped}`, from the same `TaskService` as the list:
  - `tasks.mine_open`, `tasks.mine_overdue`;
  - `tasks.team_open`, `tasks.team_overdue`;
  - `tasks.awaiting_decision`, `tasks.needs_reassignment`;
  - for the super admin, `tasks.all_overdue`.
  - Coordinated with the PD-44 session (#211). The dead `/dashboard/needs-action` call is retired by PD-44.

**As built in PR-4.**
- **Delivery:** `OutboxWorker.deliverTask` reads the task live, beside PD-35's `deliverCase`.
  - Signalled: the assignee, the person it left on a hand-on, the responsible managers, and the super admin while it waits on a decision or no manager stands to it. Ids only.
  - Told, as a PD-34 `task` entry (Action tab: `requires_action`, `owner_id`, `due_at`, `task_status`; action `open_task`) with a generic push:
    - `created` and `reassigned`: the assignee. A lesson report is not announced when raised.
    - `returned`: the assignee.
    - `out_of_scope`: the responsible managers, else the super admin (`task_status` `escalated`).
    - `overdue`: the assignee.
  - Never told: the person who did it.
- **Settled:** a task that leaves a person (handed on, completed, removed) marks their entries acted, with `task_status` `cancelled` or `done`.
- **Who did it is written with the change.** The actor, and for a hand-on whom it left and reached, are put in `task.changed` when the change is made: by the API, and by the database's `work_task_raise` and `work_task_reroute`. Delivery never reads them back from the task's newest event, which may be a later one.
  - A task handed A → B → C before delivery signals all three and tells only C, once.
  - Nobody already asked about a task is told "given" again.
- **Settled** also covers decisions: a return settles the deciders' "decision waiting", and a new due date settles the old "overdue".
- **Overdue:** `TaskService.sweepOverdue` (the worker, each minute, batch after batch, with its own error label) announces each task once per due date (`chat.work_task_overdue_notice`). Two sweeps at once announce it once. A task re-dated and overdue again is announced again.
  - **Decided:** a task whose work went away (withdrawn) is not announced overdue, because nobody must do it.
  - **Decided:** a task overdue while it waits on a decision is announced to the decider (the responsible managers, else the super admin) as "a task waiting for your decision is overdue" (`task_overdue_decision`), not to the assignee. A return settles that notice, and tells the assignee once if the task is still overdue.
  - The overdue signal carries the due date it is for. A task re-dated before delivery gets nothing for the old date.
- **Signalled** also includes a teacher's supervisors, who read their tasks (owner Q3); they are never told. After a hand-on, the managers and supervisors of the person it left are signalled too, because their lists changed.
- **A renewal always reaches someone:** the family's Sales owner, else the Sales manager, else the super admin. When a Sales owner or manager appears, the task moves to them.
- **Tile == list:** the list takes `gone=true` (the assignee left) and `unmanaged=true` (no live manager stands to it), so "Tasks whose assignee left" and "Tasks no manager can move" open exactly the list they count. A spec compares every tile with its list.
- **No content in any text:** templates `task_*` and `inbox.task_*` are generic: no title, amount, card, family or child. Entries carry no variables.
- **Q-F6:** the renewal push to every Sales member is gone. The renewal task's assignment notice reaches its one owner.
- **Dashboard (PD-44):** a Tasks section, open to everyone. Each tile opens the Tasks view it counts.
- **Clients:**
  - Admin Web routes `open_task` to `/tasks?task=`.
  - Flutter listens for `task.changed` on the session socket (`TaskSignalChannel`, listen only; the frozen call client is untouched) and refreshes the To do. A task entry opens the teacher's Schedule on its To do.

**As built in PR-7.** The B7 action log (`ActionLogService`) gains a third source, `chat.work_task_event`, holding what the person did to a task themselves.
- **Every act on a task a person gave.**
- **On a task a source raised, only what no source writes:**
  - said it was not theirs;
  - returned it;
  - removed it;
  - commented;
  - changed its level;
  - acknowledged it.
- **A source's own moves stay out.** A report filed, or a case reassigned or re-dated, is that source's record, so it would otherwise show twice. PD-35's case lines are unchanged.
- **Ids only:** a line carries the task's id, with action `task.<kind>` and entity `work_task`. Never a title, a comment or a reason.
- **Admin Web** names each line and opens it in Tasks, which says plainly when the reader may not see it.
- **No migration:** the actor index exists since PR-1.

### 3.12 Clients

**Admin Web: `features/tasks` rebuilt.**
- Tabs: Mine · Team · Decisions · All · Closed, each shown only to whom it applies.
- A row shows: the title, a source chip, the assignee, the due date, the age, and a state badge (Open / Waiting for a decision / Returned with instructions / No longer needed).
- **The detail drawer** has:
  - an "Open" button to the source page;
  - the instructions banner;
  - the actions the viewer may take;
  - the full history timeline.
- en/ar, RTL, 12-hour times, 44 px targets.
- The legacy `taskApi`, `Task` type, query keys and `task.updated` handler are replaced. `homeFor` for the legacy department roles keeps `/tasks`, which now works.
- Tasks goes into the navigation of every staff role.

**As built in PR-3.**
- **Two reads were added to the API**, so the page offers only what the server would accept:
  - `GET /tasks/:id` returns `actions`: what this viewer may do now, by the routes' own rules. The routes still decide on every write.
  - `GET /tasks/assignees[?task=]` lists the live people the caller may give a task to, or hand this task on to, and the departments with a live manager (`tasks.create` or `tasks.manage`).
  - `titleParams` of the instalment, `package_low` and `renewal_request` tasks carry the child's id, for the link to the Student Profile.
- **Tabs by role:**
  - everyone: Mine and Closed;
  - `tasks.team` / `tasks.manage`: Team;
  - `tasks.manage`: Decisions;
  - the super admin: Decisions and All, without Team.
- **The super admin's Tasks** is an Admin Portal section (`managed`).
- **Every staff role has Tasks in its navigation**, the Designer (`specialist`) included.
- **Realtime:** `task.changed` refreshes the page. Its delivery is PR-4's.
- **Level colours:** each level has its own measured pair, light and dark (`tasks.css`, tested at 4.5:1 for text and 3:1 for the icon).

**Flutter (teacher app and `/teacher/` web, one build), if Q2 is approved.**
- A **"To do (N)"** segment at the top of the Schedule tab, beside the "Needs report" filter.
- The teacher can: open a task (for example straight to the report sheet), add a comment, say **"Not mine"** (out of scope), acknowledge a task that is no longer needed, and mark a manual task done.
- Teachers create no tasks.
- Staff on mobile (Sales) come later.

**As built in PR-5.**
- **"To do (N)"** is a third chip beside "All" and "Needs a report". It lists `GET /me/tasks` in the server's order, with the read-only level chip.
  - The chip uses the theme's own measured pairs: danger for High, the strong accent on its subtle ground for Medium (the gold rule), and success for Low.
- **The sheet** reads `GET /tasks/:id` fresh and offers only its `actions`: done, acknowledge, "Not mine" (with a reason) and comment.
- **"Open the lesson"** opens a lesson-report or correction task's lesson in the Schedule's own lesson actions. `titleParams` carries `lessonId` for this.
- **Refresh:** the list refreshes on pull and after every action. Live refresh waits for PR-4's `task.changed` delivery (§3.10).

### 3.13 Security notes

- Fail closed: RLS on and no grants. The database guard names a live actor of the same organization. There are no deletes. History is append-only.
- Standing is live at every read and act (B5's rule).
- Outbox and notification payloads carry ids only. System titles are rendered per viewer.
- A manual task's text is staff-written and never shown to a family.
- `chat.staff_can_see_family` is **not** touched, and no `chat.task` row is ever written.
- G-20: no real names outside `docs/`.

---

## 4. How the existing pages relate

| Page | After PD-47 |
|---|---|
| Leave, Discipline, Complaints, Parent feedback, Certificates | unchanged; their rows link back to the task ("Assigned to X, open 2 d") |
| Needs action (Teachers) | unchanged; it is the department's queue, while Tasks names a person |
| Cases (PD-35) | the case stays the record. The task is the owner's pointer, and the case's assign moves the task |
| Teacher Schedule "Needs report" | unchanged; "To do" adds the rest |
| PD-46 Upcoming strip | not a task: live and time-boxed by design |

---

## 5. Risks

- **Two truths, source and task.** Mitigated by:
  - completion triggers in the source transaction;
  - the reconciling sweep;
  - a guard spec per adapter;
  - a nightly read-only check that counts open tasks whose source shows the work done, which must be zero.
- **Volume.** About 2,000 lesson-report tasks a week, most completed within the hour. That is two rows each, cheap. The list indexes are `(assignee, state)` partial on pending.
- **Removing a system task while its work is pending** hides the work from Tasks but not from its page (Q7). The history and the Dashboard show it.
- **Scope drift.** Responsible managers are computed live, never stored.
- **Confusion with `chat.task`.** The name `work_task` and a comment on both tables guard against it. Removing the legacy table is a separate decision.

---

## 6. Tests (in every PR, written to fail first)

- **Exits:**
  - each of the four exits, by an allowed and a refused actor;
  - DB-level refusals: no actor, a final state, DELETE, a missing reason or instructions;
  - event rows for each, with actor and timestamp.
- **Never disappearing:**
  - a source read error in the sweep completes nothing;
  - a scope change keeps the assignee's own list;
  - an Admin Web refetch that returns 500 keeps the rows and shows the banner;
  - a realtime signal with a lower revision is ignored.
- **Idempotency:**
  - the sweep run twice creates one task;
  - a removed system task is never re-created;
  - work done outside the service still completes the task, through the trigger.
- **Visibility:** the matrix in §3.8, including another organization and an inactive reader.
- **Proof:** CI G-19 is the integration proof. No local containers.

---

## 7. Delivery (after approval)

| PR | Content | Slot |
|---|---|---|
| PR-1 | `chat.work_task` + `chat.work_task_event`, guard and history triggers, RLS; `TaskService` with manual tasks, the four exits, comments and the lists; the routes and the PD-40 keys (LATER block); integration spec | **`20261029160000`** (assigned) |
| PR-2 | The source framework, the worker sweep, the Phase A adapters and their completion triggers; the `lesson.service`/`leave`/`discipline`/`cases` hooks; the guard spec | **`20261029210000`** (assigned; moved from 170000) |
| PR-3 | Admin Web Tasks page, en/ar, RTL; legacy client code removed | none |
| PR-4 | `task.changed` and the worker `case`; PD-34 emission and the overdue notice sweep; `/dashboard/tasks` (with PD-44) | 0–1 (the notice table) |
| PR-5 | Flutter "To do" in the Schedule tab (app + teacher web), if Q2 | none |
| PR-6 | Phase B sources, one per commit, in §3.6's order (after #214 and #215 land) | one |
| PR-7 | B7 action log gains task events | none |

- **Order:** PR-1 → PR-2. Then PR-3 and PR-4 can run in parallel (two sessions at most, by the machine-load rule). Then PR-5, then PR-6 and PR-7.
- **Dependencies:**
  - PR-4 prefers PD-46 PR-1's outbox key.
  - PR-6's family source needs PD-42 PR-3 (#214).
  - The certificate source lands with PD-41's build.

---

## 8. Owner decisions

**DECIDED 2026-10-28.** The owner's answer, relayed verbatim by the department head:

> "Approve all 13 (Recommended)"

Every recommendation below is therefore the decision. The table keeps each question for the record.

| # | Question | Decision |
|---|---|---|
| **Q1** | PD-4 and boundary §1.2 forbid a task entity. May PD-47 reopen that, narrowly? | **Yes, narrowly.** Tasks are accountability items for staff and teachers about Chat's own records. There is no CRM routing, workload scoring or SLA engine. Family-facing events stay system messages. Legacy `chat.task` stays frozen, and a new table is used. |
| **Q2** | The Teacher Account is frozen. Where do a teacher's tasks appear in the app and on teacher web? | **A "To do (N)" segment inside the existing Schedule tab**, with no new tab. It lists lesson reports, correction requests and manual tasks. A teacher may comment, say "Not mine", and acknowledge. |
| **Q3** | You said supervisors see their own tasks. Should a teacher supervisor (PD-35) also *see* their teachers' tasks? They are the ones who chase missing reports. | **Yes, read-only** ("My teachers"). Removing, reassigning and deciding stay with managers and the super admin. Operations supervisors see their own only. |
| **Q4** | The work no longer exists (lesson cancelled, leave withdrawn, correction withdrawn). Should the task close by itself? | **No.** It stays with a "No longer needed" badge. The assignee taps **Acknowledge**, which completes it as exit 1 with outcome `acknowledged`, or a manager removes it. Nothing closes silently. |
| **Q5** | Who may create manual tasks, and for whom? | **Managers** for their team, the **super admin** for anyone, and **teacher supervisors** for their own teachers. No peer-to-peer tasks. |
| **Q6** | May a manager reassign to another department's staff? | **No, not directly.** "Send to another department" gives the task to that department's manager, who distributes it. The super admin may assign anyone. |
| **Q7** | A manager removes a system task whose work is still pending (for example a leave request). What then? | **Allowed, with a reason.** The leave request stays pending on its own page. The task is never re-created, and the history shows who removed it and why. |
| **Q8** | After a task is returned with instructions, may the assignee say "out of scope" again? | **Yes.** Every round is in the history. The super admin sees "disputed N times" from the second round. |
| **Q9** | Approve the Phase A sources and the Phase B order (§3.6)? | **Yes.** Phase A covers the teacher's own work and the Teachers department's decisions. Phase B follows #214 and #215. Certificates are built with PD-41. |
| **Q10** | Lesson-report tasks: when are they created, when are they due, and are they pushed? | **Created at the lesson's end, due 24 h later** (the existing `lesson.escalation_after_minutes`). **No push on creation, one push when overdue**, respecting quiet hours. |
| **Q11** | The assignee is deactivated (staff) or offboarded (teacher). | **Tasks stay assigned**, flagged "Needs reassignment" for the responsible manager and on the Dashboard. PD-43's offboarding preview lists open tasks as a **warning, not a block**. |
| **Q12** | Does a completed manual task need the manager's confirmation? | **No.** The assignee completes it, with an optional note (your exit 1). The manager sees it in the history and can create a follow-up. |
| **Q13** | How long are closed tasks kept? | **For ever, never deleted.** The Closed tab shows the last 90 days by default; the super admin can search all of them. |
