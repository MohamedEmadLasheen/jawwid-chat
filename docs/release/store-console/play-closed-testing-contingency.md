# Contingency: Google Play closed test (12 testers, 14 days)

**Release docs, 2026-11-09. Status: contingency, not yet triggered.**

## 1. Why this plan exists

Google requires a **personal** developer account created after 13 November 2023 to run a closed test
with **at least 12 opted-in testers for 14 continuous days** before it can apply for production access.
Organization accounts are generally exempt (`google-play-readiness-2026-11-03.md` D-2;
`google-play-blocker-roadmap-2026-11-03.md` §11.1). The owner decided on an organization account (A-7).

On 2026-11-09 the owner checked the account's Production and Closed-testing task lists (check OT-4b).
**No "12 testers / 14 days" task was shown, but its absence was not proven.** The requirement stays
**UNKNOWN** until the first AAB is uploaded and the Production page is read. This plan exists so that,
if the console shows the requirement at that moment, the closed test starts the same day and costs the
least time possible.

**Verification note.** Google's help pages could not be re-read when this plan was written (no web
access from this machine). The policy facts come from the repository's readings of 2026-11-03. Every
console label, button name and Google question below is **UNVERIFIED** wording: match it to the live
console on the day. Nothing here is a credential or a person.

## 2. How to detect it (owner, Play Console, right after the first upload)

Do this on the day of the first upload to **internal testing** (release plan step 3 in
`google-play-readiness-2026-11-03.md` §6).

1. Open the app in Play Console → **Dashboard**. Read the set-up checklist. A task along the lines of
   "Run a closed test with at least 12 testers for 14 days" or "Apply for production access" means
   the requirement applies. (UNVERIFIED label.)
2. Open **Release → Production**. On an affected account, the page says production is not yet
   available and points to the closed-test requirement, instead of offering "Create new release".
   (UNVERIFIED label.)
3. Open **Release → Testing → Closed testing**. An affected account typically shows a track-level note
   about the requirement and, once a test runs, a counter of opted-in testers and days.
   (UNVERIFIED label.)
4. If none of the three shows the requirement **after** an AAB exists on internal testing, record
   "OT-4b: requirement absent after first upload" in the launch tracker and skip this plan. Production
   proceeds with the staged rollout as planned (§6 step 6 of the readiness review).

Record the outcome either way, with a screenshot of the Production page, in the release tracker
(the launch readiness checklist referenced in `README.md`). The screenshot must not show account
e-mails.

## 3. If it applies: start the closed test the same day

Every step marked **[OWNER, Play Console]** can be done only by the owner; engineering prepares the
rest.

### 3.1 Build

- **The same signed AAB** already uploaded to internal testing. No rebuild, no new version code. Play
  lets a release be **promoted** from internal testing to a closed track. (UNVERIFIED: the exact
  "Promote release" control.)
- It is the release-audited build (roadmap §10, WP-6) with the merged-manifest checks done. If a
  later fix needs a new build during the 14 days, upload it to the **same** closed track with a
  higher version code. Testers stay opted in; the 14-day clock is about tester opt-ins, not about one
  binary. (UNVERIFIED: whether a new release on the track affects the clock. Avoid it unless a blocker
  demands it.)
- The build points at the **production** backend (`scripts/mobile/build-store.sh` refuses test hosts,
  LR-01). Testers therefore use real academy accounts, see §3.3.

### 3.2 Track set-up **[OWNER, Play Console]**

1. Release → Testing → **Closed testing** → create a track (a name such as "Launch closed test" is
   enough) or use the default Alpha track.
2. **Testers tab.** Choose one source:
   - **E-mail list** (recommended): a named list in Play Console, addresses pasted by the owner.
     Simple, no extra Google product, easy to add people on day 2 or 3. Each address must be the
     Google account the tester uses on the phone (the account signed in to the Play Store app).
   - **Google Group**: testers join a group and are opted in by membership. Good if the academy
     already runs a Group; otherwise it adds a step and a second place to manage.
   The two can be mixed. Add **at least 16 to 20 addresses** so that 12 remain after dropouts.
