# Part C: Google Play compliance with children as an explicit target audience

Date of research: 2026-11-18. Repo state: `origin/main` @ 2e412701 (read with `git show`/`git grep`, nothing modified).
Not legal advice. Items marked COUNSEL need a lawyer.

**Method and limits.** Every page was read with WebFetch, which returns a **model-written extract**, not the raw page. A requirement is VERIFIED only if the quoted sentence (max 25 words) directly supports it. Quotes below are as returned by the tool; re-read the live page before relying on exact wording in the Console. No search snippets, no third-party sources used. The Play Console itself was not opened.

Sources (all fetched 2026-11-18):
- FP = Families Policy, https://support.google.com/googleplay/android-developer/answer/9893335
- TA = Target audience and content, https://support.google.com/googleplay/android-developer/answer/9867159
- CS = Child Safety Standards, https://support.google.com/googleplay/android-developer/answer/14747720
- AD = Families Self-Certified Ads SDK, https://support.google.com/googleplay/android-developer/answer/9283445
- DS = Data safety form, https://support.google.com/googleplay/android-developer/answer/10787469
- UD = User Data policy, https://support.google.com/googleplay/android-developer/answer/9888076
- FT = Families topic page, https://support.google.com/googleplay/android-developer/topic/9877766
- PD = Policy deadlines, https://support.google.com/googleplay/android-developer/answer/12253906 (fetched; returned deadlines list only)
- PL = Play policy overview, https://support.google.com/googleplay/android-developer/answer/9859655

## 1. Requirements register

