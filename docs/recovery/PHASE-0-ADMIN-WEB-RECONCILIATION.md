# Phase 0 — Admin Web Reconciliation

Branch `integration/recovery` · 2026-09-07 · scope: `apps/admin-web/src` (60 files, 6,128 lines; `node_modules`/`dist` ignored).
Authority for every target shape below is `docs/contracts/API-CONTRACT.md` (written in parallel; this document maps to it and does not restate its specs). Product decisions cited: PRD v0.1 §3 (roles), §7.5 (inbox), §10.2 (dashboard metrics); OD-01 decision **C-3** (`docs/release/od-01-conversation-model.md:268` — no Case entity).

Labels used exactly once per file: **KEEP** (unchanged infrastructure) · **REUSE** (keep, adapt to contract/vocabulary) · **REWORK** (keep the shell, replace the domain) · **DEPRECATE** (CRM-specific; frozen, no new code, removed in a later phase) · **REMOVE LATER** (dead or brief-era; delete once the replacement lands).

---

## 1. Verdict in five lines

1. **Today** Admin Web is a Customer-Success CRM client built against the superseded brief: a four-bucket attention inbox, one thread per family with Cases layered on it, tasks routed to departments, a manager coverage scheduler and a renewals/at-risk/workload dashboard (`core/api/endpoints.ts` — 48 endpoint functions across 9 groups).
2. **It becomes** the Communication Operations Console: a conversation queue (needs reply / pending approval / unanswered), a conversation view with family context, communication activity and alerts, and supervisor assignment — for `admin`, `coverage_admin`, `manager` (and `super_admin`, PRD §3). The dashboard direction is locked in §7 and is **not** built in Phase 0.
3. **Zero overlap:** the 48 client endpoints hit `/me`, `/auth/*`, `/config`, `/inbox*`, `/families*`, `/cases*`, `/tasks*`, `/coverage*`, `/absences/*`, `/dashboard/*`, `/staff*`; the API serves `/conversations*`, `/approvals*`, `/calls*`, `/notifications*`, `/health*` (`apps/api/src/communication/api/*.controller.ts`). The intersection is the empty set. Casing (snake vs camel), error body, pagination, auth transport, socket namespace and 9 of 11 realtime event names also differ (§4).
4. **What is preserved:** the app shell and provider tree, the fetch client and error model, query-key/invalidation-on-event discipline, AR/EN + RTL i18n, the design tokens, the shared Badge/Dialog/States components, the Composer/Thread/ReasonDialog/FamilyPanel UI, and the test harness — roughly 45% of the lines by label (KEEP 1,398 + REUSE 1,700 of 6,128).
5. **Baseline confirmed read-only:** `npm run typecheck` exit 0, `npx vitest run` 11 files / 74 tests passed (§8). One assertion is known-wrong on product grounds (`capabilities.test.ts:19-21`, "has no super_admin role") and is left untouched for Phase 1.

---

## 2. Classification table

Phase: **1** = identity / auth / authorization · **2** = console rework · **later** = after the console lands.
Paths are relative to `apps/admin-web/src/`.

### 2.1 App shell

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `app/App.tsx` | 26 | Provider tree: I18n → QueryClient → Session → Realtime → Router | **KEEP** | Domain-free composition root. | — |
| `app/AppRoutes.tsx` | 58 | Route table + `Area` gate | **REUSE** (guidance said KEEP; disagree) | Routes to Tasks/Coverage/Dashboard (`:44-46`), department home logic `homeFor` (`:26-29`), and a comment reserving `/approvals` and `/calls` as "not in the brief" (`:47-53`) — those two are precisely what the API exposes. Route table must be re-pointed; the `Area` pattern (`:20-24`) stays. | 2 |
| `app/AppShell.tsx` | 106 | Header, nav rail registry, connection banner | **REUSE** (guidance said KEEP; disagree) | Nav registry (`:9-16`, `:18-37`) is KEEP-quality, but the file mounts `ShiftEndBanner` (`:7`, `:99`) and `DutyIndicator` reads `duty.in_shift` / `covering_for` (`:51-62`) from the obsolete `/me/duty`. Three edits, not a rewrite. | 2 |
| `app/ForbiddenPage.tsx` | 12 | 403 page | **KEEP** | Generic. | — |
| `app/queryClient.ts` | 23 | React-Query defaults; no retry on 4xx | **KEEP** | Domain-free; the "no retry on 403" rule (`:16`) is exactly right for the new contract too. | — |
| `main.tsx` | 14 | Bootstrap | **KEEP** | — | — |
| `vite-env.d.ts` | 10 | `VITE_API_BASE_URL`, `VITE_REALTIME_URL` | **KEEP** | Both env vars survive. | — |

### 2.2 core/api

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `core/api/client.ts` | 91 | `fetch` wrapper, query builder, `Idempotency-Key`, 401 hook | **REUSE** (guidance said KEEP; disagree) | Structure is right, but three lines are contract-bound: cookie session `credentials:'include'` and the "no token in JS" comment (`:45-52`) → bearer header; error parsing reads `message_en` / `message_ar` (`:68-69`) → API sends `{error:{code,message}}` (`apps/api/src/communication/api/http-exception.filter.ts:10-12`); `Idempotency-Key` header (`:41`) → API idempotency is `clientMessageId` in the body (`message.controller.ts:38-41`). | 1 |
| `core/api/client.test.ts` | 101 | 10 tests | **REUSE** | See §6: two tests assert the old auth/error shape. | 1 |
| `core/api/errors.ts` | 78 | `ApiError` (status/code/isForbidden/isConflict), bilingual fallbacks, `NetworkError` | **KEEP** | Class shape is contract-neutral; `messageAr` will be derived from `code` via i18n in `client.ts`, not here. | — |
| `core/api/errors.test.ts` | 48 | 5 tests | **KEEP** | Constructs `ApiError` directly; no endpoint or field-name dependency. | — |
| `core/api/endpoints.ts` | 228 | 48 endpoint functions in 9 groups | **REUSE** | Rewritten to the canonical contract; the "one typed function per route, idempotency minted here" pattern stays. Full mapping in §4. Six functions are never called (see 2.9). | 1 (session) / 2 (rest) |
| `core/api/queryKeys.ts` | 40 | Centralised keys | **REUSE** (guidance said KEEP the *pattern*; the file is re-keyed) | Pattern is KEEP; 21 of 26 keys are CRM (`inbox`, `familyCases`, `transferImpact`, `tasks*`, `coverage*`, `dashboard*`, `:13-39`). | 2 |

