# App Review response: Guideline 2.1 "Information Needed" (Jawwid, iOS 1.0.0 build 2)

Written 2026-11-19 from the code of the submitted build (`main` @ `2e4127015`), production as observed on
2026-11-19, the audits `reports/AR-{C,D,E,F}-*.md`, and the physical-iPhone run in `PHYSICAL_DEVICE_QA.md`.

Two texts:
- **§A, App Review Information > Notes** (limit 4000 **bytes**; plain ASCII on purpose). Paste it after the owner
  replaces the `{{...}}` placeholders. Placeholders are typed only in App Store Connect, never in this repository.
- **§B, Reply in App Review (Resolution Center)**, the full answer to the six questions. Attach the screen recording
  to this reply, or give a private link to it (`SCREEN_RECORDING_SCRIPT.md`).

**Before pasting, check these (owner):**

| # | Check | Why |
|---|---|---|
| 1 | All three review logins pass `bin/verify-review-logins.sh` | Proves the credentials work |
| 2 | Is the review login domain hard to guess? | Ten wrong passwords lock an account for 15 minutes |
| 3 | Lessons happen in the app, not on Zoom (see §C) | The response says so |
| 4 | jawwid.com is cleaned of the injected casino links (see `APPLE_REVIEW_AUDIT.md` F-1), or the Marketing URL is left empty | The response points Apple at the site |
| 5 | China mainland is unticked in Pricing and Availability | CallKit; no ICP filing (`REGIONAL_AVAILABILITY.md`) |

---

## A. App Review Information > Notes (paste; 3793 bytes with the placeholders, all ASCII; fact-checked against the code, `reports/AR-G-notes-factcheck.md`)

<!-- NOTES-START -->
```text
WHAT JAWWID IS: the communication and coordination app of Jawwid Academy, an online Quran and Arabic school open to the public worldwide, for students, their parents and their teachers. Families enrol on our public website (https://jawwid.com/enroll/: free trial, public prices); the academy then creates the parent's account, activated in the app with a one-time code. No anonymous sign-up, because the app connects children's families with teachers. Live one-to-one lessons take place on Zoom, outside this app; the app does not host, embed or link to them. In the app the family, the teacher and the academy talk, coordinate the schedule and follow progress. Account holders are adults (parents, teachers, a few academy staff); students use it with a parent. Not an employee-only app.

SIGN-IN: e-mail in the Username field, then the password. No code or e-mail check. Arabic or English follows the phone (Settings > Language). After sign-in: "Before you continue" shows our Terms of Use (zero tolerance for objectionable content or abusive users): tick and tap Agree. Then the app asks once where the family lives: pick a country or tap Later. All people and data are fictional, in a review-only organization.

ACCOUNTS
1. Parent (Sign-In Information above): Mariam Adel, mother of Yahya. Family group with his teacher and supervisor, a direct chat with the supervisor, lessons, Packages.
2. Teacher: teacher@{{REVIEW_DOMAIN}} / {{REVIEW_TEACHER_PASSWORD}} (Hassan Mourad, Yahya's teacher).
3. Deletion test: parent2@{{REVIEW_DOMAIN}} / {{REVIEW_DELETION_PARENT_PASSWORD}} (separate fictional family). Please use it to test deletion.

MAIN FEATURES: parent tabs Chats, Calls, Packages, Settings. Chats > "Yahya" family group: text, photos, files, voice notes. Voice calls (not lessons; voice only, never recorded): sign in as the parent on one device and the teacher on another, open the family group and tap the phone icon; the other device rings while the app is open.

REPORT AND BLOCK (Guideline 1.2): long-press a message > Report > reason > Send report. Tap the group title > flag icon on a member to report the person, or the block icon to block them (their messages are hidden; they cannot message or call you). Settings > Blocked people (unblock) and Settings > My reports (status). In production reports go to named academy moderators; unhandled ones escalate after 18 and 24 hours, child-safety reports at once. The review organization has no real staff, so a review report stays "Received". A word filter screens text. Support: Settings > Help and support.

ACCOUNT DELETION: Settings > Delete account > password > Delete my account > confirm. Immediate and permanent; the user is signed out. Deleted: name (shown as "Deleted user"), photo, contact details, password, sessions, notifications. Kept: payment records (7 years, legal duty), sent messages as "Deleted user", the child's academy records. Backups up to 56 days.

PAYMENTS (3.1.3(d) and (e)): the academy sells only live one-to-one lessons (one teacher, one student, real time on Zoom, outside the app). No digital content or app feature is sold. Parents pay lesson packages by bank transfer (card payment exists but is switched off). For the review family our server disables payment: Packages tab > Amount due shows a demo package with demo bank details; no receipt can be sent and no charge is possible.

SERVICES: our own API and sign-in (DigitalOcean, Frankfurt; PostgreSQL), LiveKit Cloud (call audio), Apple Push Notification service, Sentry (crash reports). No analytics, ads or tracking.

REGIONS: same features worldwide, Arabic and English. Not offered in China mainland (CallKit; no ICP filing).

The answers to the six questions and a screen recording from a physical iPhone are in our App Review reply.
```
<!-- NOTES-END -->

