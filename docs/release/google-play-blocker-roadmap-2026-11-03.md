# Google Play blockers: implementation roadmap

**Revision 2, 2026-11-03.**

> **Amended 2026-11-06 by owner decisions D-1 to D-6** (`pd57-closure-plan-2026-11-06.md`): the report SLA is **24 h** (alerts at 18 h and 24 h), moderation access is scoped by department, child-safety reports are restricted to the Super Admin and `moderation.child_safety`, and blocking is enforced on the server with explicit educational exceptions. Where the two differ, the closure plan wins.
- It replaces revision 1 (local commit `4551a81a`) and adds the owner's approved decisions.
- **State: PLAN. No product code is written.** Nothing is pushed, merged, deployed, uploaded or published.
- Base: `main` @ `3d669299`. Paths are relative to the repository root. Line numbers are from that commit and are a guide, not a contract.
- Jawwid Core is out of scope and is not touched.

Companion report: `docs/release/google-play-readiness-2026-11-03.md` (draft PR #448).

**What changed from revision 1**
- §1 records the owner's decisions of 2026-11-03 as **binding requirements**, and lists the decisions still pending.
- **Payments: the "status-only" proposal of revision 1 is withdrawn.** Payments stay in the app. §8 assesses each payment flow against the current Payments policy. No payment change starts until the owner says so.
- **Terms:** there are now separate terms for families, teachers and staff, plus a shared Code of Conduct (§7).
- **Block:** the approved rules, the protected administrative channel, and the "responsible manager" rule (§6).
- **Push:** there are **three** parallel Android implementations, not two. They are reconciled in §3.
- New: the CI review of PR #408 (§4), the Organization developer account (§11), and the coordination register (§12).

---

## 1. Decision register

### 1a. Approved by the owner (2026-11-03). Binding.

| # | Decision | Where it is built |
|---|---|---|
| **A-1 Report** | Five reasons. A response within **48 hours**. **Child-safety reports go to the Super Admin immediately.** An admin moderation queue and a way to answer the reporter. | WP-1 (§5) |
| **A-2 Block** | Blocking hides the blocked person's messages, notifications and calls from the blocker. It **never interrupts lessons** or the educational process. **Every block notifies the responsible manager.** Staff may report families but **cannot block** them. An **administrative communication channel is preserved** where educational operations need it. | WP-2 (§6) |
| **A-2a Block: every responsible manager** (owner, 2026-11-04; refines A-2's "notifies the responsible manager") | When a family blocks someone: (1) find **every supervisor** assigned to the family's children; (2) find **every manager responsible** for those supervisors; (3) notify **each one, across departments**; (4) **no duplicate** notice to the same manager; (5) record the block in the **administrative audit log**; (6) **least privilege**: being notified gives a manager **no** access to family accounts, private conversations or anything beyond their existing permissions. | WP-2 (§6.2, §6.3) |
| **A-3 Terms** | **Separate terms** for families, teachers and staff, plus a **shared Code of Conduct**. The accepted **version and timestamp** are recorded. Acceptance is enforced for **every way an account is created**, including staff-created accounts. **No existing consent or legal requirement is weakened.** | WP-3 (§7) |
| **A-4 Lesson-suspension message** | Arabic: **تم إيقاف حصص {اسم الطفل} مؤقتًا، وستتواصل معكم الأكاديمية.** English: **Lessons for {child} are temporarily paused. The academy will contact you.** In code, both use the placeholder `{child}`; the Arabic `{اسم الطفل}` is the same slot. | WP-4 phase 4C (§8) |
| **A-5 CI** | PR #408's CI changes are reviewed. Branch protection, security checks, required tests and release gates are **not weakened**. Code Owner approval is **obtained**. | §4 |
| **A-6 Payments** | An **external payment gateway (Stripe) integrated in the app**. Payments are **not** removed. It is **not** assumed that every service is exempt from Google Play Billing: each product and flow is assessed separately. The primary service is **live, individual, one-to-one online Quran and Arabic lessons**. **No payment change is implemented yet.** | WP-4 (§8), assessment only |
| **A-7 Developer account** | A Google Play **Organization** account, not Personal. Nothing is created or registered by engineering. | §11 |

### 1b. Pending owner decisions. Not assumed anywhere in this plan.

| # | Pending decision | What it blocks | What engineering does meanwhile |
|---|---|---|---|
| **N-1** | **Target audience and age classification** (Play's target-audience form, the Families policy, the content rating answers) | The store listing, the target-audience and content-rating forms, and the screenshots | Nothing that depends on it. No age screen, no Families-policy work and no listing art. |
| **N-2** | **Final package name.** `applicationId` is permanent after the first upload; today it is `com.jawwid.jawwid_chat`. | The first upload; the Firebase Android app registration (`google-services.json` is bound to the package name); the WP-6 audit's expected id | The audit script takes the expected package name as a parameter. Nothing is renamed. |
| **N-3** | **Final legal wording and document versions**: the family, teacher and staff terms, the Code of Conduct, and the privacy policy | Turning on the terms gate in production; the store build's URLs | WP-3 is built so that the documents, their URLs and their versions are **configuration supplied by the owner**. No version number or wording is written into code. Tests use clearly marked fixtures. **Production refuses to start** without the configuration (§7). |
| **N-4** | **Report-reason labels**, final Arabic and English. The five reasons are approved (A-1); their wording is user-facing copy. | WP-1 PR-B copy | Build with the draft labels in §5, marked for the owner's review. |
| **N-5** | **Payment questions raised by the assessment** (§8.4): paid group classes; whether a lapsed payment may lock the chat; whether digital learning content is ever sold or tied to a subscription; the paid trial | Any payment change (WP-4 4B and 4C) | Nothing. The assessment only. |
| **N-6** | Owner-provided items: Organization account details and documents (§11.3); production backend and demo accounts; Firebase project; upload key; Sentry DSN; store listing assets (after N-1) | Upload and review | Nothing. |

---

## 2. Execution sequence

### 2a. Dependency graph

```
                    ┌─────────────────────────────────────────────┐
 G0 Push reconcile  │ #408 base + 674765a1's notification layer;  │──► #408 Code Owner review (A-5) ──► merge #408
 (§3, other         │ 7ef999eb dropped; CI fixes (§4)             │                     │
  sessions)         └─────────────────────────────────────────────┘                     ▼
                                                               WP-5: #411 rebased, microphone only ──► merge
                                                                                         │
 WP-1A  DB + API: reports + blocks (one migration) ───┬──► WP-1B Flutter Report ──┐       │
                                                      ├──► WP-1C Admin Web queue  │       │
                                                      └──► WP-2A Block API ──► WP-2B Flutter Block
                                                                                  │       │
 WP-3A  DB + API: terms (config-driven) ──► WP-3B app + Admin Web gates ───────────┤       │
        (production needs N-3 before go-live)                                      │       │
                                                                                   ▼       ▼
 WP-4  Payments: assessment done (§8) ──► owner answers N-5 ──► 4B safeguards ──► 4C copy (A-4)
                                                                                   │
                                                                                   ▼
                                    WP-6 release audit (needs N-2, N-6, every merge above) ──► internal testing
```

### 2b. Which work can begin now, independently

Nothing starts until the owner says "go". These are the packages that **could** start at that point without waiting on anything else:

| Package | Why it is independent | Touches files used by |
|---|---|---|
| **WP-1A** reports and blocks, database and API | A new module `apps/api/src/moderation/`, one new migration, and small additions to `catalogue.ts`, `errors.ts`, `action-throttle.guard.ts` and `app-config.service.ts` | No open PR touches these (checked 2026-11-03) |
| **WP-3A** terms, database and API | A new module `apps/api/src/legal/`, one new migration, and additions to `auth.dto.ts`, `auth.module.ts` and `parent-signup.service.ts`. Versions are configuration (N-3), so no legal text is needed. | No open PR touches these |
| **WP-1C** Admin Web moderation queue | A new folder `apps/admin-web/src/features/moderation/`, plus a route and nav entry. It depends only on WP-1A's contract, frozen in §5, and can use a mocked API. | No open PR |
| **G0 push reconciliation** | Belongs to the push-acceptance session (§3). It runs in parallel. | Android, iOS and push files, which nobody else touches meanwhile |

**Must wait:**

| Package | Waits for |
|---|---|
| WP-1B, WP-2B | `chat_screen.dart` is changed by #420; edits are made one package at a time, rebased |
| WP-3B | WP-3A |
| WP-5 | #408 merged |
| WP-4 4B and 4C | N-5 and the owner's go |
| WP-6 | everything above, plus N-2 and N-6 |

### 2c. The order

1. **G0**, and in parallel **WP-1A** (which includes the block table) and **WP-3A**. These are three separate worktrees.
2. **WP-1C** with a mocked API, then wired to WP-1A.
3. **WP-2A** on top of WP-1A.
4. **WP-1B**, then **WP-2B** (each touches `chat_screen.dart` by one line, after #420), and **WP-3B**.
5. **#408** merged with Code Owner approval, then **WP-5**.
6. **WP-4** phases 4B and 4C, only after N-5 and the owner's go.
7. **WP-6** on the exact AAB, then the owner uploads to internal testing.

**Estimates:**
- WP-1: ~5–6 days.
- WP-2: ~3–4 days.
- WP-3: ~4–5 days, up from revision 1 because there are three documents per audience.
- WP-5: ~1 day.
- WP-6: ~1 day.
- WP-4: to be sized after N-5.

---

## 3. G0: reconcile the Android push work. This comes first.

**The situation.** Three implementations of Android push, checked 2026-11-03:

| Line | Where | What only it has | What it lacks |
|---|---|---|---|
| **#408** `claude/android-push-fcm` (head `0874cbd3`) | open PR, CI green | The **incoming-call ring**: CallStyle Answer/Decline, a full-screen intent with the Android 14+ `canUseFullScreenIntent()` fallback, `CallActionReceiver`, and `jawwid/call_native` on Android. Also: the token store, the Firebase Gradle wiring (a release build refuses without `google-services.json`), and the CI Android jobs and emulator ring test. **#411**, stacked on it, has the call foreground service. | Tap intents carry **no install nonce**. Both the message tap and the call Answer/Open intents target the exported `MainActivity`. Routing is limited to "conversation or Center". |
| **`674765a1`** / `24c10f39` | **draft PR #449** `claude/pd032-feedback-reply-notifications`, worktree `~/dev/jawwid-pd032-push`; taken to acceptance in `~/dev/jawwid-push-acceptance` (`claude/push-acceptance`) | **Nonce-protected tap intents** with allowlisted ids; routing by the Notification Center's action kinds; notifications cleared at sign-out; Kotlin unit tests (`PushPayloadTest`); the iOS `UNUserNotificationCenter` delegate and launch handling; Dart `push_opens.dart` and `push_open_coordinator.dart` | **It never draws or routes call pushes**, by design. No call ring and no foreground service. |
| **`7ef999eb`** | local, unpushed, on `claude/store-release-readiness` (worktree `~/dev/jawwid-release-review`) | Nothing the other two lack. Its own session already decided to drop it (commit `8a8e6715`). | — |

All three create or edit:
- `JawwidMessagingService.kt` and `MainActivity.kt`;
- the manifest, the Gradle files and the strings files;
- `fcm.provider.ts`.

Only one can merge as it stands.

**Decision (engineering lead).** Each line keeps what only it does well.

1. **The base is #408**, with #411 stacked on it. It is the only line that rings for calls and keeps a call alive, and it carries the CI jobs.
2. **674765a1's ordinary-notification layer replaces #408's simpler message branch** (`JawwidPush.showMessage`, around :149):
   - nonce-protected intents with allowlisted extras;
   - action-kind routing;
   - clearing at sign-out;
   - the Kotlin unit tests;
   - the Dart open coordinator, plus the iOS delegate and launch handling.
3. **The install nonce is extended to #408's call intents** (Answer and Open, in `JawwidPush.activityIntent`, around :205). `MainActivity` is exported, so another app must not be able to fire an "answer" intent. The server still re-authorizes every accept, but the client must not be the weak point.
4. 674765a1's duplicate Android classes are **dropped** after their logic has moved: its `JawwidMessagingService`, `PushBridge` and its Firebase Gradle lines. `7ef999eb` is **dropped**.
5. The PD-32 parts stay on **draft PR #449** (`claude/pd032-feedback-reply-notifications`), as that PR's body already describes:
   - the server parts (`call-push-routing.ts`, `notification.service.ts`, `outbox.worker.ts`);
   - the feedback notices, `docs/release/push-setup.md`, and the iOS and Dart tests;
   - migration `20261103120000`, whose slot file `docs/product/migration-slots/20261103120000.md` (`pr: 449`) is already on #449 and passes `guards.sh pd-registry`.
   - **The merge keeps that slot file as it is and adds no second one.**
   - The #449 session agreed to this split on 2026-11-03 and is not editing the files being merged.

**Who does it.** The push-acceptance session (`~/dev/jawwid-push-acceptance`), which already owns taking that work to acceptance.
- This plan's packages touch **none** of these files until G0 has merged:
  - `android/**`, `ios/**`;
  - `lib/core/push/**`, `lib/core/call_native/**`, `lib/features/calls/**`, `lib/features/notifications/application/**`;
  - `fcm.provider.ts`, `call-push-routing.ts`.
- Nothing in another session's tree is changed by this plan. The decision is sent to the sessions involved (§12).

**G0 status (2026-11-03, checked read-only by the lead)**

The decision is implemented, **uncommitted**, in `~/dev/jawwid-push-acceptance`. Its base is `24c10f39` (#449), with #408's changes applied 3-way from their merge-base.

| Item | State |
|---|---|
| #408 is the Android base, and the call ring is unchanged | Done |
| #449's notification layer replaces the body of `JawwidPush.showMessage`: nonce, allowlist, Center routing, clearing at sign-out, `PushPayloadTest` | Done |
| #449's duplicate Android classes are dropped (`PushPresenter.kt` is deleted); `7ef999eb` is dropped | Done |
| Call Answer and Open carry the nonce (`JawwidPush.activityIntent`), and `MainActivity` checks it with `PushPayload.isTrustedTap` | Done. Kotlin test `aCraftedCallIntentWithoutTheNonceIsIgnored`. |
| Conflict markers and index | None remain, and the index has no unmerged entries (re-checked). The tree is still **uncommitted**: committing waits for the owner's approval, and the build and tests then run on the committed tree. |
| Nonce comparison | Constant-time (`MessageDigest.isEqual`); Kotlin tests 13 of 13, as reported by that session |
| An end-to-end test of `MainActivity`'s call-intent path | **Gap, recorded rather than faked.** It needs Robolectric or an instrumented test, and the project has neither. It goes into #408's emulator ring test in CI (`scripts/qa/android-ring-test.sh`, a Code Owner path). |
| #411 (call foreground service) | Not yet layered. It stacks on top afterwards (WP-5). |
| `ci.yml` emulator-runner SHA pin (§4 finding 1) | Not in that tree, because `ci.yml` is a Code Owner file. It is done on #408's branch, with the owner's approval. |
| Play: the merged release manifest declares `USE_FULL_SCREEN_INTENT` (from #408) | The full-screen intent declaration in Play Console is **required** (§9 item 4, WP-6 permission set) |

Evidence: `docs/release/push-notification-acceptance.md` in that worktree.

Still to do:
- commit;
- run CI on the committed tree;
- stack #411;
- the device rows.

**G0 acceptance criteria**
1. There is one Android push implementation on one branch, based on #408 and stacked under #411.
2. Every notification tap intent, message and call alike, carries and checks the install nonce. A Kotlin unit test shows a crafted intent without the nonce is ignored.
3. Message notifications route by action kind, are not drawn while the app is in front, and are cleared at sign-out. A call push still rings, with Answer and Decline, as in #408.
4. iOS taps open the exact item in the terminated, background and foreground states (674765a1's tests).
5. CI is green: Flutter, the API, `android`, and the guards. The CI review findings in §4 are fixed.
6. The device rows SB-10 to SB-15 and SB-20 to SB-27 (`docs/qa/submission-device-test-plan.md`) are run with the owner's Firebase project before submission.

---

## 4. CI review of PR #408 (A-5)

**What it changes.** `.github/workflows/ci.yml` is a Code Owner path (`/.github/workflows/  @MohamedEmadLasheen`). The diff **only adds** two jobs (`@@ -635,3 +635,104`). No existing step, job, permission or check is removed or relaxed.

| Job | What it checks | Assessment |
|---|---|---|
| `android`, "Mobile · Android build" | A debug APK builds without `google-services.json`. A release build **refuses** without it, and says why. The debug-only `DebugPushReceiver` is **not** in the merged release manifest. | **Strengthens the release gate**: a release that could never ring cannot be built. The throwaway key is made on the runner with a random password, signs nothing that leaves it, is never committed, and is not in the uploaded artifact (only `android-ring/` is uploaded). |
| `android-ring`, emulator API 34, "not required" | A killed-app ring and Answer reach the call bridge (`scripts/qa/android-ring-test.sh`) | Advisory. It is not marked `continue-on-error`, so a failure shows red. Whether it becomes required is branch protection's setting, which this PR does not touch. |

**Workflow permissions** stay `contents: read` (top of `ci.yml`). Neither job adds `permissions:`, secrets, or `pull_request_target`.

**Findings to fix before Code Owner approval**
1. **Pin the third-party action to a commit SHA.** `reactivecircus/android-emulator-runner@v2` is pinned by tag. The repository pins its other third-party action by SHA (`subosito/flutter-action@1a449444…`). A moved tag would run unreviewed code on the runner. GitHub's own actions are tag-pinned by convention here; that is unchanged.
2. `scripts/qa/android-ring-test.sh` is new under `scripts/qa/`, which is also a **Code Owner path**. It is reviewed as part of the same approval.
3. `needs: guards` is correct. Both jobs wait for the fast release-gate guards.

**Not weakened, explicitly:**
- the six required checks are unchanged;
- no test is skipped or loosened;
- release signing still refuses without `key.properties`;
- branch protection is not changed by any file in the PR.

**Recommendation for later (owner's setting, not part of this PR):** make `Mobile · Android build` a **required** check once it has been stable for a week. That only adds protection.

**Approval sequence**
1. G0 lands its changes on #408.
2. Finding 1 is fixed.
3. CI is green on the final head.
4. **The owner gives Code Owner approval on that final head.** The earlier approval on #408 was dismissed by later commits (`reviewDecision` is empty today), so a new one is needed.
5. Only then is it merged, by the owner.

---

## 5. WP-1: Report (PD-57)

**Scope.** Users can report:
- any message posted by someone else: text, voice, photo, video, file and forwards;
- a person, from their profile.

Not reportable:
- `system` and `card` messages, which the server writes;
- stories, which only staff write (`Story.createdBy` → `Staff`);
- PD-32 feedback, which no other user sees.

### 5.1 The five reasons (A-1). Draft labels pending N-4.

| Code | English (draft) | Arabic (draft) | Priority |
|---|---|---|---|
| `harassment` | Harassment or bullying | تحرّش أو تنمّر | normal |
| `inappropriate` | Inappropriate or sexual content | محتوى غير لائق أو جنسي | normal |
| `spam` | Spam or scam | رسائل مزعجة أو احتيال | normal |
| `child_safety` | A child's safety | سلامة طفل | **urgent** |
| `other` | Something else (a note is required) | سبب آخر (مع ملاحظة) | normal |

### 5.2 Response time and escalation (A-1)

- Every report gets `due_at = created_at + 48 h`. The queue shows the time left.
- At **36 h** with no answer, the responsible manager is notified (§6.3 defines who that is). At **48 h**, the Super Admin is notified and the report is marked `overdue`.
- **`child_safety` is escalated immediately:**
  - an in-app notification and a push to every Super Admin;
  - **it bypasses** the Notification Center's quiet hours (22:00–08:00) and its hourly cap (`pd034-notification-center.spec.ts`);
  - it sorts first in the queue and is never coalesced.
- "Responded" means the reporter has received an answer (`reporter_answered_at`), not just that a staff member opened it.

### 5.3 Database (shared migration with WP-2)

Migration `20261104100000_chat_pd057_reports_blocks.sql`, with the slot claimed in the same PR.
- The slot must sort after `main` **and** after #449's slot `20261103120000`.
- It follows the fail-closed pattern of `20261026120000_chat_pd032_parent_feedback_signup_code.sql`:
  - `enable row level security`;
  - `revoke all … from public, anon, authenticated, chat_app`;
  - one guard trigger function per table.

`chat.content_report` columns:
- `id`, `organization_id` (default `chat.default_organization_id()`);
- `reporter_kind`, `reporter_id`, `reporter_account_id`;
- `target_kind` (`message` | `person`), `message_id` (nullable), `conversation_id` (nullable), `subject_kind`, `subject_id`;
- `reason` (the five codes above, plus `blocked`, which only the server sets, for WP-2), `note` (≤ 500 characters; required when the reason is `other`);
- `evidence` jsonb: a snapshot at report time of the body, the attachment object keys, the author and the timestamps;
- `priority` (`urgent` | `normal`), `status` (`open` | `in_review` | `actioned` | `dismissed`), `due_at`, `overdue_at`;
- `taken_by`, `taken_at`, `resolution` (`no_action` | `message_removed` | `warned` | `account_suspended` | `reassigned`), `resolution_note`, `resolved_by`, `resolved_at`;
- `answer_text`, `reporter_answered_at`, `created_at`.

Constraints:
- a unique partial index allows one open report per reporter and target;
- the guard trigger makes the reporter, evidence, `created_at` and `due_at` immutable, and lets the status only move forward;
- a `chat.config` row for the `REPORT_SUBMIT` limit (10 per hour).

Prisma: a `ContentReport` model in `apps/api/prisma/schema.prisma`, marked "SQL owns the DDL".

### 5.4 API contract (frozen here so WP-1B and WP-1C can start)

| Method and path | Who | Request | Response | Errors |
|---|---|---|---|---|
| `POST /reports` | any signed-in user | `{targetKind: 'message'\|'person', messageId?, subject?: {kind, id}, reason, note?}` | `201 {id, status, dueAt}`; `200` when the same report is already open | `COMM.REPORT_TARGET_NOT_VISIBLE` (404), `COMM.REPORT_SELF` (400), `COMM.REPORT_NOT_REPORTABLE` (400), `COMM.REPORT_NOTE_REQUIRED` (400), `COMMON.RATE_LIMITED` (429), `COMM.TERMS_NOT_ACCEPTED` (403, after WP-3) |
| `GET /me/reports` | the reporter | — | `[{id, targetKind, reason, status, createdAt, answer?: {text, at}}]`. **No evidence, no reviewer name.** | — |
| `GET /moderation/reports?status&priority&overdue` | `moderation.view` | — | the queue, urgent first, then by `dueAt` | 403 |
| `GET /moderation/reports/:id` | `moderation.view` | — | the detail with its evidence. **Writes an audit row `report.viewed`.** | 403, 404 |
| `POST /moderation/reports/:id/take` | `moderation.act` | — | `200` | `COMM.REPORT_ALREADY_TAKEN` (409) |
| `POST /moderation/reports/:id/resolve` | `moderation.act` | `{resolution, note?, answer}` (answer required, ≤ 1000 characters) | `200` | 403, `COMM.REPORT_CLOSED` (409) |

Implementation, in `apps/api/src/moderation/`:
- files: `reports.controller.ts`, `reports.service.ts`, `moderation.controller.ts`, `moderation.service.ts`, `report-escalation.service.ts` (a sweep every 5 minutes for 36 h, 48 h and overdue), `dto.ts`; registered in `app.module.ts`;
- `message_removed` calls the existing `MessageService.deleteForEveryone` moderation path (`communication/messages/message.service.ts:1555`), so the audit and `message.deleted` come from it;
- `account_suspended` calls the existing admin suspend (`docs/security/DEACTIVATION.md`);
- `reassigned` is recorded, and the reassignment is done in the existing tools;
- answering sends `report_answered` to the reporter.

Supporting changes:
- **Permissions:** `moderation.view` (risk `pii`) and `moderation.act` (risk `admin`) in `apps/api/src/platform/permissions/catalogue.ts`; `role-templates.ts` gives them to managers and the Super Admin.
- **Rate limit:** `REPORT_SUBMIT` in `ActionScope` (`platform/auth/action-throttle.guard.ts:50`), plus a default in `platform/app-config.service.ts`.
- **Errors** in `apps/api/src/platform/errors.ts` and `docs/communication/error-codes.md`. They are additions only.
- **Events:**
  - outbox `REPORT_CREATED {reportId, priority}`, which **carries no content**, in `communication/contracts/events.ts`, with its audience in `outbox/outbox.worker.ts`;
  - a PD-47 task per report, so the SLA shows in Tasks;
  - notification catalogue entries `report_received_staff`, `report_child_safety`, `report_overdue` and `report_answered` (`notification-catalog.ts`, after PD-32 if it merges first).

### 5.5 Security and privacy requirements (each one is tested)

1. The reported person is never told who reported them, or that a report exists. A removed message looks like any moderated deletion.
2. A reporter sees only their own reports, with status and answer.
3. Evidence is shown only with `moderation.view`, and every view is audited.
4. Support and impersonation sessions can neither file nor resolve a report. They are not added to `SupportSessionInterceptor`'s allowlist.
5. The reporter must be able to read the message **now**, using the same visibility check as `message.service.ts` `list`, or must share a conversation with the person. That stops anyone using a report to fish for message ids.
6. **Erasure** (`chat.erase_account`, `20261102210000_chat_account_erasure.sql`):
   - the reporter reference is anonymised and the report is kept;
   - evidence about an erased subject is kept, as for the audit log;
   - one line goes in the retention header.
7. No note or evidence is written to logs. The `infra/observability` redaction list gains `note`, `evidence` and `answer`.
8. RLS: `chat_app` cannot select or modify either table (`db/tests/pd057_rls.sql`).

### 5.6 Tests (written first)

API integration, `apps/api/test/integration/pd057-reports.spec.ts`:
1. A parent reports a teacher's message in the Student Group: 201, with a task and a staff notification. The teacher sees no trace.
2. A parent cannot report from a conversation they are not in, nor their own message, nor a card or system message.
3. A duplicate returns the open report (200).
4. The 11th report in an hour gets 429.
5. Staff without `moderation.view` get 403. With it, they see the evidence even after the author deleted the message for everyone. The view is audited.
6. `child_safety`: priority urgent; a Super Admin push is created **during quiet hours** and **past the hourly cap**.
7. The sweep: at 36 h the responsible manager is notified; at 48 h the Super Admin is notified and the report becomes `overdue`. Fixed instants are used, never `now + N` across a day boundary.
8. Resolving with `message_removed` deletes the message for everyone, with an audit row naming the report. The reporter gets `report_answered`. `GET /me/reports` shows the answer and no reviewer.
9. An impersonation session gets 403 on `POST /reports` and on resolve.
10. After the reporter's erasure, the report is kept and is anonymous.

Unit and database: DTO shaping (no evidence in the reporter DTO), the escalation clock, and the RLS SQL test.

Flutter, `test/features/moderation/report_sheet_test.dart`:
- the action shows on someone else's message and not on one's own, a card or a system message;
- the request body is right;
- "already reported" and rate-limited answers show calm messages;
- a note is required for "other";
- right-to-left layout and screen-reader labels.

Also `test/core/data/http/moderation_over_http_test.dart`.

Admin Web, `ReportsPage.test.tsx` and `ReportDetail.test.tsx`:
- hidden without the permission;
- urgent first, then by time left;
- the overdue badge;
- resolve needs an answer;
- the evidence of a deleted message is shown.

### 5.7 Client files

**Flutter (WP-1B)**
- `lib/features/messages/presentation/message_actions.dart`: `MessageAction.report` in the enum (:14), in `actionsFor` (:96), and in the two exhaustive switches (:205-227).
- `chat_screen.dart` (around :549): **one `case`**, after #420.
- New `lib/features/moderation/`:
  - `presentation/report_sheet.dart`: radio tiles, not a dropdown;
  - `presentation/my_reports_screen.dart`;
  - `data/moderation_repository.dart`.
- `lib/core/data/http/http_moderation_repository.dart`, the fake in `fake_repositories.dart`, and wiring in `bootstrap.dart`.
- "Report" in `lib/features/profile/presentation/profile_sections.dart`.
- Settings → My reports, with its route in `router.dart`.
- Strings in `app_ar.arb` and `app_en.arb`. Arabic is primary.

**Admin Web (WP-1C)**
- `apps/admin-web/src/features/moderation/`: `ReportsPage.tsx`, `ReportDetail.tsx`, `api.ts`, `hooks.ts`, `copy.ts` (Arabic and English).
- A route in `src/app/AppRoutes.tsx` behind `RequirePermission any={['moderation.view']}`, nav in `src/app/navigation.ts`, and the area in `src/core/permissions/capabilities.ts`.
- `SearchableSelect` for every picker.

### 5.8 Acceptance criteria (WP-1)

1. A parent, teacher or Sales user can report any other person's message, or any person, in at most three taps, choosing from the five reasons, and gets a confirmation.
2. The report appears in the Admin Web queue within one minute, with a task and a 48-hour clock.
3. A child-safety report reaches every Super Admin at once, day or night.
4. At 36 h the responsible manager is alerted, and at 48 h the Super Admin. Nothing is left without an answer silently.
5. A manager can remove the message, warn, suspend, reassign or dismiss. Every action is audited and names the report. Answering the reporter is required to close it.
6. The reporter sees the answer, and the reported person learns nothing.
7. All the new tests pass. The existing suites pass:
   - `npx jest --maxWorkers=2`
   - `npm run test:int -- --runInBand`
   - `flutter test --concurrency=2`
   - `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`
   - `bash scripts/qa/guards.sh pd-registry`

---

## 6. WP-2: Block (PD-57)

### 6.1 Rules (A-2)

**What a block does**
1. It is **personal**. The blocker no longer sees the blocked person's messages in any shared conversation. They show as a one-line placeholder, "Message hidden: you blocked this person", with Unblock one tap away.
2. **No notification and no call** from the blocked person reaches the blocker: no push, no Notification Center item, no ring. A call from them is answered for the caller as "unavailable", the same as a busy line.
3. **Lessons are never interrupted:**
   - nobody is removed from any group;
   - lesson scheduling, reminders and cancellations are unaffected;
   - lesson cards and every `system` or `card` message are **never hidden**;
   - the lesson call between the learner and the teacher is never refused by a block. If a parent blocks the teacher, the teacher's lesson call to the family still rings, because it is the educational process. Only that teacher's chat messages and non-lesson notifications are hidden.
4. **Every block notifies the responsible manager** (§6.3). It also opens a moderation case: a `content_report` with `target_kind = person`, reason `blocked`, priority normal, and the same 48-hour clock.
5. **Staff cannot block a family.** Staff, including Sales, can report.
6. **The administrative channel is preserved.** These are never hidden or refused by a block:
   - the academy's official account;
   - the responsible manager and the Super Admin;
   - the family's **direct conversation with the academy**. If the blocked person is the family's supervisor, the manager reassigns or covers the direct conversation, and messages from the covering staff member are delivered.
   - The `POST /me/blocks` call refuses these targets with a clear reason.

**Who may block whom**

| Blocker \ blocked | Family | Teacher | Staff (supervisor, Sales) | Official account, manager, Super Admin |
|---|---|---|---|---|
| Family | — (no shared conversation) | **yes** (messages only; lesson calls still ring) | **yes** | **no** (administrative channel) |
| Teacher | **yes** | — | **yes** | **no** |
| Staff | **no** (A-2) | **no**: staff handle teachers through supervision tools | **no** | **no** |

### 6.2 Database and API

**Table `chat.actor_block`** (in the WP-1 migration):
- `id`, `organization_id`;
- `blocker_kind`, `blocker_id`, `blocked_kind`, `blocked_id`;
- `created_at`, `case_report_id`;
- the managers told of it are rows of **`chat.actor_block_manager_notice`** (A-2a): `id`, `organization_id`, `block_id` (→ `actor_block`, **on delete set null**, so an unblock keeps the history), `case_report_id` (→ the block's case, never deleted), `manager_staff_id`, `notified_at`; **unique (`block_id`, `manager_staff_id`)**; insert-only; RLS fail-closed;
- unique (blocker, blocked); deleting the row unblocks;
- RLS fail-closed.

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `POST /me/blocks` | `{subject: {kind, id}}` | `201 {id, subject, createdAt}` | `COMM.BLOCK_NOT_ALLOWED` (403: a staff caller, a protected target, or yourself), `COMM.BLOCK_NO_SHARED_CONVERSATION` (404), 429, `COMM.TERMS_NOT_ACCEPTED` (after WP-3) |
| `GET /me/blocks` | — | `[{id, subject: {kind, id, name, avatar}, createdAt}]` | — |
| `DELETE /me/blocks/:id` | — | `204` | 404 |

Message DTOs gain `hiddenByBlock: true`, with the body, attachments and preview removed, for the blocker only.

**Enforcement points.** One helper, `BlockService.blockedBy(viewer)`, cached per request.

| Point | File | Rule |
|---|---|---|
| Reading messages | `communication/messages/message.service.ts` `list` (:547) and `info` | The blocked author's `text`, `image`, `video`, `voice` and `file` messages become `hiddenByBlock` for the blocker. `system` and `card` messages are never hidden. |
| Push, notifications, realtime | `communication/outbox/message-audience.ts`, `outbox/outbox.worker.ts` | The blocker is removed from the audience of the blocked person's messages and mentions. The blocker receives a body-less `message.created`, so the placeholder can be drawn. **Not** in `realtime.gateway.ts`, which #439 changes. |
| Notification Center | the notification service's recipient resolution | Skips items authored by the blocked person, except lesson, schedule and administrative kinds (an allowlist from `notification-catalog.ts`) |
| Calls | `communication/calls/*` `start` | Not rung if the callee blocked the caller, **unless the call is a lesson call** (the lesson's `learnerId` and teacher). Lesson calls always ring. |
| Opening a direct conversation | `platform/authorization.service.ts` `canOpenDirect` (:261) | Refuses a blocked person opening a direct conversation with the blocker (`COMM.DIRECT_BLOCKED`), except staff covering the administrative channel |
| Erasure | `chat.erase_account` | Deletes the erased account's blocks in both directions |

### 6.3 "The responsible managers" (A-2a, owner decision 2026-11-04)

Worked out from data that already exists. A block notifies **every** responsible manager, not one.

| Blocker | Responsible managers |
|---|---|
| Family | (1) every supervisor assigned to any of the family's children (`LearnerSupervision.supervisorId`, all learners of the family); (2) the manager responsible for each of those supervisors (the `Department.managerId` of each supervisor's department); (3) **all of them, across departments**, each told once |
| Teacher | The department manager of the teacher's supervisor (PD-35 teacher supervision) |

**Rules**
- **No duplicate notice** to the same manager for one block: one `chat.actor_block_manager_notice` row per manager, unique (`block_id`, `manager_staff_id`) in the database.
- **The audit log** records every block (`block.created`, through the existing audit service), naming the blocker, the blocked person and the managers told.
- **Least privilege:** being notified grants a manager **nothing**. It is not a permission, it opens no family account or private conversation, and the notice carries only the names and a link to the case, which the manager opens with the permissions they already have (`moderation.view`).

**Fallbacks**
- A blocked person who **is** one of those managers is not told of their own block, and every Super Admin is told in their place (the other managers are still told). If there is no manager at all, every Super Admin is told.
- The notification (`block_created_manager`) names the blocker, the blocked person and the family or teacher, and links to the case.
- It is delivered in-app and by push, under the normal quiet hours. It is not urgent unless a child-safety report accompanies it.

### 6.4 Tests (written first)

`apps/api/test/integration/pd057-blocks.spec.ts`:
1. A parent blocks their supervisor:
   - for the parent only, the supervisor's chat messages are hidden in the direct conversation and the group, and other members see them;
   - lesson cards and system messages stay visible;
   - a case opens, and every responsible manager gets `block_created_manager` once (A-2a): a family whose children have supervisors in two departments tells both managers, and a manager over two of those supervisors is told once.
2. No push row is created for the blocker for the blocked person's messages. A non-lesson call does not ring.
3. **A parent who blocked the teacher still gets that teacher's lesson call ring, the lesson reminders and the cards.**
4. A blocked supervisor cannot open a new direct conversation with the parent. The covering staff member's messages in the family's direct conversation are delivered.
5. A staff caller cannot block a family. Nobody can block the official account, a manager, the Super Admin, or themselves.
6. If the blocked person is the department manager, the Super Admin is notified instead.
7. Unblocking restores the history at once.
8. Erasure removes blocks in both directions.
9. RLS denies `chat_app`.

Flutter, `test/features/moderation/block_test.dart`:
- the confirmation explains that lessons continue and the academy is told;
- the placeholder and Unblock;
- Settings → Blocked people;
- a protected target shows no Block item;
- right-to-left layout and screen-reader labels.

### 6.5 Client files (WP-2B)

- `profile_sections.dart`: Block or Unblock, not shown for protected targets or to staff.
- New `lib/features/moderation/presentation/blocked_people_screen.dart`, with its route in `router.dart`.
- `message_bubble.dart`: a `hiddenByBlock` branch.
- `chat_screen.dart`: at most one line, after WP-1B.
- The composer of a direct conversation with someone the user blocked shows "You blocked {name}. Unblock to write."
- Strings in Arabic and English.

### 6.6 Acceptance criteria (WP-2)

1. A family or teacher can block any non-protected person they share a conversation with, and unblock them in Settings. Staff see no Block action on families.
2. While blocked, the blocker receives no messages, notifications or non-lesson calls from that person, on Android or iOS.
3. **The lessons go on unchanged:** the lesson call, reminders, cards and group membership.
4. The responsible manager is notified of every block, and the case is in the queue under the 48-hour rule.
5. The administrative channel always reaches the family.
6. All the tests and existing suites pass.

---

## 7. WP-3: Terms of Use (PD-58)

### 7.1 Requirements (A-3), and what stays pending (N-3)

**The documents** (A-3). Each account accepts **two** documents:

| Account kind (`chat.account.kind`) | Terms document | Plus |
|---|---|---|
| `family` | **Family terms** | the shared **Code of Conduct** |
| `teacher` | **Teacher terms** | the Code of Conduct |
| `staff` (including Sales and the Super Admin) | **Staff terms** | the Code of Conduct |

- The **wording, URLs and version numbers** are pending (N-3). They are **configuration** that the owner supplies.
- The code contains document **keys** only: `terms_family`, `terms_teacher`, `terms_staff` and `code_of_conduct`.

**Recorded:** the account, the document key, the version, the time accepted (`timestamptz`), the client and the locale.

**Enforced on the server** for every way an account is created, because all of them reach `/auth/login`:
- PD-16 sign-up;
- PD-16 enrolment and PD-42 intake;
- PD-43 teacher onboarding and first-login codes;
- PD-40 staff accounts and setup codes;
- the Super Admin bootstrap (`cli/super-admin-bootstrap.ts`);
- the QA seed;
- Core-linked accounts.

**Existing consent is not weakened:**
- the PD-48 lesson-audio notice keeps its own versioned acknowledgement and its dialog. Terms acceptance never stands in for it, and sign-up still asks for both;
- the privacy policy stays a notice that is linked on sign-in, sign-up and Settings. It is never turned into a click-through "acceptance";
- account deletion, signing out and reading are **never** gated.

### 7.2 Database

Migration `20261104110000_chat_pd058_terms_acceptance.sql`, with its slot claimed.

`chat.legal_document_version`:
- columns: `document_key`, `version` (text, as the owner names it), `url_ar`, `url_en`, `effective_at`, `created_at`, `created_by`;
- primary key (`document_key`, `version`);
- **append-only**, written only by a security-definer `chat.publish_legal_version(...)`, which the owner's release process runs. No row ships in the migration: the owner's versions are pending (N-3).

`chat.terms_acceptance`:
- columns: `account_id`, `document_key`, `version`, `accepted_at`, `client` (`android` | `ios` | `web_portal` | `admin_web`), `locale`;
- primary key (`account_id`, `document_key`, `version`), with a foreign key to `legal_document_version`;
- **append-only**: the guard trigger refuses update and delete, except inside `chat.erase_account`, following `chat.erasing_family` (`20261102210000_chat_account_erasure.sql:43-63`);
- written only by the security-definer `chat.accept_legal_documents(account, [(key, version)], client, locale)`.

`chat.config` rows `legal.current.<document_key>` name the version in force.

- RLS is fail-closed on both tables.
- **Erasure:** acceptance rows are **kept** as the consent record, like the audit log. The account row is already anonymised. One line goes in the retention header.

### 7.3 Configuration safety (fail closed)

- In **production**, the API **refuses to start** if any of the four `legal.current.*` rows is missing or names a version that does not exist. The same pattern as #408 refusing to boot production on the logging push provider.
- Outside production, a missing configuration logs a warning and the gate uses test fixtures.
- So it can never happen that "no terms configured" quietly means "no terms required".

### 7.4 API contract

| Method and path | Request | Response | Errors |
|---|---|---|---|
| `GET /me`, `POST /auth/login`, `POST /auth/refresh` | — | Gain `legal: {required: [{documentKey, version, urlAr, urlEn}]}`, an empty array when everything is accepted. Added by hand to `toActorDto` and `TokenPairDto` (`platform/auth/auth.dto.ts:13-42`, `:90-120`). | — |
| `POST /me/legal/accept` | `{documents: [{documentKey, version}]}`, which must be exactly the required set for this account's kind | `200 {legal: {required: []}}` | `COMM.LEGAL_VERSION_STALE` (409), `COMM.LEGAL_WRONG_DOCUMENTS` (400), 403 in a support or impersonation session |
| `POST /auth/signup/verify` (PD-16, `platform/auth/parent-signup.service.ts` `verify` :109-173) | gains `acceptLegal: [{documentKey, version}]` | the existing result; acceptance is recorded in the same transaction, the way the lesson-audio notice is at :154-156 | `COMM.LEGAL_REQUIRED` (400) without it |

**The guard.** `apps/api/src/legal/`:
- files: `legal.service.ts`, `legal.controller.ts`, `requires-legal.decorator.ts` (`@RequiresLegal()`), `legal.guard.ts`;
- `LegalGuard` is global, registered after `AuthenticatedGuard` in `platform/auth/auth.module.ts:102-116`;
- it reads the account's kind and acceptances, one indexed query cached per request, beside `AuthService.authenticate`;
- a gated route answers 403 `COMM.TERMS_NOT_ACCEPTED`.

**Gated routes** (`@RequiresLegal()`). Every route that creates content others can see:
- `message.controller.ts`: send (:46), forward (:98), attachments/authorize (:118), reactions (:213), edit (:274);
- `storage.controller.ts` `PUT /storage/:objectKey` (:65);
- `conversation.controller.ts`: `POST direct` (:120), `family-group` (:141), `student-group` (:152);
- `story.controller.ts`: media (:107), create (:123), publish (:176);
- `parent-feedback.controller.ts`: `POST /me/feedback` (:28) and reply (:50);
- every write in `whiteboards/whiteboard.controller.ts`;
- profile and photo writes in `parent-profile.controller.ts`, `profile-photo.controller.ts` and `teacher-profile.controller.ts`;
- lesson report and absence posts in `lessons/lesson.controller.ts:63-99`;
- `POST /calls`;
- `POST /reports` and `POST /me/blocks`.

**Never gated:** reading, `/auth/*`, `/me` (GET), `/me/legal/accept`, `/me/account/delete`, the public `/account-deletion`, and `/parent-notices/*`.

### 7.5 Clients

**Flutter**
- `AuthUser` (`lib/shared/models/auth.dart:64-89`) gains `legalRequired`, parsed in `lib/core/data/http/http_auth_repository.dart`.
- New `lib/features/legal/presentation/legal_gate.dart`:
  - a full-screen gate in `lib/app/app.dart:91-97`, before `AppLockGate`;
  - it lists the required documents, each opening its **server-supplied** URL for the user's language, with one checkbox per document and "Agree";
  - it also offers Sign out and Delete account;
  - it holds back the lesson-audio notice and the app-lock offer while open.
- `parent_signup_screen.dart`: required checkboxes for the family terms and the Code of Conduct, next to the existing lesson-audio checkbox (:202-211), which stays as it is.
- A 403 `TERMS_NOT_ACCEPTED` on any call refreshes the identity and shows the gate.
- `LegalLinks` (`lib/core/legal/legal_links.dart`) is unchanged for the privacy-policy link.

**Admin Web**
- `src/core/auth/SessionProvider.tsx` reads `legal.required`.
- New `src/features/legal/LegalGate.tsx` sits after the authentication check in `src/app/AppRoutes.tsx:102-104`.
- Copy in Arabic and English.

### 7.6 Tests (written first)

API integration, `apps/api/test/integration/pd058-legal.spec.ts`:
1. **For each way an account is created**, the first `GET /me` lists exactly that kind's terms plus the Code of Conduct:
   - a PD-42 intake family;
   - a teacher created with `POST /teachers` and activated by a first-login code;
   - a staff account from `POST /admin/staff-accounts`;
   - a Sales account;
   - the bootstrap Super Admin;
   - a seeded account.
2. Before acceptance, every gated route returns 403 `TERMS_NOT_ACCEPTED`. After acceptance it works.
3. Accepting the wrong set (another kind's terms) gets 400. A stale version gets 409.
4. A new Code of Conduct version makes **every** kind accept again. A new teacher-terms version affects teachers only. Old acceptances are kept, with their timestamps.
5. Parent sign-up without `acceptLegal` gets 400. With it, the parent starts accepted, **and the lesson-audio notice is still recorded separately**.
6. An impersonation session cannot accept.
7. Reading, sign-out, account deletion and the parent notices work without acceptance.
8. Acceptance rows survive erasure. Update and delete are refused.
9. Production configuration: boot fails when a `legal.current.*` row is missing (unit test on the config validator).

**Route coverage**, `apps/api/test/unit/legal/legal-coverage.spec.ts`:
- it walks Nest's route metadata;
- it fails if any route rate-limited as MESSAGE_SEND, ATTACHMENT_UPLOAD, STORY_PUBLISH, WHITEBOARD_WRITE, CALL_START or REPORT_SUBMIT, or any route on a fixed list, lacks `@RequiresLegal()`;
- a new content route cannot bypass the gate.

Flutter, `test/features/legal/legal_gate_test.dart`:
- the gate shows exactly the required documents;
- Agree stays disabled until every box is ticked;
- Sign out and Delete account work from the gate;
- right-to-left layout and screen-reader labels.

Also: updated `startup_routing_test.dart` and the sign-up tests, which keep the lesson-audio checkbox; and Admin Web `LegalGate.test.tsx`.

### 7.7 Acceptance criteria (WP-3)

1. No account of any kind, created in any way, can post content before accepting its kind's current terms and the current Code of Conduct. The server checks this.
2. Each acceptance is recorded with document, version, timestamp, client and locale, and is never edited.
3. A new version of any document asks exactly the affected accounts again, at their next request.
4. The PD-48 notice, the privacy-policy links and account deletion work exactly as before.
5. Production cannot run without the owner's configured versions.
6. The coverage test fails if a content route is not gated.
7. **The store build ships only after N-3** gives the texts, URLs and versions.

---

## 8. WP-4: Payments: the Google Play policy assessment (A-6). No implementation yet.

### 8.1 What the policy says (official sources, read 2026-11-03; §13)

- **Play Billing is required** for in-app purchases of digital goods and services. Examples: "Subscription services (such as fitness, game, dating, **education**, music, video …)"; and "App functionality or content (such as … new features not available in the free version)".
- **The 1:1 exception.** An app that "provides a 1:1 online paid service" does not need Play Billing if:
  - "the paid service is between two individuals"; **and**
  - "the paid service is not available for replay afterwards (that is, the session is not recorded and cannot be accessed or used again) in any Play-distributed app".
  - Its examples include "education or hobby classes (such as music or art lessons)".
- **Mixed products.** Play Billing "must be used for the SKUs in your app that include more digital goods or services than physical goods or services, and for the SKUs … marketed to users as digital goods or services".
- **Anti-steering.** For anything that is **not** exempt, an app "may not lead users to a payment method other than Google Play's billing system". That includes links, buttons, webviews and messaging. For an **exempt** service, a non-Play payment is permitted.
- **Regional programmes** (alternative billing; external content links, US; the billing choice programme, UK, EEA, Australia, Japan) exist. They carry service fees and enrolment duties, and they are **not needed for exempt services**. They are a fallback only if some product turns out to be non-exempt and the owner prefers not to use Play Billing.

### 8.2 Assessment, product by product

This table is the inventory of what the app sells today. Sources: `apps/api/prisma/schema.prisma`, `apps/api/src/billing/**`, `lib/features/billing/**`.

| # | Product or flow | What is bought | Evidence in code | Assessment | Status |
|---|---|---|---|---|---|
| 1 | **Learner subscription** (`LearnerSubscription`: `planMonths`, `lessonsIncluded`) | A package of **live lessons** for one child | `Lesson.learnerId` is a single learner (`schema.prisma` around :1369). Calls are live audio through LiveKit. **No recording or egress code exists** in `lib/` or `apps/api` (searched 2026-11-03). | **Eligible for the 1:1 exception**, *if* every lesson in the package is live, between the teacher and one learner, and never replayable. | **Conditionally eligible.** See risks R-1 to R-4. |
| 2 | **Instalments** (`FamilyInstalment`), balance and renewal payment requests | Payments **for product 1**, spread over time | `PaymentRequest.purpose` is subscription, renewal, instalment, balance or other | Takes the classification of what it pays for | Eligible for subscription, renewal, instalment and balance. **`other` cannot be classified.** See R-5. |
| 3 | **Trial lesson payment** (`TrialSubscription`; `trial.controller.ts:107,115`) | A live trial lesson | Trials are lessons with a `prospectId` | Eligible if it is a live 1:1 lesson with no replay | Conditionally eligible (N-5) |
| 4 | **Card checkout** (`POST /me/billing/checkout`, Stripe in the external browser, `pay_sheet.dart:55-90`) | A way to pay for 1–3 | `attachment_opener.dart:40`, `LaunchMode.externalApplication` | Permitted for exempt items. It must **never** be offered for a non-exempt item. | Needs safeguard S-1 |
| 5 | **Bank transfer and receipt upload** (`bank_transfer_screen.dart`, `POST /me/billing/receipts`) | The same | — | As 4 | Needs S-1 |
| 6 | **Web pay link** (`GET /pay/:token`, `pay-link.controller.ts`) | The same, outside the app | Shown to staff only (`payments-read.service.ts:243`) | Outside the app, so outside the Play policy's in-app scope | OK |
| 7 | **Learning materials** (PD-29 lessons, PD-49 games, PD-48 lesson audio) | **Not sold today.** Deferred to Phase 2. | No price or SKU exists | **Digital content.** If ever sold, or made part of a paid package, it needs Play Billing. | Must stay free and not tied to payment (S-3) |
| 8 | **Whiteboards** (saved pages, PNG export), lesson reports, rewards | Part of the lesson experience | Pages persist after the lesson, and boards can be exported | Persistent artefacts **of** a lesson. They are not a recording of the session, but a reviewer could see them as "accessible again" or as digital features. | Risk R-2; safeguard S-3 |
| 9 | **Chat access while unpaid**: the PD-30 lock (`subscription-effects.service.ts:31-34, 98, 271-279`) | A lapsed payment pauses lessons **and** replaces the family's chat composer with the lock banner | `chat_screen.dart:203-220, 1260-1262` | Locking an **app feature** (chat) behind payment can make the subscription look like it sells app functionality, which is the digital category | **Risk R-3** (N-5) |
| 10 | **Group services** | — | No priced group-class product was found. But conversation types `class_group` and `student_group` exist. | **Not eligible** for the 1:1 exception. A paid group class needs Play Billing, or must not be sold in the app. | N-5: confirm none is sold |
| 11 | **Sales staff screens** (record a payment already made, void an instalment) | Back-office work, not a purchase | `lib/features/sales_payments/**` | Out of scope of the Payments policy | OK |

### 8.3 Policy conditions, restrictions and risks

**Conditions that must stay true for products 1–3**

| Condition | Required |
|---|---|
| C-1 | Each paid lesson is **live** and **between the teacher and one learner**. A parent sitting in does not change this. Two learners in one paid session would. |
| C-2 | **No recording** of a lesson session, audio or otherwise, is made or offered in any Play-distributed app: no LiveKit egress, no "replay". |
| C-3 | The product is **marketed as live one-to-one lessons**, in the store listing, the pay sheet and receipts. It is never marketed as access to content, materials or app features. |
| C-4 | Nothing digital (materials, games, lesson audio, rewards, board exports, extra features) is unlocked by paying, or locked by not paying. |

**Restrictions:** anything not meeting C-1 to C-4 must:
- use Play Billing;
- or be sold only outside the app, with **no** in-app link, button or message pointing to it;
- or go through a regional programme, which is an owner decision.

**Risks**

| # | Risk | Likelihood | Impact |
|---|---|---|---|
| R-1 | A future feature records lessons, for example a teacher's "record for review", and breaks C-2 | Low today | The subscription loses the exception |
| R-2 | Reviewers treat persistent whiteboard pages, exports or lesson reports as replayable content | Medium | A rejection, or a request for Play Billing |
| R-3 | The PD-30 lock pauses **chat**, which makes the subscription look like it sells app functionality | Medium | The same |
| R-4 | The listing or pay sheet describes the package as access to "the Jawwid program" or its materials, breaking C-3 | Medium | The same |
| R-5 | `PaymentRequest.purpose = 'other'` lets staff charge for something unclassified through the in-app checkout | Medium | An unknown item is paid outside Play Billing |
| R-6 | Materials or games are sold in Phase 2 without Play Billing | Future | A policy strike |
| R-7 | The Apple App Store has its own rule (3.1.3(d), person-to-person services), assessed separately in #447 | — | iOS review |

### 8.4 Questions for the owner (N-5)

1. Is any **group** class, or any session with more than one learner, sold today or planned? If so, which?
2. When a payment lapses, may the **chat** stay open while only lessons pause? The alternative is to keep the lock and accept risk R-3.
3. Will **materials, games or any digital feature** ever be sold or included in a paid package? This is Phase 2 and needs Play Billing if so.
4. Is the **trial** lesson paid, and is it always live and one-to-one?
5. Should `PaymentRequest.purpose = 'other'` be payable in the app at all, or only by the web pay link and bank transfer?

**Answered 2026-11-05 (owner):** 1, no group class is sold in the app; 3, no standalone digital
material is sold in the app. Card and bank transfer stay in both store builds. Questions 2 and 4
stay open. Question 5 was decided by the lead as the safe default: `other` is not payable in the
app. S-1 (as a purpose classification, no migration), the call part of S-2 (a test, not a
guard), S-4 and S-5 are done: `docs/release/app-review-notes-payments.md`.

### 8.5 Safeguards to build after the owner's go (WP-4 phase 4B)

| # | Safeguard | Where |
|---|---|---|
| S-1 | **A classification on every payable item.** `play_billing_class`: `live_one_to_one` or `not_in_app` on the payment request and the plan. The in-app checkout and receipt endpoints refuse a `not_in_app` item (`COMM.PAYMENT_NOT_IN_APP`). The app shows Pay only for `live_one_to_one` items. `other` defaults to `not_in_app`. | `apps/api/src/billing/payments.controller.ts:96`, `parent-payments.service.ts`, a new migration column; `pay_sheet.dart`, `payment_sections.dart` |
| S-2 | **A no-recording guard.** A CI guard that fails on any LiveKit egress or recording API in `lib/` or `apps/api`, plus a decision line in `docs/architecture/decisions.md`. The guard belongs to `scripts/qa/guards.sh`, a Code Owner path. | `scripts/qa/` (owner approval) |
| S-3 | **Digital features stay free.** A test asserts that no material, game, lesson-audio, reward or whiteboard endpoint checks a subscription or payment state. | API unit test over the route metadata |
| S-4 | **Wording.** Pay sheet, receipts and invoice texts say "live one-to-one lessons". This is owner-approved copy (N-5). | ARB files and the invoice template |
| S-5 | **Evidence for review.** Review notes for Play: "Payments are for live one-to-one lessons between a teacher and one learner, never recorded (Payments policy, 1:1 online services)." Also a short screen recording of a lesson call. | Owner, at submission |
| S-6 | **The lock (R-3)**, as N-5 question 2 decides | `subscription-effects.service.ts`, `chat_screen.dart` |

### 8.6 The approved suspension message (A-4), phase 4C

**Where it goes** (all clients, both languages):
- the lock banner (`lib/features/messages/presentation/payment_lock_banner.dart`);
- the `lessons_paused` and `subscription_locked` chat cards, rendered by the server (`subscription-effects.service.ts`, the card renderer);
- the matching notification texts (`notification-catalog.ts`).

The "open subscriptions" button in the banner stays, because payment stays in the app (A-6).

**Tests:** the ARB keys exist in both files, with the `{child}` placeholder; a card snapshot; and the banner widget test with the Arabic text exactly as approved.

**Acceptance:** the exact approved wording appears wherever lessons are paused for payment, in Arabic and English, with the child's name.

### 8.7 Acceptance criteria (WP-4, once implemented)

1. Every payable item is classified. The app can never take a non-Play payment for a `not_in_app` item. A server test proves the refusal.
2. C-1 to C-4 hold and are guarded (S-2, S-3).
3. The suspension message is exactly as approved.
4. The review notes and evidence are ready.

---

## 9. WP-5: Call foreground service (finish PR #411, after G0)

#411 already contains:
- `CallForegroundService`, started on media join while the app is in front and stopped on every terminal path;
- the ongoing notification with Hang up;
- Dart tests (the N6 group in `native_call_bridge_test.dart`).

**What is left**
1. **Microphone type only.**
   - Android documents `phoneCall` as "continue an ongoing call using the ConnectionService APIs", and #411 does not use ConnectionService.
   - Set `foregroundServiceType="microphone"`.
   - Remove `FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS` from #411's `AndroidManifest.xml` and `CallForegroundService.kt`.
2. **Rebase onto `main`** after #408 (including G0) merges. #411 merged cleanly onto `main` on 2026-11-03 (`git merge-tree`). Re-run `flutter test test/features/calls --concurrency=2`.
3. **A manifest test**, `test/app/android_call_service_manifest_test.dart`, in the style of `test/l10n/android_launcher_label_test.dart`. It checks that the service is not exported, has type `microphone` only, and that `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE` are declared.
4. **The Play Console declarations** (owner; text prepared). The declaration asks for a description, the user impact, a video and a use case:
   - **Description:** "A voice call between a teacher and a family, or the academy and a family, that the user starts or answers. The service runs only while the call is connected, shows an ongoing-call notification with Hang up, and stops when the call ends."
   - **User impact if deferred:** "The other person stops hearing the user as soon as the screen locks or another app opens, and the lesson call fails."
   - **Use case:** entered manually as "voice calling (communication app)". The preset microphone use cases are voice recording and assistants.
   - **Video:** start a call, press Home, lock the screen, show the notification, and hang up from it.
   - **Full-screen intent (#408):** declare "calling". If Play does not grant it by default, #408 already falls back to a heads-up call notification.
   - **Risk:** Play may expect VoIP apps to use ConnectionService with the `phoneCall` type. **Fallback, if the declaration is refused:** a self-managed `ConnectionService` (about 3–4 days). It is not started unless needed.
5. **Device acceptance**, `docs/qa/submission-device-test-plan.md` §7, on Android 13, 14 and 15/16:
   - SB-30 (Home and another app, 2 minutes);
   - SB-31 (screen locked, 2 minutes);
   - SB-35 (hang up from the notification);
   - plus: a declined call never starts the service, and a refused start does not crash.

**Acceptance criteria (WP-5)**
1. The manifest declares `microphone` only.
2. #411's tests and the manifest test pass.
3. SB-30, SB-31 and SB-35 pass on a real Android 14+ phone.
4. The owner's declaration is filed with the video.

---

## 10. WP-6: Final Android release audit

**New script `scripts/qa/android-release-audit.sh <aab> <expected-package> <upload-cert-sha256> <last-version-code>`.**
- `scripts/qa/` is a **Code Owner path**, so the script needs owner approval.
- The package name is a parameter, because N-2 is pending.
- It runs locally on the exact AAB to be uploaded, with no network. It fails on any of the checks below.

| Check | How |
|---|---|
| `package` equals the owner's final name (N-2) | `bundletool dump manifest` |
| `targetSdkVersion` is 36 or more (required for new apps from 31 Aug 2026), and `minSdk` is 26 | the same |
| **The exact permission set**: INTERNET, ACCESS_NETWORK_STATE, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS, USE_BIOMETRIC, USE_FINGERPRINT, WAKE_LOCK, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE, USE_FULL_SCREEN_INTENT, `com.google.android.c2dm.permission.RECEIVE` and the app's `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Anything else fails, including any storage, media, location, phone, SMS or contacts permission, and `QUERY_ALL_PACKAGES` |
| **No advertising ID** | `com.google.android.gms.permission.AD_ID` is absent. Defence in depth: `tools:node="remove"` in the manifest after G0, #411 and #447 merge. |
| Exported components | `MainActivity`, plus Firebase's own receiver with its signature permission, and nothing else. `DebugPushReceiver` must not be present. |
| `allowBackup="false"`, not debuggable, no cleartext | the dumped manifest |
| **16 KB page alignment** | `zipalign -c -P 16 -v 4` on the universal APK (`bundletool build-apks --mode=universal`), and `llvm-readelf -lW` on every `lib/*/*.so` (each LOAD segment aligned to 0x4000 or more) |
| Signed with the upload key | `keytool -printcert -jarfile` compared with the owner's certificate fingerprint |
| `versionCode` is above the last upload | a parameter |

**A Flutter config test**, `test/app/android_release_config_test.dart`, written after #447 merges. It checks the same permission allowlist against the **source** manifests, so a pull request fails early.

**Run order** (only with the load under 60):
1. `scripts/mobile/build-store.sh android` with the owner's key, `google-services.json` and Sentry DSN.
2. The audit script.
3. The owner uploads to **internal testing**.
4. The pre-launch report with the demo credentials.
5. The device plan.

**Acceptance criteria (WP-6)**
1. The audit passes on the exact AAB to be uploaded, and its output is recorded in `docs/qa/release-gate.md`.
2. The pre-launch report shows no crash and no policy warning.
3. The device rows pass on Android 13, 14 and 15/16.

---

## 11. Google Play Organization developer account (A-7)

Engineering creates and registers nothing. This section is the owner's checklist. Sources: §13, read 2026-11-03.

### 11.1 What Google requires

| Requirement | What Google says |
|---|---|
| **D-U-N-S number** | Required: "You can't create an organization developer account without a valid D-U-N-S number." It is free from Dun & Bradstreet, beware of paid third parties, and can take **up to 30 days**. Only government bodies can ask support for a bypass. |
| **Legal name and address** | Come from the linked **Google payments profile**, and "must exactly match the details in your Dun & Bradstreet profile". The D-U-N-S number and account type cannot be edited on an existing payments profile; a new one would be needed. |
| **Organization phone** | The public business phone on the website or in D&B. Used for verification and not displayed. |
| **Organization website** | Required, and **verified** for organization accounts. |
| **Contact name, email and phone** | So Google can reach the organization. Each is verified with a one-time code. |
| **Developer email and phone** | Shown on the Play developer page. Verified. |
| **Authorized representative** | An official government identity document of an authorized representative. |
| **Organization document** | An official organization document. "All submitted documents must exactly match the information in your payment profile." |
| **Payment method** | For the one-time registration fee. Verifying a payout method can mean a deposit challenge or bank documents, up to 5 days. |
| **Trader status** | Required in regions such as the EEA and UK. Traders show more details on the listing. |
| **Developer name** | The public name on Google Play. It may differ from the legal name and can be changed. |
| **Testing requirement** | The 12-tester, 14-day closed-test rule applies to **personal** accounts created after 13 Nov 2023, so an Organization account avoids it. Internal testing and a staged rollout are still recommended (§10). |

### 11.2 Consistency rules to respect

1. The **same legal name and address** in the D&B record, the Google payments profile and the organization document, character for character, including the Latin transliteration of an Arabic name.
2. The D-U-N-S number is entered **when the payments profile is created**. Do not create the payments profile before having the D-U-N-S number.
3. The website named on the account must be live, on the organization's domain, and verifiable. It should host the privacy policy and the account-deletion page, after N-3.
4. The developer email should be on the organization's domain, monitored, and the same as on the store listing.

### 11.3 What the owner still needs to provide

| Item | Needed for |
|---|---|
| The organization's **exact legal name** (as registered) and its **registered address** | D&B, the payments profile and the documents |
| The **registration document**: commercial register extract or certificate of incorporation, in the country of registration | Organization verification |
| The **D-U-N-S number**, or a D&B application started now, because it takes up to 30 days | Account creation |
| The **authorized representative's** full name, role and government ID | Identity verification |
| The public **organization phone number** and **website URL** on the organization's domain | Verification |
| A **contact** person, with email and phone, for Google | Verification |
| The **developer email and phone** shown publicly | The developer page |
| The **developer name** shown on Google Play | The listing |
| A **payment card** for the registration fee, and the **bank account** for payouts, in the organization's name | The payments profile |
| **Trader** status, if the app is offered in the EEA or UK | The trader declaration |
| The Google account (organization domain) that will own the developer account, and who else needs access | Console users |

---

## 12. Coordination register

**Sessions and worktrees** (2026-11-03):

| Worktree | Branch | Session | Owns | This plan |
|---|---|---|---|---|
| `~/dev/jawwid-chat` | `main` (clean, behind origin) | — | — | not touched |
| `~/dev/jawwid-pd032-push` | `claude/pd032-feedback-reply-notifications` (draft PR #449) | "Parent feedback admin interface" | PD-32; `674765a1`; slot `20261103120000` | not touched; G0 split agreed 2026-11-03 |
| `~/dev/jawwid-push-acceptance` | `claude/push-acceptance` (`24c10f39`) | "App store release readiness" | push acceptance (G0) | not touched; G0 decision sent |
| `~/dev/jawwid-release-review` | `claude/store-release-readiness` (#447, 4 commits ahead) | "App store release readiness" | the two-store report; `7ef999eb` | not touched |
| `~/dev/jawwid-play-review` | `claude/google-play-readiness` (#448) | this session | this plan and report | the only tree changed |
| `~/jawwid-manualqa`, `~/jawwid-qa-env/*` | QA | QA | manual QA | not touched |
| PRs #408 and #411 | `claude/android-push-fcm`, `claude/android-call-foreground-service` | not active since 2026-11-02 | Android push, calls, foreground service | changed only through G0 and WP-5, on those branches |

**File conflicts** (open PRs and local branches, checked 2026-11-03):

| File | Also changed by | Handling |
|---|---|---|
| `chat_screen.dart` | #420; WP-1B, WP-2B, WP-4 | One package at a time, each rebased; one-line edits |
| `realtime.gateway.ts` | #439 | WP-2 filters in `message-audience.ts` instead |
| `AndroidManifest.xml`, `MainActivity.kt` | #408, #411, #447, 674765a1, 7ef999eb | G0 first; WP-5 on #411; WP-6 last |
| `scripts/mobile/build-store.sh` | #447 | Nothing in this plan edits it before #447 merges |
| `notification-catalog.ts`, `router.dart`, `settings_screen.dart`, `parent_signup_screen.dart` | #449 (PD-32) | Additions only; rebase after #449 |
| `app_ar.arb`, `app_en.arb` | most PRs | New keys in a new block |
| `.github/workflows/ci.yml`, `scripts/qa/**` | #408 | Code Owner approval (A-5) |

---

## 13. Rules for every package

- Each package has its own worktree and branch. Never another session's tree, and never a file §3 or §12 assigns elsewhere.
- Tests are written first: each fails before the change and passes after it. No test, guard, check or permission is weakened.
- **Before any heavy run:** check `uptime`, and wait while the 1-minute load is over 60. Use a private Postgres and Redis with unique names. Never the shared system-test stack.
- **Migrations:** claim the slot in the same PR. Never apply one to a shared or production database.
- **Copy:** user-facing text goes in Arabic and English, with Arabic primary. Legal and payment copy uses only owner-approved wording.
- **Jawwid Core** is never read, changed or called.
- **No push, merge, deploy, upload or publish** without the owner's explicit approval.

---

## 14. Sources (all read 2026-11-03)

**Payments**
- [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)
- [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en): 1:1 services, SKUs, consumption-only, anti-steering
- [Alternative billing for users in the US](https://support.google.com/googleplay/android-developer/answer/16497028?hl=en)
- [External content links programme (US)](https://support.google.com/googleplay/android-developer/answer/16470497?hl=en-GB)
- [Billing choice programme](https://support.google.com/googleplay/android-developer/answer/17161464?hl=en)

**User content, target API and services**
- [User-generated content](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en)
- [Target API level](https://developer.android.com/google/play/requirements/target-sdk)
- [Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Foreground service and full-screen intent declarations](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en)

**Developer account**
- [Required information to create a developer account](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en)
- [Choose a developer account type](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en)
- [Verify your developer identity information](https://support.google.com/googleplay/android-developer/answer/10841920?hl=en)
- [Update identity details managed by a payments profile](https://support.google.com/googleplay/android-developer/answer/16260648?hl=en)
- [Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
