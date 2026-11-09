# Store compliance pre-audit (LR-71): console answers against the code

**Task W31. Pre-audit, 2026-11-09.** The final LR-71 audit runs on the release candidate; this one checks
every store-console answer drafted so far against the code as it stands today, so the lead knows which
answers are already true, which become true only when a named pull request merges, and which are wrong.

**Baseline.** `main` @ `bc47d37621c078f5274e09c6edb98c2818991087` (2026-11-08). Open pull requests were read
from their local remote-tracking branches (the GitHub CLI was not available in this session), using the
head SHAs recorded in the lead's merge plan (`docs/release/merge-plan-2026-11-09.md` on
`claude/launch-readiness-org`). Docs only: no code was changed, and nothing was built or run (machine rule).

**Documents audited.** On `main`: `docs/release/store-console/README.md`, `apple-app-privacy.md`,
`google-data-safety.md`, `play-declarations.md`, `age-rating.md`, `listing-copy.md`;
`docs/release/app-review-notes-payments.md`, `pd57-ugc-compliance.md`, `review-accounts.md`. In open PRs:
#527 (re-verified privacy, Data safety and Play declarations), #530 (`review-notes.md`,
`ios-background-modes.md`, full-screen-intent section), #528 (`review-accounts.md`), #498
(`app-review-notes-account-deletion.md`), #525 (`docs/legal/support-*.md`, `account-deletion-*.md`).

**Verdicts.** `TRUE` (the code on `main` supports the answer); `TRUE ONLY AFTER PR #N MERGES`;
`FALSE` (the answer or its evidence does not match the code; a fix is given); `UNVERIFIABLE` (needs a
production setting, a build artefact or a device).

## 0. Pull requests examined

| PR | Branch (head) | Compliance relevance |
|---|---|---|
| #449 | `claude/pd032-feedback-reply-notifications` (`c205aba0`) | Push taps open their item; adds `UNUserNotificationCenter` delegate on iOS. Base of the #524 → #535 and #529, #537 stacks. Does **not** change the notification-permission timing (§6) |
| #497 | `claude/pd58-eng10-terms-gate` (`9bc9416e`) | API Terms of Use gate (`LegalGuard`), fail-closed production configuration (§8) |
| #498 | `claude/pd56-teacher-deletion-request` (`ea2243a0`) | Teacher deletion becomes a 30-day request; policy and in-app texts change (§7) |
| #522 | `claude/lr39-iphone-portrait` (`7567d88e`) | Portrait lock in Dart only; `Info.plist` orientations unchanged. No console answer depends on it |
| #524 | `claude/lr13-voip-at-launch` (`ccd29221`), on #449 | VoIP `PKPushRegistry` created at launch (LR-13) (§5, §11) |
| #525 | `claude/lr04-legal-pages-ready` (`aa2f2285`) | Public support and account-deletion page drafts (§7, §9) |
| #526 | `claude/lr23-sentry-no-sessions` (`bb5340b7`) | `enableAutoSessionTracking = false` (§1, §2, §3) |
| #527 | `claude/lr71-console-drafts-refresh` (`618c967c`) | Re-verified `apple-app-privacy.md`, `google-data-safety.md`, `play-declarations.md` §3, §5–§7 against `bc47d376` |
| #528 | `claude/lr05-review-cohort-run` (`920b04c1`) | Third review account `parent2`, production workflow (§11) |
| #529 | `claude/lr79-ring-repost` (`7e1f07fe`), on #449 | Android ring re-post; also carries `canUseFullScreenIntent` (§5) |
| #530 | `claude/lr09f-review-notes` (`722b0f47`) | Paste-ready review notes, iOS background-mode justifications, full-screen-intent declaration text (§5, §11) |
| #531 | `claude/lr24-ios-background-modes` (`fb6a0e1d`) | Removes `remote-notification` from `UIBackgroundModes` (§4) |
| #534, #537 | `claude/sec-push-device-owner` (`8d1dff77`), `claude/sec-device-token-session` (`9f360bda`) | Push token bound to the caller and its session. No new data type (§3) |
| #535 | `claude/sec-android-lockscreen-reset` (`5d7a23e5`), on #524 | Lock-screen call window; carries the `canUseFullScreenIntent` check (§5) |
| #536 | `claude/sec-push-lockscreen-pii` (`7053582f`) | Child names, amounts and receipt reasons kept off the lock screen for billing pushes (§13) |
| #540 | `claude/sec-offline-signout-retry` (`6d4ef3a1`) | Offline sign-out retried; token kept in secure storage. No new data type |
| #549 | `claude/lr09j-store-screenshots` (`6365275f`) | Adds the `integration_test` dev dependency only; no runtime change |
| #521, #523, #532, #533, #538, #539, #541, #542, #543, #544, #545, #546, #547, #548, #550, #551, #552 | docs, CI, tests, API concurrency, database rules, signing workflow | No store-console answer depends on them. #547 and #548 matter for the release-candidate build itself, not for an answer |