Check the byte count with §D after filling the placeholders; it must stay under 4000 (about 3,750 with a 30-character domain and 20-character passwords).

---

## B. Reply in App Review (Resolution Center)

```text
Hello App Review,

Thank you for your questions. Our answers to the six points are below, and a screen recording from a physical iPhone (iOS {{IOS_VERSION}}) is attached.

1. SCREEN RECORDING
The attached recording ({{RECORDING_FILE_OR_LINK}}) was captured on an iPhone 16 Pro Max running iOS {{IOS_VERSION}} with build {{BUILD}}. It shows, in order: launching the app; the sign-in screen and how a new parent activates an account the academy created ("New parent? Create your account"); sign-in with the review parent account; the tabs; the family group, sending a message, a photo and a voice note; a voice call between the parent and the teacher (second device; this is the app's communication call, not a lesson); the child's lesson schedule (the lessons themselves happen on Zoom, outside the app); reporting a message, reporting a person, blocking and unblocking a person, and the "My reports" and "Blocked people" screens; the Packages tab with the demo lesson package (no charge possible); Settings with language, help and support, privacy policy and terms; and deleting the deletion-test account, after which it can no longer sign in.

2. APP PURPOSE AND AUDIENCE
Jawwid Chat is the educational communication and coordination app of Jawwid Academy, an online school that teaches the Quran, Arabic and Islamic studies to students, mostly children, through live one-to-one lessons with a teacher. The lessons themselves take place on Zoom, outside the app; the app does not host, embed or link to them. The academy serves families in many countries, and anyone can enrol through our public website (https://jawwid.com/enroll/), which offers a free trial lesson and shows our prices.
The app is how a family and the academy work together after enrolment:
- Parents and guardians see their child's lesson schedule, talk with the child's teacher and supervisor in a family group (text, photos, files, voice notes), receive lesson reports and academy announcements, make voice calls to the teacher and the academy, and pay for lesson packages.
- Teachers talk with their students' families in the same groups, see their teaching schedule, prepare lesson boards, and write lesson reports after each Zoom lesson.
- Students use the app with their parent, on the parent's phone: they see their progress, rewards and learning activities. Students do not have their own accounts; all accounts belong to adults.
The problem it solves: around online lessons, families, teachers and the school otherwise coordinate over personal messaging apps with no oversight and no lesson record. Jawwid gives each student's family one supervised place for the conversation with the teacher, the schedule, lesson reports, progress and payments. A teacher and a parent never have a direct one-to-one chat: they talk in the family group, where an academy supervisor is also a member.
It is not an internal or employee-only app. The academy's customers are members of the public who enrol their children. Accounts are created by the academy after enrolment rather than by an open sign-up form, because the app connects children's families with teachers, so every account holder must be an enrolled family or someone the academy engaged. Most academy staff work in a separate web portal; members of the academy's sales team and its senior administrator can also sign in to the app to answer families' chats and calls and to look up payments (Chats, Calls, Payments, Settings). We describe this so that no feature is undocumented; no review account is provided for that staff role.

3. SETUP AND ACCESS INSTRUCTIONS
- First launch: the app opens on the sign-in screen (Arabic or English, following the phone; Settings > Language changes it). Type the e-mail in the Username field and the password. The review accounts need no one-time code, SMS or e-mail verification.
- Terms of Use: after the first sign-in, a "Before you continue" screen links our Terms of Use, which state zero tolerance for objectionable content and abusive users (section 7.3). Tick the box and tap Agree; the acceptance is recorded on our server. Until a user agrees, reporting, blocking and posting are not available (a child-safety report is always allowed). After the first sign-in the app asks once where the family lives (country and region, typed by the parent; no GPS, no location permission): choose a country or tap Later. iOS also asks to allow notifications.
- Accounts (all fictional, in a review-only organization; nothing reaches real families or staff):
  1. Parent: {{PARENT_LOGIN}} (Sign-In Information). One child, Yahya, with lessons; a family group with his teacher and supervisor; a direct chat with the supervisor.
  2. Teacher: {{TEACHER_LOGIN}}, password in the Notes. Yahya's teacher, in the same family group.
  3. Deletion test: {{PARENT2_LOGIN}}, password in the Notes. A separate fictional family, for testing account deletion.
- Registration: a real family enrols with the academy (website), the academy creates the parent's account, and the family's supervisor sends the parent a one-time code. The parent taps "New parent? Create your account", enters the e-mail and the code, and chooses a password. The review accounts already exist and need no code.
- Navigation: parent tabs Chats, Calls, Packages, Settings. Teacher tabs Chats, Schedule, Boards, Calls, Settings.
- Messaging: Chats > the "Yahya" family group: write a message, attach a photo or file, or hold the microphone for a voice note.
- Voice calls (for talking with the teacher or the academy; lessons are held on Zoom): voice only, never recorded. Sign in as the parent on one device and as the teacher on a second device, open the family group and tap the phone icon at the top; the other device rings while the app is open. The supervisor in the review data has no login, so a call in the parent's direct chat with the supervisor is not answered.
- Notifications: allow notifications when asked; a new message from the other account then arrives as a notification.
- Reporting and blocking: long-press a message from another person > Report > choose a reason > Send report. Tap the group title to see the members: the flag icon reports a person, the block icon blocks them. A blocked person's messages are hidden and they cannot message or call you; lesson cards and academy messages still reach you. Settings > Blocked people lists and unblocks; Settings > My reports shows each report's status and, once staff answer, the answer. In production, every report enters the academy's moderation queue, worked by named academy staff in our admin portal; reports not handled are escalated automatically after 18 hours (managers) and 24 hours (senior administrator), and child-safety reports alert the senior administrator immediately and never go to a general queue. Staff can remove content, warn and suspend accounts. The review organization has no real staff, so a report made during review is recorded and stays "Received".
- Account deletion: sign in as the deletion-test account > Settings > Delete account > enter the password > Delete my account > confirm. Deletion is immediate and permanent and signs the user out; the account can no longer sign in. Personal data (name, photo, contact details, password, sessions, notifications) is deleted, and the name is shown as "Deleted user". Kept, as our privacy policy explains: payment records for 7 years (legal duty), messages already sent (shown as "Deleted user", so the conversation stays readable for the other members), and the child's records at the academy. Backups expire within 56 days. A teacher who still has open lessons or students requests deletion, and the account is deleted within 30 days.
- Payments: Packages tab > Amount due > Pay. For the review family our server turns payment off: you see a demo lesson package and demo bank details, no receipt can be sent and no charge can happen.
- Support: Settings > Help and support, and Contact support.

4. EXTERNAL SERVICES
- Jawwid's own API and sign-in (our own password and token system), hosted on DigitalOcean App Platform (Frankfurt), with a PostgreSQL database, Redis for presence and rate limits, and DigitalOcean Spaces for chat media. Stores account and chat data. Essential.
- LiveKit Cloud: relays the audio of the app's voice calls. Audio is not recorded or stored. Needed to test calls.
- Apple Push Notification service: notifications. Device tokens only. Needed for notifications.
- Sentry: crash reports, with no personal data (hashed user id). Not needed for review.
- Zoom: the academy holds its live lessons on Zoom. Zoom is not part of the app: no Zoom SDK, link or account is in Jawwid Chat, and the reviewer does not need it.
- Not used in the review path: Stripe (card payments, switched off), bank transfer (demo only for review), e-mail and WhatsApp (account-recovery codes; activation codes are sent by the family's supervisor), Firebase (Android only).
The app contains no analytics, advertising or tracking SDKs and no AI services.

5. REGIONAL AVAILABILITY
The app works the same way in every country where it is available: the same features, content, registration process and services, in Arabic and English. There are no country checks and no regional feature differences. (Academy announcements can be addressed to families in a country or region they told us they live in.) We do not distribute in China mainland, because the app uses CallKit for incoming calls and we do not hold an ICP filing.

6. REGULATED INDUSTRIES AND THIRD-PARTY MATERIAL
Jawwid is a private online tutoring academy (Jawwid LLC, United States). It is not a government, financial, medical or gambling service, and it holds no money for users: parents pay the academy for live lessons. The app uses no protected third-party content that needs a licence beyond these: the Quran text is the Tanzil Project's verified Uthmani text, used under CC BY 3.0 with attribution in the app's verse picker; the fonts are SIL Open Font License fonts, shipped with their licence; the sounds are our own (CC0); and the open-source SDKs in the iOS app are under MIT, BSD or Apache 2.0 licences. The lesson content is the academy's own. No recitation audio or other third-party media is distributed in the app.

Thank you,
{{CONTACT_NAME}}, Jawwid
```

