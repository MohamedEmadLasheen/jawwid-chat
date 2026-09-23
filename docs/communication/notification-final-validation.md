# Notification platform — final production validation

The architecture was frozen for this pass. Nothing below adds a transport, a
queue, a retry system, a notification engine, a push abstraction or an auth
mechanism. Everything below is either a defect found by trying to break what
already existed, or a test that pins behaviour which was correct but unproven.

Section titles A–N are used as headings here. Where a heading's wording differs
from the request, the content under it is what was asked for.

---

## A. Defects found and fixed

Seven, all found by working the validation list rather than by reading. In
rough order of how badly each would have hurt a parent.

**A-1. Every notification tap threw `No GoRouter found in context`.**
`PushDeepLinkNavigator` is mounted in `MaterialApp.router`'s builder, which
wraps the Router and is therefore an *ancestor* of the `InheritedGoRouter` that
`GoRouter.of(context)` looks up. The lookup throws — at the exact moment a
parent taps a notification, which is the only moment that widget exists for.
Every deep link in the product was affected: message, missed call,
announcement, the tap that starts a terminated app, the link held through
sign-in. It was invisible because nothing had ever mounted the widget in a
test. Fixed by reading the router from `routerProvider`, which owns the single
instance. Eight tests now mount the navigator exactly as the app does.

**A-2. A crashed worker stranded a delivery in `processing` forever.**
`DeliveryService.claim` matched only `pending`, so a row left `processing` by a
worker that died between claiming it and writing the outcome was matched by
nothing afterwards: never re-attempted, never terminal, and reported by
`chat.notification_operations` as permanently in flight. The notification's own
lease recovered the notification; nothing recovered the per-device rows beneath
it. `claim` now also takes a `processing` row whose last write is older than
five minutes.

**A-3. A read on one device never reached the parent's other devices.**
Marking read was persisted correctly and told nobody. A parent with a phone and
a tablet cleared one and the other kept showing "3" until its next refetch —
which in practice was the next *arriving* notification, so the badge went down
only when something new pushed it up. Fixed with one more event on the existing
contract, published by the existing publisher to the actor room every device is
already in.

**A-4. A preference was read when the notification was queued, not when it was
sent.** A class reminder written today for 8am tomorrow would buzz a parent who
muted that category tonight. "I muted this yesterday" cannot be answered with
"yes, but we had already decided to buzz you". The preference is now read at
delivery; every other suppression stays where it was, because every other
suppression is a fact about the instant the event happened.

**A-5. A relay outage was written off instead of retried.**
`deliverInApp` called `fail()` directly on a publish error, while the comment
immediately above it said the error was worth retrying. The code now does what
the comment said — and the distinction it rests on is now tested: a publish that
went out and reached nobody is a parent who is offline (recorded `sent`, final),
while a relay that *refused* the publish is a fault on our side.

**A-6. A withdrawn announcement answered 404.** That told a parent holding the
notification for it that no such announcement had ever existed. Authorization is
already settled by that point — their notification proves the academy told them —
so it now answers 410, matching the expired case.

**A-7. An unanswered call never became a missed call unless the caller hung
up.** Found in the previous pass and completed in this one:
`expireRingingCalls()` emits the same `CALL_ENDED` the hang-up path emits, with
`ActorKind.SYSTEM` as the actor and `reason: 'ring_timeout'`.

---

## B. The architecture freeze — what was NOT added

| Not added | What was used instead |
|---|---|
| A second realtime transport | The existing Socket.IO gateway and actor rooms |
| A second queue | The existing `chat.outbox_event` and its worker sweeps |
| A second retry system | `DeliveryService.retryOrFail`, extended to cover the in-app channel |
| A second notification engine | `NotificationService.schedule()` for every producer, announcements included |
| A second push abstraction | The one `PushProvider` seam |
| A second auth mechanism | `AuthService.authenticate()`, for HTTP and for the socket handshake |
| A parallel notification table | `chat.notification` |

One event name was added to the existing contract (`notification.read`) and one
field was added to nothing. No migration was written in this pass.

---

## C. The real device push path

Traced hop by hop rather than asserted. What the code does, in order:

