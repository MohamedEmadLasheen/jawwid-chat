# The notification platform

> Phase 0 audit, architecture and operating notes for the academy-wide
> notification infrastructure. Source of truth for how an event becomes
> something a parent sees.

## 0. Status — CLOSED, and frozen

```
NOTIFICATION INFRASTRUCTURE ........... ENGINEERING COMPLETE   (phase closed)
PHYSICAL ANDROID/iOS VERIFICATION ..... PENDING
NOTIFICATIONS WITHOUT A PRODUCER ...... NOT READY
```

This phase is closed. The following are **frozen infrastructure**. Future
product work consumes them; it does not extend or replace them.

- the event → notification pipeline
- notification persistence
- delivery tracking
- retry and recovery behaviour
- the FCM integration
- the realtime integration
- preferences
- deep-link routing
- the authorization model
- idempotency
- cross-device synchronization
- retention
- announcement infrastructure
- the notification contract tests

### Adding a notification for a new feature

The whole of what a new business feature does:

1. Emit **one** domain event, written to `chat.outbox_event` in the same
   transaction as the change that caused it.
2. Add its type to the registry in `contracts/notifications.ts` — category,
   priority, essential, template, deep link — and its templates to the catalog
   migration.
3. Call `NotificationService.schedule()` with a deterministic dedupe key.

That is the entire integration. Do **not** add a second notification path,
delivery mechanism, retry system, push abstraction, realtime transport, or
authorization mechanism. If a feature appears to need one, the requirement is
wrong or this document is — resolve that before writing code.

### The two gates that stay open

**Physical device verification** — `docs/mobile/device-verification-checklist.md`
is the source of truth. Android and iOS are recorded separately, as PASS or
FAIL, by a person with a handset. Code inspection and automated tests do not
close this gate and never will, regardless of how many of them pass.

**Notifications with no producer** — attendance, student progress,
package/balance and billing/payment stay NOT READY until the domain event
exists. No placeholder producer is written to make a matrix look complete.

### The contract tests are a build gate

The suites listed in `docs/qa/protected-tests.tsv` under *Notification platform
contract* are mandatory. `scripts/qa/check-protected-tests.sh` runs in the
`guards` job of `.github/workflows/ci.yml`, and every other CI job depends on
`guards` — so deleting or gutting one of them fails the whole pipeline, not one
suite. Removing a line from that manifest is a deliberate, reviewable act, and
is never a way to make a build green.

## 1. Phase 0 — what was already here

The repository already had a **real notification engine**, not a stub. It was
never finished into a product: it could send a push and nothing else. Nothing
below was rebuilt.

| Area | State before | Relevant files |
|---|---|---|
| Notification engine | **Existing** — `schedule()` idempotent on a unique `dedupe_key`, claim-then-send dispatch, exponential-backoff retry, attempt cap from config | `apps/api/src/communication/notifications/notification.service.ts` |
| Notification table | **Existing** — `chat.notification`, unique `dedupe_key`, status machine, `sent/delivered/opened` timestamps | `supabase/migrations/20260905093000_chat_communication.sql` |
| Templates (i18n) | **Existing** — `chat.notification_template`, bilingual ar/en, versioned, `{placeholder}` interpolation, ar fallback | `notifications/template.service.ts` |
| Reminder rules | **Existing** — `chat.notification_rule`, offsets as data, deterministic `rule:subject:recipient` dedupe keys | `notifications/reminder.service.ts` |
| Quiet hours | **Existing** — per-actor, per-timezone, defer-never-drop, rule-level exemption | `notifications/quiet-hours.service.ts` |
| Device tokens | **Existing** — `chat.device_token`, multi-device, VoIP flag, deactivation on permanent push failure | `notifications/notification.service.ts` |
| Push seam | **Existing** — `PushProvider` port + `LoggingPushProvider`; no FCM/APNs client in the domain | `notifications/push.provider.ts` |
| Transactional outbox | **Existing** — written in the domain transaction, claim-based drain, backoff, at-least-once | `outbox/outbox.service.ts`, `outbox/outbox.worker.ts` |
| Realtime | **Existing** — Socket.IO, server-authorized rooms, per-actor room for multi-device fan-out, Redis relay | `realtime/realtime.gateway.ts`, `infra/realtime/relay.publisher.ts` |
| Messages / voice messages | **Existing** — `message.created` outbox event already fans out a `new_message` notification | `messages/message.service.ts` |
| Calls | **Partial** — call lifecycle and `call.*` outbox events existed; **no call ever produced a notification** | `calls/call.service.ts` |
| Scheduling | **Partial** — `chat.learner.next_class_at` existed as data; **no write path, no change event, no reminder scheduling** | `supabase/.../chat_family_domain.sql` |
| Announcements | **Missing** — no entity, no targeting, no fan-out | — |
| Notification preferences | **Missing** — quiet hours only | — |
| Deep linking | **Missing** — a notification carried `conversationId` and nothing else | — |
| Notification history / centre | **Missing** — no list endpoint, no read state, no unread count, no rendered text persisted | — |
| Delivery tracking | **Partial** — one status on the notification row; no per-channel, per-device record | — |
| RLS on notification tables | **Missing** — `20260905091200_chat_rls.sql` predates `…093000_chat_communication.sql`, so none of the communication tables had RLS | — |
| Mobile app | **Missing** — 76 Dart files, none about notifications | `lib/**` |