3. **Countries**: at least the countries where the testers are. The listing countries decided under
   LD-15 / LR-17 apply later to production, not to this track.
4. **Promote** the internal-testing release to the closed track and **start the rollout**. The closed
   track needs the store listing, content rating, Data safety and the other App content declarations
   to be **complete**, so finish `README.md` items first; a closed test is also reviewed by Google
   before it goes live, which can take hours to a few days. (UNVERIFIED: the exact review time.)
5. Copy the **opt-in link** from the track's Testers tab (and the Play Store link that appears after
   opt-in). Send both to the testers with the instructions in §3.4.
6. Enter the review-account credentials in **App content → App access** and in **Pre-launch report →
   Credentials** if not already done (`play-declarations.md` §2). The pre-launch report runs on every
   track upload.

### 3.3 Tester source (owner decides who; engineering prepares nothing new)

- **Who**: academy staff (supervisors, operations, teachers) and families the owner already knows and
  has asked. These are real users with real academy accounts, so they can use the app normally. No
  one outside the academy's own community is needed.
- **No fake accounts.** Each tester uses their own Google account for the opt-in and their own
  Jawwid account in the app. Do not create Google accounts for the test, do not share one Google
  account across phones, and do not sign testers into the review accounts
  (`docs/release/review-accounts.md`): those are for Google's reviewers only.
