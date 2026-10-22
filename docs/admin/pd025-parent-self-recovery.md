# PD-25 · A parent recovers their own account

Decision record: `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4, PD-25 (closed 2026-10-22).
Wire contract: `../contracts/API-CONTRACT.md` §3.1 (`/auth/recovery`, `POST /auth/password-reset`).
Builds on: PD-21 (`pd021-account-administration.md`) — the same reset code and completion.

## What the parent sees

The app's sign-in screen has one link, **Trouble signing in?** It opens a short list, showing
only what this deployment has switched on:

| Choice | Steps | Code goes to |
|---|---|---|
| **I forgot my password** | 1. sign-in e-mail → 2. code + new password | the sign-in e-mail |
| **I forgot my e-mail** | 1. phone → 2. code → 3. "Your sign-in e-mail is …" → sign in, or set a new password with the same code | WhatsApp, the phone in the parent file |
| **I have a code from the academy** | PD-21: login + code + new password | handed over by a supervisor |

Every step says where the parent is ("Step 2 of 3"). Codes last 10 minutes; **Send a new
code** unlocks after 60 seconds, and only the newest code works. Errors are plain words
("That code is wrong or has expired. Check it, or send a new one."). When nothing is switched
on, or the server cannot be reached, the screen tells the parent to ask their supervisor for a
one-time code, and still offers **I have a code from the academy**.

A finished recovery goes straight back to the sign-in screen: with a new password it signs in;
after "forgot e-mail" alone it fills the e-mail and waits for the password the parent knows.

## Rules

- **Who.** An active parent (family) account that has already signed up (PD-16). Teachers and
  staff go through an administrator (PD-21) — `chat.guard_password_reset_code` refuses them a
  self-service code. A suspended account stays suspended. A parent who never signed up uses
  **Create your account**.
- **Where a code goes.** Only to a contact method the academy already holds: the account's
  sign-in e-mail, or the phone in the parent file (`chat.parent_file`, PD-17). A WhatsApp code
  goes to the number ON FILE, never to the number typed — a loose match could only ever
  message the real owner.
- **Phone matching.** Both numbers are parsed to E.164 (`libphonenumber-js`): the typed one
  with Egypt as the default country, the stored one with the family's country. Only an exact
  E.164 match counts. One phone may belong to several parent accounts: one WhatsApp message,
  and the parent picks the account.
- **One code system.** `chat.password_reset_code` holds administrator codes (`channel =
  'admin'`, `issued_by` a staff member) and self-service ones (`email` / `whatsapp`, no
  issuer). One live code per account; a new one supersedes the old, an administrator's too.
  5 tries per code, shared between "verify" and "set password". Hash only.
- **No enumeration.** Both requests answer `{ ok: true }` whatever was typed, and the code is
  sent AFTER the answer, so neither the answer nor its timing tells an outsider an account
  exists. "Verify" refuses with one code and spends a comparable hash on every refusal.
- **Limits.** The login limiter (10 per identifier, 30 per source, per 15 minutes) meters
  every call; per account, 60 s between codes and 5 self-service codes an hour (10 of any
  kind).
- **Privacy.** The phone never leaves `src/parent-profile` (`ParentPhoneDirectory`; G-07);
  the app sends the number the parent typed and never receives one. Neither the code, the
  e-mail nor the phone reaches the audit log or the API log; a failed delivery logs only the
  provider's error kind.
- **Audit.** `account.recovery_code_sent` (channel, code id, expiry) when a code is issued;
  `account.password_reset_completed` (now with `channel`) when a password is set.

## Switching it on

Each channel is off until all of its variables are set (`infra/env/manifest.tsv`):

| Channel | Variables | Notes |
|---|---|---|
| E-mail | `SMTP_URL` (secret), `RECOVERY_MAIL_FROM` | Any SMTP provider (SES, Mailgun, Postmark, Google Workspace…). The From domain needs SPF/DKIM or the code lands in spam. |
| WhatsApp | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (secret), `WHATSAPP_RECOVERY_TEMPLATE`; optional `WHATSAPP_TEMPLATE_LANGUAGE` (default `ar`), `WHATSAPP_API_VERSION` (default `v21.0`) | Meta WhatsApp Business account + an approved **authentication** template with a copy-code button; the code is `{{1}}`. |
| Local / QA only | `RECOVERY_DELIVERY_LOG=true` | Writes codes to the API log. Forbidden in production by the manifest, and the API refuses to boot with it under `NODE_ENV=production`. |

## Code map

| Piece | Where |
|---|---|
| Routes | `apps/api/src/account-recovery/account-recovery.controller.ts` |
| Flow | `apps/api/src/account-recovery/account-recovery.service.ts` |
| Senders | `apps/api/src/account-recovery/recovery-delivery.ts` |
| Phone lookup | `apps/api/src/parent-profile/parent-phone-directory.ts` |
| Codes | `PasswordResetService.issueRecovery` / `confirmRecovery` |
| Database | `supabase/migrations/20261022160000_chat_pd025_parent_self_recovery.sql` (rollback in `db/rollback/`) |
| App | `lib/features/auth/presentation/{account_recovery,forgot_password,forgot_email}_screen.dart` |
| Tests | `apps/api/test/integration/pd025-parent-recovery-http.spec.ts`, `apps/api/test/unit/account-recovery/`, `test/features/auth/account_recovery_test.dart` |

## Not in this change

- **Admin Web sign-in** keeps PD-21's "I have a reset code" only; parents use the app.
- **Sign-up by WhatsApp.** PD-16's sign-up code is still relayed by the supervisor. Once the
  WhatsApp sender is configured it could deliver that code too — a separate decision.
- **A parent who never signed up** and forgot their e-mail still asks their supervisor.
