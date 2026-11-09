# Jawwid Chat — Release Gate

**Re-assessed 2026-11-02 against `main` @ `12189c9e`, for Phase 1.** Phase 1 means the system app goes to the App Store and Google Play; Materials are frozen. Owner of this assessment: release-qa.
Previous assessment: 2026-09-05 (AI #5). G-01 was re-versioned on 2026-09-23 (PD-6) and again on 2026-10-14 (PD-7).
Authoritative scope: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` together with the PD registry (`docs/product/pd-registry/`). PRD v0.1 (`docs/qa/authoritative-scope.md`) is still the baseline wherever a later PD is silent.

A release is **BLOCKED** if any gate is failing **or unverified**. The two are
treated identically: an untested control is not a control. A gate marked
**RETIRED** was removed by a named product decision. It is not counted as passing.
It is kept only so its history stays auditable.

**What the evidence is.** It comes from four places:
- code and test files on `main` @ `12189c9e`;
- the `CI` workflow, which has 8 jobs (§5, G-36). The last completed run on main, https://github.com/MohamedEmadLasheen/jawwid-chat/actions/runs/41471455277 on `0d1a1f50`, passed all 8 jobs;
- the final-acceptance QA matrices in `~/jawwid-acceptance`, consolidated by `final/consolidate.py`;
- the local system-test stack.

Most CI runs on main show "cancelled", because `ci.yml` uses `cancel-in-progress` and each merge replaces the run before it. That does not mean those runs failed. A gate that cites CI cites a run that completed.

## 1. Current verdict

# 🔴 NOT READY for store submission

The codebase is far from the September picture. The P0s that blocked it then
(JC-001/003/009/010) are fixed or contained in code. The final-acceptance QA
(512 rows) found **3 P1s, and all 3 are fixed**. What blocks Phase 1 now is mostly
**not** chat behaviour. It falls into four groups.

1. **Store requirements still open** (§2a, re-verified 2026-11-03). Deletion, the privacy manifest, signing,
   the release entitlement and crash reporting are now built. Still open:
   - no way to report content (S-09);
   - card checkout and the store payment rules (S-10);
   - Android push (S-05);
   - the owner decisions and store forms in §2c.
2. **There is no production environment.** Phase 1 has no server to point the store builds at. It needs the owner's accounts and keys: `docs/infrastructure/production-readiness.md`.
3. **Calls do not ring when the app is closed**, on either platform. The iOS PushKit/CallKit path exists but is switched off and has never run on a device. Android has no call UI.
4. **Gates still open:**
   - G-06 (PARTIAL): LiveKit's media plane has never been tested against a real server.

**Final acceptance, 2026-11-02 20:03** (`~/jawwid-acceptance/final/summary.md`). The QA sessions tested on the local system-test stack, on simulators, and on one physical iPhone. Not every row has been re-run since.

| Domain | Rows | PASS | FAIL | BLOCKED | NOT TESTED |
|---|---|---|---|---|---|
| admin-roles | 168 | 154 | 12 | 1 | 1 |
| chat-scheduling | 57 | 38 | 15 | 4 | 0 |
| parent | 156 | 134 | 10 | 1 | 11 |
| teacher | 107 | 89 | 15 | 1 | 2 |
| device (physical iPhone) | 24 | 0 | 0 | 2 | 22 |
| **all** | **512** | **415** | **52** | **9** | **36** |

8 of the 52 FAIL rows have already been retested PASS after their fix. Most of the rest have a merged fix that is waiting for a retest (§2b). The device checklist (`device/device-checklist.md`) has not been run with the owner yet.

> **Superseded verdict (2026-09-05).** 🔴 NOT READY: implementation in progress;
> two unmerged migration lineages; the working tree could not build a database
> on its own; five P0s open (JC-001/002/003 scope, JC-009 database architecture,
> JC-010 silent schema divergence) and two P1s (JC-007, JC-008).

---

## 2a. Phase 1 store-submission gates (new 2026-11-02; re-verified 2026-11-03)

Each one is a hard blocker for its store. Re-verified on 2026-11-03 against `main` @ `c7ca895c`
by reading the code and building a signed release AAB and an unsigned iOS release build.

| # | Gate | Status | Evidence |
|---|---|---|---|
| **S-01** | Users can delete their own account in the app, and the server erases it; Google Play also needs a web link | **PASS, one risk** | Settings → Delete account for parents and teachers (`settings_screen.dart`), then `POST /me/account/delete`. The public web page is `GET/POST /account-deletion`. O-3 (owner, 2026-11-07): a teacher with open lessons or payroll requests deletion in the app and is deleted within 30 days (`pd056-teacher-deletion-request.spec.ts`); `TEACHER_DELETION_BLOCKED` is retired. |
| **S-02** | iOS privacy manifest, and accurate App Privacy / Data safety answers | **PASS** (manifest) | `ios/Runner/PrivacyInfo.xcprivacy`. Crash data was added 2026-11-03. The store forms are filled by the owner (§2c). |
| **S-03** | iOS release signs with the distribution team and the production push entitlement | **PASS** (config) | Team `KX683HAR3Y`; Release uses `RunnerRelease.entitlements` (`production`). It has not yet been signed with a distribution certificate. |
| **S-04** | Android release is signed with an upload key, as an AAB | **PASS** | A release AAB built and signed from `key.properties`; without it the build refuses. Every native library is 16 KB aligned. |
| **S-05** | Android receives push | **BUILT (#408 + #449, reconciled); BLOCKED on Firebase and a device** | `~/dev/jawwid-push-acceptance` (uncommitted, based on PR #449 plus PR #408; report `docs/release/push-notification-acceptance.md` there). FCM via #408 (release refuses to build without `google-services.json`). Ordinary pushes are drawn by `JawwidPush.showMessage` with #449's rules. Release AAB built with a placeholder config: service and receiver not exported, every 64-bit `.so` 16 KB aligned. Kotlin `PushPayloadTest` 13/13. Real delivery: BLOCKED (the owner's Firebase project, `FCM_*` on the server, a device). |
| **S-06** | An incoming call rings when the app is closed | **FAIL** | iOS: PushKit and CallKit are built, and every VoIP push reports a call (a duplicate push re-reports its call since 2026-11-03; before that it reported nothing, which iOS punishes by terminating the app), but it is off on the server (`APNS_VOIP_ENABLED`) and has never run on a device. Android: no call UI. |
| **S-07** | Production crash reporting in the app | **PASS** (code) | Sentry, release only, with personal data scrubbed (`lib/core/crash/crash_reporting.dart`). `build-store.sh` passes `SENTRY_DSN` through since 2026-11-03. Before that, every store build had it off. The app DSN is the owner's. |
| **S-08** | A production backend exists for the store builds | **FAIL, owner** | `docs/infrastructure/production-readiness.md`. |
| **S-09** | People can report what other people post (App Store 1.2; Google Play user-generated content policy) | **FAIL, not built** | Chat (text, voice, photo, video), stories and feedback have no "report" action, and the API has no report endpoint. The community is closed and supervised by staff, which helps, but Apple still expects a report mechanism for what users post. Owner decision O-1 (§2c). **Learning materials are outside this gate.** They are published by the academy, not posted by users, so 1.2 does not ask for reporting on them. Any reporting or feedback on materials is deferred to Phase 2 (owner, 2026-11-03), is not built, and is not required for launch. Note: PD-29's lesson-report Materials section (`report-materials.ts`, "practice this week" and memorization marks) is a different thing: it is part of the lesson report, not a content report, and it is kept. |
| **S-10** | Payments follow App Store 3.1 and Google Play's payments policy | **RISK, owner** | The Pay sheet opens Stripe Checkout in the browser ("Pay by card"), and offers a bank transfer. App Store 3.1.3(d) exempts live one-to-one services only; group classes do not qualify. Owner decision O-2 (§2c). |
| **S-11** | Notification permission asked at the right time, explained, denial handled | **PASS (code, tests, builds); BLOCKED (device)** | Never asked automatically. The Chats card explains first ("class reminders, messages, and calls"), and the prompt follows "Turn on". Denied → ask again (Android). Permanently denied, or off in Settings → "Open settings" (this app's notification settings). Re-read on resume. "Not now" is not final: Notification settings → "Notifications on this phone". `notification_permission_test.dart` 15/15. Prompt on a phone: BLOCKED. |
| **S-12** | A notification opens its exact destination, in front / background / closed | **PASS (code, tests, builds); BLOCKED (device)** | `~/dev/jawwid-push-acceptance` (uncommitted, based on PR #449 plus PR #408; report `docs/release/push-notification-acceptance.md` there). iOS delegate set before launch; Android `onCreate`/`onNewIntent` with the install nonce. Dart holds a launch tap until the session is back, drops it when nobody is signed in, and routes through the Notification Center's per-role button. `push_open_test.dart`, iOS XCTest 8/8. All three states on a phone: BLOCKED (APNs key, Firebase). |
| **S-13** | No duplicate notifications; calls and CallKit unchanged | **PASS (code, tests); BLOCKED (device)** | No in-app banner exists. Chat is quiet while open on both platforms; other kinds show once. A repeat delivery replaces itself (iOS `apns-collapse-id`, Android tag), and a newer chat message replaces the older. Calls are never drawn or routed as ordinary notifications; VoIP payload unchanged; CallKit untouched. Android Answer/Open now require the install nonce. |
| **S-15** | A notification never reaches or opens for an account that is not signed in on the phone | **PASS (code, tests); BLOCKED (device)** | Server: delivery only while the token's sign-in is live (survives refresh; ends at sign-out, remote revoke, expiry). Migration slot `20261103130000`. `push-session-binding.spec.ts` 9/9; with the filter removed, the 4 sign-out and expiry cases fail. App: a tap for another account is dropped; Android draws nothing for another account or while signed out; iOS hides it while open. Lock-screen text on iOS in the background is drawn by iOS; the server binding is the control there. |
| **S-14** | No iOS privacy prompt is missing | **PASS** (since 2026-11-03) | `NSPhotoLibraryAddUsageDescription` was added in English and Arabic. Before that, "Save Image" on a board exported as PNG would have terminated the app. A test now checks that every usage string has both translations. |

### 2c. What the owner must decide or provide before submission

- **O-1 Report content (S-09).** Scope: what people post (chat and stories), not learning materials, which are deferred to Phase 2. Recommended: a "Report" action on messages and stories that files a report to staff moderation, which staff review in Admin Web. It needs an API endpoint, a migration slot, and app and Admin Web UI.
- **O-2 Card payments (S-10).** Option (a): keep "Pay by card" and argue 3.1.3(d) in the review notes. This holds only if every paid service is live one-to-one. Option (b), recommended because it is the safest: hide the card checkout link in the store builds and show only the amounts due, with "pay through the academy". Check Google Play's payments policy for the same flow.
- **O-3 Teacher deletion (S-01).** Recommended: turn the block into "deletion requested", which the academy completes within a stated time. Do not send the teacher to contact the academy.
- **Review access.** Demo parent and teacher accounts with realistic data, and their passwords in the App Review and Play notes. Sign-up needs a WhatsApp code that a reviewer cannot receive.
- **Store forms:**
  - App Privacy and Data safety must match the manifest: crash data, and the device time zone (declared as coarse location).
  - Turn on Sentry's "don't store IP addresses".
  - Target audience: adults (parents and teachers). Do not choose the Kids category.
  - The age rating must reflect unrestricted messaging between users.
  - Remove China mainland from App Store availability: CallKit apps are not allowed there.
- **Protected-test sign-off (JC-011).** The push reconciliation adds one key, `recipient` (an opaque 128-bit hash), to the push-data allowlist in `rt037-media-revocation.spec.ts` D, and tightens the assertions on it. It needs the owner's approval before it is committed.
- **Play Console: the full-screen-intent declaration.** #408 declares `USE_FULL_SCREEN_INTENT` for the call ring. Calling is a core feature, so declare it. Without it, Android 14+ shows a heads-up notification instead.
- **Credentials:** the production backend (S-08), the APNs key, Firebase (S-05), the iOS distribution certificate, the Android upload keystore, and the app's Sentry DSN.

The device test plan for these builds is `docs/qa/submission-device-test-plan.md`.

## 2b. Open defects from final acceptance (P1/P2), 2026-11-02

**P1: none open.** The three that were found:
- TEACHER-011 (#356) was retested PASS.
- PARENT-015 (#360) was retested PASS.
- PR358-R1 (a card refund could reach Stripe twice) was fixed inside #358 before merge, by commit "a card refund reaches Stripe once per refundId" and its concurrency test. There is no separate UI retest, because the system-test stack has no live Stripe.

**P2s with a fix on main and a retest pending:**

| Defect | Fix |
|---|---|
| ADMIN-012 | #386 |
| CHATSCHED-010 | #373 |
| CHATSCHED-013 | #367 |
| CHATSCHED-001, CHATSCHED-002, CHATSCHED-004 | #390, PD-46 PR-1. It covers what is announced; the retest decides whether all three close. |
| ADMIN-006 and TEACHER-API-001 | #375, #395 |
| TEACHER-007 | #399 |
| TEACHER-023 | #370 (API retest PASS; the app half is pending) |

**P2s with an open PR:** TEACHER-005 (#398) and TEACHER-008 (#396).

**P2s with no fix on main:**

| Defect | What it is |
|---|---|
| CHATSCHED-003 | the `schedule_change` push rule (owner question) |
| CHATSCHED-012 | an old teacher's records after a transfer |
| TEACHER-026 | transfer and back re-creates lessons |
| TEACHER-013 | lateness ranks by `occurredAt` |
| TEACHER-002 | double-click Add teacher |
| TEACHER-API-002 | booking on a leave day or in the past |
| PARENT-003 | no message length limit |
| RQA-F1 | the teacher record has no lesson reports |
| PARENT-005 | its P-182 remainder |

PARENT-022 was closed as an environment issue, not a product defect: VM contention on the local stack, now mitigated.
The full list, with owners, is `~/jawwid-acceptance/final/defect-log.md`.

## 2. P0 — hard blockers

| # | Gate | Status |
|---|---|---|
| **G-01** | **BR-1 (PD-7, 2026-10-14): NO Teacher↔Parent 1:1 conversation or call, whatever the relationship.** Enforced server-side AND independently in the database, verified with client-side policy disabled. | **PASS — re-assessed 2026-11-02 under PD-7.** Unit: `test/unit/authorization/br1-conformance.spec.ts` "PD-7 — no direct teacher/parent channel, whatever the relationship" (BR1-01..06, 04b/04c), and `test/unit/red-team/authz-attacks.spec.ts`. Integration (CI `migrations` job): `communication-engine.spec.ts` "BR-1 (PD-7) — the database refuses…", `schema-invariants.spec.ts` "BR-1 database backstop (PD-7)", `pd7-side-channels.spec.ts`. SQL, run in CI: `db/tests/br1_invariants.sql` (re-versioned for PD-7) and `relationship_predicate.sql` H1. |

**The G-01 proof table below is the PD-6 version, kept as history.** Row 1
("authorized … allowed") is the PD-6 positive half, and PD-7 forbids it: under
PD-7 *no* relationship opens a 1:1 channel. Rows 2–5 still describe the
denial side and its database backstop, now proven by the PD-7 suites above.

| # | Must prove | Proven by |
|---|---|---|
| 1 | ~~Authorized Parent ↔ Teacher direct communication is **allowed**~~ (PD-6; superseded by PD-7) | `relationship-predicate.spec.ts` §"authorization switch" 1, 2, 3, 3b · `br1_invariants.sql` A2, D5 · `schema-invariants.spec.ts` "PERMITS…" |
| 2 | Unauthorized Parent ↔ Teacher direct communication is **denied** | `br1-conformance.spec.ts` BR1-01/02/03/04 · `relationship-predicate.spec.ts` 1b · `communication-engine.spec.ts` "refuses…" · `br1_invariants.sql` A1, A3, A4, D1, D7 |
| 3 | **Application** authorization enforces the relationship | `br1-conformance.spec.ts` (the policy, in isolation) + the end-to-end block driving `ConversationService`, `MessageService` and `CallService`, which proves each call site actually resolves and passes the fact |
| 4 | **Database** backstop enforces the relationship | `br1_invariants.sql` A1–A4, D1, D5–D7 · `relationship_predicate.sql` H1, H2 · `communication-engine.spec.ts` and `schema-invariants.spec.ts`, both of which write through raw SQL with the API bypassed |
| 5 | Client-side policy **cannot** bypass server or database | Every assertion under 2–4 is server-side or SQL-side. Specifically: `authz-attacks.spec.ts` "a client cannot widen its own authority" (no request field reaches the resolved fact), `relationship-predicate.spec.ts` "client-supplied ids are never evidence" and "anti-bypass", and the raw-SQL inserts in 4, which have no client at all |

The remaining P0 gates:

| # | Gate | Status |
|---|---|---|
| **G-02** | Student Groups implemented, BR-1 enforced at creation **and** every membership mutation. *Re-worded 2026-11-02:* the old text said "membership derived from Jawwid Core", but PD-9/16/17 moved learners and families into Chat. | **PASS — 2026-11-02.** `student-group-provisioning.spec.ts`; `groups-approval-calls.spec.ts` "student groups" (a teacher change re-syncs members; teacher and parent cannot mutate); `membership-authorization.spec.ts`; `student-group-first-message.spec.ts`. BR-1 on mutation: `schema-invariants.spec.ts` "RT-025: the same group WITHOUT an admin is rejected" and "JC-008/RT-024". JC-001 closed in `defects.md` (G-39). |
| **G-03** | Teacher is a first-class authenticated actor with Teacher↔Admin and group access | **PASS — 2026-11-02.** `authentication.spec.ts` "resolves a TEACHER from chat.teacher…" and "an offboarded teacher loses a live session at once"; `def001-teacher-admin-reply.spec.ts` (the Teacher↔Admin channel); `realtime-authentication.spec.ts` test 2 (teacher socket). JC-003 closed in `defects.md` (G-39). |
| G-04 | One centralized authorization policy governs messaging **and** calling; no second matrix; **no client-supplied field widens authority** | **PASS — carried over, re-checked 2026-11-02.** `br1-conformance.spec.ts` "calling is never more permissive than messaging"; `authz-attacks.spec.ts`; `call-media-token.spec.ts` K and L. The 2026-09-24 analysis still holds: one `AuthorizationService`, one `canCall`. |
| G-05 | ~~Approvals: approve / reject / mandatory reason; pending never delivered…~~ | **RETIRED by PD-14 (2026-10-20): no message is held for approval, for any role.** New behaviour proven by `groups-approval-calls.spec.ts` "PD-14: nothing is held…" and `student-group-first-message.spec.ts`. The pre-PD-14 backlog still passes its old checks: `groups-approval-calls.spec.ts` "message approval (pre-PD-14 backlog)" and `approval-decision-integrity.spec.ts` (a race resolves to one state). **Replaced by G-05b.** |
| G-05b | *(new)* Post-send moderation keeps every revision; edits and deletes are audited | **PASS.** `message-edit-favorites.spec.ts` "…revisions are immutable"; `communication-engine.spec.ts` "PD-14: the admin of a parent's 1:1 deletes…". |
| G-06 | Voice calling authorized through the same policy; tokens server-generated, short-lived, room-scoped; unauthorized room join denied | **PARTIAL — unchanged since 2026-09-24.** Conditions 1–4 are proven (`call-media-token.spec.ts` A–R, `call-accept-decline.spec.ts`). `rt037-media-revocation.spec.ts` §C adds ejecting a participant who joins after deactivation, via the LiveKit webhook. Condition 5, *LiveKit refuses a wrong-room join*, is still unproven: `rt037-media-revocation.spec.ts` §G is skipped unless `LIVEKIT_REAL_URL` is set, CI never sets it, and `docs/qa/RT-037-STAGING-REAL-MEDIA-TEST.md` says "NOT RUN — BLOCKED". Calls do work end to end on the system-test stack (the QA call rows), so this is the media plane's refusal, not whether calls connect. It closes when production LiveKit exists: run §G there. |
| G-07 | **No phone number** in any API response, realtime event, push payload, call setup/metadata/history, search result, log, cache or export. *Needs re-versioning:* PD-10 (Teacher File), the trial journey, PD-17 (`chat.parent_file.phone`) and PD-25 (a WhatsApp code to that phone) **deliberately** store phone numbers in admin-only tables. The boundary doc calls these G-07 exceptions. The gate should read "phone numbers confined to admin-only tables and never in a parent/teacher/realtime/push surface". | **PARTIAL.** Structural: `test/unit/privacy/no-contact-channel-columns.spec.ts` "phone privacy is enforced structurally (G-07 / PP-13)" with an ALLOWED list; confinement suites `parent-file-confinement.spec.ts`, `teacher-file-confinement.spec.ts`, `new-students-confinement.spec.ts`. Runtime: only `call-notifications.spec.ts` Q (the push payload). Still unverified at runtime: API responses to non-admins, realtime events, logs, exports, search. |
| G-08 | Internal notes unreachable by any parent or teacher through any surface | **PARTIAL, close to PASS.** Covered: `communication-engine.spec.ts` "internal notes" (invisible to contacts, no receipts); `parent-contract-gaps.spec.ts` (preview); `message-star-pin.spec.ts` and `message-forward.spec.ts` "never to a family"; `message-search-export.spec.ts`; `conversation-seat-pd035.spec.ts` P2-2/3; unit `matrix-and-handling.spec.ts`. Missing: an explicit assertion that no realtime event or push ever carries an internal note to a parent or teacher. |
| G-09 | No cross-family or cross-group access; IDOR sweep clean across every entity id | **PARTIAL.** Conversation-centric sweep: `org-scope-pd8.spec.ts` "negative security — ids manipulated over the real routes" (detail, messages, send, members, upload, call history, attachment, realtime) and "visibility" (every actor × every conversation). Also `malformed-ids.spec.ts`, `admin-002-family-access.spec.ts`, `actor-scoped-database.spec.ts`; `tenant_isolation.sql` runs only in the G-41 drill. The QA matrices add cross-family isolation rows (PASS). Missing: one sweep over every other entity id (lessons, tasks, payments, profiles, whiteboards, certificates); today those have only per-feature tests. |
| G-10 | Realtime delivers only in-scope events; re-authorized on reconnect and on permission change | **PASS — 2026-11-02.** `realtime-revocation.spec.ts` (an open socket stops receiving at once on removal; "a reconnect with the same token cannot restore access"; the subscribe/remove race); `realtime-authentication.spec.ts` RT-001; `realtime-handshake-race.spec.ts`; `pd037-realtime-audience.spec.ts`; `org-scope-pd8.spec.ts`. |
| G-11 | Manager-only actions unreachable by admin, coverage, teacher, parent or internal staff | **PARTIAL.** `staff-privilege-escalation.spec.ts` (an ordinary admin cannot promote themself); `ownership-functions-authorization.spec.ts`; `supervisor-transfer-pd024.spec.ts` §1; `pd040-access-roles.spec.ts`; unit `pd040-route-permissions.spec.ts` "every route declares…". QA: TEACHER-011 (P1) and ADMIN-002/006 were found and fixed here. Missing: one action × role matrix. PD-40 (still IN PROGRESS) is turning "manager-only" into permission keys, and its enforce step (PR-6) is not built. |
| G-44 | ~~`on_duty()` is the sole authority for acting on a family~~ | **RETIRED — PD-3 and PD-8.** PD-3 superseded `on_duty()` as the assignment function, and PD-8 retired it for scope (`staff-scope-revocation.spec.ts` "family ownership, on_duty() and a live sticky window grant nothing"). JC-007 is moot. **The surviving half passes.** Assist and escalation are gated server-side by `steppingIn` (`apps/api/src/platform/authorization.service.ts`), proven by unit `staff-scope.spec.ts` "…step in as ASSIST, or ESCALATION…" and "a supervisor may not record their own reply as an assist or an escalation (JC-005)", and by `jc005-jc006-regression.spec.ts`. |
| G-12 | Exactly one Primary Owner per family; ownership changes only via the transfer function, with audit in the same transaction | **PARTIAL.** `chat.family.owner_id` is `not null` with a foreign key. `ownership-functions-authorization.spec.ts` "an active manager completes the transfer, and the trail names that manager"; `supervisor-transfer-pd024.spec.ts`. Missing: a test that a failed audit write rolls the transfer back. Under PD-8 the owner is a workload field only, not an access grant. |
| G-13 | Coverage, handoff and workload never change Primary Ownership | **UNVERIFIED — re-scope.** The coverage engine is frozen for removal (PD-3). Cover is now PD-33 link activation (`supervisor-cover-pd033.spec.ts`), but no test asserts that `owner_id` stays the same through a cover. |
| G-14 | ~~Exactly one current handler at all times~~ | **RETIRED — PD-8** retired the sticky handler. No invariant remains to test. |
| G-15 | No message duplication under retry, reconnect or double-submit; idempotency enforced | **PASS — 2026-11-02.** `communication-engine.spec.ts` "idempotent send" ("the same client_message_id never creates two messages", "survives concurrent duplicate submissions"); `student-group-first-message.spec.ts` "a retry is the same message"; `call-events.spec.ts` §18; `call-push-delivery.spec.ts` 8 ("a replayed outbox row delivers once"); `outbox-claim-precision.spec.ts`. QA also found three double-click duplicates *outside* messaging: ADMIN-001 (fixed #358), TEACHER-007 (fixed #399) and TEACHER-002 (open). |
| G-16 | No message loss across restart, reconnect, worker crash or client crash | **PARTIAL.** `realtime-delivery.spec.ts` "D-2 · a failed publish returns the event to the outbox"; `admin-011-center-entry-now.spec.ts`; unit `outbox-pacer.spec.ts`. PARENT-015 (realtime lost after an API restart) was fixed (#360) and retested PASS. Missing: an automated worker-crash, API-restart or client-crash recovery test. |
| G-17 | `message` / `event_log` / `audit_log` immutable or append-only; audit manager-read-only. *Re-version for PD-14:* a message body is now editable, with immutable revisions. | **PARTIAL.** `schema-invariants.spec.ts` "append-only and immutability guarantees" (event_log update and delete, audit_log update); `staff-profiles.spec.ts` "audit rows… are append-only"; `schema_acceptance.sql` checks both append-only triggers; `message-edit-favorites.spec.ts` (revisions immutable). Missing: proof that the audit log is readable by managers only. |
| G-18 | No secrets in source or git history | **PASS** — CI `guards`: `guards.sh g18` and `scan-secrets.sh --history`, green on `0d1a1f50`. |
| G-19 | Migrations apply cleanly forward; rollback defined and tested | **PARTIAL.** Forward apply and idempotent re-apply are gated by CI (`migrations`, green on `0d1a1f50`), and the system-test stack re-applies 0 after every deploy. **Rollback is now defined:** `production-runbook.md` §3 is forward-only by design (roll back the application; for data, restore the pre-deploy encrypted backup), plus `docs/db/rollback-20261014.md` and 23 `db/rollback/*.down.sql` scripts for 159 migrations. The restore half is tested (G-41). Missing: no CI step runs any `.down.sql`; they were only exercised by hand on disposable databases. |
| G-20 | No real employee or customer data in seed data, fixtures or tests | **PASS for names; UNVERIFIED for customer data.** CI `guards.sh g20` (byte-exact name list) and `g20-meta`. No guard looks for real customer e-mails or phone numbers in fixtures. |
| G-21 | Chat owns its own database; Core integration via the approved boundary; single migration authority | **PARTIAL.** JC-009's cited facts are fixed: no migration reads `public.profiles`, Core arrives only as signed webhooks (`apps/api/src/core-boundary`), and CI builds the database from empty. Missing: Prisma is still a possible second authority (`apps/api/package.json` has `prisma:push`), and `schema.prisma`'s "`npm run db:drift` proves the two agree" names a script that does not exist. CI runs no drift check. |
| G-45 | Branch reconciliation complete; one migration lineage; no silently-divergent schema objects | **PARTIAL.** One lineage (unique timestamps, `pd-registry` guard; G-19 re-apply). JC-010 is contained, not removed: `20260905093200_chat_shared_logs.sql` still has a `create table if not exists chat.event_log` no-op of a different shape. `schema-invariants.spec.ts` "JC-010 — duplicate event_log definitions" (protected) now fails the build if the wrong shape ever wins. |

> **G-01 — superseded pass condition (in force 2026-09-05 → 2026-09-23).**
> Preserved so the gate's history is auditable, per PD-6.
>
> > **BR-1: no Teacher↔Parent 1:1 messaging or calling exists, enforced
> > server-side, verified with client-side policy disabled (BR1-19)** —
> > *FAIL — JC-008. Materially improved: BR-1 is now a DB constraint trigger and
> > blocks the member path (verified). It does not guard `conversation.type`, so
> > a group converts to a forbidden 1:1 by `UPDATE` (reproduced).*
>
> The JC-008 finding was closed by the RT-024 type-immutability triggers. PD-7
> has since restored the v0.1 end state (no 1:1 in any case).

## 3. P1 — major workflow gates

| # | Gate | Status |
|---|---|---|
| G-22 | ~~Attention~~ and workload computed server-side; never client-set. *The attention half was retired 2026-11-02 (AMB-2/AMB-7): no attention engine exists.* | **PASS for workload.** Workload is derived server-side from authoritative rows only (`staff-profile/staff-workload.service.ts`); nothing client-set feeds it. PD-44 replaced the old dashboard. |
| G-23 | No queue, round-robin, or automatic distribution anywhere | **PASS by inspection.** Nothing in `apps/api/src` matches round-robin, auto-assign or least-loaded. PD-47 tasks are "not CRM routing". The automated `gate_g31` keyword scan does not look for queues. |
| G-24 | Notifications and reminders: dedupe, status lifecycle, quiet hours, retry, no storms | **PASS.** `pd034-notification-center.spec.ts`: dedupe keys, coalescing (5 → 1 push), quiet hours 22:00–08:00 (including a DST night), a cap of 6 an hour with a held summary, read and mute withdraw a waiting push. Push itself is not delivered on the system-test stack (no APNs key): S-05/S-06 and the device plan. |
| G-25 | Push deep links re-authorized server-side on open | **PARTIAL.** `chat_screen_route.dart` resolves the conversation on the server, never from cache. `test/app/notification_deep_links_test.dart` tests routing only (PARENT-021, fixed #368). Missing: a test that opens an unauthorized id and is refused. |
| G-26 | Tasks and follow-ups; internal staff see only their own tasks and never message families | **PARTIAL — superseded in part by PD-47** (one Tasks page; managers see Team, the super admin sees All). `tasks-pd047.spec.ts` and the `tasks-*-pd047` suites. Missing: a "never message families" assertion. |
| G-27 | Manager Dashboard figures reconcile with backend engines | **PASS.** `dashboard-pd044.spec.ts` asserts that it "equals the Chat list's waiting rows for every persona" and "equals the Cases page's tabs", plus the billing, lessons, teachers, enrolment and structure dashboard suites. |
| G-28 | Offline queue, reconnect and multi-device convergence | **PARTIAL.** The client outbox (`lib/features/messages/domain/outbox.dart`) sends `clientMessageId` with an idempotency header, and the server honours it (G-15). PD-34 pushes a read to the reader's other devices. Missing: end-to-end offline-send and multi-device tests (E2E-013/014 do not exist); covered manually by the device plan. |
| G-29 | Contact capability flags enforced server-side for every self-service action. *Re-scoped 2026-11-02 (AMB-10):* in Phase 1 only `canMessage` is a live flag; the other five are reserved, not enforced, and every contact is created as `primary_guardian` with all six true. | **PASS as re-scoped.** `canMessage` is enforced across messaging (14 source files, 22 test files). The reserved flags must be enforced, or removed, before a second-guardian or payer role ships. |
| G-30 | Core integration failure degrades safely; no fabricated Core data | **PARTIAL.** The only Core link is signed webhook ingest; `test/unit/core/core-webhook-auth.spec.ts` refuses bad signatures, stale deliveries and unknown keys. Missing: a Core-unavailable test. Phase 1 can ship without Core feeding Chat. |

## 4. Scope-boundary gates (fail if present in MVP)

| # | Gate | Status |
|---|---|---|
| G-31 | **No** AI attention scoring, drafting, summarization or classification | **PASS** — no AI SDK in the API, Admin Web, lessons or Flutter `lib`; CI `gate_g31`. |
| G-32 | **No** video calling | **PASS — re-checked 2026-11-02.** The 2026-09-25 evidence holds: `media-token.ts` grants `canPublishSources: ['microphone']`, asserted exhaustively by `call-media-token.spec.ts` (protected). No PD adds video (PD-19 and PD-53 are voice). |
| G-33 | **No** labels, **no** broadcast | **Labels: RETIRED by PR #67 + PD-32** (staff labels, favorites, Starred in Chats, the Trial label). This needs the owner's confirmation, because the boundary's §5 still lists labels for Phase 3. **Broadcast: PASS.** No bulk-send exists. |
| G-34 | **No** approval escalation, expiry or coverage-aware approval | **RETIRED by PD-14** (nothing is held). The dormant `MessageApproval` model could be dropped later. |
| G-35 | **No** shared queue or automatic routing | **PARTIAL.** No routing code exists. PD-33's automatic *return* of a cover is scheduled, not routing. Open question: PD-47's "Needs action (Teachers)" is described as "the department's queue" (`pd047-tasks-plan.md`). It is a shared view, not routing, but the owner should confirm it doesn't break this gate. |

> **G-32 — superseded status (in force 2026-09-24 → 2026-09-25).**
> *PARTIAL:* the media grant did not restrict sources. Closed by M4 W1 (`7e94d58`),
> which restricted the grant to the microphone before any LiveKit client existed.

## 5. Process gates

| # | Gate | Status |
|---|---|---|
| G-36 | CI runs typecheck, unit, security and migration validation on every push | **PASS.** `.github/workflows/ci.yml`, on push, PR and dispatch, has 8 jobs: `guards`, `api` (typecheck + unit), `admin-web`, `lessons`, `migrations` (apply, re-apply, SQL suites, integration suite, backup drill, G-41), `images`, `dependencies` (advisory), `mobile`. Caveats: the dependency audit is advisory only, and there is no ESLint in the TypeScript packages. |
| G-37 | Every component's toolchain installed and its tests executable in CI | **PASS for the job; required-check status UNVERIFIED.** `Mobile · Flutter analyze + tests` (CI-001, `c4fbaf23`) passed on `0d1a1f50`. Whether it is a *required* check on `main` must be read in branch protection by someone with admin rights. |
| G-38 | Full E2E suite green (`test-plan.md` §20) | **PASS for the Phase 1 smoke scope — 2026-11-02** (it was FAIL), with the minimal scope the department head set. CI job `e2e`, "G-38 · end-to-end smoke", runs `scripts/qa/e2e-smoke.sh` on fresh postgres:17 and redis:7 services. The built API and the outbox worker run as real processes, people come from the real seed CLI, and `apps/api/test/e2e/smoke.e2e.ts` drives them over HTTP and a real socket.io client. It covers: sign-in (a wrong password refused); the parent's message reaching the teacher **live** through the worker → Redis → API relay; read-back; idempotent retry; the reply reaching the parent live; another family's group refused for list, read and subscribe; a lesson scheduled and seen by parent, teacher and the teacher's calendar; the parent's billing view. 9/9 locally. Not covered: calls (LiveKit media), uploads, push, the Flutter UI itself; those stay with the device plans and the manual acceptance run. The rest of §20's list is not automated. |
| G-39 | Zero open P0; zero open critical P1 | **PASS — 2026-11-02.** `docs/qa/defects.md` now has a closure record that cites each JC's fixing commit or PR and its CI test. **JC-001, JC-002, JC-003 and JC-008: FIXED. JC-009: FIXED for its cited facts** (the Prisma residual stays in G-21). **JC-007: closed by design** (PD-3/PD-8; the `steppingIn` predicate is built). Still OPEN, both P3 with no runtime impact: JC-004 (JSON-null config value) and JC-010 (dead duplicate `event_log` DDL). Final acceptance: 0 open P1 (§2b). The open P2s are listed in §2b. They are not counted by this gate, but they belong in the launch decision. |
| G-40 | Observability: structured logs, health/readiness, error monitoring with token/PII redaction | **PARTIAL.** Code: `health.controller.ts` (live, ready), `infra/observability/` (JSON logger, request log, redaction, Sentry behind an allowlist), with unit tests for each. Missing: nothing is provisioned (no Sentry project, metrics, alerts or uptime check); no Flutter crash reporting (S-07); no test that targets `/health/ready` directly. |
| G-41 | Backup and restore documented **and rehearsed**; RPO/RTO stated | **PARTIAL, close to PASS** (was FAIL). CI step "G-41 · encrypted backup, refused tampering, restore and verify" in the `migrations` job, green on `0d1a1f50`; a manual drill passed on 2026-10-21 (`backup-recovery.md` §5). RPO ≤ 5 min and RTO ≤ 2 h are stated, but as proposals until a provider exists. Missing: no managed database, provider backups or PITR exist yet; no restore into a running app; restore time never measured. The production checklist closes these. |
| G-42 | Environments separated; no production credentials or debug mode outside production | **PARTIAL.** `scripts/infra/check-env.sh` (production) refuses `APNS_PRODUCTION≠true`, `NODE_ENV≠production`, wildcard CORS and `sslmode=disable`. `manifest.tsv` forbids `DEBUG`, `PRISMA_STUDIO`, `USE_MOCK_*` and `ALLOW_INSECURE_TLS` in staging and production. The check runs in both deploy workflows. Missing: no staging or production environment exists, and no test proves the production rules reject anything. |
| G-43 | Open specification ambiguities resolved (`test-plan.md` §21) | **PASS — 2026-11-02.** All nine were decided by the department head under the owner's Phase 1 delegation, and each is recorded in `test-plan.md` §21 with its proof. AMB-9: C-4 as built. AMB-10: one preset; five flags reserved, not enforced. AMB-3/4/5: moot (PD-3/PD-8); PD-33 cover windows are half-open in absolute time, with a new boundary test in `supervisor-cover-pd033.spec.ts`. AMB-11: moot (PD-14). AMB-12: archived is read-only. AMB-2/7: moot (no attention engine). |

---

## 6. Release will FAIL if any of these is true

- Teacher↔Parent direct 1:1 communication or calling is possible by any route
- A phone number is reachable by a parent or teacher, or through any non-admin surface (G-07 as re-versioned)
- Unauthorized family, group or conversation access is possible
- Manager permissions are bypassable
- ~~A pending message reaches anyone before approval~~ / ~~Approval can be bypassed~~ (retired by PD-14; a message's revisions must still be kept)
- Messages duplicate or are lost
- Coverage, handoff or workload changes Primary Ownership
- Production secrets are committed
- Migrations fail, or core E2E flows fail
- Out-of-scope functionality ships: AI scoring, video, broadcast (labels and favorites were approved by PR #67 / PD-32; approval escalation was retired by PD-14)
- **Phase 1:** a user cannot delete their own account in the app, the iOS privacy manifest is missing, or a store build points at anything but the production API
- **Phase 1:** a store build ships with the development push entitlement or a debug signing key

## 7. Severity policy

**P0** security breach · unauthorized data access · Teacher↔Parent direct
communication · phone leakage · data corruption or loss · broken authentication.
**P1** major workflow broken: approvals, coverage, calling, notifications, Core
integration. **P2** important functional/UX. **P3** minor/cosmetic.

**READY is never declared while any P0 or critical P1 is open.**

## 8. Running the fast gates before you push

```
bash scripts/qa/guards.sh            # every fast gate, then a PASS/FAIL summary
bash scripts/qa/guards.sh g20        # one gate (ids: --list)
```

`scripts/qa/guards.sh` is the single definition of CI's **Release-gate guards
(fast)** job: each step of that job in `.github/workflows/ci.yml` is one call
into it, and its `ci-wiring` gate fails if a gate it defines is not called from
CI. It covers G-18, G-20, the G-20 meta-guard, JC-011, G-31..G-35, the secret
scan, the client-bundle and environment checks, the env-template/manifest diff
and the backup-client check. It runs every gate even after one fails and exits
non-zero if any did. Slow suites (jest, flutter test, the migration gate) are
not in it.

It works the same on macOS (bash 3.2, BSD userland) and Ubuntu. The pattern
gates scan with a byte-exact python3 matcher, not grep: the old G-20 one-liner
silently passed on a Mac, because zsh rewrites `\|` inside `$'...'`, and on
2026-10-20 only CI caught a protected name in a fixture. Files scanned are the
tracked ones plus untracked, not-ignored ones (`git ls-files -co
--exclude-standard`) -- the same set as CI's fresh checkout, plus the file you
have not added yet. `scripts/qa/check-employee-name-guard.sh` is the meta-guard:
it proves G-20 detects every name on its list and still passes a clean tree; it
does not scan this repository.
