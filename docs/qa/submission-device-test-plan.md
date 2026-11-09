# Device test plan for the store submission builds (Phase 1)

Owner: release-qa · Written 2026-11-02 against `main` @ `12189c9e`.
This plan is what the store builds must pass on real hardware before they are submitted. It covers what simulators and the local test stack cannot prove: real push, the call ring with the app closed, background audio, release signing, and account deletion.

> **Update 2026-11-08 (LR-08).** §12 is the run sheet for the **first signed build**, written against `main` @ `6e0e1438`. It is the order to run things in, in one sitting, on one iPhone and one Android 14+ phone. Where §12 and §0–§1 disagree, §12 is current: `scripts/mobile/build-store.sh` (#502) now refuses any staging, test or IP host, so a store build always talks to the **production** backend (LR-01), not staging. The SB rows in §4–§10 still apply; §12 names the ones it covers.

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
| SB-28 | iOS only. **Killed** (swiped away). The teacher calls from the portal. Answer or decline, kill the app again, and repeat until it has been done 3 times. (LR-13) | The CallKit ring appears all 3 times. The app is never terminated by iOS: in Console.app, filtered to the app's process, there is no PushKit termination message (a VoIP push the app did not report to CallKit). |
| SB-29 | Android, **locked** (screen lock set, app lock off). Answer from the lock screen, talk, end the call, then press the power button twice. | The lock screen shows, not the app: after the call nothing in the app is reachable without unlocking. During the call the app stayed over the lock screen. |

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
- S-01..S-08 in the release gate are PASS;
- every §12 row that applies to the build (its "after #NNN" PR is merged) passes.

SB-27 may be recorded as observed.

## 12. LR-08 run sheet: the first signed build (main @ `6e0e1438`, 2026-11-08)

This section is for the owner and QA, sitting together with one iPhone and one Android 14+ phone. Every row starts **NOT RUN**. Write the result in the Result column using the §11 words (PASS / FAIL + what you saw / BLOCKED + by what / N/A + why). Do not mark a row from memory, from CI, or from a simulator.

### 12.0 What is on `main` that this run must prove

| PR | What changed | Rows |
|---|---|---|
| #500 | Admin Web Terms of Use gate. It does nothing until the API sends a `legal` block (#497) | W-01 |
| #504 | App Terms of Use gate ("Before you continue") and the terms boxes on parent sign-up. Both stay hidden until the API sends the documents (#497). On today's API there is no gate and no boxes | I/A-03, I/A-05, I/A-T1..T3, A-T4 |
| #505 | The Android call service is typed `microphone` only (no `phoneCall`) | A-10..A-14, A-60 |
| #509 | The microphone is asked **before dialling**, and a refusal rings nobody. The Android call service starts only after the grant. All call prompts share one question, so two never overlap. Closing a failed call tears down the media | I-10..I-13, A-10..A-14 |
| #502 | Store builds need `BUILD_NAME` and `BUILD_NUMBER`, refuse non-production hosts, and require the Sentry DSN | I-01, A-01 |
| #506 | Production refuses a `ws://` LiveKit URL (LR-32), and message-list cursors are validated (LR-38) | Every call row; I/A-20 (history) |
| #508 | iOS privacy manifest. It is proven by the upload (LR-48), not on the phone | none |
| #511 | The app log masks token values. Not visible on the phone | none |

**Not merged on 2026-11-08** (rows that need these say "after #NNN merges"; skip them until then):

- #497: the API terms gate (LR-02a), plus the terms rows (LR-02d).
- #498: teacher deletion (LR-03).
- #449: a push opens its item (LR-11a); it is also needed for LR-13 and LR-27.
- #503: honest report/block refusal for protected staff, and no CSV in the picker (LR-25, LR-35).

### 12.1 Before the sitting (all must be true, or the named rows are BLOCKED)

| # | Precondition | Tracker | Rows that need it |
|---|---|---|---|
| P-1 | The production backend is live: `/health/ready` returns 200 on the production API host | LR-01 | All |
| P-2 | Signed builds from **one** `main` SHA (`6e0e1438` or later), made with `scripts/mobile/build-store.sh` (`BUILD_NAME`, `BUILD_NUMBER`, `SENTRY_DSN`). iOS goes through TestFlight; Android is an AAB on the Play internal testing track | LR-76, LR-06, LR-07b/c, LR-48, LR-49 | All |
| P-3 | Push credentials on production: the APNs key, `FCM_*`, and `google-services.json` in the Android build | LR-47 | I/A-22, I/A-15..18 |
| P-4 | `APNS_VOIP_ENABLED=true` on production | LR-12 | I-15..I-18 |
| P-5 | The review cohort is provisioned on production (`docs/release/review-accounts.md`). Its passwords are only in the run's private notes | LR-05 | Most rows |
| P-6 | Disposable accounts, which the owner provides: (a) three parents to delete: one per phone for I-40 and A-40, and a third for the web page in A-42 (otherwise use the review parent for I-40 and A-40 and re-run the provisioning command after each deletion, per review-accounts.md "Run it again"; A-42 always needs a disposable parent); (b) one parent record with **no account yet**, whose e-mail the tester can read, for sign-up, plus a second one for the after-#497 sign-up row; (c) for I/A-41 only, a disposable teacher with a child or lessons ahead. **Never use the review teacher for this:** re-provisioning refuses after its erasure | LR-43, LR-65, LR-03 | I/A-05, I/A-T3, I/A-40..42 |
| P-7 | The other side of every call and message: the teacher web portal (`/teacher/`) in a desktop browser, signed in as the review teacher, with its speaker and microphone on | — | Call and message rows |
| P-8 | Screen recording is ready. iPhone: the Control Center Screen Recording button. Android 14: the Quick Settings Screen record tile. A second phone or camera films the portal side for the audio rows | — | All |
| P-9 | The owner's approval to restart the production API once (I/A-21). Without it, those rows are BLOCKED | LR-44 | I-21, A-21 |

**Evidence rules.** Save the files under `~/jawwid-acceptance/device/submission/<sha>/`, named `<row id>-<short>.png` or `.mp4`. Stop the recording, or keep the field obscured, while a password or code is typed. Show no real person's name, face or child. The review cohort is fictional.

**Record once, for both phones:** the `main` SHA, `BUILD_NAME`+`BUILD_NUMBER`, the API host, the date and the start time. Record per phone: the model and OS version.

### 12.2 iPhone (the owner's iPhone 16 Pro Max; record the iOS version)

Row ids are paired across the two platforms: I-15 and A-15 are the same check. The gaps in the numbering are deliberate.

| ID | Tracker | Preconditions | Steps | Expected result | Evidence | Result |
|---|---|---|---|---|---|---|
| I-01 | LR-08, LR-21 | P-2 | 1) In TestFlight, open the build page. 2) Release-qa reads `aps-environment` from the signed IPA (§1). | The version and build number equal the `BUILD_NAME (BUILD_NUMBER)` of the build log. `aps-environment` is `production`. | Screenshot of the TestFlight build page; the `codesign` output in the run notes | NOT RUN |
| I-02 | LR-08, LR-43, SB-01 | P-1, P-2. No Jawwid app on the phone (delete it first) | 1) Install from TestFlight. 2) Open it. 3) Wait 10 s on the first screen. | Sign-in screen, no crash, no sample data. "Help and support" and "Contact support" are under the form. No notification or microphone prompt before sign-in. | Recording from the icon tap to the sign-in screen | NOT RUN |
| I-03 | LR-43, LR-02b, SB-02, SB-03 | I-02; P-5 | 1) Sign in as the review parent with a wrong password. 2) Sign in with the right one. 3) Note when the notification prompt appears; tap Allow. | 1) An error message, no crash, still on sign-in. 2) The chat list loads: the family group and the 1:1 with the supervisor. **Today (no #497): no "Before you continue" screen.** 3) The prompt appears once. On `main` it shows right after sign-in; LR-11 moves it later (after #449). Record when it showed; that timing is not a FAIL here. | Recording (password field obscured); screenshot of the chat list | NOT RUN |
| I-04 | LR-43, SB-05 | I-03 | 1) Settings → Sign out. 2) Sign in as the review teacher. 3) Sign out, then sign in as the parent again. | 1) A "Sign out of Jawwid on this device?" confirmation; tap Sign out; then back to sign-in. 2) The teacher sees the same family group, the 1:1 with the supervisor, and Yahya's lessons. 3) The parent is signed in again. | Screenshots after each sign-in | NOT RUN |
| I-05 | LR-43, LR-02b | P-6(b), signed out | 1) Sign-in screen → "New parent? Create your account". 2) Enter the record's e-mail → "Get my code". 3) Enter the 6-digit code from WhatsApp and a password twice → "Create account". 4) Sign in with the new account. | 2) "Your supervisor will send you a 6-digit code on WhatsApp…". 3) **Today (no #497): no terms boxes**, and the account is created. 4) The chat list loads, with no gate. | Recording (code and password not legible) | NOT RUN |
| I-T1 | LR-02b, LR-02a | **After #497 merges**, and the terms rows are loaded (LR-02d). An account that has not accepted the current version | 1) Sign in. 2) On "Before you continue", tap Open on each document, then come back. 3) Try Agree with nothing ticked. 4) Tick every box → Agree. 5) Kill the app and reopen it. | 2) There is one row per document (Terms of Use, Code of Conduct), titled in the app's language, and Open shows that language's page. 3) Agree is not possible: the boxes are never pre-ticked. 4) The gate lifts and the chat list appears. 5) No gate. | Recording | NOT RUN |
| I-T2 | LR-02b | After #497 merges; the gate is up (a second unaccepted account, or before I-T1 step 4) | 1) Tap Privacy policy, then come back. 2) Tap Delete account, then go back **without** deleting. 3) Tap Sign out. | 1) The policy opens. 2) The Delete account screen opens over the gate; Back returns to the gate. 3) A "Sign out of Jawwid on this device?" confirmation first; tap Sign out; then back to sign-in. | Recording | NOT RUN |
| I-T3 | LR-02b, LR-43 | After #497 merges; the second record from P-6(b) | Repeat I-05, but first try "Create account" with the boxes unticked, then tick them. | The Terms of Use and Code of Conduct boxes show unticked. With any box unticked, nothing is sent. Once ticked, the account is created, and it signs in with no gate. | Recording | NOT RUN |
| I-10 | LR-74, LR-14 | **Fresh install** (delete and reinstall); signed in as the parent; P-7 | 1) In the family group, start a voice call. 2) At the microphone prompt, tap **Don't Allow**. 3) Look at the teacher portal. 4) iOS Settings → Jawwid → Microphone on. 5) Back in the app, start the call again; the teacher answers; both speak. | 1) The prompt appears **before** anything rings. 2) The app says "Jawwid needs microphone access to make calls." 3) The portal **never rang**. 4) iOS may restart the app after a permission change; that is not a FAIL. 5) The call rings, connects, and has two-way audio. If every call fails with a configuration error, check that `LIVEKIT_URL` is `wss://` (LR-32). | Phone recording; portal-side screenshot or recording at step 3 | NOT RUN |
| I-11 | LR-14, LR-74, SB-31 | The I-10 call is live | 1) Lock the phone for 2 minutes, speaking from both sides. 2) Unlock. | 1) Audio continues both ways throughout, and iOS shows its in-call indicator. 2) The app is still in the call. | Portal-side recording with sound; phone recording before and after the lock | NOT RUN |
| I-12 | LR-74 | Fresh install again; signed in as the parent; the app in front | 1) The teacher calls the parent from the portal. 2) Answer. 3) At the microphone prompt, tap Allow. 4) Lock the phone for 1 minute. | 3) Exactly **one** prompt. The call goes live after Allow. 4) Audio continues both ways. | Phone recording | NOT RUN |
| I-13 | LR-74 | A live call (any of the above) | 1) Turn on Airplane Mode. 2) Tap Hang up. 3) When the call shows as failed, close the call screen. 4) Watch the status bar for 10 s. 5) Turn Airplane Mode off. | 4) The orange microphone dot goes off within a few seconds of closing; no call screen is left. 5) The app works normally. Record what the portal shows; it must not stay "in call" with nobody there (CHATSCHED-013). | Recording showing the status bar | NOT RUN |
| I-15 | LR-12, SB-22 | P-3, P-4; notifications allowed; release-qa confirms that a VoIP token is registered for this install | 1) Swipe the app away. 2) The teacher calls. 3) Answer on the CallKit screen. 4) Talk, then hang up from the phone. | The CallKit incoming-call screen appears, with no crash. On Answer the app opens into the call, with two-way audio. The call ends on both sides. If the ring is missing, also record LR-13 (the PushKit registry is created only after Dart starts; its fix waits for #449). | Recording; release-qa saves the matching API log lines | NOT RUN |
| I-16 | LR-12, SB-23 | As I-15; the phone locked | 1) App killed, phone locked. 2) The teacher calls. 3) Answer on the lock screen; talk; then unlock. | The ring shows on the lock screen. There is two-way audio before unlocking, and unlocking keeps the call. | Recording by a second camera (the screen recorder stops on lock) | NOT RUN |
| I-17 | LR-12, SB-24 | As I-15 | App killed. The teacher calls, then hangs up before you answer. | The ring stops within a few seconds. The group shows a missed-call card. No ghost call is left in iOS Recents. | Recording; screenshot of the card | NOT RUN |
| I-18 | LR-12, SB-25 | As I-15 | App killed. The teacher calls; tap **Decline**. | The portal shows "declined", and the call ends for both. | Recording; portal screenshot | NOT RUN |
| I-20 | LR-44, LR-38, SB-43 | Signed in as the parent, in the family group | 1) Scroll up to the top of the history. 2) Turn on Airplane Mode for 30 s and send 2 messages. Meanwhile the teacher sends 1. 3) Turn Airplane Mode off and wait, without relaunching. | 1) Older messages load with no error. 3) Both messages are delivered once, in order, and the teacher's message appears, all without a relaunch. | Recording; portal screenshot | NOT RUN |
| I-21 | LR-44, SB-42 | P-9. The app open in the family group (run together with A-21) | 1) Release-qa restarts the production API. 2) Wait for `/health/ready` to return 200. 3) The teacher sends a message. | The message appears **without relaunching** the app. Write down how long it took. | Recording with the clock visible | NOT RUN |
| I-22 | S-05, LR-47, SB-10, SB-11 | P-3; notifications allowed | 1) App in the background: the teacher sends a message. 2) App killed: repeat. 3) Tap the notification. | 1–2) A notification within about 10 s, following the PD-34 preview rules. 3) The app opens. **Opening the exact conversation is checked after #449 merges** (LR-11a); today, record what opens. | Recording | NOT RUN |
| I-30 | LR-25, LR-64 | **After #503 merges.** The parent is in a conversation with a protected person (the official account, a manager or the Super Admin); release-qa names who in the run notes. The supervisor is ordinary staff | 1) Open the protected person's **profile** → Report → pick a reason → Report. 1b) Optional: long-press one of their **messages** → Report → pick a reason → Report. 2) Block them. 3) Report a message of the ordinary supervisor, then cancel or file it. 4) Switch the phone to Arabic and repeat steps 1 and 2. | 1) The profile report is refused with: "This account can't be reported in the app. If you have a concern, send it through Settings → Contact support." It is **not** "This kind of message cannot be reported". 1b) A **message** report keeps the old wording, "This kind of message cannot be reported."; that is correct, not a FAIL. 2) Block is refused with its own text: "This person can't be blocked. If you have a concern, send it through Settings → Contact support." When the app knows a support e-mail, it reads instead "This person can't be blocked. If you have a concern, please contact support at {the e-mail}."; either is a PASS. 3) The report sheet works (staff can be reported). 4) The same refusals in Arabic. | Screenshots in English and Arabic | NOT RUN |
| I-31 | LR-35 | **After #503 merges.** A `.csv` file in the Files app | In a chat, attach a document and browse to the `.csv`. | It cannot be chosen; other allowed documents can. | Screenshot | NOT RUN |
| I-40 | LR-65, LR-03, SB-50..52 | P-6(a) parent signed in on the iPhone **and** on the Android phone at the same time | 1) Settings → Delete account. Read the screen. 2) Enter a wrong password → Delete my account. 3) Enter the right password → Delete my account → confirm. 4) Watch the Android phone. 5) Try to sign in again with the old credentials. 6) Look at the family group on the portal. | 1) It is reachable in a few taps, and says what is deleted now and what is kept. 2) "That password is not right." 3) "Your account has been deleted.", then the sign-in screen. 4) The Android session is signed out within seconds. 5) Refused. 6) The person shows as "Deleted user". If the review parent was used, the owner re-runs the provisioning command afterwards. | Recording; Android and portal screenshots | NOT RUN |
| I-41 | LR-03 | **After #498 merges.** P-6(c) teacher (never the review teacher) | Sign in as that teacher → Settings → Delete account → confirm. | The request is accepted in the app. The app says when the deletion will be finished (within 30 days). It never says "contact the academy". (On today's `main` this teacher is refused with "Please contact the academy…", the known LR-03 blocker.) | Recording | NOT RUN |
| I-50 | LR-39, SB-45 | Signed in; rotation lock off; a build with #522 | 1) Turn the phone to landscape on: sign-in, the chat list, a chat with the keyboard open and a draft typed, the call screen, Settings, Delete account (back out), and the terms gate after #497. 2) Open a whiteboard, enter full screen, and turn the phone to landscape. 3) With the board full screen in landscape, receive a call (from the portal), then end it. 4) Leave full screen while still in landscape. | 1) Every screen **stays portrait**, and the draft is kept. 2) The full-screen board turns to landscape and stays usable (PD-55 rev2). 3) The call screen is portrait; after the call the board can turn again. 4) The app returns to portrait, the system bars come back, and the board's ink is kept. Anything else is a FAIL with a screenshot. | One screenshot for step 1 (any screen), the landscape board, and the screen after step 3 | NOT RUN |

