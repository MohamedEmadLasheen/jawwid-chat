# Realtime events

Transport: Socket.IO. Horizontal scaling uses the Redis adapter, so an event
emitted on one node reaches sockets held by any other.

Source of truth: `apps/api/src/communication/contracts/events.ts`. Every event
has a typed payload; there are no untyped string events.

## Connecting

```js
io(API_URL, { auth: { actorId: "<actor id>" } })
```

> **AI #1 seam.** The handshake currently carries an actor id. When real auth
> lands it carries a token instead and the server resolves the actor from it.
> The event contracts below do not change.

An unknown or inactive actor is disconnected immediately.

## Rooms

A client **never names a room.** It asks to subscribe to a conversation and the
server authorizes it with the same `AuthorizationService` the REST API uses.

```js
socket.emit('conversation.subscribe', { conversationId }, (res) => {
  // { ok: true } | { ok: false, code: 'COMM.NOT_CONVERSATION_MEMBER' }
});
socket.emit('conversation.unsubscribe', { conversationId });
```

Every socket also joins its own actor room automatically, which is how
multi-device fan-out works: all of one person's devices receive the same events.

## Client → server

| Event | Payload | Notes |
|---|---|---|
| `conversation.subscribe` | `{ conversationId }` | Authorized; acknowledged. |
| `conversation.unsubscribe` | `{ conversationId }` | |
| `typing.start` | `{ conversationId }` | Debounced server-side; safe to call often. |
| `typing.stop` | `{ conversationId }` | |
| `presence.heartbeat` | — | Refreshes a TTL key. |
| `message.delivered` | `{ messageIds: string[] }` | Only the caller's own receipts change. |

## Server → client

| Event | Payload | Delivered to |
|---|---|---|
| `message.created` | `{ conversationId, messageId, seq, authorKind, authorId, type, visibility, moderation, createdAt }` | Conversation room. **Internal notes go only to staff rooms.** |
| `message.deleted` | `{ conversationId, messageId, deletedForAll }` | Conversation room |
| `message.receipt.updated` | `{ conversationId, messageId, actorId, state, at }` | Conversation room |
| `reaction.added` / `reaction.removed` | `{ conversationId, messageId, actorId, emoji }` | Conversation room |
| `typing.started` / `typing.stopped` | `{ conversationId, actorId, displayName }` | Conversation room, excluding sender |
| `presence.changed` | `{ actorId, state, lastSeenAt }` | Actor rooms |
| `conversation.updated` | `{ conversationId, familyId, state, needsReply, lastActivityAt, handlerId }` | Conversation room |
| `conversation.membership_changed` | `{ conversationId, added[], removed[] }` | Conversation room |
| `approval.requested` | `{ conversationId, messageId, approvalId, requestedBy }` | **Staff rooms only** — never the group |
| `approval.decided` | `{ conversationId, messageId, approvalId, decision, rejectionReason }` | Conversation room |
| `call.incoming` | `{ callId, conversationId, type, initiatorId, initiatorName, roomName }` | Conversation room |
| `call.accepted` / `call.declined` | `{ callId, actorId }` | Conversation room |
| `call.participant_joined` / `call.participant_left` | `{ callId, actorId }` | Conversation room |
| `call.ended` | `{ callId, conversationId, outcome, durationSeconds }` | Conversation room |
| `notification.created` | `{ notificationId, recipientId, eventType, title, body, conversationId }` | Actor room — every device this person holds |
| `notification.read` | `{ recipientId, notificationId, conversationId, category, all, readAt }` | Actor room — the reader's own, and no one else's |

## Guarantees

- **Nothing is lost on commit.** Events are written to `chat.outbox_event` in the
  same transaction as the change and published by a worker. A committed message
  cannot lose its fan-out.
- **At-least-once.** An event may arrive twice. Dedupe on `messageId` / `callId`.
- **`message.created` is a hint, not the payload.** It carries no body. Fetch the
  message, or rely on the copy from your own send. This keeps a single
  authorization path for content.
- **A pending message emits nothing** to the conversation. It becomes visible only
  when approved.
- **`notification.created` is immediacy, not reliability.** The notification is
  already in `chat.notification` before this is emitted, and the notification
  centre is the record. A missed event costs latency — the parent sees it on
  their next load — never a lost notification. Treat it as a signal to refresh
  the list and the unread count, not as the notification itself.
- **`notification.read` is cross-device sync, in the other direction.** A parent
  with a phone and a tablet clears the badge on one; this is what tells the
  other. Exactly one selector is meaningful — `notificationId` for a single row,
  `conversationId` for a thread that was opened, or `all` (optionally narrowed
  by `category`). It is emitted only when the read actually changed something,
  so a retried read is silent, and it is published only after the read is
  committed — a publish that fails never fails the read. `readAt` is the
  server's timestamp: use it rather than the receiving device's clock, so two
  devices agree on when as well as whether.

## Privacy

No payload carries a phone number, email or address — the schema has no such
column. Actors appear as an opaque id plus a display name.

## Reconnect

1. Reconnect and re-subscribe to visible conversations.
2. For each, `GET …/messages?after=<last seq you hold>`.
3. Send `message.delivered` for anything newly received.

Ordering comes from `seq`, so replay is deterministic and gap-free regardless of
arrival order or device clocks.
