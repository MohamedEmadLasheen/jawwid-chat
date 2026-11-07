# Launch readiness checklist: App Store and Google Play

**Canonical. Re-audited 2026-11-08 against `main` @ `cebbcd99`** by eight independent read-only audits
(iOS native, Android native, accounts and deletion, user content / children / calls / push, security,
payments, production and release, and store-policy research on the official pages). It supersedes the
verdicts in `store-readiness-2026-11-03.md` and `google-play-readiness-2026-11-03.md`, which are now
history. The App Store Compliance Specialist keeps this file current; every change cites its evidence.

Nothing was built, uploaded, submitted, merged or deployed for this audit.

## Verdict

| Store | Verdict | In one line |
|---|---|---|
| **App Store** | **NOT READY** | No production backend, no terms gate, teacher deletion sends people to the academy, no distribution certificate, no hosted policies, nothing run on a device. |
| **Google Play** | **NOT READY** | The same backend, terms, policy-URL and device gaps, plus the final package name, the Organization account and the upload key. |

**Not ready means:** at least one Critical item is open. Submission waits until every Critical and High
item is MET (or N/A by a recorded decision) and verified. Passing tests and a clean build are not
approval: the decision is Apple's and Google's.

**Status key.** **MET**: verified, evidence named. **PARTIAL**: built, a named gap remains.
**NOT MET**: missing or wrong. **BLOCKED**: needs the owner, a credential, a device or a console.
**Who** names a role from `docs/engineering/organization.md`; "Owner" means the owner must act.

| Priority | Open items | Meaning |
|---|---|---|
| Critical | 10 | Submission impossible or rejection near-certain |
| High | 11 | Likely rejection, a broken core feature on review, or a legal exposure |
| Medium | 13 | A reviewer may question it, or it weakens operations |
| Low | 8 | Polish |

## 1. Critical blockers

