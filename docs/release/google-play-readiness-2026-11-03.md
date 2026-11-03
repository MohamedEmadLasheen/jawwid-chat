# Google Play pre-launch review (2026-11-03)

Branch `claude/google-play-readiness`, from `main` @ `3d669299`. This review covers Google Play
only. It builds on the two-store review in draft PR #447 (`docs/release/store-readiness-2026-11-03.md`
and `docs/qa/release-gate.md` §2a and §2c on that branch). It does not repeat that review's
evidence. It adds what Google Play asks for and Apple does not, and it corrects two points where
Play is stricter than that review assumed.

It also takes into account the Android push work still in progress (PD-32 amendment, not yet
committed): `JawwidMessagingService`, `PushPresenter`, the `POST_NOTIFICATIONS` request at session
start, and `firebase-messaging`.

**Verdict: NOT ready to submit to Google Play.** Five items would cause a rejection or a policy
strike (§1). Two more make the app plainly broken on a reviewer's or a tester's phone (§2). No one
can promise "no rejection" for a first submission. Play's review is partly manual. But every known
cause of rejection is listed below, with the fix and who owns it.

Policy sources (read 2026-11-03):
- [Target API level](https://developer.android.com/google/play/requirements/target-sdk)
- [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) and its
  [explainer](https://support.google.com/googleplay/android-developer/answer/10281818)
- [User-generated content](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)

## 1. Would cause a rejection or a policy strike

| # | Issue | Why Play rejects it | Fix | Owner |
|---|---|---|---|---|
| P-1 | **No way to report a message, a story, or a user** (S-09) | The UGC policy says even a closed app for "a specified set of users" (a school, a company) needs in-app reporting of content **and** users. | A "Report" action on messages, stories and people; a report table and endpoint; an Admin Web queue; an answer to the reporter. | O-1, then engineering |
| P-2 | **No way to block a user** | The UGC policy requires blocking for **any 1:1 interaction**, such as direct messages. Chat has 1:1 conversations. The argument in PR #447 ("users cannot choose who they talk to, so blocking is unnecessary") may work for Apple's review notes. Play's policy has no such exception. | Owner, choose one: (a) "Block" in a 1:1 conversation, hiding that person's messages to the blocker and alerting staff; or (b) limit 1:1 chat to staff and the assigned teacher, then argue the exception in the review notes. (a) is the safe one. | O-1 (new part) |
| P-3 | **Nobody accepts the terms before posting** | The UGC policy says users must "accept the app's terms of use and/or user policy before users can create or upload UGC", and the terms must define and forbid objectionable content. Today the terms and privacy links are shown on sign-in, sign-up and Settings (`lib/core/legal/legal_links.dart`), but nothing records acceptance. Staff-created accounts (teachers, families entered by the academy) never see sign-up at all. | A one-time "I agree to the Terms of use" step on first sign-in, recorded on the server (date and terms version). The owner's terms must include a conduct section. | Owner (text), engineering (gate) |
| P-4 | **Card payment by Stripe for services that may not be exempt** (S-10) | Play has **no** general exemption for education. Its explainer exempts a 1:1 service only when "the paid service is between two individuals" and "is not available for replay afterwards", for example music lessons. Group classes (Student Groups), recorded lessons, materials and lesson reports may count as digital content. If so they need Play Billing, and a "Pay by card" link out is also forbidden steering (§4: "In-app ... buttons, links ... other calls to action"). | Owner, choose one: (a) the Android build shows no payment UI at all: no Pay sheet, no price, no link (consumption-only; families pay on the web or by bank transfer); or (b) state in writing that every paid item is a live 1:1 lesson that is not recorded. (a) also removes the App Store 3.1 risk. | O-2 |
| P-5 | **The reviewer cannot sign in** (S-08, PR #447 item 4) | "App access" must give working credentials. Sign-up needs a code a supervisor sends on WhatsApp. App lock would also block the pre-launch report's robot. | A production backend; two demo accounts (parent with a learner, teacher) with app lock off; the same credentials in Play Console → App content → App access **and** → Testing → Pre-launch report → Credentials. | Owner (S-08), then QA |

## 2. The app is visibly broken on Android

| # | Issue | Evidence | Fix |
|---|---|---|---|
| P-6 | **A call goes silent when the screen locks or the user leaves the app.** | CODE. No foreground service exists. Neither the app's manifest nor `livekit_client` 2.13 / `flutter_webrtc` 1.6.2 declares `FOREGROUND_SERVICE` or a service. Android 11+ gives a background app silence from the microphone unless it runs a foreground service of type `microphone`, started while the app is visible. A teacher who locks the phone mid-lesson is heard as silence. Not yet run on a device. | A foreground service started when a call connects and stopped when it ends: type `microphone` (and `phoneCall` if the full-screen ringer is built), with an ongoing "Call in progress" notification. This adds `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE`, and the **Foreground service declaration in Play Console, which needs a short video** of the feature. Sequence it after the PD-32 amendment merges, because both change `MainActivity.kt` and the manifest. DEVICE test: lock the screen during a call, both directions. |
| P-7 | **Notifications and calls while closed** (S-05, S-06, S-13) | The PD-32 amendment (in progress) adds FCM, drawing data pushes, the permission request and notification taps. It needs the owner's Firebase project (`google-services.json`). Without it the build compiles and shows nothing. An incoming call while the app is closed still has no ringer on Android. | Finish PD-32; the owner creates the Firebase project. For the ringer: a call-style notification. If it uses a **full-screen intent**, Android 14+ grants `USE_FULL_SCREEN_INTENT` only to apps whose core function is calling or alarms, and Play Console asks for a declaration. A high-priority call-style notification **without** a full-screen intent avoids that declaration, at the cost of no ringing over the lock screen. |

## 3. Owner decisions that only the owner can make

| # | Decision | Recommendation |
|---|---|---|
| D-1 | **Package name.** `applicationId = "com.jawwid.jawwid_chat"`. It is **permanent** after the first upload and cannot be changed. iOS is `com.jawwid.jawwidChat`. | Keep it unless the owner wants a different public id (for example `com.jawwid.app`). If it changes, it must change **before** the first upload. The Firebase project must use the same id. |
| D-2 | **Developer account type.** A *personal* account created after 13 Nov 2023 needs a closed test with **at least 12 testers opted in for 14 days in a row** before it can even apply for production. Google can still refuse, and the 14 days restart. | An **organization** account in the academy's name, verified with a D-U-N-S number. It skips the 12-tester rule, and the listing shows the academy as the developer. If the account is already personal, start the closed test now with real families and teachers. It adds at least two weeks. |
| D-3 | **Target audience and the Families policy.** Accounts belong to parents and teachers. But children (from age 3, PD-49) use the whiteboard, stickers and reward sounds (PD-55) on the parent's phone during lessons. If the listing, screenshots or icon appeal to children, Google can treat the app as child-directed. The Families policy then applies, and a mismatch is a policy strike. | Declare **18+** (the account holder). Screenshots show the parent's and teacher's screens, not the kid tools. The listing says it is for families and teachers of the academy. If the owner wants children counted as users, choose "mixed audience". That brings the Families policy: Sentry and FCM must send no persistent device identifiers for children, and a neutral age screen. That is a separate project. |
| D-4 | **Store listing content** in Arabic (default) and English: title (30 characters), short description (80), full description (4,000), 512×512 icon, 1024×500 feature graphic, at least 2 phone screenshots. None of it exists in the repository. | No "#1", "best", prices, or Quran-content claims that have not been reviewed. Religious wording goes through the owner's reviewer. |

## 4. Play Console forms (owner fills; the answers are prepared here)

**Data safety.** Collected, all *linked to the user*, *for app functionality*, *not shared*, *encrypted in transit*, *deletion can be requested*:
- Personal info: name, e-mail address. Phone number: not entered in the app (the academy holds it), so it is not "collected by the app". Declaring it anyway is the conservative choice.
- Photos and videos; audio (voice notes, calls); files and docs (attachments); other user content (messages, stories, feedback).
- App activity: in-app actions (lesson and reward records).
- App info and performance: **crash logs and diagnostics** (Sentry, when `SENTRY_DSN` is set).
- Device or other IDs: the FCM token and the device record (`devices` table).
- Location: none from GPS. The parent's country and province, entered in the registration form (PD-45), are **Personal info → Address**. The time zone is a setting, not location.
- Data deletion: the in-app path (Settings → Delete account) and the web URL `/account-deletion` on the **production** API domain. The URL must answer publicly before the form is submitted.

**Other declarations:**
- Ads: **No**.
- Advertising ID: **No**. Check this: after the PD-32 amendment, the merged release manifest must not contain `com.google.android.gms.permission.AD_ID`. `firebase-messaging` alone should not add it. If it appears, remove it with `tools:node="remove"`.
- Content rating (IARC): users interact (chat, calls), users share photos and video, no location sharing, no purchases of digital goods if P-4's option (a) is chosen.
- News app: no. Health: no. Financial features: no. Government: no.
- Foreground service declaration: only once P-6 ships (microphone, with the video).
- Full-screen intent: only if P-7's ringer uses one.
- Privacy policy URL: the same owner URL as `PRIVACY_POLICY_URL`. It must name the developer, list the data in this section, and explain deletion.

## 5. What already meets Play's requirements

From PR #447's VERIFIED evidence, re-checked where noted:

| Requirement | State |
|---|---|
| Target API ≥ 36 for new apps from 31 Aug 2026 | Target 36, compile 36: Flutter 3.47.2's `FlutterExtension.kt`, re-read 2026-11-03. `minSdk = 26`. |
| AAB, signed with an upload key, never the debug key | The build refuses without `key.properties` (`android/app/build.gradle.kts`). The owner's real upload key has not been tried. Play App Signing on. Keep the upload keystore and its passwords in two safe places. |
| 16 KB page-size alignment | VERIFIED in #447 (all LOAD segments). Re-check after `firebase-messaging` is added (it ships no native code, so no change is expected). |
| Photo and video permissions policy | No `READ_MEDIA_*` or storage permission. `image_picker` uses the system photo picker. |
| No restricted permissions | No SMS, call log, location, `QUERY_ALL_PACKAGES`, accessibility or exact alarm. |
| Account deletion, in the app and on the web | S-01 PASS, with one risk: `TEACHER_DELETION_BLOCKED` (O-3). Play accepts deletion that is *requested* and completed within a stated time, so O-3 is more an Apple risk than a Play one. |
| Cleartext traffic | Off. Target 28+ defaults it off, there is no network-security config, and `build-store.sh` requires `https`. |
| Exported components | `MainActivity` (launcher) only. The PD-32 messaging service is `exported="false"`. |
| Backup | `allowBackup="false"` (in PR #447). |
| Notification permission asked in context | At session start, never at launch (PD-32 amendment, in progress). |
| Size | ~99 MB AAB; Play's limit is 200 MB per download. |

## 6. Before pressing "Send for review"

1. Merge #447 and the PD-32 amendment. Build with `scripts/mobile/build-store.sh android` and the owner's key, Firebase and Sentry.
2. Dump the merged release manifest and check: no `AD_ID`, no storage or media permission, and the expected FGS permissions once P-6 ships.
3. Upload to **internal testing** first. Read the pre-launch report: crashes, accessibility, and the robot reaching past sign-in with the demo credentials.
4. Run the DEVICE rows in `docs/qa/submission-device-test-plan.md` on Android 13, 14 and 15 or 16 (one low-end phone): notifications in all three states, calls with the screen locked, and permission denial paths.
5. Closed testing if the account is personal (D-2): 12 testers or more, 14 days.
6. Production with a **staged rollout** (for example 10%), with crash-free sessions watched in Sentry and Play vitals.
7. `versionCode` must go up with every upload (`pubspec.yaml` `version: 0.1.0+1` → `+2`, …).

## 7. What this review did and did not do

- Read: the Android manifest, Gradle files, `pubspec.yaml`, the plugin manifests in the pub cache, the iOS privacy manifest (for the shared data list), the legal-link and account-deletion code, the release gate, PR #447's report, and the uncommitted PD-32 diff (read only, not changed).
- Read Google's policy pages above on 2026-11-03.
- **Not run:** no build, test or device run. The Mac's load average was 227 (AGENTS.md machine-load rule), and this change is documentation only. The merged-manifest check in §6 step 2 and the device check for P-6 still need to be done.
