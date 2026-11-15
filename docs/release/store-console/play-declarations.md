# Google Play Console declarations: App content and permissions

**Launch items LR-09 and LR-71. Draft, 2026-11-08; re-verified 2026-11-09.** Pinned to `main` @
`bc47d376` for §3, §5, §6 and §7 (re-checked in the LR-71 dry run, after the microphone-only fix LR-14,
#505). §1, §2, §4, §8 and §9 are unchanged from the draft written at `cf731af2`; their open answers are
listed in §10. Paths are relative to the repository root, cited as `file:line`.

**Where it goes:** Play Console → the app → **Policy and programs → App content**, unless a row says otherwise.

**Re-read before submitting.** Google's live help pages could not be read from this machine when this was
drafted. Each answer gives the facts; match them to the live question on the day.

**Never put a real credential in this repository.** `{{REVIEW_PARENT_EMAIL}}` and the other `{{...}}`
values are typed only into the Play Console fields (`docs/release/review-accounts.md`, "Run it" step 3).

---

## 1. Target audience and content

| Question | Answer | Reasoning |
|---|---|---|
| Target age groups | **18 and over only** `[OWNER DECISION: N-1 / LD-5]` **OPEN (§10)** | Only adults have accounts: parents, teachers and staff (`lib/shared/models/user_role.dart:9-21`). Children take part in lessons on a parent's signed-in phone. Recommended in `google-play-readiness-2026-11-03.md` and the launch checklist (LR-10). Counsel must confirm against the Families policy, because children use some of the content. |
| Could your store listing unintentionally appeal to children? | **No** | Only if the listing follows `listing-copy.md`: written to parents, no child imagery, no cartoon art, no "for kids". If the owner wants child-facing screenshots, the answer becomes Yes and Google may require Families compliance. |
| Appeals to children: if Google asks for more | Explain: "Accounts are held only by parents, teachers and academy staff, all adults. Children have no account and do not sign in; lessons take place on the parent's device under the parent's account." | — |

**If the owner chooses an audience that includes children** (any group under 13), the Families policy
applies: every SDK must be allowed for child-directed use (Sentry, LiveKit, Firebase: legal item L-15),
the app needs a neutral age screen for a mixed audience, and the social features need the safety reminder
and adult action (checklist G-6 to G-10). None of that is built.

## 2. App access

**Answer:** "All or some functionality in my app is restricted" → add instructions.

**Superseded by [`review-notes.md`](review-notes.md) §3 (2026-11-09).** That version has three accounts,
including the deletion-test parent from #528. It adds the call test and the staff role, and sets out the
payments choice (OA-12). The text below is kept for its history.

Review accounts: `docs/release/review-accounts.md` (own "Jawwid App Review" organization; e-mail and
password; no verification code). They exist only after launch items LR-01 (production backend) and LR-05
(provisioning).

| Field | Value |
|---|---|
| Name | `Parent account` |
| Username | `{{REVIEW_PARENT_EMAIL}}` |
| Password | `{{REVIEW_PARENT_PASSWORD}}` |
| Any other information | (the text below) |

| Field | Value |
|---|---|
| Name | `Teacher account` |
| Username | `{{REVIEW_TEACHER_EMAIL}}` |
| Password | `{{REVIEW_TEACHER_PASSWORD}}` |
| Any other information | (the text below) |

**Instructions (paste in each entry):**

> Sign in with the e-mail and password above on the first screen. No verification code is needed. The
> app is in Arabic or English, following the phone's language; Settings → Language changes it.
>
> The parent account has one child with weekly live lessons, a family group chat with the child's
> supervisor and teacher, and a direct chat with the supervisor. The teacher account is that child's
> teacher. The two accounts can message and call each other in the family group. All people and data in
> these accounts are fictional.
>
> Payments: the academy sells only live one-to-one Quran lessons (one teacher, one student, in real time,
> not recorded), paid by card on Stripe's page or by bank transfer. To see it: parent account →
> {{PAYMENTS_TAB_NAME}} tab (bottom bar) → Amount due → Pay.
>
> Reporting and blocking: long-press a message → Report, or open a person's profile → Report or Block.
>
> Account deletion: Settings → Delete account (password required). The same is available on the web at
> {{ACCOUNT_DELETION_URL}}.

Notes for the owner:
- `{{PAYMENTS_TAB_NAME}}` is "Subscriptions" in today's app (`lib/app/router.dart:140-142`). Launch item
  LR-15 recommends renaming it to lesson-package wording; use whatever name the submitted build shows.
- **The review child has no payment due today** (`review-accounts.md`, "No payments"), so a reviewer
  cannot reach Pay. Either add an open lesson-package request to the review cohort before submitting
  (`app-review-notes-payments.md` §6 item 2), or delete the "Payments" paragraph above.
  `[OWNER DECISION: which one]`
- Verify each path in the instructions on the submitted build before pasting. The report and block
  gestures are PD-57's; check them on a phone.
- Also enter the same credentials in **Testing → Pre-launch report → Settings → Credentials**.
- Recommended: a third, disposable parent account for the deletion test (`review-accounts.md`, "Still open").

## 3. Ads

| Question | Answer | Evidence |
|---|---|---|
| Does your app contain ads? | **No** | No ads SDK in `pubspec.yaml` or `android/app/build.gradle.kts:117-127`. Stories are the academy's own announcements to its families. |
| Advertising ID: does your app use an advertising ID? | **No** **OPEN (§10)** | No `com.google.android.gms.permission.AD_ID` in `android/app/src/main/AndroidManifest.xml:6-29`. Firebase Messaging alone does not use it. Pending the merged-manifest check of the release AAB from the release-readiness workflow (release audit WP-6). |

## 4. Content declarations

| Declaration | Answer | Reasoning |
|---|---|---|
| News apps: is your app a news app? | **No** | Stories are the academy's announcements, not news. |
| Government apps | **No** | Jawwid is not a government body and does not act for one. |
| COVID-19 contact tracing and status apps | **No** | — |
| Health apps | **My app does not have any health features** | No health or medical feature. |
| Financial features | **My app doesn't provide any financial features** | Families pay the academy for its own lessons (Stripe Checkout in the browser, or a bank-transfer receipt: `lib/core/data/http/http_billing_repository.dart:31-81`). That is a merchant taking payment, not a financial service: no banking, loans, wallet, money transfer between users, investment or crypto. |
| Data safety | See `google-data-safety.md` | — |
| Content rating | See `age-rating.md` §2 | — |
| Privacy policy URL | `{{PRIVACY_POLICY_URL}}` | LR-04 |
| Child Safety Standards (self-certification) | **OPEN (§10).** Drafted answer: **Not required for this category**, if Play does not ask. If the Console asks, answer with: published standards `{{CHILD_SAFETY_POLICY_URL}}`, in-app reporting (PD-57, with a child-safety reason), contact `{{SAFEGUARDING_EMAIL}}` | Required for social and dating apps; an education app appears out of scope (compliance checklist G-5). The policy text is ready in `docs/legal/child-safety-policy-*.md`. |

## 5. Foreground service (Play Console → App content → Foreground service permissions)

**What the app does:** during a call or live lesson, `CallForegroundService` keeps the microphone working
when the person leaves the app or locks the screen, with an ongoing "call in progress" notification and
a Hang up button handled by `CallActionReceiver` (`android/app/src/main/AndroidManifest.xml:24-29`, `:73-80`).

**Microphone only (launch item LR-14, done in #505).** The service declares
`android:foregroundServiceType="microphone"` (`AndroidManifest.xml:73-76`) and starts with
`FOREGROUND_SERVICE_TYPE_MICROPHONE` only (`android/app/src/main/kotlin/com/jawwid/jawwid_chat/CallForegroundService.kt:54`, `:67`).
The manifest asks only for `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE` (`:28-29`);
`phoneCall`, `FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS` are gone, because the app has no
Telecom `ConnectionService` (`:24-27`). Submit a build at or after `bc47d376`, so the declaration matches
the code.

| Field | Answer |
|---|---|
| Foreground service type | **Microphone** (`FOREGROUND_SERVICE_MICROPHONE`) |
| Task / use case | Voice calling: an ongoing, user-started audio call or live lesson between the academy's teacher, staff and a family |
| Describe the feature | "During an audio call or a live lesson, the app keeps the microphone open while the user switches to another app or locks the screen, so the call does not drop. The service starts only when the user starts or answers a call, shows an ongoing notification with a Hang up button for the whole call, and stops when the call ends." |
| Impact if the system delays or stops it | "The call's audio is cut as soon as the user leaves the app, so the other person can no longer hear them. A lesson in progress is interrupted." |
| Video link | `{{FGS_VIDEO_URL}}` (unlisted YouTube or a shared link the reviewer can open) |

**What the video must show** (one take, 30–90 seconds, on an Android 14+ phone, from a release build):
1. The app open, signed in with the review parent account.
2. The user **starts** a call from a chat (or answers an incoming one). Show the tap.
3. The call connects; the other phone (on camera or a second recording) hears the user.
4. The user presses Home or locks the screen. **The ongoing call notification is visible** in the
   status bar or on the lock screen.
5. The user speaks; the other person still hears them.
6. The user taps **Hang up** in the notification (or returns to the app and ends the call); the
   notification disappears.

No real person's face, name or child in the video; use the review accounts.

## 6. Full-screen intent (Play Console → App content → Full-screen intent)

**Launch item LR-09i. TRUE ONLY AFTER #524 MERGES** (LR-27, stacked on #449). Updated 2026-11-09 from
#524's branch `claude/lr79-ring-repost`. Do not submit a build without #524: on `main` the app never asks
whether it may use full-screen intents.

**What the app does (with #524):**
- An incoming call rings over the lock screen while the app is closed, like a phone call
  (`android/app/src/main/AndroidManifest.xml:18-23` on `main`). The ring is a `CallStyle` incoming-call
  notification with Answer and Decline. `JawwidPush` posts it from an FCM data message
  (`AndroidManifest.xml:64-71`).
- **On Android 14 and later**, the app asks the system whether it may still use full-screen intents
  (`NotificationManager.canUseFullScreenIntent()`):
  - #524 `JawwidPush.kt:180-188` (`canUseFullScreenIntent`);
  - `RingCheck.kt:69-70`: below Android 14 the answer is always yes.
- **When the permission is denied**, the call still rings, as a heads-up notification with Answer and
  Decline. The app logs (Logcat only) that the ring was heads-up only (#524 `JawwidPush.kt:167-169`). The intent is
  always attached (`:153-161`), because Android refuses to build a `CallStyle` notification without one.
  Android itself turns the request into a heads-up notification.
- Dart can ask the same question and can open the system setting
  (`Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`, with the app's notification settings as the
  fallback):
  - #524 `MainActivity.kt:186-187`, `:257`;
  - `lib/core/call_native/call_presentation.dart:214-228`.

  **No screen calls them yet.** #524's description lists the in-app prompt as a follow-up that needs new
  Arabic and English strings. So do not tell Google that the app *offers* the setting.

| Question | Answer |
|---|---|
| Does your app's core functionality need full-screen intent? | **Yes: calling** (receiving incoming audio calls and live-lesson calls) |
| Describe the use | "The app shows a full-screen incoming-call screen when a teacher, the academy or a family member calls, including for a scheduled live lesson. It is used only for incoming calls, never for messages, reminders or promotions. On Android 14 and later the app checks whether it may use full-screen intents; if the permission is not granted, the call still rings as a heads-up notification with Answer and Decline." |

Notes:
- Google grants the permission by default only to apps whose core function is calling or alarms. Calls
  and live lessons are the core of this app, but Google decides. If Google refuses, nothing breaks: the
  heads-up ring remains.
- **Before submitting:** check the submitted build contains #524 (`git merge-base --is-ancestor` with the
  build's commit). Then, on an Android 14+ phone with full-screen intents turned off for the app (the
  system's full-screen notification setting for Jawwid; its name differs by phone maker), confirm that a call still rings as a heads-up notification
  and that Answer and Decline work. This is one of #524's own device checks ("FSI denied shows a heads-up
  ring"). **Not verified:** no device test was run (machine rule), and no CI job runs `RingCheckTest` yet
  (#524, "Known gaps").
- When the follow-up prompt ships, the description may add: "and offers the system setting to turn it
  back on". Not before.

## 7. Permissions (what the app asks for, and why)

From `android/app/src/main/AndroidManifest.xml`. None of them needs a separate sensitive-permission form
except the two above (foreground service, full-screen intent).

| Permission | Line | Why | When it is asked |
|---|---|---|---|
| `INTERNET` | `:6` | Every API call, chat and call | Install (normal) |
| `RECORD_AUDIO` | `:9` | Voice messages, video sound, calls and lessons | When the user first records or joins a call, never at launch (`:7-8`) |
| `POST_NOTIFICATIONS` | `:13` | Messages and call rings (Android 13+) | When a notification first matters, not at launch (`:10-12`). Launch item LR-11 notes that `main` still asks right after sign-in; fix before submitting |
| `USE_BIOMETRIC` | `:17` | Optional app lock with face or fingerprint | When the user turns on app lock |
| `USE_FULL_SCREEN_INTENT` | `:23` | Incoming-call screen | §6 |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` | `:28-29` | Ongoing calls | §5 |

`FOREGROUND_SERVICE_PHONE_CALL` and `MANAGE_OWN_CALLS` were removed by LR-14 (#505); the app's manifest no
longer declares them.

**Added by plugins in the merged manifest** (normal permissions, granted at install, no form):

| Permission | Source | Why | Status |
|---|---|---|---|
| `ACCESS_NETWORK_STATE` | `connectivity_plus` (`pubspec.yaml:62`; the plugin's own manifest declares it) | Knowing whether the phone is online | Confirmed from the plugin manifest |
| `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | Firebase Cloud Messaging | Receiving push messages | UNVERIFIED: expected from Firebase, not confirmed without a build (machine rule) |

The other plugins read declare nothing new beyond the app's own manifest (`record` adds `RECORD_AUDIO`,
`local_auth` adds `USE_BIOMETRIC`; `livekit_client` and `flutter_webrtc` add none).

Not requested: location, contacts, SMS, call log, camera as a permission (the system camera and photo
picker are used: `lib/core/media/media_picker.dart`), `READ_MEDIA_*`, all-files access,
`QUERY_ALL_PACKAGES`, accessibility. `allowBackup="false"` (`:37`). Check the merged manifest of the
release AAB for permissions that plugins add (release audit WP-6) and add any to this table.

## 8. Store settings (Play Console → Grow → Store presence → Store settings)

| Field | Answer |
|---|---|
| App or game | App |
| Category | **Education** `[OWNER DECISION]` (alternative: Communication). Education matches the payments exemption, which is for live one-to-one tutoring. |
| Tags | Choose from Play's list at entry: education-related tags only |
| Contact e-mail | `{{SUPPORT_EMAIL}}` |
| Website | `{{SUPPORT_URL}}` |
| Phone (optional) | Leave empty unless the owner provides `{{SUPPORT_PHONE}}` |
| External marketing | Owner's choice |

## 9. Countries (Production → Countries / regions)

`[OWNER DECISION: storefronts, LD-15 / LR-17]` **OPEN (§10)**. Recommended for the first release: the academy's
markets (GCC and other Arab countries); not the US until the age-assurance work exists; the EU only with
trader details verified. Google Play Age Signals and US state laws apply only where the app is distributed.

## 10. Open items (LR-71)

Each answer below stays as drafted until its owner decides. Nothing here changes an answer. The
Data safety items (payment info, religious beliefs, and Sentry session tracking, decided off in #526
pending merge) are in `google-data-safety.md` §6.

| # | Item | Answer today | Decision id and owner | Where |
|---|---|---|---|---|
| O-1 | Target audience | 18 and over only | **OPEN.** Owner: N-1 / LD-5; counsel confirms against the Families policy | §1; `age-rating.md` (Kids Category) |
| O-2 | Families policy | Not applicable while the audience is 18+ | **OPEN.** Follows O-1; counsel L-15 (SDK terms for child-directed use) if any child age group is chosen | §1; `google-data-safety.md` §1 |
| O-3 | Storefronts (countries) | Academy markets first | **OPEN.** Owner: LD-15 / LR-17. Also decides Apple's storefronts and age-assurance answer (`age-rating.md`) | §9 |
| O-4 | Child Safety Standards | "Not required for this category", with the prepared answer if the Console asks | **OPEN.** Owner: whether Play's Child Safety Standards apply to this app (compliance checklist G-5); the designate and mailbox are LD-19. The app has user-generated content and messaging, so prepare the answer either way | §4 |
| O-5 | Advertising ID | No | **OPEN** pending the merged-manifest check of the release AAB from the release-readiness workflow (release audit WP-6) | §3; `google-data-safety.md` §2.1 |
| O-6 | Merged-manifest permissions | §7 tables | **OPEN**, same check as O-5: confirm Firebase's `WAKE_LOCK` and `c2dm RECEIVE`, and that nothing else is added | §7 |
| O-7 | Review payment paragraph | Either seed a payable request or delete the paragraph | **OPEN.** Owner (§2 note); live card payments are LR-34 | §2 |
| O-8 | Category | Education | **OPEN.** Owner. Also weighs on the full-screen-intent case (§6) | §8 |
