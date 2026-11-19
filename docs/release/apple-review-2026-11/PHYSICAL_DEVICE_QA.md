# Physical-device QA (Apple 2.1: bugs, crashes, access)

**Date:** 2026-11-19. **Tester:** engineering lead (Claude). Evidence folder (local, not in Git):
`~/jawwid-evidence/apple-review-2026-11-19/`.

## 1. Device

| Item | Value | Source |
|---|---|---|
| Device | iPhone 16 Pro Max (iPhone17,2), name "iPhone Mohamed" | `xcrun devicectl device info details` |
| iOS | **27.0.1** (24A446). Latest public release is **27.2.1** (2026-11-09), so **the phone needs updating before the Apple recording** | devicectl; Apple developer releases |
| Developer Mode | Enabled | devicectl |
| Connection | Wireless (CoreDevice tunnel); paired; passcode set | devicectl |
| App installed before testing | "Jawwid Chat" 1.0.0 (1), a **developer** build (`builtByDeveloper: true`), not TestFlight | `devicectl device info apps` |

## 2. Build under test

| Build | What it is | Used for |
|---|---|---|
| **1.0.0 (2)**, App Store Connect / TestFlight | The submitted binary: release run 44285965671, `main` @ `2e4127015`, cloud-signed | **Not installed by the agent.** TestFlight installs need a person on the phone. Used in the recording (`SCREEN_RECORDING_SCRIPT.md`) |
| Developer build of `2e4127015` (profile mode) | The same source, signed for development, built on the phone with the QA harness (`flutter drive`) | Physical-device automation (§3) |
| Debug build of `2e4127015`, iPhone 17 Pro simulator (iOS 26.5) | The same source | Full functional journey (§4) and App Store screenshots |

All automated runs used an **isolated local backend**:
- Containers `ar-pg` and `ar-redis`, and the real API and worker, at `2e4127015`.
- Data from the **real** `provision-review-cohort` command, so the same fictional review people and data as production.
- **Production was not used for any write.**

## 3. Physical iPhone results

