# Store submission pack: Jawwid Chat (iOS and Android)

**Written 2026-11-17 from `origin/main` @ `4aa6c5ec`.** Docs only. It assembles the answers that already exist in
this folder and in `docs/release/` into one order of work. It enters nothing in a console and invents no fact.
Open PRs were read with `gh pr view` and not changed: #549, #555, #556, #558, #574, #591, #595.

**Marks.** **CONFIRMED** = stated in the cited file or URL (read 2026-11-17). **UNVERIFIED** = not proven here.
`OWNER DECISION` = options plus a recommendation. No credential appears here: review logins are typed only into the
consoles (`docs/release/review-accounts.md`, "Run it" step 3).

**Read this first: card payments are PAUSED and must not be advertised.** The pause wins everywhere, App Review mode
included (`docs/release/stripe-launch-runbook.md:26-28`, CONFIRMED; #609 seeds `billing.card_paused = true`, commit
`09720bc1` on `main`, CONFIRMED by `git log`). Three drafts still mention cards and must be changed before pasting:
1. `listing-copy.md` §5.1/§5.2 "Payments" line: drop "by card on Stripe's secure page" (the file says so itself, §5.3 row "Card on Stripe's page").
   Use **"Pay for a lesson package by bank transfer, with the transfer receipt uploaded in the app."**
2. `review-notes.md` §2.1 Option C and §3 `[PAYMENTS SENTENCE]` Option C describe a card button that opens a demo
   Stripe page. While the pause is on, **that is false**. Use Option C with the card clauses removed (text in A.7).
3. Store "Payments"/"Data safety" answers: payment info stays "No" (`apple-app-privacy.md` §7 O-1; `google-data-safety.md` §6 O-1, both CONFIRMED "card payments are off"). Re-open before cards go live.

## Facts

