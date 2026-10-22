# PD-20 · Account administration

Decision record: `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4, PD-20 (closed 2026-10-22).
Permission matrix: `../architecture/AUTHORIZATION-MODEL.md` §3, footnote ⁵.
Wire contract: `../contracts/API-CONTRACT.md` §3.1 (`POST /auth/password-reset`) and §3.10a.

| Part | What | State |
|---|---|---|
| B | Password reset by one-time code | built |
| A | Set inactive / reactivate | built |
| C | Impersonation ("support session") | designed below; not built yet |

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

## Impersonation — design (C, not built yet)

Owner decisions:
- parent **and** teacher accounts only (never staff);
- messages sent while impersonating are **allowed but labelled** to recipients;
- the same "who may" rule as above.

- `POST /admin/impersonations {accountId, reason}` creates a **support session**: a
  `chat.session` row for the target, marked with its `chat.impersonation_session` (the
  administrator, the target, the reason, the start, a hard 60-minute expiry). It returns a
  15-minute access token **only**, with no refresh token. Extending the session and
  **Exit** (`…/:id/end`) use the administrator's own token.
- Every request on a support session also checks that the administrator is still live,
  still allowed, and that their own session is alive. Signing the administrator out or
  suspending them ends it.
- Every write request is recorded against the support session (method, route, status; no
  bodies). Every audit row written meanwhile carries the support-session id.
- Messages and calls carry the support-session id, and clients label them "sent by support
  on behalf of …".
- Read receipts and delivery acknowledgements are not sent, `last_login_at` is not
  touched, no push device is registered, and presence is not shown.
- The account's password cannot be changed, and no account administration can be done,
  from inside a support session.
- Admin Web shows the parent or teacher view with a permanent "Acting as … — Exit" banner.
  The administrator's own session is never replaced.

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
