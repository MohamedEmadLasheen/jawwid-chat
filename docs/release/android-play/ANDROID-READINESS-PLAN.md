# Android release readiness: device-first plan (Jawwid Chat 1.0.0 code 3)

> **Update 2026-11-18:** owner decisions confirmed: audience children, parents and teachers; free; worldwide; name Jawwid; Education proposed. Sections 5 and 9 below are superseded where they conflict (name, audience 18+, storefront shortlist). See `OWNER-DECISIONS-REGISTER.md` for the current register and `VERIFICATION-SUMMARY.md` for the policy status. Families Policy now applies; its gaps (SDK status, safety reminder, age-screen question, child data in Data safety) are in `verification-part-C.md` and none is closed. Payments stays OPEN.


Evidence base: `PERMISSIONS-AUDIT.md` (accepted), `merged-manifest-1.0.0-3.xml`, `PLAY-CONSOLE-CHECKLIST.md`. Source commit `2e41270151514df9dd560f79862d03f531b9f09d`.
Nothing here installs software, touches a device, uploads to Google Play, or changes code, copy or production.

## 1. Disk pressure (identified, not cleaned)
- Free space on this Mac swung 8.5 GB, 6.6, 2.9, 7.9, 1.8, 6.7 GB within hours. Two emulator installs were stopped by my floors (3 GB, 2 GB) and left nothing behind (no `emulator/` or `system-images/` folder).
- Known large folders (measured with `du`): `~/Library/Caches` 9.0 GB, `~/.gradle` 7.4 GB, `~/Library/Android` 5.6 GB (pre-existing SDK/NDK), `~/.pub-cache` 985 MB, `/private/tmp` 616 MB. I did not find a single file explaining the swings; other sessions on this shared Mac probably build at the same time. Nothing was deleted.
- Decision: no emulator. Use a physical phone.

