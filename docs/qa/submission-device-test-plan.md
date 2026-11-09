# Device test plan for the store submission builds (Phase 1)

Owner: release-qa · Written 2026-11-02 against `main` @ `12189c9e`.
This plan is what the store builds must pass on real hardware before they are submitted. It covers what simulators and the local test stack cannot prove: real push, the call ring with the app closed, background audio, release signing, and account deletion.

It complements `~/jawwid-acceptance/device/device-checklist.md` (D-01..D-23). That checklist ran a release build against the **local** test stack, which has no push key. This plan runs **store-signed** builds against **staging with production-style credentials**. Gate ids (S-xx, G-xx) refer to `docs/qa/release-gate.md`.

## 0. When this plan can start

Each section names its own preconditions. Nothing here can pass today: these items are built but not provisioned, or not built yet.

| Needed | Status on 2026-11-02 |
|---|---|
| Staging deployed on DigitalOcean, HTTPS on a public domain | Owner steps 1–9, `docs/infrastructure/production-readiness.md` |
| APNs auth key (.p8) from the paid team in staging; `APNS_PRODUCTION=true` | Owner credential |
| `APNS_VOIP_ENABLED=true` settable in staging | **Code**: add to `infra/env/manifest.tsv` and the app spec (it is in neither today) |
| Firebase project, `FCM_*` in staging, `google-services.json` in the Android build | Owner credential + **code** (S-05: no FCM client yet) |
| LiveKit project in staging | Exists for staging (`secrets.md` §6.1); re-add `LIVEKIT_URL` |
| iOS distribution signing, `aps-environment = production` | Owner certificate + **code** (S-03) |
| Android upload key, release signing config | Owner keystore + **code** (S-04) |
| Android call UI (full-screen incoming call) | **Code** (S-06) |
| In-app account deletion | **Product decision + code** (S-01) |
| App crash reporting | Owner DSN + **code** (S-07) |

## 1. Builds under test

Every build in a run comes from **one** `main` sha, recorded in the results. The API address is always set with `--dart-define=JAWWID_API_BASE_URL=https://<staging-api>/api/v1`. A release build without it refuses to start; that is intended.

| Build | How | Installed by |
|---|---|---|
| **iOS release** | `flutter build ipa --release --dart-define=JAWWID_API_BASE_URL=…`, signed with the distribution profile, uploaded to **TestFlight** | TestFlight on the test iPhones. A TestFlight build uses the production APNs environment, which is exactly what we must prove. |
| **Android release AAB** | `flutter build appbundle --release --dart-define=JAWWID_API_BASE_URL=…`, signed with the upload key | Play Console **internal testing** track (preferred: it exercises Play App Signing), or `bundletool build-apks --connected-device` + `install-apks` for a quick loop |

Record per build: sha, version (`pubspec.yaml`, currently `0.1.0+1`, which must increase for every upload), bundle/application id, signing identity, and the `aps-environment` read back from the signed IPA:

```bash
codesign -d --entitlements - Payload/Runner.app
```

Check the signing certificate of the AAB:

```bash
keytool -printcert -jarfile app-release.aab
```

**Pass** if the entitlement says `production` and the AAB is not signed with the Android debug key (`CN=Android Debug`).

## 2. Devices

