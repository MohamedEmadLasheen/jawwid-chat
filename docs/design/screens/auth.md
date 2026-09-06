# Screen: Sign in

**Priority:** P0 · **Platform:** Flutter + Admin Web · **Owner:** AI #3 / AI #4

---

## 1. Role and purpose

**All roles.** One screen, one job: *"get the right person in, and tell them clearly when it
didn't work."*

MVP is **username + password**. No public registration — accounts are created by Jawwid. No OTP
reset in MVP; recovery is a human route.

**Primary action:** sign in. **Secondary:** change language · get help.

## 2. Layout

```
        Jawwid
        ────────────────────────
        Username   [            ]
        Password   [         👁 ]
                          [ Sign in ]

        Trouble signing in?
        العربية / English
```

Single column, centred, max 360px. Identical structure on both platforms; the mobile version
puts the primary action within thumb reach and above the keyboard.

- Labels are **visible and above** the fields — placeholder-as-label fails in Arabic and fails
  for screen readers (`design-system.md` §7.2).
- The password field has a reveal toggle. It does **not** mirror in RTL (an eye is an object).
- The language switch is on this screen, before sign-in, because a user who cannot read the
  interface cannot reach Settings to change it.
- No "remember me" checkbox — sessions persist by default; a checkbox implies the alternative
  is meaningful and it is not.

## 3. Error taxonomy — the reason this screen needs a spec

The backend must return **distinguishable, machine-readable codes** for each of these `[BE]`
(AI #3's C1). The app reacts differently to every one, and collapsing them into one message is
the most common and most expensive auth mistake.

| Cause | Message | Behaviour |
|---|---|---|
| Bad credentials | *"That username or password isn't right."* | Stay on the form. Password clears, username kept. Never say which field was wrong. |
| Account disabled | *"This account is no longer active. Contact Jawwid to restore access."* | Stay; offer the help route. **Not** a credential error — a signed-off employee retrying their password forever is a support ticket that never needed to exist. |
| Session revoked | *"You were signed out on another device."* | Clear local sensitive state; return to the form. |
| Session expired *(mid-session)* | *"Your session ended. Sign in to continue."* — a **sheet**, not a screen | **The composer draft and the current screen are preserved** and restored after sign-in (journey J24). |
| Rate limited | *"Too many attempts. Try again in a few minutes."* | Disable submit with a visible countdown. |
| Network | *"We can't reach Jawwid. Check your connection."* | Retry, offline banner. |
| Server error | *"Something went wrong on our side. Try again."* | Retry. **Never a stack, never a code, never an endpoint.** |

Errors render below the form in `status.danger`, with an icon and text, and are announced
assertively to screen readers.

## 4. States

- **Idle** — submit disabled until both fields have content.
- **Submitting** — button spinner, fields locked, width preserved so nothing jumps.
- **Error** — per §3.
- **Success** — route by role: **parent** → Parent Home · **teacher** → Teacher Home ·
  **admin / coverage** → Inbox · **manager** → Manager Dashboard · **finance / technical /
  academic** → Tasks. The landing screen *is* the role's primary question; sending a manager to
  an inbox would be sending them to someone else's job.
- **Deep-linked while signed out** — sign in, then land on the **original target**, not on home.

## 5. Security-adjacent design rules

- The password is never persisted. Tokens go to platform secure storage `[BE]` (AI #3's C1).
- No biometric unlock in MVP.
- The role is **server-asserted** on every session and never trusted from local cache
  (AI #3's D3). The UI renders the navigation the server says the user has.
- No account enumeration: a wrong username and a wrong password produce the same message.
- The app never displays a token, a session id, or an endpoint anywhere in the UI.

## 6. RTL · Accessibility · Responsive

Fields, labels and the reveal toggle mirror; the eye glyph itself does not. Latin usernames stay
LTR inside an RTL form. Every field is labelled and its error is programmatically associated;
tab order is username → password → reveal → submit; `Enter` submits from either field.
Mobile: fields above the fold with the keyboard open, at 320px and 200% text scale.

## 7. Edge cases

- **Signed in on many devices** — allowed; revocation is per session from Settings.
- **Password changed elsewhere** — the next call returns *session revoked*, not a bad-credentials
  error.
- **Two roles for one human** (a teacher who is also a parent) — out of MVP scope; flagged in
  `teacher-home.md` §7 so it is a decision rather than a surprise.
- **Clock skew** — token expiry is server-driven; the client never decides a token is expired.

## 8. Backend dependencies

`POST /auth/login` returning access + refresh tokens with expiries, and the `staff`/principal
record · `POST /auth/logout` · refresh · `GET /me` with a **server-asserted role** · device and
session registry with revoke · **distinguishable error codes for every row in §3** — this is the
single most important thing this screen needs and it does not exist yet.
