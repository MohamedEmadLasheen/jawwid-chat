# Google Play Data safety: answers for Play Console

**Launch items LR-09, LR-23 and LR-71. Draft, 2026-11-08; re-verified 2026-11-09.** Pinned to `main` @
`bc47d376`: the answers were audited against that commit in the LR-71 dry run, after the `wss://` fix
LR-32 (#506), and every passage changed in the re-check was verified directly in the code. Paths are
relative to the repository root, cited as `file:line`. The evidence for each data type is the same as in `apple-app-privacy.md` §3; this file repeats the key lines and adds what is Android-only.

**LR-71 pre-audit fixes, 2026-11-10:** re-checked against the launch candidate
`claude/merge-rehearsal-3-2026-11-10` @ `0aec87f1`, which this file now describes (it is merged after the launch
PRs). Changed: Sentry session tracking is off (#526; §2, §2.2, §6 O-5); teacher deletion is a 30-day request
(#498; §3.2, §5); the child's name no longer goes to Stripe (#580; §4, §6 O-6); and the drifted
`crash_reporting.dart`, `AndroidManifest.xml` and `pubspec.yaml` citations. Those citations are **lines as of
the launch candidate**; every other citation is still as of `bc47d376`.

**Where it goes:** Play Console → the app → **Policy and programs → App content → Data safety**.

**Re-read before submitting.** Google's live help page could not be read from this machine when this was
drafted. The form's wording below follows the Data safety form as documented in the repository's earlier
research (`docs/legal/app-store-compliance-checklist.md` §2–§5). Re-read
<https://support.google.com/googleplay/android-developer/answer/10787469> on the day and match each answer
to the live question.

**Definitions that decide the answers**
- **Collected:** the data leaves the device to Jawwid or a third party. Data processed only in memory
  for the live request can be marked **ephemeral**.
- **Shared:** sent to a third party. Sending to a **service provider** that processes it on Jawwid's
  behalf (DigitalOcean, LiveKit, Sentry, Firebase Cloud Messaging, Apple, the e-mail provider, Stripe for
  the payment) is **not** sharing under Google's definition. So the answer is "not shared" for every type
  (§4 records the closed Stripe question).
- **Optional:** the person can use the app without giving it.
- `[OWNER DECISION: ...]` marks an answer that waits for the owner or counsel. **OPEN** marks the same
  thing in the open-items list (§6), with the decision id. An OPEN answer stays as drafted until that
  decision is made.

---

## 1. Overview questions

| Question | Answer | Evidence |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | §2 |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | §3.1 |
| Which of the following methods of account creation does your app support? | **Username and password** (a parent's e-mail, activated by a one-time code); other accounts are created by the academy and signed into with e-mail and password. No OAuth, no social login | `lib/core/data/http/http_parent_signup_repository.dart:18`, `:49-50`; `lib/core/data/http/http_auth_repository.dart:81-84` |
| Do you provide a way for users to request that their data is deleted? | **Yes** | §3.2 |
| Delete account URL | `{{ACCOUNT_DELETION_URL}}` (the public `/account-deletion` page) | §3.2 |
| Does your app's data handling follow the Families Policy? (asked only if the target audience includes children) | Not asked if the audience is 18+ `[OWNER DECISION: target audience N-1/LD-5; see play-declarations.md §1]` **OPEN (§6)** | — |
| Has your app been independently validated against a global security standard (MASA)? | **No** | No validation has been done |

## 2. Data types

Every row: **Shared = No**, **purposes never include Advertising or marketing or Personalization**.

| Google category | Data type | Collected | Ephemeral | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|---|
| Location | Approximate location | Yes | No | **Optional** (the parent can choose "Later"; the time zone can be set by hand) | App functionality | Country and region the parent picks (`lib/shared/location/location_repository.dart:45-48`, `:57`; `lib/app/shells/app_shell.dart:162`); the phone's time zone (`lib/core/time/time_zone_api.dart:52-53`, `:81`; `lib/core/time/time_zone_controller.dart:112`) |
| Location | Precise location | **No** | — | — | — | No location permission in `android/app/src/main/AndroidManifest.xml:6-29`; no location plugin in `pubspec.yaml` |
| Personal info | Name | Yes | No | Required | App functionality, Account management | `lib/core/data/http/http_profile_repository.dart:38-51` |
| Personal info | Email address | Yes | No | Required (parents sign in with it) | Account management, App functionality | `http_parent_signup_repository.dart:18`; `http_auth_repository.dart:81-84` |
| Personal info | User IDs | Yes | No | Required | App functionality, Account management | The account id on every request; its hash in crash reports (`lib/core/crash/crash_reporting.dart:70`, `:76`) |
| Personal info | Address | **No** | — | — | — | Country and region are declared as approximate location |
| Personal info | Phone number | Yes | No | Optional | Account management | Account recovery by phone (`lib/features/auth/presentation/forgot_email_screen.dart:102`; `lib/core/data/http/http_account_recovery_repository.dart:28`, `:35`) |
| Personal info | Race and ethnicity, Political or religious beliefs, Sexual orientation | **No** `[OWNER DECISION: counsel decides whether enrolment in Quran lessons is "religious beliefs"; if yes, declare "Political or religious beliefs", required, App functionality]` **OPEN: L-10 / L-14 / LD-13 (§6)** | — | — | — | No field records belief (see `apple-app-privacy.md` §3.4) |
| Personal info | Other info | Yes | No | Optional (teachers only) | App functionality | A teacher's professional profile: bio, specialization, qualifications, experience, languages and certificate details (`http_teacher_profile_repository.dart:72-79`, `:120-125`). Declared here because it describes the person, not only content they post. Today only the teacher sees it (`lib/app/router.dart:558`). Certificate images and PDFs (`lib/shared/models/teacher_profile.dart:155-162`: PDF, JPEG, PNG) are the same kind of data as the Photos and Files and docs rows, which are already Yes. |
| Financial info | Purchase history | Yes | No | Optional (only families who pay in the app) | App functionality | `lib/core/data/http/http_billing_repository.dart:27`, `:31-32`, `:76-81`, `:92-93`; invoices and receipts shown (`lib/features/billing/presentation/my_payments_screen.dart:323-330`); Sales staff record payments (`lib/core/data/http/http_sales_payments_repository.dart:64`) |
| Financial info | User payment info | **No** **OPEN: counsel (§6)** | — | — | — | Card details are typed on Stripe's page in the browser, outside the app (`http_billing_repository.dart:31-32`). The app only shows Stripe's masked summary (card brand, last 4 digits, wallet) on each invoice (`:125-133`, `:226`); it never collects or sends card data. If counsel prefers to over-declare, mark it Yes. |
| Financial info | Credit score | **No** | — | — | — | — |
| Financial info | Other financial info | Yes | No | Optional | App functionality | Bank-transfer receipt (photo or PDF), amount and date (`lib/features/billing/presentation/bank_transfer_screen.dart:21-25`; `http_billing_repository.dart:40-81`) |
| Health and fitness | Health info, Fitness info | **No** | — | — | — | — |
| Messages | Emails | **No** | — | — | — | The app does not read e-mail |
| Messages | SMS or MMS | **No** | — | — | — | No SMS permission |
| Messages | Other in-app messages | Yes | No | Optional | App functionality | `lib/core/data/http/http_message_repository.dart:99` |
| Photos and videos | Photos | Yes | No | Optional | App functionality | Chat attachments (`http_message_repository.dart:215`), profile photos (`lib/features/profile/data/profile_photo_repository.dart:101`, `:131`), chat wallpaper (`lib/features/messages/data/chat_theme_repository.dart:58`, `:82`) |
| Photos and videos | Videos | Yes | No | Optional | App functionality | Chat attachments (`lib/core/media/media_picker.dart`) |
| Audio files | Voice or sound recordings | Yes | **No** (voice messages are stored; live call audio is relayed and not recorded, but the type as a whole is not ephemeral) | Optional | App functionality | `lib/core/audio/voice_recorder.dart:80`; calls `lib/features/calls/application/call_media_providers.dart:63` |
| Audio files | Music files, Other audio files | **No** | — | — | — | — |
| Files and docs | Files and docs | Yes | No | Optional | App functionality | PDFs and other files in chat (`media_picker.dart:202-213`); transfer receipts as PDF |
| Calendar | Calendar events | **No** | — | — | — | The lesson schedule is the academy's, not the phone's calendar |
| Contacts | Contacts | **No** | — | — | — | No contacts permission |
| App activity | App interactions | Yes | No | Required (recorded as the app is used) | App functionality, Analytics | Story views and taps (`lib/core/data/http/http_story_repository.dart:59`, `:65`); delivery and read receipts (`lib/features/messages/data/receipt_repository.dart:63`); notification "acted" (`lib/features/notifications/data/notifications_repository.dart:123`); material opens recorded per child and shown back as "Opened this week" (`lib/features/materials/data/materials_repository.dart:127-129`, `:109`; `MaterialOpen`, `apps/api/prisma/schema.prisma:2928-2941`; added under LR-71, answer unchanged) |
| App activity | In-app search history | **No** | — | — | — | Answered in real time, not stored |
| App activity | Installed apps | **No** | — | — | — | No `QUERY_ALL_PACKAGES`; the manifest's only query is `PROCESS_TEXT` (`AndroidManifest.xml:100-105`) |
| App activity | Other user-generated content | Yes | No | Optional | App functionality | Feedback to the academy (`lib/core/data/http/http_feedback_repository.dart:47`), reports (`lib/core/data/http/http_moderation_repository.dart:21`), lesson reports (`lib/core/data/http/http_lesson_repository.dart:54`, `:59`), leave requests (`lib/core/data/http/http_supervision_repository.dart:49`), learner certificate requests with title, achievement, date, printed name and optional grade and note (`http_supervision_repository.dart:35-44`; added under LR-71, answer unchanged), whiteboards (`lib/features/whiteboards/data/whiteboards_repository.dart:158`), task comments (`lib/core/data/http/http_task_repository.dart:56`), profile "about" text |
| App activity | Other actions | **No** | — | — | — | — |
| Web browsing | Web browsing history | **No** | — | — | — | The web view is limited to the academy's activity pages (`lib/features/materials/presentation/activity_view_mobile.dart:62-68`) |
| App info and performance | Crash logs | Yes | No | Required (cannot be turned off in the app) | App functionality, Analytics | Sentry, release builds with a DSN (`lib/core/crash/crash_reporting.dart:24-60`). Purpose: see §2.3 |
| App info and performance | Diagnostics | Yes | No | Required | App functionality, Analytics | Sentry's device model and OS version, navigation breadcrumbs only (`crash_reporting.dart:55-58`, `:89-102`); no performance tracing (`:53-54`). Purpose: see §2.3. Sentry session tracking: off (`:49`, #526 in the launch candidate; §2.2, §6 O-5) |
| App info and performance | Other app performance data | **No** | — | — | — | Tracing is off |
| Device or other IDs | Device or other IDs | Yes | No | Required | App functionality | See §2.1 |

### 2.1 Device or other IDs: what is in it

- **The FCM registration token**, registered with Jawwid's server for notifications and call rings
  (`lib/core/push/push_registration.dart:34-41`).
- **The Firebase installation ID (FID).** Firebase Cloud Messaging is the only Firebase product
  (`android/app/build.gradle.kts:123-125`: "Firebase Messaging only (no Analytics)"). FCM depends on
  Firebase Installations, which sends an installation ID to Google to issue the token. Google acts as
  Jawwid's service provider here, so it is collected, **not shared**. Firebase's own Data safety guidance
  for FCM lists exactly this; re-read it on the day:
  <https://firebase.google.com/docs/android/play-data-disclosure>.
- **The device's manufacturer and model name**, sent at sign-in and shown in "Devices"
  (`lib/core/network/device_descriptor.dart:86-91`).
- **Not collected:** the advertising ID (no ads SDK; no `AD_ID` permission in the app's manifest:
  `AndroidManifest.xml:6-29`), the Android ID, IMEI or serial number. **OPEN (§6):** the advertising-ID
  answer is pending the merged-manifest check of the release AAB from the release-readiness workflow
  (release audit WP-6). The plugin manifests that could be read add no `AD_ID`; Firebase's merged
  permissions could not be read without a build (machine rule).

### 2.2 SDKs, and what each one adds

| SDK | Data it sends | Declared above as |
|---|---|---|
| Firebase Cloud Messaging (`android/app/build.gradle.kts:123-125`) | Installation ID, FCM token, the notification payload in transit | Device or other IDs |
| Sentry (`sentry_flutter`, `pubspec.yaml:129`) | Crash stack, device model and OS, hashed account id, navigation breadcrumbs. Automatic session tracking, on by default in the SDK, is turned off (`crash_reporting.dart:49`, `enableAutoSessionTracking = false`; **done in #526, in the launch candidate**), so no app-session events (release health) are sent; see §6 O-5 | Crash logs, Diagnostics, User IDs |
| LiveKit (`livekit_client`, `pubspec.yaml:38`) | Live microphone audio (relayed, not recorded), participant id | Voice or sound recordings, User IDs |
| Stripe | Nothing from the app's code: Checkout opens in the browser | — (see §4) |
| No advertising, analytics, attribution or social-login SDK | — | `docs/legal/data-inventory-and-retention-matrix.md` §2, "Not used" |

### 2.3 Crash logs and diagnostics: why the purposes differ from Apple's (LR-71)

Google: **App functionality, Analytics.** Apple (`apple-app-privacy.md` §3.9 and the iOS privacy manifest,
`ios/Runner/PrivacyInfo.xcprivacy:124-135`, `:223-234`): **App Functionality** only. The difference is
deliberate. The use is the same on both stores; the two stores sort that use under different purposes:
- **Google's** Data safety "Analytics" purpose covers monitoring app health and diagnosing and fixing bugs
  or crashes. That is exactly what Sentry data is used for, so Analytics is declared on Google.
- **Apple's** App Functionality purpose covers minimizing app crashes, and Apple's Analytics is about
  understanding how people use the app. So Apple stays at App Functionality only.

What the data is used for (`lib/core/crash/crash_reporting.dart`):
- the reports go only to Sentry, and only in a release build with a DSN (`:24-28`);
- performance tracing is off (`:53-54`), user-interaction and native breadcrumbs are off (`:55-56`), and
  only navigation breadcrumbs are kept (`:58`, `:89-102`);
- there is no analytics SDK in the app (§2.2), and nothing reads crash data to measure how people use the app.

Do not copy one store's purposes to the other. Re-read both stores' live purpose definitions on the day
(the Google wording above was not re-fetched for this draft). Over-declaring on Google is safer than
under-declaring.

## 3. Security practices

### 3.1 Encrypted in transit: Yes

- The app talks to the API over HTTPS only. Android has no cleartext exception (no
  `usesCleartextTraffic` or network-security config in `AndroidManifest.xml:40-46`, as of the launch candidate), and the store build
  script accepts only an `https` API URL (`scripts/mobile/build-store.sh`; launch checklist LR-21).
- Calls use WebRTC's DTLS-SRTP (`ios/Runner/Info.plist:34-38`).
- **LiveKit signalling (launch item LR-32, done in #506):** the server refuses to issue a call token when
  `APP_ENV=production` and `LIVEKIT_URL` is not `wss://` (`apps/api/src/communication/calls/media-token.ts:92-102`;
  `APP_ENV` read at `:51`). `ws://` is still accepted outside production, for local stacks only. The only
  remaining condition is operational: the production API runs with `APP_ENV=production`.

### 3.2 Deletion: Yes

- **In the app:** Settings → Delete account, with the password re-entered
  (`lib/features/settings/presentation/settings_screen.dart:281-285`, as of the launch candidate;
  `lib/core/data/http/http_account_deletion_repository.dart:12`).
- **On the web, without the app:** `{{ACCOUNT_DELETION_URL}}` (the API's public `/account-deletion` page,
  `apps/api/src/account-deletion/account-deletion.controller.ts`).
- **What is kept, and why** (data inventory §4): messages the person sent (shown as "Deleted user"),
  children's lesson records, payment records ("7 years", L-6), the audit log, reports and consent records,
  and backups for up to 56 days. The Privacy Policy discloses it (§10).
- **Teachers with work open (LR-03, done in #498, in the launch candidate):** a teacher with a lesson ahead,
  an assigned student or open payroll requests deletion in the same screen or on the web page; the app shows
  the date, staff close the work, and the account is deleted within 30 days at the latest (by staff, or by
  the server at the deadline). The request can be cancelled in the app until then
  (`apps/api/src/account-deletion/account-deletion.controller.ts:20-24`, `:56-73`, `:120-121`;
  `lib/features/settings/presentation/delete_account_screen.dart:95-110`; Privacy Policy §10.4.1). Google
  allows a stated delay; there is no "contact us" step. Staff accounts cannot delete in the app (LR-20).

## 4. Stripe and the child's name: closed (LD-8 done in #580)

In the launch candidate the payment line item sent to Stripe is the payment request's label only, never
the child's name; the period and the "live one-to-one lessons" wording travel in the description
(`apps/api/src/billing/checkout.service.ts:120-131`, `checkoutProductName`, and `:310-311`;
`apps/api/src/billing/in-app-payability.ts:120-130`; lines as of the launch candidate; #580, commit
`7934ae49`). So Name is **not shared**, whatever counsel decides on Stripe's role (L-4, still open for its
own sake). The label is free text typed by staff: staff must not type a child's name into it.

If a build without #580 were ever submitted, `origin/main`'s `checkout.service.ts:147` still puts the
child's name in the line item, and this question reopens: declare Name as "Shared", purpose "App
functionality", if counsel treats Stripe as a third party for it. The data inventory (§2) still cites
`checkout.service.ts:129` for the child's name; that file is outside this change (see the LR-71 PR).

## 5. Before you press Save

- [ ] The merged manifest of the release AAB has no permission or SDK that is not covered here (WP-6),
      including no `AD_ID`.
- [ ] Counsel has answered the religious-beliefs question (§2) and L-4 (§4).
- [x] LR-03 (teacher deletion) is done (#498, in the launch candidate).
- [ ] LR-32 (`wss://`) is done in code (#506); confirm the production API runs with `APP_ENV=production`.
- [ ] Every OPEN item in §6 is decided, and any answer it changes is updated here and in `apple-app-privacy.md`.
- [ ] The Privacy Policy and `apple-app-privacy.md` say the same.

## 6. Open items (LR-71)

Each answer below stays as drafted until its owner decides. Nothing here changes an answer.

| # | Item | Answer today | Decision id and owner | Where |
|---|---|---|---|---|
| O-1 | User payment info: does the stored card brand, last four digits and wallet count? | No | **OPEN.** Counsel. No id yet in `docs/legal/outstanding-information-and-decisions.md`; the lead should register one | §2 |
| O-2 | Political or religious beliefs: is Quran-lesson enrolment "religious beliefs"? | No | **OPEN.** Counsel. Related: L-10, L-14, LD-13, but none of them asks this label question directly; the lead should register an id | §2 |
| O-3 | Families Policy question | Not asked (audience 18+) | **OPEN.** Owner: target audience N-1 / LD-5; counsel: L-15 (SDK terms for child-directed use) | §1; `play-declarations.md` §1 |
| O-4 | Advertising ID not collected | Not collected | **OPEN** pending the merged-manifest check of the release AAB from the release-readiness workflow (release audit WP-6) | §2.1; `play-declarations.md` §3 |
| O-5 | Sentry automatic session tracking | Not declared beyond Crash logs and Diagnostics | **Done in the launch candidate (#526):** `enableAutoSessionTracking = false` (`crash_reporting.dart:49`), so nothing more is declared. Closed | §2, §2.2; `apple-app-privacy.md` §3.8 |
| O-6 | Name "Shared" because of the child's name in the Stripe line item | Not shared | **Closed: LD-8 done in #580** (the line item is the request's label only, `checkout.service.ts:120-131` as of the launch candidate). Counsel L-4 stays open for Stripe's role, but no longer changes this answer | §4 |
| O-7 | Delete account URL | placeholder | **OPEN.** LR-04, LD-16 | §1, §3.2 |
