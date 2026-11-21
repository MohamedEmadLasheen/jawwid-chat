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
- **Status after this review:** fixed in open PR #627 (stacked on #624), which scopes every trial read and write, the New Students page and the trial payment routes to the representative's own prospects. The independent review of that fix left two items for a product decision: trial-group chat cards (every Sales member is seated in a teacher's trial group and sees all reps' trial cards) and the `trial_outcome` task owner. Not re-captured in the browser against #627.
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
- **Status after this review:** fixed by open PR #623 (`b7aa41e6`, "the Sales pipeline shows Forbidden, not its frame, to an account the server refuses"), which the capture's base (`615e56db`) predates. Re-captured against #623 in the second pass: **fixed** (section 8.2).
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


---

# Second pass, 2026-11-21 (evening): re-capture, mobile, English, workflows

Everything below was run against a local integration build, not `main`. No product code was changed (the only edit
in the build is the merge resolution described in 8.1). Nothing was pushed, merged or deployed. All paths below
are absolute and live in the session scratchpad (screenshots and logs are not in git).

## 8. Re-capture against #623 + #627 (+ #628 view)

### 8.1 Build and environment
| Item | Value |
|---|---|
| Build | local branch `claude/vis2-build` = `origin/claude/pd059-needs-handover` (PR #628, tip `f2a1c300`, stacked on #627 = F7) + `origin/claude/pipeline-gate-on-server-access` (PR #623), merge commit `8ff5011d`, resolution commit `d2273e1d` |
| Merge conflict (resolved minimally) | `apps/admin-web/src/features/sales-pipeline/SalesPipelinePage.tsx`. Textual conflict on the `./copy` import line (#628 imports `H, P, STAGE, lostText`; #623 imports `P, STAGE, lostText` plus `ForbiddenPage` and `ApiError`): kept the union. **A semantic conflict that git did not flag:** both PRs add `const access = usePipelineAccess()` in the same component, so the merged file declared it twice and would not compile. I removed #628's second call and let both uses read the single `access`. `npx tsc -p tsconfig.json --noEmit` in `apps/admin-web` is clean afterwards. Whichever of #623 / #628 merges second needs this one-line rebase. Component tests were not run |
| Database | own `postgres:17` container `jc-vis2-pg` (port 55651), all migrations applied with `scripts/db/apply.sh` ("migrations up to date"); Redis container `jc-vis2-redis` (56651) |
| API / Admin Web | `apps/api` built (`npm run build`) and run on port 3651 with `SUBSCRIPTION_LOCK_ENFORCED=false`; Admin Web `vite` dev server on 5651. Throwaway random secrets and password in a mode-600 file in the scratchpad, never printed or committed |
| Browser | Playwright (`playwright-core`) driving the installed Google Chrome, headless (the Playwright browser cache of the first run no longer exists). One browser per role, closed between roles, results appended to JSONL as produced. No OOM this time |
| Data | same synthetic seed as section 1 (9 leads, 5 trials, family "Parent A2" entered by Operations), plus `X1` (subscribed trial, not enrolled), `X2` (subscribed, enrolled by Operations through New students; the lead holds a WhatsApp number the family has no room for), `X3` (subscribed, enrolled, all channels covered), `X4` (subscribed, enrolled, no contact copy), `X5` (subscribed, not enrolled). `learner_linked` could not be seeded: the database guard says a prospect is linked to its learner only by the Core confirmation |
| Files | scripts `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/*.mjs`; JSONL logs `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/cap-A.jsonl`, `cap-M.jsonl`, `cap-E.jsonl`, `wf-*.jsonl`, `mobile.jsonl`, `mobile2.jsonl`; images `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/{A,M,E,MI,W}/` |

Screenshot honesty: the images I actually opened are listed in section 12. Every other statement comes from the
DOM/API capture (final path, `.state--forbidden`, HTTP status of every request, visible alert/status text, document
and container widths) and is marked "automated".

### 8.2 What the fixes do in the browser

| Check | Result | Evidence |
|---|---|---|
| **I-1** `/sales/pipeline` for `opsmgr`, `opssup`, `teachmgr`, `teachsup` | **Fixed.** Forbidden frame only: no title, no "New lead" button, no chips. The API still logs `GET /sales-pipeline/leads 403`, but nothing renders around it | opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/opsmgr.desktop.ar__sales_pipeline.png`; before (opened) `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/shots/opsmgr__sales_pipeline.png`. The other three: automated, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/cap-A.jsonl` |
| Reps and the Needs hand-over switch | `repa`, `repb`: no switch (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/repa.desktop.ar__sales_pipeline.png`). `salesmgr`: switch "المسار / بحاجة إلى تسليم" present (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr1-02-handover-view.png`). `super`: present (automated, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/wf-sup1.jsonl`, image not opened). `GET /sales-pipeline/reconciliation` as `repa`: 403 `COMM.SALES_LEAD_DENIED` | as listed |
| **F7** `/trials` | **Fixed.** Before, `repb` also saw rep A's "Lead A1 Aya"; now `repb` sees only X3, X4, B2 and `repa` only X1, X2, X5, A1 | after (opened) `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/repb.desktop.ar__trials.png`; before (opened) `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/shots/repb__trials_ui.png` |
| **F7** `/trials/new-students` | **Fixed.** Before, `repb` saw "Parent A2" recorded by rep A with phone, e-mail and payment. Now `repb`'s page is empty; `repa` sees only the 3 families of his own prospects (X5, X1, A2) | opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/repb.desktop.ar__trials_new_students.png`; API probe below |
| **F7** trial detail (API probe `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/f7.mjs`; there is no single-trial UI page) | `GET /trials/<id>` and `/trials/<id>/subscription-prefill`: `repa` on rep B's trials (B1, X3) = **404**, own = 200; `repb` on rep A's (A2, X1) = **404**, own = 200; `salesmgr` and `opssup` = 200 on all. Parent contact only for own prospects | automated |
| **I-4** `/accounts` for `repa` | **Still present, and `repb` has it too.** Both reps list the family login "Parent A2" with "Reset password" and "Devices"; `GET /me` for `repa` still carries `accounts.administer`. This build does not contain the separate branch `claude/pd059-sales-accounts-administer` (stacked on #627, migration `20261121140000`), so this is expected for this build | opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/repa.desktop.ar__accounts.png`; `repb` automated (identical page text) |
| **I-6** `/organization` for `super` | **Still present** (Forbidden frame, automated `forbidden:true`; image not opened). Decision in 8.4 | `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/super.desktop.ar__organization.png` |
| **I-2** inconsistent "no access" | **Still present**, unchanged (8.3). Opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/repa.desktop.ar__schedule.png` (title + inline card) and `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/teachmgr.desktop.ar__trials_new_students.png` (title + inline card) next to `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/A/opsmgr.desktop.ar__sales_pipeline.png` (frame) | as listed |
| **I-5** empty rail destinations | **Still present** (rail DOM dump in `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/cap-E.jsonl`): `repa` Conversations(0), Tasks(0), "Escalations"(0); `salesmgr` Escalations(0); `opsmgr` "Academy calendar"(0). In the phone drawer only real links appear | automated |
| **I-7** labels, date input | I-7 not re-checked. The follow-up and pause date inputs still show the browser's `dd/mm/yyyy` in both languages | opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr1-08-convert-x2-channel-missing.png`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/sched2-02-pause-save-no-date.png` |
| **I-8** offline banner, `GET /me 401` per load | **Still present** (environment: no realtime socket) | opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/E/super.desktop.en__chat.png` ("Live updates are disconnected") |

### 8.3 Access matrix after the fixes (automated, desktop, Arabic; 23 URLs x 8 accounts)
FRAME = Forbidden frame. INLINE = the page title and chrome render and the API answered 403 (lock card or empty
body). Per-URL results: `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/cap-A.jsonl`, summary script `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/sum.py`.

| Account | FRAME | INLINE (the I-2 inconsistency) |
|---|---|---|
| super | `/organization` | none |
| salesmgr | `/admin/*` | `/students`, `/schedule`, `/schedule/students`, `/teachers/schedules`, `/teachers`, `/teachers/files`, `/teachers/needs-action`, `/materials` |
| repa, repb | `/organization`, `/admin/*`, `/materials`, `/moderation`, `/dashboard`, `/accounts/staff` | `/students`, `/schedule`, `/schedule/students`, `/teachers/schedules`, `/teachers`, `/teachers/files`, `/teachers/needs-action` |
| opsmgr | **`/sales/pipeline`** (was INLINE), `/admin/*` | `/schedule/students`, `/teachers/schedules`, `/teachers`, `/teachers/files`, `/teachers/needs-action`, `/materials` |
| opssup | **`/sales/pipeline`**, `/organization`, `/admin/*`, `/materials`, `/moderation`, `/dashboard`, `/accounts/staff` | `/schedule/students`, `/teachers/schedules`, `/teachers`, `/teachers/files`, `/teachers/needs-action` |
| teachmgr | **`/sales/pipeline`**, `/admin/*` | `/trials/new-students`, `/parents`, `/instalments` |
| teachsup | **`/sales/pipeline`**, `/organization`, `/admin/*`, `/materials`, `/moderation`, `/dashboard`, `/accounts/staff` | `/trials/new-students`, `/parents`, `/instalments` |

Same page, different presentation: `/materials` is a frame for the reps and `opssup` but INLINE for `salesmgr` and
`opsmgr`. An unknown URL still redirects to the role's home. The landing page is `/admin/conversations` for `super`
and `/chat` for everyone else.

### 8.4 `/organization` for the super admin: investigation and decision
- Code path: `apps/admin-web/src/app/AppRoutes.tsx` line 122 gates `/organization` with `<Area area="organization">`;
  `Area` calls `canOpenArea(role, 'organization')`. `core/permissions/capabilities.ts` `visibleAreas()` gives the
  super admin a list **without** `'organization'` (the manager's list has it), and `navigation.ts` (lines 124, 153,
  183, 356) maps `organization` to `/organization` for operators and to the Admin Portal section `teams`
  (`/admin/teams`) for the super admin; `/admin/teams` renders the same `OrganizationPage` through
  `features/admin/AdminSectionPage.tsx`.
- Docs: `docs/admin/navigation-architecture.md` row 3 lists "Organization: `/organization` (`/admin/teams`)": two
  paths for one page, the second (in parentheses) being the super admin's. So the **omission is intended** (no
  operator-area entry for the super admin), but neither docs nor code say what the operator URL does for the super
  admin, and the "no URL was lost" test in `Navigation.test.tsx` checks `/organization` only for `manager`.
- Observed: `super` -> `/organization` = Forbidden frame (desktop, phone, tablet, English; automated);
  `super` -> `/admin/teams` = the Organization page.
- Verdict: **intended routing, missing redirect.** A link or bookmark of `/organization` (from a manager, or a
  notification) fails for the one account that owns the organization. Severity Low.
- Minimal fix (not implemented): in `AppRoutes.tsx` render, for `/organization`,
  `isSuperAdmin(staff.role) ? <Navigate to={adminSectionPath('teams')} replace /> : <Area area="organization"><OrganizationPage /></Area>`
  (a small `OrganizationEntry` component beside `Area`; `Navigate` and `isSuperAdmin` are already imported), plus one
  test in `Navigation.test.tsx`: the super admin at `/organization` ends on `/admin/teams`. Do **not** add
  `'organization'` to the super admin's `visibleAreas` (it would create a second rail entry for the same page).

## 9. Mobile and tablet

Viewports: phone 390x844 (touch, `isMobile`), tablet 820x1180 (touch). Accounts: super, salesmgr, repa, opsmgr,
teachmgr (not opssup, repb, teachsup). Pages: `/chat`, `/sales/pipeline`, `/trials`, `/trials/new-students`,
`/students`, `/schedule`, `/schedule/students`, `/accounts`, `/organization`, `/materials`, plus nav drawer, lead
drawer, create dialog and the Needs hand-over view. Data: `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/cap-M.jsonl`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/mobile.jsonl`,
`/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/mobile2.jsonl`; images `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/M/` and `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/MI/`. Chrome only (no iOS Safari, no real device).

| Check | Result |
|---|---|
| Navigation | At both widths the rail is replaced by a top bar with an "open menu" button and the brand; the menu is an off-canvas drawer (right side, RTL) with a close button and the groups (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/MI/repa.phone__2-nav-drawer.png`). Only real destinations are listed. Works. (My first script's burger selector missed; the drawer was opened by `button.topbar__menu` in the second script) |
| Document-level horizontal scroll | **None** on any page, any account, at 390 or 820 (`scrollWidth == clientWidth`, automated, every row of `mobile.jsonl`) |
| Tables | Every data table keeps its desktop column set inside a `.table-wrap` that scrolls sideways (pipeline 1077 px of content in a 356 px box; trials 748>354; new students 534>322; student schedules 895>306; accounts 539>356). No stacked or card layout. In the opened images the pipeline shows the name, stage and part of the owner column and the **action column (Open, Edit, Cancel, Move) is off-screen** at 390 px (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/M/super.phone.ar__sales_pipeline.png`); at 820 px the pipeline mostly fits (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/M/super.tablet.ar__sales_pipeline.png`); the trials date cell wraps one word per line (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/M/salesmgr.phone.ar__trials.png`). **Needs hand-over** on a phone: the "What is needed" column, the one that carries the next step, is off-screen (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/MI/salesmgr.phone__2-handover-view.png`) |
| Long Arabic text | The lead "عميل اختبار طويل جدا باسم عربي لفحص الالتفاف... Test Lead" (mixed Arabic and Latin): in the phone list the name stays on one line and runs off the edge, hiding the rest of its row (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/MI/repa.phone__2-pipeline.png`); on desktop it is fine (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/rep-05-list-after-create.png`); in the lead drawer title it **wraps correctly** (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/MI/repa.phone__2-lead-drawer-long-name.png`) |
| Drawer and dialogs | Lead drawer: full-screen sheet at 390 px (close "X" top left), 420 px side panel at 820 px. Create-lead dialog: full-height sheet, fields stack, nothing clipped (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/MI/repa.phone__2-create-dialog.png`; no horizontal scroll inside, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/mobile2.jsonl`). Native `dd/mm/yyyy` date control |
| Forbidden frame | Centred card, fits 390 px (automated detection; phone image not opened) |
| Scheduling | `/schedule`: at 390 px the statistic cards stack two per row and the grid sits behind "By teacher" (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/M/super.phone.ar__schedule.png`); at 820 px the week grid scrolls inside `.sc-scroll` (1100 px in 754 px, automated) |
| Tap targets (automated: interactive elements under 44x44 CSS px) | Top bar: menu 40x40, notifications 40x40, **language toggle 93x32, brand link 45x18**; nav drawer rows 276x40, **close button 32x32**; table "Open" buttons about 32 px high (seen in images); chips about 32-36 px; most small buttons are `btn--sm`. Everything meets the 24 px WCAG 2.2 AA minimum except the brand link's height; nearly everything is below 44 px (iOS/Material guidance). Per-page counts: `smallCount` in `mobile.jsonl` |

Issues: **M-1 (Medium)** tables do not adapt to phones, key actions off-screen (pipeline, hand-over, trials,
schedules); **M-2 (Low)** a long name is neither wrapped nor truncated in the first column on phones; **M-3 (Low)**
tap targets under 44 px (top bar 40, drawer close 32, language 32, table buttons 32).

## 10. English interface

How to switch (the earlier toggle click did not change rail labels): the language chosen **on the login page** is
stored as `localStorage["jawwid.locale"]`, but after sign-in `SessionProvider` applies the account's own pick
`localStorage["jawwid.locale.account.<accountId>"]`, else `GET /me` -> `locale` (Arabic here), which overrides the
login-page choice (`core/auth/SessionProvider.tsx` lines 62-84, `core/i18n/I18nProvider.tsx`). The real switch is the
**"English / العربية" button in the top bar of the signed-in app** (`LanguageToggle` in `app/AppShell.tsx`): it sets
the locale and remembers it per account on that browser (the code stores it only in localStorage; I did not watch the
network log; a second browser would open in Arabic again). `<html lang dir>` flips to `en`/`ltr`. This pass signs
in, then clicks that button. **N-1 (Low):** the login-page toggle is silently discarded after sign-in.

Captured (desktop, 15 pages x 5 accounts, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/cap-E.jsonl`, images `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/E/`): `lang="en" dir="ltr"` on every
page; no Arabic characters in the first 260 characters of the main text of any page (automated); rail labels
translate ("Conversations, Dashboard, People & Organization, Sales, Scheduling, Operations, Finance, Communication,
Admin & Settings"). Opened: `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/E/super.desktop.en__sales_pipeline.png`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/E/super.desktop.en__chat.png`,
`/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/E/teachmgr.desktop.en__schedule.png`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/E/super.desktop.en__trials_new_students.png`,
`/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/enmgr-01-handover-view-after.png`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/enrep-04-en-drawer-x2-convert.png`.

| Finding | Detail |
|---|---|
| LTR layout | Correct in everything opened: rail on the left, tables left-aligned, the lead drawer slides in from the right (`enrep-04`), the Needs hand-over view has the same columns in reverse order. No LTR fault seen |
| Untranslated / mixed | (a) The Convert refusal is shown as the raw server sentence "the family's record has no room for one of the lead's contact channels (a second phone or WhatsApp number, or another e-mail); add it to the family's profile first, then convert again": lower-case and technical in English, and **in English inside the Arabic UI** (V-1). (b) Super admin `/admin/conversations` shows the raw kind keys `trial_group` and `department_room` as filter chips and row sub-lines **in Arabic** (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/M/super.phone.ar__landing.png`; text in `cap-A.jsonl`); `/chat` translates the same kinds. (c) The top bar says "Operations" ("العمليات") to the Sales manager and the Teachers manager and "Admin Portal" to the super admin (design label, noted only). (d) Dates, times and counts are localised |
| Environment message | The teacher file shows "Payout accounts are disabled on this server (no encryption key). Ask the technical team to set TEACHER_PAYOUT_KEYS" (local environment, an ops message shown to a manager; not a product defect) |

## 11. Workflows exercised in the browser

All steps through the real UI (Playwright), Arabic desktop unless noted, synthetic data. Each step has an automated
screenshot `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/<flow>-NN-<step>.png` and a JSONL record `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/wf-<flow>.jsonl` (observed alert/status text, error).
"opened" means I looked at the image.

### 11.1 Sales representative `repa`: lead lifecycle (flows `rep`, `loss`; English `enrep`)
| Step | Observed | Message correct / translated |
|---|---|---|
| Create, empty submit | banner "أدخل الاسم." | yes (English "Enter the name.") |
| Create, name + phone only | "أدخل اسم ولي الأمر مع وسيلة تواصل واحدة على الأقل." | yes, Arabic |
| Create, full (long mixed Arabic/Latin name, parent, phone with country code, e-mail, level, note, follow-up 2026-11-30) | lead created, first row, stage "عميل جديد", follow-up 2026-11-30 (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/rep-05-list-after-create.png`) | no confirmation message, the dialog just closes |
| Edit contact (change e-mail), save | saved; drawer shows the new e-mail and the note "Opening these details is recorded in the audit log" | ok |
| Follow-up date + note, Save | persisted after reopening: 05/12/2026 and "اتصل مساءً" (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/loss-06-reopen-lost.png`) | silent; native `dd/mm/yyyy` control, not localised |
| Log contact ("تسجيل تواصل") | status "تم تسجيل التواصل." and the stage becomes "تم التواصل" | correct, Arabic |
| Log loss ("تسجيل كخسارة"), reason, confirm | stage "خسارة" with reason "السعر" in the list (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/loss-05-lost-list.png`). The reason picker's first option is the placeholder "اختر السبب"; choosing it leaves the confirm button disabled (correct) (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/loss-03-loss-pick-reason.png`) | silent success |
| Reopen a lost lead | back to "تم التواصل" | silent |
| Convert X5 (subscribed trial, not enrolled) | "اشترك الطالب بعد التجربة. حوّل العميل مرة أخرى بعد أن يسجّل التشغيل الأسرة، فتُربط بيانات التواصل بها." (English version also correct) | correct, translated (`awaiting_enrolment`) |
| Convert X2 (enrolled; extra WhatsApp has no room) | red banner in the drawer with the English sentence quoted in section 10 | right content, **wrong language and developer phrasing** (V-1). Same for the manager |
| Convert A2 (family exists in Chat, entered by Operations, not Sales') | "ولي الأمر موجود بالفعل في عائلة ليست عائلتك. اسأل مديرك." (English "This parent is already in Chat under a family that is not yours. Ask your manager.") | correct, translated |

### 11.2 Sales manager `salesmgr` and super (flows `mgr1`, `mgr2`, `sup1`, `enmgr`)
| Step | Observed |
|---|---|
| Needs hand-over view | The switch changes the view: intro line, guidance line for Operations, state counters (waiting for enrolment 3, enrolled-not-linked 2, enrolled-no-contact 1, linked-to-learner 0) and a table: lead, stage, waiting days, owner, contact copy yes/no, enrolled by Operations yes/no, what is needed (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr1-02-handover-view.png`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr2-01-handover-view-after.png`, English `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/enmgr-01-handover-view-after.png`). Read-only: the only control per row is "Open" (the lead drawer opens in place) |
| Content for each state | **awaiting_enrolment** (A2, X1, X5): "بانتظار أن يسجّل التشغيل العائلة." with days (39, 29, 19) and owner. **enrolled + channel_missing** (X2): "لا يوجد مكان في سجل العائلة لإحدى وسائل تواصل العميل. أضفها إلى ملف العائلة ثم حوّل مرة أخرى." plus "لا يوجد مكان في سجل العائلة لـ: الهاتف · واتساب" (kinds only, never values). **enrolled + ready** (X3): "كل وسائل التواصل موجودة في سجل العائلة. افتح العميل واضغط تحويل لربطه." **enrolled_no_contact** (X4): "لا توجد نسخة تواصل، فلا شيء يضيع. إجراء محاسبي فقط لاحقًا." **learner_linked**: not seeded (counter 0). Arabic and English copy complete and consistent with `GET /sales-pipeline/reconciliation` (automated). One exception: V-2 |
| Convert X3 as manager | "ولي الأمر موجود بالفعل: تم ربط العميل بعائلته." (`linked`); on the next view X3 has left the hand-over list (5 rows, counters 3/1/1/0, opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr2-01-handover-view-after.png`) |
| Convert X1, X2 as manager | awaiting-enrolment message (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr1-07-convert-x1-awaiting.png`); English channel-missing banner (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr1-08-convert-x2-channel-missing.png`) |
| Reassign owner (B3 from rep B to rep A) | status "تمت إعادة إسناد العميل."; the lead then shows under "Sales Rep A" in rep A's own list (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/rep-05-list-after-create.png`). Correct, Arabic |
| Create lead with an owner chosen (manager-only field) | created, owner "Sales Rep B", no error |
| Super (`sup1`) | switch present and the list loads (automated, image not opened) |

### 11.3 Scheduling write flows (Teachers manager `teachmgr`; Sales rep `repb` for trials)
What the UI offers: on `/schedule/students` per student **Edit times, Add a lesson, Lessons (then Move), Change
teacher, Pause or stop**; on the teacher file the **shift** editor; on `/trials` **Book a trial, Edit (reschedule),
Cancel**. There is no cancel for a scheduled (non-trial) lesson, only Move. The Operations manager can read `/schedule`
but `/schedule/students` is INLINE no access for him, so the write flows belong to the Teachers manager.

| Flow | Observed |
|---|---|
| Edit times (open) | dialog "المواعيد الأسبوعية — Adam" with the current weekly times; opened and closed, not changed |
| Add a lesson | day chips ("السبت 21 · 4 أوقات", ...) then time chips by part of day; chose Sun 22, 12:00 AM; saved, the lesson shows in "Lessons" (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/sched-04-add-lesson-open.png`, `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/sched-10-lessons-move-save.png`). Silent success |
| Move a lesson | chose Sun 22, 12:30 AM; banner "نُقلت إلى الأحد 22 نوفمبر 12:30 ص", old row struck through and "مغلقة", new row "منقولة" (opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/sched-10-lessons-move-save.png`). Correct, Arabic |
| Change teacher | dialog opens with the explanation of what moves; not submitted (it would reassign real schedules) |
| Pause a student without a date | banner **"returnOn: a date as YYYY-MM-DD"**: a raw field name, in English, in the Arabic dialog (V-3; opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/sched2-02-pause-save-no-date.png`) |
| Pause with a return date (2026-12-10) | saved, dialog closes, no message |
| Teacher shift edit and save | dialog opens (full/part-time, date), saved, no message |
| Trial reschedule (rep B) | dialog with teacher, minutes (hint "من ١٥ إلى ١٢٠ دقيقة" in **Arabic-Indic digits** where the rest of the page uses Western digits, V-6; opened `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/trial-03-reschedule-pick.png`), day and time chips; saved, no message |
| Trial cancel (rep B) | without a reason the field says "مطلوب"; with a reason it cancelled (API: `attendance: admin_cancelled`, `outcome: cancelled`), no message |

### 11.4 Issues found in the workflows
- **V-1 (Medium)** The Convert refusal `channel_missing` is shown as the raw server sentence, in English, inside the
  Arabic drawer (rep and manager). `describePipelineError` (`sales-pipeline/copy.ts` line 192) maps only
  `SALES_LEAD_DENIED` and `PARENT_EXISTS`; any other code falls to `error.localized(locale)`, which has no Arabic for
  this one, while the Needs hand-over view already has the Arabic sentence (`H.blocker.channel_missing`). Repro: as
  `repa` or `salesmgr` open "Lead X2 NoRoom", press "تحويل". Screenshots `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr1-08-convert-x2-channel-missing.png`
  (opened), `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/rep-15-convert-x2-channel-missing.png` (automated). Fix: give the refusal its own error code
  on the API and map it in `describePipelineError` with the existing Arabic and English wording.
- **V-2 (Medium)** The Needs hand-over view gives the wrong next step for a lead whose family already exists in Chat
  without a trial enrolment. "Lead A2 Adam" is listed as "بانتظار التسجيل: بانتظار أن يسجّل التشغيل العائلة" (39
  days), while Convert answers "ولي الأمر موجود بالفعل في عائلة ليست عائلتك. اسأل مديرك." because Operations entered
  the family by hand through `/family-intake` with the same e-mail. Cause (API `sales-pipeline.service.ts` around
  lines 660-715, read, not debugged): the list looks up contact keys only when a trial enrolment exists, so with no
  enrolment it always answers `awaiting_enrolment`, while Convert looks the family up by key first. Repro: as
  `salesmgr` open Needs hand-over and Lead A2; as `repa` open A2 and press Convert. Screenshots
  `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/mgr2-01-handover-view-after.png` (opened), `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/W/rep-16-convert-a2-ready.png` (automated).
  Fix: when there is no enrolment, run the family-by-key lookup too and report `unavailable` (or `ready`).
- **V-3 (Low)** The pause dialog's validation text is the raw "returnOn: a date as YYYY-MM-DD" in an Arabic dialog.
  Fix: translate, or validate the date on the client.
- **V-4 (Low)** The stage chip "تم التحويل / Converted" is the trial-derived stage: a lead whose trial subscribed but
  was not handed over (X1, X2, X4, X5, A2) already reads "Converted" in the list and in the filter count ("Converted
  6" while 5 rows are in Needs hand-over). Only the drawer's "Handed over" badge tells them apart. Fix: show the
  hand-over state in the row, or label the stage "Subscribed".
- **V-5 (Low)** Several writes finish silently (create lead, mark lost, reopen, add a lesson, pause, shift save,
  trial reschedule/cancel), others show a status banner (log contact, reassign, move lesson, convert). Pick one.
- **V-6 (Low)** Arabic-Indic digits in the trial reschedule hint ("١٥", "١٢٠") against decision DD-09 (Western
  digits everywhere).
- **V-7 (Low)** The reassign button and its field label are both "إعادة الإسناد إلى".
- **V-8 (Low)** Super admin `/admin/conversations` shows raw `trial_group` / `department_room` in Arabic.
- **Observation (not a defect, needs a product answer):** once Operations assigns a family, the rep no longer sees it
  in New students (`repa` sees X5, X1, A2 but not X2, his own assigned lead; `repb` sees none of X3/X4; the
  Operations supervisor sees X2-X4 only). Consistent with the F7 scoping, but worth confirming.

## 12. Screenshots actually opened as images (everything else is automated capture only)
Under `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/` (full path = `/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/v2/shots/` + the name below + `.png`):
`A/repa.desktop.ar__sales_pipeline`, `A/repb.desktop.ar__trials`, `A/repb.desktop.ar__trials_new_students`,
`A/repa.desktop.ar__accounts`, `A/opsmgr.desktop.ar__sales_pipeline`, `A/repa.desktop.ar__schedule`,
`A/teachmgr.desktop.ar__trials_new_students`, `A/teachmgr.desktop.ar__schedule_students`, `A/teachmgr.desktop.ar__schedule`;
`M/super.phone.ar__sales_pipeline`, `M/super.phone.ar__landing`, `M/super.tablet.ar__sales_pipeline`,
`M/super.phone.ar__schedule`, `M/salesmgr.phone.ar__trials`, `M/salesmgr.phone.ar__trials_new_students`;
`E/super.desktop.en__sales_pipeline`, `E/super.desktop.en__chat`, `E/teachmgr.desktop.en__schedule`,
`E/super.desktop.en__trials_new_students`; `MI/repa.phone__2-lead-drawer-long-name`, `MI/repa.phone__2-nav-drawer`,
`MI/repa.phone__2-pipeline`, `MI/repa.phone__2-create-dialog`, `MI/salesmgr.phone__2-handover-view`;
`W/mgr1-02-handover-view`, `W/mgr1-07-convert-x1-awaiting`, `W/mgr1-08-convert-x2-channel-missing`,
`W/mgr2-01-handover-view-after`, `W/rep-05-list-after-create`, `W/rep-12-log-loss-confirm`, `W/loss-03-loss-pick-reason`,
`W/loss-05-lost-list`, `W/loss-06-reopen-lost`, `W/sched-04-add-lesson-open`, `W/sched-10-lessons-move-save`,
`W/sched-12-suspend-open`, `W/sched2-02-pause-save-no-date`, `W/sched2-05-teacher-file-open`, `W/trial-01-trials-list`,
`W/trial-03-reschedule-pick`, `W/enmgr-01-handover-view-after`, `W/enrep-04-en-drawer-x2-convert`; and from the first pass
`/private/tmp/claude-501/-Users-mohamedlasheen-dev-jawwid-chat/29fa60b6-bcf9-422e-ae05-7b05b180c28c/scratchpad/shots/opsmgr__sales_pipeline.png`
and `.../shots/repb__trials_ui.png`. Every other claim rests on the DOM/API capture named beside it.

## 13. Status of every earlier issue
| Issue | Status after this pass |
|---|---|
| F7 trials / new students leak | **Fixed** (UI and API verified, 8.2) |
| I-1 pipeline page for refused roles | **Fixed** for all four refused accounts (one image opened) |
| I-2 inconsistent no-access presentation | **Still present** (8.3) |
| I-4 Sales sees family logins with admin actions | **Still present**, now confirmed for both reps; the fix is in a separate branch not in this build |
| I-5 empty rail destinations | **Still present** (rail only) |
| I-6 `/organization` for super | **Still present**; decision and fix in 8.4 |
| I-7 label ambiguity | Not re-checked |
| I-8 offline banner, `/me` 401 | **Still present** (environment) |
| Date input not localised | **Still present** |
| Responsive, English, create-lead submit, drawer, convert, reassign, scheduling writes | **Now checked**, sections 9-11 |

## 14. Prioritised fixes from this pass (none implemented)
1. V-1 translate the Convert `channel_missing` refusal (Medium, small).
2. V-2 make the Needs hand-over blocker agree with Convert when a family exists without an enrolment (Medium).
3. M-1 phone layout for the data tables: the action column reachable and the hand-over "What is needed" visible (Medium).
4. Redirect `/organization` to `/admin/teams` for the super admin (Low, 8.4); one capability check before any chrome (I-2).
5. V-3, V-4, V-5, V-6, V-8, N-1, M-2, M-3 (Low).
6. Before merging both #623 and #628: rebase whichever goes second (duplicate `const access`, 8.1).

## 15. What was NOT checked in this pass
- Safari/WebKit, real iOS or Android hardware, landscape, browser zoom, keyboard-only and screen-reader use, focus
  order in the drawer and dialogs, colour contrast.
- Mobile and tablet for `opssup`, `repb`, `teachsup`; English on phone and tablet; Arabic desktop pages outside the
  23-URL list of 8.3.
- Convert on a lead with no family (the family-intake dialog it opens), booking a new trial, Operations' Assign
  supervisor and payment requests, Change teacher submit, Edit times submit, family-login actions on `/accounts`,
  Specialist-tier accounts.
- The `learner_linked` hand-over state (cannot be seeded without the Core confirmation) and the 12-month retention job.
- The separate accounts branch `claude/pd059-sales-accounts-administer` (not in this build); PR component, unit and
  integration tests on the merged build (only `tsc --noEmit` ran); realtime and the offline banner.
- The super admin's Needs hand-over image, the phone Forbidden frame image, and all automated-only pages (section 12
  lists the ones I looked at).