### The three structural gaps

1. **Notification and delivery were the same row.** One row was one channel, so
   "the parent has this notification" and "the push to their iPad failed" could
   not both be true.
2. **Text was rendered at send time and thrown away.** A schedule change
   rendered "moved to 6:00 PM", pushed it, and kept only the variables — so a
   later edit would have silently rewritten history.
3. **There was no read state.** `opened` (the user tapped a push) was being
   asked to stand in for `read` (the user has seen it in the app). They are
   different facts and both are needed.

## 2. Architecture

```
SYSTEM EVENT            domain transaction writes chat.outbox_event
      ↓
EVENT HANDLER           OutboxWorker.publish()
      ↓
NOTIFICATION ENGINE     NotificationService.schedule()
      ↓
RECIPIENT RESOLUTION    RecipientResolver — members, parents-of-learner, audience
      ↓
PREFERENCE CHECK        PreferenceService — optional categories only
      ↓
PRIORITY CALCULATION    NotificationRegistry — type → category/priority/essential
      ↓
NOTIFICATION CREATION   chat.notification, text rendered and FROZEN, dedupe_key unique
      ↓
DELIVERY QUEUE          chat.notification_delivery, one row per channel per device
      ↓
   in_app  ──────────── realtime `notification.created` to the actor room
   push    ──────────── PushProvider → FCM/APNs
      ↓
DELIVERY STATUS         per-row: pending → processing → sent → delivered | failed
      ↓
READ / OPENED           notification.read_at / notification.opened_at
```

**Event ≠ Notification ≠ Delivery ≠ Action.** The four live in four places:
`chat.outbox_event` / `chat.event_log`, `chat.notification`,
`chat.notification_delivery`, and `notification.read_at` + `opened_at`.

### Adding a channel later

`DeliveryChannel` is a value in `contracts/notifications.ts` and a check
constraint on `chat.notification_delivery.channel`. A new channel (email, SMS,
WhatsApp) is a new `ChannelSender` bound in the module plus one constraint
value. `NotificationService` does not change.

## 3. The type registry

`apps/api/src/communication/contracts/notifications.ts` is the single place a
notification type is defined. It fixes, per type: category, default priority,
whether it is essential (bypasses preferences), whether push may carry content,
the template key, the grouping key shape, and the deep link.

A notification type exists **only if a real event in this product produces it**.
Types deliberately not implemented, and why, are listed in §7.

## 4. Deep links

Every notification stores `entity_type`, `entity_id` and a rendered `deeplink`
route. The route is generated by the registry from the notification's own
entity fields, so a type cannot ship without one.

| Type | Deep link |
|---|---|
| `MESSAGE_RECEIVED`, `VOICE_MESSAGE_RECEIVED`, … | `/chats/{conversationId}?message={messageId}` |
| `MISSED_CALL`, `INCOMING_CALL` | `/chats/{conversationId}?call={callId}` |
| `CLASS_SCHEDULE_CHANGED`, `CLASS_CANCELLED`, `CLASS_REMINDER` | `/learners/{learnerId}/classes` |
| `ACADEMY_ANNOUNCEMENT`, … | `/announcements/{announcementId}` |
| `APPROVAL_*` | `/chats/{conversationId}?message={messageId}` |
| `RENEWAL_REMINDER`, `PAYMENT_REMINDER` | `/billing` |

