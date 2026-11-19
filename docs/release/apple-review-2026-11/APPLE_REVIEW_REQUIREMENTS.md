# Apple's requirements, mapped to the implementation and the evidence

The request: App Review, Guideline 2.1 "Information Needed", for Jawwid iOS 1.0.0 (2). Six items for the App Review
Information Notes, plus preventive reminders for 2.1, 2.3.3, 3.1.1 and 3.2.

The current status of each item is in `FINAL_APPLE_SUBMISSION_CHECKLIST.md`. This file maps each requirement to where
it is met and what proves it.

## The six requested items

| # | Apple asked for | Where it is answered | Implementation and evidence |
|---|---|---|---|
| 1 | A screen recording on a physical iPhone with the latest iOS, from launch: registration, login, account deletion, UGC, report and block, paid content, core functions | `SCREEN_RECORDING_SCRIPT.md` (19 steps, each mapped to an Apple item); `APP_REVIEW_NOTES.md` §B.1 | Every feature in the script exists in build 2 and was exercised by the automated journey (`PHYSICAL_DEVICE_QA.md`). The recording itself needs a person: the iOS update to 27.2.1, the TestFlight install and starting iOS screen recording |
| 2 | App purpose and target audience | `APP_REVIEW_NOTES.md` §A ("WHAT JAWWID IS") and §B.2 | Online Quran and Arabic academy; parents and guardians plus teachers; students take part on a parent's phone and have no accounts (`user_role.dart`; Terms §4); public enrolment on jawwid.com/enroll; not an employee app |
| 3 | Setup and access instructions, with demo credentials for each role | `APP_REVIEW_NOTES.md` §A and §B.3; `REVIEWER_ACCESS.md` | Three review accounts (parent, teacher, deletion test) from `provision-review-cohort`, provisioned in production at `2e41270`. No OTP or verification. Passwords are typed by the owner, never in Git |
| 4 | External services | `EXTERNAL_SERVICES.md`; `APP_REVIEW_NOTES.md` §B.4 | Verified in the code of build 2: own API and sign-in, DigitalOcean, PostgreSQL, Redis, Spaces, LiveKit Cloud, APNs and PushKit, Sentry. Stripe off; no analytics, ads or AI |
| 5 | Regional availability and differences | `REGIONAL_AVAILABILITY.md`; `APP_REVIEW_NOTES.md` §B.5 | No geo-checks in the code; Arabic and English everywhere; worldwide except China mainland (CallKit; ICP) |
| 6 | Regulated industries and protected third-party material | `APP_REVIEW_NOTES.md` §B.6; `EXTERNAL_SERVICES.md` (assets) | Private tutoring, not a regulated category for Apple. Tanzil CC BY 3.0 with attribution; OFL fonts with their licences; CC0 sounds; permissive SDK licences; no Quran audio distributed (not licensed, enforced in code) |

## Preventive guidelines

| Guideline | What Apple expects | Implementation and evidence |
|---|---|---|
| **2.1 Bugs and crashes** | The app works on a device without crashes | Physical iPhone: build, install, launch, stale-session recovery, no crash (`PHYSICAL_DEVICE_QA.md` §3). Full journey on the simulator (§4). Sign-in on the phone against the QA server needs a one-tap Local Network permission |
| **2.1 Accessing the app** | Working demo accounts; nothing blocks access | `REVIEWER_ACCESS.md` §2: e-mail and password only. Production sign-in to be confirmed by `verify-review-logins.sh` (owner) |
| **2.3.3 Screenshots** | Show the app in use, not the sign-in or splash screen | Replacement set produced from the real app, 1206x2622 and 1320x2868, in English and Arabic (`APP_STORE_SCREENSHOTS_AUDIT.md`) |
| **3.1.1 In-app purchase** | Digital content and features must use IAP | Not applicable: only live one-to-one tutoring is sold (3.1.3(d)); nothing digital is sold or unlocked; bank transfer; card paused; review payment mode (AR-F §1) |
| **3.2 Other business models** | Apps for one organization's employees or members belong in Custom or Unlisted distribution | A public consumer academy: public enrolment, prices and free trial on jawwid.com. Accounts are created by the academy after enrolment for child safety. Enrol link on the sign-in screen: PR #613 (needs build 3 = 1.0.0 (4)) |
| **1.2 User-generated content** (part of "report and block") | Filter, report, timely response, block, published contact, and terms with zero tolerance | Report message, report person, block and unblock, My reports, staff moderation within 24 h, word filter, Help and support (`APPLE_REVIEW_AUDIT.md` §1; simulator journey). Terms §7.3 has zero tolerance; the server-side acceptance gate is PR #497 (needs merge + deploy + publication) |
| **5.1.1(v) Account deletion** | Deletion can be started in the app | Settings > Delete account; immediate erasure; documented retention (simulator journey; `REVIEWER_ACCESS.md`) |
| **Children** | Correct age and Kids handling; privacy | Not in the Kids Category; account holders are adults; children have no accounts; privacy label matches the manifest (AR-E §5). Counsel items listed in `REGIONAL_AVAILABILITY.md` §4 |