### 12.3 Android 14 or later (a physical phone, with Google Play services)

| ID | Tracker | Preconditions | Steps | Expected result | Evidence | Result |
|---|---|---|---|---|---|---|
| A-01 | LR-08, LR-21 | P-2 | 1) In the Play Store internal-testing listing (or Settings → Apps → Jawwid → App details), read the version. 2) Release-qa runs `keytool -printcert` on the AAB (§1). | The version equals `BUILD_NAME`, and the version code equals `BUILD_NUMBER`. The AAB is not signed with `CN=Android Debug`. | Screenshot; the `keytool` output in the run notes | NOT RUN |
| A-02 | LR-08, LR-43, SB-01 | P-1, P-2; Jawwid uninstalled | 1) Install from the internal testing track. 2) Open it. | Sign-in screen, no crash, no sample data, "Help and support" and "Contact support" shown. No notification or microphone prompt before sign-in. | Recording | NOT RUN |
| A-03 | LR-43, LR-02b, SB-02, SB-03 | A-02; P-5 | As I-03 (wrong password, then the right one). Note when the `POST_NOTIFICATIONS` prompt appears; Allow. | As I-03. **Today: no gate.** Record the prompt timing (LR-11; not a FAIL here). | Recording; screenshot | NOT RUN |
| A-04 | LR-43, SB-05 | A-03 | As I-04. | As I-04. | Screenshots | NOT RUN |
| A-05 | LR-43, LR-02b | P-6(b) (a different record from I-05) | As I-05. | As I-05: today, no terms boxes, and the account is created and signs in. | Recording | NOT RUN |
| A-T1 | LR-02b, LR-02a | After #497 merges; as I-T1 | As I-T1. | As I-T1. | Recording | NOT RUN |
| A-T2 | LR-02b | After #497 merges; as I-T2 | As I-T2. | As I-T2. | Recording | NOT RUN |
| A-T3 | LR-02b, LR-43 | After #497 merges; as I-T3 | As I-T3. | As I-T3. | Recording | NOT RUN |
| A-T4 | LR-02b | After #497 merges; the gate is up | 1) Press Back, or swipe back from the screen edge, three times. 2) Open Delete account from the gate, then Back. 3) Tick and Agree. 4) Open a chat, Back; then Back on the chat list. | 1) The gate stays and the app does **not** go to the background. 2) Back returns to the gate. 4) Back works normally after Agree: out of the chat, then the usual behaviour at the chat list. | Recording | NOT RUN |
| A-10 | LR-74, LR-14 | **Fresh install**; signed in as the parent; P-7 | 1) Start a voice call in the family group. 2) At the microphone prompt, tap **Don't allow**. 3) Look at the portal. 4) Start the call again; Android asks again; tap **While using the app**. 5) The teacher answers; both speak. | 1) The prompt comes **before** anything rings. 2) "Jawwid needs microphone access to make calls." 3) The portal never rang. 4) As soon as it rings, the ongoing-call notification appears (the other person's name, "Ongoing call", and Hang up), and not before the grant. 5) Two-way audio. | Phone recording; portal screenshot at step 3 | NOT RUN |
| A-11 | LR-14, LR-74, SB-31, SB-35 | The A-10 call is live | 1) Press Home and open another app for 1 minute; speak. 2) Lock the phone for 2 minutes; speak. 3) Pull down the notification and tap **Hang up**. | 1–2) Audio continues both ways, and the ongoing notification is visible in the status bar and on the lock screen. 3) The call ends for both, and the notification disappears. | Portal-side recording with sound; phone recording | NOT RUN |
| A-12 | LR-74 | Fresh install; the app in front | The teacher calls → Answer → microphone prompt → **While using the app** → lock for 1 minute. | Exactly one prompt. The call goes live, the ongoing notification appears after the grant, and the audio continues while locked. | Recording | NOT RUN |
| A-13 | LR-74, LR-14 | Fresh install | Start a call; at the prompt choose **Only this time**; once connected, lock for 1 minute. | The call works, and the audio continues while locked. This was the silent-on-lock case before #509. | Recording | NOT RUN |
| A-14 | LR-74 | A live call | As I-13 (airplane mode → Hang up → close the failed call). | The green microphone privacy indicator goes off within a few seconds, the ongoing notification is gone, and the portal does not stay "in call". | Recording showing the status bar | NOT RUN |
| A-15 | LR-12, SB-22 | P-3; notifications allowed. Record whether Settings → Apps → Jawwid → full-screen notifications is allowed | 1) Swipe the app away. 2) The teacher calls while the phone is unlocked. 3) Answer from the notification. | A heads-up call notification with Answer and Decline. Answer opens the call, with two-way audio. | Recording | NOT RUN |
| A-16 | LR-12, SB-23 | As A-15; phone locked | App killed and the phone locked; the teacher calls; answer. | A full-screen ring over the lock screen, if full-screen notifications are allowed; otherwise a heads-up ring with Answer and Decline (play-declarations §6). There is two-way audio after answering. The check of the full-screen permission itself (LR-27) comes after #449. | Recording by a second camera | NOT RUN |
| A-17 | LR-12, SB-24 | As A-15 | App killed; the teacher calls and hangs up before the answer. | The ring stops within a few seconds, and a missed-call card appears in the group. | Recording; screenshot | NOT RUN |
| A-18 | LR-12, SB-25 | As A-15 | App killed; **Decline**. | The portal shows "declined", and the call ends for both. | Recording | NOT RUN |
| A-20 | LR-44, LR-38, SB-43 | As I-20 | As I-20 (airplane mode on Android). | As I-20. | Recording | NOT RUN |
| A-21 | LR-44, SB-42 | P-9; run at the same time as I-21 | As I-21. | As I-21. | Recording | NOT RUN |
| A-22 | S-05, LR-47, SB-10, SB-11 | P-3; notifications allowed | As I-22. | As I-22. **The tap opening the exact item is after #449 merges.** | Recording | NOT RUN |
| A-30 | LR-25, LR-64 | After #503 merges; as I-30 | As I-30. | As I-30. | Screenshots, English and Arabic | NOT RUN |
| A-31 | LR-35 | After #503 merges; a `.csv` file in Downloads | As I-31 (the system document picker). | The `.csv` cannot be chosen. | Screenshot | NOT RUN |
| A-40 | LR-65, LR-03, SB-50..52 | P-6(a), the second deletion parent, signed in on Android **and** the iPhone | As I-40, with the roles of the phones swapped. | As I-40. | Recording; screenshots | NOT RUN |
| A-41 | LR-03 | After #498 merges; P-6(c). One teacher deletion per run is enough: run I-41 **or** A-41, and mark the other N/A | As I-41. | As I-41. | Recording | NOT RUN |
| A-42 | LR-65, SB-54 | P-1; the third P-6(a) parent. In the phone's browser, not the app | 1) Open `https://<production API host>/api/v1/account-deletion`. 2) Look at it in Arabic and in English. 3) Follow its steps for the third P-6(a) disposable parent only (if it is not provided, mark this step BLOCKED). **Never the review teacher, the review parent or any other review-cohort account:** after #498 this page can erase the review teacher, and re-provisioning cannot restore it. | 1) The page loads over HTTPS without the app or a sign-in. 2) Both languages read correctly, and the Arabic is right-to-left. 3) The page confirms the request, and the account can no longer sign in once the page says it is deleted. | Screenshots of both languages and the confirmation | NOT RUN |
| A-50 | LR-39, SB-45 | Auto-rotate on | As I-50. | As I-50. | Screenshots | NOT RUN |
| A-60 | **LR-09h**, LR-14 | A-11 PASS. The Play internal-testing release build on this Android 14+ phone. The review parent signed in; the review teacher on the portal, filmed by a second camera or recorded | Record **one take of 30–90 s** (play-declarations.md §5): 1) The app open. 2) Tap to start a call, or answer one. 3) The call connects, and the portal side hears the parent. 4) Press Home or lock the screen; the ongoing-call notification is visible. 5) Speak; the portal still hears. 6) Tap **Hang up** in the notification; it disappears. | All six moments are visible in one take. No real person, face, child, password or e-mail is readable. | The video file itself, `A-60-fgs-video.mp4`; the owner uploads it unlisted for the Play Console (not part of this run) | NOT RUN |

