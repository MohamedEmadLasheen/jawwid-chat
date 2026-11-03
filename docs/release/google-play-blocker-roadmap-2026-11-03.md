# Google Play blockers: implementation roadmap (2026-11-03)

**State: PLAN. No product code is written, and nothing is pushed, merged, deployed or uploaded.**
Base: `main` @ `3d669299`. Paths are relative to the repository root. Line numbers are from that
commit and are a guide, not a contract.

This plan turns the findings in `docs/release/google-play-readiness-2026-11-03.md` (draft PR #448)
into work packages. Every package lists:
- the exact files;
- the API, database and Flutter changes;
- the tests;
- the acceptance criteria;
- its dependencies, and its conflicts with other branches.

What only the owner can decide is collected in §1. Everything else is engineering, and it is
decided here.

---

## 0. Summary and order

| Prio | Package | Blocker | Size | Waits for |
|---|---|---|---|---|
| 1 | **WP-0 Reconcile the Android push line** | none on its own, but it unblocks WP-4 and WP-5 | coordination | nothing |
| 1 | **WP-1 Report content and users, with a moderation queue** | P-1 (UGC policy) | L: ~5-6 days, 3 PRs | O-1 (reasons, response time) |
| 1 | **WP-2 Block a user** | P-2 (UGC policy, 1:1 messaging) | M: ~3-4 days, 2 PRs | O-2 (what block means for staff); WP-1 PR-A (shared migration) |
| 1 | **WP-3 Terms acceptance before any content** | P-3 (UGC policy) | M: ~3-4 days, 2 PRs | O-3 (text, version, staff terms) |
| 1 | **WP-4 Store payment mode** | P-4 (payments policy) | M: ~2-3 days, 1-2 PRs | O-4 (payment strategy, copy) |
| 2 | **WP-5 Call foreground service (finish #411)** | P-6 | S: ~1 day on top of #411 | WP-0; #408, then #411, merged |
| 3 | **WP-6 Final Android release audit** | P-6/P-7 check, §6 of the readiness report | S: ~1 day | WP-4 and WP-5 merged, and the owner's Firebase file and key |

**Why this order**
- WP-1 to WP-4 are each a policy rejection on their own, and they touch different layers, so they run in parallel.
- WP-5 is already mostly built (PR #411). It is held back only by the duplicate push work (WP-0).
- WP-6 checks the artefact that is actually uploaded, so it comes last.

**Waves**
- **Wave A**, now: WP-0, plus WP-1 PR-A, WP-3 PR-A and WP-4 (API and Flutter in separate worktrees).
- **Wave B**: WP-1 PR-B and PR-C, WP-2, WP-3 PR-B, and WP-5 once #408 and #411 merge.
- **Wave C**: WP-6, then internal testing on Play.

**New PD numbers.** Claimed by adding the registry file in the first PR of each:
- **PD-57**: user safety (report, block, moderation). WP-1 and WP-2.
- **PD-58**: Terms of Use acceptance. WP-3.
- WP-4 and WP-5 belong to **PD-56** (store compliance, state BUILDING), as amendments.

**Migration slots.** Each is claimed by adding `docs/product/migration-slots/<ts>.md` in its PR.
- They must sort after every file on `main` **and** after `20261103120000`. That slot is used by the
  PD-32 amendment on the local branch `claude/pd032-feedback-reply-notifications` and is not yet on
  `main`.
- Proposed:
  - `20261104100000` `chat_pd057_reports_blocks`
  - `20261104110000` `chat_pd058_terms_acceptance`
- They are re-checked with `python3 -I scripts/docs/registry-index.py` at claim time.

---

## 1. Decisions that need the owner's approval

Each one has a recommendation. Engineering can start the parts that do not depend on the answer.

| # | Decision | Recommendation | What waits for it |
|---|---|---|---|
| **O-1** | **Report reasons and response time.** Which reasons a user picks from, and how fast the academy answers. | Five reasons: "Harassment or bullying", "Inappropriate or sexual content", "Spam or scam", "A child's safety", "Something else" (with a note). An answer to the reporter within **48 hours**. "A child's safety" is urgent: the super admin is told at once. | The Arabic and English copy (WP-1 PR-B), and the SLA wording in the terms |
| **O-2** | **What "Block" means when the other person is the academy's staff or a teacher.** In this app a parent's only 1:1 conversation is with staff (`AuthorizationService.canOpenDirect`, `apps/api/src/platform/authorization.service.ts:261`). Parents meet teachers only in the Student Group. | Block is **personal and never stops lessons**: the blocker no longer sees the blocked person's messages; no push or call from them reaches the blocker; and a 1:1 conversation from them is refused. **Every block opens a moderation case**, so a manager can reassign the supervisor or teacher. Families and teachers can block. Staff cannot block a family (they are the academy), but they can report. The academy's official account cannot be blocked. | WP-2 copy and rules |
| **O-3** | **The Terms of Use text and its version.** It must define and forbid objectionable content, say how reports and blocks work, and say that staff moderate. One text for everyone, or a separate staff agreement? | One Terms of Use for families, teachers and staff, with a conduct section, in Arabic and English, version 1, at the same URL as `TERMS_URL`. Staff also accept it on Admin Web. Changing the version asks everyone again. | WP-3 can be built and tested with a placeholder version; the store build needs the owner's text |
| **O-4** | **Payment strategy for the store builds.** | **Status-only mode for the first submission**, on both stores. Parents see each child's plan, lessons left, paused or active, past receipts and invoices. They see **no Pay button, no price or amount due, no card checkout, no bank details, and no receipt upload**. Payment happens outside the app, as now, through the staff pay link (`GET /pay/:token`, sent by Sales outside the app) or by bank transfer. **Later, as an app update:** turn card checkout back on under Play's 1:1 live-service exemption, once the owner confirms in writing that every paid service is a live 1:1 lesson that is never recorded. The code supports that already: `Lesson.learnerId` is a single learner, and nothing records calls or lessons. | The copy of the paused banner and of the payment reminders (WP-4) |
| **O-5** | **Neutral wording for payment notices** in store builds: the lock banner, the `subscription_locked` card, and the `payment_d7`…`payment_p7` reminders. | "Lessons for {child} are paused. The academy will contact you." Reminders say when the subscription ends, never how or where to pay. | WP-4 PR-B (server copy) |
| **O-6** | From the readiness report, still open: the package name (D-1), the account type (D-2), the target audience (D-3), the listing assets (D-4), the production backend and demo accounts (P-5), the Firebase project and upload key. | As in #448 §3. | WP-6 and the upload |
| **O-7** | **Code Owner approval for #408**, which changes `.github/workflows/ci.yml` (a Code Owner path). | Approve after review. | WP-0, then WP-5 |

---

## 2. Coordination with the Android push work (WP-0)

**What exists today. These are three lines of work, and two of them overlap.**

| Line | Where | What it does | State |
|---|---|---|---|
| **#408** `claude/android-push-fcm` | open PR | FCM token; draws data pushes (`JawwidMessagingService`, `JawwidPush`, `PushTokenStore`); an incoming-call CallStyle notification with a full-screen intent where Android allows it; `CallActionReceiver`; the `jawwid/call_native` contract on Android; an emulator ring test; `fcm.provider.ts` title, body and TTL; touches `.github/workflows/ci.yml` | CI green, last updated 2026-11-02 |
| **#411** `claude/android-call-foreground-service` | draft PR, stacked on #408 | `CallForegroundService`, started and stopped by `CallController`; ongoing-call notification with Hang up | CI green, 2026-11-02. **This is P-6, already built.** |
| **PD-32 amendment** `674765a1` / `24c10f39` | local branch `claude/pd032-feedback-reply-notifications`, not pushed | A **second** Android FCM implementation (`JawwidMessagingService`, `PushBridge`, `PushPresenter`, `PushPayload`, Firebase in Gradle); cross-platform notification taps (`lib/core/push/push_opens.dart`, `push_open_coordinator.dart`); the iOS `UNUserNotificationCenter` delegate; API `call-push-routing.ts`; PD-32 feedback notices | 31 files, local. Another session (release-readiness) plans to continue it in a new worktree |

**Conflict.** #408 and the PD-32 amendment both **create** `JawwidMessagingService.kt`, and both edit:
- `MainActivity.kt`, `AndroidManifest.xml`, `build.gradle.kts` and `settings.gradle.kts`;
- the Android `strings.xml` files;
- `fcm.provider.ts`.

Whichever merges second fails to merge. Its Android half also duplicates the first.

**Decision (engineering lead).** **#408 → #411 is the Android base.**
- Why:
  - it was first;
  - it is CI-green;
  - it is the only line with the call ring, the full-screen intent and the foreground service;
  - it has an emulator test.
- The PD-32 amendment keeps its **cross-platform** parts and is **rebased onto #408**:
  - notification taps, Dart and iOS;
  - `call-push-routing.ts`;
  - the feedback notices.
- It **drops its own Android FCM classes** and delivers Android taps through #408's `JawwidPush` instead.
- Recorded here and to be sent to the sessions involved. Nothing in their trees is changed by this plan.

**Rules for this plan's packages**
- WP-1 to WP-4 change **none** of these files:
  - `android/**`, `ios/**`;
  - `lib/core/push/**`, `lib/core/call_native/**`, `lib/features/calls/**`, `lib/features/notifications/application/**`;
  - `fcm.provider.ts`, `call-push-routing.ts`.
- WP-5 is done **on #411's branch**, by its owner or by this lead after confirming no session is working on it. It is never done in a parallel branch.
- WP-6 touches the manifest only after #408, #411 and #447 have merged.

**Other overlaps, found by comparing every open PR's files with this plan's files:**

| This plan's file | Also changed by | Handling |
|---|---|---|
| `lib/features/messages/presentation/chat_screen.dart` | #420 (PD-46 PR-2a); WP-1 (report action); WP-2 (hide blocked); WP-4 (`canPay`) | One package edits it at a time: WP-4, then WP-1, then WP-2, each rebased on the last. Keep each edit to a few lines that call a new widget or provider. |
| `apps/api/src/communication/realtime/realtime.gateway.ts` | #439 | WP-2 filters in `outbox/message-audience.ts` instead, and leaves the gateway alone. |
| `android/app/src/main/AndroidManifest.xml`, `scripts/mobile/build-store.sh` | #447, #408, #411 | WP-4 adds its define to `build-store.sh` only after #447 merges. WP-6 waits for all three. |
| `lib/l10n/app_ar.arb`, `app_en.arb` | most PRs (#443…) | New keys only, in a new block at the end; regenerate. |
| `notification-catalog.ts`, `router.dart`, `settings_screen.dart`, `parent_signup_screen.dart`, `notification_center_screen.dart` | the local PD-32 amendment | WP-1 adds one catalogue entry, WP-3 one checkbox and WP-4 one route branch. Each rebases on PD-32 if PD-32 merges first. |

Each package works in its **own worktree and branch**. No two agents ever share a tree.

---

## 3. WP-1: Report content and users (PD-57)

**Scope.** Things a user can report:
- any message posted by someone else: text, voice, photo, video, file and forwards, in any conversation;
- a **person**, from their profile.

Things that are not reportable:
- `system` and `card` messages, because the server writes them;
- **Stories**, which are written by staff only (`Story.createdBy` → `Staff`), so they are not user content. A "Report" in the story viewer is a cheap optional extra, added in PR-B only if time allows;
- **Feedback** (PD-32), because no other user sees it.

### PR-A: database and API

**Migration `20261104100000_chat_pd057_reports_blocks.sql`.** It follows the fail-closed pattern of `20261026120000_chat_pd032_parent_feedback_signup_code.sql`: RLS on, `revoke all ... from public, anon, authenticated, chat_app`, and one guard trigger function per table.

`chat.content_report` columns:
- `id`, `organization_id` (default `chat.default_organization_id()`);
- `reporter_kind`, `reporter_id` (the actor), and `reporter_account_id`;
- `target_kind` (`message` | `person`), `message_id` (nullable), `conversation_id` (nullable), `subject_kind`, `subject_id` (the person reported, or the author of the message);
- `reason` (`harassment` | `inappropriate` | `spam` | `child_safety` | `other`), `note` (≤ 500 characters);
- `evidence` jsonb: a snapshot taken at report time of the body, the attachment object keys and the timestamps. A later "delete for everyone" must not destroy the evidence;
- `status` (`open` | `in_review` | `actioned` | `dismissed`), `priority` (`urgent` for `child_safety`);
- `taken_by`, `taken_at`, `resolution` (`no_action` | `message_removed` | `warned` | `account_suspended` | `reassigned`), `resolution_note`, `resolved_by`, `resolved_at`, `reporter_answered_at`, `created_at`.

Constraints and protections:
- **Uniqueness:** one open report per reporter and message, and one open report per reporter and person.
- **Guard trigger:** it refuses changes to `reporter_*`, `evidence` and `created_at`, and allows the status only to move forward. The block table goes in the same migration (WP-2).

**Prisma.** Add models `ContentReport` and, for WP-2, `ActorBlock` to `apps/api/prisma/schema.prisma`, marked "SQL owns the DDL".

**API module `apps/api/src/moderation/`.** It contains:
- `reports.controller.ts`, `reports.service.ts`, `moderation.controller.ts`, `moderation.service.ts` and `dto.ts`;
- registration in `app.module.ts`.

Reporter routes:
- `POST /reports` with `{targetKind, messageId? | subject?, reason, note?}`. Marked `@RateLimited(ActionScope.REPORT_SUBMIT)` and `@RequiresTerms()` (WP-3, once merged).
  - The reporter must be able to read the message today (the same check as `message.service.ts` `list`), or share a conversation with the person.
  - A user cannot report themselves or a server message.
  - Returns 201 with `{id, status}`, or 200 when the same report is already open.
- `GET /me/reports`: the reporter's own reports, showing **status and the academy's answer only**, never the evidence or the reviewer's name.

Staff routes, guarded by the new permission keys:
- `GET /moderation/reports?status&priority`
- `GET /moderation/reports/:id`
- `POST /moderation/reports/:id/take`
- `POST /moderation/reports/:id/resolve` with `{resolution, note, answer}`

What `resolve` does:
- **`message_removed`** calls the existing `MessageService.deleteForEveryone` moderation path (`message.service.ts:1555`) as the manager, so the audit and the `message.deleted` event come for free.
- **`account_suspended`** calls the existing admin suspend (`POST /admin/accounts/:id/suspend`, `docs/security/DEACTIVATION.md`).
- **`reassigned`** records the action. The reassignment itself is done in the existing tools.
- **`answer`** sends the reporter a neutral `report_answered` notification.

Supporting changes:
- **Permissions:** add `moderation.view` (risk `pii`) and `moderation.act` (risk `admin`) to `apps/api/src/platform/permissions/catalogue.ts`, plus `role-templates.ts` (managers and the super admin).
- **Rate limit:** add `REPORT_SUBMIT` to `ActionScope` (`platform/auth/action-throttle.guard.ts:50`), a default in `platform/app-config.service.ts`, and a `chat.config` row in the migration (10 an hour).
- **Error codes:** `COMM.REPORT_TARGET_NOT_VISIBLE`, `COMM.REPORT_SELF` and `COMM.REPORT_NOT_REPORTABLE`, in `apps/api/src/platform/errors.ts` and `docs/communication/error-codes.md`.

**Events and notifications**
- An outbox `REPORT_CREATED` with **no content**, only `{reportId, priority}`. It goes in `communication/contracts/events.ts`, with its audience computed in `outbox.worker.ts`: the staff holding `moderation.view`.
- A **PD-47 task** for the queue, so the SLA is visible.
- `child_safety` also notifies the super admin at once.
- Notification catalogue entries `report_received_staff` and `report_answered`, in `notification-catalog.ts`. They are added after the PD-32 amendment if it merges first.

**Privacy rules (enforced in the DTOs and tested)**
1. The reported person is **never** told who reported, or that a report exists. A removed message looks like any moderated deletion.
2. A reporter sees only their own reports, their status and the answer.
3. Evidence is visible only with `moderation.view`. Every read of a report detail writes an audit row (`report.viewed`), so who looked is on record.
4. A support or impersonation session can neither file nor resolve a report (`SupportSessionInterceptor` allowlist: not added).
5. **Account erasure** (`chat.erase_account`, `20261102210000_chat_account_erasure.sql`):
   - the reporter reference is anonymised, keeping the report;
   - the evidence about an erased **subject** is kept, as the retention header already says for the audit log;
   - one line is added to the retention header.
6. Logs never contain the note or the evidence (the redaction list in `infra/observability`).

**Tests (written first, each failing before the code)**
- `apps/api/test/integration/pd057-reports.spec.ts`:
  1. A parent reports a teacher's message in the Student Group: 201, a task is created, and the teacher's view shows no trace.
  2. A parent cannot report a message from a conversation they are not in (404 or `REPORT_TARGET_NOT_VISIBLE`), nor their own message, nor a card.
  3. A second identical report returns the open one (200), and does not create a second.
  4. The 11th report in an hour is refused with `COMMON.RATE_LIMITED`.
  5. Staff without `moderation.view` get 403. With it, they see the evidence even after the author deleted the message for everyone.
  6. `resolve message_removed`: the message is deleted for all, with an audit row naming the report. The reporter gets `report_answered`, and `GET /me/reports` shows the answer but not the reviewer.
  7. `child_safety` is `urgent` and notifies the super admin.
  8. After the reporter's account is erased, the report stays and the reporter is anonymous.
  9. An impersonation session gets 403 on `POST /reports`.
  10. `chat_app` cannot `select` the table (RLS), in `db/tests/pd057_rls.sql`.
- Unit: DTO shaping (no evidence in the reporter DTO), and reason validation.

### PR-B: Flutter

**Message menu**
- `lib/features/messages/presentation/message_actions.dart`:
  - add `MessageAction.report` to the enum (:14);
  - add it in `actionsFor` (:96) only for someone else's non-system, non-card, non-local message;
  - add its icon and label to the two exhaustive switches (:205-227).
- `chat_screen.dart` (around :549): one `case` that opens the sheet. **This is the only edit to that file.**

**Report flow**
- New `lib/features/moderation/` with:
  - `presentation/report_sheet.dart`: a reason list (radio tiles, not a dropdown), an optional note, Send, and a "Thank you, the academy will review this" confirmation;
  - `presentation/my_reports_screen.dart`: Settings → My reports, with status and answer;
  - `data/moderation_repository.dart` and `lib/core/data/http/http_moderation_repository.dart`;
  - the fake in `fake_repositories.dart`, and the provider wiring in `bootstrap.dart`.

**Profile:** a "Report" item in `lib/features/profile/presentation/profile_sections.dart`, for a person who is not the viewer.

**Strings** in `app_ar.arb` and `app_en.arb`. Arabic is primary, with the O-1 copy.

**Tests**
- `test/features/moderation/report_sheet_test.dart`:
  - the action appears on others' messages and not on one's own, system or card messages;
  - submitting sends the right body;
  - "already reported" and rate-limited answers show calm messages;
  - right-to-left layout, and a screen reader labels each reason.
- `test/core/data/http/moderation_over_http_test.dart`.
- An update of the action-order test, if one exists for `actionsFor`.

### PR-C: Admin Web moderation queue

**Files**
- `apps/admin-web/src/features/moderation/`:
  - `ReportsPage.tsx`: queue with filters by status and priority, urgent first, and the age against the SLA;
  - `ReportDetail.tsx`: evidence, the conversation link, take, and resolve with an answer to the reporter;
  - `api.ts`, `hooks.ts` and `copy.ts` (Arabic and English).
- Routes and permissions:
  - a route in `apps/admin-web/src/app/AppRoutes.tsx` behind `<RequirePermission any={['moderation.view']}>`;
  - a nav entry in `app/navigation.ts`;
  - the area in `core/permissions/capabilities.ts`.
- Pickers use `SearchableSelect`, never a native `<select>`.

**Tests:** `ReportsPage.test.tsx` and `ReportDetail.test.tsx`:
- hidden without the permission;
- urgent sorts first;
- resolve sends the chosen resolution and answer;
- the evidence of a deleted message is shown.

### Acceptance criteria (WP-1)
1. From the Android build, a parent can report any message from another person, and any person, in at most three taps. They see a confirmation.
2. The report reaches the Admin Web queue within one minute, as an open report and a task. A child-safety report is marked urgent and notifies the super admin.
3. A manager can remove the message, suspend the account or dismiss, from the report. Each action is audited and names the report.
4. The reporter sees the answer in My reports and gets a notification. The reported person learns nothing.
5. Evidence survives the author deleting the message.
6. All new tests pass. Existing suites pass:
   - `npx jest --maxWorkers=2`
   - `npm run test:int -- --runInBand`
   - `flutter test --concurrency=2`
   - `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`
   - `bash scripts/qa/guards.sh pd-registry`

---

## 4. WP-2: Block a user (PD-57)

**Rules** (as O-2 recommends; adjusted if the owner decides otherwise):
- The blocker stops seeing the blocked person's messages in every conversation they share. A one-line placeholder says "Message hidden (you blocked this person)". Unblock in one tap brings them back.
- No push, no in-app notification and no call from the blocked person reaches the blocker. A call from them is refused as "unavailable", the same as a busy line.
- A blocked person cannot open a direct conversation with the blocker. In an existing direct conversation, their new messages are kept, but they are not delivered to the blocker. The staff sender sees "This family has blocked you; a manager has been told". Families are never shown that.
- Nobody is removed from a group, and lessons go on.
- Every block opens a moderation case (a `content_report` with `target_kind = person` and reason `blocked`, priority normal) so a manager can reassign.

### PR-A: database and API

**Table `chat.actor_block`** (in the WP-1 migration):
- `id`, `organization_id`;
- `blocker_kind`, `blocker_id`, `blocked_kind`, `blocked_id`;
- `created_at`, `case_report_id`;
- unique on (`blocker`, `blocked`). Removing the row unblocks.
- RLS fail-closed, as in WP-1.

**API, in `apps/api/src/moderation/`**
- `POST /me/blocks` with `{subject}` (`@RateLimited`).
  - Refused for yourself, the official account, and a staff caller blocking a family (`COMM.BLOCK_NOT_ALLOWED`).
- `GET /me/blocks`
- `DELETE /me/blocks/:id`

**Where blocks are enforced** (one helper, `BlockService.blockedBy(viewer)`, cached per request):

| Point | File | Change |
|---|---|---|
| Reading messages | `communication/messages/message.service.ts` `list` (:547) and `info` | Mark the blocked authors' messages as `hiddenByBlock` (body removed in the DTO) |
| Push and notifications | `communication/outbox/message-audience.ts` | Remove a blocker from the audience of the blocked person's messages, calls and mentions. This is **not** the gateway, which #439 changes. |
| Realtime frames | the same audience, computed in `outbox.worker.ts` | The blocker gets a `message.created` without a body, so the client shows the placeholder |
| Opening a direct conversation | `platform/authorization.service.ts` `canOpenDirect` (:261) | Refuse the blocked side with `COMM.DIRECT_BLOCKED` |
| Sending in a direct conversation | `message.service.ts` `send` (:190) | Kept, but not delivered to the blocker; the staff sender gets the notice flag |
| Starting a call | `communication/calls/*` `start` | The callee who blocked the caller is not rung; the caller gets the normal "unavailable" |

**Tests:** `apps/api/test/integration/pd057-blocks.spec.ts`:
1. A parent blocks their supervisor:
   - the supervisor's messages in the family direct conversation and the group come back hidden for the parent only;
   - other members still see them;
   - a moderation case is opened.
2. No push row is made for the blocker. A call from the blocked person does not ring the blocker.
3. The blocked person cannot open a new direct conversation (`COMM.DIRECT_BLOCKED`).
4. A staff caller cannot block a family. Nobody can block the official account or themselves.
5. Unblocking restores the history at once.
6. Erasure removes the eraser's blocks in both directions.
7. RLS: `chat_app` cannot read the table.

### PR-B: Flutter
- `profile_sections.dart`: Block or Unblock, with a confirmation sheet explaining that lessons continue and the academy is told.
- New `lib/features/moderation/presentation/blocked_people_screen.dart` (Settings → Blocked people), with its route in `router.dart`.
- The placeholder bubble: a small `hiddenByBlock` branch in `message_bubble.dart`, plus at most one line in `chat_screen.dart` (after WP-1's edit).
- The composer in a direct conversation with someone the user blocked shows "You blocked {name}. Unblock to write."
- Strings in Arabic and English.
- **Tests:** `test/features/moderation/block_test.dart`:
  - the menu shows Block, and the confirmation names the person;
  - a hidden message shows the placeholder, and Unblock restores it;
  - Blocked people lists and unblocks;
  - right-to-left layout and screen-reader labels.

### Acceptance criteria (WP-2)
1. A parent or a teacher can block anyone they share a conversation with, except the official account, from the person's profile. They can unblock in Settings.
2. While blocked, the blocker gets nothing from that person on Android or iOS: no messages, pushes, notifications or rings. The lesson group goes on for everyone else.
3. Every block appears in the moderation queue.
4. All tests and existing suites pass, as in WP-1.

---

## 5. WP-3: Terms acceptance before any content (PD-58)

**The principle.** The **server** refuses content from an account that has not accepted the current terms version. The clients add a gate so that a user never hits the refusal. This covers every way an account is created:
- PD-16 sign-up;
- PD-42 intake;
- teacher onboarding (PD-43);
- staff accounts (PD-40);
- the super-admin bootstrap;
- seeded and Core-linked accounts.

All of them reach `/auth/login`, so the gate sits at the session, not at account creation.

### PR-A: database and API

**Migration `20261104110000_chat_pd058_terms_acceptance.sql`**
- `chat.terms_acceptance` columns: `account_id`, `terms_version` (int), `accepted_at`, `client` (`android` | `ios` | `web_portal` | `admin_web`), `locale`. Primary key (`account_id`, `terms_version`).
- **Append-only:** a guard trigger refuses update and delete, except inside `chat.erase_account`, following the `chat.erasing_family` pattern at `20261102210000_chat_account_erasure.sql:43-63`.
- Written only by a security-definer `chat.accept_terms(account, version, client, locale)`.
- RLS fail-closed.
- A `chat.config` row `legal.terms_version = 1`.
- **Erasure decision (engineering):** the acceptance rows are **kept** as the consent record, like the audit log. The account row is already anonymised. One line goes in the retention header.

**API, new `apps/api/src/legal/`:** `terms.service.ts`, `terms.controller.ts`, `requires-terms.decorator.ts` and `terms.guard.ts`.
- `GET /me` and the login and refresh responses gain `termsRequired: {version} | null`. That means `toActorDto` in `platform/auth/auth.dto.ts:13-42`, whose fields are added by hand.
- `POST /me/terms/accept` with `{version}`:
  - 409 `COMM.TERMS_VERSION_STALE` if the version is not current;
  - refused in a support or impersonation session, because nobody accepts for someone else.
- **`TermsGuard`** is a global guard registered after `AuthenticatedGuard` in `platform/auth/auth.module.ts:102-116`.
  - On a route marked `@RequiresTerms()` it returns 403 `COMM.TERMS_NOT_ACCEPTED`.
  - It reads the version from config and the acceptance from `AuthService.authenticate`'s account row. That is one indexed lookup, cached per request.
- **Routes marked `@RequiresTerms()`.** Every route that creates content others can see:
  - `message.controller.ts`: send (:46), forward (:98), attachments/authorize (:118), reactions (:213) and edit (:274);
  - `storage.controller.ts` `PUT /storage/:objectKey` (:65);
  - `conversation.controller.ts` `POST direct` (:120);
  - `story.controller.ts`: media (:107), create (:123) and publish (:176);
  - `parent-feedback.controller.ts`: `POST /me/feedback` (:28) and reply (:50);
  - every write in `whiteboard.controller.ts`;
  - profile writes in `parent-profile.controller.ts`, `profile-photo.controller.ts` and `teacher-profile.controller.ts`;
  - lesson report and absence posts in `lessons/lesson.controller.ts:63-99`;
  - `POST /calls`;
  - `POST /reports` and `POST /me/blocks` (WP-1 and WP-2).
  - Reading, signing in, deleting the account and accepting the terms are **never** gated, so a user can always leave.
- **Sign-up:** `parent-signup.service.ts` `verify()` (:109-173) accepts `{acceptTerms: version}`. Without it the call fails with 400 `COMM.TERMS_REQUIRED`. With it, `chat.accept_terms` runs in the same transaction, the way the lesson-audio notice is recorded at :154-156.
- **Error codes:** `COMM.TERMS_NOT_ACCEPTED`, `COMM.TERMS_VERSION_STALE` and `COMM.TERMS_REQUIRED`, in `errors.ts` and `error-codes.md`.

**Tests:** `apps/api/test/integration/pd058-terms.spec.ts`:
1. A teacher created through `POST /teachers` and activated with a first-login code logs in with `termsRequired: {version: 1}`.
2. That teacher's message send gets 403 `TERMS_NOT_ACCEPTED`. After accepting, it gets 201.
3. Bumping `legal.terms_version` to 2 makes every account required again, and old acceptances stay.
4. `POST /me/terms/accept {version: 1}` after the bump gets 409.
5. An impersonation session cannot accept.
6. Parent sign-up without `acceptTerms` gets 400. With it, the account starts accepted.
7. Reading, account deletion and sign-out work without acceptance.
8. The acceptance rows survive erasure. Update and delete are refused.
9. **A coverage test** (`apps/api/test/unit/legal/terms-coverage.spec.ts`). It walks the Nest route metadata, and fails if any route with `@RateLimited` in MESSAGE_SEND, ATTACHMENT_UPLOAD, STORY_PUBLISH, WHITEBOARD_WRITE or CALL_START, or any route from a fixed list, lacks `@RequiresTerms()`. A new content route cannot slip past the gate.

### PR-B: clients

**Flutter**
- `lib/shared/models/auth.dart` `AuthUser` gains `termsRequired`, parsed in `http_auth_repository.dart`.
- New `lib/features/legal/presentation/terms_gate.dart`:
  - a full-screen gate, the same pattern as `WebPortalGate`, inserted in `lib/app/app.dart:91-97` **before** `AppLockGate`;
  - it shows the version's links (`LegalLinksRow`), "I agree to the Terms of use", and Sign out;
  - it cannot be dismissed;
  - it holds back the lesson-audio notice and the app-lock offer while it is open, reusing the `lessonAudioNoticeBusyProvider` idea.
- `parent_signup_screen.dart`: a **required** terms checkbox next to the lesson-audio one (:202-211). The submit button stays disabled until it is ticked.
- A 403 `TERMS_NOT_ACCEPTED` from any call refreshes the identity and shows the gate. This is a safety net for a version bump during a session.
- **Tests:**
  - `test/features/legal/terms_gate_test.dart`: shown when required and not shown when not; Agree posts the version; Sign out works; right-to-left; a screen-reader label on the checkbox;
  - updated `startup_routing_test.dart` and the sign-up tests.

**Admin Web**
- `apps/admin-web/src/core/auth/SessionProvider.tsx` reads `termsRequired`.
- New `src/features/legal/TermsGate.tsx` is placed after the authentication check in `src/app/AppRoutes.tsx:102-104`.
- Copy in Arabic and English, and a vitest.

### Acceptance criteria (WP-3)
1. No account can post anything others see without having accepted the current version. This is checked by the server, for all six ways an account is created.
2. A first sign-in, on the app, the teacher portal or Admin Web, shows the gate once. Accepting takes one tap and is recorded with version, time and client.
3. A version bump asks everyone again at their next request. Old acceptances stay.
4. Reading, signing out and account deletion are never blocked.
5. The coverage test fails if a new content route lacks the gate.
6. All tests and existing suites pass.

---

## 6. WP-4: Store payment mode (PD-56 amendment)

**Mechanism**
- A compile-time `--dart-define=JAWWID_PAYMENTS_MODE=status|full`, read once in a new `lib/core/config/payments_mode.dart`.
- **The default is `status`**, so a store build cannot ship card checkout by accident. Dev and QA runs pass `full`.
- `scripts/mobile/build-store.sh` passes `status` explicitly. That line is added after #447 merges, which also edits that script.

### PR-A: Flutter (both stores)

| File | In `status` mode |
|---|---|
| `lib/features/billing/presentation/my_payments_screen.dart` | No amount-due list (:283-302), no `_pay` (:176), no `BankTransferScreen` push (:186). It shows each child's plan, lessons left, state (active, grace, paused), receipts and invoices. |
| `pay_sheet.dart`, `bank_transfer_screen.dart` | Not reachable. `showPaySheet` asserts the mode. |
| `payment_sections.dart` `DueTile` (:77-150) | No Pay button and no amount |
| `subscription_cards.dart` (:11-31) | No Pay. "Request renewal" stays: it asks the academy to renew and contains no payment. |
| `lib/features/messages/presentation/payment_lock_banner.dart` | Neutral O-5 text and no open button. `chat_screen.dart:217` sets `canPay = role == parent && mode == full`, one line. |
| `notification_center_screen.dart` `routeFor` (:259-271) | `viewPayments` opens the status screen |
| Sales screens (`lib/features/sales_payments/**`) | Unchanged. Recording a payment that was already made is back-office work, not a purchase. |

**Tests:** `test/features/billing/store_payments_mode_test.dart`, run with the mode overridden through a provider:
1. No Pay, card, bank or receipt-upload widget exists on any billing screen, the lock banner or the subscription cards.
2. No widget shows a currency amount due.
3. The lock banner has no button.
4. "View payments" lands on status.
5. `full` mode leaves all existing billing tests unchanged.

A config test also checks that `build-store.sh` passes `JAWWID_PAYMENTS_MODE=status`, and that the default in `payments_mode.dart` is `status`.

### PR-B: server copy (after O-5)
- The `subscription_locked`, `lessons_paused` and `payment_*` texts in the notification catalogue and the card renderer use the owner's neutral wording on every client.
- They hold no "pay", link or method. The web pay page (`pay-page.ts`) is unchanged.
- Tests: the catalogue snapshot; `pd030` subscription specs updated for the copy.

### Acceptance criteria (WP-4)
1. In an Android or iOS store build, a parent cannot start, see or be pointed to a payment: no button, link, price, bank detail or receipt upload.
2. Subscription status and history stay visible.
3. Staff collect payment outside the app with the existing pay link and bank transfer. Nothing on the server changes for them.
4. Card checkout can return in an update by switching the build define. Its code and tests stay green in `full` mode.
5. Review notes (owner, Play and App Store) say: "Families pay the academy outside the app. The app shows subscription status only."

---

## 7. WP-5: Call foreground service (finish PR #411)

#411 already builds P-6: `CallForegroundService`, started on media join while the app is in front, stopped on every terminal path, with an ongoing notification and Hang up, and Dart tests (N6 group). What is left:

1. **Drop the `phoneCall` type.**
   - Android documents `phoneCall` as "continue an ongoing call using the ConnectionService APIs". #411 does not use ConnectionService.
   - Declaring it invites a Play declaration refusal.
   - Use `foregroundServiceType="microphone"` only.
   - Remove `FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS`.
   - Files: #411's `AndroidManifest.xml` and `CallForegroundService.kt`.
2. **Rebase #411 on `main`** after #408 merges. It merges cleanly onto `main` today (`git merge-tree`, checked 2026-11-03). Re-run its Dart tests: `flutter test test/features/calls --concurrency=2`.
3. **A manifest text test** in the style of `test/l10n/android_launcher_label_test.dart`. It asserts the service is declared non-exported, with type `microphone` and nothing else, and that `FOREGROUND_SERVICE_MICROPHONE` is present.
4. **The Play Console declarations**, filled by the owner, with the text prepared here:
   - **Foreground service → Microphone.** "A voice call between a teacher and a family, or the academy and a family, started by the user. The service runs only while the call is connected, shows an ongoing-call notification with Hang up, and stops when the call ends."
   - **A video of 30 seconds or less:** start a call, press Home, lock the screen, show the notification, and hang up from it.
   - **Full-screen intent (from #408):** declare "calling". If Play refuses, #408 already falls back to a heads-up call notification (`canUseFullScreenIntent()`), and nothing breaks.
5. **Device acceptance**, from `docs/qa/submission-device-test-plan.md` §7, on Android 13, 14 and 15/16:
   - **SB-30:** Home, then another app for 2 minutes. Audio continues both ways, and the notification is shown.
   - **SB-31:** lock the screen for 2 minutes. Audio continues both ways.
   - **SB-35:** Hang up from the notification ends the call for both sides.
   - Plus: a declined call never starts the service, and a refused start does not crash.

### Acceptance criteria (WP-5)
1. The manifest declares exactly `microphone` for the service.
2. All of #411's tests and the new manifest test pass.
3. SB-30, SB-31 and SB-35 pass on a real Android 14+ phone.
4. The owner's Play Console declaration is filed with the video.

---

## 8. WP-6: Final Android release audit

**New script `scripts/qa/android-release-audit.sh <path.aab>`.** It is new, so it overlaps nothing, and it runs locally on a built AAB with no network. It fails on any of the following:

| Check | How |
|---|---|
| `targetSdkVersion` is at least **36**, and `minSdk` is 26 | `bundletool dump manifest` |
| **Exact permission set** | The release set is INTERNET, ACCESS_NETWORK_STATE, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS, USE_BIOMETRIC, USE_FINGERPRINT, WAKE_LOCK, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE, USE_FULL_SCREEN_INTENT, plus FCM's `com.google.android.c2dm.permission.RECEIVE` and the app's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. Anything else fails, including any storage, media, location, phone, SMS or `QUERY_ALL_PACKAGES` permission. |
| **No advertising ID** | `com.google.android.gms.permission.AD_ID` is absent. Defence in depth: one `tools:node="remove"` line in the manifest, added after #408, #411 and #447 merge. |
| Exported components | Only `MainActivity`, plus Firebase's own receiver with its signature permission |
| `allowBackup="false"`, not debuggable, no cleartext | the dumped manifest |
| **16 KB alignment** | `zipalign -c -P 16 -v 4` on the universal APK from `bundletool build-apks --mode=universal`, and `llvm-readelf -lW` for every `lib/*/*.so` LOAD segment (alignment 0x4000 or more) |
| Signed with the upload key, not debug | `keytool -printcert -jarfile` compared with the owner's upload certificate fingerprint |
| `versionCode` is higher than the last upload | compared with a value the owner supplies |

**A Flutter config test** (`test/app/android_release_config_test.dart`, after #447's `store_submission_config_test.dart` merges, to avoid a conflict) checks the same permission allowlist against the **source** manifests, so a pull request fails before anyone builds.

**Run order**
1. `scripts/mobile/build-store.sh android`, with the owner's key, `google-services.json`, Sentry DSN and `JAWWID_PAYMENTS_MODE=status`. Only when the load average is under 60.
2. The audit script on the AAB.
3. Upload to **internal testing** (owner).
4. The pre-launch report, with the demo credentials.
5. The device plan.

### Acceptance criteria (WP-6)
1. The audit script passes on the exact AAB that will be uploaded. Its output goes in the PR and in `docs/qa/release-gate.md`.
2. The pre-launch report shows no crash and no policy warning.
3. The device rows SB-04, SB-10 to SB-15, SB-20 to SB-27 and SB-30 to SB-35 pass on Android 13, 14 and 15/16.

---

## 9. Safety rules for every package
- Each package has its own worktree and branch. No package touches another session's tree, or the files §2 assigns elsewhere.
- Tests are written first. Each new test fails before its change and passes after it.
- **Before any heavy run:**
  - check `uptime`, and wait while the 1-minute load is over 60;
  - use a private Postgres and Redis with unique container names;
  - never the shared system-test stack.
- **Migrations:** claim the slot file in the same PR. Never apply a migration to a shared or production database.
- **Copy:** user-facing text goes in Arabic and English. Arabic is primary. Policy and payment copy waits for the owner (O-1, O-3, O-5).
- **Reports:** list the files changed, the exact commands, and the counts with the first failure. Never claim a test that did not run.
- **Do not push, merge, deploy or upload.** The owner's instruction of 2026-11-03 holds until the owner lifts it. Branches stay local until then.
