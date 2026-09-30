# W8 dependency log

Every dependency W8 adds is recorded here before it is installed, with the
reasoning that justified it. A dependency that is not in this log was not
authorized.

The manifest exception is bounded: it covers `apps/api/package.json` and its
lockfile, for the packages below and nothing else. W1–W7 application code is not
modified to accommodate any of them.

---

## W8-W1 — push transport

Authorized under **AD-1**: *do not hand-roll cryptographic primitives; prefer a
maintained implementation; use the smallest required dependency surface.*

Both packages exist only to perform provider **authentication**, which is the
code AD-1 exists to keep out of this repository: APNs requires an ES256 JWT
rotated on a schedule and carried over HTTP/2, and FCM v1 requires an OAuth2
access token obtained by signing a service-account JWT. Signing either by hand
with `node:crypto` is precisely the "wrong in subtle ways" class of code that
W5 rejected when it chose LiveKit's official webhook verifier over a homemade
HMAC.

### `@parse/node-apn`

| | |
|---|---|
| Version | `8.1.0` |
| License | MIT |
| Last published | 2026-04-12 |
| Maintenance | the maintained fork of `node-apn`, which is itself unmaintained |
| Affected manifest | `apps/api/package.json` + `package-lock.json` |

**Why it is required.** APNs is not a REST call. It is a long-lived HTTP/2
connection, a provider JWT signed with ES256 and refreshed on Apple's schedule,
per-notification headers (`apns-topic`, `apns-push-type: voip`,
`apns-priority`, `apns-expiration`), and a documented reason-code taxonomy that
must be mapped to "this token is permanently dead" versus "try again". This
package owns all of it.

**Why existing dependencies are insufficient.** Nothing in the API speaks HTTP/2
or holds a provider connection. `jose` is present only transitively through
`livekit-server-sdk`, and depending on a transitive package directly is
forbidden.

**Security implications.** It holds the APNs signing key in memory. The key is
supplied as configuration and never logged; `PushProvider` already logs only a
truncated token and a boolean. It performs no authorization and never sees a
Jawwid actor.

**Rollback.** Remove the two lines from `package.json`, delete
`apns.provider.ts`, and the selector falls back to `LoggingPushProvider` — which
is exactly today's behaviour.

### `google-auth-library`

| | |
|---|---|
| Version | `11.1.0` |
| License | Apache-2.0 |
| Last published | 2026-09-16 |
| Maintenance | Google's own, actively released |
| Affected manifest | `apps/api/package.json` + `package-lock.json` |

**Why it is required.** FCM HTTP v1 authenticates with a short-lived OAuth2
access token, obtained by signing a service-account JWT (RS256) and exchanging
it. This library does that and caches the result.

**Why `firebase-admin` was NOT chosen.** It is the obvious package and it is the
wrong one here. It carries Firestore, Realtime Database, Cloud Storage, Auth and
App Check into a service that needs one HTTPS POST to one endpoint. AD-1 asks for
the *smallest* required surface; `google-auth-library` is the authentication half
alone, and the send is a `fetch` against the documented v1 endpoint.

**Security implications.** It holds the service-account private key in memory,
supplied as configuration and never logged. It performs no authorization.

**Rollback.** Identical to the above: remove the dependency, delete
`fcm.provider.ts`, selector falls back to `LoggingPushProvider`.

### Not added

* `firebase-admin` — see above.
* Any Flutter push plugin — the client uses the OS frameworks through a
  W8-owned platform channel, so `pubspec.yaml` (W2/W4-closed) is untouched.
