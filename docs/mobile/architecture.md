# Jawwid Chat Mobile — Architecture

Owner: AI #3 · Flutter 3.47.2 / Dart 3.13.2 (pinned in `pubspec.yaml`)
Scope: the **parent** and **teacher** applications, one codebase, role-aware.

Governing documents: `docs/qa/authoritative-scope.md` · `docs/design/handoff-mobile.md` ·
`docs/design/design-system.md` · `docs/design/cross-platform.md` ·
`apps/api/src/communication/contracts/`.

---

## 1. Shape of the codebase

```
lib/
  app/            composition root, router, shells, retry policy
  core/
    data/         repository interfaces, the fake backend, wire mappers
    errors/       the error taxonomy and its presentation
    logging/      redacting logger
    network/      dio client, error mapper
    policy/       the communication rule
    storage/      secure token store
  design/         tokens, typography, theme, shared widgets
  features/       auth · home · conversations · messages · settings
  l10n/           ar + en ARB, Arabic first
  shared/         models, utils
```

Feature-oriented, three layers per feature (`domain` / `application` / `presentation`) and no
more. Domain is pure Dart and holds the rules worth testing in isolation — message ordering,
the outbox, the chat-list sectioning. Application is Riverpod controllers. Presentation is
widgets with no business logic.

## 2. The one rule the type system enforces

Teacher ↔ parent direct communication is forbidden (BR-1). Three mechanisms, in order of
strength:

1. **`ConversationKind` has no value for it.** There is no "direct chat with a teacher"
   variant to construct, so the forbidden channel is not representable.
2. **`CommunicationPolicy`** is a single total function over `(viewer, other)` role pairs.
   Every affordance asks it. An unrecognised role maps to `unknown`, which it denies — new
   backend roles fail closed.
3. **The backend refuses it** with `COMM.BR1_TEACHER_PARENT_DIRECT`, classified as terminal
   so it is never retried.

The UI restriction is a cosmetic and is treated as one. The backend is the authority.

## 3. State management — Riverpod 3, one solution

| Concern | Provider |
|---|---|
| Session | `authControllerProvider` (`Notifier<AuthState>`) |
| Chat list | `conversationsControllerProvider` (`AsyncNotifier`) |
| One conversation | `messagesControllerProvider(conversationId)` (family) |
| Role | `currentRoleProvider`, derived from the session |
| Locale | `localeOverrideProvider` |

State is split by concern, never one global object. Repository providers **throw if not
overridden**, so a release build that forgot to supply the real implementation fails loudly at
startup instead of silently shipping fixture data.

### Retry is explicit
Riverpod retries failed providers by default. `JawwidRetryPolicy` narrows that to transient
failures only — network, timeout, rate limit, 5xx — with capped backoff and an attempt
ceiling. A refusal, a validation error, or an ended session is terminal. Retrying a BR-1
refusal forever would be both a product violation and the worst possible behaviour on the
slow networks this audience uses.

## 4. Networking

`ApiClient` wraps dio and owns two behaviours that are easy to get wrong:

- **A 401 triggers at most one refresh, single-flighted.** Ten concurrent 401s produce one
  token exchange; a replayed request is replayed once. A persistently rejecting server cannot
  produce a loop.
- **Only idempotent requests are auto-replayed.** `GET/HEAD/OPTIONS/PUT/DELETE` always; a
  `POST` only when the caller attached an idempotency key. Message sending is the one write
  that qualifies.

`ErrorMapper` collapses every transport and HTTP outcome into `AppError`. It reads the
communication engine's `{ error: { code, message } }` envelope, and treats the `COMM.*` codes
as terminal regardless of the status that carried them — a policy decision does not become
retryable because it arrived on a 500.

`ErrorPresenter` is the only bridge from `AppError` to user-visible text, which is what keeps
a stack trace or a server payload from ever reaching a screen.

## 5. Messaging: ordering, identity, and the outbox

Three separable pieces, each unit-tested:

**`MessageLog`** — ordering and identity.
Identity is `clientMessageId` when present, else the server id: a message we sent comes back
with an id we have never seen, and without keying on the client id it would appear twice.
Confirmed messages sort by the server's `seq`; pending ones sort after all of them in compose
order. A confirmed message is never dragged back to a local state by a late retry.

