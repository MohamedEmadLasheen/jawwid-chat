# Reopen record — W4, a failed media connection that is never reported (2026-10-17)

**State: REOPENED BY EXPLICIT AUTHORIZATION** under the Critical Defect Reopen Protocol (product
owner, 2026-10-17, in session: *"i approve"* — fix the phone stuck on "Connecting…"). **Not
closed**: closure needs the evidence in §4 and the owner's explicit CLOSED authorization.

| Workstream | Previous CLOSED SHA | Branch it was closed on |
|---|---|---|
| W4 — the media client (`lib/core/call_media/`) | `79cfcaf` (record corrections `e41576b`) | `claude/voice-calls-production-76022c` (since merged to `main`) |

## 1. Authorized scope — and nothing else

1. A failed connection, publish or leave must always end in a reported state; cleanup must never
   throw.
2. The regression tests that prove it.

Out of scope: the call lifecycle (W6), reconnect policy (none is attempted here, unchanged), the
SDK adapter's behavior on a healthy room, and every W7 surface.

## 2. The defect (verified before any change)

Seen live twice on 2026-10-17 (iOS simulator, `livekit_client` 2.13.0): when `Room.connect`
fails, `CallMediaClient` releases the room before reporting. The SDK's `Room.disconnect()` on a
room that never connected waits for a disconnected event that never comes and throws
`TimeoutException`. That exception escaped `_releaseRoom()`, so `_fail(connectionFailed)` on
the next line never ran: the snapshot stayed `connecting`, the call screen said "Connecting…"
forever, and the exception surfaced as unhandled (`dart_vm_initializer`). The same escape existed
on the publish-failure path, on `disconnect()` (stuck in `disconnecting`) and on `dispose()`.

The existing test 20 ("a room that refuses gives a deterministic failure") passed because its
fake room's `disconnect()` never throws, unlike the real SDK.

## 3. What changed

| File | Change | Behavior change |
|---|---|---|
| `lib/core/call_media/call_media_client.dart` | `_releaseRoom()` never throws: `disconnect()` and `dispose()` are each attempted inside their own `try`, a failure is logged and not raised | a failed connect, publish or leave always ends in its reported state (`failed`, `disconnected`); the release steps are still all attempted |
| same | the room-event subscription is cancelled without awaiting the returned future | cancelling stops delivery immediately; awaiting it could block until the room's broadcast stream closed, which on a failed join is never, so the release stalled before it started (found by the screen-level test) |

`connect()` still awaits the cancel before re-listening: a test for the rejoin-after-server-close
path showed no stall there, so it is unchanged (no change without a failing test).

## 4. Closure evidence

| Evidence | Status |
|---|---|
| Red before the fix | the 6 new `call_media_client_test` cases fail on `e41576b`'s logic (a room whose `disconnect()` times out / `dispose()` throws); the screen-level test still showed "Connecting…" with only the `try`, and passes only with the un-awaited cancel |
| Green after | `call_media_client_test` 44/44 (37 existing unchanged + 7 new, one a rejoin guard); `call_screen_test` adds "an unreachable media room shows the failure, never Connecting… forever"; full phone suite **1150 passed**, 17 skipped (pre-existing env-gated live-server tests); `flutter analyze` clean |
| Live (iOS simulator, QA LiveKit deliberately stopped, 2026-10-17 12:15) | the phone shows "The call could not connect. Check your connection and try again." with Close / Send a message / Try again within seconds; 0 unhandled exceptions in the device log (before: "Connecting…" forever and `Unhandled Exception: TimeoutException`) |
| Owner's explicit CLOSED authorization | pending |

## 5. Noted, not in this scope

- On the phone's failure screen, **Try again** starts a NEW call even when the failed call still
  exists on the server (it was accepted, then media failed). The web shows Hang up in that case.
  This is W7 behavior (closed at `a91c690`), unchanged here.