### 12.4 Admin Web (desktop, staff)

| ID | Tracker | Preconditions | Steps | Expected result | Evidence | Result |
|---|---|---|---|---|---|---|
| W-01 | LR-02c | **After #497 merges**, and the terms rows are loaded. A staff account that has not accepted | 1) Sign in to Admin Web. 2) Open each document; try to continue without ticking; tick and Agree. 3) Reload the page. | 2) The gate blocks every screen until each box is ticked and Agree is pressed. Then the normal screens load. 3) No gate. **Today (no #497): there is no gate.** | Recording | NOT RUN |

### 12.5 Timing estimate

The estimate is hands-on time for two people (the owner on the phones, QA on the portal and the notes). Each row's minutes include its evidence.

| Block | Rows | Minutes |
|---|---|---|
| Setup: record the SHA and builds, open the portal, check P-1..P-9 | — | 15 |
| **iPhone, rows runnable on today's `main`** | I-01..I-05 (20), I-10..I-13 (25, with two reinstalls), I-15..I-18 (15), I-20..I-22 (15), I-40 (10), I-50 (8) | **about 95** |
| **Android 14+, rows runnable on today's `main`** | A-01..A-05 (20), A-10..A-14 (30, with three reinstalls), A-15..A-18 (15), A-20..A-22 (15), A-40, A-42 (15), A-50 (8), A-60 video (15, with retakes) | **about 120** |
| Saved by running I-21/A-21, I-22/A-22 and I-40/A-40 on both phones together | — | −20 |
| **One sitting on today's `main`** | | **about 3 h 30 min, with a 10-minute break** |
| Added once #497 merges | I-T1..T3, A-T1..T4, W-01 | +30 (iPhone 12, Android 15, Admin Web 3) |
| Added once #503 merges | I-30, I-31, A-30, A-31 | +15 |
| Added once #498 merges | I-41 or A-41 | +8 |
| Added once #449 merges | The tap-opens-item step in I-22/A-22; the LR-27 check in A-16 | +5 |

OA-20 budgeted about 3 hours. If the sitting must fit 3 hours, run in this order and stop cleanly: A-60 (the Play video) and the call rows first (I-10..I-18, A-10..A-18), then deletion and sign-in, then landscape and reconnect. Whatever is not run stays NOT RUN, and nothing is marked from memory.

### 12.6 After the sitting

- Release-qa matches every call and push row to the API log lines (as §6 describes) and attaches them.
- Each FAIL becomes a defect with the row id, build, device and evidence file. Each BLOCKED names its precondition (P-n) or PR.
- The tracker rows LR-08, LR-02b, LR-12, LR-14, LR-74, LR-03, LR-65, LR-43, LR-44, LR-25, LR-39 and LR-09h are updated from these results only.
