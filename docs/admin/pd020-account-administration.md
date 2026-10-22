# PD-20 · Account administration

Decision record: `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4, PD-20 (closed 2026-10-22).
Permission matrix: `../architecture/AUTHORIZATION-MODEL.md` §3, footnote ⁵.
Wire contract: `../contracts/API-CONTRACT.md` §3.1 (`POST /auth/password-reset`) and §3.10a.

| Part | What | State |
|---|---|---|
| B | Password reset by one-time code | built |
| A | Set inactive / reactivate | built |
| C | Impersonation ("support session") | built |

## Who may do what

One rule, `AuthorizationService.canAdministerAccount(actor, target, act)`, for every act
(`reset_password`, `suspend`, `reactivate`, `impersonate`):

| Caller \ target | parent (family) | teacher | another staff member | the super admin | own account |
|---|:-:|:-:|:-:|:-:|:-:|
| any staff role (admin, coverage, manager, finance, technical, academic) | ● | ● | — | — | — |
| super admin | ● | ● | ● (never impersonated) | — | — |
| parent, teacher | — | — | — | — | — |

- Same organization only. Another tenant's account answers **404**, never 403, so the status
  does not reveal that the id exists elsewhere.
- A non-staff caller is refused before any account is looked up.
- Students have no login (a learner has no account). "A student's account" is the family
  account that holds the children; the Accounts list finds it by a child's name.
- The Admin Web hides what `allowed` says is not allowed; that is a convenience. The server
  decides every action again.

## Password reset (B)

1. The administrator opens **Accounts**, chooses **Reset password**, writes a reason, and
   optionally ticks **sign them out on every device now** (a compromised account).
2. The server supersedes any live code and stores a new one, **hash only**
   (`chat.password_reset_code`): 6 digits, 10 minutes, 5 tries. The plain code is in the
   response and nowhere else. The administrator gives it to the person by hand.
3. The person opens **"Forgot your password? I have a reset code"** in the app or on the
   Admin Web sign-in page and enters their login, the code and a password of their own.
4. In one transaction the code is spent, the password set, the lockout cleared, and every
   session of the account revoked. The person then signs in normally.

Until step 4 the old password keeps working, unless the administrator signed the account
out at step 1. Nobody but the person ever knows a password. The administrator sees a code
that becomes useless once used, after 10 minutes, or after five wrong tries.

**Database guard** (`chat.guard_password_reset_code`): a code is issued by active staff of
the same organization. A staff account's code may be issued only by the super admin. No
code is ever issued for the super admin, or by someone for their own account. A code is
never deleted, its identity never changes, and it only moves forward.

## Set inactive / reactivate (A)

- **Set inactive** sets `chat.account.status = 'suspended'` through
  `chat.deactivate_principal`, which writes the RT-032 journal entry. In the same
  transaction it revokes every session of the account. Then it runs the realtime barrier.
- The account's next request is refused, its sockets are cut, it is removed from call
  rooms, its scheduled notifications are cancelled, and every login answers
  `AUTH.ACCOUNT_DISABLED`.
- **Reactivate** uses `chat.reactivate_account` (server-side only), which moves an account
  from suspended to active only.
  - No earlier session or refresh token comes back, because they were revoked at
    suspension.
  - A `deactivated` account (offboarding) is never reactivated from here.
- Both are idempotent. Repeating either one writes no second audit row.

## Audit

Every act writes `chat.audit_log`, with the administrator's staff id as actor and their
reason, in the same transaction as the change:

| Action | When | Actor |
|---|---|---|
| `account.password_reset_issued` | a code is issued (`after`: code id, expiry, sign-out choice; never the code) | staff |
| `account.password_reset_completed` | the person sets the password (`after`: code id, issuer, sessions ended) | none (the person); issuer in `after` |
| `account.suspended` / `account.reactivated` | status change (`before`/`after` status, sessions ended) | staff |
| `session.revoked` | sessions ended by any of the above | staff, or none on completion |

## Impersonation — support sessions (C)

Owner decisions: parent **and** teacher accounts (never staff); messages sent meanwhile
**allowed but labelled**; the same "who may" rule as above.

**Opening.** From **Accounts → Open as …**, with a reason. `POST /admin/impersonations`
creates `chat.impersonation_session` (administrator, their own account and session, the
target, the reason, the start, an expiry) and a `chat.session` row **for the target**
marked with it. The administrator's browser gets an access token for that session —
**and no refresh token** (one is generated and discarded). Admin Web keeps it in memory
only; a reload asks for a new one with the administrator's own session.

**Lifetime.** 15 minutes per step (**Keep working**), never more than an hour from the
start (`impersonation_session_at_most_an_hour`). One live support session per
administrator: opening another ends the first. Every request on the support token
re-checks, in `AuthService.authenticate`:
- the support session is neither ended nor expired;
- the administrator's own session is live: signing out ends it, while a token refresh
  carries the support session over to the rotated session (the database allows that move
  through a rotation only);
- the administrator's account and staff row are live (suspending them ends it);
- `canAdministerAccount(…, 'impersonate')` still allows it.

Any failure ends the support session on the record and answers `401`.

**What it may do** (`SupportSessionInterceptor`, deny by default). Reads are allowed:
seeing what the person sees is the point, and no read route writes anything (no read
receipt is sent). The writes allowed are:
- sending a message, labelled;
- the person's own profile, photos, children's photos, a teacher's own professional
  profile and leave requests;
- private state: star, delete-for-me, chat preferences.

**Everything else is refused** with `COMM.SUPPORT_SESSION_FORBIDDEN`, because it would act
in the person's name where others see it, unlabelled:
- read and delivery receipts, reactions, pins, edits, deletes for everyone, forwards;
- **calls of every kind** (see below);
- story views and taps, push devices, notification acknowledgements;
- lesson reports, apologies and bookings (they post cards in the person's name);
- new chats or member changes;
- logout (Exit ends it from the administrator's own account).

The realtime gateway refuses a support token outright, so there is no presence, no
delivery acknowledgement, and no way round the HTTP allowlist. A support session cannot
reach any account administration either: its actor is the parent or teacher.

**The label.** `chat.message.impersonation_id` is set on every message sent in a support
session. Every client shows `MessageDto.sentBySupport` as **"Sent by support" / «أرسلها
الدعم»**: Admin Web's chat, the support view, and the mobile app, including to the person
themself. Who the administrator was is in the record, not on the message.

**The record.**
- `chat.impersonation_session`: who, whom, why, start, expiry, end and how it ended.
  Never deleted; the database refuses a staff target, a session over an hour, and any
  rewrite.
- `chat.impersonation_action`: every request, refusals included (method, route
  template, status; never a body). Append-only.
- `chat.audit_log.impersonation_id`: set on every audit row written during the session.
  `PrismaAuditService` stamps it from the request context, so no writer has to remember.
- Audit rows for the session itself: `impersonation.started`, `impersonation.extended`
  and `impersonation.ended`, with the administrator as actor and their reason.
- Where to see it:
  - Admin Web **Accounts → Support sessions**: the super admin sees the whole
    organization, anyone else their own;
  - `GET /admin/impersonations/:id/actions`: the full trail.

**Calls — a deliberate departure.** The plan said calls started in a support session
would carry the label too. They are **refused** instead. A live voice call in the
person's name is the administrator's own voice, and a label on the call screen is weaker
than a text label. Labelled calls need call-screen work on both clients; they can be
added later as their own change.

**What the administrator sees.** Everything the person sees, the parent's login e-mail on
their own profile included. Since every staff role may open parent and teacher accounts
(owner decision), staff who otherwise never see family data (finance, technical,
academic) can see it here, on the record.

## Known limits

- **RT-037**: a signed media link handed out before a suspension stays usable until it
  expires. This is unchanged by PD-20; see `../red-team/findings.md`.
- The API connects as the table owner, so row-level security is not engaged
  (`../security/RLS-STRATEGY.md` §7). `AuthorizationService` is the boundary, and the
  tests prove it over real HTTP.
- No WhatsApp sender is connected; codes are relayed by hand, exactly like the PD-16
  sign-up code.

## Tests

- `apps/api/test/unit/account-admin/account-admin-authorization.spec.ts`: the full rule,
  every role against every kind of target.
- `apps/api/test/integration/pd020-account-admin-http.spec.ts`: over real HTTP:
  - who may;
  - code only, never a password;
  - five misses spend a code;
  - superseding;
  - signing out everywhere;
  - the database guard;
  - suspension refuses the next request and every login;
  - reactivation revives nothing;
  - offboarding is never reversed;
  - audit rows.
- `apps/admin-web/src/features/accounts/Accounts.test.tsx`: the page and the sign-in reset
  form.
- `test/features/auth/password_reset_test.dart`: the mobile reset screen.
- `apps/api/test/integration/pd020-impersonation-http.spec.ts`: over real HTTP:
  - who may;
  - acting as the person, with the labelled message;
  - no receipts;
  - the trail and the audit stamping;
  - every refusal;
  - ending on Exit, on the administrator's sign-out and on their suspension;
  - one session per administrator;
  - re-tokening only by its administrator;
  - the database guard;
  - the record.
- `apps/api/test/unit/account-admin/support-session-allowlist.spec.ts`: the allowlist,
  deny by default.
- `apps/admin-web/src/features/support/Support.test.tsx`: opening, the support token
  never replacing the staff session, the label, Exit, reload.
- `test/features/messages/sent_by_support_label_test.dart`: the mobile label.
