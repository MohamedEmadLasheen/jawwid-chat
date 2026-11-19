# Final submission checklist: Apple 2.1 "Information Needed" (2026-11-19)

Statuses:
- **VERIFIED**: tested, with evidence.
- **COMPLETED**: done; awaits an external check.
- **BLOCKED**: needs a human or external action. The owner is named.
- **NOT APPLICABLE**: with the reason.
- **FAILED**: not satisfied.

## A. Apple's six requested items

| # | Item | Status | Evidence / what remains |
|---|---|---|---|
| 1 | Screen recording on a physical iPhone with the latest iOS | **BLOCKED (owner, on the phone)** | Script ready (`SCREEN_RECORDING_SCRIPT.md`). Remaining: update the phone to iOS 27.2.1; install build 2 from TestFlight; record (about 8 min); then re-run the Review cohort workflow to restore `parent2` |
| 2 | App purpose and audience | **COMPLETED** | `APP_REVIEW_NOTES.md` §A and §B.2. Owner confirms where lessons take place (in the app or on Zoom, §C) |
| 3 | Setup, access and demo credentials | **COMPLETED** (text) / **BLOCKED** (owner check of the logins) | `REVIEWER_ACCESS.md`; the owner runs `verify-review-logins.sh` (3 x OK) and types the passwords in App Store Connect |
| 4 | External services | **COMPLETED** | `EXTERNAL_SERVICES.md` (checked in the build-2 code) |
| 5 | Regional availability | **COMPLETED** | `REGIONAL_AVAILABILITY.md`. The owner unticks China mainland and completes the EU DSA trader details |
| 6 | Regulated industries and third-party material | **COMPLETED** | `APP_REVIEW_NOTES.md` §B.6; licences verified (AR-E §2) |

## B. Preventive guidelines

| Guideline | Status | Evidence / what remains |
|---|---|---|
| 2.1 Crashes and bugs: physical device | **VERIFIED (partial)** | Built, installed and launched on the iPhone 16 Pro Max (iOS 27.0.1); stale-session recovery; no crash. Sign-in against the QA server needs a one-tap Local Network "Allow" on the phone (`PHYSICAL_DEVICE_QA.md` §3) |
| 2.1 Crashes and bugs: full journey | **VERIFIED (simulator)** | 21 steps passed on a fresh install: sign-in, wrong password, chats, message, report, block, unblock, My reports, sign-out, deletion, sign-in refused after deletion (`PHYSICAL_DEVICE_QA.md` §4) |
| 2.1 Accessing the app | **COMPLETED** | No OTP, verification or 2FA; cohort provisioned in production at `2e41270`. Production sign-in check = owner command |
| 2.3.3 Screenshots | **COMPLETED** | Replacement set: 1206x2622 and 1320x2868, in English and Arabic (`APP_STORE_SCREENSHOTS_AUDIT.md`). The owner uploads them and removes any sign-in screenshot |
| 3.1.1 In-app purchase | **NOT APPLICABLE** | 3.1.3(d) person-to-person live tutoring; nothing digital sold or unlocked; no StoreKit; card paused; review payment mode |
| 3.2 Business model | **COMPLETED** (response) / **BLOCKED** (build 3) | Public enrolment framing in the notes. Enrol link on the sign-in screen: PR #613 (30/30 CI), ships only in build 3 (owner approval). Fallback if Apple insists: Unlisted distribution |
| 1.2 Report, block, filter, moderation, contact | **VERIFIED** (report, block, unblock, My reports on the simulator) / **COMPLETED** (staff queue, filter: code) | `PHYSICAL_DEVICE_QA.md` S-8 to S-15 |
| 1.2 Terms with zero tolerance, accepted by users | **COMPLETED** (code) / **BLOCKED** (owner) | Terms §7.3 has zero tolerance. PR #497 is updated and mergeable (head `6a6f1556`, 30/30 CI). Owner: publish the legal versions, merge #497, deploy. No new iOS build needed |
| 5.1.1(v) Account deletion | **VERIFIED (simulator)** | S-17 to S-22: deletion; API 200; sign-in refused; database erased ("Deleted user") |
| Children and privacy | **COMPLETED** | No Kids Category; adult account holders; children have no accounts; the label matches the manifest. Counsel items listed (not blockers) |

## C. Governance and safety

| Check | Status |
|---|---|
| No production writes, deploys or migrations by the agent | **VERIFIED**: production was only read (health endpoint, workflow lists, variable names) |
| No protected project touched (Jawwid Core and others) | **VERIFIED** |
| No merge to `main`; no build uploaded; no resubmission | **VERIFIED** |
| No secret in Git | **VERIFIED**: passwords and the domain appear only as placeholders. The local QA passwords are fictional and stay in `~/jawwid-evidence` (mode 700) |
| Code changes have tests and green CI | **VERIFIED**: PR #613 (5 new tests; 30/30 checks); PR #497 (30/30 checks) |

## D. Owner actions, in order

1. **Clean jawwid.com** (injected casino links; `APPLE_REVIEW_AUDIT.md` F-1). Until then, leave the Marketing URL
   empty.
2. **Confirm where lessons take place** (in the app or on Zoom). If on Zoom, tell the lead and the texts will be
   changed.
3. **PR #497 (Terms gate):** publish the four legal versions in production, merge #497, then deploy (production
   approval).
4. **Decide build 3:** merge PR #613 (enrol link) and approve the upload of 1.0.0 (3). Recommended. Alternatively,
   keep build 2 and skip recording step 2.
5. **On the phone:** update to iOS 27.2.1 > install the build under review from TestFlight > record following
   `SCREEN_RECORDING_SCRIPT.md`.
6. **Re-run the Review cohort workflow** (restores `parent2` after the recording) > run
   `bash ~/jawwid-orchestrator/bin/verify-review-logins.sh` and expect 3 x OK.
7. **App Store Connect:**
   - Pricing and Availability: all countries except China mainland. EU DSA trader details.
   - Upload the screenshots. Remove any sign-in screenshot.
   - App Review Information: Sign-In (parent), Notes = `APP_REVIEW_NOTES.md` §A with the placeholders filled.
   - Reply in App Review with §B and attach the recording.
8. Resubmit (owner's final approval).