### 2.3 core/auth, permissions, realtime, i18n, theme

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `core/auth/SessionProvider.tsx` | 65 | `/me` + `/me/duty` queries, 401 → cache clear, `signOut` | **REUSE** | Keep provider + 401 handling (`:38-41`); switch to bearer + `/me`; drop the duty query and `duty` context value (`:29-36`, `:47`). | 1 |
| `core/permissions/capabilities.ts` | 84 | Role → nav areas, `managerOnly` table, `taskScopeFor` | **REUSE** | Header comment (`:1-18`) is the right philosophy. Re-key: `OPERATOR_ROLES` `['admin','coverage','manager']` (`:30`) → canonical `admin \| coverage_admin \| manager \| super_admin`; delete `DEPARTMENT_ROLES` (`:33`), `isDepartment` (`:39-41`), `taskScopeFor` (`:80-84`); `managerOnly` (`:68-77`) becomes the canonical permission keys; `NavArea` (`:21-27`) loses `tasks`/`coverage`/`dashboard`/`settings`. | 1 |
| `core/permissions/capabilities.test.ts` | 70 | 6 tests | **REUSE** | Rewritten in Phase 1. **Known-wrong assertion** `:19-21` ("has no super_admin role") contradicts PRD §3 (`docs/product/jawwid-chat-prd-v0.1.md:82`). Not edited in Phase 0. | 1 |
| `core/realtime/RealtimeProvider.tsx` | 145 | socket.io client, event → invalidation map, reconnect → invalidate-all | **REUSE** | Pattern kept (signals not state, `:23-29`; reconnect invalidation `:120-122`). Change: namespace `'/staff'` (`:10`) → default namespace (`realtime.gateway.ts:36` has no namespace); `withCredentials` (`:113`) → `auth: { token }` (gateway `:53-57` reads `handshake.auth`, Phase 1 token); handler map (`:36-94`) re-pointed to `CommEvent` names (§4.3); add explicit `conversation.subscribe` emit for the open conversation (gateway `:78-90`) — the current comment "the client never joins rooms of its own choosing" (`:110-111`) is not how the API works. `hasEverConnected` (`:15`, `:136`) is exported but never read. | 1 (auth) / 2 (map) |
| `core/realtime/events.ts` | 35 | 11 CRM event types | **REWORK** | Replace with the payload types from `apps/api/src/communication/contracts/events.ts` (19 events, camelCase). Only `message.created` and `presence.changed` share a name, and both payloads differ. | 2 |
| `core/realtime/realtime.test.tsx` | 122 | 5 tests | **REUSE** | Harness (mock socket `:9-21`) stays; event names/payloads rewritten. | 2 |
| `core/i18n/I18nProvider.tsx` | 103 | Locale, `dir`, `Intl` formatters, `localStorage` | **KEEP** | Domain-free. | — |
| `core/i18n/messages.ts` | 278 | AR/EN dictionary | **REUSE** (guidance said core/i18n KEEP; the dictionary is domain text) | Provider is KEEP; the dictionary loses `bucket.*`, `shift.*`, `case.*`, `task.*`, `coverage.*`, `dashboard.*`, `workload.*`, `ownership.*` (≈70 of 130 keys per locale) and gains queue/approval/assignment strings. The "every EN key has a non-identical AR string" invariant (`i18n.test.tsx:53-65`) must keep passing. | 2 |
| `core/i18n/i18n.test.tsx` | 76 | 6 tests | **REUSE** | Probes `inbox.openCases` (`:15`, `:44`) and `bucket.*` keys (`:67-75`); swap keys, keep tests. | 2 |
| `core/theme/tokens.css` | 146 | Design tokens; attention colours `--now/--today/--waiting/--quiet` | **KEEP** | Tokens are generic "urgency tones"; names are internal. | — |
| `core/theme/app.css` | 334 | Layout, rail, rows, thread, composer, badges, dialog, table, `.metric` | **KEEP** | Class vocabulary (`.row`, `.thread`, `.msg--internal`, `.composer`) already reads as conversation UI; `.dot--*` (`:116-126`) become queue-section dots. `.metric` (dashboard) is harmless CSS. | — |

### 2.4 features/auth

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `features/auth/LoginPage.tsx` | 69 | Email/password form → `sessionApi.login`, seeds `qk.me` | **REUSE** | Form stays; on success store the bearer token and fetch `/me` instead of trusting the login response as the staff object (`:16-19`). | 1 |

### 2.5 features/inbox → conversation queue

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `features/inbox/InboxPage.tsx` | 150 | Five bucket tabs (`:17`), "away" toggle, order-feedback button, mounts `FamilyWorkspace` | **REWORK** | Shell (list column + workspace column, `:101-148`) stays; sections become `needs_reply` / `pending_approval` / `unanswered`; drop `AwaySummary` (`:9`, `:126-129`) and `OrderFeedbackDialog` (`:8`, `:80-87`, `:63-76`). Route param `familyId` → `conversationId`. | 2 |
| `features/inbox/InboxRowItem.tsx` | 57 | Renders `InboxRow`: bucket dot, `top_reason`, handling/tier/at-risk/renewal/open-cases/response-target badges | **REWORK** | Row shell stays; fields become `ConversationSummary` (`familyId`, `state`, `needsReply`, `handlerId`, `lastActivityAt`, pending-approval count). `tier`/`renewal_due`/`open_case_count` badges (`:42-47`) go. | 2 |
| `features/inbox/InboxRowItem.test.tsx` | 74 | 7 tests | **REUSE** | Rewritten around `ConversationSummary`; the "no phone number", "no score" and "click selects" assertions (`:19-27`, `:59-73`) carry over verbatim in spirit. | 2 |
| `features/inbox/hooks.ts` | 63 | `useInboxSection` (infinite query) + shift/away/order-feedback hooks | **REWORK** | `useInboxSection` (`:11-22`) is the queue hook; `useShiftBanner`, `useAwaySummary`, `useSnoozeToNextShift`, `useOrderFeedback` (`:24-63`) are deprecated with their components. | 2 |
| `features/inbox/AwaySummary.tsx` | 46 | Handoff list since last shift | **DEPRECATE** | Brief §4 shift-handoff concept; no API entity, no canonical event. | later |
| `features/inbox/ShiftEndBanner.tsx` | 37 | "Shift ends in N minutes" + snooze | **DEPRECATE** | Depends on `/inbox/shift-banner` and `shift.ending` — both obsolete. | later |
| `features/inbox/OrderFeedbackDialog.tsx` | 65 | Attention-weight calibration feedback | **DEPRECATE** | Brief §6 calibration of the attention engine; not in PRD. | later |

