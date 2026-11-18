# Play policy verification: consolidated result (2026-11-18)

> **Update 2026-11-18, confirmed owner decisions (these supersede earlier drafts in this folder):**
> 1. **Target audience:** children, parents and teachers. 2. **Price:** free to download. 3. **Distribution:** worldwide, in every country where Google Play distribution is available and legally permitted. 4. **App name:** Jawwid. 5. **Category:** Education stays *proposed*, pending final confirmation.
> Earlier text that says "18 and over only", "Families not applicable" or lists a country shortlist is **superseded** and kept only for history. Status labels used below: CONFIRMED DECISION (owner), VERIFIED (an official page as extracted directly states it), UNVERIFIED (not established), COUNSEL/GOOGLE (needs legal or Google approval).
>
> **What changed:** `verification-part-C.md` (Families / children audience: 38 requirements, 29 VERIFIED, 9 UNVERIFIED) and `verification-part-D.md` (payments: 13 rows, 1 VERIFIED, 12 UNVERIFIED; worldwide distribution: 17 rows, about 12 VERIFIED and 5 UNVERIFIED) were added. Parts A and B are unchanged (A: 10 / 4, B: 12 / 10). The WebFetch limitation (model-written extracts, not raw pages) applies to all four parts.
>
> **Superseded in this file:** the Families conclusion "duties attach only when a selected age group includes children" is now the *operative* rule, because the owner has selected children. The earlier recommendation of 18+ only is withdrawn: the owner's published child-safety policy says the lessons are "designed primarily for children aged 5 to 12" (`child-safety-policy-en.md:39`), so 18+ was inconsistent with the facts.
>
> **New VERIFIED requirements (Part C):** Families Policy applies once children are a target audience; ads, advertising ID, location, SDK, personal-data, privacy-policy and account-deletion rules apply as listed in Part C section 1.
> **New gaps (Part C section 3, none closed):** (1) audience declaration and all drafts must be redone; (2) SDK status of Firebase Cloud Messaging, Sentry and LiveKit for child-directed use is UNVERIFIED (Google names none; needs each vendor's statement and counsel); (3) whether the family chat and calls are a "social feature that includes children", which would need an in-app safety reminder and adult-action evidence that do not exist today; (4) the neutral age screen is tied to ads in Google's wording and is probably not required with no ads, UNVERIFIED; (5) COPPA / GDPR and the Data safety entries for child data (name, date of birth or age, photo, lesson records, voice).
> **Payments (OPEN, not settled):** the Play explainer (answer 10281818) says a paid one-to-one service "between two individuals" and "not available for replay" needs no Play Billing, with education classes as an example, but the Payments policy page's extract shows no such sentence and nothing addresses bank transfer or showing payment information in the app. The exact question for Google Play Support and the questions for counsel are in Part D. **Free installation does not settle it.**
> **Worldwide (COUNSEL):** US COPPA (the FTC says foreign services directed at US children are covered), Brazil's ECA Digital, EU GDPR Article 8, the UK Children's code and India's DPDP rules are for counsel; the official EU/UK/India texts could not be fetched, so those rows are UNVERIFIED. Play Age Signals and US state app-store laws, export compliance and sanctions are listed in Part D.


Detail tables with URLs, headings, quotes and gaps: `verification-part-A.md` (audience, child safety, Data safety, payments, metadata: 14 rows) and `verification-part-B.md` (full-screen intent, foreground service, account/testing, listing specs, countries: 22 rows).
**Limit that applies to every row:** the pages were read through WebFetch, which returns a model-written extract, not raw HTML. Quotes are as returned and were not checked against the raw page. "VERIFIED" here therefore means "an official Google or Android page, as extracted, directly states it". Nothing was confirmed in a live Play Console (no access).

| Result | Count |
|---|---|
| VERIFIED (A: 10, B: 12) | 22 |
| UNVERIFIED (A: 4, B: 10) | 14 |
(A rows 8 and 12 are split: part verified, part not. B row 14 is verified narrowly.)

## Conclusions that matter
**Verified**
- Families Policy duties attach only when a selected target age group includes children; the six age groups match; select mixed groups only if truly designed for all ages. (9867159, 9893335)
- Child Safety Standards scope is currently "Anonymous and Random chat apps, and apps in the Social and Dating categories". An Education-category app with named, authenticated adult accounts is not in the listed scope today. Google says the scope is "currently" that, so it can change. (14747720)
- Data safety form is mandatory for a published app; crash-log and diagnostics data types exist. (10787469)
- Account deletion: a **web link** to request deletion is required for any app that lets users create accounts, plus an in-app path. (13327111)
- Metadata must accurately describe functionality and screenshots must reflect the real app experience, so card wording must stay out of the listing while cards are paused. (9898842)
- Full-screen intent: on Android 14, only calling and alarm apps have it on by default; the console lets such an app declare "core functionality". The platform provides `canUseFullScreenIntent` and a settings-page intent. (13392821, developer.android.com Android 14 behaviour changes)
- Foreground service: declare each service type used (microphone) with a description and a video link showing how a user triggers it; RECORD_AUDIO runtime permission is a prerequisite. (13392821, developer.android.com service types)
- Personal developer accounts created after 2023-11-13 need a closed test with at least 12 testers opted in continuously for 14 days before production access. Internal testing (up to 100 testers) has no listed prerequisite. (14151465, 9845334)
- Listing limits: title 30, short description 80, full description 4,000 characters; icon 512x512 PNG; feature graphic 1024x500 JPEG or 24-bit PNG without alpha; screenshots JPEG or 24-bit PNG, up to 8 per device type; no emoji or ALL CAPS in the title; country targeting is under Production > Countries/regions. (9859152, 9866151, 9898842, 7550024)

**Unverified, with what is missing**
- **Payments exemption (important risk).** The Payments page has no sentence about real-time one-to-one services. Item 3.2 covers peer-to-peer payments only, and item 2 lists education-type subscription services among those needing Google Play billing. Whether Jawwid's bank-transfer lesson packages are outside Play Billing is **not established**. This needs counsel or Google Play support before you rely on "no Play Billing". (9858738)
- Organization-account exemption from the 12-tester rule, how the console shows the account type, and whether the type can be changed: not stated on the pages read.
- First Android bundle via the API: five official pages are silent either way. Keep the manual first upload as a precaution, not a verified rule.
- Full-screen-intent "core = app is broken without it" wording, and whether store category affects eligibility: not found.
- Video length, hosting and access rules: Google's page only asks that the video show the user steps; the 30 to 90 s, unlisted-link plan is the repo's own guidance.
- Console order of the declarations, the service-account permission needed, and whether Sentry and Firebase data are covered by the Data safety types (the page names neither SDK; the types themselves exist).
- Free versus paid: an owner and business decision, not a Google fact.
- Engineering flag (not a policy item): Android restricts starting a microphone foreground service from the background. Answering a call from a notification on Android 14 or later must be tested on a device (added as step 11a in `ANDROID-READINESS-PLAN.md`).

## Owner decisions still required
1. Payments: obtain counsel's or Google Play support's answer on the exemption before relying on bank-transfer-only payments outside Play Billing.
2. Target audience 18+ (Families not applicable if so) and storefronts.
3. Child Safety Standards: answer "not in scope" (supported by the scope text, may change) or file the prepared answer.
4. Developer account type and creation date (look in the console), and the 12-tester plan if personal.
5. Full-screen-intent "core functionality" declaration, and the foreground-service video link.
6. Account-deletion web URL (asset to be supplied), and card-free listing wording (use #591's text).
7. Quran wording in the title, tagline, descriptions and feature graphic (not finalized anywhere).
8. Free app confirmation.