| ID | Requirement | Store | Status | Evidence | Issue | Remediation | Who | Test after remediation |
|---|---|---|---|---|---|---|---|---|
| LR-01 | A live production backend for the store builds and reviewers (Apple 2.1(a) "turn on your back-end service") | Both | BLOCKED | `production` GitHub Environment holds 19 secrets and ~12 variables; `gh run list --workflow "Deploy production"` shows **no run ever**; `DIGITALOCEAN_APP_ID` unset; DNS unconfirmed | Nothing to sign in to | First deploy to staging, then production with `first_deploy`; point DNS; measure `TRUSTED_PROXY_HOPS`; smoke test | Owner (DNS, approval, app id); Release manager | `/health/ready` 200 on the production host; a store build signs in |
| LR-02 | Users accept the terms before they can post (Apple 1.2; Play UGC) | Both | NOT MET | #462 merged the tables only; no API reads or writes acceptance; `TODO(ENG-10)` at `reports.controller.ts:38`, `blocks.controller.ts:24`. #497 (API gate) open, CI green, unreviewed. ENG-11 (app) and ENG-12 (Admin Web) have no PR | Anyone can post without accepting. **Deploying #497 before ENG-11 breaks parent sign-up (400) and every write (403)** | Review #497; build ENG-11 and ENG-12; ship the app gate first or keep the API gate inactive until it is out; owner supplies the final texts and versions (N-3) | Backend + Mobile + Frontend engineers; Security reviewer; Owner (N-3, merge) | A fresh account cannot send, report or block until it accepts; the current app keeps working against the new API |
| LR-03 | Account deletion starts in the app, with no "contact us" (Apple 5.1.1(v); Play deletion) | Both | NOT MET | A teacher with lessons, students or payroll gets `TEACHER_DELETION_BLOCKED`, "Please contact the academy" (`app_en.arb:3482`). #498 turns it into a 30-day request; open, required checks pass, unreviewed | The demo teacher has a child assigned, so a reviewer testing deletion hits the block | Review and merge #498. **In the same change:** make `review-cohort.ts` survive the review teacher's erasure (today re-provisioning refuses with `TEACHER_CHANGED`, `:328-332`) and correct `review-accounts.md` ("takes effect immediately" is wrong for teachers) | Backend engineer; Code + Security reviewers; Owner (High risk: deletion) | Teacher with a lesson ahead: request, see the date, cancel, re-request; day-30 erasure; re-run provisioning |
| LR-04 | Public Privacy Policy, Terms, support page and deletion page (Apple 5.1.1(i), 1.2 contact; Play policy URL and deletion web link) | Both | BLOCKED | `docs/legal/*` drafts with `{{ENTITY_NAME}}` etc.; "Nothing is hosted yet" (`outstanding-information-and-decisions.md` §7); `build-store.sh:55-60` refuses to build without the four URLs | No URL exists; the drafts have placeholders and no counsel review | Owner: LD-1 entity and mailboxes, LD-2, LD-4, LD-19, H-1 host; counsel review (L-items); then engineering hosts both languages | Owner + counsel; Release manager (hosting) | Each URL opens in Arabic and English with no placeholder; the deletion page works without the app |
| LR-05 | Demo accounts on the live backend that need no WhatsApp code (Apple 2.1(a); Play App access) | Both | BLOCKED | `cli/review-cohort.ts` merged (#490): parent and teacher in their own "Jawwid App Review" organization, e-mail and password | Cannot run until LR-01; no past lessons or reports in the data | After LR-01: owner sets the domain and two passwords and runs the command; add a disposable third parent for the deletion test | Owner; Release manager | Sign in with each from a store build; the reviewer path in the notes works step by step |
| LR-06 | App Store distribution signing and an app record | Apple | BLOCKED | `xcodebuild -exportArchive`: `No signing certificate "iOS Distribution" found` (11-03, unchanged) | No IPA can be uploaded | Owner creates the Apple Distribution certificate, the App Store profile with Push, and the App Store Connect record | Owner | Export succeeds; `codesign -d --entitlements -` shows `aps-environment = production` |
| LR-07 | Final Android package, upload key and Play Organization account | Google | BLOCKED | `applicationId = com.jawwid.jawwid_chat` (`build.gradle.kts:80`), iOS is `com.jawwid.jawwidChat`; N-2 open; only a throwaway key has ever signed; Organization account needs a D-U-N-S number (Play answer/13628312) | The package name is permanent after the first upload | Owner decides N-2 (recommended: keep `com.jawwid.jawwid_chat`, already in `google-services.json`), creates the upload keystore, the Organization account and the app | Owner | `bundletool dump manifest` shows the final id; `jarsigner -verify` with the owner's key |
| LR-08 | The app works on real devices from signed builds (Apple 2.1; Play pre-launch) | Both | NOT MET | `submission-device-test-plan.md` records no results; 22 of 24 device rows NOT TESTED | Push, calls, permissions and deletion have never run on a phone against a real server | Run the plan on an iPhone and an Android 14+ phone after LR-01, LR-06, LR-07 | QA engineer + Owner (devices) | Every row PASS with a recording for the call and push rows |
| LR-09 | Store listing and console forms | Both | NOT STARTED | Only icons and a data-declaration draft exist (`docs/legal/app-store-compliance-checklist.md` §5) | Missing: screenshots, Arabic and English descriptions, App Privacy label, Data safety, Apple age rating (the 2026 questionnaire, incl. the social-media question required since September 2026), IARC rating, target audience, App access, financial-features declaration, foreground-service declaration with video, full-screen-intent declaration | Compliance specialist drafts every answer from the code (§6); owner enters them | Store compliance; Owner | A second read of every answer against the code and this file |
| LR-10 | Target audience decided (Play target audience and Families; Apple 1.3, 5.1.4) | Both | BLOCKED | Children never sign in (`user_role.dart:9-21`), but parents open child-designed content on their phone (age-banded library, Quran games in `apps/lessons/src/games/`, a reward celebration "a child sees", off on the server) | The audience answer decides whether the Families policy applies (SDK, identifier and age-screen rules) | Owner decides N-1/LD-5. Recommended: account holders 18+, not the Kids category, no child imagery in the listing, review notes saying who uses the app | Owner + counsel; Store compliance | Listing, screenshots and forms consistent with the answer |

## 2. High priority

| ID | Requirement | Store | Status | Evidence | Issue | Remediation | Who | Test after remediation |
|---|---|---|---|---|---|---|---|---|
| LR-11 | A notification opens its item; permission explained first; pushes only for the signed-in account (gates S-11, S-12, S-15) | Both | NOT MET on `main` | `release-gate.md` marks them PASS, but the code lives only in the **uncommitted** `~/dev/jawwid-push-acceptance` tree (50 changed files, last commit 11-03) and partly in open #449. On `main`, Android taps open the app with no extras (`JawwidPush.kt:153-157`), iOS has no tap handler, and the system prompt fires right after sign-in | A gate claims a control that is not in the product | Port that work as a patch onto a new branch (never touching that tree), reconcile with #449, claim the migration slot again, review | Mobile + Backend engineers; Security reviewer | Foreground, background and closed × iOS and Android: the right screen opens; signed-out phone gets nothing |
| LR-12 | Incoming calls ring while the app is closed (S-06) | Both | BLOCKED | iOS PushKit/CallKit merged but off until `APNS_VOIP_ENABLED=true`; Android full-screen ring and foreground service merged (#408, #458); no `google-services.json` in any build yet | A core feature never exercised | Owner: Firebase project and APNs key verified; turn on VoIP in staging; device test | Owner; Mobile engineer | Locked, closed and background on both phones |
| LR-13 | iOS VoIP registry exists at launch | Apple | NOT MET | `PKPushRegistry` is created in `startRegistering()` only after Dart says "start" (`AppDelegate.swift:~118`) | A VoIP push that wakes a killed app may arrive before the registry exists; iOS punishes unreported VoIP pushes | Create the registry in `didFinishLaunching`; keep the reporting rules | Mobile engineer (Opus) | Kill the app, send a VoIP push, the call rings |
| LR-14 | Foreground-service types match Play policy | Google | PARTIAL | `AndroidManifest.xml:85-88` declares `microphone\|phoneCall`; the app has no Telecom/ConnectionService. Play: `phoneCall` needs `MANAGE_OWN_CALLS` **or** the dialer role and a self-managed call | A `phoneCall` declaration that the code does not justify invites a rejection | **Decision (lead):** keep `microphone` only and drop `phoneCall` and `MANAGE_OWN_CALLS`; the call service is started from the foreground, which `microphone` allows | Mobile engineer | Lock the screen mid-call on Android 14+: the call survives |
| LR-15 | Payments presented within App Store 3.1.3(d) and Play's 1:1 exemption | Both | PARTIAL | Only live lessons are payable; nothing digital is unlocked; chat is never locked; one-off Stripe Checkout in the browser (`stripe.gateway.ts:171`). Contradictions: the review notes send the reviewer to "Settings → Payments", which no longer exists (it is the Subscriptions tab); "Subscriptions"/«الاشتراكات» and "Renew" may read as 3.1.2 auto-renewing subscriptions; a family-group lesson call can seat siblings (`vocab.ts:72`, `call.service.ts:237-256`) | A reviewer cannot find the flow, or reads it as subscriptions or one-to-few | Fix the notes now. Owner decides: rename the tab to lesson-package wording (recommended), one learner per lesson call (recommended guard), disclose Core's monthly auto-charges, the trial (N-5 Q4), live Stripe at launch | Store compliance; Owner | A reviewer following the notes reaches the pay sheet in ≤ 3 taps |
| LR-16 | Objectionable-content filter and moderation copy approved (Apple 1.2; Play UGC) | Both | PARTIAL | #493 filter on server: messages, captions, edits, forwards, feedback, profile text; `word-list.draft.json` 18 Arabic and 19 English words, status draft; report reasons (N-4) and the conduct warning (#30) are draft copy | Unapproved lists and copy in a store build | Owner approves LD-12, N-4 and the warning text | Owner | Send a listed word in each language: refused with the localized message |
| LR-17 | US age-assurance laws, storefront choice, EU trader status | Both | BLOCKED | Apple: Texas (from 4 Jun 2026), Utah, Louisiana require the Declared Age Range API even for 18+ apps; Play Age Signals; California AB 1043 from 1 Jan 2027 (secondary sources); EU DSA trader status; CallKit apps excluded from mainland China (2018 notice, unverified) | Distribution in those places carries legal duties the app does not implement | Owner picks the storefronts. Recommended first release: the academy's markets, **no China**; the US only after an age-assurance ticket; the EU only with trader details verified | Owner + counsel; Store compliance | Availability lists match the decision; if the US is in, the API call is tested |
| LR-18 | Media and evidence access verified on the real deployment (RT-037, RT-038) | Both | BLOCKED | `findings.md`: release-blocking on external verification; code checks exist (`media.controller.ts:15-31`) | Unproven against real LiveKit and Spaces | Run the RT-037 staging test (`docs/qa/RT-037-STAGING-REAL-MEDIA-TEST.md`) after LR-01 | Security reviewer; QA engineer | The documented staging test passes |
| LR-19 | Production backups run | Both (data) | NOT MET | The daily backup failed on 11-06 and 11-07: `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_PASSPHRASE` unset in the `backup` Environment | No backup of production data | Owner creates the `backup` Environment (read-only role, passphrase, bucket key); run and restore once | Owner; Release manager | A backup run succeeds and a restore drill passes |
| LR-20 | Every mobile role can delete its account in the app (Apple 5.1.1(v)) | Apple | NOT MET | Sales staff and the Super Admin can sign into the app (`http_auth_repository.dart:309-318`), but deletion is parents and teachers only (`settings_screen.dart:277-286`, `account-deletion.service.ts:60`) | Lower review exposure (reviewers use parent and teacher), but the rule covers every account | Owner decides. Recommended: a closure request for staff, the same mechanism as #498 | Owner; Backend + Mobile engineers | A Sales account sees Delete account and gets a dated request |
| LR-21 | Unique, increasing build numbers and a production-only store build | Both | NOT MET | `pubspec.yaml:4` `0.1.0+1`; `build-store.sh` passes no `--build-name/--build-number`; any https URL ending `/api/v1` passes, staging included; `SENTRY_DSN` optional | The second upload is refused; a staging build could be submitted | `build-store.sh` takes `BUILD_NAME`/`BUILD_NUMBER`, checks the API host against a production allowlist, requires `SENTRY_DSN` for store builds | Release manager / Mobile engineer | `build-store.sh check` refuses a staging host and a repeated build number |

## 3. Medium priority

| ID | Requirement | Store | Status | Evidence | Remediation | Who | Test |
|---|---|---|---|---|---|---|---|
| LR-22 | Crash reports are symbolicated | Both | NOT MET | No dSYM or Android symbol upload; no `--split-debug-info` | Upload dSYMs and Dart symbols to Sentry in the release flow | Release manager | A forced test crash shows a symbolicated trace |
| LR-23 | App Privacy and Data safety match the code | Both | PARTIAL | Manifest declares CoarseLocation for a time zone (no location API); purchase history (invoices) shown in the app is not declared; FCM's Firebase Installations id and Sentry diagnostics must be declared on Play; 15 of 21 iOS plugins ship a manifest | Run Xcode's privacy report on the archive; decide CoarseLocation; add Purchase History | Store compliance; Mobile engineer | Labels re-read against the report and the data matrix |
| LR-24 | iOS background modes all justified | Apple | PARTIAL | `remote-notification` has no handler on `main` (`Info.plist:44-51`) | Keep it only if LR-11 adds the handler; review notes explain `voip` and `audio` | Mobile engineer | Archive plist check |
| LR-25 | Reporting a staff member behaves honestly | Both | PARTIAL | Report is shown on managers, then refused with "This kind of **message** cannot be reported" (`app_en.arb:3572`); `blockErrorNotAllowed` says "You can report them instead" (DEV-CONFIRM #26) | **Decision (lead):** hide Report and Block on protected staff and point to the support and safeguarding contacts, until the owner chooses to route staff reports to the Super Admin | Mobile engineer | Open a manager's profile: no dead action, the contact line shows |
| LR-26 | Microphone denial is recoverable | Both | PARTIAL | Localized error, no "Open settings" for calls or voice notes | Add the settings link | Mobile engineer | Deny, then recover from the link |
| LR-27 | Full-screen call permission handled on Android 14+ | Google | PARTIAL | `JawwidPush.kt:140` always sets the intent; comments name a check that does not exist | Check `canUseFullScreenIntent()`; offer the system setting; fix the comments | Mobile engineer | Revoke the permission: heads-up ring plus the settings prompt |
| LR-28 | Reviewer-visible defects closed | Both | PARTIAL | TEACHER-020 (#491) needs an iPhone check; PARENT-016, PARENT-024 have no write-up; P2 retests pending (`release-gate.md` §2b) | Find or re-file the write-ups, fix, retest | QA engineer | Retest rows PASS |
| LR-29 | Uptime monitoring and someone on call | Both (ops) | NOT STARTED | `production-readiness.md`: Monitoring ❌ | Uptime check on `/health/ready`; name the on-call person | Owner; Release manager | An alert fires on a stopped instance |
| LR-30 | Release documents tell the truth | — | NOT MET | Stale: `release-gate.md` S-06, S-09 (built), S-11/S-12/S-15 (not on `main`); `production-readiness.md` ("holds nothing"); `findings.md` RT-006/012/016/022 fixed in code; roadmap §8.2 row 9 | Correct them (this PR starts it) | Store compliance / Release manager | — |
| LR-31 | Closed-account state promised by the policies (P-6) | Both | NOT MET | Only suspend and reactivate exist; an erased e-mail can sign up again | Build P-6, or counsel softens the wording | Owner + counsel; Backend engineer | Re-enrol an erased e-mail: refused |
| LR-32 | `LIVEKIT_URL` must be `wss://` in production | Both | PARTIAL | `media-token.ts:83` accepts `ws://` | Refuse `ws://` when `APP_ENV=production` | Backend engineer | Unit test |
| LR-33 | Staff permission guard enforced | Admin Web | PARTIAL | `PERMISSION_GUARD_MODE = 'shadow'` (`permission.guard.ts:20`); services check (sampled) | Review shadow denials, then switch to `enforce` | Backend engineer; Security reviewer | A staff member without the key gets 403 |
| LR-34 | Live card payments at launch decided | Both | BLOCKED | `STRIPE_*` absent from `production`; without them the pay sheet shows bank transfer only (`pay_sheet.dart:152`) | Owner decides; either way the review notes describe what the reviewer will see | Owner | Notes match the screen |

## 4. Low priority

| ID | Item | Evidence | Remediation | Who |
|---|---|---|---|---|
| LR-35 | Picker offers CSV, server refuses `text/csv` | `media_picker.dart:208,221` vs `attachment.service.ts:36` | Align the lists | Mobile engineer |
| LR-36 | Icons | iOS 1024 icon is an upscale; Android has no monochrome layer | Owner supplies a vector logo; add the monochrome drawable | Owner; Mobile engineer |
| LR-37 | Unused `sqflite` dependency | not used in `lib/` | Remove it; correct the data inventory | Mobile engineer |
| LR-38 | RT-017/018: bad `before`/`after` give 500 | `message.service.ts:626-627` | Validate; refuse both together | Backend engineer |
| LR-39 | iPhone landscape layouts | Info.plist allows landscape | Check or restrict to portrait | QA engineer |
| LR-40 | Unused `Main.storyboard` | window built in `SceneDelegate` | Remove | Mobile engineer |
| LR-41 | Arabic usage-string tone | `ar.lproj/InfoPlist.strings` | Owner reads the five strings | Owner |
| LR-42 | RedactingLogger lacks e-mail/OTP keys (RT-021) | `RedactingLogger` | Add the keys | Mobile engineer |

## 5. Already met (evidence)

| Requirement | Evidence |
|---|---|
| Target API 36, min 26 (Play: API 36 for new apps since 31 Aug 2026) | Flutter defaults `FlutterExtension.kt:23,34`; `minSdk = 26` |
| 16 KB pages (Play; updates blocked from 1 Feb 2027) | arm64 WebRTC and Sentry libs at 0x4000; re-check on the final AAB |
| Xcode 26 / iOS 26 SDK (Apple since 28 Apr 2026) | Xcode 26.6 on the build Mac |
| Release signing never falls back to the debug key | `build.gradle.kts:41-52,123-132` |
| Minimal Android permissions; no `READ_MEDIA_*`; system photo picker | Main and plugin manifests |
| Only `MainActivity` exported; `allowBackup=false`; no cleartext | `AndroidManifest.xml` |
| iOS usage strings for every capability used, in Arabic and English; none unused | `Info.plist:55-69`, `*.lproj` |
| Export compliance key | `ITSAppUsesNonExemptEncryption = false` |
| Privacy manifest present, no tracking | `PrivacyInfo.xcprivacy`, `NSPrivacyTracking=false` |
| No ads, analytics, attribution or tracking SDK; no ATT needed | `pubspec.lock`, SwiftPM, Gradle |
| No secrets in the repository or the binary's build defines | `scan-secrets.sh` clean; `build-store.sh:77-85` |
| Tokens in Keychain/Keystore; local data cleared at sign-out | `secure_token_store.dart:20-26`; `auth_controller.dart:289-297` |
| Auth on every route by default; public routes justified | Global `AuthenticatedGuard` (`auth.module.ts:102`) |
| Signed, re-authorized media links; webhook signatures verified | `media-url.ts:81-135`; `stripe-webhook.controller.ts:52-60` |
| Report a message or person, block enforced on the server everywhere | PD-57 (#463…#482); `platform/blocks.ts` and its specs |
| Parent deletion in the app; bilingual public deletion page | `settings_screen.dart:279`; `account-deletion.controller.ts` |
| No third-party sign-in (Apple 4.8 N/A) | e-mail and password only |
| Release builds cannot run on fixture data | `bootstrap.dart:104` |
| No digital content or feature unlocked by payment; chat never locked | `conversation.controller.ts:237-250`; grep of content modules |
| Play's 12-testers rule does not apply to an Organization account | Play answer/14151465 |
| CI on `main` green | run 42417856955: 15 of 15 jobs |

## 6. Owner decisions and inputs (one list)

Each has a recommendation, so the answer can be yes or no. Engineering continues everything else
meanwhile.

| # | Decision or input | Recommendation | Unblocks |
|---|---|---|---|
| 1 | Approve the engineering organization (`docs/engineering/organization.md`) | Approve | Running the plan with the defined roles |
| 2 | Target audience (N-1/LD-5) | Account holders 18+; not Kids; no child imagery | LR-09, LR-10 |
| 3 | Final Android package name (N-2) | Keep `com.jawwid.jawwid_chat` | LR-07 |
| 4 | Storefronts | Academy markets first; no China; US after age assurance; EU with trader details | LR-17 |
| 5 | Payments: tab wording, one learner per lesson call, Core auto-charge disclosure, trial, live Stripe at launch | Rename to lesson-package wording; guard one learner; disclose; decide trial; your call on Stripe | LR-15, LR-34 |
| 6 | Legal: entity and mailboxes (LD-1), law (LD-2), refunds (LD-4), safeguarding contact (LD-19), final terms texts and versions (N-3), counsel review | Required facts | LR-02, LR-04 |
| 7 | Moderation copy: word list (LD-12), report reasons (N-4), conduct warning | Approve after reading | LR-16 |
| 8 | Staff deletion in the app | Closure request like teachers | LR-20 |
| 9 | Accounts and credentials: Apple Distribution certificate, profile, App Store Connect record; Play Organization account (D-U-N-S), upload key, app; Firebase project; APNs key check; `backup` Environment; `DIGITALOCEAN_APP_ID` and DNS; app Sentry DSN | Required | LR-01, LR-06, LR-07, LR-12, LR-19 |
| 10 | Approvals for High-risk merges: #498, #497 with ENG-11/12, the push port (LR-11) | Approve each after its reviews | LR-02, LR-03, LR-11 |
| 11 | Production deploy | After staging passes | LR-01 |

## 7. Plan

**Wave A: engineering, starts now (no owner input needed to build; High-risk merges wait for the owner).**
- A1 LR-03: review #498; fix the review-cohort and the notes in the same branch.
- A2 LR-02: review #497; build ENG-11 (app terms screen and sign-up acceptance) and ENG-12 (Admin Web).
- A3 LR-11: port the push-acceptance work to a branch and reconcile with #449.
- A4 LR-13, LR-14, LR-26, LR-27: native call fixes (iOS registry at launch; `microphone` only; settings links).
- A5 LR-21, LR-22: store build script (build numbers, production allowlist, required DSN, symbols).
- A6 LR-25, LR-35, LR-37, LR-40, LR-42: small app fixes.
- A7 LR-15 (notes path), LR-30: correct the release documents.
- A8 LR-09, LR-23: draft every console answer, the review notes and the listing copy in both languages.

**Wave B: after the owner's inputs.** LR-01 deploy; LR-04 hosting; LR-05 review accounts; LR-12 VoIP on;
LR-18 RT-037 staging test; LR-19 backups.

**Wave C: release candidate.** Builds from a merged `main` SHA; artifact audit; LR-08 device plan;
security sign-off and the final compliance audit (both on Fable 5.1); the owner uploads to TestFlight and
Play internal testing, then submits.
