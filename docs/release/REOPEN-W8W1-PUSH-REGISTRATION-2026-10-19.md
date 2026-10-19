# Reopen record — W8-W1 push registration never starts (2026-10-19)

**State: REOPENED BY EXPLICIT AUTHORIZATION** (product owner, 2026-10-19: "reopen W8-W1 to fix
push") under the Critical Defect Reopen Protocol. **Not closed**: closure needs the owner's
explicit CLOSED authorization, and the items still open from the earlier W8-W1 reopen
(`REOPEN-W5-W8W1-2026-10-14.md` §4) still apply.

| Workstream | Previous CLOSED SHA | State before this record |
|---|---|---|
| W8-W1 — voice-call push delivery | `814fda0` (`claude/voice-calls-production-76022c`) | already REOPENED since 2026-10-14 (RT-037/RT-038, push privacy), not re-closed |

## 1. Authorized scope — and nothing else

Make push registration actually start in the running app: a session that is restored at
launch, or signed in afterwards, registers this device's push tokens; a session that ends
retires them. Plus the regression tests that prove it.

Out of scope and unchanged: the registrar itself (`PushRegistrar`), token routing, the VoIP
activation gate (`APNS_VOIP_ENABLED` stays OFF until W8-W3 ships CallKit), the server side,
templates, and every other W8-W1 behavior.

## 2. The defect (verified before any change)

`main()` started registration with `container.read(pushRegistrarProvider)`. That runs while the
stored session is still being restored (`AuthUnknown`), so the provider sees no account and
yields null. The provider watches the account id, but Riverpod pauses a provider that nobody
LISTENS to and only recomputes it on the next read -- and nothing in the app ever reads it
again. So:

- a session restored at launch: **never registered**;
- a sign-in after launch: **never registered**;
- consequently no push, and no incoming-call push, could ever reach a device running the app.

The W8-W1 suite did not catch it because every test built the registrar with the account
already signed in -- the one order a real launch never produces.

Found by the app-launch audit of 2026-10-17 (PR #44). Verified twice: a probe reproducing
`main()`'s order (`starts=0 registered=0`), and the new regression tests below, which were run
red against the old behavior before the fix.

## 3. What changed

| File | Change | Behavior change |
|---|---|---|
| `lib/core/push/push_registration.dart` (W8-W1) | new `startPushRegistration(container)`, which LISTENS to `pushRegistrarProvider` for the life of the app | the registrar is rebuilt on every session change, as its own documentation always said it was |
| `lib/main.dart` | calls `startPushRegistration(container)` instead of a one-off `read` | registration starts after restore and after sign-in; sign-out retires tokens |
| `test/core/push/push_registration_launch_test.dart` | new: starts registration during `AuthUnknown`, as `main()` does | — |

`PushRegistrar`, `pushRegistrarProvider` and every other line of W8-W1 are untouched.

## 4. Closure evidence

| Evidence | Status |
|---|---|
| New launch-order tests: restored session registers; sign-in after a signed-out launch registers; sign-out retires, next account registers | 3/3 green; **3/3 red** against the old one-off `read` (run before the fix) |
| The full W8-W1 client suite (`test/core/push`) | 22/22 |
| Full Flutter suite, `flutter analyze lib test` | 1176 passed; no issues |
| A real device registering a token with the API after a restore and after a sign-in | **NOT RUN** — needs a signed device build with the Push entitlement and a reachable API. Required before closure. |
| Real APNs/FCM delivery | **NOT RUN** — unchanged carry-forward from the original closure (needs provider credentials). |

Re-closure requires the rows above plus the open items of the 2026-10-14 reopen, and the
owner's explicit CLOSED authorization.