The client **re-authorizes on arrival**: the link is a hint, the backend is the
authority, and a deleted or now-forbidden target renders a fallback.

## 5. Preferences: essential vs optional

- **In-app is never disableable.** The notification centre is the history; a
  preference that erases history is a bug, not a feature.
- **Push is per category**, and only for categories marked optional in
  `chat.notification_category`.
- **`is_essential` on a notification bypasses preferences entirely** — a class
  cancellation reaches a parent who muted class reminders.
- A database trigger refuses a preference row that disables a non-optional
  category, so a client cannot do through the API what the product forbids.

| Category | Optional | Essential members |
|---|---|---|
| `messaging` | yes | — |
| `calls` | yes | `MISSED_CALL` |
| `classes` | yes (reminders) | `CLASS_SCHEDULE_CHANGED`, `CLASS_CANCELLED` |
| `academy` | yes | `URGENT_ANNOUNCEMENT` |
| `billing` | yes | — |
| `approvals` | no | all |
| `account` | no | all |

## 6. Grouping and spam control

Grouping is applied **at the push, not in the centre**.

A teacher typing five short messages in a row buzzes a parent's phone once. The
first notification in a group pushes; the rest inside
`notification.group_window_seconds` are recorded `skipped` with reason
`GROUPED`. All five in-app notifications land, the badge counts five, and the
centre holds five. Once the parent has read one, the burst is over and the next
message buzzes again — a group key does not swallow a notification because of a
sibling that was already read.

The obvious alternative — one card per group in the centre, "5 new messages" —
was rejected on two grounds. Finding the newest of each group needs a window
function partitioned over the recipient's whole history, which is a full scan
per page and is exactly the query this system must not have at a million rows.
And the centre is the **record**: a parent looking for what they were told about
Tuesday's class needs the notification, not a count of its siblings.

Grouping is **refused outright** for `CLASS_SCHEDULE_CHANGED`,
`CLASS_CANCELLED`, `MISSED_CALL` and anything `urgent` — they carry no group key
at all, so a burst of them buzzes every time.

When the recipient is **actively viewing the conversation** (realtime presence
in the conversation room), a message notification is created in-app and its
push delivery is recorded `skipped` with reason `RECIPIENT_ACTIVE` — auditable,
not silently dropped.

## 7. Notification types NOT implemented, and why

| Type | Why not |
|---|---|
| `ATTENDANCE_MARKED`, `CLASS_STARTED`, `CLASS_COMPLETED` | `chat.event_log` names `class_attended` / `class_missed`, but nothing in this product writes them. There is no attendance producer to hang a notification on. |
| `STUDENT_PROGRESS_UPDATE` | No progress domain exists. |
| `COMPLAINT_UPDATE` | `chat.support_case` exists but the communication API has no case-transition path. |
| `PACKAGE_LOW_BALANCE` | No package or balance entity. |
| `PAYMENT_RECEIVED` | `chat.subscription.last_payment_status` is ingested from Jawwid Core, but no ingestion path in this repository transitions it, so there is no event. The template and rule are seeded and the type is registered; wiring is one `core_event` handler away. |
| `TEACHER_CHANGED` | `chat.learner.teacher_id` has no write path here. |


---

# Acceptance matrix

Every cell carries one of five states. There is no generic ✅, because "it
works" hides the difference between a thing that has been run end to end and a
thing that has only been read.

| State | Means |
|---|---|
| **PASS** | Exercised end to end by an automated test against a real Postgres, and the whole pipeline for that cell ran |
| **CODE-VERIFIED** | The code path is implemented and unit- or integration-tested, but the last hop is outside what this environment can execute |
| **DEVICE-E2E-PENDING** | Correct as far as the provider boundary; the FCM → device → OS → tap half has **not** been physically run. See *What has not been verified* |
| **NOT-IMPLEMENTED** | The capability does not exist. Not claimed, not partially claimed |
| **NOT-APPLICABLE** | The cell has no meaning for this row |

Columns, and what each one is asserting:

- **EVENT PRODUCER** — a real domain event exists and is written in the same
  transaction as the change that caused it.
- **DATABASE** — the notification row is created, deduplicated and persisted.
- **IN-APP** — it reaches the notification centre and the unread count.
- **REALTIME** — it is published to the recipient's actor room and the app acts
  on it without a refresh.
