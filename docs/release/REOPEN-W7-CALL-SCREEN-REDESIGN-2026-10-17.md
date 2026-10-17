# Reopen record — W7, the call screen redesign (2026-10-17)

**State: REOPENED BY EXPLICIT AUTHORIZATION** (product owner, 2026-10-17, in session: *"Both
now"* — redesign the phone and web call screens together). **Not closed**: closure needs the
evidence in §4 and the owner's explicit CLOSED authorization.

| Workstream | Previous CLOSED SHA | Branch it was closed on |
|---|---|---|
| W7 — the user-facing voice-call experience (Flutter) | `8d71f34` | `claude/voice-calls-production-76022c` (since merged to `main`) |

The Admin Web call screen (Stage 3, `abe155d`) was never part of W7 and is not frozen; it
changes in the same piece of work so both surfaces look and behave alike.

## 1. Authorized scope — and nothing else

1. **Presentation.** A WhatsApp-style call screen on the phone and a floating call window on the
   web: a dark surface, a large avatar, the name, a status line, controls on a rounded panel.
   The owner supplied the reference screenshots.
2. **After a call that did not connect:** *Cancel*, *Record voice message* and *Call again*.
   *Record voice message* opens the conversation with the recorder already running; it reuses
   the existing record → review → send flow, it does not record the call. *Call again* places a
   NEW call in the same conversation, which the server authorizes exactly like any other.
3. **Web voice messages** (record, send, play) in the Admin Web chat, which only sent text.
4. The tests that prove 1–3.

**Explicitly out of scope** (owner choice of 2026-10-17: only controls that work): video,
screen share, adding a participant, "remind me". Also out of scope: the call lifecycle, call
routing, authorization, CallKit / PushKit, and `CallMediaClient` (W4) — see §5.

## 2. What stays exactly as frozen

Every frozen W7 decision holds. In particular:

- **The UI creates no second lifecycle.** Terminality still comes only from the server's
  `call.ended`, an unambiguous `call.declined`, or a terminal request the client made. *No
  answer* is the label for the server's `missed` outcome on a call this device placed — the
  client still never names an outcome of its own.
- **D1(a)** speaker routing and **D2(a)** derived call cards are unchanged.
- `docs/design/screens/call.md` §6: the end-call button stays the largest target on screen and
  is never adjacent to mute; the timer stays an LTR run; mute and speaker glyphs do not mirror.
  The reference screenshots put *End* beside other controls; this design keeps the spec.
- §2.2 *No recording UI*: a voice **message** is a chat message, not a call recording.

## 3. What changed

### Phone (W7)

| File | Change | Behavior change |
|---|---|---|
| `lib/features/calls/presentation/active_call_screen.dart` | Rewritten: dark screen, 128 dp avatar, name, status; controls on a rounded bottom panel. Ended screen: Close · Record voice message · Call again. Failed: Close · Send a message instead · Try again | Look and layout. *Missed* reads "No answer" on a call placed here, "Missed call" on one that rang here; a zero duration is not shown |
| `lib/features/calls/presentation/call_controls.dart` | Round labelled buttons (`CallRoundButton`); Speaker + Mute on one row, End alone below and largest; the label is part of the tap target | none beyond layout; `call.md` §6 kept |
| `lib/design/tokens.dart` | `CallPalette` (the call screen is always dark) | — |
| `lib/features/calls/application/call_controller.dart` | `CallDirection` on the state; `callAgain()` (only from `ended`); a ring replaces a screen that only shows a FINISHED call | A new ring used to be swallowed while the previous call's ended screen was open (seen live 2026-10-16/17); it now rings. A call that may still exist (failed with a callId, ringing, live) is still never interrupted (§7) |
| `lib/app/router.dart` | `openConversationFromCall`: pops the call route, then replaces the chat if it is underneath, else pushes it; `?voice=1` | Back never lands on the same chat twice |
| `lib/features/messages/presentation/chat_screen{,_route}.dart` | `startVoiceRecording` starts the existing recorder after the first frame; never in a read-only chat | — |
| `lib/l10n/app_{en,ar}.arb` (+ generated) | 6 strings, Arabic and English | — |

### Admin Web (Stage 3, not frozen)

| File | Change |
|---|---|
| `features/calls/CallOverlay.tsx`, `calls.css`, `copy.ts` | The floating, draggable, always-dark call window; same states and actions as the phone; Message stays available during a live call because the window floats over the chat |
| `features/calls/callController.ts` | `direction`, `callAgain()`, ring-replaces-finished — the same three rules as the phone |
| `features/calls/callMedia.ts` | (2026-10-16 fix) a LiveKit reconnect no longer turns a refused microphone into "live"; no orphaned `<audio>` elements |
| `features/chat/VoiceRecorder.tsx`, `voiceNote.ts`, `voice.css`, `chatApi.ts`, `ChatPage.tsx`, `copy.ts` | Web voice messages: record → review → send (authorize → signed PUT without a bearer → `voice` message, retry-safe id); playback in the thread; `?voice=1` auto-starts |
| `app/App.tsx` | the call window moved inside the router |
| `infra-nginx/default.conf.template`, `Dockerfile`, `docs/infrastructure/decisions.md` | `STORAGE_ORIGIN` in `connect-src`; `API_ORIGIN` + `STORAGE_ORIGIN` in `media-src` |

### API — a separate defect, owner-approved 2026-10-17

`apps/api/src/communication/api/storage.controller.ts`: `@Public()`. The route was documented
"unauthenticated by design" (the signed URL is the authorization) but the global bearer guard
(PR-B) answered 401 to every upload and read, so on local storage no attachment could be stored
or played, from the phone or the web. Same class as RT-038a (the LiveKit webhook). Production on
S3 never reaches this route. The signature check is unchanged and is now the check that runs.

## 4. Closure evidence

| Evidence | Status |
|---|---|
| Phone: `flutter analyze` clean; full suite | **1142 passed**, 17 skipped — all pre-existing, environment-gated live-server tests (`JAWWID_LIVE_*` / `JAWWID_RT_*`), none new |
| Phone call tests: the original W7 assertions kept (labels, End largest and not beside Mute, LTR timer, no code / number / room on screen); new: No answer vs Missed call, Call again (new call, refusal shown once, never from failed), Record voice message opens the chat recording and ends nothing, label is part of the target, ring replaces a finished call, no 0:00 | 173/173 in `test/features/calls`; `open_conversation_from_call_test` 3/3; `voice_composer_widget_test` 17/17 |
| Admin Web: typecheck, production build, full suite | **266 passed**, 0 skipped |
| API: `storage-http.spec.ts` over real HTTP (signed PUT/GET with no bearer accepted; no / forged / expired / other object's / wrong MIME / oversize / read-as-write all refused by the SIGNATURE; other routes still 401) | 11/11; **10/11 red without the fix**; with the attachment, voice-attachment and webhook suites: 45/45 on a database migrated from this branch |
| Mutation: 17 mutants over the new rules (web 10, phone 7) | **17/17 killed**, every file restored byte-identical |
| Live, QA stack (API + real LiveKit 1.13.7), web pane ↔ iOS simulator | incoming (dark), in call (timer, Speaker/Mute, End), ended (Answered 0:28 · Close / Record voice message / Call again), No answer, "Record voice message" → chat recording → sent → admin web plays it (11 s); web voice note → plays on the phone; Call again both ways; a ring over a finished screen both ways |
| Two-way audio with a real microphone on the web | **owner's Chrome** — the pane denies the microphone |
| Owner's explicit CLOSED authorization | pending |

## 5. Found while testing, not in this scope

- **Admin Web disconnected every 15 s on LiveKit 1.8.4** (2026-10-17): `livekit-client` 2.22.4
  opens a `_data_track` channel 1.8.4 rejects, negotiation times out, the client rejoins. QA's
  LiveKit was upgraded to v1.13.7 and both sides then held one session. Deployments must run a
  LiveKit server new enough for the web client — record the minimum before release.
- **Phone stuck on "Connecting…"** (2026-10-17): when `room.connect` fails, `CallMediaClient`
  releases the room, `Room.disconnect()` times out, and the exception escapes, so the failure
  is never shown. Owner: W4 (`lib/core/call_media/call_media_client.dart`). Not changed here.
