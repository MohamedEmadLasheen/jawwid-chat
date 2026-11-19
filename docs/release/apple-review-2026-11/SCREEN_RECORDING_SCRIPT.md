# Screen recording script: physical iPhone, for App Review (Guideline 2.1, item 1)

Apple asked for a recording made on a **physical iPhone running the latest iOS**. It must start at app launch and
show: registration, login, account deletion, user-generated content, reporting and blocking, paid content (if
any), and the core functionality.

**Who does this:** the owner, holding the phone. iOS screen recording can only be started on the phone itself.
Tapping in the TestFlight app and the passcode also need a person. Everything else is prepared.
**Duration:** about 6 to 8 minutes. **Language:** English (Apple reviews in English); one short Arabic segment is
optional.

## 0. Before recording (once, about 20 minutes)

| # | Step | Done when |
|---|---|---|
| 0.1 | **Update the iPhone to the latest iOS.** It runs iOS 27.0.1 today; the latest public release is **iOS 27.2.1** (2026-11-09). Settings > General > Software Update | Settings > General > About shows the latest version. Write it in the reply (`{{IOS_VERSION}}`) |
| 0.2 | Delete the old **developer build** "Jawwid Chat" (1.0.0 build 1) from the phone: long-press the icon > Remove App > Delete App | The icon is gone |
| 0.3 | Install the **build under review** from **TestFlight**. Today that is 1.0.0 (2); with the owner's approval the recommended build is **1.0.0 (4)** ("build 3": main + the enrol link); select the same build in App Store Connect | TestFlight shows the installed build number |
| 0.4 | Second device for the call: a second iPhone, an iPad, or an iOS Simulator on the Mac with the same build. Sign it in as the **teacher** review account and leave the app open on the family group | It shows the "Yahya" group |
| 0.5 | Check the three logins: `bash ~/jawwid-orchestrator/bin/verify-review-logins.sh` (prints only OK or FAIL) | Three lines say OK |
| 0.6 | Phone: Focus on Do Not Disturb (no personal notifications during the recording); brightness up; English language (Settings > General > Language & Region), or switch the app to English in Settings > Language during the recording | — |
| 0.7 | Add **Screen Recording** to Control Center (Settings > Control Center). Microphone off, unless you narrate | The button is there |

Use **only** the review accounts. Never show a real family, a real teacher, a password manager or a notification
from a real person.

## 1. The recording (one continuous take)

Start Screen Recording from Control Center, wait for the 3-second countdown, then:

| # | Do | Apple item shown |
|---|---|---|
| 1 | From the Home Screen, tap **Jawwid**. The launch screen appears, then the sign-in screen | Launch |
| 2 | Pause 2 s on the sign-in screen. (Build 1.0.0 (4) only:) tap **New to Jawwid? Enrol your child**: Safari opens jawwid.com/enroll; scroll once; return to the app | Public enrolment (3.2) |
| 3 | Tap **New parent? Create your account**: show the screen asking for the e-mail the academy has and the one-time code. Do not submit. Go back | Registration |
| 4 | Sign in as the **parent** review account (e-mail, password, **Sign in**). If iOS asks for notifications, tap **Allow** | Login |
| 5 | Show the tabs: **Chats**, **Calls**, **Packages**, **Settings** (tap each, 2 s each) | Core navigation |
| 6 | Chats > open the **Yahya** family group. Type "Hello, this is a test message." > Send | UGC: text |
| 7 | Attach a photo (paperclip > Photo; any neutral picture, for example a sky) > Send. Hold the microphone 3 s for a voice note > release | UGC: media and voice |
| 8 | **Call:** tap the phone icon at the top of the group. The second device (teacher) rings; answer there. Talk 5 s; show the call screen; hang up. (This is the app's communication call, **not a lesson**) | Core: voice call |
| 8a | **Lessons are on Zoom:** tap the group title (Group info) and show **Lesson days and times** for Yahya. Lessons themselves take place on Zoom, outside the app. If you narrate, say: "Lessons happen on Zoom; here the family and teacher coordinate the schedule and follow progress." Do not open Zoom in the recording | Core function, lesson workflow |
| 9 | **Report a message:** long-press the teacher's message "Hello! I look forward to our lessons together." > **Report** > choose a reason > **Send report** > the thank-you sheet | Report content |
| 10 | **Report and block a person:** tap the group title > members > the **flag** icon on Hassan Mourad's row (show the reasons; Cancel) > the **block** icon on his row > read the dialog > **Block** > the "is blocked" message | Report a user; block a user |
| 11 | Back to the chat: Hassan's messages now show as hidden. Settings > **Blocked people** shows Hassan > **Unblock** > confirm | Block and unblock |
| 12 | Settings > **My reports**: the report shows "Received" | Report follow-up |
| 13 | **Packages** tab > **Amount due** > the demo lesson package > **Pay**: show the demo bank details and that no receipt can be sent. Close | Paid content: none digital; 3.1.3(d) |
| 14 | Settings: show **Language**, **Help and support** and **Contact support**, and the **Privacy policy** and **Terms** links | Support and legal |
| 15 | Settings > **Sign out** > confirm | Logout |
| 16 | Sign in as the **deletion-test** account (parent2) | Login (second account) |
| 17 | Settings > **Delete account**: read the screen (what is deleted and what is kept) > enter the password > **Delete my account** > confirm **Delete** | Account deletion |
| 18 | The app returns to the sign-in screen. Try to sign in again as parent2: refused | Deletion is effective |
| 19 | Stop the recording (Control Center, or the red status-bar pill) | — |

The recording is saved in Photos.

## 2. After recording (in this order)

| # | Step | Why |
|---|---|---|
| 2.1 | Watch the whole video once. Check that no real person, password or personal notification appears. If one does, record again | Privacy |
| 2.2 | AirDrop the video to the Mac and save it to `~/jawwid-evidence/apple-review-2026-11-19/recording/` (outside Git) | Evidence |
| 2.3 | **Re-create the deletion-test account:** run the **Review cohort** workflow again (GitHub > Actions > Review cohort > Run workflow, with the same image tag and domain as before). The production environment needs the owner's approval | Step 17 deleted it, and App Review needs it |
| 2.4 | Run `verify-review-logins.sh` again: three times OK | Proves the accounts are ready for App Review |
| 2.5 | In App Store Connect, reply in App Review with `APP_REVIEW_NOTES.md` §B and attach the video (or a private link). Paste §A into App Review Information > Notes | Apple's request |

## Note: Local Network permission

The TestFlight build talks to `https://api.chat.jawwid.com` over the internet. It never asks for Local Network
permission. That prompt appeared only in the agent's QA builds, which pointed at a test server on the Mac's network.
If the prompt ever appears, tap **Allow**; it does not affect the recording.

## 3. If something goes wrong during the take

| Problem | Do |
|---|---|
| Sign-in says the account is locked | Wait 15 minutes, or re-run the Review cohort workflow (it clears lockouts) |
| The second device does not ring | Keep the teacher app open in the foreground on the family group. Ringing with the app closed needs VoIP, which is off in production |
| Block is refused ("can't be blocked") | You tapped a manager or supervisor. Only the teacher is blockable in the demo |
| A system dialog appears (notifications, microphone, photos) | Allow it; it belongs in the recording |
