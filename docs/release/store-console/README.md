# Store console answers: Jawwid Chat

**Launch items LR-09 (store listing and console forms) and LR-23 (App Privacy and Data safety match the
code).** Draft, 2026-11-08, written by the App Store Compliance Specialist from the code on `main` @
`cf731af2`. Nothing here has been entered in a console; the owner pastes the answers.

**LR-71 re-check, 2026-11-09:** `apple-app-privacy.md`, `google-data-safety.md` and the parts of
`play-declarations.md` named in its header were re-verified against `main` @ `bc47d376` and are pinned
there. `age-rating.md` and `listing-copy.md` were not changed and stay pinned to `cf731af2`. Each
re-verified file ends with an **Open items** list: answers that wait for an owner, counsel or lead
decision, marked **OPEN** with the decision id.

Every answer cites its evidence as `file:line`. `[OWNER DECISION: ...]` marks an answer that waits for
the owner or counsel. `{{PLACEHOLDER}}` marks a fact that does not exist yet (a URL, an e-mail, a
credential). No credential, entity name, address or URL has been invented.

## Files

| File | Console | What it answers |
|---|---|---|
| [apple-app-privacy.md](apple-app-privacy.md) | App Store Connect → App Privacy | Every data type: collected, linked, tracking, purposes, evidence. Maps each type to its privacy-manifest entry (§5) |
| [google-data-safety.md](google-data-safety.md) | Play Console → App content → Data safety | Every data type, the Firebase Installations ID, Sentry, encryption in transit, deletion |
| [age-rating.md](age-rating.md) | App Store Connect → Age Rating; Play → Content rating (IARC) | Apple's current questionnaire (incl. user-generated content, messaging, social media) and IARC |
| [play-declarations.md](play-declarations.md) | Play Console → App content, Store settings | Target audience, App access (review instructions), ads, financial features, health, news, government, foreground service (and its video), full-screen intent, permissions, category, countries |
| [listing-copy.md](listing-copy.md) | Both listings | Name, subtitle, short and full descriptions, keywords, what's new (Arabic first), screenshot sizes and shot list |

## Findings from the code (for the lead)

1. **Coarse Location stays declared (LR-23).** Besides the phone's time zone, the parent picks a country
   and region (PD-45), sent to the server (`lib/shared/location/location_repository.dart:45-48`). No GPS
   or location permission exists on either platform.
