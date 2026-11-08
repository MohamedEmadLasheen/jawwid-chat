# Jawwid Chat launch command center: App Store and Google Play

**The one canonical launch tracker** for both stores. It replaces every earlier readiness verdict (`store-readiness-2026-11-03.md`,
`google-play-readiness-2026-11-03.md`, `release-scorecard.md`), which are now history.

- **Where:** `docs/release/launch-readiness-checklist.md`.
- **Maintained by:** the engineering lead (CEO session), after every task, merge or owner answer. Every `[x]` has evidence in §6.
- **Last updated:** 2026-11-08 17:53 Cairo (15:53 UTC). Earlier versions today carried times about 2½ hours ahead of the real clock; the facts in them were current when written.
- **State of `main`:** `22237717`, which contains #500, #502 and #504–#515. Main CI run 42488182440 on `6e0e1438`: 15/15 green; later merges are documents only.

## 1. Dashboard

### Verdict

| Store | Verdict | Earliest defensible "ready to submit" |
|---|---|---|
| **Apple App Store** | **NOT READY** | **Fri 13 Nov 2026**, only if the owner inputs due Mon 9 Nov (§5) arrive on time |
| **Google Play** | **NOT READY** | **Fri 13 Nov 2026**, on the same conditions as iOS. The owner confirmed the Play Organization account exists on 2026-11-08. |

**The 48-hour target (Tue 10 Nov, 15:00 Cairo) is not realistic.** Engineering alone cannot close the gap, for five reasons:
1. **The production backend has never been deployed** (no run of "Deploy production" ever). Reviewers need a live server (Apple 2.1(a)).
2. **Store signing is not set up yet.** The Apple Developer account and the Play Organization account both exist (confirmed 2026-11-08), but:
   - Apple: no Distribution certificate, App Store profile or App Store Connect record;
   - Google: the package name is not final and there is no upload key;
   - there is no Firebase project or Sentry DSN for release builds.

   Only the owner can create these.
3. **No legal page is hosted.** The drafts still contain `{{ENTITY_NAME}}`, and the store build script refuses to build without the API, privacy, terms and support URLs.
4. **Nothing has run on a real phone** against a real server: push, calls, deletion and the terms gate (the submission device plan of about 40 rows has never been run).
5. **Four High-risk changes need the owner's approval:** #497, #498, #449 and the push port.

From the moment the owner inputs arrive, the critical path is about 4 days:
- day 1: deploy staging and production, and host the legal pages;
- day 2: review accounts, store builds and the console forms;
- day 3: device test plan on two phones;
- day 4: fixes from device testing, final compliance and security audit, then the owner's go.

### Status counts (every requirement in §4)

| Total | ✅ Completed and verified | 🔎 Ready for verification | 🔧 In progress | ⛔ Blocked: owner | ⏳ Blocked: technical | ○ Not started | N/A |
|---|---|---|---|---|---|---|---|
| **95** | **16** | 15 | 7 | 30 | 20 | 4 | 3 |

