# Admin Web visual review, 2026-11-21

Browser-based review of Admin Web after the navigation redesign (#616-#620), the Students page (#621) and the
Sales pipeline PD-59 (#622). No product code was changed.

## 1. Environment

| Item | Value |
|---|---|
| Commit | `origin/main` 615e56db (branch `claude/admin-web-visual-review`) |
| Database | own `postgres:17` container, all migrations applied with `scripts/db/apply.sh` ("migrations up to date") |
| API | `apps/api` built with `npm run build`, run locally with `SUBSCRIPTION_LOCK_ENFORCED=false`, a local Redis container, throwaway random secrets (never printed or committed) |
| Admin Web | `vite` dev server, `VITE_API_BASE_URL` pointing at the local API |
| Browser | Playwright (`playwright-core`) driving headless Chromium, 1440x900 desktop viewport, UI in Arabic (the default; the English toggle did not change rail labels in the capture, see section 8) |
| Data | synthetic only. One organization; super admin bootstrapped with `bootstrap-super-admin`; every other account created through `POST /admin/staff-accounts`, departments through `POST /org/departments`, passwords through the first-login code flow. Three teachers (SQL), 9 leads, 5 trials, 1 family enrolled by Operations (see below) |
| Screenshots | 460 PNG in `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/shots/` (not in git). Names are `<role>__<page>.png`. Contact sheets (12 pages per image) in `.../scratchpad/sheets/` |

Accounts (all `@example.test`): `super`, `salesmgr` (Sales department manager), `repa` and `repb` (Sales
department members, tier `admin`, "supervisor" position), `opsmgr` (Operations manager), `opssup` (Operations
supervisor), `teachmgr` (Teachers manager), `teachsup` (Teachers supervisor). Two extra Sales *specialist*
accounts were created; the API refuses to put a specialist in a department's member list, so they cannot hold
Sales pipeline access (see "Not checked").

Seed: leads A1-A4 owned by rep A, B1-B3 owned by rep B, U1-U2 unowned (created by Operations through
`POST /trials/prospects`). Trials: A1 and B2 upcoming; A2 subscribed (then enrolled by Operations as family
"Parent A2"); A3 no-show; B1 not subscribed (reason price). Past trials were produced by moving booked lessons
40 days back in SQL, then recording the outcome through the API.

How captured: one browser context per account, sign in through the real login form, then `goto` each of 55 URLs
(the legacy URL list from `Navigation.test.tsx` plus the destinations of the redesign and a non-existent URL),
1.3 s settle, screenshot, and record: final path, whether `.state--forbidden` is present, API responses >= 400.
The rail structure was read from the DOM (`nav.rail`).

The capture was interrupted twice by the machine (the second Sales interaction run was killed, exit 137, and the
local servers and Playwright's browser cache were gone afterwards). Per the coordinator's instruction nothing was
recaptured. Consequence: drawer and create-dialog screenshots exist only for `repa`
(`repa__pipeline_drawer.png`, `repa__pipeline_create_dialog.png`, `repa__pipeline_create_filled.png`); the
create-lead submit and the post-create list were **not** captured. Screenshots were analysed through contact
sheets (4x3 per image) and full-size reads. Contact sheets actually read: all 5 of `super`, all 5 of `repa`,
sheet 5 of `teachmgr` and `opsmgr`, sheet 3 of `teachsup`. Full-size reads: `super__payments`, `repa__accounts`,
`repa__pipeline_drawer`, `repb__trials_new_students`, `repb__pipeline_list`, `teachsup__sales_pipeline`,
`opsmgr__sales_pipeline`, `salesmgr__pipeline_list`. The remaining screenshots (e.g. most of `salesmgr`, `repb`,
`opssup` pages, other pages of `teachmgr`, `teachsup`, `opsmgr`) were NOT opened as images; their matrix cells
come from the automated DOM and API-status capture only. Small text on contact sheets is not legible, so
text-level claims come from the DOM dump and the full-size reads.

## 2. Access matrix (observed against the code's rules)

Legend: OK = page renders with data; FRAME = the Forbidden frame ("you do not have access", Go to start) replaces
the page; INLINE = the page title and tabs render, with a "no access" card or an empty state in the body (API
returned 403); n/a = not applicable. "Expected" comes from `navigation-architecture.md`, the legacy permission
bundles (`apps/api/src/platform/permissions/legacy-bundles.ts`) and `Navigation.test.tsx`.

| URL | super | salesmgr | repa / repb | opsmgr | opssup | teachmgr | teachsup |
|---|---|---|---|---|---|---|---|
| `/chat` | OK | OK | OK | OK | OK | OK | OK |
| `/admin/conversations` | OK | FRAME | FRAME | FRAME | FRAME | FRAME | FRAME |
| `/moderation` | OK | OK | FRAME | OK | FRAME | OK | FRAME |
| `/dashboard` | redirects to `/admin/dashboard` | OK | FRAME | OK | FRAME | OK | FRAME |
| `/admin/dashboard`, `/admin/tasks`, `/admin/users`, `/admin/teachers`, `/admin/teams`, `/admin/parents`, `/admin/payments`, `/admin/instalments`, `/admin/stories`, `/admin/calls`, `/admin/whatsapp`, `/admin/notifications`, `/admin/reports`, `/admin/audit`, `/admin/settings`, `/admin/teacher-attendance`, `/admin/teacher-grants` | OK (settings, audit, whatsapp, notifications show "in development") | FRAME | FRAME | FRAME | FRAME | FRAME | FRAME |
| `/tasks` | OK | OK | OK (empty) | OK | OK | OK | OK |
| `/accounts` | OK | OK | OK (see I-4) | OK | OK | OK | OK |
| `/accounts/staff`, `/accounts/roles` | OK | OK | FRAME | OK | FRAME | OK | FRAME |
| `/organization` | **FRAME** (I-6) | OK | FRAME | OK | FRAME | OK | FRAME |
| `/teachers`, `/teacher-profiles`, `/teachers/files`, `/teachers/needs-action`, `/teachers/schedules`, `/schedule`, `/schedule/students` | OK | INLINE | INLINE | INLINE | INLINE | OK | OK |
| `/students` | OK | INLINE | INLINE | OK | OK | OK | OK |
| `/parents` | OK | OK | OK | OK | OK | INLINE | INLINE |
| `/teacher-attendance`, `/teacher-grants` | OK | OK | OK (empty) | OK | OK | OK | OK |
| `/sales/pipeline` | OK (9 leads) | OK (9 leads) | OK (own leads only) | **INLINE with live controls** (I-1) | same | same | same |
| `/trials` | OK | OK | OK (**F7**) | OK | OK | OK | OK |
| `/trials/new-students` | OK | OK | OK (**F7**) | OK | OK | INLINE | INLINE |
| `/instalments`, `/payments` | OK | OK | OK (empty) | OK | OK | INLINE | INLINE |
| `/materials` | OK | INLINE | FRAME | INLINE | FRAME | OK | FRAME |
| `/cases`, `/teachers/cases`, `/lesson-audio`, `/calls`, `/stories`, `/notifications`, `/profile`, `/profile/devices` | OK | OK | OK (`/certificates` INLINE) | OK | OK | OK | OK |
| `/no-such-page` | redirects to `/admin/conversations` | `/chat` | `/chat` | `/chat` | `/chat` | `/chat` | `/chat` |

Sources: the per-URL results of the capture run (`.../scratchpad/review-all.json`) and the screenshots
`<role>__<page>.png`. salesmgr `/teachers`, `/students`, `/schedule*`, `/materials` return INLINE because the API
answers 403 for them (observed `GET /stats/teachers`, `/learners`, `/calendar`, `/lessons/roster`,
`/materials/admin/items` = 403).

Matches the rules: Forbidden frames for every `/admin/*` route for non-super roles; `/moderation` only for the
`moderation.view` holders (managers); `/accounts/staff` and `/accounts/roles` only for managers; Sales pipeline
data only for Sales and super.

### Navigation per role (rail structure read from the DOM)

| Role | Rail destinations (menu entries) |
|---|---|
| super | Conversations (3), Dashboard (2), People (9), Sales (3), Scheduling (3), Operations (5), Finance (2), Communication (4), Admin and settings (8, "in development" marked) |
| salesmgr | Conversations (Chat, Moderation), Dashboard (Tasks, Dashboard), People (Accounts, Attendance, Grants, Parents, Organization), Sales (Pipeline, Trials, New students), Finance (2), Communication (2). Operations rail item present but **empty** |
| repa, repb | People (Accounts, Attendance, Grants, Parents), Sales (Pipeline, Trials, New students), Finance (Instalments, Payments), Communication (Calls, Stories). Conversations and Dashboard rail items present but **empty** |
| opsmgr, opssup | People (4-5), Sales (Trials, New students; **no Pipeline**), Operations (Escalations, Certificates), Finance (2), Communication (2). opsmgr also has Dashboard and Conversations menus; both have an empty Scheduling item |
| teachmgr | People (Accounts, Teachers, Credentials, Attendance, Grants, Students, Organization), Scheduling (3), Operations (6, including **Trial lessons**), Communication (2). **No Sales item** |
| teachsup | same as teachmgr minus Organization and Materials. **No Sales item** |

Confirmed against the design: Sales icon absent for both Teachers-department accounts; Trial lessons listed
under Operations for them; super admin has all nine sections; reps do not get the Sales manager's Organization.

## 3. Issues

Severity: High = data exposure or wrong access; Medium = misleading or broken behaviour; Low = polish.

### F7 (evidence, being fixed in another PR)
**Sales reps see each other's trials and the New students record with parent contact.**
- Repro: sign in as `repb`; open `/trials` and `/trials/new-students`.
- Observed in the UI: `/trials` lists "Lead A1 Aya" (rep A's lead) next to B's own trial; `/trials/new-students`
  shows the family "Parent A2", "recorded by Sales Rep A", with the parent's phone, e-mail, location, payment
  method, currency, the child, teacher, package and lesson price.
- Same from `repa` for B's trial "Lead B2 Bushra".
- API probe (same session): `GET /trials` as repa and repb both return both reps' upcoming trials;
  `GET /trials/<id>` of rep B's *past* trial returns 200 for rep A (and vice versa), while
  `GET /sales-pipeline/leads/<other rep's lead>` correctly returns 404.
- Root cause visible in code: `SALES_MEMBER` carries `trials.view` and `new_students.view` with no ownership
  narrowing (`legacy-bundles.ts` lines 183-211).
- Screenshots: `shots/repb__trials_ui.png`, `shots/repb__trials_new_students.png`, `shots/repa__trials_ui.png`,
  `shots/repa__trials_new_students.png` (all under the directory in section 1).
- The pipeline itself does not leak: rep A sees A1-A4 only, rep B sees B1-B3 only, the manager and super see
  all nine (`repa__pipeline_list.png`, `repb__pipeline_list.png`, `salesmgr__pipeline_list.png`,
  `super__pipeline_list.png`).

### I-1 (Medium) Route guard shows the Sales pipeline page to accounts the server refuses
- **Status after this review:** fixed by open PR #623 (`b7aa41e6`, "the Sales pipeline shows Forbidden, not its frame, to an account the server refuses"), which the capture's base (`615e56db`) predates. Not re-captured against #623: confirm in the browser once it is merged.
- Repro: sign in as `opsmgr`, `opssup`, `teachmgr` or `teachsup`; open `/sales/pipeline`.
- Observed: the page title, the live "New lead" button, the search box and six stage chips (all 0) render, with an
  inline "you do not have access" card; the API answered `GET /sales-pipeline/leads` 403. Expected per the
  brief: the Forbidden frame ("expect Forbidden frame, not data"). No data is shown, but a refused role is
  offered a create button.
- Screenshots: `shots/opsmgr__sales_pipeline.png`, `shots/opssup__sales_pipeline.png`,
  `shots/teachmgr__sales_pipeline.png`, `shots/teachsup__sales_pipeline.png`.
- Cause (from `navigation-architecture.md`): the route area `sales-pipeline` is allowed for `operations` and the
  Teachers department's `lessonManager` is not part of it, but the area check reads the broad `sales` answer of
  `GET /lessons/access`, which is true for Operations; the narrower `GET /sales-pipeline/access` is not used for
  the route guard. Proposed PR: gate the route with `/sales-pipeline/access` and render the Forbidden frame.
  (The cause for the Teachers accounts was not isolated; their capture shows the same inline state.)

### I-2 (Medium) Inconsistent "no access" presentation across routes
- Many routes a role cannot use render the page chrome (title, sub-tab strip, filters) with a small inline lock
  card, others render the full Forbidden frame. Examples for `repa`: `/teachers`, `/teacher-profiles`,
  `/teachers/files`, `/teachers/needs-action`, `/schedule`, `/teachers/schedules`, `/schedule/students` show the
  Teachers-section tab strip and an inline card; `/materials`, `/moderation`, `/dashboard` show the frame;
  `/certificates` shows "this account does not open certificates" in the page body.
- Impact: a role sees section tabs (Statistics, Schedules, Files...) for a section it cannot use, and the two
  presentations make "forbidden" harder to recognise. No data was shown in any of them.
- Screenshots: `shots/repa__teachers.png`, `shots/repa__schedule.png`, `shots/repa__teachers_files.png`,
  `shots/repa__certificates.png`, `shots/repa__materials.png`, `shots/opsmgr__teachers_files.png`,
  `shots/teachmgr__trials_new_students.png`, `shots/teachsup__parents.png`.
- Proposed PR: one route-level capability check per page that renders the Forbidden frame before any chrome.

### I-4 (Medium, needs product confirmation) A Sales representative sees a family login with admin actions
- Repro: sign in as `repa`; open `/accounts` (it is in the People rail).
- Observed: one row, "Parent A2" (a family account, active, no password set yet) with the buttons "Reset
  password" and "Devices". Whether `repb` also lists it was not looked at (not read).
- Likely by design: `SALES_MEMBER` includes `accounts.administer`. But the family belongs to rep A's lead, not
  to rep B, so if rep B sees it too this has the same shape as F7. Not verified whether the scope is "owned
  families"; the seeded family had no sales owner recorded
  (`salesOwnerId: null` in the intake response).
- Screenshot: `shots/repa__accounts.png`.

### I-5 (Low) Rail shows empty destinations
- `repa`/`repb`: Conversations and Dashboard rail items exist with no menu entries; `salesmgr`: empty
  Operations; `opsmgr`/`opssup`: empty Scheduling. An icon with nothing behind it is a dead control.
  (`navigation.ts` was not changed to hide an empty section; the test "every rail entry for every role opens"
  does not cover empty sections.) Evidence: rail dump in `.../scratchpad/review-all.json`, and the rail icons in
  `shots/repa__landing.png`.

### I-6 (Low) `/organization` is a Forbidden frame for the super admin
- The super admin's Organization page is `/admin/teams`; `/organization` (what everyone else uses) shows the
  Forbidden frame to the one account that owns the organization. A bookmark or a link shared by a manager fails.
  Screenshot: `shots/super__organization.png`.

### I-7 (Low) Ambiguous Arabic labels
- `/admin/stories` and `/stories` are labelled "الحالات" while `/cases` is "التصعيدات" and `/teachers/cases`
  "التصعيدات"; "الحالات" also reads as "cases". Duplicate destinations: Dashboard and Tasks exist twice
  (`/dashboard` and `/admin/dashboard`, `/tasks` and `/admin/tasks`), Chat and All conversations
  (documented as deliberate in the navigation doc). Screenshots: `shots/super__admin_stories.png`,
  `shots/super__cases.png`.

### I-8 (Low, environment) Offline banner and a 401 on every load
- Every non-super account shows "connection lost, reconnecting..." on every page, and the chat page says
  "not connected to live updates". The realtime socket is not wired in this local setup, so this is most likely
  an artefact of the environment, not a product defect. Not verified.
- Each full page load logs `GET /me 401` before the session is restored from the refresh token; harmless but
  noisy in the console on all 460 captures.

### Sales pipeline workflow (what the screenshots show)
- List: stages, owner, last contact, next follow-up, channels on file render correctly and read right-to-left;
  filter chips carry counts that match the rows (manager: All 9, New 4, Trial booked 2, Converted 1, Lost 2).
  Unowned leads show "Unassigned" (`salesmgr__pipeline_list.png`). Lost rows show the reason text
  ("Price", "No-show") beside the badge.
- Drawer (`repa__pipeline_drawer.png`): status, owner, level, note, contact block ("no contact on file", add
  contact), follow-up date and note, Save, Log contact, Log loss, Convert, hand-over note, Close. The date input
  shows the browser's `dd/mm/yyyy` placeholder, not localised to the page language.
- Create dialog (`repa__pipeline_create_dialog.png`, `..._filled.png`): child name (required), level, note,
  contact data block with parent name, phone, WhatsApp, e-mail, country. Submit and the resulting list were not
  captured (see section 1).
- Trials stage: A3 "Lost, no-show", A2 "Converted", A1 and B2 "Trial booked", B1 "Lost, price" all appear in the
  right stage in `salesmgr__pipeline_list.png`. A converted lead's family exists in New students.
- Scheduling: `/schedule` (super: calendar grid with three teachers and statistics), `/schedule/students` (one
  student row with action buttons) render. For the other roles the Scheduling pages were INLINE (no access) for
  anyone not holding `calendar` or `lessonManager`: see the matrix. Only the super admin and the Teachers
  department were seen with data; no schedule edit, create or reschedule flow was exercised.

## 4. Layout and responsive findings
- Desktop (1440x900): no overlapping text or clipped controls seen on contact sheets or in the full-size reads.
  Content sits in the right-hand column of a very wide canvas on RTL pages with a large empty area to the left on
  list pages with few rows (calls, chat empty state, trials); acceptable but sparse.
- The Sales pipeline drawer opens on the left edge, 420 px wide, with the page blurred behind it.
- **Responsive and mobile layouts were not checked** (only one viewport was captured).

## 5. Pre-redesign URLs
All 28 URLs of the "No URL was lost" test list and the 17 `/admin/*` legacy URLs were visited for every role.
For the super admin every one resolved on its own path (except `/dashboard` which redirects to
`/admin/dashboard`, and `/organization` which is a Forbidden frame, see I-6). For the other roles each URL
resolved on its own path with either data, INLINE or FRAME as in section 2; none was blank and none redirected
unexpectedly. An unknown URL redirects to the role's home (no 404 page).

## 6. Prioritised fixes (focused PRs, not implemented)
1. F7 (separate PR): narrow `trials.view` and `new_students.view` for Sales members to their own leads; check the
   Accounts and Parents lists for the same cross-rep reach (I-4).
2. Route guard for `/sales/pipeline` through `/sales-pipeline/access` (I-1).
3. One capability check before any chrome, so "no access" is always the Forbidden frame (I-2).
4. Hide rail items with no entries (I-5); make `/organization` resolve for the super admin (I-6).
5. Label review for "الحالات" (I-7); localise the follow-up date input.

## 7. What was NOT checked
- Responsive and mobile viewports; English UI (the English toggle in the login page did not change the rail
  labels in the capture; all text was Arabic).
- Create-lead submission and the list after it (capture killed); the drawer, create dialog for `repb`,
  `salesmgr` and `super` (only `repa` has them); reassigning an owner; Convert, Log contact and Log loss actions.
- Scheduling write flows (booking, rescheduling, availability edit), Students page filters and profile
  (`/students/:id`), Finance and Settings data beyond what loads (cards are paused by the seed; settings,
  integrations, audit and approvals are "in development").
- Specialist-tier Sales accounts (cannot be put in a department's members; their access was not captured).
- The 12-month retention job and any live realtime behaviour.
- Visual inspection of the screenshots listed as not opened in section 1 (matrix cells for those come from the
  DOM/API capture, not from looking at the image). Findings I-1 and I-2 were seen visually only for the files named
  there; the same state for the other roles in the matrix is inferred from the DOM `forbidden` flag and 403 logs.