Already on `main` and relevant (the drafts written at `cf731af2` predate them): LR-73 privacy manifest (#508),
LR-14 microphone-only service (#505), LR-32 `wss://` in production (#506), the P-5 support contact rows
(`claude/support-contact-settings-f225d2`), the LD-12 content filter (`claude/ugc-content-filter-4da5c7`),
the PD-57 report and block API and UI (`claude/pd57-*`), the Flutter and Admin Web Terms gates (#504, #500).

---

## 1. Apple App Privacy (`apple-app-privacy.md`)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 1.1 | No data is used for tracking; `NSPrivacyTracking = false`; no tracking domains | `ios/Runner/PrivacyInfo.xcprivacy:20-23`; no ads, analytics or attribution plugin in `pubspec.yaml` | TRUE | — |
| 1.2 | Everything collected is linked to the user; crash reports carry a hash of the account id | `lib/core/crash/crash_reporting.dart:61-70` (`SentryUser(id: actorHash(actorId))`) | TRUE | — |
| 1.3 | Name, Email, Phone Number collected | name/about: `lib/core/data/http/http_profile_repository.dart:37-51`; e-mail: `http_parent_signup_repository.dart:18`, `:49-50`; phone: `lib/features/auth/presentation/forgot_email_screen.dart:102`, `http_account_recovery_repository.dart:28`, `:35` | TRUE | — |
| 1.4 | Payment Info: No (card entered on Stripe's hosted page in the browser; only brand, last 4, wallet shown back) | `lib/features/billing/presentation/pay_sheet.dart:54-68` opens the Checkout URL through `attachmentOpenerProvider` (external browser, `lib/core/media/attachment_opener.dart:40`); `http_billing_repository.dart:125-133` parses `card` | TRUE as to the code; counsel item O-1 (#527 §7) stays open | — |
| 1.5 | Other Financial Info: bank-transfer receipt with amount and date | `http_billing_repository.dart:40-81` (`submitReceipt`); `bank_transfer_screen.dart:21-25` | TRUE | — |
| 1.6 | Coarse Location: country and region (PD-45) plus the phone's time zone; no location API or permission | `lib/shared/location/location_repository.dart:45-48`, `:57`; `lib/core/time/time_zone_api.dart:52-53`, `:81`; `lib/app/shells/app_shell.dart:162`; no `NSLocation…` key in `ios/Runner/Info.plist`; no location permission in `android/app/src/main/AndroidManifest.xml:6-29`; manifest entry `PrivacyInfo.xcprivacy:50-61` | TRUE | — |
| 1.7 | Emails or Text Messages, Photos or Videos, Audio Data, Customer Support, Other User Content: Yes | `http_message_repository.dart:98-101`, `:214-218`; `media_picker.dart:198-215`; `profile_photo_repository.dart:101`, `:131`; `chat_theme_repository.dart:58`, `:82`; `voice_recorder.dart:80`; `http_feedback_repository.dart:47`; `http_moderation_repository.dart:21`; `http_block_repository.dart:23`; `http_lesson_repository.dart:54`, `:59`, `:171`; `http_supervision_repository.dart:35-44`, `:49`; `whiteboards_repository.dart:158`; `http_task_repository.dart:51`, `:56`; `http_teacher_profile_repository.dart:72-79`, `:120-125`; `teacher_profile.dart:155-162` | TRUE (every cited line re-read; all match) | — |
| 1.8 | Live call audio is relayed, not recorded | `apps/api/src/communication/calls/call.service.ts:29` ("No audio is recorded"); no egress code under `apps/api/src/communication/calls/`; `lib/core/call_media/livekit_media_room.dart:13-16` (audio only) | TRUE | — |
| 1.9 | User ID and Device ID (push token, device model and app version); no IDFA or `identifierForVendor` | `lib/core/push/push_registration.dart:34-42`; `lib/core/network/device_descriptor.dart:79-91`; `http_auth_repository.dart:78-87`; no `identifierForVendor`, `advertisingId` or `ANDROID_ID` anywhere in `lib/`, `android/`, `ios/` | TRUE | — |
| 1.10 | Purchase History: Yes | `http_billing_repository.dart:27`, `:31-32`, `:76-81`, `:92-93`; `my_payments_screen.dart:318-332`; `http_sales_payments_repository.dart:64` | TRUE | — |
| 1.11 | Product Interaction (App Functionality, Analytics): story views and taps, receipts, mention seen, notification acted; #527 adds material opens | `http_story_repository.dart:59`, `:65`; `receipt_repository.dart:63`; `mention_repository.dart:97`; `notifications_repository.dart:123`; `materials_repository.dart:127-129` | TRUE | — |
| 1.12 | Crash Data and Other Diagnostic Data: Yes; Performance Data: No; `sendDefaultPii = false`, no screenshots, no tracing | `crash_reporting.dart:24-28`, `:36-51`, `:83-96` | TRUE | — |
| 1.13 | Other Usage Data: No | On `main`, `SentryFlutter.init` does not set `enableAutoSessionTracking` (`crash_reporting.dart:36-51`); the SDK's default is on, so release builds send app-session start and end events. #526 sets it to `false` with a test (`crash_reporting.dart` and `test/core/crash/crash_reporting_test.dart` in `bb5340b7`) | **TRUE ONLY AFTER PR #526 MERGES** | Merge #526 before the release candidate; otherwise declare the session data |
| 1.14 | Manifest §5 (on `main`): "seven collected types are missing from `PrivacyInfo.xcprivacy`" | All seven are declared on `main`: `PrivacyInfo.xcprivacy:140-234` (phone number, other financial info, emails or text messages, customer support, purchase history, product interaction with Analytics, other diagnostic data). 16 "Yes" types in §2 ↔ 16 manifest entries | **FALSE on `main`** (stale); corrected by #527 | Merge #527 (docs) |
| 1.15 | Sensitive Info: No, pending counsel (religious beliefs) | No field records belief. IDs L-10, L-14, LD-13 exist in `docs/legal/outstanding-information-and-decisions.md` | TRUE as to the code; counsel decides | — |
| 1.16 | Browsing History: No (web view limited to the academy's activity pages) | `lib/features/materials/presentation/activity_view_mobile.dart:59-69` (`widget.allow(uri)` on every main-frame navigation) | TRUE | — |
| 1.17 | Face ID: the app receives no biometric data | `Info.plist:65-69`; `local_auth` plugin only | TRUE | — |
| 1.18 | Third-party SDK manifests: "check the privacy report for Sentry's own Performance Data" | The Sentry Cocoa pod's `PrivacyInfo.xcprivacy` is not in the repository or the pub cache (the pod is fetched at build time) | UNVERIFIABLE until an archive exists | Run Xcode's privacy report on the release-candidate archive (release audit WP-6) |

## 2. Google Play Data safety (`google-data-safety.md`)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 2.1 | Collected data types and "Shared = No" for every row | Same evidence as §1; every third party is a processor (data inventory §2) | TRUE as to the code; L-4 (Stripe's role) and LD-8 (child's name in the line item) open | — |
| 2.2 | Stripe receives the child's name in the line item, `checkout.service.ts:147` | `apps/api/src/billing/checkout.service.ts:147` (`productName: fresh.childName ? \`${fresh.label} — ${fresh.childName}\` : fresh.label`) | TRUE (the data inventory's `:129` is stale; the console drafts say `:147`) | Update `docs/legal/data-inventory-and-retention-matrix.md` §2 to `:147` |
| 2.3 | Account creation: username and password only (parent e-mail, one-time code), no social login | `http_parent_signup_repository.dart:18`, `:49-50`; `http_auth_repository.dart:81-84`; no OAuth plugin | TRUE | — |
| 2.4 | Encrypted in transit: Yes; depends on LR-32 (`ws://` LiveKit URL) | `main` already refuses a non-`wss://` `LIVEKIT_URL` when `APP_ENV=production` (`apps/api/src/communication/calls/media-token.ts:92-102`); the store build script accepts only `https` URLs (`scripts/mobile/build-store.sh:39-44`, `:85-100`); no cleartext exception in `AndroidManifest.xml:36-41` | TRUE in code (the `main` draft's "depends on LR-32" is stale; #527 corrects it). The operational condition is `APP_ENV=production` on the live API | UNVERIFIABLE until production: confirm `APP_ENV=production` |
| 2.5 | Deletion: in-app (password) and public web page | `lib/features/settings/presentation/settings_screen.dart:277-286`; `http_account_deletion_repository.dart:11-13`; `apps/api/src/account-deletion/account-deletion.controller.ts:32-44`, `:59-106` | TRUE (see §7 for teachers and for what is kept) | — |
| 2.6 | Crash logs and Diagnostics declared with purpose "App functionality, Analytics" on Google, "App Functionality" only on Apple (#527 §2.3) | A purpose mapping, not a code fact. The code sends only crash reports (§1.12) | TRUE as a defensible reading; re-read both stores' purpose definitions on the day | — |
| 2.7 | Device or other IDs: FCM token, Firebase installation id, device model; no advertising ID (`AD_ID`) | `push_registration.dart:34-42`; `device_descriptor.dart:86-91`; `android/app/build.gradle.kts:122-125` (Firebase Messaging only); no `AD_ID` in the app's manifest | TRUE for the app's own manifest. Firebase's merged permissions: UNVERIFIABLE until the release AAB exists | Merged-manifest check (WP-6) |
| 2.8 | Sentry session tracking (O-5) | As 1.13 | **TRUE ONLY AFTER PR #526 MERGES** | Merge #526 |
| 2.9 | Approximate location is Optional ("Later" exists; time zone can be set by hand) | `location_repository.dart:55-58` (`POST /me/location/later`); `time_zone_api.dart:58-65` (`set(automatic:false)`) | TRUE | — |
| 2.10 | Installed apps: No (only the `PROCESS_TEXT` query) | `AndroidManifest.xml:95-100` | TRUE | — |

## 3. Third parties and SDKs (LiveKit, Firebase, Sentry, Stripe)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 3.1 | LiveKit: live microphone audio only, participant id; no recording | `media-token.ts` (grant), `call.service.ts:29`, `livekit_media_room.dart:13-16` | TRUE | — |
| 3.2 | Firebase: Cloud Messaging only, no Analytics or Crashlytics | `android/app/build.gradle.kts:122-125`; no `firebase_*` Dart plugin in `pubspec.yaml`; iOS uses APNs directly (`ios/Runner/AppDelegate.swift`) | TRUE | — |
| 3.3 | Sentry (mobile): crash stack, scrubbed messages, hashed account id, device model and OS, navigation breadcrumbs; release builds with a DSN only | `crash_reporting.dart:24-28`, `:36-51`, `:72-120` | TRUE, except the session data (1.13) | Merge #526 |
| 3.4 | Stripe: nothing from the app's code; Checkout opens in the browser | `pay_sheet.dart:54-68` → `attachment_opener.dart:40` (`LaunchMode.externalApplication`); the server sends amount, currency, label with the child's name, description, ids and locale (`checkout.service.ts:141-152`) | TRUE | LD-8: remove the child's name from the line item (owner) |
| 3.5 | Push tokens: registered with Jawwid's server, retired at sign-out | `push_registration.dart:34-50`, `:129-146`. #534 binds registration to the authenticated caller; #537 binds the token to the session and deactivates it when the session is revoked (`docs/communication/mobile-contract.md` in `9f360bda`) | TRUE; #534 and #537 change ownership rules, not the declared data types | — |

## 4. Permissions declared versus used

### 4.1 Android (`play-declarations.md` §7)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 4.1.1 | The app's manifest asks for `INTERNET`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `USE_BIOMETRIC`, `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` and nothing else | `android/app/src/main/AndroidManifest.xml:6-29` | TRUE | — |
| 4.1.2 | `main` draft: "`FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS` at `:30-31`, to be removed" | Both are gone on `main` (LR-14, #505): `AndroidManifest.xml:24-29`, `:73-76` (`foregroundServiceType="microphone"`) | **FALSE on `main`** (stale); corrected by #527 | Merge #527 |
| 4.1.3 | Permissions added by plugins in the merged manifest: `ACCESS_NETWORK_STATE` (connectivity_plus); `RECORD_AUDIO` (record), `USE_BIOMETRIC` (local_auth); `livekit_client` and `flutter_webrtc` add none; Firebase adds `WAKE_LOCK` and `c2dm.RECEIVE` (unverified) | Read in the local pub cache for the versions pinned in `pubspec.lock`: `connectivity_plus-7.3.1` declares `ACCESS_NETWORK_STATE`; `record_android-2.2.0` declares `RECORD_AUDIO`; `local_auth_android-2.3.0` declares `USE_BIOMETRIC`; `flutter_webrtc-1.6.2+hotfix.3`, `livekit_client-2.13.0`, `image_picker_android-0.8.13+23`, `file_selector_android-0.5.2+11`, `sentry_flutter-10.3.0`, `device_info_plus-13.2.0`, `video_player_android-2.12.2`, `webview_flutter_android-4.14.1`, `share_plus-13.3.1`, `url_launcher_android-6.3.33`, `just_audio-0.10.6`, `audio_session-0.2.4`, `flutter_secure_storage-11.2.0`, `flutter_timezone-5.1.1` declare no `uses-permission` | TRUE for every pub.dev plugin (confirmed from the plugin manifests). Firebase's AAR is not in the pub cache | UNVERIFIABLE until the release AAB: `aapt2 dump permissions` in the release-readiness workflow (#523) |
| 4.1.4 | No camera permission; the system camera and picker are used | No `CAMERA` in the app's or any plugin's manifest (4.1.3); `media_picker.dart` uses `image_picker` and `file_selector` | TRUE | — |
| 4.1.5 | `allowBackup="false"` | `AndroidManifest.xml:37` | TRUE | — |
| 4.1.6 | Manifest comment: "Android 14+ checks it at runtime: `JawwidPush.mayUseFullScreenIntent`" | No such function on `main`; `JawwidPush.kt:141` only sets the intent. #524 and #535 add `JawwidPush.canUseFullScreenIntent` (`JawwidPush.kt:180-184` in `5d7a23e5`) and keep the stale comment name | **FALSE on `main`** (comment) | After #524 merges, fix the comment to `canUseFullScreenIntent` (Mobile nit) |

### 4.2 iOS (`Info.plist`)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 4.2.1 | Usage strings exist for camera, photo library, photo-library add, microphone, Face ID; each is used | `Info.plist:52-69`; camera and library: `media_picker.dart`; add: PD-39 board export; microphone: `voice_recorder.dart`, calls; Face ID: app lock | TRUE | — |
| 4.2.2 | No location, contacts, calendar, Bluetooth or health usage string, and no such use | `Info.plist` has none; no such plugin in `pubspec.yaml` | TRUE | — |
| 4.2.3 | `UIBackgroundModes`: `voip`, `remote-notification`, `audio` on `main`; #530 says `remote-notification` has no use and should be removed | `Info.plist:44-51` on `main`; nothing implements `didReceiveRemoteNotification` in `ios/Runner/`; `apns.provider.ts:84-96` sends only `voip` and `alert` pushes. #531 removes the mode and the stale comment, with a test (`test/app/store_submission_config_test.dart` in `fb6a0e1d`) | **TRUE ONLY AFTER PR #531 MERGES** (today the binary declares a mode with no use, Apple 2.5.4) | Merge #531. Then update #530's `ios-background-modes.md` §3 and the README row from "OPEN, remove it" to "removed in #531" |
| 4.2.4 | `voip` is justified: PushKit token, CallKit report | `AppDelegate.swift:128-139`, `:182-190`; `CallKitBridge.swift`. #524 creates the registry at launch | TRUE in code; the server sends no VoIP push until `APNS_VOIP_ENABLED=true` (`push.provider.selector.ts:51-67`) | UNVERIFIABLE until production and a device (§11) |
| 4.2.5 | `audio` is justified: an ongoing call keeps its audio in the background | `Info.plist:48-50`; `livekit_media_room.dart` | TRUE in code; the adapter has "never joined a real room" (`livekit_media_room.dart:17-21`) | UNVERIFIABLE until a device test |
| 4.2.6 | Export compliance: `ITSAppUsesNonExemptEncryption = false` (only HTTPS/TLS, DTLS-SRTP, the OS keychain and keystore) | `Info.plist:34-38`; the only encryption in `lib/` is the platform keystore through `flutter_secure_storage` (`lib/core/storage/secure_token_store.dart:7`, `:21`); `crypto` is used for SHA-256 only | TRUE | Record the answer in `README.md` of this folder (no store-console file covers export compliance today) |

## 5. Foreground service and full-screen intent (`play-declarations.md` §5, §6; #530)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 5.1 | Foreground service type: Microphone only; `CallForegroundService` with an ongoing notification and Hang up | `AndroidManifest.xml:73-80`; `CallForegroundService.kt` (type microphone, #527 cites `:54`, `:67`) | TRUE on `main` (the `main` draft's "submit only after LR-14" is stale; #527 corrects it) | Merge #527 |
| 5.2 | Full-screen intent is used only for incoming calls | `AndroidManifest.xml:18-23`; `JawwidPush.kt:141` (`setFullScreenIntent` on the `CallStyle` ring) | TRUE | — |
| 5.3 | "On Android 14 and later the app checks whether it may use full-screen intents; if not, the call rings as a heads-up notification" (#530 declaration text) | On `main` there is no `canUseFullScreenIntent` check. It exists on `claude/lr79-ring-repost` and `claude/sec-android-lockscreen-reset` (`JawwidPush.kt:167`, `:180-184`; `RingCheck.kt:69-70`; `MainActivity.kt:229`; `lib/core/call_native/call_presentation.dart:214-217`), both stacked on #449 | **TRUE ONLY AFTER PR #524 (and so #449) MERGES.** The #530 text is correct for that build and wrong for `main` | Submit no build before #524; verify on an Android 14+ phone with the permission turned off (#530 §6 note) |
| 5.4 | "The app offers the system setting" | Dart can open `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` (#524 `MainActivity.kt:257`) but no screen calls it; #530 says so | TRUE (the drafts do not claim it) | Keep the declaration without "offers the setting" |
| 5.5 | The declaration video `{{FGS_VIDEO_URL}}` | Needs a release build on an Android 14+ phone | UNVERIFIABLE until a device | — |

## 6. Notification permission timing (LR-11; `play-declarations.md` §7 row `POST_NOTIFICATIONS`)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 6.1 | "Asked when a notification first matters, not at launch" | Android: `MainActivity.startRegistering()` requests `POST_NOTIFICATIONS` as soon as Dart calls `start` after sign-in (`MainActivity.kt:33-34`, `:211-216`), with no in-app explanation before the system prompt. iOS: `UNUserNotificationCenter.requestAuthorization` in the same place (`AppDelegate.swift:129`). #449 keeps both (`AppDelegate.swift:176` in `c205aba0`; its `MainActivity.kt` diff does not touch `startRegistering`). No accepted PR changes this | **FALSE as worded**: the prompt comes right after sign-in, before any notification exists, and without the prominent disclosure Play's G-12 asks for where the use is unexpected. The draft itself notes LR-11 is open | Ship LR-11 (explain first, then ask) before the release candidate, or reword the row to "asked right after sign-in" and accept the G-12 risk |

## 7. Account deletion (Data safety §3.2, review notes, listing copy, #498, #525)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 7.1 | Parents and teachers delete in Settings with the password; a public page `/account-deletion` works without the app | `settings_screen.dart:277-286`; `account-deletion.controller.ts:32-44`, `:59-106`; `account-deletion-page.ts` | TRUE | — |
| 7.2 | Deletion is immediate and complete for what it names; what is kept is disclosed (messages as "Deleted user", children's records, payments 7 years, audit log, reports, call records, sessions revoked not deleted, backups up to 56 days) | `account-deletion.service.ts:58-84` (`chat.erase_account` in one transaction, sessions revoked, photos deleted best effort); `docs/legal/data-inventory-and-retention-matrix.md` §4–§5; `docs/legal/privacy-policy-en.md` §10.2–§10.3; the web page lists the same (`account-deletion-page.ts:45-55`) | TRUE. Known gaps the policy already discloses: session rows kept (DEV-CONFIRM #10), trial-request details untouched (DEV-CONFIRM #12), nothing propagated to Stripe, Sentry, LiveKit, APNs or FCM (DEV-CONFIRM #15), "7 years" not enforced (L-6) | Counsel items; none blocks the answer "Yes, deletion is offered" |
| 7.3 | Teachers: "a teacher with lessons ahead is refused and told to contact the academy; do not submit until LR-03 (#498) merges" | On `main`: `TEACHER_DELETION_BLOCKED` (`account-deletion.controller.ts:100`, `account-deletion-page.ts` `teacher_blocked`). #498 replaces it with a request deleted within 30 days, in the app, on the web page and in the policy (`app-review-notes-account-deletion.md`, `account-deletion-page.ts`, `privacy-policy-en.md` §10.4.1 in `ea2243a0`) | **TRUE ONLY AFTER PR #498 MERGES** (Google accepts a stated delay, not "contact us") | Merge #498 before the release candidate |
| 7.4 | #530 `review-notes.md` (Apple Notes and the facts table): "The teacher account cannot be deleted while it has students; the app asks the teacher to contact the academy" | True on `main`; **false once #498 merges** (the teacher is offered "Request account deletion" and a 30-day date; the review teacher is not exempt, `review-cohort.ts` in `ea2243a0`) | **FALSE after #498** (the two PRs contradict each other; both are accepted) | In #530 (or a follow-up), replace the sentence with #498's wording: "a teacher who still has lessons requests deletion in the same screen, sees the date, and is deleted within 30 days"; add "we re-create the teacher account after a review" |
| 7.5 | `review-accounts.md` (`main` and #528): "The teacher account cannot be deleted while a child is assigned to it, so it never needs restoring"; review-notes paragraph: "Deleting an account in the app takes effect immediately" | #498 changes both: the teacher's deletion is a request, and the re-run re-creates the teacher and moves the child back (`review-cohort.ts:58-71`, `:326-347` in `ea2243a0`) | **FALSE after #498** (#528 does not carry #498's doc change) | After both merge, update `review-accounts.md` "Run it again" and the review-notes paragraph |
| 7.6 | #525 `account-deletion-en.md` / `-ar.md` §1.5: "a teacher cannot delete their account while … Contact the Academy" | Same as 7.4; the draft's own note says clause 1.5 must change when #498 merges | **FALSE after #498** | Rewrite §1.5 before publication (LR-04) |
| 7.7 | #498 in-app text drops "for 7 years" from what is kept for teachers (`deleteAccountKeptTeacher`), while the web page and the parent text still say 7 years for payments and the audit log | `lib/l10n/app_en.arb` diff in `ea2243a0`; `account-deletion-page.ts:52` | TRUE (consistent: payroll records have no stated period; payments keep 7 years) | — |
| 7.8 | #498 `app-review-notes-account-deletion.md` §3: "No spare account is needed" versus #528's dedicated `parent2` deletion account | Both are accepted PRs | Inconsistent guidance, not a false console answer | Prefer #528's `parent2` for the parent test and #498's re-run for the teacher; say so in `review-notes.md` |
| 7.9 | Listing copy: "Delete your account from Settings at any time" | True for parents; for teachers only after #498 | **TRUE ONLY AFTER PR #498 MERGES** | — |

## 8. The Terms of Use gate (PD-58; `pd57-ugc-compliance.md` R9; review notes "Users must accept the Terms of Use and Code of Conduct before posting")

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 8.1 | Every content-creating route refuses with 403 `COMM.TERMS_NOT_ACCEPTED` until the account accepts its terms and the Code of Conduct | On `main` there is no `apps/api/src/legal/`; `blocks.controller.ts:24` carries a TODO for it. #497 adds `LegalGuard` (global, after auth and permissions, before the action throttle), `@RequiresLegal()`, the LD-11 child-safety exemption, and `legal-coverage.spec.ts` with the `UNGATED_WRITES` allow-list (`legal.guard.ts`, `ungated-writes.ts` in `9bc9416e`) | **TRUE ONLY AFTER PR #497 MERGES** | Merge #497 (batch 6, first) |
| 8.2 | The app and Admin Web show the gate | Both are on `main` and inert until the API sends the `legal` block: `lib/features/legal/presentation/legal_gate.dart:18-30`, `legal_gate_state.dart:6-18`; parent sign-up boxes `parent_signup_screen.dart:54-84` | TRUE (inert until 8.1) | — |
| 8.3 | Production refuses to start without the four published versions | `scripts/infra/production-setup.py legal` and `docs/infrastructure/production-runbook.md` in `9bc9416e`: `legal.current.terms_family`, `terms_teacher`, `terms_staff`, `code_of_conduct` must name a version published with `chat.publish_legal_version` | TRUE after #497; UNVERIFIABLE until production: the owner must publish the texts (N-3) and set the rows, after the clients ship and before the API deploys | Release order in the runbook |
| 8.4 | `pd57-ugc-compliance.md` R9: "API and gate on an unpushed local branch; app gate: Gap" | Stale: the API gate is #497; the app gate (#504) and Admin Web gate (#500) are merged | **FALSE** (stale status) | Refresh the matrix (§9) |

## 9. User-generated content and moderation (`pd57-ugc-compliance.md`, `age-rating.md`, review notes)

The matrix on `main` was written at `63df3ee9` and says "none is merged". That is no longer true.

| # | Row | What the code says today | Verdict | Fix |
|---|---|---|---|---|
| 9.1 | R1 filter: "Gap; no filter exists" | A server-side pre-posting word filter is on `main`: `apps/api/src/platform/content-filter/content-filter.service.ts:7-24`, `:49-61`, applied to messages, parent feedback, parent and teacher profiles (`message.service.ts`, `parent-feedback.service.ts`, `parent-profile.service.ts`, `teacher-profile.service.ts`); refuses with `COMM.CONTENT_NOT_ALLOWED` (400); on by default, switchable by `moderation.content_filter.enabled`. The word list is a DRAFT pending owner approval (`word-list.draft.json:2-4`, LD-12) | **FALSE** (stale). Code: TRUE; list: OPEN (owner) | Refresh R1 to "Implemented; list pending owner approval (LD-12)". `age-rating.md` §1.3 and §2.3 ("a word filter refuses listed words", LR-16) are TRUE |
| 9.2 | R2, R4, R5, R7, R11, R15: "implemented on PR branches, not merged" | Reports and blocks API: `apps/api/src/moderation/` (reports, blocks, escalation, scope); app: `lib/features/moderation/` and the report sheet in `chat_screen.dart` and `profile_screen.dart`; Admin Web: `apps/admin-web/src/features/moderation/` | **FALSE** (stale): all merged | Refresh the statuses to "Implemented & verified on `main`" and cite the suites |
| 9.3 | R8 contact information: "Gap; nothing in the app" | `SupportLinksTiles` in Settings and the sign-in row (`settings_screen.dart:273-274`; `lib/core/legal/legal_links.dart:37-69`, `:76-120`), from `SUPPORT_URL` and `SUPPORT_EMAIL`; the store build script refuses to run without them (`build-store.sh:91`, `:124`) | **FALSE** (stale). Code: TRUE; the URL and address are OPEN (owner; #525 drafts the support page) | Refresh R8; LR-04 hosts the page |
| 9.4 | R9 terms | See §8 | TRUE ONLY AFTER #497 | — |
| 9.5 | R10 published CSAE standards; R12–R14 process, legal review, point of contact | Drafts exist (`docs/legal/child-safety-policy-*.md`); nothing published; LD-19 names the designate | Owner and counsel items | — |
| 9.6 | Review-notes sentence (pd57 §4, #530): "Reports are reviewed within 24 hours; child-safety reports go immediately to a restricted team" | `report-escalation.service.ts`, `moderation-scope.ts` on `main` (D-1 24 h due, 18 h / 24 h alerts; `child_safety` restricted) | TRUE in code; staffing the 24 h clock is the owner's (R3) | — |
| 9.7 | Age rating: UGC Yes, Messaging Yes, Social Media No (no public profiles, academy-published stories only) | `http_story_repository.dart:15-20` (the app cannot publish); conversations are set up by the academy (`authorization.service.ts`, BR-1) | TRUE; "Social Media: No" is an owner-confirmed judgment | — |
| 9.8 | IARC: the app does not share the user's location with other users | `subdivisionCode` is served only by `GET/PUT /me/location` (self) and the staff `parent-record.controller.ts` | TRUE as far as the controllers show (DEV-CONFIRM #11 remains for the route-permission matrix) | — |

## 10. Age rating, content rating and target audience (`age-rating.md`, `play-declarations.md` §1)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 10.1 | Only adults hold accounts (parents, teachers, Sales staff and the super admin); children have no account | `lib/shared/models/user_role.dart:9-21`; `http_auth_repository.dart:311-331` (any other actor kind is refused) | TRUE | — |
| 10.2 | No parental controls, no age assurance, no unrestricted web access, no ads, no gambling, no contests, no loot boxes | No such feature or plugin; web view limited (1.16); rewards are teacher-given (`lib/features/rewards/`); games are Quran activities (`apps/lessons/src/games/`: CompleteAyah, OrderAyat, Quiz) | TRUE | — |
| 10.3 | Target audience 18+, not Kids Category, Families policy not asked | Owner decision N-1 / LD-5 | OPEN (owner); the drafts say so | — |
| 10.4 | Child Safety Standards: "not required for this category, prepared answer if asked" | Owner decision; the in-app child-safety reason exists (`moderation` reasons on `main`); the URL and contact are LD-19 | OPEN (owner) | — |

## 11. Review accounts and review notes (`review-accounts.md`, #528, #530, `app-review-notes-payments.md`)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 11.1 | Review accounts exist in their own organization, sign in with e-mail and password, no code | `apps/api/src/cli/review-cohort.ts`, `provision-review-cohort.ts`; `review-cohort.spec.ts` | TRUE in code; UNVERIFIABLE until the workflow runs against production (LR-01, LR-05) | — |
| 11.2 | A third account `parent2` for the deletion test (#530 Notes and Play entries) | Added by #528 (`review-cohort.ts`, `review-cohort.yml`, `review-accounts.md` in `920b04c1`) | **TRUE ONLY AFTER PR #528 MERGES** and the workflow has run on production | — |
| 11.3 | `app-review-notes-payments.md` §4 and §5: "Settings → Payments → Amount due → Pay" | `/settings/payments` is retired and forwards to the Subscriptions tab (`lib/app/router.dart:131-142`); the parent's bottom bar shows "Subscriptions" (`app_shell.dart:108`, `tabSubscriptions`) | **FALSE** (#530 says so and uses the tab instead, but the payments doc itself still carries the old path) | Edit `app-review-notes-payments.md` §4–§5 to the tab path, or to whatever name LR-15 gives it |
| 11.4 | The review family has something to pay / "Pay" reachable | No subscription in the cohort (`review-accounts.md` "No payments", unchanged by #528) | TRUE that nothing is payable; OA-12 open (owner) | Seed a payable request or use #530 Option B |
| 11.5 | "Calls ring also when the app is closed (CallKit on iPhone)" | Code path on `main` and #524; server gate `APNS_VOIP_ENABLED` default off (`push.provider.selector.ts:51-67`) | UNVERIFIABLE until production turns the gate on and a device test passes (#530 §4 check 4) | If it stays off, remove the clause |
| 11.6 | "Staff work in a separate web portal, except the sales team and the senior administrator" | `user_role.dart:5-12`; `http_auth_repository.dart:316-331` | TRUE | — |
| 11.7 | Payments notes: only live one-to-one lessons are payable in the app; other charges are refused `409 COMM.PAYMENT_NOT_IN_APP`; no recording | `apps/api/src/billing/in-app-payability.ts`; `test/app/store_payments_policy_test.dart`; `call.service.ts:29` | TRUE | — |
| 11.8 | "Pay by card" appears only when Stripe is configured | `my_payments_screen.dart:181`, `pay_sheet.dart:31-36` (`cardAvailable`) | TRUE; LR-34 decides whether it is live at launch | — |
| 11.9 | PD-30 chat lock never locks the chat for payment; production enforcement off | `apps/api/src/platform/subscription-lock.ts:13`; `main.ts:124` logs the flag | TRUE in code; UNVERIFIABLE until production (`SUBSCRIPTION_LOCK_ENFORCED` must stay off, owner decision) | — |

## 12. Encryption in transit and export compliance

Covered in 2.4 (TRUE in code, `APP_ENV=production` operational) and 4.2.6 (TRUE). No answer is wrong.

## 13. Listing copy (`listing-copy.md`)

| # | Claim | Evidence | Verdict | Fix |
|---|---|---|---|---|
| 13.1 | Live one-to-one audio lessons, not recorded; family group and one-to-one chats; text, voice, photos, videos, files; voice calls; announcements; materials | §1.7, §1.8; `lib/features/calls/`, `lib/features/materials/`, `http_story_repository.dart` | TRUE | — |
| 13.2 | Card on Stripe's page or bank transfer with a receipt; payments and invoices shown | §1.4, §1.5, §1.10 | TRUE (card sentence conditional on LR-34) | — |
| 13.3 | App lock with Face ID, fingerprint or device passcode | `Info.plist:65-69`; `AndroidManifest.xml:14-17`; `lib/features/app_lock/` | TRUE | — |
| 13.4 | "Names stay hidden in lock-screen notifications unless you turn them on" | Default off: `apps/api/src/platform/app-config.service.ts:93` (`notification.lock_screen_names_default: false`); the toggle: `notification_settings_screen.dart:122-125`. But on `main` the billing and PD-30 notices scheduled outside the PD-34 pipeline could carry child names, amounts and receipt reasons on the lock screen; #536 routes them through the same rule (`apps/api/src/billing/lock-screen-push.ts` in `7053582f`) | **TRUE ONLY AFTER PR #536 MERGES** for payment notices; TRUE for chat today | Merge #536 |
| 13.5 | Report a message or a person; block a person | `lib/features/moderation/`; `chat_screen.dart`, `profile_screen.dart` (report sheet) | TRUE | — |
| 13.6 | Delete the account from Settings at any time | 7.9 | TRUE ONLY AFTER #498 (teachers) | — |
| 13.7 | Arabic and English | `Info.plist:9-13`; `lib/l10n/` | TRUE | — |
| 13.8 | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) | `ios/Runner.xcodeproj/project.pbxproj:409`, `:593`, `:618` (Runner); `"1,2"` at `:395`, `:525`, `:579` are the test targets | TRUE | — |
| 13.9 | The installed name is "Jawwid Chat" on iOS and "Jawwid" / «جَوِّد» on Android; the store name is an owner decision | `Info.plist:14-15`; `android/app/src/main/res/values/strings.xml:6`, `values-ar/strings.xml:5` | TRUE; OPEN (owner) | Decide the name; consider aligning `CFBundleDisplayName` |
| 13.10 | "Subscriptions" tab must not appear in screenshots | `tabSubscriptions` still on `main`; no accepted PR renames it (LR-15) | TRUE (still open) | LR-15 before shot 5 |

---

## 14. Prioritised mismatches

Ordered by what would make a submitted console answer untrue, then by stale documentation.

1. **Full-screen-intent declaration (P1).** The #530 declaration text describes the Android 14+
   `canUseFullScreenIntent` check, which exists only on #524 (stacked on #449). `main` never asks. Submit no
   build before #524 merges; verify on an Android 14+ phone (§5.3).
2. **Teacher deletion wording contradicts #498 (P1).** #530's review notes, `review-accounts.md` on `main`
   and in #528, and #525's public deletion page all say a teacher "cannot delete; contact the academy". After
   #498 the teacher requests deletion and is deleted within 30 days. Fix the three documents when #498 merges,
   and before anything is pasted or published (§7.4–§7.6).
3. **Notification permission prompt right after sign-in with no explanation (P1, LR-11).** Both platforms
   ask inside `startRegistering`; no accepted PR changes it. The Play row "when a notification first matters"
   is not what the code does; G-12 prominent disclosure is at risk (§6).
4. **Sentry automatic session tracking (P1).** `main` sends session data neither form declares. #526 turns it
   off. Merge before the release candidate, or declare it (§1.13, §2.8).
5. **`remote-notification` background mode with no use (P1, Apple 2.5.4).** #531 removes it. Merge before the
   release candidate; then update #530's `ios-background-modes.md` and the README row (§4.2.3).
6. **Terms gate not yet enforced server-side (P1 for the "users accept terms before posting" claim).** #497
   merges first in batch 6; production then needs the four published versions and the texts (N-3) (§8).
7. **Lock-screen privacy for payment notices (P2).** The listing's "names stay hidden" claim holds for chat
   today but not for billing pushes until #536 merges (§13.4).
8. **`app-review-notes-payments.md` paste text uses a retired path (P2).** "Settings → Payments" forwards to
   the Subscriptions tab; #530 already uses the tab. Edit §4–§5 of the payments doc (§11.3).
9. **`pd57-ugc-compliance.md` is stale (P2).** Its header says nothing is merged; reports, blocks,
   escalation, the content filter and the support contact rows are all on `main`; the app and Admin Web
   Terms gates are merged. Refresh R1, R2, R4, R5, R7, R8, R9, R11, R15 before anyone quotes it to a store
   (§9). The owner items (word-list approval LD-12, contact URL and e-mail, CSAE page, LD-19 designate,
   N-3 texts, N-4 labels, 24 h staffing) remain open.
10. **Store-console drafts on `main` predate LR-14, LR-32 and LR-73 (P2).** `apple-app-privacy.md` §5,
    `google-data-safety.md` §3.1 and `play-declarations.md` §5, §7 describe gaps that are closed. #527 fixes
    them; merge it (§1.14, §2.4, §4.1.2, §5.1).
11. **Review-account notes versus #528 and #498 (P3).** #498 says "no spare account is needed"; #528 adds
    `parent2`. Harmless, but pick one line for the pasted text (§7.8).
12. **Stale comment and citation (P3).** `AndroidManifest.xml:20` names `mayUseFullScreenIntent`, which
    does not exist (`canUseFullScreenIntent` after #524); the data inventory cites `checkout.service.ts:129`
    for the child's name (now `:147`) (§4.1.6, §2.2).
13. **Export compliance is answered only in a plist comment (P3).** Add one line to the store-console README
    so the console answer has a home (§4.2.6).

## 15. What remains UNVERIFIABLE until production or a device

- The merged Android manifest of the release AAB (Firebase's `WAKE_LOCK`, `c2dm.RECEIVE`, any `AD_ID`); the
  release-readiness workflow (#523) is the place to read it.
- Xcode's privacy report for the release archive (Sentry Cocoa's own declared types).
- `APP_ENV=production` on the live API (encrypted LiveKit signalling), `APNS_VOIP_ENABLED` (CallKit ring when
  closed), `SUBSCRIPTION_LOCK_ENFORCED` off, the four `legal.current.*` rows, the review-cohort workflow run.
- Background audio on a locked iPhone, the Android 14+ heads-up ring with full-screen intents denied, and
  the foreground-service video.
- The Google and Apple help pages were not re-read in this session; the drafts say where to re-read them.

## 16. Open owner and counsel decisions that the answers wait for

Unchanged from the drafts: target audience and Families (N-1 / LD-5, L-15), storefronts (LD-15 / LR-17),
store name and category, Social Media answer, Apple age override, Payment Info and religious-beliefs
declarations (counsel), Stripe's role and the child's name in the line item (L-4 / LD-8), Child Safety
Standards and the designate (LD-19), URLs and e-mails (LR-04 / LD-16), review credentials, the payable review
request (OA-12), live card payments (LR-34), the word list (LD-12), the Terms and Code of Conduct texts (N-3),
report-reason labels (N-4).
