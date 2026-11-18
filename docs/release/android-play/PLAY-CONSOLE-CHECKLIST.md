# Google Play Console readiness checklist: Jawwid Chat (Android)

> **Update 2026-11-18, confirmed owner decisions (these supersede earlier drafts in this folder):**
> 1. **Target audience:** children, parents and teachers. 2. **Price:** free to download. 3. **Distribution:** worldwide, in every country where Google Play distribution is available and legally permitted. 4. **App name:** Jawwid. 5. **Category:** Education stays *proposed*, pending final confirmation.
> Earlier text that says "18 and over only", "Families not applicable" or lists a country shortlist is **superseded** and kept only for history. Status labels used below: CONFIRMED DECISION (owner), VERIFIED (an official page as extracted directly states it), UNVERIFIED (not established), COUNSEL/GOOGLE (needs legal or Google approval).
>
> **Rows changed by these decisions (status after the update):**
> | Console task | Value now | Status |
> |---|---|---|
> | Pricing (Free or paid) | **Free** | CONFIRMED DECISION. (Google fact that a free app cannot later become paid: not verified here, so treat the choice as permanent until Google confirms.) |
> | Target audience and content > age groups | Tick the child groups that fit (the owner's own child-safety policy: lessons designed primarily for ages 5 to 12, enrolment from age 3: `child-safety-policy-en.md:39`) plus 18 and over (parents, teachers). Exact groups: owner and counsel to confirm | CONFIRMED DECISION (audience); group selection COUNSEL |
> | Families / Designed for Families | **Families Policy applies** once any child group is ticked (Google, answer 9893335, as extracted) | VERIFIED. Gaps in `verification-part-C.md` section 3 |
> | Ads | No ads; Families self-certified ad SDK program does not apply with no ads | VERIFIED (program scope) + repo evidence |
> | Child Safety Standards | In Google's current scope only for anonymous/random chat apps and the Social and Dating categories; Jawwid is Education with named adult accounts. Standards, in-app report and contact already exist in the repo | VERIFIED (scope as extracted, "currently"); keep the prepared answer ready |
> | Countries / regions | **All countries where Play distribution is available and legally permitted** | CONFIRMED DECISION. Legal review per country: COUNSEL (`verification-part-D.md` section 2) |
> | Payments declarations | Exemption question stays **OPEN** | UNVERIFIED: `verification-part-D.md` section 1 |
> | Category | Education (proposed) | PROPOSED; Google's Education category rules not found (UNVERIFIED) |


Prepared 2026-11-18, read-only, from `origin/main` @ `2e41270151514df9dd560f79862d03f531b9f09d`.
App: `com.jawwid.jawwid_chat`, release 1.0.0 (code 3). No Play Console access was available: nothing below was checked in a console.
All `{{...}}` values are typed only in the console, never stored in a repo. Repo docs are cited as `docs/release/...` (short names below are under `docs/release/store-console/` unless noted):
PD = play-declarations.md, DS = google-data-safety.md, LC = listing-copy.md, AR = age-rating.md, RN = review-notes.md, RA = docs/release/review-accounts.md, PAY = docs/release/app-review-notes-payments.md, CI = docs/release/signed-builds-ci.md.

Status key: READY (value exists, only paste) / OWNER (needs owner decision) / ASSET (file or URL must be produced) / UNVERIFIED (could not be confirmed).

---

## 1. Checklist in console order

### A. Create app (Play Console > All apps > Create app)
| Field | Value | Status | Source |
|---|---|---|---|
| App name | Draft: "Jawwid: Quran Academy" (EN) / «جَوِّد: أكاديمية القرآن» (AR). Max 30 chars. | OWNER (final name) | LC §1. Note installed label is "Jawwid" (`android/app/src/main/res/values/strings.xml` app_name) |
| Default language | Arabic (primary), add English | READY | LC header ("Arabic first") |
| App or game | App | READY | PD §8 |
| Free or paid | Free (no price in repo docs; paid lessons are outside Play) | UNVERIFIED (no doc states it; assumed from no-IAP stance, PAY §1-3) | PAY |
| Declarations (Developer Program Policies, US export laws) | Owner ticks | OWNER | - |
| Package name | `com.jawwid.jawwid_chat` (permanent once the first bundle is uploaded) | READY | `android/app/build.gradle.kts` applicationId |

### B. Main store listing (Grow > Store presence > Main store listing)
| Field | Value | Status | Source |
|---|---|---|---|
| Short description (80) | AR: دروس قرآن فردية مباشرة، ومحادثة أسرتك مع المعلّم والمشرف في مكان واحد. EN: Live one-to-one Quran lessons, and your family's chat with the teacher. | READY | LC §3 |
| Full description (4000) | LC §5.1 (AR) and §5.2 (EN). **Delete "by card on Stripe's secure page" / «ببطاقة عبر صفحة Stripe الآمنة» (Payments section) because card payments are off at launch.** Fill `{{PRIVACY_POLICY_URL}}`, `{{TERMS_URL}}`, `{{SUPPORT_URL}}`. | READY after edit; URLs ASSET | LC §5, §10 checklist; DS §2 (card off) |
| App icon 512x512 PNG | Not in repo docs; LR-36 says owner supplies vector logo | MISSING ASSET | LC §9.1 |
| Feature graphic 1024x500 | Not produced | MISSING ASSET | LC §9.1 |
| Phone screenshots (2-8, plan 6, each AR and EN, 1080x1920+) | Shot list LC §9.2. Blocked by LR-01 (prod backend), LR-05 (review cohort run), second phone for call shot, tab rename "Packages" on build | MISSING ASSET | LC §9 |
| Tablet screenshots | Optional | READY (skip) | LC §9.1 |
| Store listing contact: email / website / phone | `{{SUPPORT_EMAIL}}` / `{{SUPPORT_URL}}` / leave phone empty | ASSET (values) | PD §8 |
| Category / tags | Education (see rec. 2e) ; education tags | OWNER | PD §8, O-8 |
| Store listing sample: screenshots must not show children, Quran text, or the word "Subscriptions" | rule | READY | LC §9.2 |

Console path for category/contact: Play Console > app > Grow > Store presence > Store settings.

### C. Policy and programs > App content (each is a separate task in Dashboard)
| # | Declaration | Value to enter | Status | Source |
|---|---|---|---|---|
| 1 | **Privacy policy** | `{{PRIVACY_POLICY_URL}}` (policy published 2026-11-17 per RN §1 row on deletion; URL itself not in repo docs) | ASSET (URL) | PD §4; LR-04 |
| 2 | **Ads** | "No, my app does not contain ads" | READY | PD §3 |
| 3 | **App access** | "All or some functionality is restricted". Add 3 entries: Parent account `parent@{{REVIEW_DOMAIN}}`; Teacher account `teacher@{{REVIEW_DOMAIN}}`; Deletion test account `parent2@{{REVIEW_DOMAIN}}`; passwords in console only. Paste the "Any other information" text of RN §3 in each entry, with `[PAYMENTS SENTENCE]` replaced by Option C (needs review payment mode live: PR #585 deployed and review cohort re-run, RA "Still open") or, otherwise, Option B. Also enter same logins in Testing > Pre-launch report > Settings > Credentials. Supersedes PD §2. Needs LR-01 + LR-05 done first. | NEEDS OWNER DECISION (payments option, OA-12) + ASSET (accounts exist only after cohort run) | RN §3; RA |
| 4 | **Content rating** (Policy > App content > Content rating) | Email `{{RATING_CONTACT_EMAIL}}`; category "All other app types"; every content question No; interactive: users interact = Yes (moderated: Yes); shares location = No; shares personal info with third parties = No (counsel to confirm); digital purchases = No; ads = No; unrestricted web = No. Expected lowest rating + "Users Interact". Live questionnaire wording may differ. | READY (re-read live wording); "Shares Info" OWNER/counsel | AR §2 |
| 5 | **Target audience and content** | Target age: **18 and over only**. Store listing appeal to children: No. | OWNER (N-1/LD-5; counsel vs Families policy) | PD §1; rec. 2a |
| 6 | **Data safety** | Answers in DS §1-§2 (Yes collected; encrypted in transit Yes; account creation: username+password; deletion yes; delete URL `{{ACCOUNT_DELETION_URL}}`). Types collected: approx location, name, email, user IDs, phone (optional), other info (teacher profile), purchase history, other financial info (bank receipt), other in-app messages, photos, videos, voice recordings, files, app interactions, other UGC, crash logs, diagnostics, device or other IDs. User payment info = No (cards off). None shared. Crash logs/diagnostics purposes: App functionality + Analytics. Open: religious beliefs (counsel O-2), Sentry session tracking (#526 must be in build, else declare), AD_ID merged-manifest check. | NEEDS OWNER DECISION (O-2 counsel) + UNVERIFIED (merged manifest, #526) | DS §1, §2, §6 |
| 7 | **Government apps** | No | READY | PD §4 |
| 8 | **Financial features** | "My app doesn't provide any financial features" | READY | PD §4 |
| 9 | **Health** | No health features | READY | PD §4 |
| 10 | **News apps** | Not a news app | READY | PD §4 |
| 11 | **COVID-19 contact tracing/status** | No | READY | PD §4 |
| 12 | **Advertising ID** | No (no AD_ID in app manifest; CI also fails the build if AD_ID is in the signed bundle) | UNVERIFIED until first signed bundle's evidence row passes (CI §1a) | PD §3; CI line 197 |
| 13 | **Families / Child Safety Standards** | Families: not applicable at 18+. Child Safety Standards: see rec. 2c. Prepared answer if asked: standards `{{CHILD_SAFETY_POLICY_URL}}`, in-app report (PD-57), contact `{{SAFEGUARDING_EMAIL}}` | OWNER (O-4), URL/mailbox ASSET | PD §4, §10 |
| 14 | **Foreground service permissions** | Type Microphone; task/use case "Voice calling"; description, impact text and video link per PD §5; video plan in section 4 below | MISSING ASSET (video `{{FGS_VIDEO_URL}}`) | PD §5 |
| 15 | **Full-screen intent** | "Yes, core functionality: calling"; description text in PD §6. Update PD §6: #524 is merged (see sect. 5). | READY text; OWNER (rec. 2f) | PD §6 |

Console path for all of C: Play Console > app > Policy and programs > App content (older UI: Dashboard > "Set up your app"). Foreground service and full-screen intent appear on that page only for apps whose bundle declares them; if they do not appear, upload the bundle first (UNVERIFIED which order the UI forces; the declarations need an uploaded bundle that declares the permissions).

### D. Countries / regions (Production > Countries/regions; can be set before release)
Recommended first release: academy markets (GCC and other Arab countries); not the US until age assurance; EU only with verified trader details. Status OWNER (LD-15/LR-17). Source: PD §9.

### E. Internal testing release (Testing > Internal testing)
| Step | Value | Status | Source |
|---|---|---|---|
| Testers list | Create email list (owner + QA); required before rollout | OWNER (emails) | - |
| First bundle | Google may refuse API upload of the very first bundle (CI says UNVERIFIED, "no official Google statement found"). Use CI mode `android_delivery=first-bundle-artifact`, `platform=android`, build_name 1.0.0, build_number 3, owner approves `store-release`, decrypt with age key, check SHA-256 equals run summary, upload in Testing > Internal testing > Create new release. Play App Signing records upload key. Needs `STORE_ARTIFACT_AGE_RECIPIENT` variable. | READY procedure; UNVERIFIED that prior runs completed | CI §3.3a |
| Release name | `1.0.0 (3)` (the CI helper uses `"<build_name> (<build_number>)"`) | READY | CI line 76-77 |
| Release notes | AR: الإصدار الأول من جَوِّد. EN: The first release of Jawwid. | READY | LC §7 |
| Later builds | `android_delivery=play`, higher build_number, lands as a draft on internal track; release it via Internal testing > the draft > review and release | READY | CI §3.3 |
| App signing | Accept Play App Signing | READY | CI §3.3a |
| Service account for API | Invite service account; App permissions: only "Release apps to testing tracks" (UNVERIFIED sufficient) | UNVERIFIED | CI §3.3 |

Policy forms in section C should be complete before promotion beyond internal testing; internal testing itself does not need the 12 testers (see section 3).

---

## 2. Recommendations

Official pages read via WebFetch/WebSearch on 2026-11-18. Anything not read is labelled UNVERIFIED. Repo docs state they could not read Google pages when drafted (PD header), so these are newer reads.

**a. Target audience: 18 and over only (recommend).**
- Evidence: only adults hold accounts (parents, teachers, staff) per `lib/shared/models/user_role.dart:9-21` (cited in PD §1); children use a parent's signed-in phone.
- Google (https://support.google.com/googleplay/android-developer/answer/9867159, read 2026-11-18): age groups are 5 and under, 6-8, 9-12, 13-15, 16-17, 18+; the Families Policy applies to any app with at least one target age group that includes children; select several groups only if genuinely suitable.
- So choosing 18+ keeps the app out of Families (no ad-SDK/neutral age-screen duties; the DS Families question is not asked). Keep listing adult-oriented (LC rules). Risk: Google can still treat content that appeals to children as child-directed; the listing must avoid child imagery. Counsel should confirm (PD §1; L-15 SDK terms only matter if a child group is chosen). The decision is the owner's (N-1/LD-5).

**b. Storefronts.** Start with the academy's markets (GCC, Arab countries), exclude the US until age-assurance work exists (PD §9; AR §1.1). Google Play Age Signals/US state-law statement in PD §9 is UNVERIFIED (not re-read). Can be widened later without a new build.

**c. Child Safety Standards.**
- Google (https://support.google.com/googleplay/android-developer/answer/14747720, read 2026-11-18): in scope are anonymous chat apps, random chat apps, and apps that declare Social or Dating category. The page did not say where in the console the form is; the search summary also said child presence in the app is irrelevant to scope (secondary source, UNVERIFIED on the page itself).
- Jawwid is not anonymous or random chat (identified, academy-assigned participants; RN §1) and, with Education, not Social/Dating. So the declaration should not apply. If the owner chose Communication or Social, that must still be re-checked: Communication is not named in the scope sentence I read, but confirm in the console. Prepare the fallback answer anyway (PD §4: published standards `docs/legal/child-safety-policy-*.md`, in-app reporting, contact), because the app has user content and messaging. Status OWNER (O-4).

**d. Payment wording.**
- No card payments at launch (DS §4: cards paused, no Stripe keys, `LAUNCH_PHASE=review`). Bank transfer remains (DS §2 Other financial info).
- Google 1:1 rule (PAY §1, read by the repo authors 2026-11-05 from https://support.google.com/googleplay/android-developer/answer/9858738; I did not re-read it, so UNVERIFIED today): Play Billing not required when the paid service is between two individuals and not replayable. Lessons are not recorded (PAY §2; RN §1 cites `call.service.ts:29`).
- Wording rules: say "lesson package", never "subscription" (LC rules); sell only live one-to-one lessons; avoid steering language.
- Action: because cards are off, the Play listing and App-access text must not promise card payment. Remove the card phrase in LC §5 (both languages) and in RN §3 Option C/A ("paid by card on Stripe's page") — use bank-transfer-only wording. Option C also states the reviewer sees a demo; make sure that matches what the build does once cards are off. Choosing Option B ("review family has nothing to pay") would contradict RA/OA-12 (demo amount due), so prefer Option C (the owner's decision per RN) with the card words removed. OWNER to approve final text.

**e. Category: Education (recommend).**
- Reasons: PD §8 and LC §8 choose Education; it matches the 1:1 tutoring exemption framing (education classes example, PAY §1); keeps the app out of Social/Dating Child Safety scope (rec. c); fits the "Reference/Educational" IARC type (AR §2.1).
- Counter-argument: Communication would match the FSI "core functionality: calling" claim more naturally. I found no Google statement that category determines FSI eligibility (UNVERIFIED), so it should not drive the choice. If Google questions the FSI declaration, the answer is that live lessons are voice calls.

**f. Full-screen-intent declaration eligibility.**
- Google (https://support.google.com/googleplay/android-developer/answer/13392821, read 2026-11-18): from 2025-01-22, for apps targeting Android 14+, only apps with calling or alarm functionality have USE_FULL_SCREEN_INTENT enabled by default; others must ask the user; eligible apps declare "core functionality" in App content. Core = without it the app is broken.
- Evidence for the app: incoming calls and live lessons are central (PD §6); `JawwidPush.kt:180` `canUseFullScreenIntent`, heads-up fallback when denied (PD §6). Manifest line 23 declares the permission with the comment that the ring degrades to heads-up with Answer/Decline.
- Honest weak point: the app is primarily an academy messaging/lesson app; whether Google treats calling as "core" is Google's call. Declare Yes (calls are how lessons run) and keep the fallback; if refused, nothing breaks (PD §6 notes). Do not state the app offers the system settings screen: `openFullScreenIntentSettings` is defined (`lib/core/call_native/call_presentation.dart:225`) but no screen calls it (grep on origin/main). Status OWNER (accept risk; recommend Yes).

---

## 3. Personal or organization developer account, and the 12-tester rule

**What the owner must look at (I cannot see the Play Console):** Play Console > Settings (left bottom) > Developer account > Account details. Check "Account type" (Personal or Organization) and, for Organization, the organization name and D-U-N-S number; also note the account creation date (Developer account > Account details, or the Google payments profile). Per Google help (https://support.google.com/googleplay/android-developer/answer/13634885, seen only as a search result, not fully read: UNVERIFIED), organization accounts require a D-U-N-S number and personal accounts do not; and the account type cannot be changed on an existing payments profile (search result summary, UNVERIFIED).

**Consequence (read 2026-11-18 at https://support.google.com/googleplay/android-developer/answer/14151465):** the closed-testing requirement applies to personal developer accounts created after 2023-11-13: at least 12 testers opted in continuously for at least 14 days must exist when applying for production access. The page did not say how to tell the account types apart and did not itself state that organization accounts are exempt; I infer exemption from its "personal developer accounts" wording only (partly UNVERIFIED).
- Personal and created after 2023-11-13: you need a closed test with 12 opted-in testers for 14 consecutive days (tester who opts out and in must restart the 14 days). Internal testing does not count (UNVERIFIED; the page spoke about closed testing). Plan: create a closed testing track, recruit 12+ testers by email list or Google Group, keep them opted in, then apply for production access. Expect Chat to be reachable by testers only after the account's other verification (UNVERIFIED).
- Organization account, or personal created before the date: the requirement should not apply; verify the live Dashboard "Production access" task in the console, which states what is required.
- Internal testing (the first release in this plan) is not gated by the 12-tester rule (UNVERIFIED).

---

## 4. Foreground-service declaration video plan

Requirements: PD §5 (one take, 30-90 s, Android 14+ phone, release build, no real person/child, use review accounts). Google (answer 13392821, read 2026-11-18): link a video showing each foreground-service feature and the steps the user takes in the app to trigger it; one service type declared here: microphone (`CallForegroundService`, manifest line 73-76; code `CallForegroundService.kt:54,67`).

Length: 60-90 s (stay within PD's 30-90 s). Host as unlisted YouTube or a shared link anyone can open; no login wall.

Shot list:
1. (0-8 s) Settings/About or app icon showing it is the release build (version 1.0.0 (3)); signed in as review parent (`parent@...`); text overlay "Jawwid, microphone foreground service".
2. (8-18 s) Open the family group chat; tap the phone icon in the chat header (`chat_screen.dart:1686-1694`, RN §1). Show the tap.
3. (18-30 s) Second phone (teacher account) rings and answers; show the call connecting on the parent's phone (call screen).
4. (30-45 s) Press Home (or lock). Pull down the status bar: the ongoing "call in progress" notification with a Hang up button is visible; show the microphone indicator (Android 12+ privacy dot) if possible.
5. (45-60 s) Speak; show the teacher's phone hearing it (second recording or split screen).
6. (60-75 s) Tap Hang up in the notification (served by `CallActionReceiver`); show the notification disappears and the call ends on both phones.
7. Optional (75-90 s): incoming call to a closed app, answer, show same notification (only if the declaration mentions incoming calls; PD §5 text says start or answer).
Do not show: real names, children, real credentials/passwords, production data.

Minimum access to record: review parent and teacher accounts (needs LR-01 production backend and LR-05 cohort run), two Android 14+ devices (or one device plus an emulator/second phone), a release build or the internal-testing build, screen recording (adb or built-in), notification/microphone permission granted. Not a debug build. Not verified on a device per RN §1 ("Not verified on a device").

---

## 5. Discrepancies between docs and manifest/pubspec

1. **Version.** `pubspec.yaml:4` is `version: 0.1.0+1`; the task says release 1.0.0 code 3. `build.gradle.kts:70-71` reads `flutter.versionCode`/`versionName` from pubspec, and the CI workflow takes `build_name` / `build_number` inputs (CI lines 28-29, 195). Whether `build-store.sh` overrides pubspec with those inputs is UNVERIFIED (script not read); the CI row LR-50 would fail if package/version/code do not match.
2. **PD §6 is stale.** It says "TRUE ONLY AFTER #524 MERGES" and "on `main` the app never asks". On origin/main `JawwidPush.kt:180`, `MainActivity.kt:186`, `RingCheck.kt` already contain the Android 14 check, and git log shows #524 merged (fb74cd65). Its line numbers (`#524 JawwidPush.kt:180-188`) now apply to main. Still no caller of `openFullScreenIntentSettings` (only the definition at `call_presentation.dart:225`).
3. **Card payments.** LC §5.1/§5.2 and RN §3 Options A/C and PAY §5 describe paying by card; DS §4 says cards are off at launch. LC §10 and RN rely on LR-34. Pick bank-transfer-only wording for launch.
4. **PAY §5 navigation** says "Settings -> Payments -> Amount due -> Pay"; RN §1 and `app_en.arb:1749` use the "Packages" tab. RA "Still open" lists other docs still describing a stored payable item (PD §2, PAY §4-6, LC shot 5, RN §2.1 Option A) that conflict with OA-12 demo mode.
5. **PD §2 superseded** by RN §3 (two vs three accounts); do not paste PD §2.
6. **Name.** LC §1 proposes "Jawwid: Quran Academy"; `strings.xml` app_name is "Jawwid". Docs already flag it as owner decision, but verify store name vs installed label.
7. **pubspec description** says "Quran and Arabic academy" (`pubspec.yaml:2`); copy says Quran only (LC §5.3 open question).
8. **Manifest vs PD §7.** Permissions match lines 6, 9, 13, 17, 23, 28, 29. Merged-manifest additions (WAKE_LOCK, c2dm RECEIVE, ACCESS_NETWORK_STATE) UNVERIFIED until the signed AAB is dumped (PD O-5/O-6). The manifest also declares `.JawwidMessagingService` and `.CallActionReceiver` (lines 65-80) not discussed in the permission table (no permission impact).
9. **PD §7 note** that `main` still asks POST_NOTIFICATIONS right after sign-in (LR-11): I did not check; UNVERIFIED whether still true.
10. **Google help pages.** PD/DS/LC state Google pages were unreadable; I read answers 9867159, 13392821, 14151465, 14747720 on 2026-11-18, but DS's Data safety page (10787469) and 9858738 (1:1 payments rule) were not re-read: UNVERIFIED.
11. Targets: CI expects target SDK 36 / min 26 (CI line 195); `build.gradle.kts:64` min 26 matches; target = `flutter.targetSdkVersion` (value UNVERIFIED until CI evidence).

---

## 6. Owner decisions needed
1. Target audience 18+ (N-1/LD-5; counsel on Families).
2. Category Education vs Communication.
3. Storefront countries (LD-15/LR-17).
4. Child Safety Standards: confirm not applicable or file the prepared answer; supply safeguarding mailbox and policy URL (O-4/LD-19).
5. Payments wording at launch (remove card text; App-access payments option C vs B, OA-12; run review cohort after #585).
6. Religious-beliefs data-safety label (counsel, O-2); confirm #526 in build.
7. Store name; icon, feature graphic, screenshots; support/privacy/terms/deletion URLs.
8. Full-screen-intent declaration Yes.
9. Check developer account type/creation date (Settings > Developer account > Account details) and, if personal and new, recruit 12 closed testers for 14 days.
10. Approve the first-bundle run and set `STORE_ARTIFACT_AGE_RECIPIENT`.
11. Foreground-service video (needs two devices and review accounts).
