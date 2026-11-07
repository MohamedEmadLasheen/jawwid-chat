# Data inventory and retention matrix

**Version 0.1 (draft), 2026-11-06.** This is an engineering record, not a public notice. It is the source of fact for `privacy-policy-en.md` and `privacy-policy-ar.md`. If the two disagree, the policy is wrong and must be corrected.

**Base:** `main` @ `647dfc27`. Paths are relative to the repository root.

**Evidence levels**
- **Code**: verified in source, configuration or a migration.
- **Docs**: stated only in a design, plan or runbook.
- **DEV-CONFIRM**: a developer must confirm it before publication. The open items are numbered in §6.

Jawwid Core is a separate system. It is out of scope and was not read. Anything Jawwid Core holds (for example subscription records it sends to Chat) needs its own inventory.

> **No retention period in this file was invented.** A period is given only where the code enforces it or a document states it. Everywhere else the entry says **"No purge found"**, and the period is listed in §6 as an owner decision. Until then the honest description is "kept until the account is erased" or "kept indefinitely".

---

## 1. Where data lives

| Store | What it holds | Provider | Region | Evidence |
|---|---|---|---|---|
| Postgres, schema `chat` | All structured records | Supabase (review period only; Postgres only), then DigitalOcean Managed Postgres at launch | Frankfurt, Germany (EU) | Docs: `docs/infrastructure/decisions.md` ADR-014; `production-runbook.md` (fra1). DEV-CONFIRM #1: which one is live at publication |
| Object storage | Attachments, voice notes, photos, story media, certificates, whiteboard assets, Materials | DigitalOcean Spaces, bucket `jawwid-chat-prod-media`, versioning on | fra1, Frankfurt | Code: `s3-object-storage.ts`; Docs: ADR-016 |
| API, worker, Admin Web, Valkey/Redis | Data in transit. Redis holds presence, typing and rate-limit keys only | DigitalOcean App Platform | fra, Frankfurt | Code: `.do/app.production.yaml` (`region: fra`); ADR-015 |
| Database backups | Encrypted full dumps | GitHub Actions artifacts; a weekly copy to Spaces | GitHub: US (DEV-CONFIRM #2); Spaces: fra1 | Code: `.github/workflows/backup-daily.yml`, `deploy-production.yml`, `backup-weekly.yml` |
| Application logs | Route template, actor kind, request id. No IP address, actor id, message body or phone number | DigitalOcean App Platform | fra | Code: `request-log.ts`; Docs: `monitoring.md`. Retention: DEV-CONFIRM #3 |
| Mobile devices | Sign-in tokens in the iOS Keychain or Android Keystore; preferences and a local cache | The user's device | — | Code: `flutter_secure_storage`, `shared_preferences`, `sqflite` (`pubspec.yaml`) |
| Browsers (Admin Web, teacher web portal) | Refresh token in sessionStorage, or localStorage when "Keep me signed in" is ticked (never for the Super Admin); UI preferences. **No cookies.** | The user's browser | — | Code: `apps/admin-web/src/core/auth/tokens.ts`; `lib/core/storage/browser_token_store.dart` |

## 2. Third-party services (recipients)

"Role" is engineering's reading. It must be confirmed against each vendor's signed terms or DPA (legal review item L-4).

| Service | Data it receives | Purpose | Stores? | Region / transfer | Role | Evidence |
|---|---|---|---|---|---|---|
| **LiveKit Cloud** | Live **audio** streams only (microphone only, no video, no data channel); participant id = internal UUID; display name; room name; join and leave events | Audio calls and live lessons | Room metadata and logs, on LiveKit's side. **No recording**: the code has no egress or recording | Staging: EU (Frankfurt). Production: **DEV-CONFIRM #4** | Processor | Code: `apps/api/src/communication/calls/media-token.ts`, `livekit-webhook.controller.ts` |
| **Apple Push Notification service** (including VoIP / PushKit) | Device token; notification title and body. Templates name no sender or caller. Names on the lock screen are **off** by default and can be turned on by the user | Notifications and call rings (iOS) | Transient | Apple (US / global) | Processor | Code: `apns.provider.ts`; migration `20261014160000_chat_push_privacy_templates.sql`; `app-config.service.ts` (`notification.lock_screen_names_default: false`) |
| **Firebase Cloud Messaging** (the only Firebase product) | FCM token; title, body and data payload | Notifications and call rings (Android) | Transient | Google (global) | Processor | Code: `android/app/build.gradle.kts` ("Firebase Messaging only (no Analytics)"); `fcm.provider.ts`. No Analytics, Crashlytics or Auth. The Firebase project is not created yet (N-6) |
| **DigitalOcean** (App Platform, Spaces, Managed Postgres) | Everything the service holds | Hosting and storage | Yes | Frankfurt (EU) | Processor | §1 |
| **Supabase** (review period only) | The database | Database hosting | Yes | Frankfurt (EU) | Processor | Docs: ADR-014 |
| **GitHub** | Encrypted database backups (30 days) | Backups | Yes | US. DEV-CONFIRM #2 | Processor | Code: backup workflows |
| **Stripe** (hosted Checkout) | Amount; currency; **a line-item name made of the product label and the child's name** (`checkout.service.ts:129`); a description (the lesson period, "live one-to-one"); internal ids (payment request, organization); locale. The parent enters card, e-mail and billing details **directly on Stripe's page**. Jawwid never sees the card number. | Card payments and refunds | Yes. Jawwid keeps the Stripe session, intent and refund ids | Stripe (US / Ireland). DEV-CONFIRM #5 | Processor for the payment; independent controller for its own legal, fraud and card-network duties (L-4) | Code: `apps/api/src/billing/stripe.gateway.ts`, `checkout.service.ts` |
| **Sentry**, API and worker | Error type, route template, account kind, status, request id. No user, IP address, request body or cookies (`sendDefaultPii:false`, allowlisted `beforeSend`) | Error monitoring | Yes | **DEV-CONFIRM #6** | Processor | Code: `apps/api/src/infra/observability/sentry-error-tracker.ts` |
| **Sentry**, mobile app | Crash stack; SHA-256 hash of the account id; device model and OS. E-mails, phone numbers and quoted text are scrubbed. No screenshots. Release builds only | Crash reporting | Yes | DEV-CONFIRM #6 | Processor | Code: `lib/core/crash/crash_reporting.dart` |
| **Speech provider** (lesson voice-over; Azure AI Speech or Amazon Polly) | **Only the text of lessons.** No personal data. Never Quran text. Called by offline operator tooling, never by the API | Generating lesson pronunciation audio (PD-48) | On the vendor's side | Operator-set. DEV-CONFIRM #7 | Processor | Code: `scripts/lessons/tts/tts.py`; `apps/api/src/lesson-audio/voice-sources.ts`. Not named publicly (PD-48 rule, release gate R-48a) |
| **E-mail delivery** (SMTP) | E-mail address and a one-time code | Account recovery, first sign-in and password reset | Provider-dependent | **DEV-CONFIRM #8**: the provider is not named in code | Processor | Code: `apps/api/src/account-recovery/recovery-delivery.ts` |
| **WhatsApp Cloud API** (Meta), optional | Phone number and a one-time code, sent through an authentication template | Parent account recovery | Meta | DEV-CONFIRM #9: whether it is enabled in production | Processor | Code: `recovery-delivery.ts:171-195` |
| **Not used** | Analytics, advertising, tracking, maps, GPS, SMS gateways, social login | — | — | — | — | Code: no dependency; `ios/Runner/PrivacyInfo.xcprivacy` declares no tracking |

## 3. Data categories

| Data category | Data collected | Purpose | Storage location | Third party | Retention |
|---|---|---|---|---|---|
| **Sign-in (all roles)** | Sign-in name (a parent's e-mail), account kind, status, last sign-in time; password hash (argon2); failed attempts | Authentication, account security | `chat.account`, `chat.account_credential` | E-mail provider / WhatsApp (recovery codes only) | Until erasure. The sign-in name becomes `erased:<id>` and the credential is deleted (Code) |
| **Sessions and devices** | Session: HMAC hash of the IP address, user agent, client, "remembered", timestamps. Device: platform, app version, device name. Push token: token, platform, VoIP flag, locale | Session security; sending notifications | `chat.session`, `chat.device`, `chat.device_token` | APNs, FCM (tokens) | Devices and push tokens deleted on erasure. Session rows are **revoked but not deleted**; no purge found (DEV-CONFIRM #10) |
| **Parent / guardian profile** | Name, relationship to the child, photo, about text, permissions; family display name and language | Delivering the service; communication | `chat.contact`, `chat.contact_profile`, `chat.family` | — | Until erasure: name becomes "Deleted user", and the photo and about text are deleted (Code) |
| **Parent contact details (staff-only)** | Phone, e-mail, region, staff note | Contacting the family; operations | `chat.parent_file` | — | Deleted on erasure (Code) |
| **Parent location (PD-45)** | Country and first-level region (state, emirate, governorate or province; ISO 3166-2). Typed by the parent in a once-only prompt (Save or Later). The phone's country is only a suggestion. **No GPS or device location.** | Registration record; addressing announcements (Stories) to the right audience; reading phone numbers in the right national format | `chat.family.country_code`, `subdivision_code`, `location_source`; `chat.contact_location_prompt` | **None** | Kept on the family record after a parent's erasure, because the family and its children remain (only the location prompt row and the staff-only `parent_file` region are deleted; Code). Location typed when booking a trial is purged **90 days** after a trial that led to no subscription (Code: migration `20261030030000`, worker) |
| **Who sees the parent's location** | — | — | — | — | Super Admin, Operations (within scope) and Sales. **Never teachers, never other parents** (Docs: `docs/product/pd045-parent-location-plan.md`). DEV-CONFIRM #11: confirm against the route permissions |
| **Trial request** | Parent name, e-mail, phone; children (name, level, note); country | Arranging a trial lesson | `chat.trial_subscription`, `trial_prospect`, `trial_student` | — | **Not touched by account erasure** (Code). No purge found except the trial location (DEV-CONFIRM #12) |
| **Family contact keys** | Keyed hash of each e-mail and phone (PD-42) | Matching enrolments to an existing family | `chat.family_contact_key` | — | The parent's own keys are deleted on erasure (Code) |
| **Child / student** | Name, level, assigned teacher, photo, about text; date of birth or stated age (enrolment) | Teaching; age-appropriate content; scheduling | `chat.learner`, `learner_profile`, `learner_enrollment` | **Stripe receives the child's name** in the payment line item | **Never deleted, including when the parent deletes their account** ("the academy's records", erasure migration). Owner/legal decision LD-6 |
| **Lessons and attendance** | Outcome, minutes late, lesson report and its revisions, corrections, memorisation marks, practice, materials opened, reward events | Education records; reporting to parents | `chat.lesson*`, `learner_reward_event` (append-only) | — | No purge found (LD-7) |
| **Chat messages** | Text, type, author, edit history, reactions, read receipts, stars, pins, mentions | Communication between families, teachers and the academy | `chat.message`, `message_revision`, and related tables | — | Kept after the author's erasure, shown as "Deleted user". **"Delete for everyone" hides the message but keeps its text and attachments in the database** (Code: `message.service.ts`, `writeDeletedForAll`). No purge found (LD-7, DEV-CONFIRM #13) |
| **Internal staff notes** | Notes staff add inside a conversation, visible only to staff (`Visibility = {customer, internal}`, `vocab.ts`) | Operations; coordination about the family | `chat.message` (internal visibility) | — | As messages; no purge found (DEV-CONFIRM #33) |
| **Attachments** | Photos, files, voice notes, video files; original file name, duration, dimensions | Communication | Spaces; `chat.message_attachment` | DigitalOcean | As messages. A deleted object keeps a non-current version for **30 days** (Code: `scripts/infra/storage-versioning.sh`) |
| **Voice notes** | Audio a user records and sends in chat | Communication | Spaces | DigitalOcean | As attachments |
| **Camera captures** | Photos and videos taken with the device camera to send in chat (the iOS camera permission is in `Info.plist`; `media_picker.dart`) | Communication | As attachments | DigitalOcean | As attachments
| **Live audio (calls and lessons)** | Audio streams in real time | Calls and lessons | Not stored | LiveKit (relay only) | **Not recorded** (Code) |
| **Call records** | Participants; start, answer and end times; duration; outcome; join and leave times | Call history; attendance; safeguarding | `chat.call`, `call_participant` | — | No purge found (LD-7) |
| **Stories (announcements)** | Story, views, button taps, media | Academy announcements | `chat.story*`; Spaces | — | Media purged **72 hours** after the story expires (Code: `story.media_retention_hours`). Rows: no purge found |
| **Whiteboards** | Page drawings (JSON), assets, access log | Teaching | `chat.whiteboard*`; Spaces | — | Trash: **30 days**. A departed teacher's boards: **12 months**, then purged (Code: worker). **The access log is never purged** (Code) |
| **Certificates** | Printed name, certificate files, consent to show a certificate in a Story; teachers' qualification files | Recognition; teacher credentials | `chat.appreciation_certificate`, `certificate_story_consent`, `teacher_profile_certificate`; Spaces | — | Teacher files deleted on erasure (Code). Others: no purge found |
| **Reports and blocks (PD-57)** | Reporter, subject, reason, note, evidence snapshot, resolution; blocks; manager notices | Moderation and child safety | `chat.content_report`, `actor_block`, related | — | No purge found (LD-7) |
| **Feedback to the administration (PD-32)** | Message, category, response | Service quality | `chat.parent_feedback` | — | No purge found |
| **Consent and notice records** | PD-48 lesson-audio notice acknowledgement (version, time); certificate story consent; **terms acceptance (PR #462, draft, not on `main`)** | Evidence of consent | `chat.parent_notice_ack`; `chat.terms_acceptance` (PR #462) | — | Parent notice: removed only with its contact. Terms acceptance: **kept after erasure**, attached to the anonymised account (PR #462) |
| **Teacher employment records** | Phone, e-mail, start date, teaching market; pay terms; **payout account (AES-256-GCM encrypted)**; leave requests (free-text reason); violations, suspensions, supervision notes; professional profile (bio, qualifications) | Employment, payroll, supervision | `chat.teacher_*` | — | Phone, e-mail, payout account and profile deleted on erasure. Discipline and pay records kept (Code). No period set (LD-7) |
| **Staff** | Name, photo, role, presence, last activity, "hide last seen"; job title, about | Operations | `chat.staff`, `staff_profile` | — | Staff cannot self-delete; an administrator closes the account. No period set |
| **Payments** | Payment request (child's name, payer's name, amounts); payments, refunds, receipts, invoices, Stripe ids | Billing; accounting; refunds | `chat.payment*` and related | Stripe | **"7 years"** is stated (erasure migration header; `account-deletion-page.ts:52`). **No purge enforces it** (Code). The legal basis per country: L-6 |
| **Audit and support-session logs** | Before and after values, reason, actor; support-session records and their actions | Accountability; security; investigating complaints | `chat.audit_log`, `impersonation_session`, `impersonation_action` | — | "7 years" is stated for the audit log (erasure migration). No purge found. Kept on erasure |
| **Notifications** | Notification and its items | In-app inbox | `chat.notification`, `notification_item` | APNs/FCM (in transit) | Delivery rows **90 days**; Notification Center entries **365 days** (Code: `app-config.service.ts`, daily purge); deleted on erasure |
| **Sign-up failures** | Hash of the sign-in name | Abuse limits | `chat.parent_signup_failure` | — | **7 days** (Code: migration `20261026120000`) |
| **Time zone** | The account's time zone | Scheduling | `chat.actor_time_zone` | — | DEV-CONFIRM #14 |
| **Diagnostics** | See Sentry and logs in §2 | Fixing faults | Sentry; App Platform | Sentry | Sentry: DEV-CONFIRM #6. Logs: DEV-CONFIRM #3 |
| **Payment card data** | Card number, expiry, CVC | — | **Not held by Jawwid.** Entered on Stripe's page | Stripe | Stripe's own policy |

## 4. Account deletion: what happens (Code: `chat.erase_account`, migration `20261102210000_chat_account_erasure.sql`)

**Who can use it, and where**
- In the app: Settings → Delete account (`POST /me/account/delete`, password re-entered).
- On a public web page: `/account-deletion` (sign-in name, password, confirmation).
- Parents and teachers can delete their own account. A staff account is closed by an administrator.

**When it happens:** in one database transaction, immediately.

**Teachers:** a teacher's deletion is refused while a future lesson, an assigned student, or this or last month's payroll is open (`TEACHER_DELETION_BLOCKED`). The teacher is told to contact the academy.

| Data | Result |
|---|---|
| Sign-in name | Replaced with `erased:<id>` (the e-mail can sign up again) |
| Password, devices, push tokens, reset codes, own notifications | Deleted |
| Sessions | Revoked. The rows stay (DEV-CONFIRM #10) |
| Parent's name | Becomes "Deleted user" |
| Photo, about text, staff-only phone/e-mail/region/note, location prompt, the parent's own contact keys | Deleted. Photo objects are removed from storage after commit, best effort; a version stays for 30 days |
| Teacher's phone, e-mail, profile, certificate files, payout account, supervisor link | Deleted. The Teachers manager is notified |
| Messages and attachments the person sent | **Kept**, shown as "Deleted user" |
| Children's records (profiles, lessons, reports, rewards) | **Kept** (LD-6) |
| Payments, invoices, receipts | **Kept** ("7 years", not enforced) |
| Audit log; support-session log; content reports; call records; whiteboard access log | **Kept** |
| Terms-acceptance and notice records | **Kept** (consent evidence) |
| Trial-request contact details | **Not touched** (DEV-CONFIRM #12) |
| Data at Stripe, Sentry, LiveKit, APNs/FCM | **Not propagated** (DEV-CONFIRM #15) |
| Backups | The data stays in encrypted backups until each backup expires (§5) |

- If no one left in the family can sign in, Operations gets a `family_without_account` task.
- **No data-export tool exists.** An access request is answered by hand (LD-9).

## 5. Backups (Code, except where marked)

| Backup | Where | Kept for |
|---|---|---|
| Encrypted dump before each production deploy | GitHub Actions artifact | **30 days** (`deploy-production.yml`) |
| Daily encrypted dump (review period) | GitHub Actions artifact | **30 days** (`backup-daily.yml`) |
| Weekly off-site encrypted dump | Spaces | **56 days** (`backup-weekly.yml`, `BACKUP_RETENTION_DAYS: '56'`). Docs: disabled until its bucket exists |
| DigitalOcean Managed Postgres, after launch | DigitalOcean | Daily backups plus 7 days of point-in-time recovery (Docs, marked "confirm" in the runbook) |
| Object storage, non-current versions | Spaces | **30 days** (`storage-versioning.sh`) |
| Owner-held weekly downloads | The owner | **No stated limit** (DEV-CONFIRM #16) |

**Documentation conflict, to fix:** `docs/infrastructure/backup-recovery.md` says backups keep message text "for the same 30 days". The weekly off-site copy keeps it for 56 days, and owner-held downloads have no limit. Until this is reconciled, the policy says: "deleted data may remain in encrypted backups for up to 56 days, and in any additional copy the academy keeps under its backup procedure until that copy is destroyed".

## 6. Items for developer confirmation (DEV-CONFIRM)

| # | Question | Evidence so far |
|---|---|---|
| 1 | At publication, is the live database on Supabase or on DigitalOcean Managed Postgres? Both are Frankfurt. | ADR-014; production runbook |
| 2 | GitHub backup artifacts: in which region are they stored? Is GitHub listed as a sub-processor? | Backup workflows |
| 3 | How long does App Platform keep application logs? Who can read them? | Not found |
| 4 | The LiveKit Cloud production project: its region; whether the DPA is signed; confirm that Egress/recording is disabled on the project | Staging is EU; no egress in code |
| 5 | Stripe account: which entity and region; whether the DPA is accepted | Not found |
| 6 | Sentry: its data region (EU or US); one organisation or two; the event retention plan | Not found |
| 7 | The TTS vendor and region actually used for production clips (release gate R-48a) | `voice-sources.ts` shows the licence as null |
| 8 | The SMTP provider and its region | `SMTP_URL` only |
| 9 | Is WhatsApp recovery enabled in production? | Optional in code |
| 10 | Should revoked session rows (hashed IP, user agent) be purged? After how long? | No purge |
| 11 | Confirm that teachers cannot read `family.country_code` / `subdivision_code` or `parent_file` through any route | Plan says never |
| 12 | Should erasure clear `trial_subscription` contact details and `payment_request.payer_name`? | Not touched today |
| 13 | Should "delete for everyone" clear the message text and attachments, now or after a period? | Soft delete today |
| 14 | Retention of `actor_time_zone` | Not found |
| 15 | Should erasure ask Stripe, Sentry or LiveKit to delete data? Is the Stripe line item's child name needed? | No propagation |
| 16 | A limit for owner-held backup downloads | Runbook §3c |
| 17 | Children's apps: does the iOS privacy manifest or the App Privacy answer need "phone number", which staff type in? | `PrivacyInfo.xcprivacy` omits it |
| 18 | Does any role other than parents and staff ever hold a child's date of birth? | `learner_enrollment` |

The **LD-** items (owner decisions) and **L-** items (legal review) are in `outstanding-information-and-decisions.md`.