- **PUSH** — the push request is built, the provider accepts it, and the outcome
  is recorded per device.
- **DEEP LINK** — the minted route resolves to a screen this build has, and the
  landing re-authorizes.
- **PREFERENCES** — the category is muteable (or essential), and the mute is
  honoured at delivery.
- **MULTI-DEVICE** — every device the recipient holds is reached, and read state
  converges across them.
- **OFFLINE RECOVERY** — it survives having no socket and is complete on
  reconnect.
- **E2E VERIFIED** — the row has been driven from the producing action to the
  recipient's centre in one test.

| Notification | EVENT PRODUCER | DATABASE | IN-APP | REALTIME | PUSH | DEEP LINK | PREFERENCES | MULTI-DEVICE | OFFLINE RECOVERY | E2E VERIFIED |
|---|---|---|---|---|---|---|---|---|---|---|
| New message | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Voice message | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Media message | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Academy message | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Incoming call | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | NOT-APPLICABLE (essential) | PASS | PASS | PASS |
| Missed call | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Class reminder | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | NOT-IMPLEMENTED | PASS | PASS | PASS | PASS |
| Schedule changed | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | NOT-IMPLEMENTED | NOT-APPLICABLE (essential) | PASS | PASS | PASS |
| Class cancelled | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | NOT-IMPLEMENTED | NOT-APPLICABLE (essential) | PASS | PASS | PASS |
| Academy announcement | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Important announcement | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | PASS | PASS | PASS | PASS |
| Urgent announcement | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | NOT-APPLICABLE (essential) | PASS | PASS | PASS |
| Approval requested | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | NOT-APPLICABLE (essential) | PASS | PASS | PASS |
| Approval decided | PASS | PASS | PASS | PASS | DEVICE-E2E-PENDING | PASS | NOT-APPLICABLE (essential) | PASS | PASS | PASS |
| Renewal reminder | NOT-IMPLEMENTED | CODE-VERIFIED | CODE-VERIFIED | CODE-VERIFIED | DEVICE-E2E-PENDING | NOT-IMPLEMENTED | CODE-VERIFIED | CODE-VERIFIED | CODE-VERIFIED | NOT-IMPLEMENTED |
| Payment reminder | NOT-IMPLEMENTED | CODE-VERIFIED | CODE-VERIFIED | CODE-VERIFIED | DEVICE-E2E-PENDING | NOT-IMPLEMENTED | CODE-VERIFIED | CODE-VERIFIED | CODE-VERIFIED | NOT-IMPLEMENTED |
| Attendance | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED |
| Progress update | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED |
| Package balance | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED | NOT-IMPLEMENTED |

### Why PUSH is DEVICE-E2E-PENDING everywhere

Not a hedge, and not the same for every part of the path. What **is** verified,
by automated test: the payload is built and contains ids only; the FCM HTTP v1
request is signed, addressed and shaped correctly; a success, a rejection, an
invalid token and a transport error each produce the right delivery row; a
rotated token is followed; a dead token is deactivated; retries back off and
stop; and the app-side registrar registers, rotates, unregisters and resolves a
tapped payload to a route.

What is **not** verified: that a real FCM project accepts the request, that
Google delivers it to a real handset, that Android or iOS renders it, and that
tapping it wakes this app. That needs a device, a signing key and a
`google-services.json` / APNs key, none of which exist here — see *What has not
been verified* below for the exact per-platform position and the manual steps.

### Why the class deep links are NOT-IMPLEMENTED

`/learners/{id}/classes` is minted by the registry and has no screen in this
build. Reported NOT-IMPLEMENTED rather than PASS, because a link that cannot be
followed is not a working deep link. The decision holds against four conditions,
each of which is asserted in `notification-deeplinks.spec.ts`:

1. **Nothing is lost.** The notification carries the whole story — which child,
   the old time, the new time — frozen on the row at creation, so its own detail
   view is a real destination rather than a consolation prize.
2. **It does not lie.** `NotificationDeepLink.isActionable` returns false for it,
   so the card does not look tappable and then do nothing.
3. **No migration is needed later.** The server keeps minting the route, so the
   day a classes screen exists every notification already written points at it.
   Nothing is backfilled.
4. **It is reported honestly.** NOT-IMPLEMENTED in this matrix, not PASS.