---

## C. Open points that change the wording (owner)

| Point | If the answer differs |
|---|---|
| **Lessons on Zoom (owner, 2026-11-19).** Live one-to-one lessons take place on Zoom, outside the app. Build 2 has no Zoom integration (no SDK, link or account; code search of `2e4127015`). The texts above say so and never claim in-app lessons. The app's voice calls are described as communication calls, not lessons | Settled |
| **Incoming calls while the app is closed.** `APNS_VOIP_ENABLED` is **not set** in production (GitHub `production` variables, 2026-11-19), so CallKit ringing with the app closed is off. The texts above say "while the app is open" | If the owner enables VoIP with an approved redeploy and a device check passes, the texts may add "also when the app is closed" |
| **Build 3 = 1.0.0 (4), with the enrol link (PR #613).** Build 2 has no "Enrol your child" link, so the texts above do not mention it | If 1.0.0 (4) is submitted: in §A after "free trial lesson, public prices)." add `The sign-in screen links there ("New to Jawwid? Enrol your child").`, and in §B.1 add "the "New to Jawwid? Enrol your child" link to our public enrolment page" after "the sign-in screen". Record step 2 of the script |
| **"Before you continue" Terms screen = production deploy (checklist §D step 2).** Build 2 already contains the screen (ENG-11 is in `2e4127015`). It appears only when the production API sends the `legal` block, which needs the step 2 deploy; production still runs `2e4127015` (checked 2026-11-19) | **If you submit before that deploy, both texts above are false and must change.** In §A replace `After sign-in: "Before you continue" shows our Terms of Use (zero tolerance for objectionable content or abusive users): tick and tap Agree. Then the app asks once` with `Our Terms of Use (zero tolerance for objectionable content or abusive users) are linked under the sign-in form and in Settings > Terms of use. After sign-in the app asks once` (3,804 bytes). In §B.3 replace the "Terms of Use:" bullet's first three sentences with `Terms of Use: linked under the sign-in form and in Settings > Terms of use; they state zero tolerance for objectionable content and abusive users (section 7.3).` **Risk:** Guideline 1.2 expects users to agree to such terms. Without the deploy they are linked but not agreed to in the app |
| **Report answers during review.** The review organization has no staff with a login, so a reviewer's report stays "Received" and gets no answer. The texts say so | If Apple asks to see an answer, an owner-side staff member can answer it in Admin Web `/moderation` only if they belong to the review organization (they do not today). Do not move real staff into it without a decision |
| **Sales-role account.** No review login exists for the sales role. The reply describes the role (2.5 "no hidden features") | If Apple asks, add a fourth review login (code change in `review-cohort.ts`) |

## D. Byte check

```bash
awk '/^<!-- NOTES-START -->$/{f=1;next}/^<!-- NOTES-END -->$/{f=0}f' APP_REVIEW_NOTES.md | sed '1d;$d' | wc -c
```