| Still open | Count | Items |
|---|---|---|
| **Critical** | 32 | LR-06, LR-09a, LR-09c, LR-48, LR-07a, LR-07b, LR-07c, LR-09b, LR-09d, LR-09e, LR-09g, LR-09h, LR-09i, LR-49, LR-02b, LR-76, LR-01, LR-77, LR-02a, LR-03, LR-05, LR-43, LR-45, LR-47, LR-08, LR-02d, LR-04, LR-09f, LR-09j, LR-09k, LR-10, LR-72 |
| **High** | 24 | LR-13, LR-20, LR-52, LR-73, LR-14, LR-50, LR-51, LR-12, LR-21, LR-74, LR-02c, LR-11a, LR-11b, LR-19, LR-65, LR-18, LR-22, LR-46, LR-63, LR-79, LR-15, LR-16, LR-17, LR-71 |
| Critical items blocked on the owner | 17 | LR-06, LR-09a, LR-09c, LR-07b, LR-07c, LR-09b, LR-09d, LR-09e, LR-76, LR-01, LR-77, LR-45, LR-47, LR-02d, LR-04, LR-09k, LR-10 (plus LR-02a and LR-03, which wait for the owner's merge approval) |

**Completion.** Each figure is completed-and-verified ÷ applicable; N/A is excluded.

| Platform or category | Applicable | ✅ Done | % | Open Critical | Open High |
|---|---|---|---|---|---|
| **iOS launch** (every item that applies to iOS: A + the both-store items in C–F) | 70 | 13 | **19 %** | 22 | 19 |
| **Android launch** (every item that applies to Android: B + the both-store items in C–F) | 74 | 14 | **19 %** | 28 | 19 |
| A. iOS: Apple App Store | 15 | 2 | **13 %** | 4 | 4 |
| B. Android: Google Play | 17 | 3 | **18 %** | 10 | 3 |
| C. The mobile app on both platforms | 9 | 0 | **0 %** | 1 | 3 |
| D. Shared backend and infrastructure | 18 | 2 | **11 %** | 9 | 5 |
| E. Security and QA | 19 | 8 | **42 %** | 1 | 5 |
| F. Legal and compliance | 14 | 1 | **7 %** | 7 | 4 |

### Current blockers (what stops submission today)
1. **No production server.** It has never been deployed, and staging has never deployed successfully. The `production` Environment is largely configured and the domain is chosen. The app id is created by the first deploy. Waits on Builder H's gap list, then the owner's approval (OT-3 / OA-21).
2. **Nowhere to build signed store builds** (LR-76): project code may not run on this Mac, and there is no CI release workflow (OT-2).
3. **No store signing:**
   - Apple: the Distribution certificate, App Store profile and App Store Connect record (OA-01). The Apple Developer account exists.
   - Google: the package name and upload key (OA-03). The Play Organization account exists.
4. **No app-side Firebase file or app Sentry DSN for release builds** (OA-04, OA-05). The server side of both exists.
5. **No hosted legal pages** (OA-08), and **no final Terms texts** (OA-09).
6. **High-risk merges waiting for the owner:** #497 (Terms gate API), #498 (teacher deletion), #449 (push opens the item) (OA-17).
7. **Nothing tested on real phones** yet (LR-08). This waits on items 1–4.

### Active agents and task owners

| Agent (role) | Task | Where | State |
|---|---|---|---|
| Lead (this session) | This tracker; GitHub reconciliation; reviews; merges under the merge conditions | `~/dev/jawwid-launch-tracker` → `claude/launch-readiness-org` (#501) | Running |
| Builder A (Mobile engineer) | LR-14, LR-42 | #505 | **Merged** `b05d141a` |
| Builder B (Backend engineer) | LR-32, LR-38 | #506 | **Merged** `8e26b0dc` |
| Drafter C (Store compliance) | LR-09a–k, LR-23 store-console answers | #507 | **Merged** `9bb0418d` |
| Builder D (Mobile engineer) | LR-73 iOS privacy manifest | #508 | **Merged** `a6a7e1b1` |
| Builder E (Mobile engineer) | LR-74 call microphone and service order | #509 | **Merged** `481cdef2` |
| Builder F (Release manager) | LR-30 document corrections | #510 | **Merged** `5ed73ce6` |
| Builder G (Mobile engineer) | LR-75 token redaction | #511 | **Merged** `6e0e1438` |
| Builder H (Release manager) | LR-01 first-deploy readiness report | #512 | **Merged** `6a31ba8e` |
| Builder I (Release manager + Security) | LR-76 signed-build options paper | #513 | **Merged** `aef40d66` |
| Agent J (Security + Release) | LR-76 signing on the existing Mac (verified paper) | #514 | Both P1s fixed; final check of the public wording; **will be squash-merged** so the first commit never reaches `main` |
| Agent K (QA engineer) | LR-08 device test plan refreshed for today's merges | #515 | **Merged** `ea5a2d69` |
| Agent M (QA + mobile) | LR-78 flaky Android ring job | #517 | Root cause found; under review; **owner Code Owner approval needed** |
| Builder L (Backend/infra) | LR-77 first-deploy backup fix | #516 | Accepted @ `e56568c1`; **owner merge approval needed** (High) |
| Another session (not the lead) | CI re-runs on #498 and #503 | its own | Both now 30/30 green; not touched by the lead |

### Next tasks (kept in order; the lead starts each one without being asked)
1. Agent J's paper (signing on the existing Mac): independent review, then the **OT-2b handoff**.
2. Agent K's device plan (LR-08): review, then merge.
3. **LR-77** (first-deploy backup fix): ready to implement the moment the owner approves.
4. **OT-3 handoff** (first deploy) from #512, once LR-77 is merged.
5. **LR-13 and LR-27** as soon as #449 merges; **LR-26** once #449, #498 and #503 land.
6. #503: merge if the other session has not.

## 2. Owner execution (one task at a time)

The owner works through these in a separate terminal session, using the handoff the lead gives for each one. Only the lead checks evidence and ticks boxes.

| Order | Owner task | Unblocks | State |
|---|---|---|---|
| ~~OT-1~~ **Done, verified 2026-11-08** | Create the App Store Connect app record and confirm the App ID `com.jawwid.jawwidChat` has Push Notifications. Browser only; no keys are created on this Mac | LR-06 (record part), LR-09a, LR-09c, LR-57b; first step toward LR-48 | **Verified by the lead from the screenshots (E-08).** Primary language English (U.S.) is kept for version 1, with an Arabic localization to be added (LR-09k). The developer account name shown is "Jawwid LLC", an input for OA-08 (legal entity), to be confirmed by the owner |
| OT-2 | Decide where signed store builds are made (LR-76) | LR-76, then LR-06 (certificate), LR-07c, LR-48, LR-49, LR-08 | **Answered 2026-11-08:** no second Mac; the owner is the Account Holder. Follow-up **OT-2b**: decide how this Mac becomes trustworthy for signing (erase and reinstall, then a dedicated signing user, versus building on GitHub runners). The lead's assessment is in chat; agent J's verified paper is coming |
| OT-3 | First deploy package: (1) approve implementing the LR-77 backup fix; (2) read the readiness report (#512); (3) approve the first production deploy (OA-21): a paid App Platform app (about $32/month) and 177 forward-only migrations | LR-77, LR-01, then LR-05, LR-18, LR-43, LR-65, LR-29 | Queued; #512 is being corrected after its review |
| **OT-4 (now)** | Play Console: confirm the Organization account's verification, create the app (Free, no upload: the package name is set only at the first upload), and screenshot the Dashboard's testing requirements. Handoff: `~/jawwid-owner-evidence/OT-4/HANDOFF.md` | LR-07a, LR-69; prepares LR-09b, LR-09d, LR-09e, LR-09g, LR-09i | **Ready 2026-11-08** |
| OT-5 | Legal facts and hosting (OA-08), final Terms texts (OA-09) | LR-04, LR-02d, LR-02a | Queued |
| OT-6 | Decisions: target audience (OA-11), payments (OA-12), storefronts (OA-10) | LR-10, LR-15, LR-17, LR-09c–e, LR-09k | Queued |

## 3. Status key

| Mark | Status | Meaning |
|---|---|---|
| `[x]` | COMPLETED AND VERIFIED | Done, with evidence in §6: the PR and SHA, CI, an independent review, a device test where relevant, and a policy source |
| `[ ]` | READY FOR VERIFICATION | Built; the proof a store needs (a release build, a device or the real server) is still missing |
| `[ ]` | IN PROGRESS | An agent is working on it now |
| `[ ]` | BLOCKED — OWNER ACTION REQUIRED | Needs something only the owner can give |
| `[ ]` | BLOCKED — TECHNICAL DEPENDENCY | Waits on another item, shown in "Depends on" |
| `[ ]` | NOT STARTED | Nobody is on it yet |
| `[ ]` | NOT APPLICABLE — WITH DOCUMENTED REASON | Does not apply, and the reason is written in the row |

Priority: **C** Critical, **H** High, **M** Medium, **L** Low. Store: iOS, AND (Android), Both, or — (not a store item).

## 4. Checklists

Each requirement appears once:
- **A** and **B** hold what only one store needs.
- **C** to **F** hold what both stores need.
- The iOS and Android percentages in §1 count every item that applies to that store.
- Within each list, open items come first, ordered by priority.

### A. iOS: Apple App Store (2 of 15 done, 13 %)

| ✓ | ID | Requirement (policy) | Store | Pri | Status | Owner / agent | Depends on | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-06 | Apple Distribution certificate, App Store profile with Push, App Store Connect record for `com.jawwid.jawwidChat` | iOS | C | BLOCKED — OWNER ACTION REQUIRED | Owner | OT-2b (LR-76) | **Part 1 of 2 verified by the lead on 2026-11-08 (OT-1, evidence E-08):** the explicit App ID `com.jawwid.jawwidChat` on team `KX683HAR3Y` ("Jawwid LLC") has Push Notifications enabled; the App Store Connect record exists (name "Jawwid", SKU `jawwid-chat-ios`, Apple ID `6832258042`, primary language English (U.S.), version 1.0 "Prepare for Submission"). **Part 2 still missing:** the Apple Distribution certificate and the App Store provisioning profile, which wait on OT-2b (LR-76). The row stays open until both parts are done. |
| [ ] | LR-09a | Apple App Privacy details: all data, including SDKs; Sentry is Diagnostics | iOS | C | BLOCKED — OWNER ACTION REQUIRED | Drafter C, then owner (enters) | OA-08 (counsel), OT-1 evidence | Draft merged (#507, `docs/release/store-console/apple-app-privacy.md`). The App Store Connect record now exists (Apple ID `6832258042`). The owner enters it once counsel answers the open point in the draft (whether Quran-lesson enrolment counts as "religious beliefs"). |
| [ ] | LR-09c | Apple age rating, 2026 questionnaire (tiers 4+/9+/13+/16+/18+, the social-media question, and Shared Location/Dating from 16 Nov 2026) | iOS | C | BLOCKED — OWNER ACTION REQUIRED | Drafter C, then owner | LR-10 | Draft merged (#507, `age-rating.md`). Waits on the target-audience decision (OA-11) and whether stories count as a "social feed". Shared Location and Dating questions arrive on 16 Nov. |
| [ ] | LR-48 | iOS build uploaded to App Store Connect; TestFlight internal test passes | iOS | C | BLOCKED — TECHNICAL DEPENDENCY | Release manager; owner (upload) | LR-01, LR-04, LR-06, LR-45 | Needs LR-06, LR-45, LR-04, LR-01. Up to 100 internal testers; external testing needs beta review. |
| [ ] | LR-13 | The iOS VoIP push registry exists at launch, so a killed app's call is always reported to CallKit (Apple PushKit rule: unreported VoIP pushes terminate the app) | iOS | H | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | LR-11a (#449 owns the file) | `AppDelegate.swift:134-135` creates it inside `startRegistering()`, only after Dart starts. Open PR #449 also edits `AppDelegate.swift`, so this waits for #449 to merge (OA-17). |
| [ ] | LR-20 | Every role that can sign into the app can delete its account (Apple 5.1.1(v)) | iOS | H | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-14 | Sales staff and the Super Admin can sign in, but deletion covers parents and teachers only. Recommendation: a closure request, like #498. Owner action OA-14. |
| [ ] | LR-52 | Built with Xcode 26 and the iOS 26 SDK (Apple, since 28 Apr 2026) | iOS | H | READY FOR VERIFICATION | Release manager | LR-48 | Xcode 26.6 is on the build Mac. Check the archive's SDK when it is uploaded. |
| [ ] | LR-73 | The iOS privacy manifest declares every collected data type, matching the App Privacy label | iOS | H | READY FOR VERIFICATION | Builder D | LR-48 | **#508 merged** as `a6a7e1b1`: the manifest declares the label's 16 types, with a strict test. Review ACCEPT @ `0c840300`; PR CI 30/30. Final proof: Xcode's privacy report on the archive, and the upload is accepted (LR-48). |
| [ ] | LR-24 | Every iOS background mode is justified (`voip`, `audio`, `remote-notification`) | iOS | M | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | LR-11b | `remote-notification` has no handler on `main`. It depends on LR-11. |
| [ ] | LR-57b | Export compliance answer in App Store Connect | iOS | M | BLOCKED — TECHNICAL DEPENDENCY | Owner | LR-48 | The record exists (Apple ID `6832258042`, owner-reported 2026-11-08). The plist key `ITSAppUsesNonExemptEncryption = false` (LR-57) answers the export question for each uploaded build, so this is confirmed at the first upload. |
| [ ] | LR-58 | Privacy manifest present; no tracking; required-reason APIs declared | iOS | M | READY FOR VERIFICATION | iOS audit | LR-48 | `PrivacyInfo.xcprivacy` has `NSPrivacyTracking=false`. App Store Connect rejects an upload with missing reasons, so the upload itself (LR-48) is the proof. The collected data types are tracked in LR-73. |
| [ ] | LR-39 | iPhone landscape layouts checked, or the app restricted to portrait | iOS | L | NOT STARTED | QA engineer | LR-08 | `Info.plist` allows landscape. Check during the device run. |
| [ ] | LR-41 | The tone of the Arabic permission strings | iOS | L | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-18 | Five strings in `ios/Runner/ar.lproj/InfoPlist.strings`. Owner action OA-18. |
| [x] | LR-56 | iOS usage strings for every capability used, in Arabic and English, with none unused | iOS | M | COMPLETED AND VERIFIED | iOS audit | — | E-02 (tone: LR-41) |
| [x] | LR-57 | Export compliance key `ITSAppUsesNonExemptEncryption = false` (only the OS's own TLS) | iOS | M | COMPLETED AND VERIFIED | iOS audit | — | E-02 |
| [ ] | LR-40 | Unused `Main.storyboard` | iOS | L | NOT APPLICABLE — WITH DOCUMENTED REASON | Lead | — | Cosmetic. It does not affect review or behaviour (the window is built in `SceneDelegate`), and editing `project.pbxproj` without a local build is riskier than leaving it. Revisit after launch. |
| [ ] | LR-66 | Sign in with Apple (4.8) | iOS | — | NOT APPLICABLE — WITH DOCUMENTED REASON | Lead | — | The app uses only its own e-mail/password and WhatsApp-code sign-in. Guideline 4.8 applies only when a third-party or social login sets up the account. |

### B. Android: Google Play (3 of 17 done, 18 %)

| ✓ | ID | Requirement (policy) | Store | Pri | Status | Owner / agent | Depends on | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-07a | Google Play **Organization** developer account, verified (D-U-N-S, identity, website) | AND | C | READY FOR VERIFICATION | Owner | Play app creation (check) | **The owner confirmed on 2026-11-08 that Jawwid has a Play Organization account.** Still to check when the app is created: Play Console shows the account as verified and asks for no testing requirement (LR-69). |
| [ ] | LR-07b | Final Android package name, permanent after the first upload, even to internal testing | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-03 | `build.gradle.kts:59` uses `com.jawwid.jawwid_chat`; iOS uses `com.jawwid.jawwidChat`. Recommendation: keep `com.jawwid.jawwid_chat`. Owner action OA-03. |
| [ ] | LR-07c | Upload key created and kept by the owner; Play App Signing | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-03 | Only a throwaway key has ever signed a build. Release signing never falls back to the debug key (LR-53). Owner action OA-03. |
| [ ] | LR-09b | Play Data safety form, including the deletion web link | AND | C | BLOCKED — OWNER ACTION REQUIRED | Drafter C, then owner | LR-04, LR-07b | Draft merged (#507, `google-data-safety.md`). It needs the public deletion and privacy URLs (OA-08) and the Play app (OA-03). |
| [ ] | LR-09d | IARC content rating questionnaire | AND | C | BLOCKED — OWNER ACTION REQUIRED | Drafter C, then owner | LR-10 | Draft merged (#507, `age-rating.md`). Waits on OA-11. |
| [ ] | LR-09e | Play target audience and content | AND | C | BLOCKED — OWNER ACTION REQUIRED | Owner | LR-10 | Follows LR-10 (OA-11). |
| [ ] | LR-09g | Play declarations: financial features ("none"), health ("none"), ads ("no"; no `AD_ID`), government, news | AND | C | BLOCKED — TECHNICAL DEPENDENCY | Drafter C | LR-07b | Draft merged (#507, `play-declarations.md`): financial "none", health "none", ads "no", government and news "no". Entered once the Play app exists. |
| [ ] | LR-09h | Play foreground-service declaration, with a video of a voice call (microphone type) | AND | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer; owner (records) | LR-14, LR-08 | Needs LR-14 merged and a signed build on a phone. |
| [ ] | LR-09i | Play full-screen intent declaration (calling app) | AND | C | BLOCKED — TECHNICAL DEPENDENCY | Drafter C | LR-27 | Draft merged (#507). The declaration is only true once LR-27 (the Android 14+ full-screen-intent check) ships. |
| [ ] | LR-49 | Signed AAB on the Play internal-testing track; pre-launch report reviewed | AND | C | BLOCKED — TECHNICAL DEPENDENCY | Release manager; owner (upload) | LR-01, LR-04, LR-07b, LR-07c, LR-45, LR-47 | Needs LR-07a/b/c, LR-47, LR-45, LR-04, LR-01. The Data safety form is exempt only while the app is on internal testing alone. |
| [ ] | LR-14 | Foreground-service types match Play policy: `microphone` only, no unjustified `phoneCall` | AND | H | READY FOR VERIFICATION | Builder A; lead | LR-08, LR-74 | **#505 merged** as `b05d141a`: `microphone` only, with a guard test. Reviews ACCEPT @ `a59f7d34` and `5cc153fc`; PR CI 30/30; main CI run 42485589672 on `9bb0418d`: 15/15. **Still needed:** a device check (lock the screen mid-call on Android 14+) and LR-74. |
| [ ] | LR-50 | Target API 36, min SDK 26 (Play: API 36 for new apps since 31 Aug 2026) | AND | H | READY FOR VERIFICATION | Release manager | LR-49 | Flutter defaults (`FlutterExtension.kt:23,34`); `minSdk = 26`. Check again on the final AAB (`bundletool dump manifest`). |
| [ ] | LR-51 | 16 KB memory pages (Play: updates without them are blocked from 1 Feb 2027) | AND | H | READY FOR VERIFICATION | Release manager | LR-49 | arm64 WebRTC and Sentry libraries are aligned at 0x4000. Re-check on the final AAB. |
| [ ] | LR-27 | Full-screen call permission checked on Android 14+ (Play: must work when FSI is denied) | AND | M | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | LR-11a (#449 owns the file) | `JawwidPush.kt:141` always sets the intent. #449 edits `JawwidPush.kt`, so this waits for #449. |
| [x] | LR-54 | Minimal Android permissions; no `READ_MEDIA_*`; the system photo picker | AND | M | COMPLETED AND VERIFIED | Android audit; Builder A | — | E-06. Re-check on the final merged manifest at LR-49. |
| [x] | LR-53 | Release signing never falls back to the debug key | AND | H | COMPLETED AND VERIFIED | Android audit | — | E-02 |
| [x] | LR-55 | Only `MainActivity` exported; `allowBackup=false`; no cleartext traffic | AND | H | COMPLETED AND VERIFIED | Android audit | — | E-02 |
| [ ] | LR-69 | Play: 12 testers for 14 days, then apply for production access | AND | — | NOT APPLICABLE — WITH DOCUMENTED REASON | Lead | — | Play answer 14151465 limits the rule to **personal** accounts created after 13 Nov 2023; we use an Organization account (LR-07a). If the Play Console Dashboard shows the testing requirement anyway, this row reopens at once, and it adds at least 14 days plus about 7 days of review. |

### C. The mobile app on both platforms (0 of 9 done, 0 %)

| ✓ | ID | Requirement (policy) | Store | Pri | Status | Owner / agent | Depends on | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-02b | Terms gate and sign-up acceptance in the iOS and Android app | Both | C | READY FOR VERIFICATION | Mobile engineer; QA | LR-02a, LR-08 | #504 merged as `cf731af2` on 2026-11-08 12:27 UTC. Independent review: ACCEPT @ `af1a3e1a`. Main CI: run 42480381161 was cancelled by a newer push; run 42481004529 on `14860ad3` contains it and **passed**. Still needed: a device test against an API with #497. |
| [ ] | LR-12 | Incoming calls ring while the app is closed (S-06) | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner; mobile engineer | LR-47, LR-08 | iOS: PushKit and CallKit are merged but off until `APNS_VOIP_ENABLED=true`. Android: the full-screen ring is merged (#408, #458). Needs LR-47 and the device test. |
| [ ] | LR-21 | Unique, increasing build numbers and a production-only store build | Both | H | READY FOR VERIFICATION | Release manager | LR-48, LR-49 | #502 merged as `14860ad3` on 2026-11-08 by the lead. Review ACCEPT @ `6c4856a7`; 30/30 checks green on the PR head; main CI run 42481004529 on the merge is green. Verify on the first store build of each platform. |
| [ ] | LR-74 | Calls keep the microphone when the screen locks, even on a fresh install. The call service starts only after the microphone is granted, and the caller is asked before dialling (Play FGS rules on Android 14+) | Both | H | READY FOR VERIFICATION | Builder E | LR-08 | **#509 merged** as `481cdef2`; main CI run 42488182440 on `6e0e1438`: 15/15. Reviews ACCEPT @ `d5aea3c2` and `5051ff7e`. **Still needed:** a device check (fresh install, deny then allow the microphone, lock the screen mid-call), in the LR-08 plan. |
| [ ] | LR-25 | Reporting or blocking a staff member behaves honestly | Both | M | IN PROGRESS | Mobile engineer (#503) | #503 | #503 head `e83a6c05`: lead review ACCEPT recorded; 30/30 checks pass after another session's re-run. Merge when the other session finishes with it. |
| [ ] | LR-26 | Microphone denial is recoverable ("Open settings") | Both | M | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | #449, #498, #503 (l10n files) | Needs new strings in the l10n files, which #449, #498 and #503 all edit. Start when they land. |
| [ ] | LR-35 | The picker no longer offers CSV, which the server refuses | Both | L | IN PROGRESS | #503 | #503 | As for LR-25. |
| [ ] | LR-36 | Icons: a non-upscaled 1024 iOS icon and an Android monochrome layer | Both | L | BLOCKED — OWNER ACTION REQUIRED | Owner; mobile engineer | OA-18 | Owner action OA-18 (a vector logo). |
| [ ] | LR-37 | Unused `sqflite` removed | Both | L | IN PROGRESS | #503 | #503 | As for LR-25. |

### D. Shared backend and infrastructure (2 of 18 done, 11 %)

| ✓ | ID | Requirement (policy) | Store | Pri | Status | Owner / agent | Depends on | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-76 | A trusted machine produces the signed store builds (the distribution certificate and the upload key live there) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner | OT-2b (owner decision on the Mac) | **New 2026-11-08.** The owner's rule bars running project code on this Mac until an open security finding (recorded outside this public repository) is settled, so no store build can be made here today. There is no release-build workflow in `.github/workflows/`. Options are compared in `docs/release/signed-build-options.md` (#513, merged) and `signing-on-existing-mac.md` (#514, under review). **Owner answers (OT-2, 2026-11-08):** no separate Mac; the owner is the Apple **Account Holder** on `KX683HAR3Y` and prefers this Mac with proper isolation. The decision waits for the owner's review of the comparison and of #514. Nothing has been created. |
| [ ] | LR-01 | A live production backend for store builds and reviewers (Apple 2.1(a)) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner; Release manager | LR-77 (owner approval to implement), then OT-3 | "Deploy production" has never run, and "Deploy staging" has never succeeded. **Verified 2026-11-08 (names only):** the `production` Environment already holds the deploy token, GHCR pull credentials, `DATABASE_URL`, `REDIS_URL`, storage keys, FCM and APNs keys and a server `SENTRY_DSN` (19 secrets, 12 variables). The domains were chosen on 2026-11-05 (`api.chat.jawwid.com`; repository variables set). `DIGITALOCEAN_APP_ID` is **created by the first deploy** (`first_deploy=true`). `staging` holds only the LiveKit names. **#512** (`first-deploy-readiness-2026-11-08.md`, independent review ACCEPT @ `e36bc8cd`) is the gap list. Production holds every name its deploy needs. A production-first path works today (staging only builds the image). The first run is expected to fail its smoke test until DNS is added, and **it currently fails earlier, at the backup step (LR-77)**. **Done when:** `/health/ready` returns 200 on the production host and a store build signs in. |
| [ ] | LR-77 | The first deploy can back up an empty database (the pre-migration backup must not fail before the `chat` schema exists) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Builder L (backend/infra); owner (merge) | OA-17b (owner merge approval), then the workflow follow-up | **#516** (`e56568c1`), implementation approved by the owner on 2026-11-08. `backup-db.sh` checks whether the schema exists:<br>• absent on a first deploy (`FIRST_DEPLOY` unset, empty or `true`): a loud notice, no file written, exit 0;<br>• absent otherwise: it **fails** (possible wrong `DATABASE_URL`);<br>• present, even empty: dumped exactly as before;<br>• the check fails to connect: the step fails.<br>Reviews: CHANGES @ `69421cca` (scanner-tripping test DSN; wrong-database risk), then ACCEPT @ `e56568c1`. New tests in `test/scripts/backup_db_first_deploy_test.dart`. **Waiting for the owner:** (1) approval to merge (High risk); (2) a two-line, owner-only workflow change that passes `FIRST_DEPLOY` to the backup step (text in the PR body). It must land before any deploy that carries real data. |
| [ ] | LR-02a | Terms gate on the API: no posting before acceptance (Apple 1.2; Play UGC "accept terms before posting") | Both | C | IN PROGRESS | Backend engineer; owner (merge) | OA-17, LR-02d | #497: independent review ACCEPT @ `9536446d` with one P2 (`auth.controller.ts:116-117` rotates the refresh token before `legal.dtoFor()`, so a database error lost the new tokens and the retry signed the user out everywhere). The lead fixed it in `9bc9416e` (dtoFor answers `unavailable` and never throws, with a new unit spec `legal-dto.spec.ts`). Independent review ACCEPT @ `9bc9416e`; CI is running. Next: **owner approves the merge (High: authentication, plus migration `20261107130000_chat_pd058_publish_order.sql`)**. Release order: app gates (done) → terms rows (LR-02d) → API. |
| [ ] | LR-03 | Account deletion starts in the app for every account that can be created, with no "contact us" (Apple 5.1.1(v); Play account deletion) | Both | C | IN PROGRESS | Backend engineer; owner (merge) | OA-17 | #498 head `b11d2e6d`: 30/30 checks pass after another session's re-run. Review ACCEPT with two P2s:<br>• **P2-1:** a failing reminder could block erasures. The fix is uncommitted in `~/dev/jawwid-teacher-deletion`, one file; it needs a regression test.<br>• **P2-2:** the app copy says "deleted now" for a request.<br>Also in the same branch:<br>• `review-cohort.ts` must survive the review teacher's erasure (re-provisioning refuses with `TEACHER_CHANGED`);<br>• `review-accounts.md` must stop saying "takes effect immediately" for teachers.<br>Apple's account-deletion page allows a delayed deletion only when the user is told how long it takes; confirm the wording in the app. **Owner approves the merge (High: deletion).** |
| [ ] | LR-05 | Demo accounts on the live backend that need no WhatsApp code (Apple 2.1(a); Play App access) | Both | C | BLOCKED — TECHNICAL DEPENDENCY | Owner; Release manager | LR-01, OA-21 | `cli/review-cohort.ts` was merged in #490. Needs LR-01, then the owner's domain and two passwords (OA-21). Also needed:<br>• past lessons and reports in the data;<br>• a third, disposable parent for the deletion test;<br>• **something payable**, because #507 found the review accounts have nothing to pay, so a reviewer cannot reach the pay sheet. |
| [ ] | LR-43 | Registration and sign-in work on production: e-mail and password, WhatsApp codes, parent sign-up with terms acceptance | Both | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer | LR-01 | Needs LR-01. G-38 end-to-end smoke passes in CI (main run on `496560a3`), but CI is not production. Done when the device plan rows for sign-up and sign-in pass on production. |
| [ ] | LR-45 | Sentry DSN for the app (store builds refuse to build without it since #502), plus a token for symbol upload | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-05 | The server `SENTRY_DSN` is in the `production` Environment (name verified 2026-11-08). The **app** DSN for store builds (`build-store.sh` requires an https `SENTRY_DSN`, #502) and a symbol-upload token are still needed; it may be the same Sentry project. Owner action OA-05. |
| [ ] | LR-47 | Firebase project and `google-services.json` for the release build; APNs key configured for push | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-04 | **Server side exists:** `FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID` and the APNs key are in the `production` Environment (names verified 2026-11-08), so a Firebase project exists. **App side missing:** the `google-services.json` for the final package in the release build (CI: "release refuses without Firebase"). Owner action OA-04. |
| [ ] | LR-02c | Terms gate in Admin Web (staff accept before acting) | — | H | READY FOR VERIFICATION | Frontend engineer | LR-02a | #500 merged as `496560a3`. Review: ACCEPT @ `34474f6f`; main CI run 42465970426 is green. It does nothing until the API sends a `legal` block (#497, LR-02a): with today's API there is no gate. Verify against an API that has #497. |
| [ ] | LR-11a | A push notification opens its item: parent feedback replies (PD-32) | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner (merge) | OA-17 | #449 head `c205aba0`: 30/30 checks pass. Independent review ACCEPT with no P1 or P2 (not yet posted). It contains migration `20261107150000`, so **the owner must approve the merge (High: migration)**. Owner action OA-17. |
| [ ] | LR-11b | Notification taps open the item, the permission is explained first, and pushes go only to the signed-in account (gates S-11, S-12, S-15) | Both | H | BLOCKED — OWNER ACTION REQUIRED | Mobile and backend engineers | OA-17 | The code exists only in the uncommitted `~/dev/jawwid-push-acceptance` tree (50 files; preserved, never edited). Porting it as a patch onto a new branch changes who receives pushes and re-claims a migration slot, so **the owner must approve implementation (High)**. Owner action OA-17. |
| [ ] | LR-19 | Production backups run and a restore drill passes | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner; release manager | OA-07 | The daily backup failed again on 11-08 07:59 UTC, and so did the weekly one on 11-08 09:01 UTC. The `backup` Environment has no credentials. Owner action OA-07. |
| [ ] | LR-65 | Parent deletion in the app, plus a bilingual public deletion page that works without the app | Both | H | READY FOR VERIFICATION | Accounts audit | LR-01, LR-09b | `settings_screen.dart:279`; `account-deletion.controller.ts`. The page must be reachable on the production host (LR-01) and named in the console (LR-09b). |
| [ ] | LR-29 | Uptime monitoring and someone on call | Both | M | BLOCKED — OWNER ACTION REQUIRED | Owner; release manager | LR-01, OA-19 | Owner action OA-19 (name a person). Needs LR-01. |
| [ ] | LR-31 | The closed-account state the policies promise (P-6) | Both | M | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | OA-15 | An erased e-mail can sign up again. Either build it (High: account security) or have counsel soften the wording. Owner action OA-15. |
| [x] | LR-32 | `LIVEKIT_URL` must be `wss://` in production | Both | M | COMPLETED AND VERIFIED | Builder B; lead | — | E-05 |
| [x] | LR-38 | RT-017/018: invalid `before`/`after` return 400, not 500 | Both | L | COMPLETED AND VERIFIED | Builder B | — | E-05 |

### E. Security and QA (8 of 19 done, 42 %)

| ✓ | ID | Requirement (policy) | Store | Pri | Status | Owner / agent | Depends on | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-08 | The app works on real phones from signed builds against production (Apple 2.1; Play pre-launch) | Both | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer and owner (phones) | LR-01, LR-06, LR-07b, LR-07c, LR-47, OA-20 | `submission-device-test-plan.md` (about 40 SB rows) has **never been run**. The 2026-11-02 iPhone checklist (`release-gate.md` §1) also left 22 of 24 rows untested. Needs LR-01, LR-06, LR-07, LR-47. Owner action OA-20. |
| [ ] | LR-18 | Media and evidence access verified on the real deployment (RT-037, RT-038) | Both | H | BLOCKED — TECHNICAL DEPENDENCY | Security reviewer; QA | LR-01 | Needs LR-01. Test plan: `docs/qa/RT-037-STAGING-REAL-MEDIA-TEST.md`. |
| [ ] | LR-22 | Crash reports are symbolicated | Both | H | READY FOR VERIFICATION | Release manager | LR-45 | #502 keeps the symbols (`--split-debug-info`); the upload is a documented `sentry-cli` step with the owner's token. Done when a forced test crash shows a symbolicated trace. |
| [ ] | LR-46 | Final security sign-off on the release-candidate SHA | Both | H | NOT STARTED | Security reviewer (Fable 5.1) | LR-08 | Runs in Phase 3 on the merged release candidate. |
| [ ] | LR-63 | Signed, re-authorized media links; webhook signatures verified | Both | H | READY FOR VERIFICATION | Security audit | LR-18 | `media-url.ts:81-135`; `stripe-webhook.controller.ts:52-60`. Verified in code; it still needs the real-deployment test (LR-18). |
| [ ] | LR-78 | The optional CI job "Android killed-app ring" is reliable: it fails only when the ring is really broken | AND | M | IN PROGRESS | Agent M (QA + mobile) | #517 review, then owner Code Owner approval | **Root cause found (agent M, 2026-11-08):** the app does post the ring, but Android 14's NotificationService silently drops a CallStyle notification when system_server's cached ApplicationInfo for the app is stale. The log shows "Cannot fix notification" with a SecurityException, on the first attempt of runs 42414696184, 42483333513, 42491644506 and 42494983644. **#517** (`f568cbbb`): the test re-pushes only on that exact drop, at most 3 pushes, and every other check is unchanged. `scripts/qa/` is a Code Owner path, so **the owner must approve the merge**. An independent review is running. |
| [ ] | LR-79 | The first incoming-call ring is not lost when Android drops a CallStyle notification (app-side check that the ring is active, re-posting once) | AND | H | BLOCKED — TECHNICAL DEPENDENCY | Mobile engineer | #449 (owns `JawwidPush.kt`) | Found by the LR-78 diagnosis. The same Android 14 system drop may hit real phones, for example right after an app update, so the first ring would be lost while the app believes it posted. **Unconfirmed on a phone.** Fix in `JawwidPush.notify` once #449 merges; add a device-plan row. |
| [ ] | LR-28 | Defects a reviewer could see are closed (TEACHER-020, PARENT-016, PARENT-024, P2 retests) | Both | M | NOT STARTED | QA engineer | LR-08 | TEACHER-020 (#491) needs an iPhone check. PARENT-016 and PARENT-024 have no write-up. |
| [ ] | LR-30 | The release documents tell the truth | — | M | IN PROGRESS | Lead | #501 (OA-16) | **#510 merged** as `5ed73ce6`: `production-readiness.md` (environment counts, deploy and backup history), `findings.md` (RT-006/012/016/022 fixed with evidence; RT-021 remainder), the red-team handoff and `API-CONTRACT.md`. Reviews ACCEPT @ `89d3196c`. Still open: `docs/qa/release-gate.md` S-11/S-12/S-15 "PASS" (fixed in #501, which waits for OA-16). |
| [ ] | LR-33 | Staff permission guard enforced (`shadow` → `enforce`) | — | M | BLOCKED — TECHNICAL DEPENDENCY | Backend engineer; security reviewer | LR-01, owner (High) | Needs real shadow-denial logs (LR-01). It is authorization, so High risk: the owner approves the switch. |
| [ ] | LR-44 | Connection recovery: realtime resumes after a server restart or network loss (PARENT-015) | Both | M | BLOCKED — TECHNICAL DEPENDENCY | QA engineer | LR-08 | The 2026-10-31 QA showed the app needed a relaunch after an API restart. Whether it is fixed on `main` is not verified. It is a device-plan row (LR-08). |
| [x] | LR-75 | The app log masks opaque `authToken`, `idToken` and `jwt` values (remainder of RT-021) | Both | L | COMPLETED AND VERIFIED | Builder G; lead | — | E-07 |
| [x] | LR-42 | The app log redacts e-mail addresses and one-time codes (RT-021) | Both | L | COMPLETED AND VERIFIED | Builder A | — | E-06. The scope is e-mail and OTP. Opaque `authToken`, `idToken` and `jwt` values are LR-75. |
| [x] | LR-60 | No secrets in the repository or in the binary's build defines | Both | H | COMPLETED AND VERIFIED | Security audit | — | E-02 |
| [x] | LR-61 | Tokens in Keychain or Keystore; local data cleared at sign-out | Both | H | COMPLETED AND VERIFIED | Security audit | — | E-02 |
| [x] | LR-62 | Authentication on every API route by default; every public route justified | Both | H | COMPLETED AND VERIFIED | Security audit | — | E-02 |
| [x] | LR-64 | Report a message or a person; blocking enforced on the server (Apple 1.2; Play UGC) | Both | H | COMPLETED AND VERIFIED | PD-57 builders | — | E-03 |
| [x] | LR-59 | No ads, analytics, attribution or tracking SDK; no ATT prompt needed | Both | M | COMPLETED AND VERIFIED | Security audit | — | E-02 |
| [x] | LR-67 | Release builds cannot run on fixture data | Both | M | COMPLETED AND VERIFIED | Security audit | — | E-02 |

### F. Legal and compliance (1 of 14 done, 7 %)

| ✓ | ID | Requirement (policy) | Store | Pri | Status | Owner / agent | Depends on | Evidence and next step |
|---|---|---|---|---|---|---|---|---|
| [ ] | LR-02d | Final Terms of Use and Code of Conduct texts and versions loaded as terms rows (N-3) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | OA-09 | Without the rows, the gate has nothing to show. Owner action OA-09. |
| [ ] | LR-04 | Public Privacy Policy, Terms, support page and deletion page in Arabic and English, with no placeholders (Apple 5.1.1(i) and the Support URL; Play privacy policy and the deletion web link) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel; Release manager | OA-08 | `docs/legal/*` drafts still contain `{{ENTITY_NAME}}` and other placeholders. `build-store.sh` refuses to build without `API_BASE_URL`, `PRIVACY_POLICY_URL`, `TERMS_URL` and `SUPPORT_URL`. The deletion page is required by the stores, not by the script. Owner action OA-08. |
| [ ] | LR-09f | Review notes and App access instructions (two demo accounts; the deletion path; staff screens described per Apple 2.5.19) | Both | C | BLOCKED — TECHNICAL DEPENDENCY | Drafter C | LR-05 | Draft merged (#507, `play-declarations.md` App access, plus the review-notes template). Credentials come from LR-05. The review data must include something payable. |
| [ ] | LR-09j | Screenshots: iPhone (1179×2556 or 1206×2622); iPad only if the app runs on iPad; Play phone 2–8, plus a 1024×500 feature graphic | Both | C | BLOCKED — TECHNICAL DEPENDENCY | QA engineer; store compliance | LR-05, LR-10 | Needs a production build with review data (LR-05). No child imagery (LR-10). Confirm whether the iOS target includes iPad. |
| [ ] | LR-09k | Listing copy in Arabic and English (name ≤ 30 characters, subtitle or short description, description, keywords, what's new) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Drafter C, then owner approves | OA-11 | Draft merged (#507, `listing-copy.md`): Arabic first, no "subscription" wording, no child imagery. **App Store Connect facts (owner-reported 2026-11-08):** the record's name is "Jawwid" (the draft proposed "Jawwid: Quran Academy"; Apple lets the name change until submission), and the **primary language is English (U.S.)**. Apple: the primary language "can be changed at any time", but only to a language already approved in a previous version. **Lead decision:** keep English as primary for version 1 and **add an Arabic localization** (name, subtitle, description, keywords, screenshots), so Arabic-language users see Arabic. Consider switching the primary to Arabic in a later update. No action needed now. |
| [ ] | LR-10 | Target audience decided (Play target audience and Families; Apple 1.3 and 5.1.4) | Both | C | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | OA-11 | Children never sign in (`user_role.dart:9-21`), but parents open child-designed content. Choosing any child age band brings in the Families policy. Recommendation: account holders 18+, not the Kids category, no child imagery. Owner action OA-11. |
| [ ] | LR-72 | The owner's final approval to submit, per store | Both | C | BLOCKED — TECHNICAL DEPENDENCY | Owner | LR-71, OA-23 | Never automatic. It comes after LR-71 (OA-23). |
| [ ] | LR-15 | Payments presented within Apple 3.1.3(d) (one-to-one real-time services) and Play's billing exemption (a 1:1 live class) | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner; store compliance | OA-12 | Open risks:<br>• "Subscriptions" and «الاشتراكات» may read as 3.1.2 subscriptions;<br>• a family lesson call can seat siblings, which is one-to-few and would need in-app purchase;<br>• Play's anti-steering rule versus the in-app Stripe link (§7).<br>Owner action OA-12. |
| [ ] | LR-16 | Objectionable-content filter and moderation copy approved (Apple 1.2, which now also covers nonconsensual intimate imagery; Play UGC) | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-13 | The #493 filter is live in code. The word list (18 Arabic, 19 English words) is still a draft, and so are the report reasons and the conduct warning. Owner action OA-13. |
| [ ] | LR-17 | Storefronts: US age-assurance laws, EU trader status (Apple and, from Nov 2026, Play), China | Both | H | BLOCKED — OWNER ACTION REQUIRED | Owner and counsel | OA-10 | Texas SB 2420 has been in force since 4 Jun 2026 (Declared Age Range API), with Utah and Louisiana also active. A trader declaration is needed even without EU distribution on Apple. Recommendation: the academy's markets first; no China; the US only after age assurance. Owner action OA-10. |
| [ ] | LR-71 | Final compliance audit of every console answer against the code and this file | Both | H | NOT STARTED | Store compliance (Fable 5.1) | LR-09a–k | Last step before the owner's go. |
| [ ] | LR-23 | App Privacy label and Data safety match the code and SDKs (Firebase Installations id, Sentry diagnostics, purchase history, CoarseLocation) | Both | M | READY FOR VERIFICATION | Drafter C | LR-48 | **#507 merged** as `9bb0418d`: answers drafted from the code (`docs/release/store-console/`). Keep Coarse Location; declare Purchase History; the teacher profile is declared as Play "Other info". The manifest matches (#508). Final proof: Xcode's privacy report on the archive. |
| [ ] | LR-34 | Live card payments at launch decided, and the review notes match the screen | Both | M | BLOCKED — OWNER ACTION REQUIRED | Owner | OA-12 | Without `STRIPE_*` in production, the pay sheet offers bank transfer only. Owner action OA-12. |
| [x] | LR-68 | No digital content or feature unlocked by payment; chat is never locked (Apple 3.1.1 does not apply) | Both | H | COMPLETED AND VERIFIED | Payments audit | — | E-04 |


## 5. Owner Action Center

**Deadlines** are for the earliest submission date (Fri 13 Nov). Each one-day slip moves submission by about a day.
Questions go to the owner one at a time, in this order.

### Credentials and developer accounts

| # | What we need from you | Why | Store / feature | Deadline | What it blocks |
|---|---|---|---|---|---|
| ~~OA-02~~ | **Answered 2026-11-08: yes, Jawwid has a Play Organization account.** | — | Google Play | Done | — |
| OA-01 | In the existing Apple Developer account (confirmed 2026-11-08): create the Apple Distribution certificate, the App Store provisioning profile with Push for `com.jawwid.jawwidChat`, and the App Store Connect app record | Only the Account Holder or an Admin can do it | App Store | Mon 9 Nov 12:00 | LR-06, LR-48, LR-57b |
| OA-03 | Confirm the final Android package name (recommended: keep `com.jawwid.jawwid_chat`) and create the upload keystore you keep safe | The package name is permanent after the first upload | Google Play | Mon 9 Nov 12:00 | LR-07b, LR-07c, LR-49 |
| OA-04 | The Firebase project for Jawwid Chat: the `google-services.json` for the final package, and the APNs key confirmed | A release Android build refuses to build without it; push and calls need it | Both | Mon 9 Nov 12:00 | LR-47, LR-12, LR-49 |
| OA-05 | A Sentry project DSN for the app, and a token for symbol upload | Store builds refuse to build without the DSN (#502) | Both | Mon 9 Nov 12:00 | LR-45, LR-22, LR-48, LR-49 |
| OA-06 | ~~The DigitalOcean app id and the domain~~ **Corrected 2026-11-08:** the first deploy creates the app id (`first_deploy=true`), and the domain was chosen on 2026-11-05 (`chat.jawwid.com`). What remains is in Builder H's gap list and OT-3. | — | Both | — | — |
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
| OA-17 | High-risk approvals:<br>• merge **#449** (it adds a migration);<br>• merge **#497** (authentication; adds migration `20261107130000`) and **#498** (deletion; adds migration `20261107140000`) after their P2 fixes;<br>• **approve implementation** of the push port (LR-11b) | Approve | Mon 9 Nov | LR-11a, LR-11b, LR-13, LR-27, LR-02a, LR-03 |
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

## 6. Evidence log (COMPLETED AND VERIFIED rows)

| # | Rows | Date | Agent | PR / commit | CI | Independent review | Device / integration | Policy source |
|---|---|---|---|---|---|---|---|---|
| E-02 | LR-53, 55, 56, 57, 59, 60, 61, 62, 67 | 2026-11-08 | Eight read-only audits (iOS, Android, security); the lead spot-checked | Code on `main` @ `cebbcd99`; the file:line references are in #501's audit; unchanged by #500, #502 and #504 | Main CI run 42417856955: 15/15 jobs | #501's independent reviewer confirmed 28 load-bearing claims against `cebbcd99` | Static facts; no device needed | Apple export compliance; Apple 5.1.2; Play permissions policy (answer 9888170) |
| E-03 | LR-64 | 2026-11-08 | PD-57 builders; audited 11-08 | PD-57 PRs #463–#482, all on `main` | Integration specs `platform/blocks` and moderation; main CI run 42417856955 on `cebbcd99`: success, 15/15 jobs | PD-57 reviews; confirmed again by the #501 audit | Server-side, so no device needed; the in-app sheet is also covered by LR-25 | Apple 1.2; Play UGC (answer 9876937) |
| E-04 | LR-68 | 2026-11-08 | Payments audit | `conversation.controller.ts:237-250` on `cebbcd99` | Main CI run 42417856955: success | #501 reviewer | n/a | Apple 3.1.1 and 3.1.3(d) |
| E-05 | LR-32, LR-38 | 2026-11-08 | Builder B (backend); lead (scanner fix) | #506, merge `8e26b0dc5e65cb21a41c418ae278937462bd486b` (head `2100b65b`) | PR CI 30/30; main CI run 42485589672 on `9bb0418d`: 15/15 success | `Review: ACCEPT @ 4c404750…` and the delta `Review: ACCEPT @ 2100b65b9730f76e4ef78ff0033601d06c6534d4` on #506 (fresh reviewer sessions) | Server-side, unit and integration specs; no device needed | Apple 5.1.2 / Play data in transit encrypted (LR-32); stability (LR-38) |
| E-06 | LR-42, LR-54 | 2026-11-08 | Builder A (mobile); lead (guard test) | #505, merge `b05d141a82b89d080e012b34d34ede3c1cc23596` (head `5cc153fc`) | PR CI 30/30; main CI run 42485589672: 15/15 success | `Review: ACCEPT @ a59f7d34…` and the delta `Review: ACCEPT @ 5cc153fc488373e484439b9e4dd04eaf8fcb92bb` on #505 | Unit tests (logger); manifest guard test. No device needed for these two rows | Play permissions policy (answer 9888170); Apple 5.1.2 |
| E-07 | LR-75 | 2026-11-08 | Builder G (mobile); lead (review fixes) | #511, merge `6e0e1438bfd9d2879b91a527f480b569856e68f3` (head `4fe2417c`) | PR CI 30/30; main CI run 42488182440 on `6e0e1438`: 15/15 success | `Review: ACCEPT @ 435f5f2f…` and the delta `Review: ACCEPT @ 4fe2417c690de9e5ccaceadb11c1b5cc40149691` on #511 | Unit tests in `redacting_logger_test.dart`; no device needed | Apple 5.1.2 / red-team RT-021 |
| E-08 | LR-06 (record part only; the row stays open) | 2026-11-08 | Owner, with the owner-task assistant; verified by the lead | n/a (Apple consoles) | n/a | The lead viewed both screenshots | `~/jawwid-owner-evidence/OT-1/1-app-id.png` (App ID, Push enabled, Certificates (0)), `2-app-record.png` (App Information), `REPORT.md`. **Gaps, stated explicitly:** the full capability list is not captured (the screenshot is filtered to Push Notifications); User Access = Full Access is not evidenced; "no changes saved" is the owner's statement; that the App ID already existed is inferred from its Xcode-style description | Apple App Store Connect help: create an app record; register an App ID |

## 7. Official sources (checked live on 2026-11-08)

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

## 8. Phase plan and parallel work

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

## 9. How this tracker works

**Statuses (exactly one per row):**
- NOT STARTED;
- IN PROGRESS;
- BLOCKED — OWNER ACTION REQUIRED;
- BLOCKED — TECHNICAL DEPENDENCY;
- READY FOR VERIFICATION, meaning it is built, but the evidence a store needs (a release artifact, a device or the real deployment) is still missing;
- COMPLETED AND VERIFIED;
- NOT APPLICABLE — WITH DOCUMENTED REASON.

**Checkboxes.** `[x]` only for COMPLETED AND VERIFIED, with an evidence-log entry in §6. A build, a passing unit test or an agent's statement is never enough on its own.

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
