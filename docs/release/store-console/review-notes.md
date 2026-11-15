# Review notes: App Store Connect "Notes" and Play "App access"

**Launch item LR-09f.** Draft, 2026-11-09, written from the code on `main` @ `bc47d376` and from the open
pull requests #528 (review accounts), #524 (Android full-screen check) and #449 (push taps).
Nothing here has been entered in a console. The owner pastes the text.

**Where it goes**
- App Store Connect → the app → the version → **App Review Information**:
  - **Sign-In Information** holds the parent account.
  - **Notes** holds the text in §2. Apple says to put the other accounts' credentials in Notes.
- Play Console → **Policy and programs → App content → App access**: the three entries in §3. Enter the
  same logins in **Testing → Pre-launch report → Settings → Credentials**.

**Placeholders.** `{{REVIEW_DOMAIN}}` and the three `{{REVIEW_..._PASSWORD}}` values are typed only in
the consoles, never in this repository, a ticket or a chat (`docs/release/review-accounts.md`, step 3).
Three more placeholders are not secret and are filled or replaced before pasting: `[PAYMENTS PARAGRAPH]`
(§2.1), `[PAYMENTS SENTENCE]` and `{{ACCOUNT_DELETION_URL}}` (§3). Every other word is ready to paste.

**Before pasting:** the §4 checks must pass on the submitted build. The payments paragraph is Option C of §2.1
(owner decision OA-12, 2026-11-10) once the review payment mode is on for the review organization.

---

## 1. Facts the text relies on (checked in the code)

