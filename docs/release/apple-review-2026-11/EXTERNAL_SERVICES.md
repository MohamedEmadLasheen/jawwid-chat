# External services used by Jawwid Chat (iOS 1.0.0 build 2)

Apple App Review, Guideline 2.1 "Information Needed", item 4. Verified on 2026-11-19 against the code of the
submitted build: `main` @ `2e4127015` (release run 44285965671). Each row was checked in source or configuration,
not in older documentation. Audit evidence with file and line numbers: `reports/AR-E-services-legal-regional.md`
(orchestrator).

Evidence labels: **CODE** means verified in source or configuration at this commit. **PROD** means observed against
production on 2026-11-19. **UNVERIFIED** means not checked in a console or in the signed binary.

## Services that deliver the core functionality

| # | Service | Role in the app | App functions that depend on it | User data it processes or stores | Needed by the reviewer? |
|---|---|---|---|---|---|
| 1 | **Jawwid's own API** (NestJS), hosted on **DigitalOcean App Platform**, Frankfurt | All business logic. **Sign-in is our own:** Argon2 password hashes and our own access and refresh tokens. Also chat, call signalling (Socket.IO), payment records and push fan-out | Everything | Everything the service holds (accounts, chats, lesson records) | **Yes** (PROD: `https://api.chat.jawwid.com/health` 200 on 2026-11-19) |
| 2 | **PostgreSQL**, hosted by Supabase (Frankfurt) during review; DigitalOcean Managed Postgres at launch | Database only. **Supabase Auth, Storage, Realtime and its Data API are not used**, and the app never talks to Supabase directly | Every read and write, through the API | All structured records | Indirectly (behind the API) |
| 3 | **Redis / Valkey** | Presence, typing indicators, rate limits and the realtime adapter. Holds nothing durable | Realtime delivery, sign-in rate limiting | Short-lived keys only | Indirectly |
| 4 | **DigitalOcean Spaces** (S3-compatible object storage), Frankfurt | Stores media | Photos, voice notes, files and profile photos in chats, bank-transfer receipts | User media | Yes, if media is tested |
| 5 | **LiveKit Cloud** | Relays the audio of the app's voice calls (family, teacher and academy; **lessons are not held in the app**). The server issues short-lived, microphone-only tokens. **Calls are not recorded** (the code has no egress or recording) | Voice calls | Live audio in transit only; participant id, display name and room name | Yes, to test calls |
| 6 | **Apple Push Notification service** (alerts) and **PushKit VoIP** | Notifications. PushKit VoIP (ringing through CallKit while the app is closed) is built in but **switched off in production** (`APNS_VOIP_ENABLED` unset). The server sends directly; the iOS app has no Firebase SDK | Notifications, incoming calls | Device token; notification text (names hidden on the lock screen by default) | Yes, for notifications |
| 7 | **Sentry** | Crash reporting (app and API). Session tracking, screenshots and tracing are off, no personal data is sent, and the user id is hashed | Diagnostics only | Scrubbed crash stack, hashed user id, device model and OS version | No |

## Lessons: Zoom, outside the app

| Service | Role | In the app? | Needed by the reviewer? |
|---|---|---|---|
| **Zoom** | The academy holds its live one-to-one lessons on Zoom (owner, 2026-11-19) | **No.** No Zoom SDK, link or account in build 2 (code search of `2e4127015`). Families and teachers use Zoom separately | No |

## Services used only outside the reviewer's path

| # | Service | Role | Needed by the reviewer? |
|---|---|---|---|
| 8 | **Stripe** (hosted Checkout, in the browser) | Card payment for lesson packages. **Off at launch.** The review organization never reaches Stripe, because the server-side review payment mode applies | No |
| 9 | **Bank transfer** to the academy's bank account | Parents pay a lesson package and upload the receipt. The review accounts see demo details and cannot send a receipt | No (demo only) |
| 10 | **E-mail (SMTP)** | Account-recovery codes | No: the review accounts sign in with a password and no code |
| 11 | **WhatsApp** | A supervisor relays a real parent's one-time activation code; optional recovery code | No: the review accounts need no code |
| 12 | **Firebase Cloud Messaging** | Android push only. Not in the iOS binary | No |

## Not used (sometimes named in older documents)

- **No** analytics, advertising, attribution or tracking SDK (`NSPrivacyTracking = false`, no tracking domains).
- **No** SMS gateway, maps or location services. Country and region are typed by the parent.
- **No** AI service at runtime.
- **No** Supabase Auth, Storage or Realtime.
- **No** runtime font download: all fonts ship in the app.
- **No** Quran recitation audio is served to users, because no recording is licensed for paid use. The server enforces this (`licence: null`).

## Content and assets shipped in the app

| Item | Source and licence | Licence file in the app |
|---|---|---|
| Quran text | Tanzil Project, Uthmani 1.1, CC BY 3.0, used verbatim. Attribution ("Tanzil Project, tanzil.net") is shown in the teacher's verse picker | Shown in the UI. **Follow-up:** CC BY 3.0 also asks for the licence name or link, which the app does not show; add "CC BY 3.0" beside the attribution (small Flutter change, or the API's attribution string) |
| Fonts | IBM Plex Sans Arabic and Amiri Quran, SIL OFL 1.1 | Yes (`assets/fonts/OFL*.txt`) |
| Reward sounds | Own work, CC0 | Yes (`assets/sounds/LICENSE.md`) |
| Open-source SDKs | MIT, BSD and Apache-2.0 only in the iOS binary; no GPL, LGPL or AGPL | Flutter's bundled NOTICES |

## Not verified here

- Each provider's console: the LiveKit Cloud region and Sentry's data region.
- In the signed binary: that the Sentry DSN is compiled in.

None of these affects what the reviewer needs.
