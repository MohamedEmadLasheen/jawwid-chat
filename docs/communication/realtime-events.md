# Realtime events

Transport: Socket.IO. Horizontal scaling uses the Redis adapter, so an event
emitted on one node reaches sockets held by any other.

Source of truth: `apps/api/src/communication/contracts/events.ts`. Every event
has a typed payload; there are no untyped string events.

## Connecting

```js
io(API_ORIGIN, { transports: ['websocket'], auth: (cb) => cb({ token: currentAccessToken() }) })
```

The default namespace, and the bearer **access token** in the handshake `auth`
(RT-001; the old `actorId` seam is gone). `API_ORIGIN` is the server origin with
**no path**: socket.io reads a URL path as a namespace, and the server has only
`/`. Pass `auth` as a function so every reconnect presents the current token —
it rotates every 15 minutes. A refused token is answered with a server-side
disconnect (`io server disconnect`), which socket.io does not retry: refresh the
session once and reconnect.

An unknown or inactive actor is disconnected immediately. The server finishes
authenticating asynchronously, so a `conversation.subscribe` sent the instant
`connect` fires can be answered `COMM.UNKNOWN_ACTOR`; retry that one code a few
times with a short backoff. Every other refusal is a verdict.

## Rooms

A client **never names a room.** It asks to subscribe to a conversation and the
server authorizes it with the same `AuthorizationService` the REST API uses.

```js
socket.emit('conversation.subscribe', { conversationId }, (res) => {
  // { ok: true } | { ok: false, code: 'COMM.NOT_CONVERSATION_MEMBER' | 'COMM.STAFF_OUT_OF_SCOPE' | ... }
});
socket.emit('conversation.unsubscribe', { conversationId });
```

Every socket also joins its own actor room automatically, which is how
multi-device fan-out works: all of one person's devices receive the same events.

**Subscribe to every conversation in your list**, not only the open one: that
is how a message in another conversation moves the list and its unread badge.
Staff are subject to the same read check as the REST API, including **staff
scope** (2026-10-14): an admin may subscribe only to conversations in their
charge (member, family owner, on duty, live sticky handler); a manager, to
their organization's.

**A room is an index, not authorization** (RT-009): every delivery re-checks the
recipient's live identity and read access at the moment of delivery, so a
removed member, a revoked session or an out-of-scope admin receives nothing
further, and is sent `conversation.access_revoked`.

## Client → server

| Event | Payload | Notes |
|---|---|---|
| `conversation.subscribe` | `{ conversationId }` | Authorized; acknowledged. |
| `conversation.unsubscribe` | `{ conversationId }` | |
| `typing.start` | `{ conversationId }` | Debounced server-side (Redis, before any database read; a "started" goes out at most once per 3 s, and is re-announced every 5 s while pings keep coming, so clients may drop an indicator they have not heard about for 8 s); safe to call often — clients ping every 3 s while the draft changes. **PD-37: only a seated member** (live, not silent, not observer) may type; anyone else gets `{ ok: false }`. Never in a direct teacher↔parent conversation. |
| `typing.stop` | `{ conversationId }` | Same seat rule. |
| `presence.heartbeat` | — | Keeps this connection counted as online (`realtime.presence_ttl_seconds` = 45; send every ~30 s). |
| `message.delivered` | `{ conversationId, upToSeq }` (PD-37, preferred) or `{ messageIds: string[] }` | The cursor form moves the caller's delivery cursor forward (never back) and turns the authors' ticks grey ✓✓ via `message.status`. The id form only changes the caller's own receipts and announces nothing. |

## Server → client