| Claim in the text | Evidence |
|---|---|
| Parents and teachers sign in to the app. Sales-team staff and the organization's super admin can sign in too, with Chats, Calls, Payments and Settings only. No other staff role can sign in. | `lib/shared/models/user_role.dart:6-12`; `lib/core/data/http/http_auth_repository.dart:311-331` (any other staff role is refused); `lib/app/shells/app_shell.dart:108-110` |
| Accounts are created by the academy. A parent signs up only if the academy enrolled their child, with a code the supervisor sends on WhatsApp | `lib/features/auth/presentation/parent_signup_screen.dart:20-25` |
| The review accounts need no code. They sign in with email and password on the normal screen | `review-accounts.md` ("No WhatsApp code"); #528 ("parent2 signs in with email and password alone") |
| Three accounts: `parent@`, `teacher@`, `parent2@` | `review-accounts.md` table; #528 adds `parent2@<domain>` ("Laila Hamdi", her own family, only a 1:1 chat with the made-up supervisor) |
| A review-only organization, all data made up, nothing reaches real staff | `review-accounts.md` intro |
| Settings → Language | `lib/features/settings/presentation/settings_screen.dart:149-154` |
| Settings → Delete account (password, then a confirmation) for parents and teachers | `settings_screen.dart:277-286`; `lib/app/router.dart:92`; strings `deleteAccountPasswordLabel`, `deleteAccountAction`, `deleteAccountConfirm` (`lib/l10n/app_en.arb:3468-3472`) |
| What deletion erases and keeps | Privacy policy on `main` (`docs/legal/privacy-policy-en.md`): §10.2 (deleted; sessions ended; name replaced by "Deleted user"), §10.3 (kept: messages, children's records, payments with the payer's and the child's names, call records, ended-session records with a hashed IP and the user agent, and more), §10.6.3 (backups up to 56 days). The in-app screen (`deleteAccountGoes`, `deleteAccountKeptParent`, `app_en.arb:3462-3464`) is shorter; the Notes follow the policy, so they say no less than the screen |
| The teacher account cannot be deleted while it has students | `deleteAccountTeacherBlocked` (`app_en.arb:3482`); `review-accounts.md` ("The teacher account cannot be deleted while a child is assigned to it") |
| A re-run of the provisioning command re-creates a deleted parent | `review-accounts.md` ("It restores a deleted parent account"); #528 does the same for `parent2` |
| Calls are voice only and not recorded | `lib/core/call_media/livekit_media_room.dart:13-16` (audio only); `apps/api/src/communication/calls/call.service.ts:29` ("No audio is recorded") |
| A call starts from the phone icon in a chat's header | `lib/features/messages/presentation/chat_screen.dart:1686-1694` |
| Any member who may write in a chat may call in it, the parent included in the family group. A teacher and a parent never have a direct chat or call | `apps/api/src/platform/authorization.service.ts:1642-1692` (PD-19; BR-1) |
| A family-group call rings the other members, so a reviewer needs the parent and the teacher on two devices | the same; the review family group seats the parent, the teacher and the made-up supervisor (`review-accounts.md`) |
| The supervisor has no login, so nobody answers a call in the parent's direct chat with the supervisor | `review-accounts.md` ("Synthetic staff with no login") |
| On iPhone, a call rings through CallKit while the app is closed | `ios/Runner/AppDelegate.swift:215-235`; `ios/Runner/CallKitBridge.swift:174`. **Only if** production sets `APNS_VOIP_ENABLED=true` (`apps/api/src/communication/notifications/push.provider.selector.ts:51-67`, default off). See §4 |
| The call's audio continues in the background | iOS `UIBackgroundModes` `audio` (`ios/Runner/Info.plist:48-50`); Android `CallForegroundService` (`android/app/src/main/AndroidManifest.xml:72-76`). **Not verified on a device** (see `ios-background-modes.md`) |
| Parent tab names: "Subscriptions" and "Amount due", then "Pay" | `lib/app/shells/app_shell.dart:108`, `:119`; `app_en.arb:1747` (`tabSubscriptions`), `:2064` (`billingAmountDueTitle`), `:2068` (`billingPay`) |

### Apple Guideline 2.5.19 (staff features)

The task asked for 2.5.19 wording **only if accurate**. Two findings:

1. **"Staff screens are not in the app" is not true.** Sales-team staff and the super admin sign in to
   the app (PD-20). So the text below says which staff use the app and what they see. It does not claim
   that all staff are outside it.
2. **Unverified:** what 2.5.19 says. The Apple guidelines page was read on 2026-11-09, but only the
   text up to 2.5.8 came back word for word. A summary of the rest says 2.5.19 is about hidden, dormant
   or undocumented features. So the Notes **describe** the staff role ("so that no feature is
   undocumented") and do not quote the guideline number. Re-read 2.5.19 on the day you submit. If it
   says something else, the paragraph still holds, because it only describes the app.

**Open (lead or owner): no review account for the Sales role.** Apple 2.1(a) asks for demo account
information "if your app includes a login". The review organization has no staff with a login
(`review-accounts.md`), and #528 adds none. The text says so openly. If App Review asks for the role,
the smallest fix is a fourth review account: a Sales-department `admin` in the review organization.
That needs a change to the provisioning command, so it is not in this draft.

---

## 2. App Store Connect → App Review Information → Notes (paste)

Choose **one** payments paragraph from §2.1 and paste it where `[PAYMENTS PARAGRAPH]` stands. The text
is plain ASCII on purpose: Apple's limit is **4000 bytes**, not characters, so an arrow or a curly quote
would count as 3 bytes.

<!-- APPLE-NOTES-START -->
```text
Jawwid is the communication app of a Quran academy. Parents use it to follow their child's live lessons and to talk with the academy; teachers use it to talk with their students' families. Accounts are created by the academy; there is no public sign-up.

SIGN-IN: email and password on the first screen. No WhatsApp or SMS code is needed for these accounts (a code is used only when a real parent first creates a password). The app follows the phone's language, Arabic or English; Settings > Language changes it. All people and data in these accounts are fictional and belong to a review-only organization: nothing you do reaches real families or staff.

ACCOUNTS
1. Parent (Sign-In Information above): one child with weekly live lessons, a family group chat with the child's supervisor and teacher, and a direct chat with the supervisor.
2. Teacher: teacher@{{REVIEW_DOMAIN}} / {{REVIEW_TEACHER_PASSWORD}}. The same child's teacher, in the same family group.
3. Deletion test: parent2@{{REVIEW_DOMAIN}} / {{REVIEW_DELETION_PARENT_PASSWORD}}. A separate fictional family. Please use this account to test account deletion.

ACCOUNT DELETION: Settings > Delete account > enter the password > Delete my account > confirm. It takes effect at once and cannot be undone. Deleted: the photo, the contact details, the password and the notifications; every signed-in session is ended. The name becomes "Deleted user" in conversations but stays on payment records. Kept: messages already sent (as "Deleted user"); payments and invoices, with the payer's and the child's names, for 7 years; the children's records at the academy; call records; and other records, such as ended-session records (hashed IP address and user agent). Deleted data may remain in encrypted backups for up to 56 days. Details: our privacy policy, section 10. We re-create the deletion-test account after each review. The teacher account cannot be deleted while it has students; the app asks the teacher to contact the academy.

CALLS: voice only, no video, not recorded. A call needs two devices: sign in as the parent on one and as the teacher on the other, open the family group chat and tap the phone icon at the top; the other device rings, also when the app is closed (CallKit on iPhone). The direct chat with the supervisor would ring a fictional staff member who has no login, so nobody answers there. During a call the audio continues when the app goes to the background or the screen locks.

STAFF: the academy's supervisors, managers and administrators work in a separate web portal, not in this app. One exception, described here so that no feature is undocumented: members of the academy's sales team and its senior administrator can sign in to this app to answer families' chats and calls and to look up a family's payments. They see only Chats, Calls, Payments and Settings, and their accounts are created inside the academy. No review account is provided for this role.

[PAYMENTS PARAGRAPH]
```
<!-- APPLE-NOTES-END -->

**Length:** 2949 bytes without the payments paragraph. 3452 bytes with the longest option. See §2.2.

### 2.1 The payments paragraph (owner decision OA-12, 2026-11-10)

**OA-12 is decided:** the review accounts use the server-enforced **review payment mode**
(`docs/release/review-accounts.md`, "Review payment mode"). Reviewers see a demo amount due and the pay sheet, never
the real bank details, and cannot pay, transfer or send a receipt. **Use Option C** once the mode is switched on for
the review organization on the production backend. Until then, use Option B. Options A and B are kept for reference.
The policy reasoning is in `docs/release/app-review-notes-payments.md`.

**Option C: review payment mode (the owner's decision).**

```text
PAYMENTS: the academy sells only live one-to-one Quran lessons (one teacher, one student, real time, not recorded); no digital content or app features are sold. Under Guideline 3.1.3(d), parents pay a lesson package by card (Stripe Checkout, in the browser) or by bank transfer with a receipt upload. For this review account our server disables payment: Subscriptions tab > Amount due shows a demo lesson package > Pay. Card opens a page explaining the live Stripe checkout; bank transfer shows demo bank details and cannot send a receipt. No charge is possible.
```

- What the reviewer sees is in `review-accounts.md` (the table under "Review payment mode"). Each sentence above
  matches a row there.
- **Length: estimated by hand, not counted** (the counting command was not run for this change). The paragraph is
  about 560 bytes, so the Notes come to about 3510 bytes, under Apple's 4000 but slightly under the 500 bytes spare
  that §2.2 asks for. Count it before pasting; if it is over 3500, shorten the STAFF paragraph first.
- **UNVERIFIED for this change:** the Apple and Google policy pages were not re-read. The wording relies on the
  repository's reading of 2026-11-05 (`app-review-notes-payments.md` §1) and 2026-11-09 (this file). Re-read them on
  the day of submission.

Earlier options (before OA-12 was decided). Pick only if the review payment mode is not on.

**Option A: the review family has something to pay.** Use this only if the review organization has an
open lesson-package request (`app-review-notes-payments.md` §6 item 2; LR-05). Use the first sentence
with "by card" only if production has Stripe configured (LR-34). Otherwise use the "bank transfer only"
version.

```text
PAYMENTS: the academy sells only live one-to-one Quran lessons: each lesson is a real-time audio call between one teacher and one student, and lessons are not recorded. No digital content, materials or app features are sold; everything else in the app is free. Under Guideline 3.1.3(d) Person-to-Person Services, a parent pays a lesson package by card (Stripe Checkout, opened in the browser) or by bank transfer with a receipt upload. To see it: parent account > Subscriptions tab > Amount due > Pay.
```

Bank transfer only (no Stripe in production): replace "by card (Stripe Checkout, opened in the browser)
or by bank transfer with a receipt upload" with "by bank transfer, uploading the receipt for the academy
to confirm".

**Option B: the review family has nothing to pay** (today's review data: `review-accounts.md`, "No
payments").

```text
PAYMENTS: the academy sells only live one-to-one Quran lessons: each lesson is a real-time audio call between one teacher and one student, and lessons are not recorded. No digital content, materials or app features are sold. Under Guideline 3.1.3(d) Person-to-Person Services, parents pay for lesson packages outside in-app purchase. The review family has nothing to pay, so the Subscriptions tab shows no amount due.
```

Notes for the owner:
- **The tab name.** "Subscriptions" is today's name (`tabSubscriptions`). LR-15 recommends renaming it
  to lesson-package wording, so use whatever name the submitted build shows. LR-15 also notes that
  "Subscriptions" may read as an auto-renewing subscription under 3.1.2.
- **`app-review-notes-payments.md` §4 gives a different path:** "Settings → Payments → Amount due → Pay".
  `/settings/payments` is retired and now forwards to the Subscriptions tab (`lib/app/router.dart:136-142`).
  So that path no longer matches the screens, and the text above uses the tab instead. Correct §4 there
  when the owner chooses.
- **Option B is weaker evidence.** The reviewer cannot see the pay sheet's "Live one-to-one Quran
  lessons ..." line. App Review may ask to see it. Recommendation: Option A, with a payable request in
  the review cohort.

### 2.2 Length

| Text | Bytes (= characters; the text is ASCII) |
|---|---|
| The Notes block without the payments paragraph | 2949 |
| With Option A (card): the block, a blank line and the paragraph | 3452 |
| With Option B | 3368 |
| Apple's limit | 4000 bytes |
| Play "Any other information" text (§3) without the payments sentence | 1091 (about 1330 with it) |

Counted with `sed -n <lines> review-notes.md | wc -c`. Each count includes the line breaks. Only the
paste blocks were checked for non-ASCII characters (none). Apple's limit was read from the App Store
Connect help page on 2026-11-09, and only as a summary ("up to 4000 bytes"). Keep at least 500 bytes spare,
as the counts above do (548 with Option A). Do not shorten the deletion paragraph to save space: it must
not say less is kept than the privacy policy does.

Each count includes the placeholders as they are written here. The real domain and passwords change the
total by a few dozen bytes. Re-count after filling them in if the domain is long.

---

## 3. Play Console → App content → App access (paste)

**Answer:** "All or some functionality in my app is restricted" → add three entries.
**Field limits not verified.** Google's help page could not be read from this machine. If a field is
shorter than the text, paste the instructions once (in the first entry) and leave the others to "See
the Parent account entry".

| Name | Username | Password |
|---|---|---|
| `Parent account` | `parent@{{REVIEW_DOMAIN}}` | `{{REVIEW_PARENT_PASSWORD}}` |
| `Teacher account` | `teacher@{{REVIEW_DOMAIN}}` | `{{REVIEW_TEACHER_PASSWORD}}` |
| `Deletion test account` | `parent2@{{REVIEW_DOMAIN}}` | `{{REVIEW_DELETION_PARENT_PASSWORD}}` |

**Any other information (paste in each entry):**

```text
Sign in with the email and password above on the first screen; no WhatsApp or SMS code is needed. Jawwid is a Quran academy's app for parents and teachers; academy staff use a separate web portal, except the sales team and the senior administrator, who see only Chats, Calls, Payments and Settings (no review account for that role). All data is fictional, in a review-only organization.
Parent: one child with weekly live lessons, a family group chat with the supervisor and teacher, and a direct chat with the supervisor. Teacher: that child's teacher, in the same family group.
Calls are voice only and not recorded. To test one, sign in as the parent and the teacher on two devices, open the family group chat and tap the phone icon; the other device rings. The supervisor has no login, so a call in the direct chat is not answered.
Account deletion: use the Deletion test account. Settings > Delete account > password > Delete my account > confirm. It is immediate; we re-create the account after review. The same is available on the web at {{ACCOUNT_DELETION_URL}}.
[PAYMENTS SENTENCE]
```

`[PAYMENTS SENTENCE]` (OA-12, the same choice as §2.1):
- **Option C (the owner's decision, once the review payment mode is on):** `Payments: only live one-to-one Quran lessons are sold (one teacher, one student, real time, not recorded), paid by card on Stripe's page in the browser or by bank transfer with a receipt, under the 1:1 online paid services rule. For this review account our server disables payment: Parent account > Subscriptions tab > Amount due > Pay shows a demo; no charge, transfer or receipt is possible.`
  The 1:1 rule's wording was not re-read for this change (**UNVERIFIED**; see `app-review-notes-payments.md` §1).
- **Option A:** `Payments: only live one-to-one Quran lessons are sold (one teacher, one student, real time, not recorded), paid by card on Stripe's page or by bank transfer under the 1:1 online paid services rule. Parent account > Subscriptions tab > Amount due > Pay.`
- **Option B:** `Payments: only live one-to-one Quran lessons are sold (one teacher, one student, real time, not recorded), paid outside Google Play Billing under the 1:1 online paid services rule. The review family has nothing to pay.`

`{{ACCOUNT_DELETION_URL}}` is not a credential. It is the LR-04 web deletion page that Play's account
deletion form also needs. If it does not exist at submission, delete that sentence.

This replaces the instruction text in `play-declarations.md` §2, which lists two accounts and says
"Settings → Language" and "Reporting and blocking". Those two lines are still true and can be added if
there is room. This text adds the deletion account, the call test and the staff role.

---

## 4. Check on the submitted build before pasting

Each check needs a release build on the production backend (LR-01) with the review accounts provisioned
(LR-05, and #528 for `parent2`).

| # | Check | If it fails |
|---|---|---|
| 1 | The three accounts sign in with email and password; no code is asked for | Fix provisioning before submitting |
| 2 | Settings → Delete account works for `parent2` and asks for the password; the next workflow run re-creates it | Fix, or remove the "re-create" sentence |
| 3 | Parent and teacher on two phones: a family-group call from either side rings the other | Fix before submitting: Apple and Google both test calls |
| 4 | **iPhone, app closed:** the call rings through CallKit. This needs `APNS_VOIP_ENABLED=true` in production (default off: `push.provider.selector.ts:51-67`) | Remove "also when the app is closed (CallKit on iPhone)" from §2, and see `ios-background-modes.md` (`voip` would then have no use in that build) |
| 5 | Lock the screen during a call; both sides still hear each other (iPhone and Android 14+) | Fix before submitting (iOS `audio` mode; Android LR-14 service) |
| 6 | The payments path in the chosen option opens the screens it names, with the names it uses | Correct the words to match the build |
| 7 | Count the bytes again after filling in the domain (§2.2) | Shorten the STAFF paragraph first |
| 8 | Option C only: as the review parent, Amount due shows the demo lesson package; Pay by card opens the demo page in the browser (not Stripe); the bank-transfer page shows the demo notice and demo bank details, and Send is off | Switch the review payment mode on (`review-accounts.md`), or use Option B |