| # | Test | Result | Evidence |
|---|---|---|---|
| P-1 | Build the app for the phone (Xcode 26.6, development signing, team KX683HAR3Y) | **PASS**: built in 99.8 s, then 58.3 s | `device-run-1.log`, `device-run-2.log` |
| P-2 | Install and launch on the phone | **PASS**: installed and launched over the wireless connection (18.5 s) | Same |
| P-3 | Cold launch with a stale stored session (the old build's keychain) | **PASS**: the app called `GET /me` (401) and `POST /auth/refresh` (401), dropped the dead session and showed the sign-in screen. No crash and no blank screen | Local API log 11:01:39Z; QA step `launch-sign-in` OK (1.5 s) |
| P-4 | Sign-in screen renders | **PASS** | QA step `launch-sign-in` OK |
| P-5 | Sign in against the local test server | **BLOCKED (human)**: no request reached the server. iOS's **Local Network** permission controls an app's access to a LAN address; it needs a tap on the phone ("Allow"), or Settings > Privacy & Security > Local Network > Jawwid Chat. This affects only the QA set-up (a LAN server): the production app talks to `https://api.chat.jawwid.com`, which needs no such permission | `device-run-2.log`; empty connection table on `:3555` |
| P-6 | Behaviour when the server cannot be reached | **No crash observed**: the app kept running for the rest of the run (later steps kept executing and the test isolate stayed alive). The screen itself was not captured on the phone, because driver screenshots do not work there. (QA step `wrong-password-refused` passed only because nothing signed in; it was not a real wrong-password check on the phone. That check passed on the simulator, §4) | `device-run-2.log` |

**What a person must do to finish the physical-device runs:** unlock the phone, open Jawwid Chat once and tap
**Allow** on "Jawwid Chat would like to find and connect to devices on your local network". Or turn it on in Settings
> Privacy & Security > Local Network. The same harness then runs the whole journey on the phone:
`flutter drive --profile -d 00008140-000128490A88801C ...` (the command is in `device-run-*.log`). Independently of
this, the **Apple recording** (`SCREEN_RECORDING_SCRIPT.md`) is the definitive physical-device run, on the TestFlight
build against production.

## 4. Simulator functional journey (same source, same fictional data)

**Set-up for every run:**
- iPhone 17 Pro simulator, iOS 26.5, 1206 x 2622, debug build of `2e4127015`.
- The simulator is **erased before each run**, so each run is a fresh install with an empty keychain.
- The real API at `2e4127015` on an isolated database seeded by the real `provision-review-cohort`.
- Each step asserts on the real UI. The host captures the real screen with `xcrun simctl io screenshot`.

**Evidence:** `~/jawwid-evidence/apple-review-2026-11-19/sim-journey-attempt5/` (parent journey, 15 screens) and
`sim-deletion/` (deletion). Attempts 1 to 4 fixed the harness, not the app (finders, a slow location prompt, tab
detection); their folders are kept.

| # | Step | Result | Evidence and notes |
|---|---|---|---|
| S-1 | Fresh install > launch > sign-in screen | **PASS** | `01-launch-sign-in.png` |
| S-2 | Wrong password refused | **PASS**: stays signed out; API `POST /auth/login` 401 | `02-*`; API log |
| S-3 | Sign in as the review parent (e-mail and password, no code) | **PASS** | `03-*` |
| S-4 | First-sign-in prompts | "Where does the family live?" (Save / **Later**) appears once after sign-in, and iOS asks for notifications. Both dismissable; the notes tell the reviewer | `sim-journey-attempt1/17-*` shows the prompt |
| S-5 | Chats list shows the family group | **PASS** | `04-*` |
| S-6 | Open the "Yahya" family group; seeded messages from the supervisor and the teacher | **PASS** | `05-*` |
| S-7 | Send a text message | **PASS**: it appears in the thread | `06-*` |
| S-8 | Long-press a message > **Report** > reasons sheet | **PASS** (the teacher's message in attempts 1-2; the supervisor's in attempt 5) | `07-*` |
| S-9 | Choose "Harassment or bullying" > **Send report** | **PASS**: the sheet closes; API `POST /api/v1/reports` 201 (12:19:19Z) | `08-*` |
| S-10 | Group title > Group info > Members, with flag (report) and block icons per member | **PASS** | `09-*`, `10-group-members-report-block-icons.png` |
| S-11 | Block the teacher > the confirmation explains the effects > **Block** > "is blocked" | **PASS**: API `POST /api/v1/me/blocks` 201 (12:19:56Z) | `11-*`, `12-*` (the row now shows unblock) |
| S-12 | Settings > **Blocked people** lists the teacher | **PASS** | `13-*` |
| S-13 | **Unblock** > "No one is blocked" | **PASS**: API `DELETE /api/v1/me/blocks/:id` 204 (12:20:36Z) | `14-*` |
| S-14 | Settings > **My reports** shows the report as "Received" | **PASS**: API `GET /api/v1/me/reports` 200 (12:21:09Z) | Asserted on screen; `15-*` was taken after going back |
| S-15 | Settings rows: Privacy policy, Terms of use, Help and support, Contact support (`info@jawwid.com`), Delete account, Sign out | **PASS** (seen) | `sim-journey-attempt4/15-settings-my-reports-FAILED.png` (the failure was the harness scrolling the wrong way; the screen shows these rows) |
| S-16 | Sign out | **PASS** (attempts 1-4) | `sim-journey-attempt4/16-parent-sign-out.png` |
| S-17 | Sign in as the deletion-test parent | **PASS** | `sim-deletion/02-*` |
| S-18 | Settings > **Delete account** screen: what is deleted and what is kept, password field | **PASS** | `sim-deletion/03-*` |
| S-19 | Password > **Delete my account** > confirmation "Delete your account for good? This cannot be undone." | **PASS** | `sim-deletion/04-*` |
| S-20 | Confirm > deleted and signed out (sign-in screen) | **PASS**: API `POST /me/account/delete` 200 (12:30:12Z) | `sim-deletion/05-*`; API log |
| S-21 | The deleted account cannot sign in again | **PASS**: API `POST /auth/login` 401 (12:30:20Z) | `sim-deletion/06-*` |
| S-22 | Database after deletion | **PASS**: the login subject became `erased:<id>` with `is_active = false`; the contact name became "Deleted user"; the other two accounts are unchanged | `psql` on the local QA database |

**Not exercised by automation, and why:**

| Item | Why | Covered by |
|---|---|---|
| Voice call | Needs LiveKit and two signed-in devices; the local stack has no LiveKit | The recording (step 8) with production LiveKit; owner device |
| Photo and voice-note sending | Needs a picker and microphone input on a device | The recording (step 7) |
| Push notification delivery | Needs APNs with a signed build | The recording and TestFlight |
| Packages > Pay (review payment mode) | Not driven. AR-F verified the server rule in code (`billing.service.ts:731`) | The recording (step 13) |

No crash, freeze or blank screen occurred in any run. Every failure seen was a harness finder issue and was fixed.

## 5. Other checks

| Check | Result | Evidence |
|---|---|---|
| Production API health | 200 (`https://api.chat.jawwid.com/health`, 2026-11-19) | curl |
| Reviewer logins in production | **BLOCKED (owner, one command):** `bin/verify-review-logins.sh`. Self-tested on the local cohort: 3/3 OK, sessions signed out | `REVIEWER_ACCESS.md` |
| Crash reports for build 2 | Not read: Sentry and App Store Connect need the owner's sign-in | — |
| Automated tests at `2e4127015` | CI on `main` green at merge. The changes made here were tested: PR #613 (30/30 checks) and PR #497 (30/30 checks; API unit 2897, integration 213, guards 23/23, Flutter legal 43) | GitHub checks |
| Microphone denied | Not run on the device. The handling (LR-26) is in PR #554, not merged | AR-D §5 |
| Notification permission denied | The app works without it; calls still ring through PushKit and CallKit when VoIP is on (`AppDelegate.swift:170-176`). Not run on the device | Code |