1. `deliverPush` reads every active `chat.device_token` for the recipient. No
   tokens → a `skipped` row with `NO_DEVICE_TOKEN`, not silence.
2. One delivery row is claimed per device, on the unique index
   `(notification_id, channel, device_token_id)`.
3. The payload is built from ids only — `notificationId`, `type`, `category`,
   `priority`, and whichever of `entityId` / `conversationId` / `learnerId` /
   `announcementId` / `deeplink` apply. No title, no body, no sender name, no
   child name, because a push payload is logged by the platform and cached on
   the device.
4. The lock-screen text is decided by `pushCarriesContent` on the type. For
   everything in the messaging category it is false, so what leaves the process
   is the academy's name and a neutral line.
5. `FcmPushProvider` signs a service-account RS256 JWT, exchanges it for an
   OAuth token, and POSTs to FCM HTTP v1. No SDK.
6. The response decides the row: accepted → `sent` (never promoted to
   `delivered` by inference); token rejected → the token is deactivated and the
   row fails permanently; anything else → bounded exponential backoff, capped,
   with a hard stop.
7. On the device, `PushRegistrar` reports `delivered` and `opened`, marks read,
   and resolves the payload to a route that `NotificationDeepLink` validates
   before anything navigates.

Steps 1–7 are covered by automated tests. What no test here can cover is
whether a real FCM project accepts the request and a real handset renders it —
see L.

---

## D. Android and iOS, separately

Not one generic result. Per platform, per hop:

| Hop | Android | iOS |
|---|---|---|
| Payload built, ids only | VERIFIED (automated) | VERIFIED (automated) |
| HTTP v1 request signed and shaped | VERIFIED (automated) | VERIFIED (automated) |
| Provider response → delivery row | VERIFIED (automated) | VERIFIED (automated) |
| Token registration / rotation / unregister | VERIFIED (automated) | VERIFIED (automated) |
| Tapped payload → route → navigation | VERIFIED (automated) | VERIFIED (automated) |
| Platform config declared | VERIFIED (by inspection: `AndroidManifest.xml`, conditional `google-services`) | VERIFIED (by inspection: `Info.plist`, background modes) |
| A real FCM project accepts the send | **NOT VERIFIED** | **NOT VERIFIED** |
| The OS displays it | **NOT VERIFIED** | **NOT VERIFIED** |
| A tap wakes this app | **NOT VERIFIED** | **NOT VERIFIED** |
| Background / terminated wake-up | **NOT VERIFIED** | **NOT VERIFIED** |
| VoIP / CallKit ring while terminated | NOT APPLICABLE | **NOT VERIFIED** |

**Android cannot be tested here**: no Android SDK, no `adb`, no emulator image,
no `/dev/kvm`. `flutter devices` reports only `Linux (desktop)`.

**iOS cannot be tested here at all**: building or running it requires macOS and
Xcode, which do not exist on Linux. This is a stronger statement than the
Android one — Android is missing tooling, iOS is missing the operating system.

---

## E. Socket.IO authentication

Twenty-two tests in `test/unit/realtime/handshake-auth.spec.ts`, against the
real `AuthService` — no second verifier was written.

| Case | Result |
|---|---|
| Valid token | Accepted; joins exactly that actor's room |
| Missing credential | Refused |
| Empty token | Refused |
| Malformed token | Refused |
| Token signed with the wrong key | Refused |
| Expired token | Refused |
| Revoked session | Refused |
| Deactivated account | Refused |
| Credential in the query string | **Never read** — `handshakeToken` reads `handshake.auth` then the Authorization header, and nowhere else |
| Client-supplied `actorId` | Ignored entirely; the room comes from the token |
| `actorId` with no token | Refused, not honoured |
| Room authorization | Checked against the token's actor; a refusal is the absence of a join |
| Subscribe from an unauthenticated socket | Refused |
| Reconnect | A new socket holds only the actor's own room; the client replays its list and every replayed room is re-authorized |

That last row is the one worth stating plainly: the server deliberately
remembers nothing across sockets, so a parent whose authorization changed while
they were disconnected cannot be silently re-admitted.

---

## F. The missed-call timeout