### 2.6 features/family → family + its conversations

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `features/family/FamilyWorkspace.tsx` | 86 | Actions + CaseCards + Thread (filtered by case) + Composer + FamilyPanel | **REWORK** | Three-part layout stays; remove case filtering (`:17`, `:21-22`, `:41-48`, `:55-67`), rename `Thread` → `ConversationView`, key on `conversationId`, show the family's other conversations. | 2 |
| `features/family/FamilyPanel.tsx` | 176 | Family 360: state/tier/urgent badges, owner + on-duty, contacts, learners, subscription, pinned notes, recent cases, open tasks | **REUSE** | Keep header, owner/handler, contacts (no phone — `:14-15` invariant kept), learners (`:69-104`). Drop `tier` (`:29`), subscription/renewal (`:21`, `:106-134`), recent cases (`:151-161`), open tasks (`:163-173`). PRD §7.5 does list subscription/renewal in the Family panel; the product direction for Phase 2 removes them from Admin Web pending the Core integration contract — recorded, not resolved here. | 2 |
| `features/family/Composer.tsx` | 115 | Reply / internal-note tabs, server-gated `can_send_customer_message`, idempotency key, Enter-to-send | **REUSE** | Behaviour is exactly the API's composer contract (`docs/communication/admin-contract.md` "Composer authority"). Changes: drop `activeCaseId` / `case_id` (`:19`, `:23`, `:41`); idempotency key becomes `clientMessageId` in the body (`:43`); "why you cannot reply" now comes from the send error code (`COMM.NOT_ON_DUTY`, `COMM.ASSIST_NOT_PERMITTED`) or a `/conversations/:id` capability field per the contract. | 2 |
| `features/family/Composer.test.tsx` | 147 | 9 tests | **REUSE** | 8 of 9 survive with field renames; `:116-125` (`case_id`) is deprecated. See §6. | 2 |
| `features/family/Thread.tsx` | 79 | Message list: contact/staff/system/internal kinds, `on_behalf_mode` badge, attachments count | **REUSE** | Rename to `ConversationView`; field names `author_type`/`on_behalf_mode`/`created_at` → `authorKind`/`onBehalfMode`/`createdAt`; the four-kind rendering rule (`:18-22`) is unchanged. | 2 |
| `features/family/Thread.test.tsx` | 71 | 5 tests | **REUSE** | Same renames; assertions unchanged. | 2 |
| `features/family/ReasonDialog.tsx` | 71 | Reason-collecting confirm dialog | **REUSE** | Generic. The hint key `ownership.reasonRequired` (`:62`) moves to a neutral key; the API's membership and rejection endpoints require a reason too (`conversation.controller.ts:49`, `approval.controller.ts:29`). | 2 |
| `features/family/FamilyActions.tsx` | 178 | Escalate, follow-up, task, keep, for-owner, transfer-ownership; `FollowUpDialog` | **REWORK** | Keep the action-bar shell and the two stickiness controls (`:68-84`); remove case-bound escalate/follow-up (`:41-57`, `:92-116`, `:137-178`) and task (`:59-66`, `:118-124`); transfer (`:36-37`, `:86-90`, `:126-132`) becomes supervisor assignment. | 2 |
| `features/family/FamilyActions.test.tsx` | 147 | 8 tests | **REUSE** | Ownership tests (`:30-119`) become assignment tests; handling test (`:128-137`) survives; `:139-146` (case gating) deprecated. | 2 |
| `features/family/TransferOwnershipDialog.tsx` | 99 | Staff picker (filtered to `role === 'admin'`), transfer-impact preview, reason | **REWORK** | Becomes the supervisor-assignment dialog: picker + reason stay; delete the impact preview (`:32`, `:70-94`) and `WorkloadBadge` import (`:6`). The client-side candidate filter (`:35-38`) is a server rule — see §5 finding **A-1**. | 2 |
| `features/family/CaseCards.tsx` | 83 | Open cases above the thread; owner-locked close rule | **DEPRECATE** | C-3: no Case entity. | later |
| `features/family/CaseCards.test.tsx` | 82 | 5 tests | **DEPRECATE** | With the component. | later |
| `features/family/FamiliesPage.tsx` | 124 | Family search + bucket filter; columns state/owner/on-duty/open cases | **REWORK** (not in guidance) | Shell (search, table, load-more) stays as the family directory; bucket filter (`:12`, `:25`, `:55-69`) and `open_case_count` (`:86`, `:104`) go; rows link to the family's conversations. | 2 |
| `features/family/hooks.ts` | 176 | Family/messages/cases queries; send, case, note, handling, transfer mutations | **REWORK** | Keep `useFamily`, `useFamilyMessages`, `useSendMessage`, `useHandlingActions` (`:7-26`, `:41-61`, `:131-149`); delete case hooks (`:28-34`, `:63-129`); `useTransferImpact` (`:151-157`) goes; `useTransferOwnership` (`:163-174`) becomes `useAssignSupervisor`. `useAddNote` and `useCreateCase` are exported and never called. | 2 |

### 2.7 features/tasks, coverage, dashboard

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `features/tasks/TasksPage.tsx` | 140 | Scope-by-role task table, complete/reopen | **DEPRECATE** | No task endpoint in the API. Note: PRD §7.6 keeps *Tasks and follow-ups* in the product, so "deprecate" here means frozen until a canonical Task contract exists — not a product removal. Department-role branch `:85-86` is also department logic. | later |
| `features/tasks/CreateTaskDialog.tsx` | 108 | Task form routed to a department | **DEPRECATE** | As above; `case_id` (`:23`, `:43`) is C-3. | later |
| `features/tasks/hooks.ts` | 45 | Task queries/mutations | **DEPRECATE** | As above. | later |
| `features/coverage/CoveragePage.tsx` | 227 | Tonight, gaps, shifts, rules, absences; activate backup | **DEPRECATE** | Coverage configuration is a manager admin-panel module (PRD §10.1 "People & routing"), not the console; the API has a `CoverageService` seam but no routes. | later |
| `features/coverage/hooks.ts` | 59 | Coverage queries/mutations | **DEPRECATE** | As above. `useCreateShift`, `useCreateRule` are never called. | later |
| `features/dashboard/DashboardPage.tsx` | 218 | Unattended/escalations tiles, team-now workload table, needs-action, this-week renewals/at-risk | **DEPRECATE** | Replaced by the locked direction in §7; renewals/at-risk/workload are CRM metrics. | later |