| Fact | Value | Mark |
|---|---|---|
| iOS bundle id | `com.jawwid.jawwidChat` | CONFIRMED `store-readiness-2026-11-03.md` §4 |
| Android applicationId | `com.jawwid.jawwid_chat` (permanent after first upload) | CONFIRMED `google-play-readiness-2026-11-03.md` D-1 |
| Apple team | `KX683HAR3Y` (Jawwid LLC, Company) | CONFIRMED `store-readiness-2026-11-03.md` §4 |
| iOS build | 1.0.0 (1) uploaded by CI 2026-11-12; Apple processing **not verified** | UNVERIFIED (owner-stated) |
| Android bundle | none exists yet | owner-stated; no bundle recorded in any doc |
| Legal pages | `https://admin.chat.jawwid.com/legal/{en,ar}/{privacy,terms,support,child-safety,account-deletion}` | CONFIRMED: HTTP 200 on all 10 URLs, `curl`, 2026-11-17; `docs/legal/publication.json` (`publish: true`) |
| Account-deletion **form** | `https://api.chat.jawwid.com/api/v1/account-deletion` (`?lang=en`) | CONFIRMED `docs/release/legal-pages-hosting.md` §3.1 (not curl-tested here: UNVERIFIED live) |
| Support e-mail | `info@jawwid.com` (replaces the support/privacy/safeguarding mailboxes) | CONFIRMED `docs/legal/README.md` "Launch set" |
| Website field | `https://jawwid.com/` | CONFIRMED `legal-pages-hosting.md` §1 |
| Account type (Play) | Organization (A-7) | CONFIRMED `play-closed-testing-contingency.md` §1 (#558) |

Placeholders to substitute everywhere in the older drafts: `{{PRIVACY_POLICY_URL}}` = `.../legal/en/privacy` (Arabic: `/ar/`),
`{{TERMS_URL}}` = `.../terms`, `{{SUPPORT_URL}}` = `.../support`, `{{SUPPORT_EMAIL}}` / `{{SAFEGUARDING_EMAIL}}` /
`{{RATING_CONTACT_EMAIL}}` = `info@jawwid.com` (owner may choose another rating contact: OWNER DECISION, recommend `info@jawwid.com`),
`{{CHILD_SAFETY_POLICY_URL}}` = `.../child-safety`, `{{ACCOUNT_DELETION_URL}}` = `.../account-deletion` (the information page; the API form is the second link).

---

## A. App Store Connect, in order

Account Holder or Admin of team `KX683HAR3Y` does every step. Source of each answer is named; paste from there.

| # | Screen -> field | Value | Mark |
|---|---|---|---|
| A.1 | My Apps -> **+** -> New App | Platform iOS; bundle id `com.jawwid.jawwidChat`; SKU: any (owner picks, e.g. `jawwid-chat-ios`); primary language **Arabic**; name per A.2. If a record already exists (the CI upload needs one, `signed-builds-ci.md` §3.4 step 2) skip, and copy its numeric Apple ID | CONFIRMED sources; whether the record exists: UNVERIFIED |
| A.2 | App Information -> Name | OWNER DECISION: (a) «جَوِّد: أكاديمية القرآن» / "Jawwid: Quran Academy" (drafted, `listing-copy.md` §1) or (b) "Jawwid Chat" (the name under the icon, `ios/Runner/Info.plist:14-15`). Recommend **(a) for the store listing and rename the home-screen name to «جَوِّد» / "Jawwid"** so the two are recognisably the same app (Apple's expectation, `listing-copy.md` §1). Name must be free in ASC (UNVERIFIED) | CONFIRMED drafts; decision open |
| A.3 | App Information -> Subtitle | AR «دروس قرآن فردية مباشرة» / EN "Live one-to-one Quran lessons" | CONFIRMED `listing-copy.md` §2 |
| A.4 | App Information -> Category | Primary **Education**; secondary none | CONFIRMED `listing-copy.md` §8 (secondary: OWNER DECISION, recommend none) |
| A.5 | App Information -> Content Rights | Does your app contain, show or access third-party content? **No** (all content is the academy's or user-posted conversations). UNVERIFIED: the drafts do not answer this question; owner or counsel confirms (Quran audio rights research exists: `docs/legal/quran-audio-rights-research.md`) | UNVERIFIED |
| A.6 | App Information -> Age Rating -> Set Up | Answers in `age-rating.md` §1.1-§1.3 (UGC Yes, Messaging and Chat Yes, Social Media No, Parental Controls No, Age Assurance No, all content None/No). Expected result **4+**. Age Categories and Override: **Not Applicable** (no Kids Category) | CONFIRMED `age-rating.md` §1; "Social Media No" and "no override" are OWNER DECISIONS (recommended) |
| A.7 | Pricing and Availability -> Price | Free. **Storefronts:** OWNER DECISION, recommend the academy's markets (GCC and other Arab countries); **exclude China mainland** (CallKit; `store-readiness-2026-11-03.md` blocker 9) and the US/Texas/Utah/Louisiana until age assurance exists (`age-rating.md` §1.1). EU only with trader details | CONFIRMED rationale; list is a decision (E.2) |
| A.8 | App Privacy -> Get Started | Privacy Policy URL = `.../legal/en/privacy`; optional User Privacy Choices URL = `.../legal/en/account-deletion`. "Collect data?" **Yes**. every "Yes" type in the `apple-app-privacy.md` §2 table (16 types per `README.md`/§5), all linked, **no tracking**. Payment Info **No**; Sensitive Info **No** pending counsel (open O-2). Confirm #526 (Sentry session tracking off) is in the submitted build, else declare it | CONFIRMED `apple-app-privacy.md` §2, §7; counsel item OPEN |
| A.9 | App Review Information -> Sign-In Information | Check "Sign-in required". User name `parent@{{REVIEW_DOMAIN}}`, password: **typed by the owner from the password manager; never written in the repo**. Domain and passwords come from the provisioning run in `review-accounts.md` "Run it". **REQUIRES** the production backend and the provisioning run (UNVERIFIED done) | CONFIRMED structure `review-notes.md` header; execution UNVERIFIED |
| A.10 | App Review Information -> Contact | First/last name, phone: owner's own. E-mail `info@jawwid.com` | owner input |
| A.11 | App Review Information -> Notes | Paste the block between `<!-- APPLE-NOTES-START -->` and `<!-- APPLE-NOTES-END -->` in `review-notes.md` §2, replacing `[PAYMENTS PARAGRAPH]` with the **card-free Option C** below, and `{{REVIEW_DOMAIN}}` / the two passwords with the real values. Plain ASCII, limit 4000 **bytes**: re-count after filling in (3541 with the old Option C, 459 spare; the card-free text is shorter). Add one line from `app-review-notes-account-deletion.md` §2 only if bytes remain (the §2 block already covers deletion) | CONFIRMED sources; byte count after edit UNVERIFIED |
| A.12 | Screenshots | Section C. iPhone slot: **1 to 10**; see the size warning in C.2 | see C |
| A.13 | Version page -> Promotional text (AR/EN) | `listing-copy.md` §4, with the "message or voice call" text (contains no card claim) | CONFIRMED |
| A.14 | Version page -> Description (AR/EN) | `listing-copy.md` §5.1/§5.2 **with the card sentence replaced** (top of this file). Replace the three URL lines with the real URLs | CONFIRMED text; edit required |
| A.15 | Version page -> Keywords | AR `تحفيظ,تلاوة,تجويد,معلم,معلمة,دروس,حفظ,مراجعة,تعليم`; EN `lessons,teacher,tutor,memorization,hifz,recitation,tajweed,islamic,live,one-to-one,family,parents`. Remove "tajweed"/«تجويد» unless tajweed is taught (OWNER DECISION, `listing-copy.md` §6) | CONFIRMED |
| A.16 | Version page -> What's New; Support URL; Marketing URL | AR «الإصدار الأول من جَوِّد.» / EN "The first release of Jawwid." Support URL `.../legal/en/support`; Marketing URL `https://jawwid.com/` (optional) | CONFIRMED |
| A.17 | Version page -> Build | Select **1.0.0 (1)** once it shows (App Store Connect -> TestFlight shows it after Apple processing). If it is absent or "Processing", wait; if "Invalid", re-run `Release store builds` for ios with a higher build number (`signed-builds-ci.md` §4). Check the build is from a commit that contains #526, #524-era fixes and the "Packages" rename (LR-15) | build status UNVERIFIED |
| A.18 | App Information / version -> Export compliance | "Does your app use encryption?" The build declares `ITSAppUsesNonExemptEncryption = false` (CONFIRMED `store-readiness-2026-11-03.md` §6; CI checks it, `signed-builds-ci.md` §1a LR-52 table) so ASC should not prompt. If it does: answer **No** to non-exempt encryption (uses only HTTPS/standard OS encryption). Owner confirms the legal statement | CONFIRMED setting; answer wording UNVERIFIED |
| A.19 | Version page -> App Store Version Release | Select **"Manually release this version"** (`signed-builds-ci.md` §3.4 step 3) | CONFIRMED |
| A.20 | Version page -> Advertising Identifier / Content rights | No IDFA (no ads SDK; `apple-app-privacy.md` header). Content rights see A.5 | CONFIRMED |
| A.21 | **Submit for Review** | Only after A.1-A.20, section D prerequisites and the checks in `review-notes.md` §4 (calls on two phones, CallKit only if `APNS_VOIP_ENABLED=true` in production, deletion account works) | CONFIRMED list |

**Card-free payments paragraph (use in A.11 and, shortened, in B.10).** Derived from Option C (`review-notes.md` §2.1) with
the card clauses removed because cards are paused; wording is mine, facts are Option C's, so UNVERIFIED until the owner reads it:

```text
PAYMENTS: the academy sells only live one-to-one Quran lessons (one teacher, one student, real time, not recorded); no digital content or app features are sold. Under Guideline 3.1.3(d), parents pay a lesson package by bank transfer with a receipt upload. For this review account our server disables payment: Packages tab > Amount due shows a demo lesson package > Pay. Bank transfer shows demo bank details and cannot send a receipt. No charge is possible.
```

Dependency: this text is true only if the review payment mode is switched on for the review organization
(`review-accounts.md` "Still open", UNVERIFIED done). If it is not, use Option B (`review-notes.md` §2.1: "nothing to pay"). Also confirm in
the build that the pause does not hide the Pay entry for review accounts (UNVERIFIED; the runbook says the pause wins over App Review mode, so
the demo Pay path may show only bank transfer: re-check `review-accounts.md` against `card-pause.ts` before pasting).

**Other Apple items.** `remote-notification` in `UIBackgroundModes` has no use; recommendation is to remove it (`ios-background-modes.md`);
CI checks the signed IPA lists exactly `audio` and `voip` (`signed-builds-ci.md` §1a), so UNVERIFIED whether 1.0.0 (1) still carries it: if the
build already passes the CI check, it does not. Teacher deletion, LR-15 and Notes byte count are the Apple-rejection items in `review-notes.md` §4.

---

## B. Google Play Console, in order

Account owner or an Admin with all permissions does every step. Console labels are UNVERIFIED (Google help pages vary); match them on the day.

| # | Screen -> field | Value | Mark |
|---|---|---|---|
| B.1 | All apps -> Create app | Name per A.2 decision; default language Arabic; App; Free; accept declarations. Package becomes `com.jawwid.jawwid_chat` on first upload | CONFIRMED package; labels UNVERIFIED |
| B.2 | Setup -> **Play App Signing** | Accept Google-managed app signing; Google holds the app signing key, we hold only the upload key (`android-upload-key.md` header) | CONFIRMED |
| B.3 | Prerequisite: upload key | The owner makes it once with `scripts/mobile/make-upload-key.sh` in a dedicated macOS user and fills the `store-release` secrets (`android-upload-key.md` §1-§3). Not an agent task | CONFIRMED |
| B.4 | **First manual upload** of the first `.aab` | Google refuses API uploads for a never-uploaded app (UNVERIFIED by Google; `signed-builds-ci.md` §3.3a on #595). Steps: jawwid-bot runs **Release store builds** with `platform=android`, `android_delivery=first-bundle-artifact`; owner approves `store-release`; owner downloads artifact `jawwid-android-first-bundle` (kept 1 day), unzips, optionally checks SHA-256 against the run summary; uploads it in Play Console -> Testing -> **Internal testing** -> Create new release; tells the lead to delete the artifact. **#595 is OPEN (not on `main`)**: it needs owner approval and a Code Owner merge first | CONFIRMED procedure in #595; #595 unmerged |
| B.5 | Play service account | Invite the service account with only "Release apps to testing tracks" for `com.jawwid.jawwid_chat` (`signed-builds-ci.md` §3.3) so later builds go by API (`android_delivery=play`, higher build number). Needs the app to exist first | CONFIRMED; sufficiency UNVERIFIED |
| B.6 | Grow -> Store presence -> **Main store listing** | Title (30), short description (80), full description (4000) from `listing-copy.md` §1, §3, §5 (**card sentence removed**); AR default, EN second. Contact e-mail `info@jawwid.com`; website `https://jawwid.com/`. Category **Education** (OWNER DECISION, `play-declarations.md` §8; alternative Communication) | CONFIRMED |
| B.7 | **Graphics** | App icon 512x512 PNG (`assets/brand/play-store-icon-512.png` exists in the repo, CONFIRMED by `git ls-files`; the owner must confirm it is final: LR-36 vector logo open), feature graphic 1024x500 (**does not exist**), 2 to 8 phone screenshots (section C) | see C |
| B.8 | Policy -> App content -> **Privacy policy** | `.../legal/en/privacy` | CONFIRMED |
| B.9 | App content -> **Data safety** | Answers in `google-data-safety.md` §1-§4. Encrypted in transit **Yes**; deletion request **Yes**; delete URL = `.../legal/en/account-deletion`; no data shared (service providers are not "sharing"); no Advertising ID. Payment info **not collected** while cards are off. Religious beliefs **No** pending counsel (open O-2). Confirm #526 in the build | CONFIRMED; counsel item OPEN |
| B.10 | App content -> **App access** | "All or some functionality restricted". Three entries from `review-notes.md` §3 (Parent, Teacher, Deletion test), logins typed only here, and the same logins in Testing -> Pre-launch report -> Settings -> Credentials. Use the card-free sentence (A.7 text, shortened) for `[PAYMENTS SENTENCE]`; replace `{{ACCOUNT_DELETION_URL}}` | CONFIRMED structure |
| B.11 | App content -> **Ads** | No. Advertising ID: **No** (check the merged manifest of the signed `.aab`: CI already checks no `AD_ID`, `signed-builds-ci.md` §1a) | CONFIRMED |
| B.12 | App content -> **Content rating (IARC)** | E-mail `info@jawwid.com` (owner may choose another); category "All Other App Types"; all content No; interaction: users interact Yes, moderated Yes, shares location No, shares personal info No (counsel confirms), digital purchases No, ads No. Expected: lowest ratings plus "Users Interact" (`age-rating.md` §2) | CONFIRMED draft; questionnaire wording UNVERIFIED |
| B.13 | App content -> **Target audience and content** | **18 and over only**; listing does not appeal to children (no child imagery). OWNER DECISION N-1 (recommend 18+). Counsel confirms against Families policy | `play-declarations.md` §1 CONFIRMED; decision OPEN |
| B.14 | App content -> News apps / Government / COVID-19 / Health / Financial features | No / No / No / "no health features" / "no financial features" (merchant taking payment for its own lessons) | CONFIRMED `play-declarations.md` §4 |
| B.15 | App content -> **Child Safety Standards** (if asked) | Draft: "not required for this category"; if the console asks, give the published standards `.../legal/en/child-safety`, in-app reporting, contact `info@jawwid.com` | CONFIRMED `play-declarations.md` §4, O-4 OPEN |
| B.16 | App content -> **Foreground service permissions** | Type **Microphone** only. Use the feature, impact and description text in `play-declarations.md` §5. **A video is required.** Record 30-90 s on an Android 14+ phone, release build, review accounts: sign in; start or answer a call; hear the other phone; press Home or lock; the ongoing call notification visible; speak, still heard; tap Hang up, notification disappears. No real person or child. Upload unlisted (YouTube or shared link) and paste the link. The recorded build must have `foregroundServiceType="microphone"` only (LR-14, #505 on `main`) | CONFIRMED text; video does not exist |
| B.17 | App content -> **Full-screen intent** | Core function Yes: calling. Use the description in `play-declarations.md` §6. That text is **true only if #524 is in the submitted `.aab`** (UNVERIFIED: `main` @ `4aa6c5ec` contains #524? not checked here; check with `git merge-base --is-ancestor`). Do not claim the app offers the system setting | CONFIRMED text; build condition UNVERIFIED |
| B.18 | Grow -> Store settings; Production -> Countries | Tags education only; **Countries** OWNER DECISION E.2 | decision open |
| B.19 | Account deletion URL (Data safety / App content) | `.../legal/en/account-deletion`; in-app path Settings -> Delete account | CONFIRMED (page 200) |
| B.20 | **Closed-testing requirement check (#558)** | After B.4, on the day of the first upload read Dashboard, Release -> Production and Closed testing. If a "12 testers for 14 days" task appears, start the plan in #558 the same day (e-mail list of 16 to 20, promote the same `.aab`, about 3 weeks, iOS unaffected). If absent after an `.aab` exists, record "OT-4b: requirement absent" and continue. The Organization account is normally exempt but its absence is not proven | UNKNOWN until first upload (CONFIRMED in #558) |
| B.21 | Testing -> Pre-launch report | Read crashes and whether the robot gets past sign-in with the credentials | `google-play-readiness-2026-11-03.md` §6 CONFIRMED |
| B.22 | **Production release** | Production -> Create new release -> promote the tested `.aab`, **staged rollout** (e.g. 10%), watch Sentry and Play vitals. Every Policy -> App content task must be green first; `versionCode` must rise each upload (`google-play-readiness-2026-11-03.md` §6 steps 6-7) | CONFIRMED |

---

## C. Screenshots

**Verdict: no store screenshots exist; the machine that makes them is PR #549 and it is not merged. Nothing was generated here.**

### C.1 What exists (CONFIRMED by `git ls-files` on `origin/main` 2026-11-17 and `gh pr view 549`)
- Generated images: **none** (no `build/store_screenshots`, no screenshot PNG/JPG in git).
- In the repo: `assets/brand/play-store-icon-512.png` (Play icon candidate). No feature graphic, no Apple 1024 icon other than the build's (LR-36: it is an upscale, `listing-copy.md` §9.1).
- `integration_test/`, `scripts/store-screenshots/` and `docs/release/store-screenshots.md` exist **only on PR #549** (branch `claude/lr09j-store-screenshots`, OPEN).
- #549 makes 10 shots per language per platform (20 per platform): chats, family group (parent), calls, schedule (parent), settings, delete account, live call, teacher chats, family group (teacher), teacher schedule. Fictional people only, initials avatars, no Quran text, no prices. Pay sheet (listing shot 5) and lesson report (shot 7) are **not** taken.

### C.2 Sizes required today (verified 2026-11-17)
| Store | Requirement | Source |
|---|---|---|
| Apple iPhone | **Mandatory: "iPhone with Dynamic Island (medium display)"**, 1 to 10 shots, **1179x2556 or 1206x2622** portrait; .jpeg/.jpg/.png, **no alpha**. "Large display" (1290x2796, 1320x2868, 1260x2736) is optional; Face ID (large) needed only if no Dynamic Island large set is given. iPad not required (app is iPhone only: `ios/Runner.xcodeproj/project.pbxproj` `TARGETED_DEVICE_FAMILY = 1`, per `listing-copy.md` §9.1) | <https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/>, fetched 2026-11-17 |
| Google Play phone | JPEG or 24-bit PNG, no alpha; each side 320 to 3840 px; long side at most 2x short side; 2 to 8 per device type (at least 2 to publish); **recommended** 4+ at 9:16, 1080x1920 or larger, for promotion eligibility | <https://support.google.com/googleplay/android-developer/answer/9866151>, fetched 2026-11-17 (the page fetch returned a summary, so exact wording UNVERIFIED) |
| Play icon / feature graphic | 512x512 32-bit PNG (max 1024 KB); feature graphic **1024x500**, JPEG or 24-bit PNG, no alpha | same page, 2026-11-17 |
| Play tablets | 4+ only for Chromebook/tablet-ready; optional | same |

**Discrepancy to fix:** #549 and `listing-copy.md` target **1320x2868** (large display, now *optional*), while Apple's page lists the **medium** display
(1179x2556 / 1206x2622) as the only mandatory iPhone set. Whether App Store Connect accepts large shots for the medium slot is UNVERIFIED (the page says an
omitted *optional* size is scaled from a larger one, not that large satisfies medium). #549's own doc raised this doubt (§3). **Recommendation: also capture
at 1206x2622** with `IOS_DEVICE_TYPE` set to an iPhone 17 Pro simulator, `IOS_EXPECT_WIDTH=1206 IOS_EXPECT_HEIGHT=2622`; upload that set to the required slot.

### C.3 What is missing
1. Merge of #549 (needs owner/Code Owner: it adds Flutter test code and `pubspec.lock` edits).
2. The medium-display iOS set (above) and all Android shots: never produced.
3. Play feature graphic 1024x500 and a final vector logo (LR-36).
4. The "Packages" rename (LR-15, owner approval row 6 in `README.md`): 4 shots show the old "Subscriptions" tab until then.
5. Native-speaker read of the Arabic shots; the owner's checklist is `store-screenshots.md` §5 on #549.

### C.4 Command (after #549 is merged and on a machine that may run a simulator or emulator; not on the shared dev Mac)
```bash
bash scripts/store-screenshots/capture.sh ios        # add IOS_DEVICE_TYPE / IOS_EXPECT_WIDTH / IOS_EXPECT_HEIGHT for the 1206x2622 set
bash scripts/store-screenshots/capture.sh android    # needs ANDROID_HOME, emulator, system image android-35
```
Output: `build/store_screenshots/<UTC timestamp>/{ios,android}/{ar,en}/*.png`, plus `upload/` JPEG copies with no alpha. Upload the `upload/` JPEGs. All of this is CONFIRMED from #549's doc; the run itself has never been executed here (UNVERIFIED works).

---

## D. Owner-only actions

| # | Action | Exact screen |
|---|---|---|
| D.1 | Accept any pending Apple agreements (Paid Apps agreement is **not** needed while the app is free and takes no in-app purchase; confirm) | App Store Connect -> Business (or Agreements, Tax, and Banking) |
| D.2 | Confirm identity and App Review contact details | App Store Connect -> the app -> App Review Information |
| D.3 | Create/confirm the app record and read its numeric Apple ID into the `ASC_APP_APPLE_ID` variable | My Apps; the app -> App Information -> Apple ID; GitHub -> Settings -> Environments -> `store-release` |
| D.4 | Create the Apple distribution signing access if CI export needs it (an App Manager key may not be enough: UNVERIFIED) | App Store Connect -> Users and Access -> Integrations -> Team Keys |
| D.5 | Type the review logins (never in the repo) | ASC -> App Review Information; Play -> App content -> App access and Pre-launch report -> Credentials |
| D.6 | Make the Android upload key and fill the `store-release` secrets | `android-upload-key.md` §1-§3; GitHub -> Settings -> Environments |
| D.7 | Approve the `store-release` deployment for each run; approve #595 merge (Code Owner) and the first-bundle run | GitHub -> Actions -> the run -> Review deployments |
| D.8 | Do the first manual `.aab` upload | Play Console -> Testing -> Internal testing -> Create new release |
| D.9 | Accept the Play Developer Distribution Agreement and complete organisation verification (D-U-N-S) if not yet done | Play Console -> Account details / Setup (UNVERIFIED state) |
| D.10 | Record the foreground-service video on an Android 14+ phone | Play Console -> App content -> Foreground service permissions |
| D.11 | Read and confirm the console answers: age rating, IARC, Data safety, content rights, export compliance | each console form |
| D.12 | Choose "Manually release this version"; press **Submit for Review** (Apple) and **Send for review / Roll out** (Play) | version page; Publishing overview |
| D.13 | Counsel answers (religious-beliefs data, Stripe role, IARC "Shares Info", Families policy) or owner decides to declare | `README.md` "Owner must confirm" rows 11-13 |
| D.14 | Production backend, review-cohort provisioning and review payment mode must be live before any review (infrastructure, owner approval) | `review-accounts.md` "Run it" and "Still open" |

---

## E. Open decisions with recommendations

| # | Decision | Options | Recommendation |
|---|---|---|---|
| E.1 | Store name consistency | "Jawwid Chat" (iOS display name, `Info.plist:14-15`), «جَوِّد»/"Jawwid" (Android label, `strings.xml`), "Jawwid: Quran Academy" (drafted store name) | Store name «جَوِّد: أكاديمية القرآن» / "Jawwid: Quran Academy" on both stores; set the home-screen label to «جَوِّد» / "Jawwid" on both platforms (a small Mobile ticket) so the three share "Jawwid". Keep "Chat" out of store text |
| E.2 | Storefronts | all; academy markets; academy markets minus listed jurisdictions | Arab academy markets first; exclude China mainland (CallKit) and US until age assurance; EU only with trader details (LD-15/LR-17) |
| E.3 | OA-12 payments review path | Option A payable request; B nothing to pay; C review payment mode | **C with card clauses removed** (A.11) once the review payment mode is on; until then **B**. Re-check when cards go live |
| E.4 | Fourth review account for the Sales role | add a Sales-department `admin` in the review org, or state openly that none exists | Submit with the open statement (already in the Notes); add the fourth account only if App Review asks (`review-notes.md` §1 "Open") |
| E.5 | Target audience | 18+, or mixed | **18+** (N-1/LD-5) |
| E.6 | Category | Education, or Communication | **Education** |
| E.7 | Apple "Social Media" and rating override | Yes/No; none or 13+ | **No**; no override |
| E.8 | Tajweed/Arabic as courses | include or not | Quran only in copy; drop «تجويد» keyword unless taught |
| E.9 | `remote-notification` background mode | keep or remove | Remove (no use; Guideline 2.5.4) |
| E.10 | Card payments in listing, notes and Data safety | advertise or not | **Not while paused**; update the three drafts at the top of this file; re-open Data safety / App Privacy payment answers before cards launch |

---

## Dependencies still open (CONFIRMED from the PRs; none merged)
#549 screenshots machine; #555 LR-71 pre-audit (lists FSI text true only after #524, `remote-notification` after #531, Sentry after #526);
#556 payments review-notes path fix (stale tab wording); #558 closed-testing plan; #574 first-deploy order (#497 after Deploy 1; production still lacks
`STORAGE_ENDPOINT` and `STORAGE_REGION`, first-deploy item, state may have changed); #591 console and legal text refresh ("merge last"; many of the dated
facts in `review-notes.md` change when it merges, so re-count the Notes bytes after it); #595 first-bundle mode. `store-readiness-2026-11-03.md` and
`google-play-readiness-2026-11-03.md` are dated; their NO-GO verdicts predate later work and are **stale** (UNVERIFIED current state).
