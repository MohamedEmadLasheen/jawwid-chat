# Jawwid Chat launch tracker: App Store and Google Play

**The one canonical launch tracker.** It replaces every earlier readiness verdict (`store-readiness-2026-11-03.md`,
`google-play-readiness-2026-11-03.md`, `release-scorecard.md`), which are now history. Owner: the engineering lead
(CEO session). It is updated after every task, merge or owner answer. Each change cites its evidence.

- **Last updated:** 2026-11-08 15:55 Cairo (13:55 UTC).
- **State of `main`:** `14860ad3`, which contains #500, #504 and #502. Its CI run 42481004529 is in progress.
- **Sources:**
  - the eight read-only audits of 2026-11-08 (PR #501, independently reviewed);
  - two policy re-checks on Apple's and Google's official pages, also on 2026-11-08 (§9);
  - the live GitHub state.

## 1. Executive dashboard

### Verdict

| Store | Verdict | Earliest defensible "ready to submit" |
|---|---|---|
| **Apple App Store** | **NOT READY** | **Fri 13 Nov 2026**, only if the owner inputs due Mon 9 Nov (§7) arrive on time |
| **Google Play** | **NOT READY** | **Fri 13 Nov 2026** only if the Play Organization account is **already verified**; otherwise set by Google's D-U-N-S and identity verification (up to ~30 days) |

**The 48-hour target (Tue 10 Nov, 15:00 Cairo) is not realistic.** Engineering alone cannot close the gap, for five reasons:
1. **The production backend has never been deployed** (no run of "Deploy production" ever). Reviewers need a live server (Apple 2.1(a)).
2. **Signing and store accounts do not exist yet:**
   - Apple: no Distribution certificate, no App Store profile, no App Store Connect record.
   - Google: no Organization account, no upload key, the package name is not final.
   - Firebase project and Sentry DSN for builds.

   Only the owner can create these.
3. **No legal page is hosted.** The drafts still contain `{{ENTITY_NAME}}`, and the store build script refuses to build without the four URLs.
4. **Nothing has run on a real phone** against a real server: push, calls, deletion and the terms gate (22 of 24 device rows untested).
5. **Four High-risk changes need the owner's approval:** #497, #498, #449 and the push port.

From the moment the owner inputs arrive, the critical path is about 4 days:
- day 1: deploy staging and production, and host the legal pages;
- day 2: review accounts, store builds and the console forms;
- day 3: device test plan on two phones;
- day 4: fixes from device testing, final compliance and security audit, then the owner's go.

### Counts (all requirements in §3–§6)

| Total | Completed and verified | Ready for verification | In progress | Blocked: owner | Blocked: technical | Not started | Not applicable |
|---|---|---|---|---|---|---|---|
| 88 | 14 | 8 | 19 | 24 | 16 | 4 | 3 |

| Still open | Count | IDs |
|---|---|---|
| **Critical** | 30 | LR-01, 02a, 02b, 02d, 03, 04, 05, 06, 07a, 07b, 07c, 08, 09a–09k (11 console items), 10, 43, 45, 47, 48, 49, 72 |
| **High** | 19 | LR-11a, 11b, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 46, 50, 51, 52, 65, 71 |
| **Owner actions open** | 21 | OA-01 to OA-21 and OA-23 (§7); 13 of the 30 Critical items wait on the owner |

The counts are recomputed from the tables in §3–§6 after every update.

### Completion by area

Each percentage is completed-and-verified ÷ applicable items in that slice. N/A items are excluded, and an item counts in every slice it belongs to.

| Slice | Applicable | Completed and verified | % | What dominates the gap |
|---|---|---|---|---|
| **iOS** (store = iOS or Both) | 65 | 10 | **15 %** | Signing and the app record (owner), the production backend, device tests, console forms |
| **Android** (store = AND or Both) | 68 | 11 | **16 %** | The Organization account, package name and upload key (owner), the production backend, device tests, console forms |
| **Shared backend and infrastructure** (area BE) | 17 | 1 | **6 %** | Never deployed; backups failing; no Sentry or Firebase project |
| **Legal and compliance** (area LEGAL) | 25 | 2 | **8 %** | Entity facts, hosting, counsel, the audience and storefront decisions, console forms |
| **Security and QA** (area SQA) | 16 | 7 | **44 %** | The real-deployment media test, the device plan, the final security sign-off |

A percentage measures tracked work, not approval. Apple and Google decide.

### Who is working now

| Agent (role) | Task | Worktree / branch | Started (Cairo) | State |
|---|---|---|---|---|
| Lead (this session) | This tracker; reconciling GitHub; merges under the merge conditions | `~/dev/jawwid-launch-tracker` → pushed to `claude/launch-readiness-org` (#501) | 14:30 | Running |
| Builder A (Mobile engineer, Opus) | LR-14 foreground-service type, LR-42 log redaction | `~/dev/jawwid-lr14-android` → **#505** | 14:55 | Done; under independent review and CI |
| Builder B (Backend engineer, Opus) | LR-32 `wss://` in production, LR-38 message paging validation | `~/dev/jawwid-lr32-api` → **#506** | 14:55 | Done; under independent review and CI |
| Drafter C (Store compliance, Opus) | LR-09a–k, LR-23 console answers and listing copy | `~/dev/jawwid-store-console`, `claude/lr09-store-console-drafts` | 14:55 | Running |
| Independent reviewers (3 fresh Opus sessions, read-only) | Review #505, #506 and this tracker (#501) | none (read-only) | 15:40 | Running |
| Another session (not this one) | CI re-runs on #498 and #503 (Gradle outage); both are now 30/30 green | its own | before 14:30 | Not touched by the lead |

### Next tasks, in order
1. Review and merge Builders A and B (Medium risk) and Drafter C (Low) as their PRs turn green.
2. After #503's re-run is green, merge it (lead ACCEPT @ `e83a6c05` already recorded).
3. #497: the P2 fix is pushed (`9bc9416e`). Re-review it once CI is green, then wait for the owner's merge approval.
4. #498: another session is active on it, so the lead does not edit it. Still open: the P2-1 fix (uncommitted in `~/dev/jawwid-teacher-deletion`, preserved), P2-2, the review cohort and `review-accounts.md`.
5. When #449 merges: LR-13 (iOS VoIP registry at launch) and LR-27 (full-screen intent check). Both are blocked only because #449 owns those files.
6. LR-26 (microphone "Open settings") once the l10n files are free (#449, #498 and #503 all edit them).

## 2. How this tracker works

**Statuses (exactly one per row):**
- NOT STARTED;
- IN PROGRESS;
- BLOCKED — OWNER ACTION REQUIRED;
- BLOCKED — TECHNICAL DEPENDENCY;
- READY FOR VERIFICATION, meaning it is built, but the evidence a store needs (a release artifact, a device or the real deployment) is still missing;
- COMPLETED AND VERIFIED;
- NOT APPLICABLE — WITH DOCUMENTED REASON.

**Checkboxes.** `[x]` only for COMPLETED AND VERIFIED, with an evidence-log entry in §8. A build, a passing unit test or an agent's statement is never enough on its own.

**Columns:**
- **Area:** iOS, AND (Android), BE (shared backend and infrastructure), LEGAL (legal and compliance), SQA (security and QA).
- **Store:** iOS, AND, Both, or — (not a store item).
- **Pri:** C (Critical), H (High), M (Medium), L (Low).

**The loop after each task:**
1. Update the row and attach the evidence.
2. Check the acceptance criteria.
3. Recount the dashboard.
4. Unblock dependants.
5. Start the next task in §1 without waiting to be asked.

Owner approvals are never bypassed (`docs/engineering/ai-delegation.md` §3). High risk means:
- authentication;
- deletion;
- migrations;
- children's data;
- payments;
- CI and protections;
- production.

## 3. Phase 1: Critical blockers

| ✓ | ID | Requirement (policy) | Area | Store | Pri | Status | Who | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-01 | A live production backend for store builds and reviewers (Apple 2.1(a)) | BE | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner; Release manager | "Deploy production" has never run, and "Deploy staging" has never succeeded (failed 2026-10-06, cancelled 2026-11-05); `DIGITALOCEAN_APP_ID` is unset; DNS is unconfirmed. Next: the owner supplies the app id and DNS (OA-06) and approves the first staging deploy, then production (OA-21). **Done when:** `/health/ready` returns 200 on the production host and a store build signs in. |
| [ ] | LR-43 | Registration and sign-in work on production: e-mail and password, WhatsApp codes, parent sign-up with terms acceptance | BE | Both | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer | Needs LR-01. G-38 end-to-end smoke passes in CI (main run on `496560a3`), but CI is not production. Done when the device plan rows for sign-up and sign-in pass on production. |
| [ ] | LR-02a | Terms gate on the API: no posting before acceptance (Apple 1.2; Play UGC "accept terms before posting") | BE | Both | C | IN PROGRESS | Backend engineer; owner (merge) | #497: independent review ACCEPT @ `9536446d` with one P2 (`auth.controller.ts:116-117` rotates the refresh token before `legal.dtoFor()`, so a database error lost the new tokens and the retry signed the user out everywhere). The lead fixed it in `9bc9416e` (dtoFor answers `unavailable` and never throws, with a new unit spec `legal-dto.spec.ts`); CI is running. Next: re-review the fix, then **owner approves the merge (High: auth)**. Release order: app gates (done) → terms rows (LR-02d) → API. |
| [ ] | LR-02b | Terms gate and sign-up acceptance in the iOS and Android app | iOS | Both | C | READY FOR VERIFICATION | Mobile engineer; QA | #504 merged as `cf731af2` on 2026-11-08 12:27 UTC. Independent review: ACCEPT @ `af1a3e1a`. Main CI: run 42480381161 was cancelled by a newer push; run 42481004529 on `14860ad3` contains it and is running. Still needed: a device test against an API with #497. |
| [x] | LR-02c | Terms gate in Admin Web (staff accept before acting) | BE | — | H | COMPLETED AND VERIFIED | Frontend engineer | Evidence log E-01. |
| [ ] | LR-02d | Final Terms of Use and Code of Conduct texts and versions loaded as terms rows (N-3) | LEGAL | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | Without the rows, the gate has nothing to show. Owner action OA-09. |
| [ ] | LR-03 | Account deletion starts in the app for every account that can be created, with no "contact us" (Apple 5.1.1(v); Play account deletion) | BE | Both | C | IN PROGRESS | Backend engineer; owner (merge) | #498 head `b11d2e6d`: 30/30 checks pass after another session's re-run. Review ACCEPT with two P2s:<br>• **P2-1:** a failing reminder could block erasures. The fix is uncommitted in `~/dev/jawwid-teacher-deletion`, one file; it needs a regression test.<br>• **P2-2:** the app copy says "deleted now" for a request.<br>Also in the same branch:<br>• `review-cohort.ts` must survive the review teacher's erasure (re-provisioning refuses with `TEACHER_CHANGED`);<br>• `review-accounts.md` must stop saying "takes effect immediately" for teachers.<br>Apple's account-deletion page allows a delayed deletion only when the user is told how long it takes; confirm the wording in the app. **Owner approves the merge (High: deletion).** |
| [ ] | LR-04 | Public Privacy Policy, Terms, support page and deletion page in Arabic and English, with no placeholders (Apple 5.1.1(i) and the Support URL; Play privacy policy and the deletion web link) | LEGAL | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel; Release manager | `docs/legal/*` drafts still contain `{{ENTITY_NAME}}` and other placeholders. `build-store.sh` refuses to build without the four URLs. Owner action OA-08. |
| [ ] | LR-05 | Demo accounts on the live backend that need no WhatsApp code (Apple 2.1(a); Play App access) | BE | Both | C | BLOCKED — TECHNICAL DEPENDENCY | Owner; Release manager | `cli/review-cohort.ts` was merged in #490. Needs LR-01, then the owner's domain and two passwords (OA-21). Also needed: past lessons and reports in the data, and a third, disposable parent for the deletion test. |
| [ ] | LR-06 | Apple Distribution certificate, App Store profile with Push, App Store Connect record for `com.jawwid.jawwidChat` | iOS | iOS | C | BLOCKED — OWNER ACTION REQUIRED | Owner | `exportArchive`: `No signing certificate "iOS Distribution" found`. Owner action OA-01. Done when the export succeeds and `aps-environment = production` is in the signed entitlements. |
| [ ] | LR-07a | Google Play **Organization** developer account, verified (D-U-N-S, identity, website) | AND | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | Play must verify the account before any app can be submitted. A D-U-N-S number can take up to 30 days. **The longest lead time on the whole list.** Owner action OA-02. |
| [ ] | LR-07b | Final Android package name, permanent after the first upload, even to internal testing | AND | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | `build.gradle.kts:59` uses `com.jawwid.jawwid_chat`; iOS uses `com.jawwid.jawwidChat`. Recommendation: keep `com.jawwid.jawwid_chat`. Owner action OA-03. |
| [ ] | LR-07c | Upload key created and kept by the owner; Play App Signing | AND | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | Only a throwaway key has ever signed a build. Release signing never falls back to the debug key (LR-53). Owner action OA-03. |
| [ ] | LR-47 | Firebase project and `google-services.json` for the release build; APNs key configured for push | BE | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner | CI job: "Android build (debug builds, release refuses without Firebase)". Owner action OA-04. |
| [ ] | LR-45 | Sentry DSN for the app (store builds refuse to build without it since #502), plus a token for symbol upload | BE | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner | `build-store.sh` (merged `14860ad3`) requires an https `SENTRY_DSN`. Owner action OA-05. |
| [ ] | LR-08 | The app works on real phones from signed builds against production (Apple 2.1; Play pre-launch) | SQA | Both | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer and owner (phones) | `submission-device-test-plan.md`: 22 of 24 rows NOT TESTED. Needs LR-01, LR-06, LR-07, LR-47. Owner action OA-20. |
| [ ] | LR-10 | Target audience decided (Play target audience and Families; Apple 1.3 and 5.1.4) | LEGAL | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | Children never sign in (`user_role.dart:9-21`), but parents open child-designed content. Choosing any child age band brings in the Families policy. Recommendation: account holders 18+, not the Kids category, no child imagery. Owner action OA-11. |
| [ ] | LR-48 | iOS build uploaded to App Store Connect; TestFlight internal test passes | iOS | iOS | C | BLOCKED — TECHNICAL DEPENDENCY | Release manager; owner (upload) | Needs LR-06, LR-45, LR-04, LR-01. Up to 100 internal testers; external testing needs beta review. |
| [ ] | LR-49 | Signed AAB on the Play internal-testing track; pre-launch report reviewed | AND | AND | C | BLOCKED — TECHNICAL DEPENDENCY | Release manager; owner (upload) | Needs LR-07a/b/c, LR-47, LR-45, LR-04, LR-01. The Data safety form is exempt only while the app is on internal testing alone. |

## 4. Phase 2: engineering and testing (High and Medium)

| ✓ | ID | Requirement (policy) | Area | Store | Pri | Status | Who | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-11a | A push notification opens its item: parent feedback replies (PD-32) | BE | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner (merge) | #449 head `c205aba0`: 30/30 checks pass. Independent review ACCEPT with no P1 or P2 (not yet posted). It contains migration `20261107150000`, so **the owner must approve the merge (High: migration)**. Owner action OA-17. |
| [ ] | LR-11b | Notification taps open the item, the permission is explained first, and pushes go only to the signed-in account (gates S-11, S-12, S-15) | BE | Both | H | BLOCKED — OWNER ACTION REQUIRED | Mobile and backend engineers | The code exists only in the uncommitted `~/dev/jawwid-push-acceptance` tree (50 files; preserved, never edited). Porting it as a patch onto a new branch changes who receives pushes and re-claims a migration slot, so **the owner must approve implementation (High)**. Owner action OA-17. |
| [ ] | LR-12 | Incoming calls ring while the app is closed (S-06) | AND | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner; mobile engineer | iOS: PushKit and CallKit are merged but off until `APNS_VOIP_ENABLED=true`. Android: the full-screen ring is merged (#408, #458). Needs LR-47 and the device test. |
| [ ] | LR-13 | The iOS VoIP push registry exists at launch, so a killed app's call is always reported to CallKit (Apple PushKit rule: unreported VoIP pushes terminate the app) | iOS | iOS | H | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | `AppDelegate.swift:128,135` creates it only after Dart starts. Open PR #449 also edits `AppDelegate.swift`, so this waits for #449 to merge (OA-17). |
| [ ] | LR-14 | Foreground-service types match Play policy: `microphone` only, no unjustified `phoneCall` | AND | AND | H | IN PROGRESS | Builder A; lead | Lead decision recorded 2026-11-08. **#505** removes `phoneCall`, `FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS` (`a59f7d34`). The lead added a manifest guard test (`5cc153fc`). Next: CI, independent review, merge, then a device check (lock the screen mid-call). |
| [ ] | LR-15 | Payments presented within Apple 3.1.3(d) (one-to-one real-time services) and Play's billing exemption (a 1:1 live class) | LEGAL | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner; store compliance | Open risks:<br>• "Subscriptions" and «الاشتراكات» may read as 3.1.2 subscriptions;<br>• a family lesson call can seat siblings, which is one-to-few and would need in-app purchase;<br>• Play's anti-steering rule versus the in-app Stripe link (§9).<br>Owner action OA-12. |
| [ ] | LR-16 | Objectionable-content filter and moderation copy approved (Apple 1.2, which now also covers nonconsensual intimate imagery; Play UGC) | LEGAL | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner | The #493 filter is live in code. The word list (18 Arabic, 19 English words) is still a draft, and so are the report reasons and the conduct warning. Owner action OA-13. |
| [ ] | LR-17 | Storefronts: US age-assurance laws, EU trader status (Apple and, from Nov 2026, Play), China | LEGAL | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | Texas SB 2420 has been in force since 4 Jun 2026 (Declared Age Range API), with Utah and Louisiana also active. A trader declaration is needed even without EU distribution on Apple. Recommendation: the academy's markets first; no China; the US only after age assurance. Owner action OA-10. |
| [ ] | LR-18 | Media and evidence access verified on the real deployment (RT-037, RT-038) | SQA | Both | H | BLOCKED — TECHNICAL DEPENDENCY | Security reviewer; QA | Needs LR-01. Test plan: `docs/qa/RT-037-STAGING-REAL-MEDIA-TEST.md`. |
| [ ] | LR-19 | Production backups run and a restore drill passes | BE | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner; release manager | The daily backup failed again on 11-08 07:59 UTC, and so did the weekly one on 11-08 09:01 UTC. The `backup` Environment has no credentials. Owner action OA-07. |
| [ ] | LR-20 | Every role that can sign into the app can delete its account (Apple 5.1.1(v)) | BE | iOS | H | BLOCKED — OWNER ACTION REQUIRED | Owner | Sales staff and the Super Admin can sign in, but deletion covers parents and teachers only. Recommendation: a closure request, like #498. Owner action OA-14. |
| [ ] | LR-21 | Unique, increasing build numbers and a production-only store build | iOS | Both | H | READY FOR VERIFICATION | Release manager | #502 merged as `14860ad3` on 2026-11-08 by the lead. Review ACCEPT @ `6c4856a7`; 30/30 checks green on the PR head. Verify on the first store build of each platform. |
| [ ] | LR-22 | Crash reports are symbolicated | SQA | Both | H | READY FOR VERIFICATION | Release manager | #502 keeps the symbols (`--split-debug-info`); the upload is a documented `sentry-cli` step with the owner's token. Done when a forced test crash shows a symbolicated trace. |
| [ ] | LR-46 | Final security sign-off on the release-candidate SHA | SQA | Both | H | NOT STARTED | Security reviewer (Fable 5.1) | Runs in Phase 3 on the merged release candidate. |
| [ ] | LR-23 | App Privacy label and Data safety match the code and SDKs (Firebase Installations id, Sentry diagnostics, purchase history, CoarseLocation) | LEGAL | Both | M | IN PROGRESS | Drafter C | Drafts go to `docs/release/store-console/`. Still needed: Xcode's privacy report on the archive. |
| [ ] | LR-24 | Every iOS background mode is justified (`voip`, `audio`, `remote-notification`) | iOS | iOS | M | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | `remote-notification` has no handler on `main`. It depends on LR-11. |
| [ ] | LR-25 | Reporting or blocking a staff member behaves honestly | AND | Both | M | IN PROGRESS | Mobile engineer (#503) | #503 head `e83a6c05`: lead review ACCEPT recorded. The CI re-run is in progress, started by another session. Merge when it is green. |
| [ ] | LR-26 | Microphone denial is recoverable ("Open settings") | AND | Both | M | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | Needs new strings in the l10n files, which #449, #498 and #503 all edit. Start when they land. |
| [ ] | LR-27 | Full-screen call permission checked on Android 14+ (Play: must work when FSI is denied) | AND | AND | M | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | `JawwidPush.kt:141` always sets the intent. #449 edits `JawwidPush.kt`, so this waits for #449. |
| [ ] | LR-28 | Defects a reviewer could see are closed (TEACHER-020, PARENT-016, PARENT-024, P2 retests) | SQA | Both | M | NOT STARTED | QA engineer | TEACHER-020 (#491) needs an iPhone check. PARENT-016 and PARENT-024 have no write-up. |
| [ ] | LR-44 | Connection recovery: realtime resumes after a server restart or network loss (PARENT-015) | SQA | Both | M | BLOCKED — TECHNICAL DEPENDENCY | QA engineer | The 2026-10-31 QA showed the app needed a relaunch after an API restart. Whether it is fixed on `main` is not verified. It is a device-plan row (LR-08). |
| [ ] | LR-29 | Uptime monitoring and someone on call | BE | Both | M | BLOCKED — OWNER ACTION REQUIRED | Owner; release manager | Owner action OA-19 (name a person). Needs LR-01. |
| [ ] | LR-30 | The release documents tell the truth | SQA | — | M | IN PROGRESS | Lead | #501 corrects the gate notes and the payments path. Still stale: `release-gate.md` S-06/S-09, `production-readiness.md`, `findings.md` RT-006/012/016/022. |
| [ ] | LR-31 | The closed-account state the policies promise (P-6) | BE | Both | M | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | An erased e-mail can sign up again. Either build it (High: account security) or have counsel soften the wording. Owner action OA-15. |
| [ ] | LR-32 | `LIVEKIT_URL` must be `wss://` in production | BE | Both | M | IN PROGRESS | Builder B; lead | **#506** (`4c404750`). The secret scanner flagged a placeholder in the new spec; the lead fixed it in `2100b65b`. Next: CI, review, merge. |
| [ ] | LR-33 | Staff permission guard enforced (`shadow` → `enforce`) | SQA | — | M | BLOCKED — TECHNICAL DEPENDENCY | Backend engineer; security reviewer | Needs real shadow-denial logs (LR-01). It is authorization, so High risk: the owner approves the switch. |
| [ ] | LR-34 | Live card payments at launch decided, and the review notes match the screen | LEGAL | Both | M | BLOCKED — OWNER ACTION REQUIRED | Owner | Without `STRIPE_*` in production, the pay sheet offers bank transfer only. Owner action OA-12. |
| [ ] | LR-35 | The picker no longer offers CSV, which the server refuses | AND | Both | L | IN PROGRESS | #503 | As for LR-25. |
| [ ] | LR-36 | Icons: a non-upscaled 1024 iOS icon and an Android monochrome layer | iOS | Both | L | BLOCKED — OWNER ACTION REQUIRED | Owner; mobile engineer | Owner action OA-18 (a vector logo). |
| [ ] | LR-37 | Unused `sqflite` removed | AND | Both | L | IN PROGRESS | #503 | As for LR-25. |
| [ ] | LR-38 | RT-017/018: invalid `before`/`after` return 400, not 500 | BE | Both | L | IN PROGRESS | Builder B | **#506**. `after=0` stays valid, because the app asks for `seq − 1`. |
| [ ] | LR-39 | iPhone landscape layouts checked, or the app restricted to portrait | iOS | iOS | L | NOT STARTED | QA engineer | `Info.plist` allows landscape. Check during the device run. |
| [ ] | LR-40 | Unused `Main.storyboard` | iOS | iOS | L | NOT APPLICABLE — WITH DOCUMENTED REASON | Lead | Cosmetic. It does not affect review or behaviour (the window is built in `SceneDelegate`), and editing `project.pbxproj` without a local build is riskier than leaving it. Revisit after launch. |
| [ ] | LR-41 | The tone of the Arabic permission strings | LEGAL | iOS | L | BLOCKED — OWNER ACTION REQUIRED | Owner | Five strings in `ios/Runner/ar.lproj/InfoPlist.strings`. Owner action OA-18. |
| [ ] | LR-42 | The app log redacts e-mail addresses and one-time codes (RT-021) | SQA | Both | L | IN PROGRESS | Builder A | **#505**: six new tests. A plain `code` key is masked only for 4–8 digits, so error codes stay readable. |

## 5. Phase 3: store submission preparation

| ✓ | ID | Requirement (policy) | Area | Store | Pri | Status | Who | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-09a | Apple App Privacy details: all data, including SDKs; Sentry is Diagnostics | LEGAL | iOS | C | IN PROGRESS | Drafter C, then owner (enters) | Draft: `docs/release/store-console/apple-app-privacy.md`. |
| [ ] | LR-09b | Play Data safety form, including the deletion web link | LEGAL | AND | C | IN PROGRESS | Drafter C, then owner | Draft: `google-data-safety.md`. It also needs LR-04's URL. |
| [ ] | LR-09c | Apple age rating, 2026 questionnaire (tiers 4+/9+/13+/16+/18+, the social-media question, and Shared Location/Dating from 16 Nov 2026) | LEGAL | iOS | C | IN PROGRESS | Drafter C, then owner | Decide whether 24-hour stories count as a "social feed". This depends on LR-10. |
| [ ] | LR-09d | IARC content rating questionnaire | LEGAL | AND | C | IN PROGRESS | Drafter C, then owner | Draft: `age-rating.md`. |
| [ ] | LR-09e | Play target audience and content | LEGAL | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | Follows LR-10 (OA-11). |
| [ ] | LR-09f | Review notes and App access instructions (two demo accounts; the deletion path; staff screens described per Apple 2.5.19) | LEGAL | Both | C | IN PROGRESS | Drafter C | `app-review-notes-payments.md` was corrected in #501; the full notes are being drafted. The credentials come from LR-05. |
| [ ] | LR-09g | Play declarations: financial features ("none"), health ("none"), ads ("no"; no `AD_ID`), government, news | LEGAL | AND | C | IN PROGRESS | Drafter C | Draft: `play-declarations.md`. |
| [ ] | LR-09h | Play foreground-service declaration, with a video of a voice call (microphone type) | LEGAL | AND | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer; owner (records) | Needs LR-14 merged and a signed build on a phone. |
| [ ] | LR-09i | Play full-screen intent declaration (calling app) | LEGAL | AND | C | IN PROGRESS | Drafter C | Draft: `play-declarations.md`. |
| [ ] | LR-09j | Screenshots: iPhone (1179×2556 or 1206×2622); iPad only if the app runs on iPad; Play phone 2–8, plus a 1024×500 feature graphic | LEGAL | Both | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer; store compliance | Needs a production build with review data (LR-05). No child imagery (LR-10). Confirm whether the iOS target includes iPad. |
| [ ] | LR-09k | Listing copy in Arabic and English (name ≤ 30 characters, subtitle or short description, description, keywords, what's new) | LEGAL | Both | C | IN PROGRESS | Drafter C, then owner approves | Draft: `listing-copy.md`. |
| [ ] | LR-57b | Export compliance answer in App Store Connect | LEGAL | iOS | M | BLOCKED — TECHNICAL DEPENDENCY | Owner | The plist key is set (LR-57). The answer is given once the app record exists (LR-06). |
| [ ] | LR-71 | Final compliance audit of every console answer against the code and this file | LEGAL | Both | H | NOT STARTED | Store compliance (Fable 5.1) | Last step before the owner's go. |
| [ ] | LR-72 | The owner's final approval to submit, per store | LEGAL | Both | C | BLOCKED — TECHNICAL DEPENDENCY | Owner | Never automatic. It comes after LR-71 (OA-23). |

## 6. Already met, or not applicable (with evidence)

| ✓ | ID | Requirement (policy) | Area | Store | Pri | Status | Who | Evidence |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-50 | Target API 36, min SDK 26 (Play: API 36 for new apps since 31 Aug 2026) | AND | AND | H | READY FOR VERIFICATION | Release manager | Flutter defaults (`FlutterExtension.kt:23,34`); `minSdk = 26`. Check again on the final AAB (`bundletool dump manifest`). |
| [ ] | LR-51 | 16 KB memory pages (Play: updates without them are blocked from 1 Feb 2027) | AND | AND | H | READY FOR VERIFICATION | Release manager | arm64 WebRTC and Sentry libraries are aligned at 0x4000. Re-check on the final AAB. |
| [ ] | LR-52 | Built with Xcode 26 and the iOS 26 SDK (Apple, since 28 Apr 2026) | iOS | iOS | H | READY FOR VERIFICATION | Release manager | Xcode 26.6 is on the build Mac. Check the archive's SDK when it is uploaded. |
| [x] | LR-53 | Release signing never falls back to the debug key | AND | AND | H | COMPLETED AND VERIFIED | Android audit | E-02 |
| [x] | LR-54 | Minimal Android permissions; no `READ_MEDIA_*`; the system photo picker | AND | AND | M | COMPLETED AND VERIFIED | Android audit | E-02 (LR-14 narrows it further) |
| [x] | LR-55 | Only `MainActivity` exported; `allowBackup=false`; no cleartext traffic | AND | AND | H | COMPLETED AND VERIFIED | Android audit | E-02 |
| [x] | LR-56 | iOS usage strings for every capability used, in Arabic and English, with none unused | iOS | iOS | M | COMPLETED AND VERIFIED | iOS audit | E-02 (tone: LR-41) |
| [x] | LR-57 | Export compliance key `ITSAppUsesNonExemptEncryption = false` (only the OS's own TLS) | LEGAL | iOS | M | COMPLETED AND VERIFIED | iOS audit | E-02 |
| [ ] | LR-58 | Privacy manifest present; no tracking; required-reason APIs declared | iOS | iOS | M | READY FOR VERIFICATION | iOS audit | `PrivacyInfo.xcprivacy` has `NSPrivacyTracking=false`. App Store Connect rejects an upload with missing reasons, so the upload itself (LR-48) is the proof. |
| [x] | LR-59 | No ads, analytics, attribution or tracking SDK; no ATT prompt needed | SQA | Both | M | COMPLETED AND VERIFIED | Security audit | E-02 |
| [x] | LR-60 | No secrets in the repository or in the binary's build defines | SQA | Both | H | COMPLETED AND VERIFIED | Security audit | E-02 |
| [x] | LR-61 | Tokens in Keychain or Keystore; local data cleared at sign-out | SQA | Both | H | COMPLETED AND VERIFIED | Security audit | E-02 |
| [x] | LR-62 | Authentication on every API route by default; every public route justified | SQA | Both | H | COMPLETED AND VERIFIED | Security audit | E-02 |
| [x] | LR-63 | Signed, re-authorized media links; webhook signatures verified | SQA | Both | H | COMPLETED AND VERIFIED | Security audit | E-02 (real deployment: LR-18) |
| [x] | LR-64 | Report a message or a person; blocking enforced on the server (Apple 1.2; Play UGC) | SQA | Both | H | COMPLETED AND VERIFIED | PD-57 builders | E-03 |
| [ ] | LR-65 | Parent deletion in the app, plus a bilingual public deletion page that works without the app | BE | Both | H | READY FOR VERIFICATION | Accounts audit | `settings_screen.dart:279`; `account-deletion.controller.ts`. The page must be reachable on the production host (LR-01) and named in the console (LR-09b). |
| [x] | LR-67 | Release builds cannot run on fixture data | SQA | Both | M | COMPLETED AND VERIFIED | Security audit | E-02 |
| [x] | LR-68 | No digital content or feature unlocked by payment; chat is never locked (Apple 3.1.1 does not apply) | LEGAL | Both | H | COMPLETED AND VERIFIED | Payments audit | E-04 |
| [ ] | LR-66 | Sign in with Apple (4.8) | LEGAL | iOS | — | NOT APPLICABLE — WITH DOCUMENTED REASON | Lead | The app uses only its own e-mail/password and WhatsApp-code sign-in. Guideline 4.8 applies only when a third-party or social login sets up the account. |
| [ ] | LR-69 | Play: 12 testers for 14 days, then apply for production access | AND | AND | — | NOT APPLICABLE — WITH DOCUMENTED REASON | Lead | Play answer 14151465 limits the rule to **personal** accounts created after 13 Nov 2023; we use an Organization account (LR-07a). If the Play Console Dashboard shows the testing requirement anyway, this row reopens at once, and it adds at least 14 days plus about 7 days of review. |

## 7. Owner Action Center

**Deadlines** are for the earliest submission date (Fri 13 Nov). Each one-day slip moves submission by about a day.
Questions go to the owner one at a time, in this order.

### Credentials and developer accounts

| # | What we need from you | Why | Store / feature | Deadline | What it blocks |
|---|---|---|---|---|---|
| OA-02 | **Does Jawwid already have a verified Google Play Organization developer account (with a D-U-N-S number)?** If not, start it today: the D-U-N-S number is free but can take up to 30 days. | Play will not accept any app from an unverified account | Google Play | **Today, Sun 8 Nov** | LR-07a, LR-49, every Android submission step |
| OA-01 | Create the Apple Distribution certificate, the App Store provisioning profile with Push for `com.jawwid.jawwidChat`, and the App Store Connect app record | Only the Account Holder or an Admin can do it | App Store | Mon 9 Nov 12:00 | LR-06, LR-48, LR-57b |
| OA-03 | Confirm the final Android package name (recommended: keep `com.jawwid.jawwid_chat`) and create the upload keystore you keep safe | The package name is permanent after the first upload | Google Play | Mon 9 Nov 12:00 | LR-07b, LR-07c, LR-49 |
| OA-04 | The Firebase project for Jawwid Chat: the `google-services.json` for the final package, and the APNs key confirmed | A release Android build refuses to build without it; push and calls need it | Both | Mon 9 Nov 12:00 | LR-47, LR-12, LR-49 |
| OA-05 | A Sentry project DSN for the app, and a token for symbol upload | Store builds refuse to build without the DSN (#502) | Both | Mon 9 Nov 12:00 | LR-45, LR-22, LR-48, LR-49 |
| OA-06 | The DigitalOcean app id (`DIGITALOCEAN_APP_ID`) and the DNS for the production API host | No production deploy is possible without them | Both | Mon 9 Nov 12:00 | LR-01 and everything after it |
| OA-07 | Credentials for the `backup` Environment: a read-only database role, a passphrase and a bucket key | Backups have failed every day | Both (data) | Tue 10 Nov | LR-19 |

### Legal and business information

| # | What we need from you | Why | Store / feature | Deadline | What it blocks |
|---|---|---|---|---|---|
| OA-08 | The legal entity name and address, mailboxes, governing law, refund terms, a safeguarding contact, where the pages are hosted, and counsel review (LD-1, LD-2, LD-4, LD-19, H-1) | The policies cannot be published with placeholders | Both | Mon 9 Nov 18:00 | LR-04, LR-09b, the store builds |
| OA-09 | The final Terms of Use and Code of Conduct texts and their versions (N-3) | The terms gate shows these exact documents | Both | Mon 9 Nov 18:00 | LR-02d, then LR-02a |
| OA-10 | Storefronts. Recommended: the academy's markets first, no China, the US only after age assurance; trader details if the EU is included | US state age laws and EU trader rules carry legal duties | Both | Tue 10 Nov | LR-17 |

### Product and policy decisions

| # | What we need from you | Recommendation | Deadline | What it blocks |
|---|---|---|---|---|
| OA-11 | The target audience | Account holders 18+; not Kids; no child imagery | Mon 9 Nov | LR-10, LR-09c, LR-09e, LR-09j |
| OA-12 | Payments:<br>• the wording of the "Subscriptions" tab;<br>• one learner per paid lesson call;<br>• disclosing Core's monthly charges;<br>• the trial;<br>• live Stripe at launch;<br>• whether the app shows the Stripe link at all on Play | Rename the tab to lesson-package wording; guard one learner per call; disclose the charges; on Play, consider paying on the web only | Tue 10 Nov | LR-15, LR-34 |
| OA-13 | Approve the word list (LD-12), the report reasons (N-4) and the conduct warning | Approve after reading | Tue 10 Nov | LR-16 |
| OA-14 | Account deletion for staff who sign into the app | A closure request, like the one for teachers | Tue 10 Nov | LR-20 |
| OA-15 | The closed-account state (P-6): build it, or have counsel soften the wording | Build it (needs your approval: High) | Wed 11 Nov | LR-31 |
| OA-16 | Approve the engineering organization in #501, so this tracker can merge to `main` | Approve | Mon 9 Nov | Tracker on `main`; role definitions |
| OA-17 | High-risk approvals:<br>• merge **#449** (it adds a migration);<br>• merge **#497** and **#498** after their P2 fixes;<br>• **approve implementation** of the push port (LR-11b) | Approve | Mon 9 Nov | LR-11a, LR-11b, LR-13, LR-27, LR-02a, LR-03 |
| OA-18 | A vector or high-resolution logo; read the five Arabic permission strings | — | Wed 11 Nov | LR-36, LR-41 |
| OA-19 | Who is on call for production alerts | Name a person | Wed 11 Nov | LR-29 |

### Device testing

| # | What we need from you | Deadline | What it blocks |
|---|---|---|---|
| OA-20 | An iPhone and an Android 14+ phone, and about 3 hours with QA to run the device plan, including recording the foreground-service video | Wed 11 Nov | LR-08, LR-09h, LR-12, LR-44 |

### Production deployment approvals

| # | What we need from you | Deadline | What it blocks |
|---|---|---|---|
| OA-21 | Approve the first staging deploy, then production (including its migrations). Then set the review-account domain and two passwords and run the provisioning command. | Tue 10 Nov | LR-01, LR-05, LR-18, LR-43 |

### Store submission approval

| # | What we need from you | Deadline | What it blocks |
|---|---|---|---|
| OA-23 | The final go to submit, for each store, after the final audit (LR-71) | Fri 13 Nov | LR-72, the submission |

## 8. Evidence log (COMPLETED AND VERIFIED rows)

| # | Rows | Date | Agent | PR / commit | CI | Independent review | Device / integration | Policy source |
|---|---|---|---|---|---|---|---|---|
| E-01 | LR-02c | 2026-11-08 | Frontend engineer (builder) | #500, merge `496560a380500df7f8104baa024aeeeaa7393367` (head `34474f6f`) | Main CI run 42465970426 on `496560a3`: success | `Review: ACCEPT @ 34474f6f0861495e2b702ee0174b61effa7fd85e` (separate review agent) on #500 | Admin Web is not a store binary; Vitest in CI | Apple 1.2 / Play UGC (terms before posting) |
| E-02 | LR-53, 54, 55, 56, 57, 59, 60, 61, 62, 63, 67 | 2026-11-08 | Eight read-only audits (iOS, Android, security); the lead spot-checked | Code on `main` @ `cebbcd99`; the file:line references are in #501's audit; unchanged by #500, #502 and #504 | Main CI run 42417856955: 15/15 jobs | #501's independent reviewer confirmed 28 load-bearing claims against `cebbcd99` | Static facts; no device needed. LR-63 also needs the real-deployment test (LR-18) | Apple export compliance; Apple 5.1.2; Play permissions policy (answer 9888170) |
| E-03 | LR-64 | 2026-11-08 | PD-57 builders; audited 11-08 | PD-57 PRs #463–#482, all on `main` | Integration specs `platform/blocks` and moderation, green on main | PD-57 reviews; confirmed again by the #501 audit | Server-side, so no device needed; the in-app sheet is also covered by LR-25 | Apple 1.2; Play UGC (answer 9876937) |
| E-04 | LR-68 | 2026-11-08 | Payments audit | `conversation.controller.ts:237-250` on `cebbcd99` | Main CI green | #501 reviewer | n/a | Apple 3.1.1 and 3.1.3(d) |

## 9. Official sources (checked live on 2026-11-08)

**Apple:**
- App Review Guidelines, version of 16 Oct 2026: https://developer.apple.com/app-store/review/guidelines/
- Account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App Privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Age ratings: https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/
  - the social-media question (required since Sep 2026): https://developer.apple.com/news/?id=tlur8uvi
  - Shared Location and Dating (from 16 Nov 2026): https://developer.apple.com/news/?id=yxkh08us
- Texas SB 2420 and the Declared Age Range API: https://developer.apple.com/news/?id=sg176nne
- Utah and Louisiana: https://developer.apple.com/news/?id=f5zj08ey
- PushKit to CallKit: https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit
- Required-reason APIs: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- Screenshots: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- Export compliance: https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations
- TestFlight: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- Xcode/SDK minimums: https://developer.apple.com/news/upcoming-requirements/
- EU DSA trader: https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements
- China and CallKit: **no official Apple page found**. The safe choice is to exclude mainland China.

**Google Play** (each page below is `support.google.com/googleplay/android-developer/answer/<number>` unless a full URL is given):
- Policy Center: https://play.google/developer-content-policy/
- Organization accounts and D-U-N-S: 13634885 and 13628312
- Identity verification: 10841920
- Package name: 9859152
- Play App Signing: 9842756
- Target API: 11926878
- 16 KB pages: https://developer.android.com/guide/practices/page-sizes
- Data safety: 10787469
- Privacy policy: 10144311
- Account deletion: 13327111
- Permissions: 9888170
- Foreground services and full-screen intent: 13392821
- User-generated content: 9876937
- Payments: 9858738 and the 10281818 FAQ (1:1 live classes exempt; anti-steering is still unresolved for an in-app Stripe link)
- Subscriptions: 9900533
- IARC: 9898843
- Target audience and Families: 9867159 and 9893335
- Listing graphics: 9866151
- Metadata: 9898842
- Testing requirements: 14151465
- Tracks: 9845334
- App access: 9859455
- Financial features: 13849271
- Health: 14738291
- Android developer verification: https://developer.android.com/developer-verification

Wording of very long pages was read through a summarising fetch. Re-read the exact text before quoting it to a reviewer.

## 10. Phase plan and parallel work

**Phase 1: critical blockers (now to Mon 9 Nov).**
- **In parallel now** (engineering, separate files):
  - Builders A and B;
  - Drafter C;
  - the #497 P2 fix;
  - the #498 P2 fixes.
- **Owner, in parallel:** OA-01 to OA-06, OA-08, OA-09, OA-11, OA-16, OA-17.
- **Dependencies:**
  - #449 → LR-13 and LR-27;
  - the l10n PRs → LR-26;
  - OA-06 → LR-01;
  - OA-08 → LR-04;
  - OA-09 → LR-02d → LR-02a.

**Phase 2: engineering and testing (Tue 10 to Wed 11 Nov).**
1. Staging deploy, then the RT-037 media test (LR-18).
2. Production deploy (owner) and review accounts (LR-05).
3. Store builds from one merged `main` SHA.
4. The device plan on two phones (LR-08), including the call, push, deletion and terms-gate rows.
5. Fixes go back through the merge conditions.

**Phase 3: submission preparation (Thu 12 to Fri 13 Nov).**
1. Screenshots from the production build.
2. Console answers entered by the owner from `docs/release/store-console/`.
3. The final compliance audit (LR-71) and security sign-off (LR-46), both on Fable 5.1.
4. TestFlight internal and Play internal testing.
5. The owner's go (OA-23).

**Rules that do not change:**
- no production deploy, production migration or store submission without the owner;
- no `--admin` and no bypass;
- every merge at the reviewed head commit, under the 8 merge conditions;
- protected projects are untouched;
- **project code is not run on this Mac** until the owner settles its security, so CI and real devices are the test evidence.
