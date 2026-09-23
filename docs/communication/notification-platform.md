# The notification platform

> Phase 0 audit, architecture and operating notes for the academy-wide
> notification infrastructure. Source of truth for how an event becomes
> something a parent sees.

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