### 2.8 shared, types, test harness

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `shared/components/Badge.tsx` | 68 | `Badge`, `BucketDot`, `HandlingBadge`, `WorkloadBadge`, `ResponseTargetBadge` | **KEEP** (file) / **DEPRECATE** `WorkloadBadge` `:42-51` | `Badge` and `Dialog`-style primitives are generic; `BucketDot` (`:15-23`) and `HandlingBadge` (`:30-40`) get re-keyed props in Phase 2; `WorkloadBadge` is used only by the deprecated dashboard and the transfer-impact preview. | — / later |
| `shared/components/Dialog.tsx` | 68 | Modal with Escape + focus restore | **KEEP** | Generic. | — |
| `shared/components/States.tsx` | 68 | Loading/Error/Empty/QueryBoundary | **KEEP** | Generic; "no retry on 403" (`:14-18`). | — |
| `shared/components/States.test.tsx` | 77 | 8 tests | **KEEP** | No domain dependency. | — |
| `shared/hooks/useDebounced.ts` | 13 | Debounce | **KEEP** | — | — |
| `shared/types/domain.ts` | 354 | `StaffRole`, `InboxRow`, `Case`, `Task`, `Handoff`, `Shift`, `CoverageRule`, `Absence`, `TeamNowRow`, `Paginated` | **REWORK** | Becomes the canonical `Conversation` / `ConversationSummary` / `Message` / `Family` / `Learner` / `Contact` / `Staff` types (camelCase). Header rule "There is no `super_admin` role" (`:8`) is wrong per PRD §3. `Contact` (`:93-105`) and `Learner` (`:107-115`) survive with renames; `Paginated` (`:351-354`) → `{items, nextCursor}`. | 1 (roles) / 2 (rest) |
| `test/utils.tsx` | 195 | `renderWithProviders`, `createTestQueryClient`, fixtures, `ROLES` | **REUSE** (guidance said KEEP minus CRM fixtures; the file changes) | Harness (`:20-54`) is KEEP; fixtures `makeCase` (`:122-141`), `makeInboxRow` (`:87-104`), `makeFamilyDetail` case/task/subscription fields (`:178-181`) and `ROLES` (`:187-195`, no `super_admin`, has departments + `system`) are rewritten. The synthetic-names rule (`:56-62`) stays. | 1 (`ROLES`) / 2 |

### 2.9 Dead code and brief-era leftovers

| Path | Lines | Today | Label | Reason | Phase |
|---|---:|---|---|---|---|
| `features/settings/` | 0 | Empty directory | **REMOVE LATER** | `'settings'` is a `NavArea` (`capabilities.ts:27`) filtered out of the rail (`AppShell.tsx:29`) with no route. | later |
| `features/ownership/` | 0 | Empty directory | **REMOVE LATER** | Ownership UI lives in `features/family`. | later |
| `core/config/` | 0 | Empty directory | **REMOVE LATER** | `configApi` (`endpoints.ts:41-45`) has no caller. | later |
| `zustand` (`apps/admin-web/package.json:21`) | — | Dependency | **REMOVE LATER** | Zero imports under `src/` (grep). | later |
| `endpoints.ts` `configApi.get/update` `:42-45`, `coverageApi.updateShift` `:168`, `updateRule` `:175`, `createAbsence` `:180`, `dashboardApi.unattended` `:218`, `staffApi.offboard` `:226` | — | Endpoint functions with zero call sites | **REMOVE LATER** | Never invoked from any hook or component; disappear with the endpoint rewrite. | 2 |
| `features/family/hooks.ts` `useAddNote` `:103-113`, `useCreateCase` `:115-129`; `features/coverage/hooks.ts` `useCreateShift` `:44-46`, `useCreateRule` `:50-52`; `RealtimeProvider.tsx` `hasEverConnected` `:15` | — | Exported, never consumed | **REMOVE LATER** | Dead exports. | 2 |

**Totals by label (lines):** KEEP 1,398 · REUSE 1,700 · REWORK 1,183 · DEPRECATE 1,847 · REMOVE LATER 0 (dirs/dep/dead exports carry no separate line count).

---

## 3. Vocabulary migration map

