# Play Console answer sheet: Policy and programs > App content (Jawwid 1.0.0, code 3)

Prepared 2026-11-18, read-only. Sources: `origin/main` @ 2e412701 (code), `origin/claude/lr71-console-truth` (PR #591 card-free store-console docs), the plain files in this folder (`PERMISSIONS-AUDIT.md`, `PLAY-CONSOLE-CHECKLIST.md`, `VERIFICATION-SUMMARY.md`, `verification-part-A/B/C/D.md`, `merged-manifest-1.0.0-3.xml`), and two live HTTP checks. No console was opened. Nothing in the repo was changed. No secret appears here.

Release artifact: signed AAB, package `com.jawwid.jawwid_chat`, versionName 1.0.0, versionCode 3, minSdk 26, targetSdk 36 (merged manifest line 1 and 3). App name "Jawwid" (`android/app/src/main/res/values/strings.xml`). Free, worldwide.

**Status key.** READY = value is evidenced, paste it. OWNER ATTESTATION REQUIRED = a statement the owner makes to Google; I give the evidence-supported answer, the owner decides to submit it. COUNSEL = needs a lawyer. GOOGLE = only Google can settle it. UNVERIFIED = not established from evidence.

**Limit on every "Google says" statement.** The Google pages in the `verification-part-*` files were read through WebFetch (model-written extracts, not raw pages). Re-read the live Console wording on the day. A policy or legal conclusion is stated as confirmed here only where the verification files mark it VERIFIED.

---

## 0. Index (one row per Console task; counts at the end are from this table)

| # | Console task | Answer in one line | Status |
|---|---|---|---|
| 1 | Privacy policy | https://admin.chat.jawwid.com/legal/en/privacy (HTTP 200) | READY |
| 2 | Ads | No ads | READY |
| 3 | App access | Restricted; 3 review logins; passwords typed by owner in console only | UNVERIFIED |
| 4 | Content rating (IARC) | Lowest rating, "Users Interact"; 3 questions flagged | OWNER ATTESTATION REQUIRED |
| 5 | Target audience and content | Evidence supports child age groups plus 18+; Families Policy then applies | OWNER ATTESTATION REQUIRED |
| 6 | Data safety | See section 6; religious-beliefs row and SDK status open | OWNER ATTESTATION REQUIRED |
| 7 | Government apps | No | READY |
| 8 | Financial features | Shows requests, invoices, receipts, receipt upload; payments exemption OPEN | OWNER ATTESTATION REQUIRED |
| 9 | Health | No health features | READY |
| 10 | News | Not a news app | READY |
| 11 | COVID-19 | No | READY |
| 12 | Advertising ID | No; AD_ID absent from the signed AAB's merged manifest | READY |
| 13 | Foreground service (microphone) | Text corrected to real code; video still missing | OWNER ATTESTATION REQUIRED |
| 14 | Full-screen intent | Yes, calling; heads-up fallback; no settings-page UI | OWNER ATTESTATION REQUIRED |
| 15 | Account deletion URL | https://admin.chat.jawwid.com/legal/en/account-deletion (HTTP 200) | READY |
| 16 | Support contact | info@jawwid.com | READY |
| 17 | Store settings: category | Education (proposed) | UNVERIFIED |
| 18 | Child Safety Standards (only if the Console asks) | Prepared answer; not in Google's listed scope today | READY |
| 19 | Families / child-directed obligations | Triggered if child groups are ticked; SDK status and COPPA open | COUNSEL |
| 20 | Play Billing exemption | OPEN; do not claim it | GOOGLE |

---

## 1. Privacy policy

| Field | Value | Evidence | Status |
|---|---|---|---|
| Privacy policy URL | `https://admin.chat.jawwid.com/legal/en/privacy` | `curl -L` on 2026-11-18: HTTP 200, `<title>Privacy Policy · Jawwid Academy</title>`, "Version 1.0 · Effective 2026-11-17", served as `text/html` (not a PDF; Part C R18 says no PDFs, public, non-geofenced) | READY |
| Arabic twin (optional second field) | `https://admin.chat.jawwid.com/legal/ar/privacy` | `docs/legal/apply-confirmed-values.md` mapping table; not fetched by me | UNVERIFIED |
| Linked inside the app | Yes, sign-in screen, legal gate, settings | `lib/features/legal/presentation/legal_gate.dart:329,421`; `lib/features/auth/presentation/sign_in_screen.dart:6` imports `legal_links.dart` | READY |
| "Geofenced?" | Not tested from outside the owner's network. Single Cloudflare-served host. | Part C R18 requires non-geofenced | UNVERIFIED |

Mismatches between the live policy and the Data safety draft are in section 6.4.

## 2. Ads

| Question | Answer | Evidence | Status |
|---|---|---|---|
| Does your app contain ads? | **No, my app does not contain ads** | No ad SDK in `pubspec.yaml` or `android/app/build.gradle.kts:117-127` (only appcompat, firebase-messaging, core-ktx); the only grep hit for analytics/ads is the comment "Firebase Messaging only (no Analytics)" (`build.gradle.kts:123`); policy text: "No advertising, no analytics, no tracking" (live privacy page). Stories are the academy's own announcements (`lib/core/data/http/http_story_repository.dart:17-18`) | READY |
| Families self-certified ads SDK program | Not applicable with no ads | Part C R22 VERIFIED ("apps that do not serve ads to children are not required") | READY |

## 3. App access

**Answer:** "All or some functionality in my app is restricted". Add three entries (names and usernames per `review-notes.md` §3 on PR #591):

| Entry name | Username | Password |
|---|---|---|
| Parent account | `parent@<REVIEW_DOMAIN>` | owner types it in the console field only |
| Teacher account | `teacher@<REVIEW_DOMAIN>` | owner types it in the console field only |
| Deletion test account | `parent2@<REVIEW_DOMAIN>` | owner types it in the console field only |

`<REVIEW_DOMAIN>` is the review domain the owner holds (`docs/release/review-accounts.md`); it is not in this sheet. Enter the same logins in Testing > Pre-launch report > Settings > Credentials.

**"Any other information" text (paste in each entry; contains no password):**

```text
Sign in with the email address and password shown in this entry's fields, on the first screen; the password is supplied in the console field by the owner. No WhatsApp or SMS code is needed. Jawwid is the app of a Quran academy for parents and teachers (the person who signs in is an adult; children do not have accounts). Academy staff use a separate web portal, except sales-team staff and the senior administrator, who can sign in and see only Chats, Calls, Payments and Settings (no review account is provided for that role). All people and data are fictional and belong to a review-only organization.
Parent account: one child with weekly live lessons, a family group chat with the supervisor and teacher, and a direct chat with the supervisor. Teacher account: that child's teacher, in the same family group.
Calls are voice only and are not recorded. To test one, sign in as the parent on one device and the teacher on another, open the family group chat and tap the phone icon at the top; the other device rings. The supervisor has no login, so a call in the direct chat with the supervisor is not answered.
Account deletion: use the Deletion test account. Settings > Delete account > enter the password > Delete my account > confirm. It takes effect at once; we re-create the account after review. The Teacher account has a student, so it sees "Request account deletion" instead: the date is shown and the account is deleted within 30 days at the latest unless cancelled in the same screen. Deletion is also available on the web at https://admin.chat.jawwid.com/legal/en/account-deletion
Payments: lessons are paid outside the app (bank transfer or cash). The app only shows the parent payment requests, invoices and receipts, and lets a parent upload a photo of a bank-transfer receipt. There are no card payments and no in-app purchases. For this review account the server shows a demo amount due and cannot send a receipt.
```

Notes:
- The deletion URL, the card-free payments sentence and the staff-role sentence are my edits of `review-notes.md` §3 on PR #591. I deliberately dropped its phrase "under the 1:1 online paid services rule": that rule is not confirmed in Google's Payments policy text (`verification-part-A.md` A11, `verification-part-D.md` P2). Keep it dropped until Google answers.
- The payments sentence is true only if the review payment mode is switched on for the review organization (`review-notes.md` §2.1, check 8). Otherwise delete its last sentence.
- Status UNVERIFIED because I cannot see whether the three accounts exist on production. The checklist says they exist only after launch items LR-01 and LR-05 (cohort run) and PR #585/#528; `review-notes.md` §4 lists the eight checks to run on the submitted build first.
- Sales and super-admin roles can sign in (`lib/shared/models/user_role.dart:6-12`) but have no review account. Disclosed in the text above; Google may still ask for one (see section 17).

## 4. Content rating (IARC questionnaire)

Contact email for the certificate: `info@jawwid.com` (the repo doc says `support@jawwid.com`; see section 15 for why I use info@). Category: **All other app types** (a.k.a. "Reference, news, educational or utility"; not Game, not Social). Source: `docs/release/store-console/age-rating.md` §2.

The live questionnaire adapts its wording; every question text below is the meaning, **UNVERIFIED as live wording**. Answers come from what the code does.

| # | Question (meaning) | Answer | Evidence | Status |
|---|---|---|---|---|
| 1 | Violence, blood, gore | No | Lesson games are Quran and reading activities: `apps/lessons/src/games/` (folder exists on main; I did not play each game, `age-rating.md` row 1.3 says "confirm on a final read of the games") | UNVERIFIED |
| 2 | Fear, horror | No | no such content in the academy materials per `age-rating.md` §2.2; not code-checkable | UNVERIFIED |
| 3 | Sexuality, nudity | No | same | UNVERIFIED |
| 4 | Language, profanity, crude humor | No (academy content). Users can type freely, covered by #11 and #12 | Word filter exists server-side: `apps/api/src/platform/app-config.service.ts` (matched by grep; I did not read the rule list) | UNVERIFIED |
| 5 | Controlled substances | No | not code-checkable | UNVERIFIED |
| 6 | Gambling, simulated gambling | No | no code path: no bets, no loot (`age-rating.md` row 1.3) | READY |
| 7 | Crude or discriminatory humor | No | not code-checkable | UNVERIFIED |
| 8 | Could the app's content be offensive to some religious or ethnic groups? (if asked) | No is the repo draft, **cannot be answered from code**: the content is Quran and Islamic lessons. Needs the owner and a qualified religious reviewer (the owner's own rule, `verification-part-C.md` section 3 row "Content appropriate for children") | OWNER ATTESTATION REQUIRED |
| 9 | Does the app allow users to interact or exchange content | **Yes** (chat, voice messages, photos, videos, files, voice calls) | `lib/core/data/http/http_message_repository.dart:99,215`; `lib/core/audio/voice_recorder.dart:80`; `lib/features/calls/` | READY |
| 10 | Is user interaction moderated (if asked) | **Yes**: report a message or person, block a person | Report: `lib/features/messages/presentation/chat_screen.dart:549`, `lib/features/profile/presentation/profile_screen.dart:29,90`; block: `lib/features/moderation/presentation/block_actions.dart`. The "staff moderation queue" in the docs is server-side and I did not read it | READY (report/block); staff queue UNVERIFIED |
| 11 | Does the app share the user's physical location with other users | **No** | No location permission (`PERMISSIONS-AUDIT.md` row list; merged manifest has none). The parent picks a country and region once (`lib/features/profile/presentation/location_prompt_gate.dart`); `age-rating.md` says only Super Admin, Operations and Sales see it, and the routes that confirm this are an open engineering confirmation (DEV-CONFIRM #11) | UNVERIFIED |
| 12 | Does the app share the user's personal information with third parties ("Shares Info") | **No is the repo draft; COUNSEL.** The app passes data only to service providers (DigitalOcean, LiveKit, Sentry, FCM). A message to another family member is not a third party in the code, but the owner's own privacy policy lists those providers. Adds a notice only, does not change the rating | `age-rating.md` row 2.3 and §3 item 5 | COUNSEL |
| 13 | Does the app allow purchases of digital goods | **No** by the code: nothing digital is sold; no Play Billing, no IAP; card payments are off (`billing.card_paused`, `apps/api/src/billing/card-pause.ts`). **Tied to the open payments question (section 8)**: if Google decides lesson packages are a digital service, this answer is wrong | `lib/core/data/http/http_billing_repository.dart:76-81` (bank-transfer receipt only) | OWNER ATTESTATION REQUIRED |
| 14 | Does the app contain ads | No | section 2 | READY |
| 15 | Unrestricted internet access or a browser | **No** | The only in-app web view loads the academy's activities and refuses other pages: `lib/features/materials/presentation/activity_view_mobile.dart:62-68`. Other links open in the system browser: `lib/core/legal/legal_links.dart:73`, `lib/core/media/attachment_opener.dart:40` | READY |
| 16 | Is the app primarily a web browser or search engine | No | same | READY |

Expected result (from `age-rating.md` §2.4, not verified): lowest rating in each system (ESRB Everyone, PEGI 3, USK 0) plus the "Users Interact" notice. Check the result screen before applying.

**Questions I cannot answer from evidence (flagged):** #8 (religious sensitivity, needs a human reviewer), #12 (counsel), #13 (depends on the open Play Billing question), and the five content questions #1 to #5 and #7 that rest on the academy's content, which the code does not let me see. Also any question the live 2026 questionnaire adds (for example about chat with strangers or age-restricted features): UNVERIFIED because I could not open it. For "chat with strangers": the code answer is that conversations are set by the academy for a family, its teacher and its supervisor (`lib/features/messages/`, `apps/api/src/platform/authorization.service.ts:1642-1692` per `review-notes.md` §1), there is no discovery of strangers.

## 5. Target audience and content

This is the section where the owner's decision and the evidence must be read together. **I do not recommend a declaration that the evidence does not support.**

### 5.1 What the evidence says

- The primary app user is the parent or guardian; accounts exist only for parent, teacher and sales roles (`lib/shared/models/user_role.dart:6-12`). The Terms and policy set the account-holder minimum age at 18 (`docs/legal/apply-confirmed-values.md`, `{{MIN_ACCOUNT_HOLDER_AGE}}` = 18; live privacy page: "parents and legal guardians, aged 18 or over, who hold a family account").
- Children are the beneficiaries: the owner's own published child-safety policy says "The Academy's lessons are designed primarily for children aged 5 to 12. A child may be enrolled from the age of 3." (`docs/legal/child-safety-policy-en.md:39`).
- A child may take part in a live lesson call on the parent's signed-in phone, and child data is shown inside the app: child name (`lib/shared/models/conversation.dart:58-59`; `lib/features/billing/presentation/my_payments_screen.dart:487`), lesson reports, "Opened this week" material opens per child (`lib/features/materials/data/materials_repository.dart:127-129`).
- Google, as extracted (`verification-part-C.md`): Families Policy applies once children are one of the target audiences (R1, VERIFIED); any age group that includes children triggers it (R2); select several groups only if the app is designed for them (R28); the page does not address children as end users under an adult account (R31, UNVERIFIED).

### 5.2 Recommendation

| Item | Recommendation | Evidence | Status |
|---|---|---|---|
| Age groups to tick | **5 and under, 6-8, 9-12, and 18 and over.** Do **not** tick 13-15 or 16-17 unless the owner confirms the app is designed for those ages: the policy says older students "may also be enrolled" (`child-safety-policy-en.md:39`) but "designed primarily" for 5-12 | R27, R28 (age groups and "only if designed for them"); `child-safety-policy-en.md:39` | OWNER ATTESTATION REQUIRED |
| Is "18 and over only" an option? | **Not supported by the evidence.** It contradicts the owner's own policy and the child participation in calls; `VERIFICATION-SUMMARY.md` withdrew it for that reason. If the owner and counsel conclude children are legally not a target audience of an app that children use only on a parent's device, that conclusion must come from counsel on the facts above. Google's page does not address that scenario (R31 UNVERIFIED). | `VERIFICATION-SUMMARY.md` header; R31 | COUNSEL |
| "Could your store listing unintentionally appeal to children?" | If child groups are ticked, this question is moot: children are a declared audience. I could not confirm whether the Console still shows the question in that case (UNVERIFIED). If the owner nevertheless selects 18+ only, the honest answer depends on the assets, not on the draft "No": the copy is written to parents with no child imagery (`listing-copy.md` rules), but the owner's own policy says the lessons are for ages 5-12, and Google lists "youthful animation or young characters" as an appeal signal (R32 VERIFIED). I have not seen final screenshots. The feature graphic exists as `feature-graphic/feature-graphic-1024x500.png`; I did not assess it. | R32; `listing-copy.md` | UNVERIFIED |
| Teacher Approved / Designed for Families | Skip for now; optional (R25 UNVERIFIED, R26 VERIFIED optional) | `verification-part-C.md` | READY |

### 5.3 What Google's Families requirements then demand (from `verification-part-C.md`, section 1 and 3)

| Requirement | App today | Status |
|---|---|---|
| Content accessible to children must be appropriate (R3 VERIFIED) | Quran lessons; the code cannot show content suitability | OWNER ATTESTATION REQUIRED (owner and a qualified reviewer) |
| No ads; ad-SDK certification (R4, R22) | No ads, so not applicable | READY |
| No AD_ID, no location permission (R8-R10) | AD_ID count 0 and no location permission in the signed AAB's merged manifest (`PERMISSIONS-AUDIT.md`; `grep -c AD_ID merged-manifest-1.0.0-3.xml` = 0) | READY |
| SDKs "approved for use in primarily child-directed services" (R5 VERIFIED sentence; applies to child-only apps, mixed audience unclear) | Firebase Cloud Messaging, Sentry and LiveKit: Google names none of them (R23, R24). Needs each vendor's written statement and the Play SDK Index entry (read in the console) plus counsel (repo item L-15) | COUNSEL |
| Disclose children's personal data incl. via SDKs (R7, R19 VERIFIED) | See section 6.3 | OWNER ATTESTATION REQUIRED |
| Social apps that include children need an in-app safety reminder and adult action before children exchange personal information (R12, R13 VERIFIED) | **No safety reminder found in `lib` on origin/main** (grep for "stay safe / safe online / online safety / safetyReminder" returned nothing). Children have no account and do not message; every account is an adult account created by the academy. Whether family chat and calls are a "social feature that includes children" is UNKNOWN | COUNSEL |
| Neutral age screen for a mixed audience (R14, R15) | None built. Google's stated purpose is ad handling; whether it is demanded with no ads is UNVERIFIED | COUNSEL |
| COPPA and GDPR compliance (R16 VERIFIED, applicability COUNSEL) | The policy relies on parental consent via enrolment (privacy policy section on children; Part C gap row COPPA). FTC says foreign services directed to US children are covered (`verification-part-D.md` D2-4) | COUNSEL |
| Data safety form: Families question appears (R19) | Answer "complies" only if the owner is prepared to attest to the rows above | OWNER ATTESTATION REQUIRED |

### 5.4 Risks and counsel-needed points (target audience)

1. Declaring child groups imports every row of 5.3; three of them (SDK status, safety reminder, neutral age screen) have no evidence in either direction.
2. Declaring 18+ only while the owner's policy and call participation show children are the lesson audience risks an inaccurate declaration (R17: answers must be accurate and kept updated) and a listing-appeal rejection (R32). I do not recommend it.
3. Counsel questions: (a) is a child who uses an adult-held account on the adult's phone a "target audience" child; (b) COPPA verifiable-parental-consent analysis (child name, date of birth or stated age, lesson records, voice); (c) per-country child rules for a worldwide launch (`verification-part-D.md` D2-4 to D2-9, mostly UNVERIFIED).

## 6. Data safety

Re-read https://support.google.com/googleplay/android-developer/answer/10787469 on the day; the repo draft (`google-data-safety.md` on PR #591) says it could not read that page, and I did not re-read it either (`verification-part-A.md` A7-A8 read it by extract only).

### 6.1 Overview questions

| Question | Answer | Evidence | Status |
|---|---|---|---|
| Collects or shares required user data types? | Yes | section 6.2 | OWNER ATTESTATION REQUIRED |
| All collected data encrypted in transit? | **Yes** | HTTPS only; no cleartext flag or network config in the app manifest and none in the merged manifest (`PERMISSIONS-AUDIT.md`: "no `usesCleartextTraffic`, `networkSecurityConfig`"); store build accepts only `https` API URL (`scripts/mobile/build-store.sh`); LiveKit `wss://` enforced for production (`apps/api/src/communication/calls/media-token.ts:92-102`) | OWNER ATTESTATION REQUIRED |
| Account creation methods | Username and password (a parent's e-mail, activated by a one-time code; other accounts are created by the academy). No OAuth, no social login | `lib/core/data/http/http_parent_signup_repository.dart:18,49-50`; `http_auth_repository.dart:81-84` | READY |
| Way for users to request data deletion? | Yes | section 15; in-app `lib/features/settings/presentation/settings_screen.dart:279-287` (hidden for staff roles) | READY |
| Delete account URL | `https://admin.chat.jawwid.com/legal/en/account-deletion` | section 15 (HTTP 200) | READY |
| Families Policy question (asked if child groups ticked) | Follows section 5; do not answer "yes" until 5.3 is settled | `google-data-safety.md` O-3 (stale: "not asked, audience 18+") | COUNSEL |
| Independent security validation (MASA) | No | none done | READY |

### 6.2 Data types (from `google-data-safety.md` on PR #591, cross-checked in code and against the live privacy policy)

Applies to every row: **shared = No** (processors that act for the academy are service providers: DigitalOcean, LiveKit, Sentry, Firebase Cloud Messaging; Google's service-provider rule comes from the Data safety page, which I did not re-read, `verification-part-A.md` A8: "extract, no quote", so the "not shared" premise is itself UNVERIFIED); **encrypted in transit = yes**; purposes never include advertising, marketing or personalization. "Deletable" = removed by account deletion; the exceptions are in 6.5.

| Data type | Collected | Optional or required | Purposes | Deletable | Code evidence (origin/main) | Status |
|---|---|---|---|---|---|---|
| Approximate location (country, region, time zone) | Yes | Optional ("Later"; time zone can be set by hand) | App functionality | Yes | `lib/shared/location/location_repository.dart:45-48,57`; `lib/features/profile/presentation/location_prompt_gate.dart`; `lib/core/time/time_zone_api.dart:52-53,81` | OWNER ATTESTATION REQUIRED |
| Precise location | No | | | | no location permission in merged manifest; no location plugin | READY |
| Name (parent, teacher; also a child's name entered by staff and shown) | Yes | Required | App functionality, account management | Account holder's name: yes. Name on messages, payment records and child records is kept (6.5) | `lib/core/data/http/http_profile_repository.dart:38-51`; `lib/shared/models/conversation.dart:58-59` | OWNER ATTESTATION REQUIRED |
| Email address | Yes | Required for parents | Account management, app functionality | Yes | `http_parent_signup_repository.dart:18`; `http_auth_repository.dart:81-84` | OWNER ATTESTATION REQUIRED |
| User IDs | Yes | Required | App functionality, account management | Yes | account id on each request; hashed id in crash reports `lib/core/crash/crash_reporting.dart:70,76` | OWNER ATTESTATION REQUIRED |
| Phone number | Yes | Optional | Account management (recovery) | Yes | `lib/features/auth/presentation/forgot_email_screen.dart:102`; `http_account_recovery_repository.dart:28,35` | OWNER ATTESTATION REQUIRED |
| Address | No | | | | no street-address field | READY |
| Political or religious beliefs | **Repo draft: No (OPEN O-2). My recommendation: declare Yes, required, app functionality, pending counsel**, because the owner's published privacy policy says the child's Quran progress "may reveal the family's religion... We treat it as sensitive" (live privacy page, sensitive-data clause). Answering No while the policy says that is an internal contradiction. Declaring is never a violation; omitting a type that applies is (`apple-app-privacy.md` 3.4) | n/a | App functionality | with the account (kept child records, 6.5) | live privacy page; `apple-app-privacy.md` §3.4 | COUNSEL |
| Other info (teacher professional profile) | Yes | Optional (teachers) | App functionality | Yes | `http_teacher_profile_repository.dart:72-79,120-125`; `lib/app/router.dart:558` | OWNER ATTESTATION REQUIRED |
| Purchase history (payment requests, payments, invoices, receipts) | Yes | Optional | App functionality | **No, kept 7 years** | `lib/core/data/http/http_billing_repository.dart:27,31-32,76-81,92-93`; `my_payments_screen.dart:323-330`; `http_sales_payments_repository.dart:64` | OWNER ATTESTATION REQUIRED |
| User payment info (cards) | **No** (cards paused: `LAUNCH_PHASE=review`, no Stripe keys; `billing.card_paused`) | | | | `apps/api/src/billing/card-pause.ts`; section 8 | OWNER ATTESTATION REQUIRED |
| Other financial info (bank-transfer receipt photo or PDF, amount, date) | Yes | Optional | App functionality | **No, kept 7 years** (payment record) | `lib/features/billing/presentation/bank_transfer_screen.dart:21-25`; `http_billing_repository.dart:40-81` | OWNER ATTESTATION REQUIRED |
| Other in-app messages | Yes | Optional | App functionality | Content kept, author shown as "Deleted user" | `lib/core/data/http/http_message_repository.dart:99` | OWNER ATTESTATION REQUIRED |
| Photos | Yes | Optional | App functionality | Profile photo yes; chat attachments kept as part of messages | `http_message_repository.dart:215`; `lib/features/profile/data/profile_photo_repository.dart:101,131`; `lib/features/messages/data/chat_theme_repository.dart:58,82` | OWNER ATTESTATION REQUIRED |
| Videos | Yes | Optional | App functionality | as messages | `lib/core/media/media_picker.dart` | OWNER ATTESTATION REQUIRED |
| Voice or sound recordings | Yes (voice messages are stored; live call audio is relayed by LiveKit and not recorded; the type is not ephemeral) | Optional | App functionality | as messages | `lib/core/audio/voice_recorder.dart:80`; `lib/features/calls/application/call_media_providers.dart:63`; `apps/api/src/communication/calls/call.service.ts:29` | OWNER ATTESTATION REQUIRED |
| Files and docs | Yes | Optional | App functionality | as messages | `media_picker.dart:202-213` | OWNER ATTESTATION REQUIRED |
| App interactions (story views and taps, read receipts, notification "acted", material opens per child) | Yes | Required | App functionality, analytics | partly | `http_story_repository.dart:59,65`; `receipt_repository.dart:63`; `notifications_repository.dart:123`; `materials_repository.dart:127-129` | OWNER ATTESTATION REQUIRED |
| Other user-generated content (feedback, reports, lesson reports, leave requests, certificate requests, whiteboards, task comments, "about" text) | Yes | Optional | App functionality | partly; lesson reports and child records kept | `http_feedback_repository.dart:47`; `http_moderation_repository.dart:21`; `http_lesson_repository.dart:54,59`; `http_supervision_repository.dart:35-49`; `whiteboards_repository.dart:158`; `http_task_repository.dart:56` | OWNER ATTESTATION REQUIRED |
| Crash logs | Yes | Required (cannot be turned off) | App functionality, analytics | not account-linked after hashing; kept per vendor retention (UNVERIFIED) | `lib/core/crash/crash_reporting.dart:24-60` (release build with DSN); `enableAutoSessionTracking = false` at `:49` (on origin/main, confirmed) | OWNER ATTESTATION REQUIRED |
| Diagnostics | Yes (device model, OS version, screen-name breadcrumbs) | Required | App functionality, analytics | as above | `crash_reporting.dart:55-58,89-102`; tracing off `:53-54` | OWNER ATTESTATION REQUIRED |
| Device or other IDs (FCM token, Firebase installation ID, device model name) | Yes | Required | App functionality | token retired at sign-out and deletion | `lib/core/push/push_registration.dart:34-41`; `lib/core/network/device_descriptor.dart:86-91`; `android/app/build.gradle.kts:123-125` | OWNER ATTESTATION REQUIRED |
| Advertising ID | **No** | | | | AD_ID absent: merged manifest of the signed AAB, `grep -c AD_ID` = 0 | READY |
| Health, fitness; contacts; calendar; SMS or MMS; emails; installed apps; web browsing history; in-app search history; music files | No | | | | no such permission or code (`PERMISSIONS-AUDIT.md`; `activity_view_mobile.dart:62-68`); search is real-time, not stored | READY |

### 6.3 Child data (required section)

Google's Data safety form has no separate "child data" type: children's data is declared under the ordinary types above, and Families R7/R19 require disclosing it, including what SDKs collect.

| Child-related data | Where in the app or policy | Declared under | Entered by | Status |
|---|---|---|---|---|
| Child's name | shown in chats, billing, feedback forms: `lib/shared/models/conversation.dart:58-59`, `lib/features/feedback/presentation/teacher_feedback_form.dart:23`, `my_payments_screen.dart:487` | Name | staff and parents; the child does not type it | OWNER ATTESTATION REQUIRED |
| Date of birth or stated age, level, teacher | held by the academy; date of birth is staff-side (`http_lesson_repository.dart:140`); policy 4.4.1, 6.1 per `verification-part-C.md` | not collected through the Android app by evidence found; declare only if a code path sends it (none found) | staff | UNVERIFIED |
| Optional child photo, "about" | profile photo repository (`profile_photo_repository.dart:101,131`) | Photos, Other UGC | parent | OWNER ATTESTATION REQUIRED |
| Lesson records, teacher reports, rewards, certificates | `http_lesson_repository.dart:54,59`; `http_supervision_repository.dart:35-44` | Other UGC | teacher, staff | OWNER ATTESTATION REQUIRED |
| Material opens per child ("Opened this week") | `materials_repository.dart:127-129,109`; `schema.prisma:2928-2941` | App interactions | app records it | OWNER ATTESTATION REQUIRED |
| Child's voice in a live lesson call | relayed through LiveKit, not recorded: `call_media_providers.dart:63`; `call.service.ts:29` | Voice or sound recordings | child, on the parent's device | OWNER ATTESTATION REQUIRED |
| Child's name sent to Stripe | not applicable: cards are off; if switched on, line item is the request label only (#580, `checkout.service.ts:190-192`) | none | | READY |
| Advertising ID, location, contacts | not collected | none | | READY |
| What is kept after deletion | children's lesson records, name on payment records (7 years), call records, audit log, backups up to 56 days (live account-deletion page, section 3; `google-data-safety.md` 3.2) | disclosed in the privacy policy | | OWNER ATTESTATION REQUIRED |
| SDK collection from a child's device (FCM, Sentry, LiveKit) | section 5.3 row 4 | Device IDs, Crash logs, Diagnostics | | COUNSEL |

### 6.4 Cross-check with the live privacy policy (fetched 2026-11-18)

| Point | Policy says | Data safety draft | Result |
|---|---|---|---|
| Advertising, analytics, tracking | "No advertising, no analytics, no tracking. We do not use advertising identifiers, GPS or device location" | none declared | consistent |
| Providers | names Firebase Cloud Messaging, Sentry, LiveKit Cloud as service providers | not shared | consistent |
| Religion | child progress "may reveal the family's religion... treat it as sensitive" | religious beliefs = No | **MISMATCH**, see 6.2 |
| Sentry text | "We use Sentry to find and fix errors and crashes" (clause 4.13) | purpose includes Analytics (Google's crash-diagnosis purpose) | consistent in substance |
| Stripe | not named (cards off) | not declared | consistent |
| Children and account holders | "parents... aged 18 or over, who hold a family account"; child "has no account" | | consistent with section 5 facts, but see the target-audience risk |

### 6.5 What is not deletable (to state in the form's deletion answer)

Messages already sent (author becomes "Deleted user"), payment records and invoices with payer and child names (7 years), children's lesson records, call records, audit and report records, ended-session records, encrypted backups up to 56 days (live account-deletion page; `google-data-safety.md` 3.2).

### 6.6 Row-by-row comparison with `apple-app-privacy.md` (PR #591 version)

| Data | Google answer | Apple answer | Difference and reason |
|---|---|---|---|
| Name | Yes, required | Contact Info: Name Yes | same |
| Email | Yes | Email Address Yes | same |
| Phone | Yes, optional | Phone Number Yes | same |
| Address | No | Physical Address No | same |
| Location | Approximate Yes; precise No | Coarse Yes; precise No | same |
| Religious beliefs / Sensitive info | draft No (OPEN) | draft No (OPEN) | same draft; my recommendation (6.2) applies to both stores |
| Other info: teacher profile | separate row "Other info" Yes | no equivalent; sits inside Other User Content | Google has an "Other info" bucket, Apple does not; same data |
| Purchase history | Yes | Purchase History Yes | same |
| Payment info | No (cards off) | Payment Info No | same |
| Other financial info | Yes | Other Financial Info Yes | same |
| Messages | "Other in-app messages" Yes; "Emails" No; "SMS" No | "Emails or Text Messages" Yes | naming only |
| Customer support | no such type; feedback sits in Other UGC | Customer Support Yes | Google has no support category |
| Photos, videos | Yes both | Photos or Videos Yes | same |
| Audio | Voice or sound recordings Yes | Audio Data Yes | same |
| Files and docs | Yes (own type) | in Other User Content | Google has own type |
| Other UGC | Yes | Yes | same |
| App interactions / Product Interaction | Yes; purposes App functionality + Analytics | Yes; App Functionality + Analytics | same |
| Crash logs | Yes; **App functionality + Analytics** | Crash Data Yes; **App Functionality only** | **Deliberate difference:** Google's Analytics purpose covers diagnosing crashes; Apple's Analytics means usage analytics (`google-data-safety.md` 2.3) |
| Diagnostics | Yes; same purposes as above | Other Diagnostic Data Yes; App Functionality only | same reason |
| Performance data | No | No | same (tracing off) |
| Device or other IDs | Yes (FCM token, installation ID, model) | Device ID Yes (APNs token, VoIP token, model) | same answer, different token type |
| User ID | Yes | Yes | same |
| Advertising / tracking | none; AD_ID absent | none; `NSPrivacyTracking=false` | same |
| Linked to user / ephemeral | Google asks "ephemeral": No for all | Apple asks "linked": Yes for all | Different question, consistent facts |

## 7. Government apps

| Question | Answer | Evidence | Status |
|---|---|---|---|
| Is this a government app? | **No** | Jawwid LLC, a Wyoming LLC (live privacy page, contact clause); not affiliated with a government (`play-declarations.md` §4) | READY |

## 8. Financial features

**Exactly what the app shows about payments** (code on origin/main; cards are off, no Play Billing, no IAP):
- Payment requests and "amount due" in the parent's Packages tab (`lib/features/billing/presentation/my_payments_screen.dart`), read via `GET /me/billing` (`http_billing_repository.dart:27`).
- Invoices and receipts to download (`my_payments_screen.dart:323-330`; `http_billing_repository.dart:92-93`).
- A bank-transfer screen where the parent uploads a photo or PDF of the transfer receipt with amount and date (`bank_transfer_screen.dart:21-25`; `http_billing_repository.dart:40-81`).
- Sales staff can record instalment payments in the app (`http_sales_payments_repository.dart:64`).
- No card payment: `billing.card_paused` (`apps/api/src/billing/card-pause.ts`), `LAUNCH_PHASE=review` is a repository variable of the production environment (`gh variable list --env production`). No Stripe keys per `google-data-safety.md` §4.
- No wallet, no loans, no banking, no transfers between users, no crypto.

| Question | Value | Evidence | Status |
|---|---|---|---|
| Financial features declaration | Repo draft: "My app doesn't provide any financial features" (a merchant collecting for its own lessons, not a financial service). **Owner attests; the Console's category list wording is UNVERIFIED.** State the facts above if Google asks | `play-declarations.md` §4 | OWNER ATTESTATION REQUIRED |
| Play Billing exemption (1:1 live lessons) | **OPEN. Do NOT claim it.** One Play explainer (answer 10281818) says a 1:1 paid service between two individuals and not replayable needs no Play Billing, but the Payments policy text itself (answer 9858738) did not show that sentence, lists education-type subscription services among those needing Play billing, and says apps may not lead users to a payment method other than Play billing (`verification-part-A.md` A11-A12; `verification-part-D.md` P1, P2, P3). Free installation does not settle it (P13). Not verified: whether bank-transfer instructions, invoices, receipts and receipt upload count as "leading users" (P3, P7) | `verification-part-D.md` section 1; `VERIFICATION-SUMMARY.md` | GOOGLE |
| Written question to Google Play Support | Text is in `verification-part-D.md` lines 37-45; counsel questions at 49-53 | | GOOGLE |
| Mismatch to avoid | `review-notes.md` Option C and `app-review-notes-payments.md` still say "under the 1:1 online paid services rule" and Stripe checkout; do not paste those phrases | `verification-part-D.md` note on repo drift | READY |

## 9. Health

| Answer | Evidence | Status |
|---|---|---|
| My app does not have any health features | no health or fitness permission; teachers' leave reason is free text, not requested as health data (`apple-app-privacy.md` 3.10) | READY |

## 10. News

| Answer | Evidence | Status |
|---|---|---|
| Not a news app | Stories are the academy's own announcements, the app cannot publish one (`http_story_repository.dart:17-18`) | READY |

## 11. COVID-19 contact tracing and status

| Answer | Evidence | Status |
|---|---|---|
| No | no related code or permission | READY |

## 12. Advertising ID

| Answer | Evidence | Status |
|---|---|---|
| **No** (the app does not use an advertising ID) | `com.google.android.gms.permission.AD_ID` absent: `grep -c AD_ID merged-manifest-1.0.0-3.xml` = 0 on the manifest extracted from the signed AAB (SHA-256 581032996e34...dfd, commit 2e41270151514df9dd560f79862d03f531b9f09d; `PERMISSIONS-AUDIT.md` lines 6-7, 26). Firebase Messaging only, no Analytics (`android/app/build.gradle.kts:123-125`) | READY |

## 13. Foreground service declaration (microphone)

Corrected text. The repo draft (`play-declarations.md` §5, on PR #591) says the service "starts only when the user starts or answers a call". What the code does on origin/main:
- Dart calls the platform channel `ongoingStart` when the call is connected (`lib/core/call_native/call_presentation.dart:203-205`); `MainActivity` handles it (`MainActivity.kt:175-179`) and calls `CallForegroundService.start`, which uses `ContextCompat.startForegroundService` (`CallForegroundService.kt:116-123`). It is started with the app in front; if Android refuses a background start, the call continues in front (`CallForegroundService.kt:122-124`). The call layer fires it at the moment `RECORD_AUDIO` is granted (`lib/core/call_media/call_media_client.dart:196-203`).
- The service type is microphone only: manifest lines 73-76 (`android:foregroundServiceType="microphone"`), `serviceTypes()` returns `FOREGROUND_SERVICE_TYPE_MICROPHONE` (`CallForegroundService.kt:64-67`). Permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` (manifest lines 28-29). Hang up is handled by `CallActionReceiver`; the service stops on `ongoingStop` (`MainActivity.kt:181-183`).
- `RECORD_AUDIO` is requested at the first record or call, not at launch.

| Field | Value | Evidence | Status |
|---|---|---|---|
| Foreground service type | Microphone | above; `PERMISSIONS-AUDIT.md` row 7 (type 0x80) | OWNER ATTESTATION REQUIRED |
| Task / use case | Voice calling: a user-started or user-answered audio call or live lesson | above | OWNER ATTESTATION REQUIRED |
| Describe the feature | "During an audio call or a live lesson, once the call is connected and the user has allowed the microphone, the app starts a foreground service so the microphone stays open when the user switches to another app or locks the screen and the call does not drop. The service shows an ongoing 'call in progress' notification with a Hang up button for the whole call and stops when the call ends." | `CallForegroundService.kt`; `call_presentation.dart:203-208` | OWNER ATTESTATION REQUIRED |
| Impact if delayed or stopped | "The user's audio is cut as soon as they leave the app, so the other person can no longer hear them and a lesson in progress is interrupted." | `play-declarations.md` §5 | OWNER ATTESTATION REQUIRED |
| Video link | **Missing.** Needed: link showing the steps that trigger the feature (Google: "Include a link to a video demonstrating each foreground service feature", Part B row 5 VERIFIED). The 30-90 s, unlisted-link plan is the repo's own guidance, not a Google rule (row 7). Shot list: `PLAY-CONSOLE-CHECKLIST.md` section 4 | `verification-part-B.md` rows 5, 7 | UNVERIFIED |
| Not verified on a device | Answering a call from a notification while the app is backgrounded on Android 14+ (while-in-use restriction on a microphone service, Part B row 8). The code tolerates a refused start; the device test has not been run | `VERIFICATION-SUMMARY.md` engineering flag | UNVERIFIED |

## 14. Full-screen intent declaration

| Field | Value | Evidence | Status |
|---|---|---|---|
| Does core functionality need full-screen intent? | **Yes: calling.** An incoming call (including a scheduled live lesson) rings with a CallStyle notification with Answer and Decline, over the lock screen while the app is closed | manifest line 23 `USE_FULL_SCREEN_INTENT`; `JawwidPush.kt:150-170` (`setFullScreenIntent(open, true)`, CallStyle) | OWNER ATTESTATION REQUIRED |
| What the app does on Android 14+ | Checks `NotificationManager.canUseFullScreenIntent()` and, if not allowed, logs "heads-up only"; the ring then appears as a heads-up notification with Answer and Decline. Unknown counts as allowed | `JawwidPush.kt:167-168,180-188`; `RingCheck.kt:69-70` | READY |
| Does a screen open the special-access settings page? | **No.** `openFullScreenIntentSettings` is defined (`lib/core/call_native/call_presentation.dart:225`, `MainActivity.kt:187,257`) and tested (`test/core/call_native/call_presentation_test.dart:193-199`) but no screen calls it (grep over `lib` finds only the definition). Do not tell Google the app offers it | grep on origin/main | READY |
| Description to enter | "The app shows a full-screen incoming-call screen when a teacher, the academy or a family member calls, including for a scheduled live lesson. It is used only for incoming calls, never for messages, reminders or promotions. On Android 14 and later the app checks whether it may use full-screen intents; if the permission is not granted, the call still rings as a heads-up notification with Answer and Decline." | `play-declarations.md` §6, consistent with code | OWNER ATTESTATION REQUIRED |
| Will Google accept "calling" for this app? | Google's decision. Google says only apps with calling or alarm functionality have it enabled by default and offers a "core functionality" declaration (Part B row 1 VERIFIED). Whether category matters is UNVERIFIED (row 3) | `verification-part-B.md` rows 1-4 | GOOGLE |

## 15. Account deletion URL

| Field | Value | Evidence | Status |
|---|---|---|---|
| URL | `https://admin.chat.jawwid.com/legal/en/account-deletion` | `curl -sS -L` 2026-11-18: **HTTP 200**, final URL unchanged. Quoted title: **"Delete your Jawwid account · Jawwid Academy"** (page heading "Delete your Jawwid account", "Version 1.0 · Effective 2026-11-17") | READY |
| What the page offers | In-app path (Settings > Delete account, password); a web form at `https://api.chat.jawwid.com/api/v1/account-deletion?lang=en` (sign-in name and password); e-mail fallback to info@jawwid.com; teacher 30-day request path | live page text; not fetched: the api form URL itself, UNVERIFIED | UNVERIFIED |
| In-app path | `lib/app/router.dart:94,362-363`; the Settings tile shows only for parent and teacher roles (`settings_screen.dart:279-287`) | code | READY |
| Google rule | "Apps that allow account creation must offer deletion in-app and through an external web resource" (Part C R20 VERIFIED, from UD); web link required for apps with account creation (`verification-part-A.md` A9) | | READY |
| Wording mismatch (minor) | The page says it covers "Jawwid: Quran Academy"; the owner decision is app name "Jawwid". Not a policy conflict found, but align it | live page | UNVERIFIED |

## 16. Support contact

| Field | Value | Evidence | Status |
|---|---|---|---|
| Store listing email | **info@jawwid.com** | GitHub environment `store-release` variable `SUPPORT_EMAIL` = info@jawwid.com (set 2026-11-11; read with `gh variable list`, value is not a secret); the live English support, privacy and account-deletion pages all show info@jawwid.com (decoded from Cloudflare's e-mail protection); the Arabic legal pages in the repo `apps/admin-web/legal-web/ar/*/index.html` use it | READY |
| Doc conflict | `docs/legal/apply-confirmed-values.md:38,49,70` and `docs/legal/owner-confirmation-sheet.md` say `support@jawwid.com` for the same token. The live pages and the variable say info@. Use info@ in the Console, and have the owner confirm that mailbox receives mail | `docs/legal/apply-confirmed-values.md` | UNVERIFIED |
| Website | `https://admin.chat.jawwid.com/legal/en/support` | `SUPPORT_URL` variable in `store-release`; not fetched by me | UNVERIFIED |
| Phone | leave empty | `play-declarations.md` §8 | READY |

## 17. Store settings: category

| Field | Value | Evidence | Status |
|---|---|---|---|
| App or game | App | | READY |
| Category | **Education** (proposed; alternative Communication) | Fits the educational purpose and keeps the app out of Social/Dating Child Safety scope (Part A A5 VERIFIED scope sentence "currently"); Google's Education category rules were not found (Part C R37 UNVERIFIED); no Google text ties category to full-screen-intent eligibility (Part B row 3 UNVERIFIED) | UNVERIFIED |
| Child Safety Standards declaration | Scope today: "Anonymous and Random chat apps, and apps in the Social and Dating categories" (R33 VERIFIED, and "presence or absence of child users is irrelevant", R34). Jawwid is named-account and Education, so not in listed scope. Keep the prepared answer ready if the Console asks: standards `https://admin.chat.jawwid.com/legal/en/child-safety`, in-app report (`chat_screen.dart:549`), contact info@jawwid.com ("read every day", child-safety policy 1.7 per the AR page). Scope can widen ("currently") | `verification-part-C.md` R33-R35 | READY |

---

## 18. Release-blocking engineering findings

**None confirmed as a hard blocker.** What I checked on origin/main and the signed AAB manifest:
- Permission prompts at launch: none. `RECORD_AUDIO` is requested when the user first records or joins a call (`lib/core/audio/voice_recorder.dart:142`; `lib/core/call_media/call_media_client.dart:202`); no camera, location, contacts or storage permission (`PERMISSIONS-AUDIT.md`). `POST_NOTIFICATIONS` is requested after sign-in (see finding 2).
- Account deletion path: present in app (`router.dart:94`, settings tile for parent and teacher) and on the web (HTTP 200, section 15).
- Declared vs actual: FGS type microphone matches code; FSI permission matches code; AD_ID absent; 14 permissions explained (`PERMISSIONS-AUDIT.md`); `allowBackup=false`; no cleartext, no deep-link filters.
- Report and block exist for UGC (`chat_screen.dart:549`, `profile_screen.dart:90`, `block_actions.dart`).
- Version: `pubspec.yaml:4` says `0.1.0+1` but the signed AAB's manifest shows 1.0.0 / 3 (CI inputs); consistent with the checklist note, no mismatch in the artifact.

**Findings to be aware of (conditional or non-blocking):**

1. **Conditional: no in-app online-safety reminder.** If child age groups are ticked and Google treats family chat and calls as a "social feature that includes children", R12 and R13 require a reminder and adult-action evidence. None exists on origin/main (no match in `lib`). Not a confirmed blocker because applicability is UNKNOWN (COUNSEL).
2. **Declaration text vs build.** `play-declarations.md` §7 (PR #591) says LR-11 is done: "the system prompt comes only after an explanation". Files `lib/core/push/push_permission_explainer.dart` and `push_permission_explainer_host.dart` are **not on origin/main**; on main `MainActivity.startRegistering` calls `requestPermissions(POST_NOTIFICATIONS)` straight after sign-in (`MainActivity.kt:285-288`). It is not at launch and not a Play rule violation I found, but the Console text and review notes must not say the prompt is explained first. Re-check which commit the signed AAB contains (it is 2e412701 = main).
3. **App access completeness.** Sales and super-admin roles can sign in to the app (`user_role.dart:6-12`) with Chats, Calls, Payments and Settings and there is no review account for them; Google could ask for one. The text discloses it. Smallest fix if asked: a fourth review account (`review-notes.md` §1).
4. **Data safety vs privacy policy.** Religious-beliefs row (section 6.2, 6.4).
5. **Payments policy risk, not an engineering defect.** The bank-transfer screen shows how to pay outside Play billing; Google's Payments policy says apps may not lead users to another payment method unless an exemption applies, and the exemption is unconfirmed (section 8). This is the single issue most likely to cause a review rejection; it needs Google or counsel, not code.
6. **Staff cannot delete in app** (sales, super admin: `settings_screen.dart:279-282`, LR-20). Accounts are created by the academy, not in-app, so I do not see it as a Play violation (UNVERIFIED).

---

## 19. Top risks (summary)

1. Payments: Play Billing exemption and anti-steering unresolved (GOOGLE/COUNSEL).
2. Target audience: evidence says children are the lesson audience; Families Policy then applies, with SDK, safety-reminder and age-screen questions open (COUNSEL).
3. Data safety attestation: religious-beliefs mismatch with the live privacy policy; service-provider "not shared" premise and child data disclosure to be confirmed.
4. Foreground-service video missing; answer-from-notification on Android 14+ not tested on a device.
5. App access: review accounts and review payment mode not confirmed live; no account for the sales role.

## 20. Evidence log of live checks (2026-11-18)

- `curl -sS -L https://admin.chat.jawwid.com/legal/en/account-deletion`: 200; title "Delete your Jawwid account · Jawwid Academy".
- `curl -sS -L https://admin.chat.jawwid.com/legal/en/privacy`: 200; title "Privacy Policy · Jawwid Academy"; `content-type: text/html`; last-modified 2026-11-18 09:55:12 GMT.
- Support, privacy and deletion pages: e-mail decoded from Cloudflare obfuscation = info@jawwid.com.
- `gh variable list --env store-release`: `PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_URL`, `SUPPORT_EMAIL` (values as above). `--env production`: `LAUNCH_PHASE=review`.
