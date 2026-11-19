# Apple App Review 2.1 "Information Needed": audit, findings and risks

**Build under review:** iOS 1.0.0 (2), bundle `com.jawwid.jawwidChat`, team KX683HAR3Y. Built by run 44285965671
(2026-11-18 10:30Z) from `main` @ `2e4127015`. Production runs the same commit (deploy 44401677210).
**Audit date:** 2026-11-19. **Method:** four read-only code audits of that commit, run in parallel:
- AR-C: auth and account lifecycle
- AR-D: UGC and safety
- AR-E: services, legal and regions
- AR-F: store, IAP, Guideline 3.2 and screenshots

Plus these runtime checks by the lead:
- the physical iPhone
- simulators against an isolated local backend seeded by the real review-cohort command
- read-only production probes

The full agent reports are in the orchestrator folder: `reports/AR-*.md`.

Status words: **VERIFIED** (tested, with evidence), **COMPLETED** (done; needs an external check), **BLOCKED** (needs
an external action), **NOT APPLICABLE**, **FAILED**.

## 1. Already compliant in the submitted build

| Area | Finding | Evidence | Status |
|---|---|---|---|
| Sign-in for reviewers | E-mail and password only; no OTP, SMS, e-mail verification or 2FA | `auth.controller.ts:62`; AR-C | VERIFIED (local, through the real API and app) |
| Reviewer accounts exist in production | Review cohort provisioned at `2e41270` (three successful runs; latest 2026-11-19) | Workflow runs (AR-C) | COMPLETED (sign-in by the owner pending) |
| Account deletion in the app | Settings > Delete account > password > confirm. Immediate erasure; "Deleted user"; signed out; documented retention. Teachers with open work: a request, completed within 30 days. Web deletion page `api/v1/account-deletion` | `settings_screen.dart:279-286`; migration `20261102210000_chat_account_erasure.sql`; AR-C | See `PHYSICAL_DEVICE_QA.md` |
| Report content (1.2) | Long-press > Report, with 5 reasons including child safety | `message_actions.dart:129-148`; `report_sheet.dart`; `reports.controller.ts` | See QA |
| Report a user (1.2) | Group info > member flag; 1:1 profile > Report this person | `profile_screen.dart:216-240,683-724` | See QA |
| Block users (1.2) | Member block icon or "Block this person"; hides their messages, stops their messages and calls; Settings > Blocked people to unblock | `block_actions.dart`; `blocks.ts` | See QA |
| Moderation (1.2) | Staff queue `/moderation`, 24 h due, escalation at 18 h and 24 h, child-safety reports routed immediately, remove message, warn, suspend, answer the reporter | `reports.service.ts`; `report-escalation.service.ts`; `moderation.service.ts` | COMPLETED (code; production queue not exercised) |
| Filtering (1.2) | Word filter on text (37-word draft list); staff review for media | AR-D | COMPLETED (list wording is a draft) |
| Published contact (1.2, 1.5) | Settings > Help and support; Contact support; the release build fails if these are unset | `legal_links.dart`; `build-store.sh` | COMPLETED |
| No strangers | Children have no accounts; teacher and parent never have a direct chat; a supervisor is always present | `authorization.service.ts:256-337,630-680` | COMPLETED |
| In-app purchase (3.1.1 / 3.1.3(d)) | Only live one-to-one lessons are sold (one learner per lesson, enforced by the server). Nothing digital is sold and nothing is unlocked by payment. No StoreKit. Card payments paused (`billing.card_paused`); bank transfer; review payment mode makes paying impossible | `call_controller.dart:79-83`; `billing.service.ts:598,731`; AR-F §1 | COMPLETED: 3.1.3(d) applies, so IAP is not required |
| Privacy manifest vs label draft | 16 data types, the same in both; no tracking | `PrivacyInfo.xcprivacy`; `apple-app-privacy.md` | COMPLETED |
| Licences | No GPL, LGPL or AGPL in the app; OFL fonts with licence files; Tanzil text CC BY with attribution; own CC0 sounds; no Quran audio served (not licensed) | AR-E §2 | COMPLETED |
| Encryption | `ITSAppUsesNonExemptEncryption = false` (TLS and WebRTC only) | `Info.plist` | COMPLETED |
| Localization | Arabic and English, 1,597 strings each, none missing | AR-E §4 | COMPLETED |
| No country restriction in code | No geo-checks anywhere | AR-E §4 | COMPLETED |

## 2. Findings that needed action

