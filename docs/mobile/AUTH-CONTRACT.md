# Jawwid Chat — Mobile Authentication Contract

Status: **CANONICAL** · Phase 1 closure (2026-09-07)
Audience: whoever implements `AuthRepository` in the Flutter client.
Server implementation: `apps/api/src/platform/auth/`. Error codes:
`../communication/error-codes.md`. Throttling: `../security/AUTH-THROTTLING.md`.

> **The mobile application has not been changed.** No Dart toolchain is
> installed on the machine Phase 1 was built on, and writing unverified Dart to
> claim completion would have been worse than leaving the gap visible. What
> follows is the contract the server now enforces, written so the client work is
> a transcription rather than a discovery exercise.

---

## 1. The seam is gone, server-side. Nothing needs to be removed first.

`lib/core/network/actor_identity.dart` still contains
`DebugActorHeaderIdentity`, which attaches `x-actor-id` in debug builds. **It is
inert.** The server reads that header nowhere: `AuthGuard` looks only at
`Authorization: Bearer`, and a request carrying `x-actor-id` and no bearer token
is refused with `AUTH.MISSING_TOKEN` — byte-identical to a request carrying no
headers at all.

Two tests hold that shut, and both will fail if it is ever undone:

* `test/unit/auth/no-header-identity.spec.ts` greps every source file for
  `x-actor-id` and for `handshake.auth.actorId`, ignoring comments, and drives
  `AuthGuard` with exactly the request the debug client sends.
* `docs/qa/protected-tests.tsv` protects that file from deletion.

So the client can be migrated at its own pace. Deleting
`DebugActorHeaderIdentity` is tidiness, not a security fix.

---

## 2. What the client must do

### 2.1 Sign in

```
POST /api/v1/auth/login
{
  "subject":  "<opaque account subject>",   // NOT an e-mail address (§2.6)
  "password": "<plaintext, over TLS>",
  "device": {
    "clientKey":   "<stable per-installation id>",   // required for §2.4
    "platform":    "ios" | "android",
    "appVersion":  "1.4.2",
    "displayName": "Fatima's iPhone"
  }
}
→ 200 { accessToken, refreshToken, expiresIn, actor }
```

`device.clientKey` must be **stable across launches and regenerated on
reinstall**. It is what makes "log out my other phone" mean something and what
stops a re-login consuming a second device slot. Derive it once and keep it in
the keychain beside the tokens — never from a hardware identifier the platform
would reject.

### 2.2 Every subsequent request

```
Authorization: Bearer <accessToken>
```

The access token is a short-lived HS256 JWT (default 15 minutes,
`auth.access_token_ttl_seconds`). Three things are checked on **every** request:
the signature, the session row, and the principal. So a logout, a device
revocation, a suspension or a password reset takes effect on the client's next
call — not at token expiry.

### 2.3 Refresh

```
POST /api/v1/auth/refresh   { "refreshToken": "..." }
→ 200 { accessToken, refreshToken, expiresIn, actor }
```

**The refresh token is rotated on every use.** The client must replace both
stored tokens atomically. Two concurrent refreshes will race and one will lose:
serialise them behind a single in-flight future, or a legitimate client will log
itself out. A spent refresh token returns `AUTH.SESSION_INVALID`, and the
correct response is to sign in again — never to retry.

### 2.4 Devices and sessions

```
GET    /api/v1/me/sessions        → the account's live sessions
DELETE /api/v1/me/sessions/:id    → revoke one
DELETE /api/v1/me/sessions        → revoke all, including this one
```

Revocation is scoped to the caller's account **inside the query**, so naming
somebody else's session id returns `AUTH.NOT_FOUND` rather than revoking it.

The device limit (`auth.max_active_devices`, default 5) is enforced at login.
The default policy is `revoke_oldest`, so a sixth device signs in and the least
recently seen session ends — the client should treat a sudden
`AUTH.INVALID_TOKEN` as "signed out elsewhere" and return to the sign-in screen
without alarming the user.

### 2.5 The password lifecycle

```
POST /api/v1/auth/change-password { currentPassword, newPassword }
POST /api/v1/auth/forgot-password { subject }          // always 200
POST /api/v1/auth/reset-password  { token, password }
```

* **Change** keeps the caller's session and ends every other one.
* **Reset** ends **every** session for the account, including the caller's. The
  client must return to sign-in after a successful reset.
* **Forgot-password always returns the same body**, whether or not the subject
  exists. The client must not infer anything from it, and must not render a
  message that implies it did.

### 2.6 `subject`, not e-mail

`chat.account` carries **no contact channel** — no e-mail, no phone, no handle
(BR-2, enforced structurally by
`test/unit/privacy/no-contact-channel-columns.spec.ts`). The login identifier is
an opaque subject the identity provider owns. A login form that validates its
field as an e-mail address will reject valid subjects.

