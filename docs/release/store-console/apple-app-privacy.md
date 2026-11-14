# Apple App Privacy (the "nutrition label"): answers for App Store Connect

**Launch items LR-09, LR-23 and LR-71. Draft, 2026-11-08; re-verified 2026-11-09.** Pinned to `main` @
`bc47d376`: the answers were audited against that commit in the LR-71 dry run, after the privacy-manifest
fix LR-73 (#508), and every passage changed in the re-check was verified directly in the code. Paths are
relative to the repository root, cited as `file:line`.

**LR-71 pre-audit fixes, 2026-11-10:** re-checked against the launch candidate
`claude/merge-rehearsal-3-2026-11-10` @ `0aec87f1`, which this file now describes (it is merged after the launch
PRs). Changed: Sentry session tracking is off in the candidate (#526; §2, §3.8, §7 O-3); the child's name no
longer goes to Stripe (#580; §6); and the drifted `crash_reporting.dart` and `Info.plist` citations. Those
citations are **lines as of the launch candidate**; every other citation is still as of `bc47d376`.

**Where it goes:** App Store Connect → the app → **App Privacy** → Get Started / Edit.

**Rules this file follows**
- Apple counts data as **collected** when it leaves the device and is kept longer than it takes to
  serve the request in real time. Data the app's SDKs collect counts too (Sentry, and Apple's own push
  service only for the token).
- **No item is "used for tracking".** There is no advertising, analytics or attribution SDK, no data
  broker, and the privacy manifest says `NSPrivacyTracking = false` (`ios/Runner/PrivacyInfo.xcprivacy:20-23`).
  The app does not need App Tracking Transparency.
- **Everything collected is "linked to the user"**: it is stored against the account. Even the crash
  reports carry a hash of the account id (`lib/core/crash/crash_reporting.dart:67-76`).
- **Over-declaring is safer than under-declaring.** Where the code makes an answer uncertain, this
  file declares the type and says why.
- `[OWNER DECISION: ...]` marks an answer that waits for the owner or counsel. **OPEN** marks the same
  thing in the open-items list (§7), with the decision id. An OPEN answer stays as drafted until that
  decision is made; it is not changed here.

---

## 1. First screen

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **Yes, we collect data from this app** |

## 2. Data types: summary

| Apple category | Data type | Collected | Linked | Tracking | Purposes |
|---|---|---|---|---|---|
| Contact Info | Name | Yes | Yes | No | App Functionality |
| Contact Info | Email Address | Yes | Yes | No | App Functionality |
| Contact Info | Phone Number | Yes | Yes | No | App Functionality |
| Contact Info | Physical Address | **No** | — | — | — |
| Contact Info | Other User Contact Info | **No** | — | — | — |
| Health & Fitness | Health, Fitness | **No** | — | — | — |
| Financial Info | Payment Info | **No** `[OWNER DECISION: counsel, §3.2; OPEN, §7]` | — | — | — |
| Financial Info | Credit Info | **No** | — | — | — |
| Financial Info | Other Financial Info | Yes | Yes | No | App Functionality |
| Location | Precise Location | **No** | — | — | — |
| Location | Coarse Location | Yes | Yes | No | App Functionality |
| Sensitive Info | Sensitive Info | **No** `[OWNER DECISION: counsel, §3.4; OPEN, §7]` | — | — | — |
| Contacts | Contacts | **No** | — | — | — |
| User Content | Emails or Text Messages | Yes | Yes | No | App Functionality |
| User Content | Photos or Videos | Yes | Yes | No | App Functionality |
| User Content | Audio Data | Yes | Yes | No | App Functionality |
| User Content | Gameplay Content | **No** | — | — | — |
| User Content | Customer Support | Yes | Yes | No | App Functionality |
| User Content | Other User Content | Yes | Yes | No | App Functionality |
| Browsing History | Browsing History | **No** | — | — | — |
| Search History | Search History | **No** | — | — | — |
| Identifiers | User ID | Yes | Yes | No | App Functionality |
| Identifiers | Device ID | Yes | Yes | No | App Functionality |
| Purchases | Purchase History | Yes | Yes | No | App Functionality |
| Usage Data | Product Interaction | Yes | Yes | No | App Functionality, Analytics |
| Usage Data | Advertising Data | **No** | — | — | — |
| Usage Data | Other Usage Data | **No** (Sentry session tracking is off: #526, in the launch candidate; §3.8, §7) | — | — | — |
| Diagnostics | Crash Data | Yes | Yes | No | App Functionality |
| Diagnostics | Performance Data | **No** | — | — | — |
| Diagnostics | Other Diagnostic Data | Yes | Yes | No | App Functionality |
| Surroundings | Environment Scanning | **No** | — | — | — |
| Body | Hands, Head | **No** | — | — | — |
| Other Data | Other Data Types | **No** | — | — | — |

What the label will then show: **Data Used to Track You: none. Data Linked to You:** Contact Info,
Financial Info, Location, User Content, Identifiers, Purchases, Usage Data, Diagnostics.
**Data Not Linked to You: none.**

---

## 3. Each data type, with the evidence

For every "Yes" below, App Store Connect asks three things. The answers are the same for all of them
unless the row says otherwise:
1. **Purposes:** App Functionality (plus Analytics where stated). Never Third-Party Advertising,
   Developer's Advertising or Marketing, or Product Personalization.
2. **Is it linked to the user's identity?** Yes.
3. **Is it used for tracking?** No.

### 3.1 Contact Info

**Name: Yes.**
- A person's display name is shown in conversations and edited in the profile
  (`lib/core/data/http/http_profile_repository.dart:38`, `:47`).
- A teacher edits their professional profile in the app (`lib/core/data/http/http_teacher_profile_repository.dart:72-140`).
- A child's name and the payer's name appear on payment requests and invoices the app shows
  (`lib/core/data/http/http_billing_repository.dart:27`; `lib/features/billing/presentation/my_payments_screen.dart:323-330`).
- Data inventory: `docs/legal/data-inventory-and-retention-matrix.md` §3, "Parent / guardian profile" and "Child / student".

**Email Address: Yes.**
- A parent's sign-in name is their e-mail. It is sent at sign-up (`lib/core/data/http/http_parent_signup_repository.dart:18`, `:49-50`)
  and at every sign-in (`lib/core/data/http/http_auth_repository.dart:81-84`).

**Phone Number: Yes.**
- The "forgot e-mail" screen sends the phone number the person types, to find the account and send a
  recovery code (`lib/features/auth/presentation/forgot_email_screen.dart:102`;
  `lib/core/data/http/http_account_recovery_repository.dart:28`, `:35`).
- The phone number is held on the account's family record. Staff usually type it in Admin Web
  (data inventory §3, "Parent contact details"), but the app sends it too, so declare it.
- The privacy manifest declares it (`ios/Runner/PrivacyInfo.xcprivacy:141-142`, added by LR-73, #508).
  This answers DEV-CONFIRM #17 in the data inventory: declare it. See §5.

**Physical Address: No.** No street address field exists in the app. The parent's location is a
country and a region, declared as Coarse Location (§3.3).

### 3.2 Financial Info

**Payment Info: No.** Card details are typed on Stripe's hosted Checkout page, which opens **in the
browser**, outside the app (`lib/core/data/http/http_billing_repository.dart:31-32`;
`docs/release/app-review-notes-payments.md` §4). Jawwid never receives the card number
(data inventory §2, Stripe; §3, "Payment card data").
After a card payment, the server stores and shows the **card brand, the last four digits and the wallet type**
returned by Stripe on each invoice, linked to the family (`http_billing_repository.dart:125-133`, `:226`). The
answer stays **No**, because the app never collects or sends card data; it only displays Stripe's own masked
summary of a payment made outside the app. The invoice itself is declared under Purchase History. If counsel
prefers to over-declare, change this to Yes, linked, App Functionality; the label is not otherwise affected.
**OPEN (counsel; see §7):** whether the stored card summary counts as Payment Info. The answer stays No
until counsel decides.

**Other Financial Info: Yes.**
- For a bank transfer, the parent uploads the **transfer receipt** (a photo, a camera shot or a PDF),
  with the amount and the transfer date (`lib/features/billing/presentation/bank_transfer_screen.dart:21-25`;
  `lib/core/data/http/http_billing_repository.dart:40-81`).
- A bank receipt usually shows the payer's bank and account details. That is financial information
  beyond the purchase itself.

**Credit Info: No.** No credit score or credit check.

### 3.3 Location

**Precise Location: No.**
- No location API is used. `Info.plist` has no `NSLocation…UsageDescription` key (its usage strings are
  camera, photos, microphone and Face ID only: `ios/Runner/Info.plist:56-70`), and `pubspec.yaml` has no
  location or GPS plugin.

**Coarse Location: Yes.** What the code really collects:
1. **The country and first-level region** (state, emirate, governorate) that the parent chooses in a
   one-time prompt, with "Later" to skip (`lib/app/shells/app_shell.dart:162`,
   `lib/features/profile/presentation/location_prompt_gate.dart:72`,
   `lib/shared/location/location_repository.dart:45-48`, `:57`). PD-45.
2. **The phone's time zone** (an IANA name such as `Asia/Kuwait`), sent automatically while the
   time-zone setting is automatic (`lib/core/time/time_zone_api.dart:52-53`, `:81`;
   `lib/core/time/time_zone_controller.dart:112`).

Both describe where the person is at a resolution coarser than a city. The manifest already declares
`NSPrivacyCollectedDataTypeCoarseLocation` (`ios/Runner/PrivacyInfo.xcprivacy:50-61`).

> **LR-23 asked whether to keep Coarse Location.** The launch checklist read it as "for a time zone
> (no location API)". The code shows a second, stronger reason: the parent's country and region
> (PD-45). **Recommendation: keep it declared**, in the label and in the manifest.

### 3.4 Sensitive Info

**Sensitive Info: No** `[OWNER DECISION: counsel (legal matrix L-10, L-14) decides whether enrolment in
Quran lessons counts as data revealing "religious or philosophical beliefs"]`.
- The app has no field that records anyone's religion or beliefs.
- But several markets treat religious-course data as special-category data (data inventory, LD-13 in
  `docs/legal/outstanding-information-and-decisions.md`). **OPEN: L-10 / L-14 / LD-13 (§7).**
- If counsel says yes, change this answer to **Yes, linked, not tracking, App Functionality**. Declaring
  it is never a policy violation; omitting a type that applies is.

### 3.5 User Content

**Emails or Text Messages: Yes.** Chat messages, with their edits, reactions and read receipts, are
sent to and stored by Jawwid's server (`lib/core/data/http/http_message_repository.dart:99`).
Apple's definition ("including … the contents of the … message") covers in-app chat.

**Photos or Videos: Yes.**
- Photos and videos attached in chat, from the camera or the photo picker
  (`lib/core/media/media_picker.dart`; upload `lib/core/data/http/http_message_repository.dart:215`).
- Profile photos (`lib/features/profile/data/profile_photo_repository.dart:101`, `:131`).
- Chat wallpaper images (`lib/features/messages/data/chat_theme_repository.dart:58`, `:82`).
- Usage strings: `ios/Runner/Info.plist:56-63`.

**Audio Data: Yes.**
- Voice messages recorded in chat (`lib/core/audio/voice_recorder.dart:80`) and the sound of recorded videos.
- Live call and lesson audio is **relayed** through LiveKit and **not recorded**
  (`lib/features/calls/application/call_media_providers.dart:63`; data inventory §2, LiveKit). Live audio
  alone would not count as collected, but voice messages do, so the answer is Yes either way.

**Customer Support: Yes.** A parent's feedback to the academy and the academy's answer
(`lib/core/data/http/http_feedback_repository.dart:47`; PD-32). Reports of messages or people are
also complaints to the academy (`lib/core/data/http/http_moderation_repository.dart:21`).

**Other User Content: Yes.** Everything else a person writes or draws:
- profile "about" text (`http_profile_repository.dart:38-47`);
- files and documents attached in chat, such as PDFs (`lib/core/media/media_picker.dart:202-213`);
- reports and their notes (`http_moderation_repository.dart:21`), blocks (`lib/core/data/http/http_block_repository.dart:23`);
- a teacher's lesson reports (`lib/core/data/http/http_lesson_repository.dart:54`, `:59`), absence notes (`:171`);
- leave requests with a free-text reason (`lib/core/data/http/http_supervision_repository.dart:49`);
- learner certificate requests: the learner, the certificate title, the achievement, the date, the name
  to print, and an optional grade and note (`http_supervision_repository.dart:35-44`, `POST /learner-certificates`;
  sent from `lib/features/supervision/presentation/supervision_ticket_sheet.dart:217`). Added in the LR-71 re-check;
  the label answer does not change, because Other User Content is already Yes;
- whiteboard drawings (`lib/features/whiteboards/data/whiteboards_repository.dart:158`);
- task comments (`lib/core/data/http/http_task_repository.dart:51`, `:56`);
- a teacher's professional profile: bio, specialization, qualifications, experience, languages, and
  certificate files with title, issuer and date (`http_teacher_profile_repository.dart:72-79`, `:120-125`).
  Today only the teacher sees it (the route `/settings/professional-profile` is teacher-only,
  `lib/app/router.dart:558`); showing it to families is planned, not built. Certificate images and PDFs
  (`lib/shared/models/teacher_profile.dart:155-162`: PDF, JPEG, PNG) are the same kind of data as the Photos or Videos and file items.

**Gameplay Content: No.** The learning games are lessons; nothing a player makes is saved as game content.

### 3.6 Identifiers

**User ID: Yes.** The account id, used on every request, and its SHA-256 hash attached to crash reports
(`lib/core/crash/crash_reporting.dart:70`, `:76`).

**Device ID: Yes.**
- The push token (APNs, and the VoIP token) registered with Jawwid's server
  (`lib/core/push/push_registration.dart:34-41`).
- The device's model name and app version, sent at sign-in and shown in the person's device list
  (`lib/core/network/device_descriptor.dart:79-91`; `lib/core/data/http/http_auth_repository.dart:78-87`).
- The app does **not** read the advertising identifier (IDFA) or `identifierForVendor`.

### 3.7 Purchases

**Purchase History: Yes.** The app shows the parent their payment requests, payments, transfer receipts
and **invoices to download**, and sends what they pay for:
- `GET /me/billing` (`lib/core/data/http/http_billing_repository.dart:27`);
- card checkout for a lesson package (`:31-32`), transfer receipt with the amount and date (`:76-81`),
  invoice download link (`:92-93`);
- the "Invoices" and "Receipts" sections (`lib/features/billing/presentation/my_payments_screen.dart:323-330`);
- Sales staff record instalment payments in the app (`lib/core/data/http/http_sales_payments_repository.dart:64`).

> **LR-23 finding, now done:** the privacy manifest declares Purchase History
> (`ios/Runner/PrivacyInfo.xcprivacy:194-205`, LR-73, #508). See §5.

### 3.8 Usage Data

**Product Interaction: Yes.** Purposes: **App Functionality and Analytics.**
- Story (announcement) views and button taps are recorded (`lib/core/data/http/http_story_repository.dart:59`, `:65`),
  and the publisher sees who viewed. Showing a publisher its audience is close to Apple's "measure audience
  size", so Analytics is declared too.
- Message delivery and read receipts (`lib/features/messages/data/receipt_repository.dart:63`), mention
  "seen" marks (`lib/features/messages/data/mention_repository.dart:97`), notification "acted" marks
  (`lib/features/notifications/data/notifications_repository.dart:123`).
- Material opens: when a lesson material is opened for a child, the server records which item, for which
  child, by whom and when (`lib/features/materials/data/materials_repository.dart:127-129`,
  `POST /materials/items/:id/open`; stored append-only as `MaterialOpen`, `apps/api/prisma/schema.prisma:2928-2941`).
  The parent sees it back as "Opened this week" (`materials_repository.dart:19-21`, `:109`). Added in the
  LR-71 re-check; Product Interaction is already Yes, so the label does not change.

**Advertising Data: No.** No ads.

**Other Usage Data: No.** **Done in the launch candidate (#526); see §7.** The Sentry SDK turns automatic
session tracking on by default; the app turns it off (`enableAutoSessionTracking = false`,
`lib/core/crash/crash_reporting.dart:49`), so release builds send no app-session start and end events
(release health), and this answer stays No. If a build without #526 were ever submitted, the session data
would have to be declared (Other Usage Data, or Other Diagnostic Data, App Functionality, here and in
`google-data-safety.md`).

### 3.9 Diagnostics (Sentry)

Crash reporting runs **only in a release build with a Sentry DSN** (`lib/core/crash/crash_reporting.dart:24-28`).
Store builds must carry the DSN (launch item LR-21), so answer as if it is on.

**Crash Data: Yes.** The crash stack with scrubbed messages (`crash_reporting.dart:104-120`).
Linked: it carries the hashed account id (`:70`, `:76`).

**Other Diagnostic Data: Yes.** Sentry adds the device model and OS version to each event, and the app
keeps the last navigation steps (screen names only) as breadcrumbs (`crash_reporting.dart:55-58`, `:89-102`).

**Performance Data: No.** Performance tracing is off (`tracesSampleRate = null`,
`enableAutoPerformanceTracing = false`: `crash_reporting.dart:53-54`). No screenshots or view hierarchy
are attached (`:51-52`). `sendDefaultPii = false` (`:50`). The options are set at `:45-60`.

Purpose: **App Functionality** only, for Crash Data and Other Diagnostic Data. Apple's definition of App
Functionality includes "minimize app crashes". Analytics is **not** declared for them: the reports go only
to Sentry, are used to find and fix crashes, and there is no analytics SDK and no tracing
(`crash_reporting.dart:53-54`). The manifest says the same (`ios/Runner/PrivacyInfo.xcprivacy:124-135`, `:223-234`).
Google declares "App functionality, Analytics" for the same data, because Google's Analytics purpose
covers diagnosing and fixing crashes; the stores define purposes differently (`google-data-safety.md` §2.3).
Do not add Analytics here to match Google.

### 3.10 Types the app does not collect

| Type | Why "No" | Evidence |
|---|---|---|
| Health, Fitness | No health or fitness feature. A teacher's leave reason is free text; the app does not ask for health data | — |
| Contacts | The app never reads the address book. Conversation members are set by the academy | No contacts plugin in `pubspec.yaml`; no `NSContactsUsageDescription` |
| Browsing History | The in-app web view shows only the academy's own lesson activities and refuses other pages | `lib/features/materials/presentation/activity_view_mobile.dart:62-68` |
| Search History | Searches are answered in real time and not stored; server logs keep the route template only | Data inventory §1, "Application logs" |
| Environment Scanning, Hands, Head | No AR, no camera analysis | — |
| Face ID | The system answers yes or no; the app never receives biometric data | `ios/Runner/Info.plist:69-70` |

---

## 4. Privacy Policy URL (App Store Connect → App Privacy)

| Field | Value |
|---|---|
| Privacy Policy URL | `{{PRIVACY_POLICY_URL}}` (Arabic and English, public, no sign-in) |
| User Privacy Choices URL (optional) | `{{ACCOUNT_DELETION_URL}}` (the public `/account-deletion` page) |

Both wait for LR-04 (hosting) and LD-16.

## 5. Mismatches with the privacy manifest (for the Mobile engineer, LR-23)

Apple compares the label with `PrivacyInfo.xcprivacy` and the SDK manifests in the privacy report.

**Done (LR-73, #508; re-checked at `bc47d376`).** The seven entries this section used to list as missing are
now declared, each linked, not tracking, with the purposes below (`ios/Runner/PrivacyInfo.xcprivacy:136-234`).
The manifest now lists the same 16 "Yes" types as §2, one for one (`:24-235`). Product Interaction now
also covers material opens (§3.8); the manifest entry needs no change for that.

| `NSPrivacyCollectedDataTypes` entry | Manifest lines | Purposes | Label section |
|---|---|---|---|
| `NSPrivacyCollectedDataTypePhoneNumber` | `:140-151` | App Functionality | §3.1 |
| `NSPrivacyCollectedDataTypeOtherFinancialInfo` | `:154-165` | App Functionality | §3.2 |
| `NSPrivacyCollectedDataTypeEmailsOrTextMessages` | `:167-178` | App Functionality | §3.5 |
| `NSPrivacyCollectedDataTypeCustomerSupport` | `:181-192` | App Functionality | §3.5 |
| `NSPrivacyCollectedDataTypePurchaseHistory` | `:194-205` | App Functionality | §3.7 |
| `NSPrivacyCollectedDataTypeProductInteraction` | `:208-220` | App Functionality, Analytics | §3.8 |
| `NSPrivacyCollectedDataTypeOtherDiagnosticData` | `:223-234` | App Functionality | §3.9 |

What remains is the archive check below.

Then run Xcode's **privacy report** on the archive (Organizer → the archive → Generate Privacy Report)
and check that every SDK's declared types appear in this label.

## 6. Before you press Publish

- [ ] The privacy report from the release archive has no type that is missing here.
- [ ] Counsel has answered §3.4 (Sensitive Info).
- [x] LD-8 is done in the launch candidate (#580): the Stripe line item is the payment request's label
      only, never the child's name (`apps/api/src/billing/checkout.service.ts:120-131`, lines as of the
      launch candidate). Nothing changes here either way: Stripe is a processor, and Apple's label does not
      ask about sharing with processors. The label is typed by staff, who must not type a child's name in it.
- [ ] The Privacy Policy (`docs/legal/privacy-policy-*.md`) says the same as this label.
- [ ] The privacy report shows no Performance Data from the Sentry Cocoa SDK's own manifest. It could not
      be read without a build (machine rule); if it is listed, declare Performance Data, App Functionality.
- [ ] Every OPEN item in §7 is decided, and any answer it changes is updated here and in `google-data-safety.md`.

## 7. Open items (LR-71)

Each answer below stays as drafted until its owner decides. Nothing here changes an answer.

| # | Item | Answer today | Decision id and owner | Where |
|---|---|---|---|---|
| O-1 | Payment Info: does the stored card brand, last four digits and wallet count? | No | **OPEN.** Counsel. No id yet in `docs/legal/outstanding-information-and-decisions.md`; the lead should register one | §3.2; `google-data-safety.md` §2 |
| O-2 | Sensitive Info: is Quran-lesson enrolment "religious beliefs"? | No | **OPEN.** Counsel. Related: L-10, L-14, LD-13, but none of them asks this label question directly; the lead should register an id | §3.4; `google-data-safety.md` §2 |
| O-3 | Other Usage Data: Sentry automatic session tracking | No | **Done in the launch candidate (#526):** `crash_reporting.dart:49`. Closed | §3.8; `google-data-safety.md` §2.2 |
| O-4 | Privacy Policy and User Privacy Choices URLs | placeholders | **OPEN.** LR-04, LD-16 | §4 |

The target audience, storefronts, Families, Child Safety Standards and Advertising ID items are Play
questions; they are listed in `play-declarations.md` §10 and `google-data-safety.md` §6.
