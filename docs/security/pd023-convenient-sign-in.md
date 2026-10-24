# PD-23 · Convenient sign-in: session lifetimes, devices, app lock, "keep me signed in"

Decision record: `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4, PD-23 (closed 2026-10-22).
Wire contract: `../contracts/API-CONTRACT.md` §3.1 (login `remember`, `session.*`) and §3.10b.

The request was "biometric login, remember me, persistent sessions, quick login, all roles,
app and Admin Web, without weakening admin security". What the code already did changed the
answer:

| Asked for | Already true before PD-23 | What PD-23 does |
|---|---|---|
| Persistent sessions in the app | Yes. The refresh token is kept in the Keychain / Keystore and slides 30 days, and the app restores it on launch. | Keeps it, and gives every role a stated limit (below). |
| Remember me on Admin Web | No. The refresh token was in `sessionStorage`, so every new tab or browser restart asked for the password. | "Keep me signed in on this device", with cross-tab safety. |
| Sessions expire per a security policy | No. Every refresh minted a new 30-day row, so a session that was used never ended. | Idle and absolute limits per role. |
| Revoke devices and sessions | Only through admin suspension (PD-21). | Devices & sessions for everyone; admins can sign out an account. |
| Biometric login | No. | An app lock using the phone's own Face ID / Touch ID / fingerprint / passcode. |
| Strong admin protection | A password only, with no second factor. | The super admin gets the shortest sessions and is never kept signed in until passkeys (phase B). |

## 1. Session lifetimes (server, `apps/api/src/platform/auth/session-policy.ts`)

- **Idle:** if a session goes unused this long, it ends. Every refresh moves the limit forward.
- **Absolute:** this long after the password was typed, the session ends however active it
  is. It is counted from `chat.session.authenticated_at`, which each refresh copies to the
  next row.

| Who | Where | Idle | Absolute |
|---|---|---|---|
| Parent, teacher | app | 30 d | none |
| Parent, teacher | web (PD-28 portal), kept signed in | 7 d | 30 d |
| Parent, teacher | web (PD-28 portal), this tab only | 12 h | 7 d |
| Staff (not super admin) | app | 14 d | 30 d |
| Staff (not super admin) | Admin Web, kept signed in | 7 d | 30 d |
| Staff (not super admin) | Admin Web, this tab only | 12 h | 7 d |
| Super admin | anywhere | 12 h | 7 d |

- The policy is decided again at **every refresh from the current principal**, so a promotion to
  super admin shortens the session at its next refresh. `client` and `remembered` are read back
  from the session row; a refresh cannot restate them.
- A staff login that names no platform gets the stricter "this tab only" policy. A missing
  field never buys a longer session.
- PD-28: a parent or teacher login gets the browser limits only when it names `web`; one that
  names no platform keeps the app's 30 days, so no phone build changes behaviour. The web
  portal stores its tokens exactly as section 4 describes, under its own keys
  (`jawwid.teacher.refresh*`, Web Lock `jawwid.teacher.refresh`).
- `JWT_REFRESH_TTL` still caps the idle window. It can only shorten a session, never lengthen one.
- When a refresh finds the session past its absolute limit, it ends the session with the
  reason `session lifetime reached`. It is never ended as `rotated`, because a row marked
  `rotated` and then presented again reads as token theft, and that would sign out every
  device on the account.
- The database enforces the rest: `remembered` only on `client = 'web'`, and
  `authenticated_at <= created_at` (migration `20261022140000`).

## 2. Devices & sessions

- **Your own** (app: Settings → Devices & sessions; Admin Web: Profile → Devices & sessions):
  - A list of every live session, with "This device" marked.
  - Sign out one device, or sign out all other devices.
  - Signing out the current session is the same as signing out.
  - A session id that belongs to another account gets the same `SESSION_NOT_FOUND` as a
    made-up one.
- **An administrator** (Admin Web → Accounts → Devices):
  - Lists an account's sessions and signs out one or all of them, always with a reason.
  - Uses the PD-21 rule (`canAdministerAccount`, act `sign_out`, same as suspend): any staff
    member for parent and teacher accounts; another staff account only by the super admin;
    never the super admin's own account, and never one's own.
  - The account stays active, and the person signs in again.
  - Every revocation is written to the audit log with the administrator and the reason.
- **Support sessions (PD-21)** never appear in the list, and a support session cannot end
  anything. They belong to the administrator and end with the administrator's own session.
  An administrator's "sign out of all devices" ends them, the same as a suspension does.

## 3. App lock (mobile)

- **Who gets it:** it is opt-in for parents and teachers (a Settings switch plus a one-time
  offer after sign-in). It is on by default for staff who sign in to the app (PD-20 Sales, the
  super admin), and they can turn it off.
- **What it uses:** `local_auth`, which is Face ID / Touch ID / Android BiometricPrompt with the
  device passcode as a fallback. The app never sees biometric data, and nothing biometric
  reaches the server.
- **When it locks:** at a cold start, and after the app has been in the background longer than
  the chosen timeout (Immediately / 1 minute (default) / 15 minutes / 1 hour). Content is hidden
  in the app switcher.
- **Escape:** "Sign out" on the lock screen goes through the one sign-out path.

**Deviation from the first proposal.** The first proposal locked the refresh token itself behind
biometrics in the secure hardware. That would make the token unreadable without a face or
fingerprint scan. Background refresh, push registration and answering an incoming call from a
cold start all need the token while nobody is looking at the phone, so every incoming call
would wait for a scan that the lock screen cannot show. The lock is therefore an **app-level
lock over the existing session**, as WhatsApp does it: calls ring and can be answered while the
app is locked. The token stays in the Keychain / Keystore (`first_unlock_this_device`, never
migrated to another device). This protects against the realistic threat, someone holding an
unlocked phone (a child with a parent's phone, for example). It does not protect against an
attacker who has jailbroken the device; a hardware gate would, at the cost of calls.

## 4. "Keep me signed in on this device" (Admin Web)

- **Where the token goes:** the checkbox is unticked by default. The *server's* answer
  `session.remembered` decides where the refresh token is kept: `localStorage` when true,
  `sessionStorage` (this tab only) when false. It is always false for the super admin. The
  access token stays in memory in both modes.
- **Cross-tab safety:** the API treats a replayed refresh token as theft and signs out every
  device. So every refresh runs under one Web Lock (`jawwid.admin.refresh`) and reads the token
  *inside* the lock. A tab that waited presents the token the previous tab just wrote. Browsers
  without Web Locks are not offered the checkbox.
- **Signing out:** signing out in one tab removes the shared token, and the other tabs follow
  at once (`storage` event).
- **Failures:** only a 4xx *refusal* of the refresh ends the session. A network error or a 5xx
  keeps the token, so a laptop that wakes up offline does not sign out every tab.
- **Device names:** each browser signs in under its own device name ("Chrome on macOS"), so
  Devices & sessions can tell browsers apart.

## 5. Not in phase A

- **Phase B: passkeys (WebAuthn) on Admin Web.** Touch ID / Windows Hello / a phone as a
  phishing-resistant second factor, required for the super admin. **Blocked on a production
  HTTPS domain** (the relying-party id); none is recorded in this repository.
- **Phase C: passkeys in the app**, replacing typing the password after expiry or sign-out.
  It needs the same domain linked to the apps (apple-app-site-association, assetlinks.json).
- **Not planned:** e-mail or SMS one-time codes. Accounts sign in with a login identifier and
  have no e-mail column, there is no SMS provider, and contact channels stay out of the app
  (BR-2). A QR-code sign-in to Admin Web from a phone that is already signed in is possible
  later, but it can be phished, so passkeys come first.