| Current term (client) | Canonical term | Where it lives today (file:line) | Note |
|---|---|---|---|
| thread | **Conversation** | `Thread.tsx` (whole file), `Thread.test.tsx`, `FamilyWorkspace.tsx:12,44-48`, `domain.ts:12`, `hooks.ts:132`, `messages.ts:43,176` (`handling.sticky` "You kept this thread") | Component renamed `ConversationView`. A family has *several* conversations (`admin-contract.md` "Conversations for a family"), not one thread. |
| case / `Case` / `case_id` / `open_case_count` | **removed (C-3)** | `domain.ts:126-165,181,278,281`, `endpoints.ts:89,92-96,129-136,151`, `hooks.ts:28-34,63-129`, `CaseCards.tsx`, `FamilyActions.tsx:41-57,92-116`, `FamilyPanel.tsx:151-161`, `FamilyWorkspace.tsx:17-22,41-48,55-67`, `Composer.tsx:19,23,41`, `InboxRowItem.tsx:45-47`, `FamiliesPage.tsx:86,104`, `events.ts:22`, `RealtimeProvider.tsx:47-51`, `queryKeys.ts:20`, `messages.ts:33,53,71,80-87`, `test/utils.tsx:122-141`, `CreateTaskDialog.tsx:23,43` | Its role is served by Conversation state + Task/Follow-up + attention (OD-01 C-3). No replacement "case type". |
| `InboxRow` | **`ConversationSummary`** | `domain.ts:65-80`, `InboxRowItem.tsx`, `inbox/hooks.ts:4,20`, `FamiliesPage.tsx`, `endpoints.ts:60,111,219`, `test/utils.tsx:87-104`, `realtime.test.tsx:63-65` | Fields from `ConversationUpdatedPayload` (`events.ts:81-88` in the API): `conversationId`, `familyId`, `state`, `needsReply`, `lastActivityAt`, `handlerId`. |
| `AttentionBucket` `now / today / waiting_family / quiet` + `covering` | **queue sections** `needs_reply / pending_approval / unanswered` | `domain.ts:45`, `endpoints.ts:49`, `InboxPage.tsx:17`, `FamiliesPage.tsx:12`, `Badge.tsx:15-23`, `queryKeys.ts:13`, `messages.ts:19-23,152-156`, `tokens.css --now/--today/--waiting/--quiet` | Server-computed membership stays the rule (`inbox/hooks.ts:6-10`). |
| `top_reason` (attention text) | dropped | `domain.ts:70`, `InboxRowItem.tsx:38` | Attention engine text is not in the API; rows show state + waiting duration. |
| `sticky_threads` / `HandlingMode 'sticky'` / pin-handler / defer-to-owner | **conversation stickiness** (`stickyHandlerId`, `stickyUntil`) | `endpoints.ts:26,99-101`, `domain.ts:41`, `hooks.ts:131-149`, `FamilyActions.tsx:68-84`, `messages.ts:75-76` | API model already has it (`authorization.service.ts:38-39,270-272`); routes to set it are contract items (§4). |
| `owner` / `on_duty` / `handling_mode` | **supervisor** (family owner) / **handler** (`handlerId`) / `onBehalfMode` (message attribution only) | `domain.ts:36-42,75-77,275-276`, `FamilyPanel.tsx:40-54`, `InboxRowItem.tsx:41`, `Thread.tsx:41-45`, `Badge.tsx:30-40` | `onBehalfMode` is derived server-side and displayed on staff messages (`admin-contract.md` "Composer authority"). |
| transfer ownership / `transferImpact` | **supervisor assignment** (no impact preview) | `TransferOwnershipDialog.tsx`, `FamilyActions.tsx:36-37,86-90,126-132`, `hooks.ts:151-174`, `endpoints.ts:112-126`, `events.ts:26`, `messages.ts:118-124,251-257` | — |
| `StaffRole` `coverage` → **`coverage_admin`**; `finance/technical/academic` → **department (not a role)**; `system` → removed; **`super_admin` added** | canonical `admin \| coverage_admin \| manager \| super_admin` | `domain.ts:15-22`, `capabilities.ts:30-33`, `test/utils.tsx:187-195`, `AppRoutes.tsx:26-29`, `TasksPage.tsx:85-86` | PRD §3 (`prd-v0.1.md:79-82`); migration evidence `docs/recovery/evidence/uncommitted/ai4-…canonical_roles.sql:3-14`. The API's own `vocab.ts:17-24` still says `coverage` + departments — a Phase 1 item on both sides. |
| `Presence` `online \| away \| offline` | `online \| offline` + `lastSeenAt` | `domain.ts:24`, `events.ts:29`, `DashboardPage.tsx:100` | API `PresencePayload` (`events.ts:75-79`). |
| `Message.author_type / on_behalf_mode / created_at / visibility 'customer'` | `authorKind / onBehalfMode / createdAt / visibility` per contract | `domain.ts:167-193`, `Thread.tsx:18-22,41`, `test/utils.tsx:106-120` | API `MessageCreatedPayload` (`events.ts:36-46`). Visibility value set is the contract's. |
| `Handoff`, `AwaySummary` | none | `domain.ts:215-236`, `AwaySummary.tsx`, `events.ts:24` | PRD §7.5 keeps "hand off to another admin with a note" as an action; no entity in the API. Later. |
| `Task` | frozen (PRD §7.6) | `domain.ts:195-213`, `features/tasks/*` | Awaits a canonical Task contract. |
| `Subscription`, `FamilyTier`, `renewal_due` | dropped from Admin Web | `domain.ts:55,117-124`, `FamilyPanel.tsx:21,106-134`, `InboxRowItem.tsx:42-44` | See 2.6 FamilyPanel note. |
| `WorkloadLevel`, `TeamNowRow`, `Shift`, `CoverageRule`, `Absence`, `CoverageGap` | dropped | `domain.ts:287-349` | Manager admin-panel / dashboard, later. |
| `Paginated<T> { items, next_cursor }` | `{ items, nextCursor }` | `domain.ts:351-354`, every `getNextPageParam` (`inbox/hooks.ts:16`, `family/hooks.ts:20`, `FamiliesPage.tsx:35`, `tasks/hooks.ts:15`) | — |
| snake_case everywhere (`family_id`, `to_staff_id`, `is_active`, …) | camelCase | all of `domain.ts`, `endpoints.ts` request bodies, `events.ts` | API bodies are camelCase (`conversation.controller.ts:24,55-62`, `message.controller.ts:47-57`). |
| `'Jawwid Operations'` (`messages.ts:11,144`) | Communication Operations Console | `app.title` | Naming only. |

---

## 4. Contract migration

Authority: `docs/contracts/API-CONTRACT.md`. Status legend: **EXISTS** = route present in `apps/api/src/communication/api/*` today · **CONTRACT** = to be defined by API-CONTRACT.md, not in `apps/api` yet · **OBSOLETE** = no canonical counterpart.

### 4.1 Cross-cutting differences

| Concern | Admin Web today | API today / canonical | Evidence |
|---|---|---|---|
| Base URL | `/api/v1` default (`client.ts:3-4`) | `/api/v1` global prefix | `apps/api/src/main.ts:34-36` — the one thing that already matches. |
| Field casing | snake_case | camelCase | `endpoints.ts:63,124`; `conversation.controller.ts:24,55-62`. |
| Error body | expects `{error:{code,message_en,message_ar,detail}}` (`client.ts:64-70`) | `{error:{code,message}}` | `http-exception.filter.ts:10-12`. Client must map `code` → localized string. |
| Pagination | `{items, next_cursor}` cursor (`domain.ts:351-354`) | messages: `{messages, nextBefore}` by `seq` (`message.service.ts:372,399`); conversations: `{conversations}` unpaginated (`conversation.controller.ts:16`); **canonical:** `{items, nextCursor}` | The infinite-query hooks keep their shape; only `getNextPageParam` changes. |
| Auth transport | cookie session, `credentials:'include'` (`client.ts:45-52`); `POST /auth/login` returns `Staff` | today `x-actor-id` header (deprecated seam, `actor.decorator.ts:3-16`); **Phase 1:** bearer token | Phase 1. |
| Idempotency | `Idempotency-Key` header (`client.ts:41`) | `clientMessageId` in send body (`message.controller.ts:38-41,52`) | Header support for other writes is a contract question. |
| Realtime namespace | `/staff` (`RealtimeProvider.tsx:10`) | default namespace (`realtime.gateway.ts:36`) | — |
| Realtime auth | `withCredentials` (`RealtimeProvider.tsx:113`) | today `handshake.auth.actorId`; **Phase 1:** `handshake.auth.token` (`realtime.gateway.ts:53-57`) | — |
| Room subscription | none — expects server to subscribe (`RealtimeProvider.tsx:110-111`) | client must emit `conversation.subscribe {conversationId}`; actor room is automatic (`realtime.gateway.ts:69-70,78-90`) | Provider gains subscribe/unsubscribe on conversation open/close. |
| Role vocabulary | `admin \| coverage \| manager \| finance \| technical \| academic \| system` | canonical `admin \| coverage_admin \| manager \| super_admin` (PRD §3) | Both apps migrate in Phase 1. |

### 4.2 Endpoint by endpoint (`core/api/endpoints.ts`)