| Event | Payload | Delivered to |
|---|---|---|
| `message.created` | `{ conversationId, messageId, seq, authorKind, authorId, type, visibility, moderation, createdAt }` | Conversation room. **Internal notes go only to staff rooms.** |
| `message.deleted` | `{ conversationId, messageId, deletedForAll }` | Conversation room |
| `message.updated` | `{ conversationId, messageId, visibility, editedAt }` — no body; re-read the message | Conversation room. **An internal note's edit goes only to staff rooms.** |
| `message.status` | `{ conversationId, items: [{ messageId, seq, status: 'sent'\|'delivered'\|'read' }] }` | **PD-37: the AUTHOR's sockets only**, through the conversation's delivery-time checks (RT-009). The new ticks on the recipient's own messages, under the WhatsApp group rule over seated readers. Names no reader: who read it is `GET …/messages/:id/info`. Up to 200 items per cursor move; one delivery per move, each author receiving only their own items. **Sent only while `realtime.receipts_announce` is on** — off by default, switched on after the PD-37 outbox worker is deployed everywhere (an older worker would fan the source event out to the whole room). |
| ~~`message.receipt.updated`~~ | — | **Never emitted; deprecated by PD-37.** It would have sent one reader's read to the whole room (the RT-012 roster). Use `message.status`. |
| `reaction.added` / `reaction.removed` | `{ conversationId, messageId, actorId, emoji }` | Conversation room |
| `typing.started` / `typing.stopped` | `{ conversationId, actorId, displayName }` | **PD-37: seated members of the conversation only**, excluding the sender. Never a PD-8 reader without a seat, a silent member or an observer. Never stored. |
| `presence.changed` | `{ actorId, state: 'online'\|'offline', lastSeenAt: string\|null }` | **PD-37: actor rooms of the people `PresencePolicy` allows, only.** Staff see staff; the super admin and the Teachers department see teachers; families and teachers see nobody and nobody sees a family. Sent on a TRANSITION only. "Online" on the first connection. "Offline" once the person's online state LAPSES: 15 s after a clean last disconnect, or when a stalled connection or a crashed node stops heart-beating. Every node sweeps for lapses every 5 s and each is claimed by exactly one node, so it is announced once. A reconnect inside the grace sends nothing. `lastSeenAt` is null when either side hides last seen. Initial state: `GET /presence`. Unrelated to `chat.staff.presence`, the coverage engine's on-duty state. |
| `conversation.updated` | `{ conversationId, familyId, state, needsReply, lastActivityAt, handlerId }` | Conversation room |
| `conversation.membership_changed` | `{ conversationId, added[], removed[] }` | Conversation room. Also emitted when a direct conversation or a Student Group is **created** (`added` = every member). |
| `conversation.added` | `{ conversationId }` | **Each added member's own actor room** (2026-10-14). A conversation they belong to now exists and they are not subscribed to it yet: re-read the list and subscribe. Carries nothing else. |
| `conversation.access_revoked` | `{ conversationId }` | The one socket that lost read access (RT-009). It was removed from the room; re-read what is still readable. |
| `approval.requested` | `{ conversationId, messageId, approvalId, requestedBy }` | **Staff rooms only** — never the group |
| `approval.decided` | `{ conversationId, messageId, approvalId, decision, rejectionReason }` | Conversation room |
| `call.incoming` | `{ callId, conversationId, type, initiatorId, initiatorName }` | Conversation room. **No `roomName`** (removed 2026-09-24): the room handle comes back from `POST /calls/:id/token` with the token that makes it usable. |
| `call.accepted` / `call.declined` | `{ callId, conversationId, actorId }` | Conversation room. Since 2026-09-27 a `call.declined` is accompanied by `call.ended` with `outcome: 'declined'` — the refusal ends the call. Both are enqueued in one transaction and share `created_at`, so their relative order is not guaranteed. |
| `call.participant_joined` / `call.participant_left` | `{ callId, conversationId, actorId }` | Conversation room. **MEDIA presence, emitted only by `POST /livekit/webhook`** — never by an HTTP accept, which emits `call.accepted`. A join is not an application answer and a leave does not end the call. |
| `call.ended` | `{ callId, conversationId, outcome, durationSeconds }` | Conversation room. Every termination: `end`, the ring-timeout sweep, and (since 2026-09-27) `decline`. |
| `notification.created` | `{ notificationId, recipientId, eventType, title, body, conversationId }` | Actor room |
| `notification.inbox_changed` | `{ recipientId, unread }` | **The recipient's own actor room only** (PD-34). The Notification Center gained, read or withdrew an entry; refetch `GET /me/notifications/counts`. Carries no text. |
| `conversation.read` | `{ conversationId, actorId, lastReadSeq }` | **The reader's own actor room only**, never the thread (PD-34). Another device of the same person read the chat up to `lastReadSeq`: clear its badge. Written to the outbox by `POST …/read` in the read's own transaction; the worker also withdraws that chat's waiting push and reads its Notification Center entry. |

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

## Privacy

No payload carries a phone number, email or address — the schema has no such
column. Actors appear as an opaque id plus a display name.

## Reconnect

1. Reconnect and re-subscribe to every listed conversation — and only **then**
   catch up, so nothing committed between the catch-up read and the rejoin is
   missed.
2. For each open thread, `GET …/messages?after=<last seq you hold>`, following
   the watermark until nothing newer comes back; then re-read the newest page
   (`GET …/messages`) — a deletion, a reaction or an approval does not move a
   seq, so the watermark alone never sees it.
3. Re-read the list (`GET /conversations`) for activity and unread counts.
4. Send `message.delivered` for anything newly received.

**A held message keeps its seq.** A message sent for approval is assigned its
seq at send time and, once approved, is announced by `message.created` with
that ORIGINAL seq — possibly below what the client has already read. Fetch it
with `?after=<its seq - 1>`, not `?after=<your newest>`.

Ordering comes from `seq`, so replay is deterministic and gap-free regardless of
arrival order or device clocks.
