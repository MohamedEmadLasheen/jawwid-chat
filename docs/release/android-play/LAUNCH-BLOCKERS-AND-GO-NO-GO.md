# Jawwid on Google Play: launch blockers and GO / NO-GO (2026-11-18)

Owner strategy (final): name **Jawwid**; primary user is the parent/guardian; children benefit from the lessons but are not intended direct users; free; worldwide; no new features or architecture changes. This supersedes the earlier same-day line "target audience: children, parents and teachers" (`OWNER-DECISIONS-REGISTER.md` D2 is superseded by this).
No build, upload, console setting, PR merge or application-code change was made for this document.

## 1. Recommendation

| Step | Decision | Evidence |
|---|---|---|
| **Internal testing release (first upload of the signed AAB)** | **GO, once you create the Play app and upload** | The signed AAB 1.0.0 (3) is verified: SHA-256 `581032996e34e088e63f0d89f42c08084083bf7e22f14d1cba7d8ff89a903dfd` matches the CI value; package `com.jawwid.jawwid_chat`; signed by the upload key (certificate SHA-256 matched the pinned value); target SDK 36; 14 permissions all explained; no `AD_ID`; built from the same commit as the iOS build and production (`2e412701`). Google's page lists no prerequisite for an internal test (Part B row 14, as extracted). |
| **Production submission** | **NO-GO today** | The blockers in section 2 below. None needs an app code change; each needs your decision, counsel, Google, or a device. |

## 2. Launch-blocker checklist (production)
| # | Blocker | Type | Needs | Status |
|---|---|---|---|---|
| B1 | **Target audience declaration**: what to tick (see section 3) | Owner attestation + counsel | Your decision, counsel's written view | OPEN |
| B2 | **Payments policy**: Play Billing exemption for live one-to-one lessons paid by bank transfer outside the app | Google + counsel | Written question to Google Play Support, counsel review (`verification-part-D.md`) | OPEN. Do not claim the exemption |
| B3 | **Phone screenshots** (min. 2, ideally 4 to 8) | Asset | A phone connected to this Mac, or an emulator (needs about 8 GB free; the disk is at 1.4 GB right now) | BLOCKED |
| B4 | **Foreground-service demo video** + link | Asset | Screen recording on a real device (steps 8 and 10 of the device plan) | BLOCKED |
| B5 | **Data safety submission** | Owner attestation | Answers in `APP-CONTENT-ANSWER-SHEET.md` section 6; open rows: religious-beliefs (counsel O-2), child data, "not shared" premise | NEEDS DECISION |
| B6 | **SDK status for child-directed use** (Firebase Cloud Messaging, Sentry, LiveKit): only matters if child age groups are ticked | Evidence + counsel | Vendor statements and the Play SDK Index entries (read in the console) | UNVERIFIED |
| B7 | **Content rating questionnaire** (3 questions can't be answered from code alone) | Owner attestation | You answer from knowledge of the academy content | OPEN |
| B8 | **Store listing text** | Owner approval | Use `PLAY-LISTING-FINAL-DRAFT.md`; Quran wording approval; PR #591 is unmerged (do not paste from `main`, it says "card") | READY for approval |
| B9 | **Feature graphic** | Owner approval | `feature-graphic/feature-graphic-1024x500.png`; logo is soft (needs a vector) | READY for approval (optional polish) |
| B10 | **App access**: reviewer credentials | Owner | Type the `parent@review.chat.jawwid.com` password in the console; instructions text is in the answer sheet; I never see the password | READY except the password |
| B11 | Developer account type and creation date | Owner | Read Settings > Developer account > Account details; if personal and created after 2023-11-13, a 12-tester, 14-day closed test comes before production access | UNKNOWN |

## 3. Audience reassessment (B1): the facts, not a recommendation to declare anything false
- **Parent-focused design (confirmed):** accounts exist only for parent, teacher and sales roles (`lib/shared/models/user_role.dart`); the account holder is 18 or older (the live privacy policy says so); children have no account and do not sign in.
- **Facts pointing the other way (do not hide them):** your own published child-safety policy says "The Academy's lessons are designed primarily for children aged 5 to 12" (`child-safety-policy-en.md:39`); a child may take part in a live lesson call on the parent's phone; the app shows child data (name, lesson reports, material opens).
- **Google (as extracted):** the Families Policy applies once a selected age group includes children; Google has no stated rule for children as end users under an adult account (unverified).
- **Two honest options, both need counsel's written view before you attest:**
  1. *Adult groups only (18 and over).* Consistent with the parent-focused product and the account model. Risk: Google or a reviewer may judge the service child-directed, given the 5 to 12 statement and child participation. The listing and graphics must then stay parent-addressed (they are; no child imagery).
  2. *Child groups plus 18 and over.* Matches the "designed primarily for ages 5 to 12" statement. Triggers the Families Policy: SDK status (B6), whether the family chat counts as a "social feature that includes children" (an online-safety reminder does not exist), and children's data in the Data safety form.
- I do not choose for you. Do not tick "18 and over only" on my say-so, and do not assert that children are not part of the audience unless counsel agrees.
- **Protecting children's data regardless of the choice:** accounts are adult-only and academy-created; no ads, no `AD_ID`, no location permission; names hidden on lock screens by default; crash reports carry a hashed account id with `sendDefaultPii=false`. These are facts from the repo and the signed bundle, not legal conclusions.

## 4. Optional improvements (not launch blockers)
Feature graphic redesign from a vector logo; Arabic feature graphic; LR-11 notification-permission explainer (the prompt follows sign-in today; do not claim otherwise in the console); iOS display name change to "Jawwid" (a separate iOS build); a sales-role review account.

## 5. Post-launch
Teacher Approved and Designed for Families programs; Play SDK Index follow-up; vendor DPAs; a native-speaker review of all Arabic copy.

## 6. Engineering findings
No release-blocking defect found in the repo or the signed bundle (checks listed in `APP-CONTENT-ANSWER-SHEET.md`). Not yet tested on a device: login, push, calls, Arabic/RTL, app lock, deletion, and the Android 14 microphone foreground service started from a notification. These are test gaps, not known defects. No code was changed, so the build did not need to be repeated.

## 7. Actions only you can perform (in order)
1. **Free about 8 GB of disk on this Mac, or connect an Android phone with USB debugging.** Without one of these I cannot make Android screenshots or the video. Say "go" and I run the emulator install or the capture.
2. In Play Console, **create the app "Jawwid"** (free, Education proposed, default language). Read the account type and creation date from Account details.
3. **Upload `app-release.aab`** to Testing > Internal testing and add testers. Delete the plaintext `.aab` afterwards. (Approval required; I will not upload.)
4. **Decide B1** with counsel, then **send the payments question** (B2) to Google Play Support and counsel.
5. **Answer the content rating, Data safety, financial features, foreground-service and full-screen-intent attestations** from `APP-CONTENT-ANSWER-SHEET.md`; type the review password into the App access field.
6. **Approve the listing text and graphic**, including the Quran wording or the neutral alternative; merge #591 or approve using its text.
7. When screenshots and the video exist, finish the store listing and submit for review.