| # | Client function (line) | Current path | Canonical path / status | Note |
|---:|---|---|---|---|
| 1 | `sessionApi.me` `:30` | `GET /me` | `GET /me` — **CONTRACT** | Bearer; returns actor + role. Phase 1. |
| 2 | `sessionApi.duty` `:31` | `GET /me/duty` | **OBSOLETE** | Shift/duty state is not a client concern; handler arrives per conversation (`handlerId`). |
| 3 | `sessionApi.login` `:32-33` | `POST /auth/login` | `POST /auth/login` — **CONTRACT** | Token issuance. Phase 1. |
| 4 | `sessionApi.logout` `:34` | `POST /auth/logout` | **CONTRACT** | Token revocation. Phase 1. |
| 5 | `configApi.get` `:43` | `GET /config` | `GET /config` — **CONTRACT** (deferred; `docs/recovery/evidence/uncommitted/README.md` row `ai7-config.controller.ts`) | Never called today. |
| 6 | `configApi.update` `:44` | `PATCH /config` | **OBSOLETE** | Never called. |
| 7 | `inboxApi.section` `:59-60` | `GET /inbox?section=&cursor=&limit=` | `GET /conversations` — **EXISTS** (unpaginated, RBAC-scoped `conversation.controller.ts:13-17`); section filters + cursor — **CONTRACT** | Queue sections map to `needsReply` / pending approvals / `state` + age. |
| 8 | `inboxApi.awaySummary` `:61` | `GET /inbox/away-summary` | **OBSOLETE** | — |
| 9 | `inboxApi.shiftBanner` `:62` | `GET /inbox/shift-banner` | **OBSOLETE** | — |
| 10 | `inboxApi.snoozeToNextShift` `:63-64` | `POST /inbox/snooze-to-next-shift` | **OBSOLETE** | — |
| 11 | `inboxApi.orderFeedback` `:69-74` | `POST /inbox/order-feedback` | **OBSOLETE** | — |
| 12 | `familyApi.detail` `:80` | `GET /families/:id` | **CONTRACT** (family context from Core: contacts, learners, supervisor) | Not in `apps/api`. |
| 13 | `familyApi.messages` `:81-82` | `GET /families/:id/messages` | `GET /conversations/:conversationId/messages` — **EXISTS** (`message.controller.ts:21-35`) | `before`/`after` by `seq`; canonical `{items,nextCursor}`. |
| 14 | `familyApi.sendMessage` `:87-91` | `POST /families/:id/messages` | `POST /conversations/:conversationId/messages` — **EXISTS** (`message.controller.ts:42-57`) | Body: `body`, `visibility`, `clientMessageId`, optional `requestedMode`; no `case_id`. |
| 15 | `familyApi.cases` `:92` | `GET /families/:id/cases` | **OBSOLETE** (C-3) | — |
| 16 | `familyApi.createCase` `:93-96` | `POST /families/:id/cases` | **OBSOLETE** (C-3) | — |
| 17 | `familyApi.addNote` `:97-98` | `POST /families/:id/notes` | → #14 with `visibility: internal` | Internal note is a message (`admin-contract.md` "Internal notes"). Hook never called anyway. |
| 18 | `familyApi.pinHandler` `:99` | `POST /families/:id/pin-handler` | **CONTRACT** — set conversation stickiness | Model exists (`stickyHandlerId`), no route. |
| 19 | `familyApi.deferToOwner` `:100-101` | `POST /families/:id/defer-to-owner` | **CONTRACT** — clear stickiness | As above. |
| 20 | `familyApi.list` `:102-111` | `GET /families?q=&owner_id=&bucket=…` | **CONTRACT** — family directory; conversations by family via `GET /conversations?familyId=` (`admin-contract.md` says "filter by familyId"; the controller has no query param today) | — |
| 21 | `familyApi.transferImpact` `:112-119` | `GET /families/:id/transfer-impact` | **OBSOLETE** | CRM preview removed by direction. |
| 22 | `familyApi.transferOwnership` `:121-126` | `POST /families/:id/transfer-ownership` | **CONTRACT** — supervisor assignment (reason required) | Phase 2; server rule A-1 (§5). |
| 23-25 | `caseApi.update/escalate/followUp` `:130-135` | `PATCH /cases/:id`, `POST /cases/:id/escalate`, `POST /cases/:id/follow-up` | **OBSOLETE** (C-3) | Escalation to manager (PRD §7.5) is a conversation action — later; `requestedMode: 'escalation'` on send exists (`authorization.service.ts:27-30`). |
| 26-28 | `taskApi.list/create/update` `:141-159` | `GET/POST /tasks`, `PATCH /tasks/:id` | **CONTRACT (later)** | PRD §7.6 keeps tasks; no API today. Frozen. |
| 29-41 | `coverageApi.*` `:165-187` (13) | `/coverage/shifts|rules|absences|tonight|gaps`, `/absences/:id/activate-backup` | **OBSOLETE** for Admin Web | Manager admin-panel module (PRD §10.1); `updateShift`, `updateRule`, `createAbsence` never called. |
| 42-46 | `dashboardApi.header/teamNow/unattended/needsAction/thisWeek` `:216-221` | `/dashboard/*` | **OBSOLETE**; replaced by §7 direction | `unattended` never called. |
| 47 | `staffApi.list` `:225` | `GET /staff` | **CONTRACT** — staff picker for assignment | Phase 2. |
| 48 | `staffApi.offboard` `:226-227` | `POST /staff/:id/offboard` | **OBSOLETE** for Admin Web (admin panel, later) | Never called. |