| # | Severity | Finding | Action taken | Status |
|---|---|---|---|---|
| G-1 | **High** (3.2) | Nothing in the app or in the notes showed how a member of the public becomes a customer. The old notes said "Accounts are created by the academy; there is no public sign-up", which reads as an app for one organization's members (Apple steers those to Unlisted or Custom App distribution). The academy is public: jawwid.com/enroll, a free trial, public prices, students in many countries | (1) The response explains public enrolment, and why accounts are academy-created (child safety). (2) Code: the sign-in screen links "New to Jawwid? Enrol your child" to `https://jawwid.com/enroll/` (branch `claude/sign-in-enrol-link`, tested). Reaches users only in a new build (1.0.0 (3)), which needs the owner's approval to upload | COMPLETED (code + text); build 3 BLOCKED (owner) |
| G-2 | **High** (1.2) | Users never agree to the Terms of Use with zero tolerance for objectionable content: the server side of the Terms gate (PR #497) is not merged, so the in-app gate (already in build 2) never shows | PR #497 brought up to date with `main` and re-tested (see the checklist). Needs Code Owner/owner merge, a production deploy, and publication of the legal versions. **No new iOS build needed** | COMPLETED (code); BLOCKED (owner: merge + deploy + publish) |
| G-3 | High (accuracy) | The previous notes had false statements for build 2 and production: "Subscriptions tab" (now Packages), "card opens a Stripe page" (card paused, no card button), and calls ringing "also when the app is closed (CallKit)" (production has no `APNS_VOIP_ENABLED`) | New notes (`APP_REVIEW_NOTES.md`) say only what is true | COMPLETED |
| G-4 | High (2.3.3) | No usable App Store screenshots exist; the only store-sized image is the sign-in screen | Real in-app screenshots captured at 1206x2622 and 1320x2868, in English and Arabic (`APP_STORE_SCREENSHOTS_AUDIT.md`) | COMPLETED (owner uploads) |
| G-5 | Medium (accuracy) | Draft storefront policy "GCC/Arab countries, not the US" conflicts with the owner's worldwide objective | `REGIONAL_AVAILABILITY.md`: worldwide except China mainland (CallKit; ICP) | COMPLETED (owner sets it in App Store Connect) |
| G-6 | Medium | No review login for the sales role | Disclosed in the reply; offered if Apple asks | COMPLETED (disclosure) |
| G-7 | Low | Block is offered on managers and then refused by the server | Not needed for Apple; recording script avoids it | Open (product backlog) |
| G-8 | Low | Report-reason labels and the filter word list are marked "draft" | Work as they are; owner to confirm wording | Open (owner) |
| G-9 | Low (licence hygiene) | The Tanzil attribution in the verse picker names the source but not the licence (CC BY 3.0 asks for the licence name or link) | Add "CC BY 3.0" beside it | Open (small follow-up) |
| G-10 | High (accuracy) | Independent fact-check of the draft notes (AR-G) found: the enrol link mentioned although not in build 2; wrong teacher tabs; the 24-hour review overstated (the review organization has no staff, so reports there get no answer); blocking effects incomplete; "kept as the law requires" too broad; the "Username" label; PushKit ringing claimed while VoIP is off | All corrected in `APP_REVIEW_NOTES.md` | COMPLETED |

## 3. Findings outside the app (owner)

| # | Severity | Finding | Recommended action |
|---|---|---|---|
| F-1 | **High (security and review)** | **jawwid.com shows signs of compromise.** The home page contains a hidden link (anchor text ".") to a casino page on jawwid.com itself (`/21-bit-casino-canada-review-a-bitcoin-friendly-gambling-destination/`); AR-F also saw `/casinos-zonder-account/`. This is typical of injected SEO spam on a hacked WordPress site. `/enroll/` itself is clean (checked 2026-11-19). The response, the Marketing URL and the new enrol link point reviewers there | Clean the site: remove the injected pages and links, update WordPress and its plugins, rotate the admin passwords, and check the admin users. **Before resubmission.** Until then, leave the Marketing URL empty |
| F-2 | High (accuracy) | **Where do lessons take place?** The app has in-app voice lesson calls. The new sales landing page says Zoom; jawwid.com says "video and audio" | Owner states the truth; the text follows it (`APP_REVIEW_NOTES.md` §C) |
| F-3 | Medium | Other jawwid.com inconsistencies: contact `jawwidmanagement@gmail.com` vs `info@jawwid.com`; "100% money back in a week" vs Terms 14.1 (pro-rata refund) | Align the site with the Terms |
| F-4 | Medium | The privacy policy covers only GCC law; the US, EU and UK positions, and the LD-13 consent, are open | Counsel (not an App Review blocker) |
| F-5 | Low | EU DSA trader declaration | App Store Connect (owner) |

## 4. Runtime findings (physical iPhone and simulator)

See `PHYSICAL_DEVICE_QA.md`.

## 5. Risks if resubmitted as is

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apple still reads it as an organization-only app (3.2) and proposes Unlisted | Medium | Public-enrolment framing; enrol link (build 3); website cleaned. Unlisted distribution is the fallback, with the same binary |
| Rejection under 1.2 for missing terms acceptance | Medium | Merge and deploy #497 and publish the legal versions before resubmitting |
| A reviewer is locked out (public login names) | Low | Verify logins just before resubmitting; re-run the cohort workflow to repair |
| The deletion-test account is gone (deleted during the recording) | High unless repaired | Re-run the cohort workflow after recording (script §2.3) |