`CallService.expireRingingCalls(now, batchSize)`.

- **Correct** — it emits the same `CALL_ENDED` event the hang-up path emits, so
  the missed-call notification comes from one producer path, not two.
- **Idempotent** — the notification's dedupe key is
  `missed_call:{callId}:{recipientId}`, so the sweep and a late hang-up converge
  on one notification. A test drives *both* producers and asserts two
  `CALL_ENDED` events were really emitted before asserting one notification, so
  it cannot pass vacuously.
- **Race-safe** — two workers sweeping at the same instant produce one
  completion; so does a sweep racing a hang-up at the same instant.
- **Bounded** — `batchSize` caps the work per pass; a call cannot outlive its
  ring window.
- **Recoverable** — a worker dying mid-sweep leaves the remaining calls for the
  next pass, without double-notifying.
- **Auditable** — the actor is `ActorKind.SYSTEM` with `reason: 'ring_timeout'`,
  so the audit log does not claim the caller hung up.

---

## G. Deduplication — the exact key at each stage

Five stages, five keys, each absorbing a different failure.

| # | Stage | Idempotency key | Enforced by |
|---|---|---|---|
| 1 | Outbox claim | `chat.outbox_event.id` | Conditional `update … where status='pending'` |
| 2 | Notification | `chat.notification.dedupe_key` | `UNIQUE`; `schedule()` treats P2002 as success |
| 3 | Dispatch claim | `notification.id` + status/lease | Conditional update; expired lease is re-claimable |
| 4 | Delivery | `(notification_id, channel, device_token_id)` | `UNIQUE` |
| 5 | Transport | *none* | — (see H) |

Stage 2 per producer, each pinned by a test asserting the literal string:

| Producer | Key |
|---|---|
| Message | `message:{messageId}:{recipientId}` |
| Incoming call | `incoming_call:{callId}:{calleeId}` |
| Missed call | `missed_call:{callId}:{recipientId}` — two producers, one key |
| Approval requested | `approval_requested:{approvalId}:{approverId}` |
| Approval decided | `approval_decided:{approvalId}:{authorId}` |
| Announcement | `announcement:{announcementId}:{recipientId}` |
| Class reminder | `{ruleKey}:{learnerId}:{classAtISO}:{parentId}` |
| Schedule change | `class_change:{learnerId}:{fromISO}>{toISO}:{parentId}` |
| Class cancelled | `class_change:{learnerId}:{fromISO}>none:{parentId}` |

The schedule-change key is keyed on the **transition** deliberately: keying on
the learner alone would silence a second, genuinely different change; keying on
the new time alone would repeat the first on every retry.

---

## H. Crash-safe dispatch, and the guarantee

The hardest case was worked explicitly: **the worker crashes after the provider
accepted the push and before the database recorded it**. The crash is
reproduced rather than faked — the provider accepts, then the acknowledging
write and its own error handler both fail on a dead connection, leaving the row
exactly as a killed process leaves it.

Result:

- The row is left claimed, the notification intact and unread.
- It is **not** re-claimed while the attempt could still be in flight.
- Once abandoned, it is re-claimed and reaches a terminal state.
- The recovery's push is a **real second push**. A test asserts the duplicate.

**Notifications are exactly-once. Deliveries are at-least-once.**

Exactly-once delivery is not claimed and cannot be: "the provider accepted it"
and "we recorded that it accepted it" are two writes to two systems with no
transaction across them, and recovery cannot distinguish "died before sending"
from "died after sending" because the only record of the difference is the
write that never landed. Given the choice between a parent occasionally seeing
a duplicate push and a parent silently not being told their child's class was
cancelled, this product takes the duplicate. Duplication is confined to the
transport: the notification, the badge and the centre row stay single.

---

## I. Badges, multi-device and read sync

**Badge independence.** The realtime subscription used to live in the
notification centre's controller, which exists only while the centre is on
screen — so the badge moved for a parent looking at the notification centre and
stayed frozen for a parent reading their chats. It now lives on an always-on
provider. Six tests: the count advances with the centre's controller never
created, keeps advancing after the centre is opened and closed, moves on Chats
with no interaction, survives time spent on Calls and on Settings, and comes
back down when everything is marked read.

