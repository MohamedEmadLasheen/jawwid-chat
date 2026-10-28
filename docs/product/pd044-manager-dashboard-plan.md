# PD-44: a real manager Dashboard (review and plan)

**State:** plan for approval, revision 1. No feature code is written.
**Claim:** `docs/product/pd-registry/PD-44.md` (PR #189). **No migration slot is claimed.** The plan expects no DDL. §6.4 lists the two indexes a reviewer may ask for; if one is needed, the department head assigns the slot at that PR.
**Base:** `main` @ `a547b0e2`, read after PR #187 (Remove the legacy Inbox; approved, merging on green). #187 removes `dashboardApi.unattended` and the Dashboard's link into `/inbox`. It keeps `DashboardPage` and its four other calls. Line numbers in `endpoints.ts`, `queryKeys.ts` and `RealtimeProvider.tsx` are `main`'s, and #187 moves some of them.

The owner's decision, verbatim:

> "Remove Inbox, rebuild Dashboard"

---

## Summary

- **Today's Dashboard is dead.** `DashboardPage.tsx:45-48` calls `/dashboard/header`, `/dashboard/team-now`, `/dashboard/needs-action` and `/dashboard/this-week`. No API controller serves any `dashboard` route, so every persona gets 404. The page measures the original brief's on-duty / unattended model, which PD-8 (supervisors and backups) and PD-33 (covers) replaced.
- **The data a manager needs mostly exists, but not as counts.** Every signal in the brief is stored or derived on `main` (§1). Only one route returns a cheap count today: `GET /payment-receipts`. Every other figure is either a list of up to 200–1000 rows, a whole-organization load, or absent.
- **The plan: one small count endpoint per Dashboard section.** There are seven, `GET /dashboard/<section>`. Each one:
  - declares the PD-40 key of the page it links to;
  - counts with the **same scope helper** as that page's list, so the tile and the page cannot disagree;
  - runs a fixed number of indexed SQL statements, with no N+1.
- **No new permission key and no migration.** A section is offered to someone who holds its page's key. The server then omits the tiles the person's department or scope does not cover.
- **Who gets it:** the super admin (inside the Admin Portal's Dashboard section) and the three managers. Supervisors are not in v1; their working pages already are their queue (Q1).
- **Counts only, no names.** Every tile is a number, sometimes with "oldest since …", and links to the page where the work is done.
- **Freshness:** polling every 60 s while the tab is visible, plus refresh on focus and a manual refresh. No new realtime events.
- **Delivery:** eight small PRs, after this plan (§7). The dead calls go in PR-2, which is the first PR that renders real tiles.

---

## 1. Review: what exists on `main`

All paths are relative to the repository root. SQL lives in `supabase/migrations/`, abbreviated `mig/`. "Count?" says whether a cheap count exists today.

### 1.1 The dead Dashboard and what depends on it

| What | Where | Note |
|---|---|---|
| The page | `apps/admin-web/src/features/dashboard/DashboardPage.tsx:45-48` | Four `useQuery` calls to routes that do not exist. It renders "team now", workload scores, renewals and median first reply by shift: the retired on-duty model. |
| The client | `apps/admin-web/src/core/api/endpoints.ts:249-281` (`DashboardHeader`, `TeamNowRow`, `NeedsActionItem`, `ThisWeek`, `dashboardApi`) | #187 removes `unattended` only. |
| Query keys | `apps/admin-web/src/core/api/queryKeys.ts:38-43` | #187 removes `unattended`. |
| Realtime | `apps/admin-web/src/core/realtime/RealtimeProvider.tsx:80-98` | Handlers for `ownership.changed`, `unattended.changed`, `escalation.created` and `presence.changed` (the last one only refreshes `teamNow`). The server emits none of the first three (`apps/api/src/communication/contracts/events.ts`). |
| Copy | `apps/admin-web/src/core/i18n/messages.ts:133-139, 350-356` | `dashboard.*` keys. |
| Route and nav | `AppRoutes.tsx:128`; `navigation.ts:75,108,123`; `capabilities.ts:88,100` | `/dashboard` is visible to the super admin and managers, under More. |
| The super admin's real dashboard | `apps/admin-web/src/features/admin/DashboardView.tsx:48-49` reads `GET /admin/overview` (`apps/api/src/admin/admin.controller.ts:26-27`, `admin.inspect`) | It works, but holds inventory counts only (accounts, conversations by type, stories). It has nothing that needs action. |

### 1.2 The signals

| # | Signal | Source of truth (file:line) | Existing route · PD-40 key | Scope applied there | Count? |
|---|---|---|---|---|---|
| S1 | **Chats waiting for a staff reply** | `chat.conversation.last_customer_message_at` / `last_staff_message_at`, kept by the trigger `touch_conversation_from_message` (`mig/20260905094000_chat_od01_conversation_reconciliation.sql:109`). The rule is `needsReply()` (`apps/api/src/communication/contracts/dto.ts:393-399`): a parent message after the last staff or teacher message. | `GET /conversations` · `chat.use` (`communication/api/conversation.controller.ts:54`). Only a list, capped at 200 (`conversation.service.ts:1541-1589`), with per-row state. | PD-8: `chat.staff_visible_conversation_ids(staff, at)` (`mig/20261027100000_chat_pd035_department_rooms.sql:221`, `returns setof uuid`), called by `SqlStaffScope.visibleConversationIds` (`apps/api/src/platform/staff-scope.ts:73-75`). | **No.** `chat.staff_workload` (`mig/20261014110100_chat_staff_profile_app_runtime.sql:126-160`) has `awaiting_reply`, but it groups by the legacy `family.owner_id`, **not** PD-8 scope. Do not reuse it. |
| S2 | **Open escalation / supervision cases** (PD-35 B5) | `chat.supervision_case`, status `open`/`in_progress`/`resolved`/`cancelled` (`mig/20261026160007_chat_pd035_supervision_cases.sql:35,48`). Indexes on (owner_id, status), (target_department_id, status) and a partial due index (`:59-62`). | `GET /cases?tab=mine\|opened\|department&status=` · `cases.view` (`apps/api/src/cases/supervision-case.controller.ts:24-25`; service `supervision-case.service.ts:165-194`) | `mine` = cases the caller owns, while `case_owner_fits()` holds; `department` = cases for the department they manage; the super admin sees all. `opened` re-checks every row (`:190`). | **No.** List of up to 200. The indexes support a count. |
| S3 | **Today's lessons and outcomes** | `chat.lesson.outcome`: held, student_apology, teacher_apology, admin_cancelled, student_no_show, teacher_no_show, rescheduled, suspended, voided (`apps/api/src/communication/contracts/vocab.ts:297`). `chat.lesson_category` makes a lesson with no outcome `upcoming` or `unreported` (`mig/20261019100000_chat_pd011_statistics.sql:24`). Index `(organization_id, starts_at)` (`mig/20261026210000_chat_pd038_schedule_calendar.sql:244`). | `GET /calendar?from&to` · `schedule.view` (`apps/api/src/calendar/calendar.controller.ts:33-49`): today's lessons with raw outcomes, but no counts by outcome (`/calendar/stats` counts lessons and minutes only). `GET /stats/teachers?month=` · `reports.view` (`lessons/stats.controller.ts:24-31`): monthly per-teacher counts, no day. | Calendar: academy (super admin, Operations Manager, Teachers department) or the PD-35 strict teacher set (`calendar.service.ts:91`). | **No** day count. |
| S4 | **Lessons waiting for an outcome; late apologies to rule on** | Partial indexes `lesson_open_by_end_idx (organization_id, ends_at) WHERE outcome IS NULL` and `lesson_ruling_open_idx … WHERE decision IS NULL` (`mig/20261018120000_chat_pd011_lessons.sql:92,122`). | `GET /lessons/needs-action` · `lessons.view` (`apps/api/src/lessons/lesson.controller.ts:35-36`; service `lesson.service.ts:342`) | **The Teachers department and the super admin only** (`requireManager`, `lesson.service.ts:1203-1211`), narrowed by `TeacherScopeService.scopeOf` (`apps/api/src/platform/teacher-scope.ts:96`). | **No.** Several `take: 500` lists, filtered in JS. |
| S5 | **Trials awaiting a decision; trials today** | Trial outcome upcoming / awaiting / no_show / subscribed / not_subscribed / cancelled (`apps/api/src/lessons/trial.service.ts:795`, the same rule as SQL). "Awaiting" = started with no outcome, or held without a `trial_outcome` row. | `GET /trials?from&to` · `trials.view` (`trial.service.ts:201`), `take: 1000` | Super admin, Sales and Operations see all trials; the Teachers department sees its scoped teachers. | **No** org-wide count (`chat.teacher_trial_stats`, `mig/20261021130000_chat_trial_booking_students.sql:269`, is per teacher per month). |
| S6 | **New students waiting** (PD-16) | Unassigned = a live `trial_subscription` with no `student_enrolment`. Not set up = no family group yet, or parent sign-up `not_started` / `code_waiting`. | `GET /trials/new-students` · `new_students.view` (`apps/api/src/lessons/trial.controller.ts:85-86`; `apps/api/src/new-students/enrolment.service.ts:65`) | Super admin and Operations Manager: all. Sales: the unassigned. Others: their supervised learners. | **No.** List of up to 500, with an N+1 for wrong sign-up codes (`enrolment.service.ts:97`). |
| S7 | **Prospects without a booked trial** (Sales) | `chat.trial_prospect` with no trial lesson (indexes `trial_prospect_org_idx`, `lesson_prospect_idx`) | `GET /trials/prospects` (`trial.service.ts:101`), with no booked flag | as S5 | **No.** |
| S8 | **Instalments overdue / due** | `chat.family_instalment` (`mig/20261021150000_chat_pd017_parent_student_profiles.sql:149`), open-rows index `(organization_id, due_date)` (`:188`). Status is computed in JS (`statusOf`). | `GET /instalments` · `billing.view` (`apps/api/src/billing/billing.controller.ts:38-39`) | `decideBillingAccess` (`apps/api/src/billing/billing-access.ts:19`): super admin, Operations Manager and Sales get `all`; Operations members get `reach`; Teachers get none. | **Counts exist but are expensive** (`billing.service.ts:225-229`): they come after loading every open instalment in scope, with one `staff_conversation_access` per conversation and, for `reach`, one `staff_reaches_family` per family (`:804`). |
| S9 | **Payment receipts awaiting review** (PD-27) | `chat.payment_receipt` (`mig/20261022170000_chat_pd027_payments.sql:192`), index `(organization_id, status, uploaded_at)` | `GET /payment-receipts?status=pending` · `billing.view` (`apps/api/src/billing/payments.controller.ts:56-57`) | billing access | **Yes, the only cheap count found:** `groupBy` `{pending, approved, rejected}`. |
| S10 | **Locked subscriptions** (PD-30) | `chat.learner_access.state` `open\|grace\|locked`, stored (`mig/20261026140000_chat_pd030_subscription_lock.sql:352-357`). It is refreshed by `chat.refresh_learner_access` (`:499`) in each writer's transaction and by the worker's sweep (`apps/api/src/subscriptions/subscription-effects.service.ts:67,131`). | Per child only: `GET /learners/:id/subscription` · `subscriptions.view` | billing access | **No** list or count. A count is cheap on the stored state. |
| S11 | **Pending teacher leave** | `chat.teacher_leave_request` (`mig/20261019090000_chat_pd012_s1.sql:500`), open index `:537` | `GET /teacher-leave-requests?state=requested` · `teacher_supervision.view` (`apps/api/src/leave/leave.controller.ts:41-42`). `GET /teacher-leave-overview` returns `pendingRequests` per teacher from SQL. | Page scope: `TeacherScopeService.pageRowsOf` (`teacher-scope.ts:177`) | **Almost.** Summing the overview works today. |
| S12 | **Violations awaiting a decision** (absences, lateness) | `chat.teacher_violation`, partial index `teacher_violation_open_idx … WHERE decision IS NULL` (`mig/20261019140000_chat_pd012_s2_discipline.sql:159`) | `GET /discipline/violations?state=open` · `teacher_supervision.view` (`apps/api/src/discipline/discipline.controller.ts:18-19`) | Page scope, plus two JS filters: `standing` (`discipline.service.ts:619`) drops violations whose lesson outcome was corrected, and `visible` (`:588`) applies the Operations child filter. | **No.** A plain SQL count would overcount (§3.6). |
| S13 | **New parent feedback** (PD-32) | `chat.parent_feedback.status` `received\|in_review\|resolved`, index `(organization_id, status, created_at desc)` (`mig/20261026120000_chat_pd032_parent_feedback_signup_code.sql:45,71`) | `GET /parent-feedback` · `teacher_supervision.view` (`apps/api/src/teacher-file/parent-feedback.controller.ts:36-37`) | Page scope plus `pageRowVisible` (`teacher-scope.ts:234`) in JS | **No.** |
| S14 | **Certificate requests; teacher credentials to review** | `chat.learner_certificate` (`mig/20261019090000_chat_pd012_s1.sql:299`, open index `:346`). Teacher Profile V2 credentials (save is the publish; only uploaded credentials are reviewed). | `GET /learner-certificates?state=requested` · `certificates.view` (Teachers department and super admin; N+1 `deliveryGroupFor`). `GET /teacher-profiles/review` · `teacher_profiles.review` (org-wide for family-facing staff, `apps/api/src/platform/authorization.service.ts:1033`). | as stated | **No.** |
| S15 | **Unsupervised teachers** (PD-35) | `chat.teacher_supervisor_assignment` (`mig/20261026160004_chat_pd035_teacher_supervisor.sql:46`) | `GET /org/teacher-assignments` · `org.view` (`apps/api/src/teacher-supervisors/teacher-supervisor.controller.ts:19-21`; service `teacher-supervisor.service.ts:92-123`) | Super admin and Teachers Manager only (`requireAssigner`, `:384`) | **Yes, but from a whole-organization load:** `unassigned` = active teachers with no live Teachers-department supervisor, counted in JS over every teacher. |
| S16 | **Children / families without an Operations supervisor** (PD-8) | `chat.learner_supervision` (`mig/20261015120000_chat_pd008_org_structure.sql:172`) | `GET /org/learners?unassigned=true` · `org.view` (`apps/api/src/org/org-structure.controller.ts:30-31`; service `org-structure.service.ts:140-206`) | Super admin: all. Operations Manager: their department's children **and** the unassigned ones (`:160-168`). | **No.** Per child, `take: 2000`, filtered in JS. There is no family-level figure at all. |
| S17 | **Active hand-overs to a backup (PD-33); backup links (PD-8)** | `chat.supervisor_cover` (`mig/20261026130000_chat_pd033_supervisor_cover.sql:22`, partial index on open covers); `chat.supervisor_backup` (`mig/20261015120000_chat_pd008_org_structure.sql:231`) | `GET /org/covers?active=true` · `org.covers` (`apps/api/src/org/supervisor-cover.controller.ts:23-24`; `active=true` also includes **scheduled** covers, and the status comes from `views()` with an `actsFor` per primary, `:688-690`). Backups appear in `GET /org/structure` · `org.view`. | Super admin: all. Manager: their department. | **No.** |
| S18 | Action log (PD-35 B7) | A UNION over `chat.audit_log` and case events (`apps/api/src/action-log/action-log.service.ts:74-94`) | `GET /staff/:id/action-log` · `@SelfService` | One person at a time | Not a Dashboard signal: it is history, not something waiting. It is **not used** (§2.4). |

### 1.3 What else the review found

1. **"Today" has two configuration keys.** Stats, the calendar and scheduling read `stats.zone` (`apps/api/src/lessons/stats.service.ts:437`, `calendar.service.ts:136`; default in `apps/api/src/platform/app-config.service.ts:129`). `academyZone()` reads `schedule.timezone` (`apps/api/src/platform/time-zone.service.ts:93`). They agree only because both default to `Africa/Cairo`. The Dashboard uses **the calendar's zone** (`CalendarService.zone()`), so "today's lessons" always equals what `/schedule` shows for today. Unifying the two keys is a separate follow-up.
2. **The Admin Web does not read `/me`'s permission keys yet.** The API returns them (`apps/api/src/platform/auth/auth.controller.ts:147-154`; `auth.dto.ts:23`), but no Admin Web code reads them. PR-2 adds the field to the session type. The PD-40 page registry (`apps/admin-web/src/core/permissions/pages.ts`, PD-40 plan §4) is not on `main`. If it lands first, the Dashboard registers there instead.
3. **The `/tasks` page is dead too.** `endpoints.ts:235,244` call `/tasks`, and no controller serves it. This is out of scope here, listed as a follow-up (§9).
4. Already handled by others, not repeated here: `reports.view` for Teachers-department members (PD-40 #186); Operations access to the Teacher Supervision page (PD-26 #175).

---

## 2. Design principles

1. **A tile equals its page.** A number that disagrees with the page it opens is worse than no number. Every count is a method on the **service that owns the page's list**. It uses the same scope helper and the same predicate, and a parity test pins count = list length for every seeded persona (§6.2).
2. **Every tile links to the page that resolves it.** That page must exist and be offered to the person, or the tile is not shown. The rule from the old page (`DashboardPage.tsx:12-16`, "a dashboard that only shows numbers is rejected") stays.
3. **Counts, never names.** A tile carries a count, optionally an "oldest since" time, and a `capped` flag. It never lists people. The Dashboard then exposes nothing the linked page does not already show to the same person, and needs no PII rules of its own.
4. **Absent is not zero.** A tile the person's department or scope does not cover is **omitted** by the server. A tile that is covered and empty is `0`. A tile that failed is an error. The client shows these three differently (§5.2).
5. **Bounded cost.** Each section runs a fixed number of SQL statements, independent of the number of rows. That means one statement per tile or one grouped statement per section, and never a per-row function call in a loop. Where the page's own predicate lives in JS (S12), the count reuses the page's bounded list and says `capped` at its limit, rather than re-implementing the predicate.
6. **Measure only what exists.** No response-time targets, workload scores, "team now" presence or trends. Nothing on `main` measures them correctly under PD-8 (§2.4).

### 2.1 Why no `dashboard.view` key

The PD-40 plan lists `dashboard` among pages that may get `<page>.view`. This plan recommends against it for v1 (Q8):

- The Dashboard holds no data of its own; every figure belongs to another page.
- A `dashboard.view` key would be a second gate to the same data. Granting it must never reveal billing counts to someone without `billing.view`, so each section would need its source key anyway.
- Its only effect would be one more key to delegate wrongly.

So each section endpoint `@Requires` its **source page's** key. The page is offered when the person holds the key of at least one section. Adding a catalogue row would also need a migration row (`chat.permission` and `chat.legacy_permission_bundle`, `mig/20261027190000_chat_pd040_access_roles.sql:110`), which means a slot. Not adding one keeps this work migration-free.

### 2.2 Why per-section endpoints, not one `/dashboard/summary`

- Each section has its own PD-40 key, so the guard checks the right one.
- A slow or failing section cannot blank the others.
- Each PR adds one endpoint with its tests, so the work splits cleanly.

The cost is up to seven small requests per refresh. With four or five people on the Dashboard at most, that is negligible.

### 2.3 Polling, not realtime

- Each section uses `refetchInterval: 60_000` and refetches on window focus (the app default, `apps/admin-web/src/app/queryClient.ts:9-12`). TanStack Query does not refetch a hidden tab.
- A Refresh action shows "updated at …", reusing `RefreshAction` from `features/admin/common`.
- Sixty seconds matches the Chat list's own poll (`features/chat/ChatPage.tsx:76`).

Realtime is rejected for v1:

- These counts change through dozens of write paths: messages, outcomes, payments, the lock sweep, assignments. There is no single event.
- Outbox events go to conversation and actor rooms that a manager is not subscribed to. Adding a manager fan-out would be a new realtime surface with its own authorization (RT-009) for a figure that is fine one minute late.

One cheap improvement is allowed in PR-2: on `message.created`, which the client already receives for conversations it is subscribed to, the client invalidates the Chats section.

### 2.4 Deliberately left out

| Left out | Why |
|---|---|
| "Team now", presence, workload scores, inactivity warnings | This is the on-duty model that PD-8, PD-33 and PD-35 replaced. Presence (PD-37, `GET /presence`, `chat.use`) shows who is online, not who is behind. |
| Median first reply, response-target compliance | No stored measure. The conversation row keeps only the latest customer and staff times, so history cannot be rebuilt. |
| `staff_workload.awaiting_reply` | It groups by `family.owner_id`, which grants no scope since PD-8 (§1.2, S1). |
| Action log feed | History, not a queue. It is one person at a time by design. |
| Renewal requests (`GET /subscriptions/renewal-requests`) | Candidate for v2, once the owner says renewals are a manager queue and not a supervisor one. |

---

## 3. The endpoints

All of them are `GET`, read-only, and live in a new `apps/api/src/dashboard/` module (controller only). Each one calls a **count method added to the owning service**, so the scope code is never copied. Every response has this shape:

```jsonc
{
  "generatedAt": "2026-10-28T09:00:00.000Z",
  "zone": "Africa/Cairo",          // only on sections that say "today"
  "tiles": [
    { "key": "chats.waiting", "count": 7, "oldestAt": "2026-10-28T05:12:00.000Z", "capped": false }
  ]
}
```

A tile the caller's basis does not cover is **absent** from `tiles`. If no tile applies, the endpoint returns `tiles: []`, not 403. The Admin Web hides an empty section. A request with no basis at all (for example a parent) is refused exactly as the source page refuses it.

"Today" is `[start, end)` of today's local date in `CalendarService.zone()` (§1.3). It is computed once per request in SQL, with `AT TIME ZONE`.

### 3.1 `GET /dashboard/chats` · `@Requires('chat.use')`

| Tile | Predicate | Scope |
|---|---|---|
| `chats.waiting` (count + `oldestAt`) | `archived_at IS NULL AND resolved_at IS NULL AND last_customer_message_at IS NOT NULL AND (last_staff_message_at IS NULL OR last_customer_message_at > last_staff_message_at)`. This is exactly `needsReply()` (`dto.ts:393-399`), with archived and resolved conversations excluded as the chat list excludes them. | `c.id IN (SELECT chat.staff_visible_conversation_ids($actor, now()))`: PD-8 for the super admin (whole organization), managers (their department's members), active backups and covers. |

- **Cost:** one statement. It costs the same as one Chat-list refresh, which already evaluates `staff_visible_conversation_ids` per candidate (ORG-SCOPE-PD8 §7 flags that for index review at production scale; the Dashboard adds no new risk).
- **Sales:** PD-8 gives the Sales manager no family conversations, so the tile is normally `0`. It is still shown, because "nothing waiting" is true.
- **Lives in:** `ConversationService.countWaitingForActor`, beside `listForActor`.
- **Link:** `/chat?view=waiting`. PR-2 adds a "Waiting for a reply" filter to the Chat list (client-side over the existing list state `waiting_on_jawwid`). The tile says `capped` when the count exceeds the list's 200 cap, and the page says "showing the 200 most recent".

### 3.2 `GET /dashboard/cases` · `@Requires('cases.view')`

| Tile | Predicate | Scope (same as `SupervisionCaseService.list`, `supervision-case.service.ts:165-194`) |
|---|---|---|
| `cases.department_open` | status in (`open`, `in_progress`) | `department` tab: target department the caller manages; super admin: all |
| `cases.mine_open` | same, owned by the caller | `mine` tab, `case_owner_fits()` in SQL |
| `cases.overdue` | open or in progress, with `due_at < now()` | union of the two above |

- **Cost:** three indexed counts, one statement with `FILTER`. The `opened` tab is not counted, because its per-row `canSee` cannot be bounded.
- **Lives in:** `SupervisionCaseService.counts`.
- **Link:** `/cases?tab=department` and `/cases?tab=mine`. PR-1 makes the tab a URL parameter (`apps/admin-web/src/features/cases/CasesPage.tsx:35` keeps it in state today), and `/teachers/cases` for the Teachers department.

### 3.3 `GET /dashboard/lessons` · `@Requires('lessons.view', 'schedule.view')`

| Tile | Predicate | Who |
|---|---|---|
| `lessons.today` broken down by `held`, `upcoming`, `unreported`, `student_no_show`, `teacher_no_show`, `cancelled` (= student_apology + teacher_apology + admin_cancelled) | Lessons starting today, excluding voided, rescheduled and suspended (as `teacher_lesson_stats` does, `mig/20261021120000_chat_pd015_student_journey.sql:649`). Uses `chat.lesson_category` for no-outcome rows. | Calendar scope (`calendar.service.ts:91`): academy for the super admin, the Operations Manager and the Teachers department; the PD-35 strict teacher set for a strict-scope teacher supervisor. |
| `lessons.needs_outcome` | outcome NULL and `ends_at <= now()` (`lesson_open_by_end_idx`) | **Teachers department and super admin only** (`requireManager`), narrowed by `scopeOf` |
| `lessons.rulings_open` | `lesson_ruling.decision IS NULL` (`lesson_ruling_open_idx`) | same |

- **Cost:** one grouped statement for today on `(organization_id, starts_at)`, plus two partial-index counts. Teacher scope is applied as `teacher_id = ANY($ids)` when strict, never as a filter in JS.
- **Lives in:** `CalendarService.todayCounts` and `LessonService.needsActionCounts`.
- **Links:**
  - the breakdown goes to `/schedule` (today is the page's default view; PR-3 confirms it, or adds `?date=`);
  - the other two go to `/teachers/needs-action`.

### 3.4 `GET /dashboard/enrolment` · `@Requires('trials.view', 'new_students.view')`

| Tile | Predicate | Who |
|---|---|---|
| `trials.today` | trial lessons starting today, not cancelled | trial scope (`trial.service.ts:201`) |
| `trials.awaiting` | trial outcome `awaiting` (the SQL rule behind `trial.service.ts:795`) | same |
| `prospects.unbooked` | `trial_prospect` with no non-cancelled trial lesson | Sales and the super admin (the trial desk) |
| `new_students.unassigned` | live `trial_subscription`, no `student_enrolment` | `new_students.view` holders, as `EnrolmentService` decides visibility (`enrolment.service.ts:65`) |
| `new_students.not_set_up` | enrolled, but no family group or parent sign-up not done | Super admin and Operations Manager (Sales sees unassigned only) |

- **Cost:** five counts in one statement. The per-account wrong-code lookup (`enrolment.service.ts:97`) is not needed for a count and is not called.
- **Keys:** `trials.*` tiles need `trials.view` and `new_students.*` tiles need `new_students.view`. The service checks the request's resolved keys (`request.permissions`, set by `PermissionGuard`).
- **Lives in:** `TrialService.counts` and `EnrolmentService.counts`.
- **Links:** `/trials` and `/trials/new-students`. For `prospects.unbooked`, PR-4 adds a "not booked" filter to the prospects list.

### 3.5 `GET /dashboard/billing` · `@Requires('billing.view')`

| Tile | Predicate | Who |
|---|---|---|
| `instalments.overdue` · `instalments.due` · `instalments.unassigned` | The SQL form of `statusOf` (`billing.service.ts`), on the open-rows index `(organization_id, due_date)` | `decideBillingAccess` = `all`: super admin, Operations Manager, Sales |
| `receipts.pending` | `payment_receipt.status = 'pending'` | same; reuses the existing `groupBy` (`payments.service.ts:401`) |
| `learners.locked` · `learners.grace` | `learner_access.state` | same, **and** the caller holds `subscriptions.view` |

- **Cost:** one statement for instalments and one for receipts and access states together.
- **`reach` callers:** an Operations supervisor would hit the per-family `staff_reaches_family` loop (`billing.service.ts:804`). Supervisors are not in v1 (Q1). If they are added later, this section gets a set-based reach query first.
- **Stored lock state can lag** the live value until the next refresh or sweep. This matches what the parent's app enforces (the stored row), so the tile states the same truth.
- **Lives in:** `BillingService.counts` and `PaymentsService.counts`.
- **Links:**
  - `/instalments?status=overdue`: PR-5 adds the parameter;
  - `/payments`: the receipts tab is the default (`PaymentsPage.tsx:40-41`);
  - locked and grace: **no page lists locked children today.** PR-5 adds a "Locked / grace" filter to the Parents page (`/parents?access=locked`; `apps/admin-web/src/features/profiles/ParentsPage.tsx` already reads search params), each row opening the student profile where payments and exceptions are recorded (Q5).

### 3.6 `GET /dashboard/teachers` · `@Requires('teacher_supervision.view')`

| Tile | Predicate | Scope |
|---|---|---|
| `leave.pending` | `teacher_leave_request` state `requested` (open index) | `TeacherScopeService.pageRowsOf` (`teacher-scope.ts:177`) |
| `violations.open` | `DisciplineService.list({ state: 'open' })` **length**, including `standing()` and `visible()` | same; `capped` at the list's 500 |
| `feedback.new` · `feedback.in_review` | `parent_feedback.status` | same, with `pageRowVisible` (`teacher-scope.ts:234`) |
| `certificates.requested` | `learner_certificate` state `requested` | `certificates.view` holders only (Teachers department and super admin) |
| `credentials.pending` | pending uploaded teacher credentials | `teacher_profiles.review` holders |

- **Why `violations.open` reuses the list:** `standing()` decides from corrected lesson outcomes and `visible()` from the Operations child filter. Both run in JS (`discipline.service.ts:588,619`), so a separate SQL count would drift. The list is bounded at 500 and served by `teacher_violation_open_idx`. Moving `standing()` into SQL is a follow-up, not a Dashboard prerequisite.
- **Operations manager:** for v1 this section is served on the **Teachers-department basis and to the super admin only**. The Operations basis (teachers of their own families) follows when PD-26 #175 has landed and been QA'd (Q6).
- **Lives in:** `LeaveService.counts`, `DisciplineService.openCount`, `ParentFeedbackService.counts`, `CertificateService.counts` and `TeacherProfileService.pendingCount`.
- **Links:** `/teachers/supervision?section=leave|absences|feedback` (sections in `TeacherSupervisionPage.tsx:26,45`), `/teachers/certificates` and `/teacher-profiles`.

### 3.7 `GET /dashboard/structure` · `@Requires('org.manage')`

| Tile | Predicate | Who |
|---|---|---|
| `learners.unsupervised` | active learner with no live `learner_supervision` row | Operations Manager and super admin (the ones who see the unassigned, `org-structure.service.ts:160-168`) |
| `families.without_supervisor` | family with at least one such learner (Q4) | same |
| `teachers.unsupervised` | active teacher with no live Teachers-department supervisor: **the SQL of `teacher-supervisor.service.ts:92-107`**, counted in SQL instead of over the whole list | Teachers Manager and super admin (`requireAssigner`) |
| `covers.active` | `supervisor_cover` open **and** started (excluding scheduled; the status rule of `supervisor-cover.service.ts:690`, in SQL) | the caller's department; super admin: all |
| `backups.expiring` | active backup link whose `until` falls within 7 days | same |

- **Cost:** one statement. `org.manage` is held by department managers and the super admin only (`legacy-bundles.ts:66`), which is exactly this section's audience.
- **Lives in:** `OrgStructureService.counts`, `TeacherSupervisorService.unassignedCount` and `SupervisorCoverService.counts`.
- **Links:** `/organization?tab=children&unassigned=1` and `/organization?tab=teachers`. PR-7 makes the tab (`OrganizationPage.tsx:20,37`) and the filter URL parameters. The covers and backups tiles link to `/organization?tab=structure`.

### 3.8 Which sections each role gets

From the legacy bundles (`legacy-bundles.ts`) and the service bases above.

| Section | Super admin | Operations Manager | Teachers Manager | Sales Manager |
|---|---|---|---|---|
| Chats | all organization | department | department (supervision channels) | usually 0 |
| Cases | all | department + mine | department + mine | — (no `cases.view`) |
| Lessons | today + outcome queue | today | today + outcome queue | — |
| Enrolment | all tiles | trials, new students (unassigned + not set up) | trials | trials, prospects, new students (unassigned) |
| Billing | all tiles | all tiles | — (no `billing.view`) | instalments, receipts, locked / grace |
| Teachers | all tiles | — in v1 (Q6) | all tiles | — |
| Structure | all tiles | unsupervised children / families, covers, backups | unsupervised teachers, covers, backups | covers, backups |

**Supervisors (not in v1, Q1).** Each supervisor's working pages already are their queue:

- the Chat list with unread counts;
- `/cases` → Mine;
- `/teachers/needs-action` for Teachers supervisors;
- New students, filtered to their learners.

Every endpoint above is already scoped for a supervisor, so adding them later is a nav change plus the set-based billing reach (§3.5). It is not a redesign.

---

## 4. Admin Web

### 4.1 Where it lives

- **Managers:** `/dashboard`, the same URL, rebuilt (`features/dashboard/`). It moves from More to a top-level nav item. Chat stays the landing page (Q2).
- **Super admin:** the Admin Portal's **Dashboard section** (`/admin/dashboard`, `DashboardView.tsx`). It gains the same sections **above** the existing inventory counts, which stay. `/dashboard` redirects the super admin there, so there is one Dashboard per person (Q7).
- **The UI:** one shared component, `ManagerDashboard`, with one `Section` per endpoint and one `Tile` per tile key. It is driven by a small registry: tile key → Arabic/English label, link builder, and which number is the alert.

### 4.2 Layout

- Sections appear in the order of §3.8, and only when the person holds the section's key (from `/me`) **and** the server returned at least one tile.
- Each tile is a link with a large number and a label. Under the label it shows "oldest since …" where present, or `500+` when `capped`.
- A tile is in the alert style when it is above zero **and** it is a backlog: waiting chats, overdue cases, lessons without an outcome, overdue instalments, locked children, unsupervised children or teachers. Informational counts (lessons today, trials today) are never in the alert style.
- At phone width the tiles wrap two per row. The layout is RTL-correct (logical properties, as the existing CSS does).

### 4.3 Empty and error states

| State | What the person sees |
|---|---|
| First load | Skeleton tiles per section (`shared/components/Skeleton`) |
| Tile = 0 | The number `٠` with a calm check, and the label. Never hidden: "nothing waiting" is information. |
| A whole section all zero | The section collapses to one line: "لا شيء ينتظر في هذا القسم" / "Nothing waiting in this section". |
| Tile absent (not in the person's basis) | Not rendered. Never shown as zero. |
| Section request failed | That section only shows "تعذّر تحميل هذا القسم" / "This section could not be loaded" with **Retry**. The other sections are unaffected, and a failed figure never shows as zero. |
| Refetch failed after a good load | The figures stay with the existing stale banner pattern (`DashboardView.tsx`: "shown from {time}"), never silently as current. |
| 403 on a section | The section is hidden. The person lost the key; `/me` is refetched. |
| No section at all | The page shows "لا توجد أرقام متاحة لحسابك بعد" / "No figures are available for your account yet". This should not happen for a manager, and a test asserts it does not. |

### 4.4 Copy (Arabic first)

Arabic is the primary string. Numbers go through the existing `number()` (Arabic-Indic digits in Arabic). Times go through `relativeTime`.

| Key | العربية | English |
|---|---|---|
| page title | لوحة المتابعة | Dashboard |
| page subtitle | ما ينتظر فريقك الآن | What is waiting for your team now |
| `chats.waiting` | محادثات تنتظر ردّنا | Chats waiting for our reply |
| oldest | أقدمها منذ {time} | Oldest {time} |
| `cases.department_open` | حالات مفتوحة في القسم | Open cases in the department |
| `cases.mine_open` | حالات مسندة إليّ | Cases assigned to me |
| `cases.overdue` | حالات تجاوزت موعدها | Cases past their due date |
| `lessons.today` | حصص اليوم | Today's lessons |
| held / upcoming / unreported | تمّت / قادمة / بلا نتيجة | Held / Upcoming / No outcome yet |
| student / teacher no-show | غياب الطالب / غياب المعلّم | Student absent / Teacher absent |
| cancelled | أُلغيت | Cancelled |
| `lessons.needs_outcome` | حصص تنتظر تسجيل النتيجة | Lessons waiting for an outcome |
| `lessons.rulings_open` | اعتذارات متأخرة تنتظر قرارًا | Late apologies to rule on |
| `trials.today` | حصص تجريبية اليوم | Trial lessons today |
| `trials.awaiting` | حصص تجريبية تنتظر القرار | Trial lessons awaiting a decision |
| `prospects.unbooked` | مهتمّون لم تُحجز لهم حصة | Prospects without a booked trial |
| `new_students.unassigned` | طلاب جدد لم يُعيَّنوا بعد | New students not yet assigned |
| `new_students.not_set_up` | طلاب جدد لم يكتمل إعدادهم | New students not yet set up |
| `instalments.overdue` | أقساط متأخرة | Overdue instalments |
| `instalments.due` | أقساط مستحقة الآن | Instalments due now |
| `instalments.unassigned` | أقساط بلا مشرف مسؤول | Instalments with no responsible supervisor |
| `receipts.pending` | إيصالات تنتظر المراجعة | Receipts awaiting review |
| `learners.locked` | طلاب اشتراكهم موقوف | Students with a locked subscription |
| `learners.grace` | طلاب في فترة السماح | Students in the grace period |
| `leave.pending` | طلبات إجازة تنتظر القرار | Leave requests awaiting a decision |
| `violations.open` | مخالفات تنتظر القرار | Violations awaiting a decision |
| `feedback.new` / `feedback.in_review` | ملاحظات جديدة من أولياء الأمور / قيد المراجعة | New parent feedback / In review |
| `certificates.requested` | طلبات شهادات للطلاب | Student certificate requests |
| `credentials.pending` | شهادات معلّمين تنتظر المراجعة | Teacher credentials awaiting review |
| `learners.unsupervised` | طلاب بلا مشرف | Students without a supervisor |
| `families.without_supervisor` | أسر فيها طالب بلا مشرف | Families with a student without a supervisor |
| `teachers.unsupervised` | معلّمون بلا مشرف | Teachers without a supervisor |
| `covers.active` | تسليمات سارية إلى البديل | Active hand-overs to a backup |
| `backups.expiring` | بدلاء ينتهي تفعيلهم خلال ٧ أيام | Backups ending within 7 days |
| refresh / updated | تحديث / آخر تحديث {time} | Refresh / Updated {time} |
| capped | أكثر من {n} | More than {n} |

The copy lives in the feature's own `copy.ts`, as `features/admin/copy.ts` does, not in the shared `messages.ts`. PR-2 deletes the old `dashboard.*` keys from `messages.ts`.

### 4.5 Removing the dead calls (PR-2, after #187)

Delete:

- `dashboardApi`, `DashboardHeader`, `TeamNowRow`, `NeedsActionItem` and `ThisWeek` (`endpoints.ts:249-281`);
- the query keys `dashboardHeader`, `teamNow`, `needsAction`, `thisWeek` and `dashboardAll` (`queryKeys.ts:38-43`);
- the realtime handlers for `ownership.changed`, `unattended.changed` and `escalation.created`, and the `teamNow` refresh on `presence.changed` (`RealtimeProvider.tsx:80-98` on `main`), together with their tests in `realtime.test.tsx` that #187 rewrote;
- the `dashboard.*` copy keys;
- `WorkloadBadge`, if nothing else uses it after #187.

Two new tests pin the result:

- a client test asserts that no request to `/dashboard/header`, `/dashboard/team-now`, `/dashboard/needs-action` or `/dashboard/this-week` is ever made;
- a grep-style test asserts those four strings appear nowhere in `apps/admin-web/src`.

---

## 5. Permissions and scope (summary)

| Endpoint | PD-40 key (`@Requires`) | Layer 2 (unchanged rules, reused) |
|---|---|---|
| `/dashboard/chats` | `chat.use` | `staff_visible_conversation_ids` (PD-8 / PD-33 / PD-35 rooms) |
| `/dashboard/cases` | `cases.view` | `SupervisionCaseService` tab rules, `case_owner_fits` |
| `/dashboard/lessons` | `lessons.view` \| `schedule.view` | calendar scope; `requireManager` + `scopeOf` for the outcome queue |
| `/dashboard/enrolment` | `trials.view` \| `new_students.view` | trial scope; `EnrolmentService` visibility; per-tile key check |
| `/dashboard/billing` | `billing.view` (+ `subscriptions.view` per tile) | `decideBillingAccess` |
| `/dashboard/teachers` | `teacher_supervision.view` (+ `certificates.view`, `teacher_profiles.review` per tile) | `pageRowsOf` / `pageRowVisible`; Teachers basis only in v1 |
| `/dashboard/structure` | `org.manage` | `OrgStructureService`, `requireAssigner`, cover rules |

- Every route is declared, so `pd040-route-permissions.spec.ts` passes. The generated table `docs/security/pd040-route-permissions.md` gains seven rows. No catalogue, bundle or migration change.
- All queries are organization-bound (`organization_id = actor.organizationId`) **in addition to** the scope helper. A cross-tenant spec asserts another organization's rows never count.

---

## 6. Tests and cost

### 6.1 Per PR

- **API unit:** the SQL predicates' JS twins where a JS rule exists. Examples: the `needsReply` table; `statusOf` against the SQL `CASE` on fixture dates around midnight in the academy zone; trial `awaiting`.
- **API integration (CI):** one parity spec per section, `dashboard-<section>.spec.ts`. For each seeded persona (super admin, each manager, an out-of-scope supervisor, another organization's manager), each tile's count must **equal** the length of the linked list endpoint for the same actor, the same filter and the same instant. Plus: absent vs zero, and a cross-tenant zero.
- **Query count:** each section spec counts Prisma `query` events for one request and asserts a fixed ceiling (for example ≤ 3), independent of the number of seeded rows. This is the N+1 guard: the spec seeds 1 row and then 50, and the count must not change.
- **Admin Web (vitest):** per section, cover:
  - loading;
  - zero;
  - absent;
  - error with Retry that leaves other sections intact;
  - stale banner;
  - hidden without the key;
  - each tile's link target;
  - Arabic is the default copy, with RTL rendering.
- **Guards:** `scripts/qa/guards.sh` on the committed tree, every PR.

### 6.2 Cost at today's scale

There are at most about five people on the Dashboard: four managers and the super admin. That is seven requests every 60 s each, about one request every 2 s across the academy. Each request runs a fixed number of index-served counts. The only non-trivial one is `staff_visible_conversation_ids`, which the Chat list already runs at the same cadence.

### 6.3 What is reused, not rebuilt

No new table, view, trigger or SQL function. Each count is a SQL statement inside the owning service, beside the list it mirrors.

### 6.4 Indexes a reviewer may ask for (would need a slot)

- A partial index on `chat.conversation (organization_id) WHERE archived_at IS NULL AND resolved_at IS NULL AND last_customer_message_at IS NOT NULL`, if `EXPLAIN` on the system-test stack shows the waiting count scanning.
- `chat.learner_access (organization_id, state)`. Today only `family_id` is indexed, and a scan of one row per learner is fine at academy scale.

Neither is planned. If PR review asks for one, the department head assigns the slot then.

---

## 7. PR breakdown

Each PR is small, carries its tests, and is merged by hand after green CI. At most two run at once.

| PR | Contents | Depends on |
|---|---|---|
| **PR-0** | This plan and the PD-44 claim (docs only) | — |
| **PR-1** | API: `dashboard` module; `/dashboard/chats` and `/dashboard/cases` with the parity and query-count specs. Admin Web: `/cases?tab=` as a URL parameter. | PR-0 approved |
| **PR-2** | Admin Web: `ManagerDashboard` shell, registry, states and copy; the Chats and Cases sections; the Chat list's "Waiting for a reply" filter; **removal of the four dead calls** (§4.5); nav entry; reading `/me` permissions | PR-1, #187 merged |
| **PR-3** | `/dashboard/lessons` and its section | PR-2 |
| **PR-4** | `/dashboard/enrolment` and its section, plus the prospects "not booked" filter | PR-2 |
| **PR-5** | `/dashboard/billing` and its section, plus `/instalments?status=` and the Parents "Locked / grace" filter | PR-2 |
| **PR-6** | `/dashboard/teachers` and its section (Teachers basis) | PR-2 |
| **PR-7** | `/dashboard/structure` and its section, plus `/organization?tab=&unassigned=` | PR-2 |
| **PR-8** | The super admin: the sections in the Admin Portal Dashboard section; `/dashboard` redirects the super admin there | PR-3 … PR-7 |

PR-3 to PR-7 are independent of each other once PR-2 is in. The order above is a recommendation: what a manager acts on most, first.

---

## 8. Owner questions

Each question has a recommendation. The plan is written as if the recommendation is accepted.

| # | Question | Recommendation | Why |
|---|---|---|---|
| Q1 | Who gets a Dashboard in v1? | **The super admin and the three managers.** Supervisors later. | A supervisor's working pages already are their queue (Chat unread, Cases → Mine, Needs action). The endpoints are scoped for supervisors, so adding them later is a nav change plus the billing reach query. |
| Q2 | Should the Dashboard become the managers' landing page? | **No. Chat stays home; the Dashboard moves from More to the main navigation.** | Managers answer families and teams first. The Dashboard is a glance. Making it home would add a click before every conversation. |
| Q3 | When does a chat count as "waiting"? From the parent's first unanswered message, or only after a delay (for example 30 minutes, or working hours)? | **From the first unanswered message, showing how long the oldest has waited.** No threshold in v1. | No response-time target is configured or measured anywhere on `main`. "Oldest since …" lets the manager judge urgency without a rule we would have to invent. |
| Q4 | "Families without an Operations supervisor": a family where **any** child has no supervisor, or **every** child? | **Any child.** The tile shows families and children. | PD-8 assigns each child, not each family. A family with one unsupervised child already has a child nobody below the super admin can reach (`COMM.LEARNER_UNSUPERVISED`). |
| Q5 | Where does a manager resolve a locked subscription? | **A "Locked / grace" filter on the Parents page,** each row opening the student profile. | No page lists locked children today, and the student profile is where payments and exceptions are recorded (PD-17, PD-30). |
| Q6 | Should the Operations Manager see Teacher Supervision figures (feedback and violations about their families' teachers)? | **Not in v1. Add once PD-26 #175 (Operations access) has landed and been QA'd.** | Its scope rule is still awaiting review. A count must not go live before the page it mirrors does. |
| Q7 | The super admin: the same Dashboard, or a separate one? | **The same sections, inside the Admin Portal's Dashboard section, above the existing inventory.** `/dashboard` redirects there. | One Dashboard per person. The inventory counts stay where the super admin already reads them. |
| Q8 | Should the Dashboard get its own PD-40 permission key (`dashboard.view`)? | **No. Each section requires its source page's key.** | A dashboard key would be a second gate to the same data and a delegation hazard. Not adding one also keeps this work free of any migration (§2.1). |
| Q9 | Counts only, or also names (for example "the 5 longest-waiting families")? | **Counts only in v1, with "oldest since".** | Names would make the Dashboard a second list page with its own PII rules. The tile's link goes to the list that already has them. |

---

## 9. Out of scope and follow-ups

- **`/tasks` is dead too.** The Tasks page calls `/tasks`, and no API serves it (§1.3). It needs the same "remove or rebuild" decision as the Inbox.
- Unify `stats.zone` and `schedule.timezone` into one academy-zone key (§1.3).
- Move `DisciplineService.standing()` into SQL, so `violations.open` becomes a true count with no cap.
- Retire `chat.staff_workload` / `organization_workload_totals` (owner-based, pre-PD-8), or redefine them on PD-8 scope. The Staff Profiles directory still shows them.
- Renewal requests as a tile (§2.4), once the owner places renewals in a manager's queue.