| Platform | Minimum set |
|---|---|
| iOS | One current iPhone (the owner's iPhone 16 Pro Max), plus one older iPhone on the lowest supported iOS (deployment target **15.0**) if available |
| Android | One physical phone on Android 14 or 15 (notification permission and full-screen-intent rules apply). Plus one emulator with **Google Play** services (FCM needs Play services), API 34 |

The other side of each call is the teacher web portal (`/teacher/`) in a desktop browser, or a second phone.

## 3. Test accounts

Use staging accounts made for the run: one parent with a family group, one teacher of that family, one admin. Credentials stay in the run's private notes, never in this file, a chat or a screenshot. Never type them through the Mac clipboard into a simulator. A fresh parent account is made for the deletion tests (§9), because they destroy it.

## 4. Install, sign-in and permissions

| ID | Step | Pass |
|---|---|---|
| SB-01 | Install the build fresh. Open it. | It reaches sign-in against staging; no fixture data; no crash. |
| SB-02 | Sign in as the parent. | The chat list loads from staging. |
| SB-03 | Accept the notification prompt (iOS on first launch; Android 13+ `POST_NOTIFICATIONS`). | The prompt appears once. Staging records **one** device token for this install. On iOS that is a standard APNs token **and** a VoIP token. On Android it is an FCM token. Release-qa checks the API's device table or logs. |
| SB-04 | Deny notifications on a second install, then enable them in Settings and reopen the app. | The token is registered on the next launch, with no reinstall needed. |
| SB-05 | Sign out. | That install's tokens are removed or deactivated on the server. A push sent to the account no longer reaches this phone. |

## 5. Push with production credentials (S-05, LAUNCH BLOCKER D-14/D-17b)

Precondition: the APNs key is in staging with `APNS_PRODUCTION=true`, and the FCM credentials are in staging.

| ID | Step | Pass |
|---|---|---|
| SB-10 | App in the **background**. The teacher sends a message in the family group. | The notification shows within ~10 s, with sender and preview according to the PD-34 rules. No phone number, e-mail or token in the payload (G-07); release-qa reads the provider log line. |
| SB-11 | App **killed** (swiped away). Repeat. | Same as SB-10. |
| SB-12 | Tap the notification. | It opens that conversation. The server re-authorizes the id (G-25), and a removed member is refused. Repeat SB-12 after removing the parent from the group: the tap must not show the conversation. |
| SB-13 | Five messages in a minute. | One coalesced push, not five (PD-34). The badge or unread count is correct on open. |
| SB-14 | Set the phone's time inside quiet hours (22:00–08:00, account time zone). Send a message. | No push during quiet hours. It appears in the Notification Center inside the app (ADMIN-011, #365). |
| SB-15 | Lesson reminder and a payment notification (trigger them from staging). | Each arrives. Tapping "View payments" opens Payments without a crash (PARENT-021, #368). |

## 6. The call ring with the app closed (S-06)

Precondition: `APNS_VOIP_ENABLED=true` in staging, iOS VoIP token registered (SB-03), Android call UI built. The caller is the teacher in the web portal. PD-19: a member may also start a call from the phone.

| ID | App state on the phone | Pass |
|---|---|---|
| SB-20 | **Foreground** | The in-app incoming call screen appears within ~3 s. Answer: two-way audio. |
| SB-21 | **Background** (home screen) | iOS: the CallKit incoming-call screen. Android: a full-screen call notification (heads-up if the phone is unlocked). Answer → the app opens into the call with two-way audio. |
| SB-22 | **Killed** (swiped away) | Same as SB-21. **This is the key test.** On iOS, PushKit must report the call to CallKit before its handler returns, or iOS stops delivering VoIP pushes to the app. Any crash or missing ring is a FAIL that blocks submission. |
| SB-23 | **Locked**, app killed | The ring shows on the lock screen. Answer from the lock screen → two-way audio before unlocking. Unlocking keeps the call. |
| SB-24 | Killed. The caller hangs up before the answer. | The ring stops on the phone within a few seconds. The group shows a missed-call card. No ghost call is left in iOS Recents or the Android call log. |
| SB-25 | Killed. **Decline** from the ring screen. | The caller sees "declined". The call ends for both (PD lifecycle: decline is terminal). |
| SB-26 | Two calls. A second call arrives while one is active. | It is refused or shown as busy; the first call is not dropped. |
| SB-27 | Do Not Disturb / Focus on | Behaviour follows the OS setting. Write down what happens. Not a FAIL unless the app crashes. |
| SB-29 | Android, **locked** (screen lock set, app lock off). Answer from the lock screen, talk, end the call, then press the power button twice. | The lock screen shows, not the app: after the call nothing in the app is reachable without unlocking. During the call the app stayed over the lock screen. |
| SB-39 | Android 14, **locked** (PIN and fingerprint set, app lock off), a chat open in the app before locking. (1) Answer from the lock screen. During the call press Back, then cancel the unlock prompt; press Back again and unlock; then, still in the call, press the power button twice. (2) In a second call answered from the lock screen, let the caller hang up; then unlock the phone and tap **Record voice message**. (3) In a third call, let the caller ring out, do not touch the phone, and wake the screen after 2 minutes. (4) With no call, lock the phone and unlock it with the fingerprint, ten times. | (1) Back first shows Android's unlock prompt. Cancelled: the call screen stays, with its controls. Unlocked: Back leaves to the app as usual, and after the power button the lock screen shows, not the app. (2) When the caller hangs up the lock screen comes back at once; after unlocking, Record voice message opens the conversation with no second prompt. (3) Waking the screen shows the lock screen (the ring's window is 90 s). Write down any brief flash of the call screen or a black screen before it (a known, accepted gap, not a FAIL); any chat, list or tab is a FAIL. (4) The app comes back as it was: never a black screen with a lock icon. Throughout: no chat, list or tab is ever shown before unlocking (LR-46). |

Release-qa matches every SB-2x against the API log: `incoming_call` scheduled per participant, the provider's accepted response, the media-token issue, and the join.

## 7. Calls in the background (audio continuity)

| ID | Step | Pass |
|---|---|---|
| SB-30 | In a call, press Home and open another app for 2 minutes. | Audio continues both ways. The OS shows the in-call indicator (iOS green pill / CallKit; Android ongoing notification). On iOS, CallKit owns the audio session. If audio stops when backgrounded, the cause to check first is the missing `audio` background mode. |
| SB-31 | In a call, lock the phone for 2 minutes. | Audio continues; unlock returns to the call. |
| SB-32 | In a call, switch Wi-Fi off (mobile data on), then back on. | The call reconnects within ~10 s or ends cleanly on both sides. Never a call that stays "active" on one side (CHATSCHED-013, #367). |
| SB-33 | Bluetooth headset or AirPods connected mid-call. | Audio moves to the headset. |
| SB-34 | A regular phone call comes in during a Jawwid call. | The OS interruption is handled. After the phone call, the Jawwid call resumes or ends cleanly. |
| SB-35 | Hang up from the CallKit or notification controls without opening the app. | The call ends for both. |

## 8. Release-build behaviour that simulators miss

| ID | Step | Pass |
|---|---|---|
| SB-40 | Send a photo, a 2-minute video and a voice note from the phone. Play each on the other side. | Each is uploaded to the production-style bucket over HTTPS with a publicly trusted certificate (no local CA). Each plays (CHATSCHED-010, #373). |
| SB-41 | Leave the app in the background for 30 minutes, then open it. | Still signed in. The token refresh happens without a sign-out (G-16 / PARENT-015). |
| SB-42 | Restart the staging API while the app is open. | Realtime comes back without relaunching the app (PARENT-015, #360). |
| SB-43 | Airplane mode, send 2 messages, then turn the network back on. | Both are delivered exactly once, in order (G-15, G-28). |
| SB-44 | Make a deliberate test crash, if the crash reporter offers one. | It appears in Sentry (S-07), with no message text, names or tokens in the event. |
| SB-45 | Rotate the phone, increase the text size, switch to Arabic and to dark mode. | Nothing is clipped. RTL is correct. |

## 9. Account deletion (S-01, once built)

The behaviour expected here must be fixed by the owner's product decision before the tests are written in detail. Each check below assumes the store rules: deletion starts in the app, is confirmed, and is not just a deactivation the user cannot complete.

| ID | Step | Pass |
|---|---|---|
| SB-50 | Settings → Delete account. | Reachable in at most a few taps from Settings. It explains what is deleted and what is kept, and why. It asks for re-authentication or confirmation. |
| SB-51 | Confirm. | The user is signed out on this device. Every other session of the account is revoked within seconds (a second phone signed in to the same account is signed out). The push tokens are removed. |
| SB-52 | Try to sign in again with the old credentials. | Refused. |
| SB-53 | Staff view (Admin Web) of the family. | The deleted person is shown as deleted or anonymised as decided. Their messages are kept or anonymised as decided. Payments and lesson records follow the retention decision. Nothing names them where the decision says it must not. |
| SB-54 | The web deletion link (Google Play requirement). | A user who has uninstalled the app can request deletion from the web page linked in the Play listing. |
| SB-55 | A family's last guardian deletes their account. | The family's other people and the teacher are unaffected. The admin sees what needs attention. |

## 10. Store-review dry run

| ID | Step | Pass |
|---|---|---|
| SB-60 | The review accounts given to Apple and Google sign in on a clean device. | They reach a populated chat and can place a call. The App Review notes explain that calls are voice only and who the users are. |
| SB-61 | Every permission prompt's text (camera, photos, microphone, Face ID, notifications). | Each says why in plain words. No prompt appears before the feature needs it. |
| SB-62 | Privacy manifest and the Data safety / App Privacy answers. | They match what the build actually collects (S-02). |

## 11. Recording results

Write each SB row as **PASS**, **FAIL + what you saw**, **BLOCKED + by what**, or **N/A + why**.
- Record the build sha, device, OS version and time.
- Keep the evidence (screen recording or screenshot, plus the matching server log lines) under `~/jawwid-acceptance/device/submission/<sha>/`.
- Release-qa adds the rows to `device/matrix.csv` and re-runs `final/consolidate.py`.

A store build is submittable only when:
- every SB row in §4–§8 and §10 passes;
- §9 passes once account deletion exists;
- S-01..S-08 in the release gate are PASS.

SB-27 may be recorded as observed.