Stated plainly because it looks like a gap and is not: the bell is on Chats
only. Calls and Settings have no bell, and the shell's tab badge counts unread
*chats* from a different provider. What must hold is that time spent there costs
no count, and that is what is tested.

**Cross-device read sync**, both directions, no restart: a single row, all, a
category-scoped all, a thread being opened, an open centre greying a row in
place without reordering, and a duplicate read not taking the count below zero.
`readAt` is the server's timestamp, so two devices agree on *when* as well as
*whether*.

---

## J. Multi-child correctness

A family with Ahmed, Omar and Sara, and a second family entirely.

Every notification names its child and carries that child's id: a message in
Ahmed's group names Ahmed and nobody else and links to Ahmed's group at the
exact message; a voice message in Omar's names Omar; a schedule change for Sara
links to `/learners/{sara}/classes` rather than a screen showing all three; a
missed call in Ahmed's group names Ahmed. Three at once stay three rows with
three learner ids and three links, on one count of 3. Dedupe keys are per child,
so one academy-wide holiday is three notifications.

Nothing crosses a family: their parent cannot open this family's notification
(404, identical to the response a made-up id gets, so ids cannot be probed);
following the link past the notification hits the conversation, locked
independently; they are never a recipient in the first place; marking read with
somebody else's id changes nothing. And within a family, opening Ahmed's thread
reads Ahmed's notifications and leaves Omar's unread.

---

## K. Preferences, announcements and audience security

**Preferences.** A mute silences the phone and nothing else — the notification
exists, the badge counts it, the centre lists it, in-app is `sent`, and the skip
is recorded *with its reason*, because "why did my phone not buzz?" must have an
answer and `PREFERENCE_OFF` is a different answer from `NO_DEVICE_TOKEN`. The
non-optional categories are refused by the service and by the database trigger
behind it. An essential *type* pushes even inside a muted category. One parent's
mute is not the other's. Absence of a row is not absence of consent.

**Announcements, end to end.** Draft reaches nobody; publishing twice does not
move the publish timestamp or write a second audit row; three workers fanning
out at once produce one notification each; a cancelled announcement cannot be
published; cancelling a published one stops future fan-out and retracts nothing;
a future `publish_at` is not sent early; an expired one exists in the database
and is absent from the centre; an audience resolving to nobody is marked handled
with an honest count of zero.

**Audience security.** A parent cannot create, publish, cancel or read the admin
list. A teacher cannot announce. A coverage staffer may announce but may not
declare urgent, nor publish somebody else's urgent announcement — the authority
is checked on the act that reaches parents, not only on the draft. The table's
trigger refuses an escalated priority with the service bypassed entirely.
`createdBy`, `status`, `publishedAt` and `recipientCount` smuggled through the
body are dropped. The parent's view carries no target ids, no target type, no
author and no recipient count — absent from the response, not filtered by a
conditional. An unimplemented target type is refused by the check constraint
*and* resolves to the empty set, because an audience that fails open is how a
typo becomes a message to the whole academy.

---

## L. Verification status

### Verified on an actual device

**Nothing.** No part of this was run on a physical or virtual handset.

There is no Android SDK, no `adb`, no emulator image and no `/dev/kvm` in this
container; `flutter devices` reports only `Linux (desktop)`. iOS is further out
of reach — building or running it requires macOS and Xcode, which do not exist
on Linux. There is also no `google-services.json` and no APNs key in this
repository, by design: they are per-project secrets, and the Android build
applies the Google Services plugin only when the file is present, so a fresh
clone still builds and runs without push.

### Verified by automated tests only

| Suite | Count |
|---|---|
| API unit | 388 |
| API integration (real Postgres, real Redis) | 340 |
| Flutter | 497 |
| Admin web | 106 |
| **Total** | **1,331** |

Plus `flutter analyze` clean over `lib/` and `test/`, and the JC-011 protected-
test guard passing.

### What remains to be done manually

1. Put `google-services.json` in `android/app/` and `GoogleService-Info.plist`
   in `ios/Runner/`; set the FCM service-account variables from
   `infra/env/manifest.tsv` on the API.