**`Outbox`** — the offline queue.
Only the **head** of each conversation is eligible to send, so a stuck message cannot be
overtaken and the user's order is preserved. Conversations are independent. A retry re-sends
the same entry, so the id never changes. Non-retryable failures are parked for an explicit
user retry rather than re-attempted.

**`MessagesController`** — the pipeline.
Compose → UUID once → echo as `queued` → outbox → on success, reconcile by client id.

> The client may only ever author `queued`, `sending`, `failed`. `sent`, `delivered`, `read`,
> `pending`, `approved`, `rejected` come from the server and are never guessed.

`seq` arrives as a **string** because it is 64-bit and JSON numbers are not safe at that
width. `WireMappers.parseSeq` handles it; parsing it as a number would silently round in a
long conversation and corrupt order.

## 6. Realtime and reconnect

Events are **signals, not state**. On reconnect the controller resyncs from
`log.highestSequence` via the `after` cursor rather than refetching the conversation — a broad
refetch is precisely what the low-end/slow-network constraint rules out.

A message arriving while the user is scrolled up appends and raises a "new messages" pill; it
never auto-scrolls and never steals focus from the composer.

## 7. Local storage

| Data | Where | Why |
|---|---|---|
| Access / refresh tokens | Platform keychain / keystore (`flutter_secure_storage`) | Never preferences, never the cache, never a log |
| Password | **Nowhere** | Never persisted in any form |
| Cached conversations, messages, drafts, outbox | sqlite (`sqflite`) | Reliability offline |
| Locale, notification preferences | `shared_preferences` | Non-sensitive |

Ending a session funnels through one method that clears tokens **and** cached data, so there
is a single place responsible for not leaving protected content on a signed-out device.

## 8. Design system

`design-system.md` §2–§5 is materialised once in `lib/design/tokens.dart` as a
`ThemeExtension`, with semantic names verbatim. A source-scanning test fails the build if a
`Color(0x…)` appears anywhere else, so brand sign-off changes exactly one file.

**The attention, workload and case-status token families are deliberately not defined.** A
parent or teacher surface must never render those concepts, and omitting the tokens makes that
structural rather than something a future contributor has to remember.

Typography is locale-aware: Arabic carries more leading than Latin at the same size, so the
theme is rebuilt when the resolved language changes.

## 9. Arabic and RTL

Arabic is the default locale and the first entry in `supportedLocales`, so an unsupported
device language falls back to Arabic rather than English. 126 keys at full ar/en parity;
Arabic plurals use all six ICU forms.

Directionality is enforced by a test that scans `lib/` and fails on `EdgeInsets.only(left:`,
`fromLTRB`, physical `Alignment`, `Positioned(left:`, and physical `BorderRadius.only` — the
lint `cross-platform.md` §4 asks for, cheaper than a QA pass. It caught three violations in
this codebase's own widgets on first run.

Own messages sit on the reading-start-opposite edge — left in Arabic, right in English — via
`AlignmentDirectional`, and the bubble tail follows through `BorderRadiusDirectional`.

## 10. Navigation

`go_router`, with route paths named once so deep links and in-app navigation cannot drift.
The router rebuilds on every auth change, so a session ending evicts every protected screen.

Two **deliberately different** shells (`decisions.md` DD-08): parent gets
Home · Jawwid · Groups · Settings; teacher gets Home · Groups · Settings. Icon **and** label
always.

A deep link's target id is never validated locally — the backend decides whether this user may
see it, and an unauthorised id surfaces as a safe error rather than an empty thread.

## 11. Logging

`RedactingLogger` strips bearer tokens, JWTs, and phone-shaped digit runs from every message,
and masks sensitive keys — including `body`, `message`, and `text` — recursively through
structured data. Redaction happens on the way out rather than relying on call sites to
remember, and the logger is disabled outside debug builds.

## 12. What is not built yet

See `docs/mobile/testing.md` §7 and the final report. In short: the HTTP repository
implementations (the mappers exist and are tested; the transport is still the fake), media and
voice notes, push notifications, and calling.
