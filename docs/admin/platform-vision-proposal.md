# Jawwid Academy operating platform: architecture and product proposal

Status: **PROPOSAL for the owner's review. Nothing is implemented, merged, deployed or migrated.** Date: 2026-11-21.
Evidence base: four read-only studies of the repository on `main` `615e56db` (Admin Web inventory; roles, departments and
permissions; academy workflows and handovers; data, work-tracking and integrations), plus this session's own work on PD-59
(F7, the trial-ownership fixes, the visual review). Paths below are real; claims marked **(unverified)** could not be confirmed
from the repository alone. Jawwid Core and Second School were not read or touched.

---

## 1. What we found (the honest diagnosis)

**The application is organised by pages and departments, but the business is organised by shared records and handovers.**

| Finding | Evidence |
|---|---|
| 39 feature folders, each a page-set with its own list, filter, detail and "no access" pattern | `apps/admin-web/src/features/*`; no shared Table, Drawer, Tabs or Pagination (35 files hand-roll `<table>`) |
| Two parallel navigation trees: operator areas and a super-admin `/admin/*` portal, duplicating at least 11 destinations (dashboard, tasks, parents, payments, instalments, teams/organization, teacher stats, teacher files, stories, calls, conversations/users) | `AppRoutes.tsx`, `navigation.ts` (`adminDestinations` vs `operatorDestinations`) |
| Nav is hand-assembled: a static role-to-area list per role family, then ~17 areas filtered by "probe" endpoints (`GET /lessons/access` and others). "Department" is inferred, not known | `core/permissions/capabilities.ts` (`visibleAreas`, `SERVER_CONFIRMED_AREAS`) |
| Adding one page touches ~8 files (`NavArea`, `visibleAreas`, probe flag, destination, path, icon, admin twin, messages, routes, tests) | same |
| 9 "in development" sections (quality, academy, forms, notifications, whatsapp, approvals, integrations, audit, settings) are visible in the super admin's rail with no backend | `features/admin/sections.ts` |
| The same student or trial is touched in up to four places (pipeline, trials, intake/new students, students directory, student profile, teachers/students); teachers are spread over eleven features | feature inventory |
| Departments are hardcoded to three kinds in the schema and ~60 SQL/TS sites; roles are a closed enum; a new department cannot be expressed without schema changes | `department.kind CHECK ('operations','teachers','sales')`; `legacy_permission_bundle.department_kind CHECK`; `DEPARTMENT_KINDS` in `tasks/task.service.ts`; per-kind predicates `sales_department_role` etc. |
| Access is decided by ~15 separate policy files and SQL functions, **not** by the 87 permission keys: the guard is still in `shadow` mode (`PERMISSION_GUARD_MODE = 'shadow'`) | `permission.guard.ts:20`; `platform/*-policy.ts` |
| **The same bug class recurs:** a list is scoped but its detail, counts, cards, tasks, payments, search or realtime are not. PD-59 produced F7 and five siblings in a week (trials, New Students, payment cancel, teacher-records, trial-group cards, trial task owner) | PRs #627-#632 |
| A real work kernel already exists (PD-47 `work_task` with system tasks, handovers, append-only history; cases; notification items that already mirror tasks) but the UI shows it as five unrelated pages (Dashboard counts, Tasks, Cases, Notifications, Approvals/Moderation) | `apps/api/src/tasks`, `notification-pipeline.service.ts`, dashboard tiles |
| Functions the business needs and the product lacks: Marketing (no lead source or campaign), Recruitment/HR (nothing before a teacher record exists), Quality assurance (evaluations exist, no QA workflow), Executive KPIs (counts only), Finance beyond payments (no AR, reconciliation, expenses) | workflow study §4 |

**Constraints the design must respect** (owner decisions recorded in the repo): BR-1/PD-7 (teacher and parent never share a direct
channel); phone numbers never appear in UI (BR-2/G-07); Arabic first with every string bilingual; Core and Second School untouchable;
Chat owns family money (PD-17/27/30); PD-59 ownership rules; `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` says Chat is "a
communication platform first" and freezes tasks and cases as generic systems (**this proposal needs an explicit new decision, see §9**).