- **Device**: an Android phone (Android 8 or later; the app's `minSdk` is 26) signed in to the Play
  Store with the e-mail that was added to the list.
- **Target**: 16 to 20 invited, so that **12 or more stay opted in on every one of the 14 days**.
- **Consent and privacy**: testers are told that this is a pre-release build on the production
  backend, that Sentry crash reports are collected as described in the privacy policy, and that
  their usage is the same as it will be at launch. No tester list, name or e-mail goes into this
  repository, a ticket or a chat log.

### 3.4 What a tester must do (text the owner can send, in Arabic and English)

1. On the phone, open the **opt-in link** with the Google account named in the invitation and tap
   **Become a tester**.
2. Open the Play Store link that follows and **install Jawwid** from Google Play (not from a shared
   APK). If the app is already installed from another source, uninstall it first.
3. **Sign in with your own Jawwid account** and use the app as you normally would during the 14 days:
   read and send messages, join your lessons, make or take a call, open the schedule. There is no
   script; real use is the point.
4. **Stay opted in and keep the app installed** for the full 14 days. Leaving the test, uninstalling,
   or removing the Google account from the phone reduces the count.
5. Report any problem to the academy's support contact ({{SUPPORT_EMAIL}} from `README.md` item 14).
   Describe what happened and when; never send a password or a screenshot with another family's
   messages.

### 3.5 Day-by-day timeline

Day 0 is the day the requirement is detected (the first-upload day).

| Day | Owner, Play Console | Owner, people | Engineering |
|---|---|---|---|
| 0 | Detect (§2). Create the track, tester list, promote the AAB, start rollout. Copy the opt-in link. | Send invitations to 16 to 20 staff and families with the §3.4 text. | Confirm which build (SHA, version code) is on the track; note it in the tracker. |
| 1 | Check the track is live (Google's closed-test review done). Read the opted-in count. | Chase everyone who has not opted in. | Watch Sentry and the pre-launch report for crashes on the track build. |
| 2 | Opted-in count must be **12 or more** today. If not, add more addresses and invite again. The 14 days are counted from when the count is at least 12 and stays there. | Add testers until 12 or more are in. | Triage any tester report; fix only blockers. |
| 3 to 13 | **Every day:** read the opted-in count on the Testers tab and write the date and count in the tracker. If it drops below 12, add testers the same day. | Short weekly check-in with testers: are they still using the app? | Collect feedback into a short list (what testers said, what was changed) for the application in §4. |
| 14 | Confirm 14 consecutive days at 12 or more. Take a screenshot of the counter. | Thank the testers; tell them the app stays installed and keeps working. | Prepare the answers in §4 with the owner. |
| 15 | **Apply for production access** (§4). | | |
| 15 to ~22 | Wait for Google's answer (typically days; UNVERIFIED). If refused, read the reason, fix, and reapply; the 14 days may restart. | | Fix anything Google names. |
| after approval | Production release, staged rollout (readiness review §6 step 6). | | Monitor crash-free sessions. |

**What to track, daily, in the launch tracker:** date; opted-in tester count; whether 12 or more; any
tester added or lost; crashes on the track build; the day counter the console shows (if it shows one).
A day below 12 is treated as resetting the clock until proven otherwise (UNVERIFIED: Google's exact
reset rule; the readiness review D-2 says "the 14 days restart").

## 4. Applying for production access **[OWNER, Play Console]**

After the 14 days, the Production page offers an application form (UNVERIFIED label: "Apply for
production access"). From Google's published description, the form asks about the closed test in
general terms. Prepare plain, true answers on these topics; do not invent numbers:

- **About the test**: how many testers took part, how they were recruited, how long the test ran,
  and whether the testers represent the app's real audience (families and staff of the academy).
- **About the feedback**: what the testers reported, what problems were found, and what was changed
  in the app as a result. Keep the §3.5 feedback list for this.
- **About readiness**: why the app is now ready for production, how the academy will support users
  after launch, and how feedback will be collected afterwards (the support contact, in-app reporting).
- **About the app**: a short description of what it does and who it is for, consistent with the
  listing (`listing-copy.md`) and the App content declarations (`play-declarations.md` §1).

Google's reviewers read the answers together with the test data they already hold. Answers are
reviewed by a person, and the response can take several days (UNVERIFIED). If the application is
refused, Google gives a reason and the test can be continued or repeated and a new application filed.
Treat a refusal as a 14-day cost in the plan, not a stop.

## 5. Effect on the launch date

- **Internal testing and the device plan are unchanged**; they run in parallel with the closed test.
- If the requirement applies, **Android production moves by about 3 weeks** from the first-upload
  day: 1 to 2 days to get 12 testers opted in, 14 days of test, then Google's review of the
  application (several days). A refusal adds another 14 days.
- **iOS is not affected.** The App Store submission can proceed on its own schedule, with the
  understanding that the two stores may launch apart. Whether to hold iOS for a joint launch is an
  owner decision, not an engineering one.
- The **closed test is not wasted time**: the pre-launch report and the testers' real use on the
  production backend give the LR-08 device plan a second set of phones, and any crash shows up in
  Sentry before the public release.

## 6. Decision record

- If the organization account is confirmed and Production is available after the first upload: close
  OT-4b as "not applicable" and do nothing from this plan.
- If the requirement is shown: this plan starts the same day; the owner records the start date and the
  tester source in the tracker; the launch date moves as in §5.
- Open question for the owner on day 0 only: tester list by **e-mail list** (recommended) or
  **Google Group**. Nothing else in this plan needs an owner decision beyond doing the Play Console
  steps.

## 7. Related documents

- `docs/release/google-play-readiness-2026-11-03.md`: D-2 (account type), §6 (release order).
- `docs/release/google-play-blocker-roadmap-2026-11-03.md`: §10 (release audit), §11 (organization
  account checklist), §14 (Google's source pages, read 2026-11-03).
- `docs/release/store-console/README.md`, `play-declarations.md`, `listing-copy.md`: what must be
  complete before any track goes live.
- `docs/release/review-accounts.md`: reviewer credentials, not for testers.
- `docs/qa/submission-device-test-plan.md` §12: the first signed build run sheet.