| # | Requirement | Source / section | Quote | Status |
|---|---|---|---|---|
| R1 | Families Policy applies once children are one target audience | FP, intro/Applicability | "If one of the target audiences for your app is children, you must comply with the following requirements." | VERIFIED |
| R2 | Any selected age group that includes children triggers Families Policy | TA, Target audience age groups | "Any apps that have at least one target audience age group that includes children must comply" | VERIFIED |
| R3 | App content accessible to children must be appropriate | FP, Requirements 1 "App content" | "Your app's content that is accessible to children must be appropriate for children." | VERIFIED |
| R4 | Ads: certified SDKs, no personalized ads (only if ads shown) | FP, Ads and Monetization | "If your app displays ads to children or to users of unknown age, you must:" | VERIFIED (conditional; app has no ads) |
| R5 | Apps solely for children: no SDKs "not approved for use in primarily child-directed services" | FP, APIs and SDKs; UD, Children's Data | "must not contain APIs or SDKs that are 'not approved for use in primarily child-directed services.'" | VERIFIED (extract; applies to child-only apps; mixed audience unclear) |
| R6 | Implement APIs/SDKs correctly | FP, SDK/API use | "You must ensure that your app properly implements any APIs and SDKs." | VERIFIED |
| R7 | Disclose collection of children's personal/sensitive data, incl. via third-party code | FP, Personal and sensitive info | "You must disclose the collection of any personal and sensitive information from children in your app" | VERIFIED |
| R8 | Child-only apps: no AAID or other persistent device identifiers transmitted | FP, Advertising ID | "Apps that solely target children must not transmit Android advertising identifier (AAID)," | VERIFIED (sentence truncated in extract; remainder UNVERIFIED) |
| R9 | Child-only apps: no AD_ID permission on API 33+ | FP, Permissions | "Apps solely targeted to children should not request AD_ID permission when targeting Android API 33 or higher." | VERIFIED |
| R10 | Child-only apps: no location permission | FP, Data practices | "Apps that solely target children may not request location permission." | VERIFIED |
| R11 | Bluetooth requests via Companion Device Manager | FP, Data practices | "Apps must use the Companion Device Manager (CDM) when requesting Bluetooth." | VERIFIED (app has no Bluetooth permission of its own; LiveKit adds legacy BLUETOOTH maxSdk 30) |
| R12 | Social apps/features that include children: in-app safety reminder | FP, Social apps | "All social apps that include children in their target audience must provide an in-app reminder to be safe online." | VERIFIED |
| R13 | Adult action before children exchange personal information; adult action = verify user is not a child | FP, Social apps | "You must also require adult action before allowing child users to exchange personal information." / "Adult action means a mechanism to verify that the user is not a child." | VERIFIED |
| R14 | Mixed audience: neutral age screen | FP, Mixed audience | "If your app is for a mixed audience, you must include a neutral age screen to ensure children only see non-personalized ads." | VERIFIED (the stated purpose is ad handling; whether it is needed with no ads is UNVERIFIED) |
| R15 | Neutral age screen must not nudge lying; no preset birth date | TA, Neutral age screen | "A neutral age screen must be implemented so that any ads not suitable for children are only shown to older audiences." (the "no preset date" detail is the extract's paraphrase) | VERIFIED for purpose; exact "no preset" wording UNVERIFIED |
| R16 | Comply with COPPA and GDPR | FP, Legal compliance | "compliant with the U.S. Children's Online Privacy and Protection Act (COPPA)" | VERIFIED (COUNSEL for how it applies) |
| R17 | Data safety and Console answers accurate and updated | FP, Data safety | "You must accurately answer the questions in the Play Console regarding your app and update those answers" | VERIFIED |
| R18 | Privacy policy accurate; linked in Console and in app; public non-geofenced URL, no PDFs | FP, Privacy policy; UD, Privacy Policy Requirements | "available on an active, publicly accessible and non-geofenced URL (no PDFs)." | VERIFIED |
| R19 | Data safety must include SDK data; Families badge optional in form | DS, Families and Children; Third-Party SDK Disclosure | "You must reflect data collection or sharing carried out by such third-party code in the Data safety form for your app." | VERIFIED. Badge: "can opt in to a Families badge" VERIFIED optional |
| R20 | Account deletion in-app and via web link for apps with account creation | UD, Personal and Sensitive User Data | "Apps that allow account creation must offer deletion in-app and through an external web resource." | VERIFIED |
| R21 | UGC/communication features | FP | Only social-app rules above (R12, R13) were returned. No separate UGC moderation text surfaced in the extract. | UNVERIFIED (re-read FP in full) |
| R22 | Families Self-Certified Ads SDK program does not apply with no ads | AD, Apps With No Ads | "apps that do not serve ads to children are not required" | VERIFIED |
| R23 | Program covers ads SDKs only; Firebase, Sentry, LiveKit not named | AD, Firebase/Sentry/LiveKit | "only if you are using third-party ads SDKs in your app" | VERIFIED that AD does not name them. Whether they are "approved for child-directed services" is UNVERIFIED |
| R24 | Google Play SDK Console / Families SDK list for non-ad SDKs | PL, FT | Extract: PL "doesn't mention the Google Play SDK Console, Firebase, analytics, or crash reporting" | UNVERIFIED (no official list found) |
| R25 | Designed for Families program: defined, eligibility, optional/mandatory | FT | "high-quality, age appropriate content for the whole family" | UNVERIFIED for eligibility and whether mandatory; the page only describes its purpose |
| R26 | Teacher Approved is opt-in for Families-compliant apps | FP, intro | "All apps that comply with Google Play Families policies can opt in to be rated for the Teacher Approved program." | VERIFIED (optional; approval not guaranteed) |
| R27 | Age groups offered: 5 and under, 6-8, 9-12, 13-15, 16-17, 18+ | TA, Target audience age groups | "Note that this age group is considered to include children in most locales." (0-12 groups); 13-17 "may be considered to include children in some locales." | VERIFIED |
| R28 | Select multiple groups only if app is designed for them | TA, Mixed audiences | "You should only select more than one age group for your app's target audience if you have designed your app for" those users. | VERIFIED |
| R29 | Apps designed primarily for children under 13 must use only self-certified ads SDKs | TA | Extract: "Apps designed primarily for children under 13 must use only Families Self-Certified Ads SDKs to serve ads." | VERIFIED (extract wording; conditional on ads) |
| R30 | Adult-only selection enables "Restrict Minor Access" | TA | Extract: selecting 18+ as the only group "lets you enable Restrict Minor Access" | UNVERIFIED (extract paraphrase, no direct quote) |
| R31 | Children as end users with adult account holders | TA | Extract: "The page does not address this scenario directly." Children's info "must be disclosed and should be collected with parental consent if required." | UNVERIFIED that Google has a rule for it; consent sentence VERIFIED per extract |
| R32 | Listing with youthful marketing elements can be rejected if app is not primarily for children | TA, Store listing | "your listing contains marketing elements that suggest otherwise." Example: "youthful animation or young characters in the graphic assets." | VERIFIED. Remedy per extract: remove elements or limit audience to under 13, which brings in Families requirements |
| R33 | Child Safety Standards scope | CS, Scope | "We require Anonymous and Random Chat apps, and apps in the Social and Dating categories" | VERIFIED |
| R34 | CS applies regardless of child users | CS, Scope | "The presence or absence of child users in your app is irrelevant to this policy." | VERIFIED |
| R35 | CS duties: published CSAE standards at a global public URL, in-app reporting, CSAM handling, legal compliance, safety contact, certified in Console | CS, Requirements | Standards must be "a web resource that is globally accessible for any individual" | VERIFIED |
| R36 | Anonymous chat apps barred from targeting children (from 2026-08-26) | PD | Extract: policy expands to "prohibit developers of anonymous chat apps from targeting children." | VERIFIED; not applicable (Jawwid is identified, not anonymous or random) |
| R37 | Education category implications | Not found on any fetched page | none | UNVERIFIED |
| R38 | Mixed-audience rule: ads to children only from self-certified SDKs; non-certified SDKs only for non-children | AD, Mixed Audiences | "for serving ads only to users who are not children." | VERIFIED (ads only) |

**Counts: 29 VERIFIED (some with sub-parts UNVERIFIED), 9 UNVERIFIED** (R21, R24, R25, R30, R31, R37, and partial R8, R14, R15, R23-vendor status). Strict full-VERIFIED count after removing the partials is lower; treat partials as open.

## 2. Answers to the specific questions

1. **Families Policy applicability and list.** Applies as soon as children are one target audience (R1, R2). Requirements found: R3-R20 above. Not found as a section: a distinct UGC/communication rule beyond R12-R13 (R21).
2. **FCM, Sentry, LiveKit.** Google's fetched pages name none of them (R23, R24). Ad-SDK certification is irrelevant with no ads (R22). The only SDK rule for non-ad SDKs is R5, which is phrased for apps that solely target children, plus UD's duty that SDK providers "do not sell personal and sensitive user data from your app." UNVERIFIED whether Google deems any of the three "approved for child-directed services". Needed: (a) each vendor's written child-directed-use statement or DPA terms (Google for Firebase Cloud Messaging; Sentry; LiveKit); (b) the Play SDK Index entry for each, read in the Console or at its public page; (c) counsel opinion (item L-15 in the repo).
3. **Mixed audience / neutral age screen.** Exact wording is R14 and R15. Stated purpose is ads. Jawwid has no ads, so whether a screen is demanded is UNVERIFIED; counsel plus a Play reviewer reply are the only way to settle it.
4. **Child Safety Standards.** Scope is anonymous/random chat and Social/Dating categories, independent of child users (R33, R34). Jawwid is not anonymous or random. It applies only if the app is declared Social or Dating. The repo already has standards, in-app reporting and a contact (child-safety-policy-en.md 1.3, 1.7), so compliance is cheap either way.
5. **Age-group selection.** For "children, parents and teachers" the owner would tick the child groups (5 and under, 6-8, 9-12, per owner's own policy 5-12; enrolment from age 3) plus 18+ (parents and teachers). Ticking any child group triggers Families Policy (R2). Per the repo's own child-safety policy, "designed primarily for children aged 5 to 12" (docs/legal/child-safety-policy-en.md:39), so the earlier "18 and over only" draft answer is now inconsistent. Google has no stated rule for adult account holders with child end users (R31). Choosing 18+ only would be inconsistent with the owner's confirmed audience and is a COUNSEL question.
6. **Optional vs mandatory.** Teacher Approved: optional opt-in (R26). Designed for Families: UNVERIFIED (R25). Families badge in Data safety: optional (R19). Families Policy itself: mandatory once children targeted.
7. **Listing.** Appeal-to-children imagery is permitted if children are a declared audience; the reverse (appeal without declaration) risks rejection (R32). Education category: UNVERIFIED (R37). Existing listing copy rule "no child imagery" is no longer required to stay.

## 3. Gap list (app today vs requirements)

Repo facts used (all `origin/main`): accounts only parent/teacher/sales (`lib/shared/models/user_role.dart:9-21`); no ad, analytics or AD_ID code (`git grep` for advertising/admob/analytics/AD_ID in lib, android, pubspec returned only a comment "Firebase Messaging only (no Analytics)" at `android/app/build.gradle.kts:123`); no age screen or birth-date entry in lib (grep for birth/ageGate found none; date of birth is staff-side per `lib/core/data/http/http_lesson_repository.dart:140`); child data held: name, level, teacher, optional photo, "about", date of birth or stated age, lesson records (`docs/legal/privacy-policy-en.md` 4.4.1, 6.1); child name shown in app (`lib/shared/models/conversation.dart:58-59` LearnerRef.displayName, `lib/features/feedback/presentation/teacher_feedback_form.dart:23`, billing screens `lib/features/billing/presentation/my_payments_screen.dart:487`); no location permission, AD_ID absent, 14 manifest permissions (`(release-assets folder outside the repo)/PERMISSIONS-AUDIT.md`); report sheet in chat and profile (`lib/features/messages/presentation/chat_screen.dart:549`, `lib/features/profile/presentation/profile_screen.dart:233`); account deletion in app (`lib/app/router.dart:35,94`) and web page (`docs/legal/account-deletion-en.md`); Sentry configured without session tracking (`lib/core/crash/crash_reporting.dart:38-48`) and hashed account id; FCM only (`android/app/build.gradle.kts:123-125`).

| Requirement | What the app does today | Gap | What is needed to close | Who decides |
|---|---|---|---|---|
| Target audience declaration consistent with the app (R2, R27, R28) | Draft says "18 and over only" (`docs/release/store-console/play-declarations.md:22`); owner now says children, parents and teachers; own policy says designed primarily for ages 5-12 (`child-safety-policy-en.md:39`) | YES | Re-answer Console audience, update play-declarations.md, age-rating.md, data safety "Families" row (`google-data-safety.md` overview table) | Owner (decision made 2026-11-18); counsel to confirm group choice |
| Content appropriate for children (R3) | Quran, Arabic and Islamic lessons; chat includes adults; Quran content needs qualified review (owner policy) | UNKNOWN | Confirm every child-reachable surface (lesson content, voice notes, attachments between adults) is suitable; religious content approval | Owner / qualified religious reviewer |
| Ads (R4, R22, R29, R38) | No ad SDK, no ads | NO | Keep; record "no ads" statement for Console. Self-certified SDK program does not apply | Engineering lead |
| SDKs approved for child-directed use (R5, R23, R24) | FCM, Sentry, LiveKit/flutter_webrtc, local_auth, connectivity_plus, just_audio in use | UNKNOWN | Vendor statements and Play SDK Index entries for FCM, Sentry, LiveKit; counsel on whether R5 applies to a mixed-audience app (repo item L-15) | Counsel and owner; lead gathers evidence |
| Disclose children's personal data (R7, R17, R19) | Data safety draft lists adult data types; children's name, DOB, lesson records appear in privacy policy 4.4/6 but the Data safety draft lists child data only via "Name"/other types | UNKNOWN | Audit google-data-safety.md for child-specific entries (child name, DOB/age, photo, lesson reports) and confirm declared; set Families badge choice | Lead drafts; owner submits |
| Advertising ID / AD_ID (R8, R9) | AD_ID absent from merged manifest (PERMISSIONS-AUDIT.md rows, count 0); no ad code | NO | Keep; re-check after each dependency bump | Lead |
| No location permission (R10) | No location permission; region is user-chosen text | NO | None | Lead |
| Bluetooth via CDM (R11) | Only LiveKit's legacy BLUETOOTH (maxSdk 30), no app code | NO (low risk) | Confirm with Play pre-launch report | Lead |
| In-app safe-online reminder (R12) | No reminder found in lib (grep "online safety" found none); safety links exist in the legal gate (`lib/features/legal/presentation/legal_gate.dart:438`) | YES, if chat counts as a feature that includes children; UNKNOWN whether it does (children have no account and do not message) | Decide scope; if needed, add a one-time reminder before family chat/calls and test it. Ask counsel whether adult-only chat on a child's device is a "social feature that includes children" | Owner decides; lead builds |
| Adult action before children exchange personal info (R13) | Children cannot sign in; chat requires parent account; biometric lock available via local_auth | UNKNOWN (likely met structurally) | Document that every account is a verified adult via academy-created accounts; counsel to confirm that satisfies "adult action" | Counsel |
| Neutral age screen (R14, R15) | None built (`play-declarations.md:30-33`) | UNKNOWN | Not needed if the app is not for a mixed audience of unknown-age users, since all users are adults enrolled by the academy; decide whether audience is "mixed"; if screen wanted, build birth-date entry without preset | Owner and counsel |
| COPPA/GDPR (R16) | Privacy policy 6.4 parental consent via enrolment; Wyoming LLC | UNKNOWN | COPPA verifiable parental consent analysis for a service collecting child name/DOB/audio | Counsel |
| Privacy policy content and link (R18) | Privacy policy exists with children's section (6); linked in app (legal gate) | NO (verify) | Check hosted URL is public non-PDF and Console field set | Lead |
| Account deletion (R20) | In-app delete (`lib/app/router.dart:94`), web page exists | NO | Enter URL in Data safety | Lead |
| Child Safety Standards (R33-R35) | Standards published (child-safety-policy-en.md 1.3, 1.7), in-app report (`chat_screen.dart:549`) | NO | Link in Console, certify in-app mechanism, name contact. Needed only if declared Social/Dating but already done | Lead |
| Listing/store assets (R32) | listing-copy.md says no child imagery | NO | Optional now: child-friendly art is allowed if the audience is declared; keep imagery honest | Owner |
| Education category (R37) | Unknown | UNKNOWN | Read Play category pages; not found in this research | Lead |
| Teacher Approved / Designed for Families (R25, R26) | Not pursued | NO (optional) | Decide later; Designed-for-Families eligibility unverified | Owner |

## 4. Five biggest gaps
1. Audience declaration conflicts with existing drafts (18+ only) and with the app's own stated design for ages 5-12.
2. UNVERIFIED SDK status of FCM, Sentry, LiveKit for child-directed use; Google names none; vendor statements and counsel are needed.
3. Whether the family chat and calls count as a "social feature that includes children", which would require a safety reminder and adult-action evidence; no reminder exists.
4. Neutral age screen question: not built; need for it is tied to ads in the sources, so likely not required, but unverified.
5. COPPA/GDPR and children's-data disclosures in the Data safety form need a pass for child-specific data (name, DOB, lesson records, voice).