---

## 2. The vision in one sentence

**One platform where every employee opens to *what needs them today*, works on *shared records* in a consistent way, and hands work
to the next person through *defined handovers*, with the visible product shaped by who they are, not by which department's pages exist.**

Three ideas carry the whole design:

1. **Organise around work and records, not pages and departments.** Departments become *lenses* (configured views), not codebases.
2. **Enforce visibility once, at the record, not on every page.** One access layer decides "may this person see this record, and
   which ones", and every list, detail, count, search, notification, realtime event and export uses it.
3. **Make the organisation data, not code.** Departments, positions, ownership relations and handovers are configuration over a
   small set of shared primitives, so a new department is a configuration, not a redesign.

---

## 3. The information architecture

### 3.1 The five shared building blocks (and nothing else)

| Primitive | What it is | Today's pieces it absorbs |
|---|---|---|
| **Record** | An entity with identity, owner, status, timeline and *facets*: Family, Student, Teacher, Lead, Staff member, Lesson | parents, student profile, students directory, teacher file, teacher profiles, pipeline drawer, trials, intake |
| **Queue** | A list of work items with owner, due date, priority, state and a next action | tasks, cases, approvals, moderation, receipts to review, renewals, replies awaiting, notifications that require action |
| **Pipeline** | Stages with owners and entry/exit rules over records | sales pipeline, trial desk, new-student assignment; *candidates (recruitment)* and *campaigns (marketing)* are the same primitive configured differently |
| **Ledger** | Money movements with approval and reconciliation | payments, instalments, receipts, invoices, Stripe, payroll; later accounting |
| **Conversation + Calendar** | Communication and time, shared by everyone | chat, calls, trial groups, department rooms; academy calendar, teacher and student schedules |

Plus two cross-cutting services: **Scorecard** (evaluations, QA, KPIs) and **Approval** (any decision that needs a second person).

### 3.2 The experience: a small, personal navigation

Navigation is a **projection of the person**: `(identity × capabilities × assigned work)`, generated, never hand-listed. Every employee
sees at most six items; most see four or five:

| Item | For whom | Content |
|---|---|---|
| **Today** | everyone (their landing) | "What needs me": one Queue merging my tasks, approvals, replies owed, follow-ups due, receipts to review, escalations. Managers get a *Team* toggle on the same page. Executives get *Organisation*. |
| **Conversations** | everyone who communicates | chat and calls (kept as-is: it is the product's core) |
| **People** | everyone | one directory and one search over Families, Students, Teachers, Leads, Staff, showing only what the person may see; opens the universal Record view |
| **Schedule** | whoever schedules or is scheduled | the single calendar (academy, teacher, student views are filters, not pages) |
| **My workspace** (named after their department: Sales, Operations, Teachers, Finance, Marketing, HR, Quality…) | department members and managers | the department's configured lens: its pipeline or queues, its lists with saved filters, its KPIs. Not new pages: a *composition* of the shared primitives |
| **Insights** | managers, executives | KPI catalogue and reports (funnel, retention, teacher quality, revenue, SLA); replaces count-only Dashboard |
| **Admin** | admins | organisation, roles, settings, audit, integrations |

Example landings: a Sales representative sees *Today · Conversations · People(my leads) · Sales · Schedule*; an Operations supervisor
*Today · Conversations · People(my families) · Operations · Schedule*; a finance officer *Today · Money · Insights*; the owner *Today ·
Conversations · People · Schedule · Insights · Admin*. A person in two functions gets a workspace switcher, not more menu items.

### 3.3 One Record view for every entity

Every Record opens in the same layout: **header** (identity, status, owner, next step) · **timeline** (audit, events, messages in one
stream) · **facets** (tabs shown per capability: Sales, Operations, Finance, Teaching, Quality) · **actions** (the next legal moves).
This replaces Student profile, Parent profile, Teacher file and the Lead drawer as four different screens with one pattern, and makes
"who owns this and what happens next?" answerable everywhere. A **command palette** (global search) opens any record by name or id.

### 3.4 One UI kit

A small shared kit (DataList with filters, saved views and pagination; RecordView; Drawer; Tabs; Timeline; QueueItem; the three
standard states: loading, empty, forbidden) replaces the 35 hand-rolled tables and the inconsistent "no access" renderings the visual
review found. Terminology comes from one glossary, in Arabic and English, owned centrally.

---

## 4. Organisation, roles and permissions

### 4.1 Make the organisation data

| Today | Proposed |
|---|---|
| `department.kind` is a three-value CHECK; ~60 hardcoded sites | **Department** is a row (name, kind label, manager, parent department). Behaviour comes from capabilities, not from the kind string |
| Roles: closed enum (`admin`, `coverage`, `manager`, legacy `finance/technical/academic`, `specialist`) mapped to tiers | **Position** within a department (member / lead / manager) plus **role templates** (named capability sets); the legacy enum remains as a compatibility mapping |
| Ownership is a different table per concept (`learner_supervision`, `family_sales_owner`, `trial_prospect.owner_staff_id`, `work_task.assignee`, `teacher_supervisor_assignment`, backups/covers) | One **relation table**: `(staff, entity_type, entity_id, relation)` with relations `owner`, `supervisor`, `backup`, `participant`; existing tables stay and project into it during migration |
| Scope vocabulary differs per page (`all/reach/owned`, `member/manager/seated`, teacher scope, sales scope…) | One vocabulary: **own · assigned · team · department · organisation**, resolved from relations and reporting lines |
| Keys exist (87) but are advisory; access really lives in ~15 policy files | **Capability = action on entity type, with a scope**. The key catalogue becomes the contract and is enforced |

### 4.2 The Resource Access Layer (the single most important change)

Every entity type declares **one** scope function: `visibleTo(actor) → predicate`. Everything that touches the entity uses it: list,
detail, counts and dashboard tiles, search, exports, notifications, realtime fan-out, chat cards, tasks and payments that reference it.
The F7 family of defects (a list scoped, its siblings not) becomes structurally impossible, and a new entity inherits correct
behaviour by declaring its scope once. This is also what makes **department-manager and executive views safe**: they are scope
choices (`team`, `organisation`), not separate implementations.

### 4.3 What each audience gets

| Audience | Experience | Visibility |
|---|---|---|
| Employee | Today, plus the records and workspace of their function | own and assigned |
| Department manager | the same screens with a Team toggle, reassign and approve actions, team KPIs | team / department |
| Senior management and the owner | Insights and an organisation toggle on every list | organisation (read), with audited write actions |
| A new department (e.g. Marketing) | a workspace definition + a role template + any new entity facets | defined by capabilities, no schema change |

---

## 5. Shared capabilities and how work moves

### 5.1 Handovers as data

Today a handover is code in SQL triggers (`work_task` source types: `trial_outcome`, `new_student_assign`, `renewal_request`, …) with
assignment rules in SQL functions. The new model keeps that engine (it is solid: append-only history, sweeps, withdrawal,
back-off) and lifts the rules into a **handover registry**: *from stage, to role/department, task template, SLA, notification, audit*.
Reassignment (the PD-59 lesson: the task followed the prospect's creator, not its owner) then follows the record's owner relation
by construction.

### 5.2 The two journeys that define the academy

```
STUDENT   Lead → Trial booked → Trial held → Outcome → Enrol (Operations) → Parent signed up → Active (supervised, scheduled)
          → Billing & instalments → Renewal → (Left / Paused)
TEACHER   Candidate → Interview → Onboard → Trial group → Assigned students → Supervised → Evaluated → (Leave / Discipline) → Offboard
```

Each stage has an owner, an expected next action, an SLA and a handover. The current product covers the middle of both journeys well and
leaves the **front** (marketing source and campaigns; candidate pipeline) and the **back** (retention analytics, left-student closure,
refunds that return lessons) thin. Those become new Pipeline and Scorecard instances, not new code stacks.

### 5.3 Where the new business functions land

| Function | Built from | New |
|---|---|---|
| Marketing | Pipeline (leads), Stories, WhatsApp channel | lead source and campaign attribution; funnel and cost-per-acquisition Insights |
| Sales | Pipeline, trials, subscription form | unchanged capability, reached through the shared Record and Queue |
| Operations | Records, Schedule, Queue | the Needs hand-over queue (PD-59 O4) as a standard Queue |
| Teacher supervision | Teacher Record, Scorecard, Queue | one Teacher record instead of eleven features |
| Quality assurance | Scorecard, Approval, cases | lesson sampling, scorecards, improvement plans as a workflow |
| Recruitment and HR | Pipeline (candidates), Teacher Record, Approval | candidate pipeline, interviews, onboarding checklist (PD-43 starts here), staff HR |
| Finance and accounting | Ledger | receivables, reconciliation, expenses, accountant role |
| Executive oversight | Insights, Approval | KPI catalogue, organisation toggle, approvals inbox |

---

## 6. What changes in the existing application, and why

| Disposition | Items | Reason |
|---|---|---|
| **Retain** | Conversations and calls; Schedule engine; Ledger and Stripe; PD-47 task engine; audit; confinement of contact data; Arabic/RTL; trial and enrolment transactions; all existing URLs (kept as redirects: the "no URL lost" test stays) | proven, owner-approved, high-risk to rewrite |
| **Consolidate** | the two navigation trees into one; Dashboard + Tasks + Cases + Notification Center + Approvals + Moderation queue into **Today**; Students directory + Student profile + Parents + Teacher file + Teacher profiles + Lead drawer into **Record view + People**; Instalments + Payments + Subscriptions panels into **Money**; trials + new students + intake + pipeline into the Sales/Operations **Pipeline** and handover queue | removes the duplication the studies measured |
| **Redesign** | permission enforcement (shadow to enforce, one access layer); department/role model (data-driven); navigation (generated); the "no access" and list/filter/detail patterns | root causes of the recurring defects and of the cost of adding a department |
| **Introduce** | Resource Access Layer; handover registry; Insights/KPI catalogue; universal search; Pipeline for candidates and campaigns; Scorecard/QA; accountant and finance capabilities | the missing business functions |
| **Remove (safely)** | the 9 placeholder sections from the rail until built; `/admin/*` duplicate routes (become redirects); the legacy `chat.task` remnants; stale docs and strings that claim Core owns subscriptions | noise and contradiction; none removes a capability |

---

## 7. Phased roadmap

Every phase is independently shippable behind a flag, additive in the database (new slots with rollbacks), and keeps all existing URLs.

| Phase | Goal | Contents | Depends on | Exit criteria |
|---|---|---|---|---|
| **0. Decide and stabilise** | agree the target; close the PD-59 class | owner decisions of §9; finish and review #627-#632; reconcile Boundary/PD docs; glossary; KPI list; production audit for enforcing permissions (`pd040-enforce-readiness`) | owner | decisions recorded as a PD; no known unscoped surface for existing entities |
| **1. UI kit and cleanup** | one visual and interaction language | shared DataList/RecordView/Drawer/Tabs/States; unified Forbidden/Empty; hide placeholders; one nav tree with the same destinations (no behaviour change) | 0 | navigation and "no URL lost" tests green; visual review re-run with no inconsistency findings |
| **2. Today (unified Queue)** | one place for "what needs me" | `/me/work` API aggregating tasks, cases, approvals, moderation, receipts, replies; manager Team toggle; notification items become the inbox; Dashboard counts move to Insights | 1 | every existing queue reachable and counted identically; per-role usability test |
| **3. Records and search** | one Record view; global search | Student, Family, Teacher, Lead records on the shared layout; command palette scoped by the access layer | 2, access layer | old pages redirect; search never returns an unauthorised record (property test) |
| **4. Data-driven organisation** | new departments without redesign | department kinds and positions as data; relation table; capability x scope; **dual-run comparator** (old vs new decision logged, zero diffs before cut-over); enforce the permission guard | 0, 3 | golden-master authorization matrix (role x entity x action) identical; production shadow shows no unexplained denial |
| **5. Workspaces, handover registry, new functions** | Marketing, HR/Recruitment, QA, Finance, Insights | workspace definitions; handover registry; Pipeline instances; Scorecard; ledger extensions; KPI catalogue | 4 | each new department launched by configuration with no schema change to the access layer |

**Indicative sizing (unverified, for planning only):** phases 0-1 weeks; 2-3 a few weeks each; 4 is the largest and riskiest; 5 is
incremental per function. Phases 1-3 deliver visible value before the authorisation rewrite.

## 8. Verification strategy and risks

**Verification.** (a) A **golden-master authorisation matrix** generated from today's behaviour (role x entity x action x record) must
stay identical through every refactor; the existing ~800 integration tests plus the new cross-representative suites are the base.
(b) **Dual-run decisions** in production shadow: log old and new answers, ship only when diffs are explained. (c) Property tests:
search, counts, notifications and realtime never exceed `visibleTo`. (d) The 45-URL "no URL lost" test and the nav test for every role.
(e) Visual review at desktop, tablet, phone, Arabic and English for every phase. (f) Usability sessions with real staff per role.
(g) Performance budgets (the API pool is 7 connections per replica; unified queues and search must be indexed and paginated).
(h) Migration safety: additive, rollbacks, slot claims, throwaway-database rehearsals as in PD-59.

| Risk | Mitigation |
|---|---|
| Conflicts with the "communication first, no generic CRM/case system" boundary | explicit new owner decision first (§9); build on PD-47, do not revive the frozen legacy tasks |
| Enforcing permissions locks someone out | readiness audit on production data; dual-run; staged enforce per department |
| Authorisation rewrite regresses a privacy rule (BR-1, phone privacy) | those rules stay as database constraints; golden-master and structural tests (G-07) gate every phase |
| Scope creep into a multi-year rewrite | phase gates with exit criteria; each phase ships value alone |
| One organisation, three departments today: over-generalising | build primitives only when a second consumer exists (Pipeline: leads and candidates; Queue: tasks and approvals) |
| Hot-table migrations (e.g. message_card) | additive columns, rehearse locks, owner approval before any apply |
| Adoption: staff used to current pages | keep old URLs as redirects, ship Today first, train per department |

---

## 9. Decisions needed from the owner

1. **Product boundary.** Approve extending Jawwid Chat from "communication first" into the academy's operating platform, as a new PD
   that supersedes the relevant Boundary statements (tasks/cases freeze, "not a CRM"), while keeping BR-1/BR-2, Arabic first and the Core boundary.
2. **Priority of new functions.** Which comes first after phases 1-3: Marketing, Recruitment/HR, Quality, Finance/accounting, Executive Insights?
3. **Organisation reality.** Current and planned headcount and departments (docs show 4 primary + 2 backup supervisors in Operations,
   2 in Teachers as of 2026-10-15), so the model is sized right.
4. **Core and billing truth.** Docs say Chat owns subscriptions and takes one-off Stripe payments with no recurring billing; a recorded note
   says live monthly auto-charges exist outside Chat (likely Core). Which is current? It decides the Finance design.
5. **Permission enforcement.** Authorise the production readiness audit and, later, the shadow-to-enforce switch.
6. **Executive access model.** One super admin per organisation is enforced today: is a second executive role wanted?

## 10. Next step if approved

Phase 0 only: record the decision, review and finish PRs #627-#632 (the stabilisation of the existing access model), write the glossary and
KPI catalogue, and produce the detailed Phase 1 UI-kit and Phase 2 Today designs (screens and API contract) for approval. No code for phases 2-5 starts before that.