## 2. Physical-device procedure (owner)
Tools present: `adb` 1.0.41 at `the Android SDK/platform-tools/adb`. `adb devices` currently lists no device.
1. On the phone: Settings > About phone > tap Build number 7 times > Settings > System > Developer options > USB debugging ON. Prefer a phone with Android 14 or later; a second, older phone (Android 8 to 10) covers the minimum (minSdk 26).
2. Connect by USB, accept the RSA prompt on the phone, then in Terminal: `the Android SDK/platform-tools/adb devices` should list the phone as `device`.
3. Best path, no sideloading: the first Play internal-testing upload. Owner action later; **not done now**.
4. Sideload path (only with the owner's explicit go-ahead; nothing is installed until then): from the exact bundle I generate a device-specific APK set with bundletool, signed with the local debug key (so it is not the release signature, and Play-signed behaviour such as in-app updates is not tested). The owner then runs `adb install` on their own phone. Remove afterwards with `adb uninstall com.jawwid.jawwid_chat`.
5. Never enter a review password into a chat or script. The owner types it into the app on the phone.
Limits to state honestly: push (FCM) and the full-screen call ring depend on Google Play services and on the Play-delivered build; a debug-signed sideload may behave differently from the Play build.

## 3. Test plan (owner executes; each step records PASS / FAIL / BLOCKED plus a note)
Account: `parent@review.chat.jawwid.com`, and `teacher@review.chat.jawwid.com` on a second device or browser for the other side. Deletion test only on `parent2@review.chat.jawwid.com`.
1. **Login / session:** sign in; force-stop and reopen (still signed in); reboot the phone (still signed in); sign out; wrong password shows a clear error.
2. **Messaging:** open the family group; send text; receive teacher reply; read ticks; delete for me.
3. **Image sharing:** attach a photo from the picker; send; open it; no storage/camera permission prompt should appear (the app uses the system picker). If the camera is used, note which prompt appears.
4. **Push:** allow notifications when asked (note exactly when the prompt appears: LR-11 says `main` may ask right after sign-in); with the app closed, teacher sends a message; notification arrives with generic lock-screen text; tapping opens the right chat.
5. **Arabic / RTL:** Settings > Language > Arabic; check chat list, conversation, schedule, call screen and settings mirror correctly; numerals and dates read correctly; switch back.
6. **App lock:** turn on; background the app 1 minute; return and unlock with fingerprint/face and with device PIN; turn off.
7. **Microphone:** record a voice note: permission prompt appears only on first press; deny, then check the app explains and does not crash; grant and retry.
8. **Outgoing call:** from a chat tap the phone icon; second device answers; speak both ways; speaker/mute; hang up. The call notification must show while the app is backgrounded (microphone foreground service).
9. **Incoming call:** with the phone locked and the app closed, teacher starts a call; expect the full-screen ring (Android 14 or later needs the full-screen-intent permission; if not granted, a heads-up with Answer/Decline). Test Answer and Decline from the notification.
10. **Background behaviour:** during a call press Home and open another app (call must stay alive), lock the screen (call continues), switch Wi-Fi to mobile data (call recovers or ends cleanly).
11a. **Android 14+ microphone foreground-service start (flagged by the policy research, not yet tested):** Android restricts starting a microphone foreground service from the background. With the app closed, answer an incoming call from the notification (Answer button) and from the full-screen ring; confirm the call connects with working audio in both and that the app does not crash or drop the call. Record the Android version.
11. **Notification actions:** "Decline" on the ring and "Hang up" on the ongoing-call notification both end the call correctly.
12. **Account deletion:** `parent2` only: Settings > delete account; confirm; sign-in then fails; confirm the main parent account is unaffected.
13. **Connectivity:** airplane mode on and off inside a chat: sending queues or fails clearly, then recovers.
For the foreground-service video, record steps 8 and 10 with the phone's built-in screen recorder, showing the persistent notification (shot list in `PLAY-CONSOLE-CHECKLIST.md` section 4).

## 4. Declarations reviewed against the actual code (read at `origin/main` 2e412701)
- **Foreground service:** `CallForegroundService` is started from `MainActivity` when a call begins (the Dart layer asks over a method channel) and stopped when it ends or via the notification's Hang up. Its type is `microphone` only (merged manifest `foregroundServiceType=0x80`). The declaration "microphone stays open during a call while the app is backgrounded or the screen is locked" matches the code. The phone-call type is not declared (LR-14), which is correct for an app without a Telecom ConnectionService.
- **Full-screen intent:** the incoming-call notification calls `setFullScreenIntent(open, true)` (`JawwidPush.kt:161`) and checks `canUseFullScreenIntent` (`JawwidPush.kt:167`) before assuming it. When it is not allowed it falls back to a heads-up notification with Answer and Decline. The declaration (incoming calls ring over the lock screen) matches.
- **Settings opener correction:** `openFullScreenIntentSettings` exists in Dart (`lib/core/call_native/call_presentation.dart:225`) and in `MainActivity.kt`, but **nothing in `lib/` calls it** (`git grep` finds only the definition). The Play declaration and the review notes must **not** say the app offers a settings shortcut; they may say it checks the permission and falls back to a heads-up notification.
- **Permissions:** reconciled with the real merged manifest in `PERMISSIONS-AUDIT.md`: add `MODIFY_AUDIO_SETTINGS` and `BLUETOOTH` (API 30 and below; LiveKit audioswitch), `USE_FINGERPRINT` (androidx.biometric), the internal `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (androidx.core); `WAKE_LOCK` and c2dm RECEIVE are now confirmed (firebase-messaging manifest); replace the sentence "livekit_client and flutter_webrtc add none".
- **Advertising ID:** CHECKLIST row 12 "UNVERIFIED until the first signed bundle's evidence" is now resolved: `AD_ID` is absent from the signed bundle's merged manifest.

## 5. Naming strategy (proposal, needs owner decision)
Current: iOS display name "Jawwid Chat"; Android launcher label "Jawwid" (Arabic "جَوِّد"); proposed store title in `listing-copy.md`: "Jawwid: Quran Academy" (AR "جَوِّد: أكاديمية القرآن"); the Play/Apple privacy policy is titled "Jawwid Academy".
Recommendation: **one recognisable brand word, "Jawwid"**, everywhere a user sees it.
- Store title (both stores, 30 characters max): "Jawwid: Quran Academy" (21).
- Launcher/home-screen name: "Jawwid" on Android (already) and, when convenient, on iOS (currently "Jawwid Chat", a one-line plist change that needs separate authorization). Both stay recognisable as the same app.
- Keep "Jawwid Chat" only as the internal/project name and the review-notes wording.
- Keep the policy title "Jawwid Academy" but make sure it names the app and the operator once; any wording change is legal and needs approval.
Because "Quran" appears in the title and the tagline, the owner's approval of the religious wording is needed before it is entered in a console.

## 6. Card-payment wording and PR #591 (nothing merged or changed)
- On `main`, `listing-copy.md` line 116 still says: "Pay for a lesson package by card on Stripe's secure page, or by bank transfer...". That contradicts the paused-card state and the owner's order.
- #591 (`claude/lr71-console-truth`) changes that line to "Pay for a lesson package by bank transfer, with the transfer receipt uploaded in the app" and ticks "No card sentence in the copy" (its line 232). Use #591's wording for the Play full description, and for the Data safety / payments declarations.
- Until #591 is merged, paste from #591's branch, not from `main`.

## 7. Feature graphic review (not replaced, not published)
Current file: `feature-graphic/feature-graphic-1024x500.png`: logo lockup centred on #FBFAF8 with the English short description and a gold rule. Format PASS (1024x500, RGB, no alpha).
Proposed improvements (need a source asset or approval):
1. **Sharpness:** the lockup is only 372 px wide and upscaled about 1.34x. Ask for the original vector (SVG or PDF) or a PNG at least 1400 px wide; re-export at 1024x500 without scaling.
2. **Visual quality:** use the brand teal (#107C70 from the app theme) as a full-bleed background with a white lockup variant, or keep the off-white and enlarge the logo; today about 55% of the canvas is empty space.
3. **Wording:** replace the full sentence with a shorter line (it is the Play short description, which is already shown beneath the graphic); the Quran wording is subject to approval.
4. **Arabic:** an Arabic version needs a tool with text shaping (Figma or similar); Pillow here has none and I do not install system packages.
5. Keep: no device frames, no prices, no ratings, 70% safe area.

## 8. What can be completed before any runtime test
Ready to enter now (values in `PLAY-CONSOLE-CHECKLIST.md`): app creation, privacy policy URL, ads declaration (No), data safety (after correcting permissions text), content rating questionnaire, target audience (pending decision), foreground-service and full-screen-intent declarations (text; the video is still needed), store listing text (pending #591 and name decisions), feature graphic (pending approval), internal-testing tester list.
Cannot be completed without a device or runtime evidence: Android screenshots, foreground-service video, the Play Console's own permission list after upload, and all QA results.

## 9. Owner decisions required
1. Store title / launcher name strategy (section 5), including whether the iOS display name changes.
2. Approval of the Quran wording in the title, tagline and graphic.
3. Target audience (18+ recommended), category (Education recommended), storefronts.
4. Child Safety Standards: whether to answer "not applicable" (the agent found Google's scope covers social, dating, anonymous and random-chat apps; this app is none of them; UNVERIFIED beyond the pages read on 2026-11-18).
5. Merge #591 (card-free copy and legal wording) or provide approval to use its wording.
6. Developer account type (Play Console > Settings > Developer account > Account details) and, if personal and created after 2023-11-13, accept the 12-tester / 14-day closed test.
7. Approve a physical phone for testing and whether the sideload path (section 2, step 4) is acceptable.
8. Provide a vector logo (feature graphic sharpness).