### Why renewal and payment are NOT-IMPLEMENTED

The pipeline is complete and there is no event to start it:
`chat.subscription.renewal_due_at` is ingested from Jawwid Core and nothing in
this repository transitions it. Templates, rules, category and registry entries
exist and are covered, which is why the middle columns read CODE-VERIFIED — but
no producer means no notification, so the producer and the end-to-end columns
read NOT-IMPLEMENTED. No fake producer was added to fill the row in.

### Why attendance, progress and package balance are NOT-IMPLEMENTED

There is no domain event for any of them anywhere in this repository. Not a
missing template or an unwired handler — the fact itself is never recorded. A
notification type for an event that does not exist would be a lie in a registry.

## App states

| State | Behaviour | Proven by | State |
|---|---|---|---|
| A · viewing the conversation | Realtime updates the thread; the push is skipped and recorded `RECIPIENT_ACTIVE`; the notification and badge still happen | `notification-platform.spec.ts`, `app_state_behaviour_test.dart` | PASS |
| B · elsewhere in the app | Realtime notification, badge increments, centre grows — no refresh, no polling, from any screen | `app_state_behaviour_test.dart`, `badge_independence_test.dart` | PASS |
| C · backgrounded | FCM push; tap reports opened, marks read, and navigates | `push_lifecycle_test.dart`, `deep_link_navigation_test.dart` | CODE-VERIFIED (push transport DEVICE-E2E-PENDING) |
| D · terminated | The tap starts the process; the route is read before the router exists, held, and followed on the first frame | `push_lifecycle_test.dart`, `deep_link_navigation_test.dart` | CODE-VERIFIED (push transport DEVICE-E2E-PENDING) |
| E · offline | Notification persists; on reconnect the list, the unread count and reads that happened elsewhere are refetched | `app_state_behaviour_test.dart`, `notification-resilience.spec.ts` | PASS |

## Delivery semantics

What each state means, and what it does **not** claim.

| State | Set by | Means | Does not mean |
|---|---|---|---|
| `scheduled` | `schedule()` | The notification exists and is owed | Anything about delivery |
| `processing` | `dispatchDue()` claim | A worker holds a lease on it | That it was sent |
| `sent` | after every channel ran | The request left this system | That any device has it |
| `delivered` | client or provider report **only** | Something acknowledged receipt | That anyone saw it |
| `opened` | client report | The parent acted on a push | That they read it |
| `read_at` | the parent, in the app | They saw it in the centre | That a push arrived |
| `failed` | attempt budget exhausted | No channel succeeded | That the in-app copy is gone |

Per channel, on `chat.notification_delivery`:

| Channel | `sent` means | `delivered` means | Can it prove `opened`? |
|---|---|---|---|
| `in_app` | Published to the actor room | A client reported it | No — the centre reports `read` instead |
| `push` | FCM accepted the request | The device reported it | Only via the tap report |
| future email/SMS | Provider accepted | Provider webhook, if any | Depends on the provider |

**`sent` is never promoted to `delivered` by inference.** FCM accepting a
request says nothing about the handset, and fabricating an acknowledgement would
make every delivery metric a lie — which is worse than an unknown, because an
unknown prompts an investigation and a lie ends one.

## Source of truth

```
chat.notification   →  the record. Everything else is a way of carrying it.
realtime            →  speed. A missed event costs latency, never a notification.
push                →  reach, when the app is not open. Best-effort by nature.
```

No screen, count or badge is derived from realtime or from push. Stated as a
table, because "source of truth" is only useful if it says which question each
store answers:

| Question | Authority | Not the authority |
|---|---|---|
| Does this parent need to know? | `chat.notification` | Anything a client holds |
| What were they told, exactly? | `title` / `body` / `variables`, frozen at creation | Live domain data — re-rendering rewrites history |
| Is it unread? | `read_at` on the row, counted by the server | A sum over the page a client has loaded |
| How many unread? | `GET /notifications/unread-count` | The length of any local list |
| Did it reach a device? | `chat.notification_delivery`, per channel per device | The notification's own status |
| Did the parent see it? | `read_at` (in-app) / `opened_at` (a reported tap) | `sent`, which only means the request left |
| May they open the target? | The destination endpoint, re-checked on landing | The deep link, which proves nothing |
| Is the push muted? | `chat.notification_preference`, read at delivery | Any decision recorded earlier |