2. **Done (LR-73, #508):** the iOS privacy manifest now declares the seven collected types it used to
   miss (phone number, other financial info, emails or text messages, customer support, purchase
   history, product interaction, other diagnostic data): `ios/Runner/PrivacyInfo.xcprivacy:136-234`;
   `apple-app-privacy.md` §5.
3. **Purchase History must be declared** on both stores: the app shows payments, receipts and
   downloadable invoices (`lib/features/billing/presentation/my_payments_screen.dart:323-330`).
4. **The review cohort has nothing to pay**, so a reviewer cannot reach the pay sheet that the payments
   review notes point to (`play-declarations.md` §2).
5. **Today's payment tab is named "Subscriptions"** (`lib/app/router.dart:140-142`); screenshots and
   review notes must wait for the LR-15 rename or avoid it.
6. **The data inventory cites `checkout.service.ts:129`** for the child's name in the Stripe line item; it
   is now line 147.
7. **The Foreground service and full-screen intent declarations must match the submitted build.** LR-14
   is done (#505: microphone only, `phoneCall` and `MANAGE_OWN_CALLS` removed). LR-27 (check
   `canUseFullScreenIntent()`) is still open.
8. **"Encrypted in transit: Yes": LR-32 is done (#506).** The server refuses a non-`wss://` LiveKit URL
   when `APP_ENV=production` (`apps/api/src/communication/calls/media-token.ts:92-102`).
9. **Crash data purposes differ between the stores on purpose (LR-71):** Google gets "App functionality,
   Analytics", because Google's Data safety Analytics purpose covers monitoring app health and diagnosing
   and fixing bugs or crashes. Apple gets App Functionality only, because Apple's App Functionality covers
   minimizing app crashes. The stores define purposes differently; do not make them match
   (`google-data-safety.md` §2.3).
10. **Collected but not cited before (LR-71):** learner certificate requests (Other User Content) and
    material opens (Product Interaction / App interactions). Both fall under types already declared Yes.
11. **Sentry automatic session tracking is on by default** and not yet turned off in
    `lib/core/crash/crash_reporting.dart` on main. Decided: off in #526 (pending merge). Confirm #526 is
    in the submitted build before either privacy form is saved; if not, declare it.

## Owner must confirm

Each item has a recommendation, so the answer can be yes or no.

| # | Decision or input | Recommendation | Where it is used |
|---|---|---|---|
| 1 | **Target audience** (N-1 / LD-5) | Account holders 18+; not the Kids Category; no child imagery | `play-declarations.md` §1; `age-rating.md` §1.4 |
| 2 | **Storefronts** (LD-15 / LR-17) | Academy markets first; no US until age assurance; EU with trader details | `age-rating.md` §1.1; `play-declarations.md` §9 |
| 3 | App name in each store | «جَوِّد: أكاديمية القرآن» / "Jawwid: Quran Academy" | `listing-copy.md` §1 |
| 4 | Category | Education (both stores) | `listing-copy.md` §8; `play-declarations.md` §8 |
| 5 | Are Arabic or tajweed taught as courses in this app? | Quran only unless yes | `listing-copy.md` §5.3, §6 |
| 6 | Payment tab wording (LR-15) | Lesson-package wording, before screenshots | `listing-copy.md` §9.2 |
| 7 | Live card payments at launch (LR-34) | Owner's call; the copy drops the card sentence if not | `listing-copy.md` §5.3 |
| 8 | A payable lesson-package request in the review cohort | Yes, so a reviewer can reach Pay | `play-declarations.md` §2 |
| 9 | Apple "Social Media" answer | No | `age-rating.md` §1.2 |
| 10 | Apple age-rating override | None (calculated rating, expected 4+) | `age-rating.md` §1.4 |
| 11 | Counsel: is Quran-lesson enrolment "religious beliefs" data? | Counsel decides; declare if unsure | `apple-app-privacy.md` §3.4; `google-data-safety.md` §2 |
| 12 | Counsel: Stripe's role (L-4) and the child's name in the line item (LD-8) | Remove the child's name | `google-data-safety.md` §4 |
| 13 | Counsel: IARC "Shares Info" | No | `age-rating.md` §2.3 |
| 14 | URLs and contacts | Required facts | `{{PRIVACY_POLICY_URL}}`, `{{TERMS_URL}}`, `{{SUPPORT_URL}}`, `{{SUPPORT_EMAIL}}`, `{{ACCOUNT_DELETION_URL}}`, `{{CHILD_SAFETY_POLICY_URL}}`, `{{SAFEGUARDING_EMAIL}}`, `{{RATING_CONTACT_EMAIL}}` |
| 15 | Review credentials | Typed only into the consoles | `{{REVIEW_PARENT_EMAIL}}`, `{{REVIEW_PARENT_PASSWORD}}`, `{{REVIEW_TEACHER_EMAIL}}`, `{{REVIEW_TEACHER_PASSWORD}}` |
| 16 | The foreground-service video | Recorded after LR-01, LR-05, LR-14, on an Android 14+ phone | `{{FGS_VIDEO_URL}}`, `play-declarations.md` §5 |
| 17 | A vector logo (LR-36) | Required for the icon and the Play feature graphic | `listing-copy.md` §9.1 |

## Before submission (blocks the answers being true)

LR-01 (production backend), LR-03 (teacher deletion), LR-04 (hosted policies), LR-05 (review accounts),
LR-11 (notification permission timing), LR-15 (payment wording), LR-27 (full-screen check), and the
merged-manifest and privacy-report checks of the release builds (release audit WP-6). LR-14 (#505),
LR-32 (#506) and LR-73 (#508) are done. See the launch readiness checklist.

## Not verified here

- Google's and Apple's live help pages for the Data safety form, the IARC questionnaire, the Play
  declarations and the screenshot sizes could not be read from this machine on 2026-11-08 (Apple's
  age-rating topic list was read). Each file says where to re-read.
- No build, privacy report or merged manifest was produced (machine rule). The SDK answers come from
  `pubspec.yaml`, `android/app/build.gradle.kts` and the plugin notes in `ios/Runner/PrivacyInfo.xcprivacy`.