There is **no public registration**. Accounts are provisioned by a `super_admin`
or synced from Jawwid Core, so the client needs no sign-up flow.

### 2.7 The WebSocket

```
io(url, { auth: { token: accessToken } })
```

The socket authenticates with the **same bearer token**, verified by the same
service. `handshake.auth.actorId` is read by nothing.

The socket re-validates its identity roughly every 30 seconds on
`presence.heartbeat`, so the client should keep sending heartbeats. Two things
follow:

* If the session has ended, the server **disconnects the socket**. Reconnect
  only after a successful refresh; a reconnect loop on a dead session is how a
  client hammers a server it can no longer talk to.
* If the actor loses access to a conversation it is subscribed to — a family
  reassigned to another supervisor, a member removed — the server removes the
  socket from that conversation and emits:

```json
{ "event": "conversation.access_revoked",
  "conversationId": "…",
  "reason": "out_of_scope" | "not_a_member" | "session_ended" }
```

The client must close or lock that conversation on receipt. It will receive no
further events for it, and a re-subscribe will be refused.

### 2.8 Token storage

Access and refresh tokens go to the platform keystore/keychain
(`flutter_secure_storage`), never to `SharedPreferences`, and are never logged —
`RedactingLogger` already covers the transport, and the token must not reach it
in the first place.

---

## 3. Error codes the client must branch on

| Code | HTTP | What the client should do |
|---|---|---|
| `AUTH.INVALID_CREDENTIALS` | 401 | "Wrong username or password." **Do not** distinguish the two — the server does not, deliberately |
| `AUTH.ACCOUNT_DISABLED` | 401 | "This account is not active. Contact Jawwid." Terminal; do not retry |
| `AUTH.ACCOUNT_LOCKED` | 401 | "Too many attempts. Try again later." Terminal for now |
| `AUTH.TOO_MANY_ATTEMPTS` | 429 | Same message as above. Back off; do not retry automatically |
| `AUTH.MISSING_TOKEN` / `AUTH.INVALID_TOKEN` | 401 | Refresh once; if that fails, sign out |
| `AUTH.SESSION_INVALID` | 401 | Sign out. The refresh token is spent or revoked |
| `AUTH.DEVICE_LIMIT_REACHED` | 403 | Only under the `reject_new` policy. "Too many devices — sign out of one first" |
| `AUTH.WEAK_PASSWORD` | 400 | Show the minimum length from `/config` |
| `AUTH.INVALID_RESET_TOKEN` | 400 | "This link has expired." Offer to request a new one |
| `COMM.OUT_OF_SCOPE` | 403 | The record moved out of reach. Refresh the list; do not retry |
| `COMM.CONVERSATION_NOT_FOUND` | 404 | Also what an unauthorized id returns. Treat as gone |

Note the last two together: a by-id route answers **404** for a record that
exists but is out of reach, exactly as for one that never existed. The client
must not treat 404 as "safe to retry with a different id".

---

## 4. Remaining client-side integration points

Each is a discrete piece of work in the Flutter app. None is blocked by the
server.

| # | Where | What |
|---|---|---|
| 1 | `lib/core/data/http/unavailable_auth_repository.dart` | Replace with an `HttpAuthRepository` implementing §2. Every method currently throws `auth_contract_not_published`; that is now false |
| 2 | `lib/core/network/actor_identity.dart` | Delete `DebugActorHeaderIdentity`; `BearerTokenIdentity` is the only implementation |
| 3 | `lib/app/bootstrap.dart` | Drop `debugActorId` and the fallback actor; identity comes from `/me` |
| 4 | Token store | Keychain via `flutter_secure_storage`; a single in-flight refresh future (§2.3) |
| 5 | `clientKey` | Generate once, persist in the keychain, regenerate on reinstall |
| 6 | Socket client | `auth: { token }`, heartbeat, and handle `conversation.access_revoked` (§2.7) |
| 7 | `lib/features/auth/presentation/sign_in_screen.dart` | Label the field for a **subject**, not an e-mail; remove any e-mail validator |
| 8 | Session screen | `/me/sessions` list, revoke one, revoke all |
| 9 | `test/features/auth/auth_controller_test.dart` | Extend for rotation, revocation and the reset-signs-you-out path |

## 5. What the server guarantees while that work is pending

* A legacy client that sends `x-actor-id` is **unauthenticated**, not trusted.
* No endpoint accepts an actor, role, tenant or owner from a request body.
* The mobile gap is a *feature* gap — the app cannot sign in yet — and never a
  security gap. Nothing was weakened to accommodate it.