Three consequences worth naming, because each one is a design rule the code
follows rather than an observation:

1. **Realtime is never awaited.** Nothing waits for a publish to succeed before
   the notification is considered delivered, and nothing is reconstructed from a
   replay. A device that missed every event of its lifetime is correct after one
   fetch.
2. **The badge is server-side.** It is refetched on arrival, on a read, on a
   read from another device, and on reconnect — never incremented locally.
   Otherwise a parent with 400 notifications and one loaded page sees "30".
3. **Frozen text beats live text.** The one place a parent goes to check what
   they were told must not quietly change when the underlying fact changes. This
   is what makes "moved from 5:00 to 6:00" still true after the class moves
   again.

## What has NOT been verified

Stated per platform, because "Flutter push works" is not a result.

| Hop | Android | iOS |
|---|---|---|
| Payload built, ids only, no content | VERIFIED (automated) | VERIFIED (automated) |
| FCM HTTP v1 request signed and shaped | VERIFIED (automated) | VERIFIED (automated) |
| Provider response → delivery row | VERIFIED (automated) | VERIFIED (automated) |
| Token registration, rotation, unregister | VERIFIED (automated) | VERIFIED (automated) |
| Tapped payload → route → navigation | VERIFIED (automated) | VERIFIED (automated) |
| Manifest / entitlements declared | VERIFIED (by inspection) | VERIFIED (by inspection) |
| **A real FCM project accepts the send** | **NOT VERIFIED** | **NOT VERIFIED** |
| **The OS displays the notification** | **NOT VERIFIED** | **NOT VERIFIED** |
| **Tapping it wakes this app** | **NOT VERIFIED** | **NOT VERIFIED** |
| **Background / terminated wake-up** | **NOT VERIFIED** | **NOT VERIFIED** |

**Why, exactly.** This is a Linux container. `flutter devices` reports only
`Linux (desktop)`. There is no Android SDK, no `adb`, no emulator image and no
`/dev/kvm`, so no Android device — physical or virtual — can be attached. iOS is
further out of reach: building or running it requires macOS and Xcode, which do
not exist on Linux at all. There is also no `google-services.json` and no APNs
key in this repository, by design: they are per-project secrets, and
`android/app/build.gradle.kts` applies the Google Services plugin only when the
file is present so that a fresh clone still builds and runs without push.

**What remains to be done manually** is the checklist in
`docs/mobile/device-verification-checklist.md` — A1–A8 on Android, I1–I8 on iOS,
plus five real business scenarios. In outline, once someone has a device and the
credentials:

1. Put `google-services.json` in `android/app/` and `GoogleService-Info.plist`
   in `ios/Runner/`, and set the FCM service-account variables from
   `infra/env/manifest.tsv` on the API.
2. **Android** — `flutter run` on a physical device or an emulator with Play
   Services. Sign in, confirm a `chat.device_token` row appears, then send a
   message from another account and check: the notification appears on the lock
   screen; its text is the neutral "you have a new message", NOT the message
   body; tapping it opens the thread at that message; the badge is already
   correct when the app opens. Repeat with the app backgrounded and then
   force-stopped.
3. **iOS** — on macOS with Xcode: upload the APNs key to the Firebase project,
   run on a physical device (the simulator cannot receive remote push), and
   repeat the same four checks. Then the VoIP path separately: an incoming call
   push must ring through CallKit while the app is terminated.
4. Check `chat.notification_delivery` after each: `status = 'sent'` per device,
   and `delivered` only once the app reported it.

Everything above the bold rows in that table is covered by
`apps/api/test/unit/notifications/fcm.spec.ts`,
`test/features/notifications/push_lifecycle_test.dart` and
`test/features/notifications/deep_link_navigation_test.dart`.

## When a preference is read

A preference is read **at delivery**, not at creation. Every other suppression
is recorded at creation, because every other suppression is a fact about the
instant the event happened:

| Reason | Decided at | Why there |
|---|---|---|
| `RULE_IN_APP_ONLY` | creation | A property of the rule that scheduled it |
| `GROUPED` | creation | "Four arrived in the last two minutes" is about that moment |
| `RECIPIENT_ACTIVE` | creation | They were looking at the thread when it arrived |
| `CONVERSATION_MUTED` | creation | The thread's setting when the message landed |
| `PREFERENCE_OFF` | **delivery** | A standing instruction, not a fact about an instant |