2. **Android** — `flutter run` on a device or a Play-Services emulator. Sign in,
   confirm a `chat.device_token` row appears, then from another account: send a
   message and check the notification appears on the lock screen, that its text
   is the neutral line and **not** the message body, that tapping opens the
   thread at that message, and that the badge is already correct when the app
   opens. Repeat backgrounded, then force-stopped.
3. **iOS** — on macOS with Xcode: upload the APNs key to the Firebase project
   and repeat the same four checks on a *physical* device; the simulator cannot
   receive remote push. Then the VoIP path separately: an incoming call must
   ring through CallKit while the app is terminated.
4. After each, check `chat.notification_delivery`: `status = 'sent'` per device,
   and `delivered` only once the app reported it.

---

## M. What is NOT ready

| Capability | State | Why |
|---|---|---|
| Renewal reminder | NOT-IMPLEMENTED | Templates, rules, category and registry entry exist; `chat.subscription.renewal_due_at` is ingested from Jawwid Core and **nothing in this repository transitions it**. No producer, so no notification |
| Payment reminder | NOT-IMPLEMENTED | Same |
| Attendance | NOT-IMPLEMENTED | No domain event exists anywhere in this repository. The fact itself is never recorded |
| Progress update | NOT-IMPLEMENTED | Same |
| Package balance | NOT-IMPLEMENTED | Same |
| Class deep-link screen | NOT-IMPLEMENTED | `/learners/{id}/classes` is minted and has no screen. See below |
| `/billing` screen | NOT-IMPLEMENTED | The route is minted for renewal/payment, which have no producer anyway |
| Push on a real device | DEVICE-E2E-PENDING | See L |
| Email / SMS / WhatsApp channels | NOT-IMPLEMENTED | Designed for — a value in `DeliveryChannel`, a value in the channel check constraint, one `deliver<Channel>` method — and not built |

No fake producer was written to make the matrix look complete.

**The class deep link**, against the four conditions that make it a decision
rather than an oversight:

1. **Nothing is lost.** The notification carries which child, the old time and
   the new time, frozen at creation, so its own detail view is a real
   destination rather than a consolation prize.
2. **It does not lie.** `NotificationDeepLink.isActionable` returns false, so the
   card does not look tappable and then do nothing.
3. **No migration is needed later.** The server keeps minting the route, so the
   day the screen exists every notification already written points at it.
4. **It is reported honestly** — NOT-IMPLEMENTED in the acceptance matrix, not
   PASS.

---

## N. Production readiness

Against the stated bar — *when something important happens to a parent's child,
the system creates exactly one authoritative notification, routes it to the
correct parent, persists it, delivers it through the appropriate channels,
survives reconnects and worker failures, synchronizes across devices, and takes
the parent to the correct authorized context*:

| Clause | State |
|---|---|
| Exactly one authoritative notification | **Met.** Five-stage deduplication, every key pinned by test |
| Routed to the correct parent | **Met.** Fan-out by conversation membership and resolved audience; nothing crosses a family; every notification names its child |
| Persisted | **Met.** Written in the domain transaction via the outbox; the database is the record and nothing is derived from realtime |
| Delivered through the appropriate channels | **Met in code, not on a device.** In-app and realtime are PASS; push is DEVICE-E2E-PENDING |
| Survives reconnects | **Met.** Gap-close refetch, replayed rooms re-authorized, nothing duplicated by a flapping connection |
| Survives worker failures | **Met.** Lease-based dispatch, abandoned-delivery recovery, bounded retries, a documented at-least-once guarantee |
| Synchronizes across devices | **Met.** Arrival and read both, in both directions, with no restart |
| Takes the parent to the correct authorized context | **Met, with one exception.** Every link re-authorizes on landing and every refusal is indistinguishable from not-found. The class link has no screen in this build |

**Verdict.** The platform is production-ready on every path this environment can
execute, and the push transport is production-ready *in code* with its last
three hops unverified. It should not be declared shipped until section L's
manual steps have been run on one Android device and one iOS device. That is the
only thing standing between this and a complete result, and it is a thing no
amount of further work in this container can close.