**API routes with no client today** that the console needs: `GET /approvals/pending`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject {reason}`, `GET /approvals/history/:conversationId` (`approval.controller.ts:12-43`) for the `pending_approval` section; `POST /conversations/:id/messages/read`, `GET …/unread` (`message.controller.ts:100-113`) for unanswered/unread; `GET /calls/history/:conversationId` (`call.controller.ts:47`) for family context; `POST /conversations/:id/members` (reason required) for membership changes; `GET /conversations/:id` for the conversation header.

### 4.3 Realtime events (`core/realtime/events.ts` → `apps/api/src/communication/contracts/events.ts`)

| Client event (line) | Invalidates today (`RealtimeProvider.tsx`) | Canonical event | Note |
|---|---|---|---|
| `family.updated` `:13-20` | inboxAll, family | `conversation.updated` (`ConversationUpdatedPayload` `:81-88`) | Carries `familyId`, `state`, `needsReply`, `handlerId` — the queue row. |
| `message.created` `:21` | familyMessages, inboxAll | `message.created` (`:36-46`) | Same name, different payload (`conversationId`, `messageId`, `seq`, `moderation`). |
| `case.updated` `:22` | familyCases, family, inboxAll | **none** (C-3) | Remove handler `:47-51`. |
| `task.updated` `:23` | tasksAll, family, inboxAll | **none** (later) | Remove handler `:53-59`. |
| `handoff.created` `:24` | awaySummary, inboxAll | **none** | Nearest: `conversation.membership_changed` (`:90-94`). |
| `coverage.changed` `:25` | coverageAll, duty, inboxAll | **none** | Handler changes surface as `conversation.updated.handlerId`. |
| `ownership.changed` `:26` | family, inboxAll, dashboardAll | **CONTRACT** (supervisor-assignment event) | Not in the API's 19 events. |
| `unattended.changed` `:27` | dashboardHeader, unattended | **none** | Derived from `conversation.updated`. |
| `escalation.created` `:28` | needsAction, dashboardHeader | **none** | Later. |
| `presence.changed` `:29` | teamNow | `presence.changed` (`:75-79`) | Same name; payload `actorId/state/lastSeenAt`. |
| `shift.ending` `:30` | shiftBanner | **OBSOLETE** | — |
| — | — | **new:** `approval.requested`, `approval.decided` (`:96-109`) | `pending_approval` section + conversation view. |
| — | — | **new:** `message.deleted`, `message.receipt.updated`, `reaction.added/removed` | Conversation view. |
| — | — | **new:** `notification.created` (`:133-140`, actor room) | Alerts. |
| — | — | **new:** `typing.started/stopped` | Optional in the console. |
| — | — | **new:** `call.*` | Family context "recent calls" (PRD §7.5). |

The invalidate-not-patch rule (`events.ts:3-11`, tested in `realtime.test.tsx:60-86`) carries over unchanged.

---

## 5. Client-side authorization audit

Every place a role or permission decision is made under `src/`. **UX-only** = a server check exists behind it or the decision cannot grant anything; **FLAG** = a business rule that exists only on the client.

| # | File:line | Decision | Class | Evidence / required server home |
|---:|---|---|---|---|
| 1 | `app/AppRoutes.tsx:20-24` | `Area` renders `ForbiddenPage` unless `canOpenArea(role, area)` | UX-only | Comment `:15-19` states it; every page's queries are server-authorised. |
| 2 | `app/AppRoutes.tsx:26-29` | `homeFor`: departments land on `/tasks` | UX-only, **department logic (DEPRECATE)** | Departments are not roles (PRD §3). |
| 3 | `app/AppShell.tsx:27-29` | Rail shows `visibleAreas(role)` minus `settings` | UX-only | Navigation only. |
| 4 | `core/permissions/capabilities.ts:30-33, 48-61` | `OPERATOR_ROLES` / `DEPARTMENT_ROLES`, `visibleAreas` | UX-only | Header `:1-18` — nothing here grants. Re-keyed in Phase 1. |
| 5 | `core/permissions/capabilities.ts:68-77` | `managerOnly` table (transfer, coverage config, config weights, audit log, offboard, backup, team workload, unattended) | UX-only | Each is a hidden/shown control; the corresponding endpoint is OBSOLETE or CONTRACT and must be role-checked by `AuthorizationService`. |
| 6 | `core/permissions/capabilities.ts:80-84`, `features/tasks/TasksPage.tsx:23` | `taskScopeFor(role)` picks the `scope` query param (`mine` / `team` / `department`) the client *asks for* | **FLAG A-2** | The client chooses its own visibility scope. Any canonical list endpoint must scope by the authenticated actor and ignore (or validate) a client-supplied scope. Endpoint is OBSOLETE, so the flag is recorded for the contract, not fixed here. |
| 7 | `features/family/FamilyActions.tsx:36-37` | Transfer button only if `managerOnly.transferOwnership(role) && detail.capabilities.can_transfer_ownership` | UX-only (double-gated; server capability) | Test `FamilyActions.test.tsx:69-80` proves the server flag wins. |
| 8 | `features/family/TransferOwnershipDialog.tsx:35-38` | Recipient picker filtered to `member.is_active && member.id !== currentOwnerId && member.role === 'admin'` — comment "Only permanent owners can receive ownership; coverage is a duty, not a home" | **FLAG A-1** | The endpoint body (`endpoints.ts:121-126`) accepts any `to_staff_id`; nothing on the server side of this contract enforces "recipient must be a permanent-owner role, active, not the current owner". This is a business rule and must live in `apps/api/src/platform/authorization.service.ts` behind the supervisor-assignment route (Phase 2), with the client filter kept only as an affordance. |
| 9 | `features/tasks/TasksPage.tsx:85-86` | Departments see the family name as text, not a link | UX-only, **department logic (DEPRECATE)** | — |
| 10 | `features/tasks/CreateTaskDialog.tsx:85` | Assignee picker filtered to `is_active` | UX-only | Server must validate `owner_id` on create (endpoint frozen). |
| 11 | `features/family/CaseCards.tsx:34` | Close control hidden when `owner_locked && !capabilities.can_close_owner_locked` | UX-only (server capability) — DEPRECATE with cases | — |
| 12 | `features/family/Composer.tsx:30-31, 56, 71-77` | Customer tab disabled and forced to `internal` when `!capabilities.can_send_customer_message`; reason text from `assist_blocked_reason` | UX-only | The API decides in `AuthorizationService.canSend` and returns `COMM.NOT_ON_DUTY` / `COMM.ASSIST_NOT_PERMITTED` (`admin-contract.md`); `on_behalf_mode` is never sent (`Composer.test.tsx:80-90`). |
| 13 | `features/inbox/ShiftEndBanner.tsx:25` | Snooze shown only if server `can_snooze` | UX-only — DEPRECATE | — |
| 14 | `features/family/FamilyPanel.tsx:49`, `Thread.tsx:41-45`, `Badge.tsx:30-40` | Display of handler ≠ owner and `on_behalf_mode` badges | Display only | Attribution is server-derived. |
| 15 | `app/queryClient.ts:13-18` | No retry on 4xx (403 = "no fallback access attempt") | Infrastructure | Keep. |
| 16 | `core/auth/SessionProvider.tsx:38-41`, `core/api/client.ts:72` | 401 anywhere clears the whole cache | Infrastructure | Keep (Phase 1 also drops the token). |
| 17 | `core/realtime/RealtimeProvider.tsx:110-111` | Client never chooses rooms | Assumption, not a decision | Must change: the API requires `conversation.subscribe`, which the server authorises (`realtime.gateway.ts:78-90`). Still server-enforced. |

Result: 15 of 17 sites are UX-only or infrastructure; **A-1** (assignment recipient eligibility) and **A-2** (client-chosen list scope) are the two client-only business rules and are handed to the contract / `AuthorizationService`. No site grants access; none must be trusted.

---

## 6. Tests

11 files, 74 tests (`npx vitest run`, §8).

| File | Tests | Disposition | Detail |
|---|---:|---|---|
| `core/api/errors.test.ts` | 5 | **Survives as-is** | No endpoint/field dependency. |
| `shared/components/States.test.tsx` | 8 | **Survives as-is** | Generic components. |
| `core/i18n/i18n.test.tsx` | 6 | **Survives with key swaps** | `:15,44` (`inbox.openCases`), `:67-75` (`bucket.*`). The AR-completeness invariant `:53-65` is the valuable part. |
| `core/api/client.test.ts` | 10 | **Rewrite 2 of 10 (Phase 1)** | `:24-27` asserts cookie `credentials:'include'` → bearer header; `:47-68` asserts `message_en`/`message_ar` → `{code,message}` + code→i18n. `:38-41` (`Idempotency-Key`) depends on the contract's idempotency answer. Path strings (`/families`, `/cases`, `/dashboard`, `/coverage`) are inert fixtures. |
| `core/permissions/capabilities.test.ts` | 6 | **Rewrite entirely (Phase 1)** | **KNOWN-WRONG:** `:19-21` `expect(ROLES).not.toContain('super_admin')` contradicts PRD §3 (`prd-v0.1.md:82`); `:38-46` department roles; `:48-52` `coverage` label; `:64-69` `taskScopeFor`. **Not edited in Phase 0**; Phase 1 replaces it with the canonical-roles assertion. |
| `core/realtime/realtime.test.tsx` | 5 | **Rewrite (Phase 2)** | Harness stays; events `:48-55` → `conversation.updated`, `message.created`, `approval.*`, `presence.changed`; drop `case.updated`, `task.updated`, `coverage.changed`, `ownership.changed` cases (`:101-121`). The "invalidate, never patch" test `:60-86` keeps its shape. |
| `features/family/Composer.test.tsx` | 9 | **8 survive with renames; 1 deprecated** | `:116-125` (`case_id`) goes with C-3; `:80-90` becomes "never sends `onBehalfMode`"; `:92-101` becomes "sends `clientMessageId`". |
| `features/family/Thread.test.tsx` | 5 | **Survives with renames** | `Thread` → `ConversationView`; `author_type`/`on_behalf_mode` → `authorKind`/`onBehalfMode`. Assertions unchanged. |
| `features/family/FamilyActions.test.tsx` | 8 | **Rework** | Ownership block `:30-119` → supervisor assignment (same five behaviours: hidden for admin/coverage_admin, shown for manager when server allows, hidden when server denies, reason required, Escape cancels); handling `:128-137` survives; `:139-146` deprecated (case gating). |
| `features/inbox/InboxRowItem.test.tsx` | 7 | **Rework** | Rebuilt on `ConversationSummary`; keep "no phone number" `:59-64`, "no score/P1" `:19-27`, "click selects" `:66-73`. |
| `features/family/CaseCards.test.tsx` | 5 | **Deprecated with the feature** | C-3. |

Fixture impact (`test/utils.tsx`): `makeCase` `:122-141` deleted; `makeInboxRow` `:87-104` → `makeConversationSummary`; `makeFamilyDetail` `:160-185` loses `subscription`/`recent_cases`/`open_tasks`; `ROLES` `:187-195` → canonical four roles (Phase 1).

---

## 7. Future dashboard direction (locked, not built)

The console's supervisor/manager dashboard replaces `features/dashboard`. Metrics are the operational subset of PRD §10.2 that the communication engine can serve; renewals/at-risk/workload (`DashboardPage.tsx:172-192`, `:93-119`) are out until a Core/attention contract exists.

| Metric | Definition | API endpoint(s) needed | Status |
|---|---|---|---|
| Conversations needing a reply | count of `needsReply === true`, per handler and total | `GET /conversations` with `needsReply`, `handlerId`, cursor; aggregate endpoint | EXISTS (list, unfiltered) / **CONTRACT** (filters, aggregate) |
| Pending approvals + age | open approvals, oldest age | `GET /approvals/pending` (`approval.controller.ts:12-15`) | EXISTS; age field per contract |
| Unanswered conversations | `state = waiting_on_jawwid` older than the configured threshold | `GET /conversations?state=&olderThan=`; threshold from `GET /config` | **CONTRACT** |
| Communication activity | messages in/out per day, first-response time, resolution time (PRD §10.2 Load/Responsiveness) | dashboard aggregate endpoint | **CONTRACT** |
| Alerts | failed/urgent notifications, families with no handler, membership changes needing attention | `GET /notifications…`, `notification.created` (`events.ts:133-140`) | **CONTRACT** (list) / EXISTS (event) |
| Family context | contacts (no phone), learners, next class, recent calls | `GET /families/:id` (**CONTRACT**), `GET /calls/history/:conversationId` (EXISTS `call.controller.ts:47`) | mixed |
| Supervisor assignment | families per supervisor, families without supervisor, assignment history with reasons | supervisor-assignment route + event (**CONTRACT**), `GET /staff` (**CONTRACT**) | Phase 2 |
| Coverage | conversations handled under coverage (`onBehalfMode = coverage`), stickiness in effect | `GET /conversations?handlerId=` + message attribution | **CONTRACT** (aggregate) |

Rule carried over from `DashboardPage.tsx:10-14`: every tile links into the list it summarises. Rule carried over from `Badge.tsx:11-14`: no state by colour alone.

---

## 8. Verification (read-only, `apps/admin-web`, 2026-09-07)

| Command | Result | Exit |
|---|---|---:|
| `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) | no output — **0 errors** | 0 |
| `npx vitest run` (vitest 2.1.9, jsdom) | **Test Files 11 passed (11) · Tests 74 passed (74)** · duration 1.75 s | 0 |

Per-file: `client.test.ts` 10 · `capabilities.test.ts` 6 · `realtime.test.tsx` 5 · `Thread.test.tsx` 5 · `States.test.tsx` 8 · `i18n.test.tsx` 6 · `InboxRowItem.test.tsx` 7 · `CaseCards.test.tsx` 5 · `errors.test.ts` 5 · `FamilyActions.test.tsx` 8 · `Composer.test.tsx` 9 = 74.

Matches the 2026-09-07 pre-document baseline (0 errors / 74 passed). No file under `apps/admin-web` was modified; `git status --short apps/admin-web` is empty.
