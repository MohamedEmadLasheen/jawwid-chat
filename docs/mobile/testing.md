# Jawwid Chat Mobile — Test Strategy and QA Contract

Owner: AI #3 · Audience: **AI #5 (QA / Security / DevOps)**
Status as of this document: `flutter analyze` clean · `flutter test` **166 passing**

---

## 1. What is covered automatically

14 suites, all runnable with `flutter test` and safe for CI — no device, no network, no
platform channels.

```bash
flutter test
```

| Suite | Covers |
|---|---|
| `core/policy/communication_policy_test.dart` | BR-1 in both directions; unknown roles fail closed; exhaustive over role pairs |
| `core/logging/redacting_logger_test.dart` | Bearer tokens, JWTs, international and Egyptian phone formats, nested payloads, message bodies |
| `core/network/error_mapper_test.dart` | The engine's `{error:{code}}` envelope; every `COMM.*` code terminal; transport failures; the error path never throws |
| `core/data/wire_mappers_test.dart` | Conformance to `apps/api/src/communication/contracts/`; 64-bit `seq` precision; moderation outranks receipts |
| `features/messages/message_log_test.dart` | Ordering by server sequence, identity by client id, no duplicate on echo/confirm, resync watermark |
| `features/messages/outbox_test.dart` | Idempotency, per-conversation FIFO, backoff, attempt ceiling, non-retryable parking |
| `features/messages/messages_controller_test.dart` | The whole send pipeline including retry-reuses-id and policy-refusal-not-retried |
| `features/auth/auth_controller_test.dart` | Login, disabled account, revoked session, offline-at-launch, cache clearing |
| `features/conversations/conversation_list_test.dart` | Parent vs teacher sectioning, pinning, archive filtering |
| `app/retry_policy_test.dart` | Which failures retry and which are terminal |
| `app/localization_test.dart` | Locale resolution, RTL/LTR direction, real Arabic strings, long and mixed text |
| `design/directionality_guard_test.dart` | **Source scan**: no physical edges, no colours outside tokens, no phone field, no attention/workload identifiers |
| `design/avatar_test.dart` | Initials for Arabic and Latin names |
| `security/forbidden_affordances_test.dart` | No teacher/parent affordance in either shell, no phone-shaped string rendered, no ops vocabulary on a family surface, no exception text in an error state |

Two of these are **structural guards** rather than behaviour tests — they scan the source
tree and fail if a rule is violated anywhere, including in code written later. They are the
cheapest defence for rules that would otherwise rely on reviewer memory.

## 2. What AI #5 must test that the suite cannot

Everything below needs a real device, a real backend, or both.

### Devices
- **Low-end Android is the priority**, not an afterthought: 2 GB RAM, Android 10, 360×640.
  Also verify at 320 wide and at 200% text scale.
- A modern iPhone and a small iPhone (SE-class) for iOS layout and safe areas.
- Dark mode on both — mobile supports it and Admin Web does not.

### Permissions
- **Microphone**: granted, denied, and denied-permanently. Denied must explain why, not fail
  silently.
- **Notifications**: granted, denied, and revoked while the app is backgrounded. A denied
  state must offer a settings path and must not re-prompt repeatedly.
- Photos/camera/files once media is implemented.

### Authorization (defence in depth — the backend is the authority)
- Sign in as a teacher and confirm no route, deep link, or member sheet yields a 1:1 with a
  parent, and vice versa.
- Deep-link a conversation id the user is **not** a member of. Expected: a safe "not
  available", no content, no retry loop.
- Deep-link an archived conversation. Expected: read-only, composer disabled.
- Disable an account server-side while the app is open. Expected: session ends, cached data
  cleared, return to login.
- Revoke the session from another device. Same expectation.

### Phone privacy (BR-1's sibling; treat as a release gate)
Inspect **payloads, not just screens** — the client cannot leak what it never receives, so
the test is whether the backend ever sends one. Check: conversation list, message list, group
members, call setup and metadata, push payloads, realtime frames, search results, and error
messages.

### Network
- Airplane mode mid-compose: message queues, UI stays interactive, nothing blanks.
- Recover: queued messages send **in order**, none duplicated.
- Kill the app with messages queued, relaunch, confirm order and no duplicates.
- Flaky network (packet loss, high latency): confirm no duplicate messages, and that backoff
  is visible rather than a tight loop.
- Force a `403` on send. Expected: one attempt, parked with an inline retry, no auto-retry.

### RTL
- Arabic first, then verify English. Long Arabic names, mixed Arabic/English messages,
  numbers and times inside Arabic sentences.
- Confirm **own messages sit on the left** in Arabic and on the right in English.
- Confirm delivery ticks, clocks, microphone, paperclip and handset do **not** mirror.

### Performance
- A conversation with 5,000+ messages: scroll, jump, load older pages.
- Rapid realtime arrivals while scrolled up — the viewport must not move.
- Memory during a long media-heavy scroll.

## 3. Known limitations — do not raise these as defects

These are unbuilt, not broken. They are listed in the final report as remaining work.

1. **The HTTP transport is not wired.** The wire mappers conform to AI #2's contract and are
   tested, but the app currently runs against `FakeBackend`. Nothing calls the real API yet.
2. **No media, attachments, or voice notes.** Models and tokens exist; capture, upload,
   playback and permissions do not.
3. **No push notifications.** No FCM/APNs registration, no payload handling, no deep-link
   routing from a notification tap.
4. **No calling.** No LiveKit, no CallKit, no ConnectionService, no call UI or history.
5. **No reply/reaction interaction.** The models, wire mapping and bubble rendering exist;
   the gestures that trigger them are not wired.
6. **No search, pin, mute or archive UI.** The controller supports all four optimistically
   and the backend has `POST /conversations/:id/preferences`; no screen exposes them.
7. **Typing indicators and read receipts are modelled but not driven** — nothing calls
   `setTyping` and nothing marks read on scroll.
8. **`IBM Plex Sans Arabic` is not bundled.** The fallback stack carries Arabic correctly;
   the brand font needs adding as an asset.
9. **Brand assets are placeholders.** The palette is `design-system.md`'s; the logo is a
   letter mark. Both are one-file changes.
10. **No integration test against a live API**, because there is no deployed environment to
    point at yet.

## 4. Running the checks

```bash
flutter analyze
```

```bash
flutter test
```

Both must be clean. The directionality and privacy guards run inside `flutter test`, so CI
needs no extra step for them.

### Verifying a full compile without the platform SDKs

`flutter analyze` is a static pass; it is not the compiler. On a machine without the Android
SDK or CocoaPods — which is how this codebase was developed — the whole of `lib/` can still
be put through the real Dart compiler by adding a throwaway web target:

```bash
flutter create . --platforms=web && flutter build web --release && rm -rf web build
```

This was run and **succeeded**, so every file compiles, not merely analyses. Web is not a
shipping target and the scaffolding is deliberately not committed.

A genuine device build still requires the Android SDK (Android) or CocoaPods (iOS), and
neither has been run here — see the final report's honest statement of what is and is not
verified.