The case that forces it: a class reminder is written today and fires at 8am
tomorrow. If the parent mutes that category tonight, "I muted this yesterday"
cannot be answered with "yes, but we had already decided to buzz you". The same
holds in reverse — unmuting before it fires lets it through.

For an immediate notification the two moments are milliseconds apart and nothing
changes. The delivery record is still written either way; it is written at the
moment the decision is actually made, so "why did this go out?" still has an
answer.

## Deduplication: the exact key at each stage

"It only happens once" is not one mechanism. It is five, each with its own
idempotency key, each absorbing a different failure. Every one of them is
asserted by name in `notification-platform.spec.ts` → *deduplication, stage by
stage*.

| # | Stage | Idempotency key | Enforced by | Absorbs |
|---|---|---|---|---|
| 1 | Outbox claim | `chat.outbox_event.id` | Conditional `update … where status='pending'` | Two workers draining at once; a worker restarting mid-drain |
| 2 | Notification | `chat.notification.dedupe_key` | `UNIQUE` index; `schedule()` treats P2002 as success | A replayed event, a re-run sweep, two producers of the same fact |
| 3 | Dispatch claim | `notification.id` + `status`/`lease_expires_at` | Conditional update; expired lease is re-claimable | A worker dying between claiming and sending |
| 4 | Delivery | `(notification_id, channel, device_token_id)` | `UNIQUE` index | A replayed dispatch re-sending to the same device |
| 5 | Transport | *none* | — | Nothing. See "the guarantee" below. |

### Stage 2, per producer

The key is composed by the producer, and it is the only stage where a producer
can get deduplication wrong. Each is pinned by a test that asserts the literal
string.

| Producer | Key | Why that shape |
|---|---|---|
| Message | `message:{messageId}:{recipientId}` | One message, one recipient, one notification — forever |
| Incoming call | `incoming_call:{callId}:{calleeId}` | Re-ringing the same call is the same fact |
| Missed call | `missed_call:{callId}:{recipientId}` | **Two producers** — the caller hanging up and the ring-timeout sweep — converge on one key |
| Approval requested | `approval_requested:{approvalId}:{approverId}` | The queue entry, not the message |
| Approval decided | `approval_decided:{approvalId}:{authorId}` | The decision, not the message |
| Announcement | `announcement:{announcementId}:{recipientId}` | A re-published or re-fanned announcement reaches each person once |
| Class reminder | `{ruleKey}:{learnerId}:{classAtISO}:{parentId}` | The class time is in the key, so moving the class produces new reminders and leaves the old ones to be cancelled |
| Schedule change | `class_change:{learnerId}:{fromISO}>{toISO}:{parentId}` | Keyed on the **transition** |
| Class cancelled | `class_change:{learnerId}:{fromISO}>none:{parentId}` | The same transition key, with `none` as the destination |

The schedule-change key is the one worth explaining. Keying on the learner alone
would silence a second, genuinely different change — the parent would never be
told the class moved again. Keying on the new time alone would repeat the first
notification every time the same request was retried. Keying on the transition
does both correctly, and it is why `5:00 PM → 6:00 PM` and `6:00 PM → 7:00 PM`
are two notifications while a double-tapped Save is one.

### The guarantee

**Notifications are exactly-once. Deliveries are at-least-once.**

Stages 1–4 make the *record* singular: one fact, one row, one badge increment,
one line in the centre, no matter how many times an event is replayed or a
worker restarts.

Stage 5 is not deduplicated and cannot be. A worker can die between the push
provider accepting the request and the database recording that it accepted —
two writes, two systems, no transaction across them. The recovery in
`DeliveryService.claim` re-attempts a delivery abandoned in `processing` for
more than five minutes, and it cannot distinguish "died before sending" from
"died after sending", because the only record of the difference is the write
that never landed.

So a parent can, rarely, see the same push twice. They cannot see the same
notification twice, and their unread count cannot double. That trade is
deliberate: the alternative — assuming a crashed attempt succeeded — means a
parent is silently not told their child's class was cancelled, and silence is
the one failure this platform exists to prevent.

This is proved, not asserted: see *a delivery abandoned between the provider
call and the acknowledgement* in `notification-resilience.spec.ts`, which
reproduces the crash and asserts that the second push is real.
