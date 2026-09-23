> **STATUS: REFERENCE** (Phase 0, 2026-09-07). The endpoint shapes are current; the `X-Actor-Id` auth seam is DEPRECATED and the contract of record is `docs/contracts/API-CONTRACT.md`.
> Canonical index: `docs/README.md`.

# Mobile contract (AI #3)

Everything the Parent and Teacher apps need. You should not need to read the
database schema or any service in `apps/api/src/communication`.

See also [realtime-events.md](realtime-events.md) and [error-codes.md](error-codes.md).

## Authentication

> **AI #1 seam.** Every request currently carries `X-Actor-Id: <actor id>`, and
> the websocket handshake carries `{ auth: { actorId } }`. When real auth lands
> this becomes a bearer token and the server resolves the actor from it. **No
> endpoint, payload or error code below changes.**
>
> The header is not a security boundary you can lean on: every service
> re-resolves the actor and re-runs authorization, so presenting someone else's
> id gains only what that person could already do — and once tokens land, not
> even that.

## Objects

### Conversation

```jsonc
{
  "id": "uuid",
  "type": "direct" | "student_group" | "class_group" | "official",
  "familyId": "uuid | null",
  "learnerId": "uuid | null",
  "title": "Ahmed · Jawwid",          // null for 1:1
  "state": "open" | "waiting_on_customer" | "waiting_on_jawwid" | "resolved",
  "needsReply": true,
  "lastSeq": "42",                    // string: 64-bit
  "lastActivityAt": "2026-09-06T10:00:00.000Z",
  "archivedAt": null,
  "teacherRequiresApproval": true,
  "parentRequiresApproval": true,
  "members": [                        // only on detail responses
    { "actorId": "uuid", "actorKind": "contact", "memberRole": "parent", "isSilent": false }
  ]
}
```

`state` is computed by the server. Never send it.

For a parent, the 1:1 with Jawwid should be presented as **"Jawwid"**, with the
current handler shown as a subtitle ("Handled by …") from
`conversation.updated.handlerId`. The conversation is bound to the family, so a
handler change must **not** look like a new chat.

### Message

```jsonc
{
  "id": "uuid",
  "conversationId": "uuid",
  "seq": "17",                        // string: order by this, numerically
  "authorKind": "contact" | "staff" | "teacher" | "system",
  "authorId": "uuid | null",
  "onBehalfMode": "owner" | "coverage" | "assist" | "escalation" | null,
  "type": "text" | "image" | "video" | "voice" | "file" | "system",
  "body": "…",                        // null when deleted for everyone
  "visibility": "customer" | "internal",   // you will only ever see "customer"
  "moderation": "published" | "pending" | "rejected",
  "origin": "user" | "automation" | "broadcast",
  "replyToMessageId": "uuid | null",
  "clientMessageId": "your-key | null",
  "deletedForAll": false,
  "createdAt": "2026-09-06T10:00:00.000Z",
  "attachments": [ { "id": "uuid", "kind": "voice", "mimeType": "audio/mpeg",
                     "byteSize": 20480, "durationMs": 4200,
                     "url": "https://…signed…", "thumbnailUrl": null } ],
  "reactions": [ { "actorId": "uuid", "emoji": "👍" } ],
  "receipts":  [ { "actorId": "uuid", "state": "read", "readAt": "…" } ]
}
```

Attachment `url`s are **short-lived and signed**. Do not cache or persist them;
re-fetch the message when one expires.

A `type: "system"` message carries JSON in `body` (`{"kind":"group.created",…}`) —
render it as a system card, never as chat text.

## REST

### Conversations

```http
GET  /conversations                       → { conversations: [...] }
POST /conversations/direct                { withActorId }        → Conversation
POST /conversations/student-group         { learnerId }          → Conversation
GET  /conversations/:id                                          → Conversation
POST /conversations/:id/preferences       { archived?, pinned?, mutedUntil? }
```

`POST /conversations/direct` is **get-or-create** and idempotent. Calling it for
a teacher/parent pair returns `403 COMM.BR1_TEACHER_PARENT_DIRECT` — that pair
has no 1:1 channel and never will. Surface the Student Group instead.

Archive/mute/pin are **per user**. A parent pinning a chat does not pin it for
the admin.

### Messages

```http
GET /conversations/:id/messages?before=<seq>&limit=50   → newest-first page
GET /conversations/:id/messages?after=<seq>             → catch-up, oldest-first
```

Response: `{ messages: [...], nextBefore: "12" | null }`. Page backwards with
`before`; `nextBefore: null` means you have reached the beginning.

```http
POST /conversations/:id/messages
{
  "type": "text",
  "body": "…",
  "clientMessageId": "uuid-you-generated",   // ALWAYS send this
  "replyToMessageId": "uuid | null",
  "attachments": [ { "kind": "voice", "objectKey": "…", "mimeType": "audio/mpeg",
                     "byteSize": 20480, "durationMs": 4200 } ]
}
```

**Idempotency.** `clientMessageId` makes retrying free: the same key returns the
original message instead of creating a second. Generate it once when the user
hits send, keep it in your outbox, and reuse it for every retry — including after
an app restart. This is the whole offline story; there is nothing else to do.

```http
POST   /conversations/:id/messages/read           { upToSeq: "42" }
GET    /conversations/:id/messages/unread         → { unread: 3 }
POST   /conversations/:id/messages/:mid/reactions { emoji }
DELETE /conversations/:id/messages/:mid/reactions
DELETE /conversations/:id/messages/:mid/me        // delete for me
DELETE /conversations/:id/messages/:mid?reason=…  // delete for everyone
```

One reaction per person per message; reacting again replaces it.

### Attachments

Three steps. Binary never passes through the API.

```http
POST /conversations/:id/messages/attachments/authorize
{ "kind": "voice", "mimeType": "audio/mpeg", "byteSize": 20480 }
→ { objectKey, uploadUrl, method: "PUT", headers, expiresAt }
```

1. Authorize (this is where size/MIME limits are enforced).
2. `PUT` the bytes to `uploadUrl` with the returned headers.
3. Send the message with the returned `objectKey`.

Limits are configurable; current defaults are 10 MB image, 100 MB video,
16 MB voice, 25 MB file. Over-limit returns `COMM.ATTACHMENT_TOO_LARGE`
**before** the user waits for an upload.

The upload signature **binds the MIME type and the byte size** it was issued for.
Send exactly the `content-type` the authorization returned in `headers`, and
exactly the number of bytes you declared; anything else is refused with `403`.
An authorization taken out for a small note cannot be spent uploading a large
file.

`GET` on a signed read URL supports `Range`, so a player streams a voice note
and starts on the first chunk rather than downloading the whole file. Read URLs
are minted per read and expire — do not cache or persist one.

Voice notes: you own recording, playback and speed. Send `durationMs`. It is
bounded server-side (default ten minutes) because the server never decodes the
audio to check it; keep the client's own recording ceiling below that so a long
take is stopped rather than refused after the fact.

### Approvals (Teacher and Parent apps)

In a Student Group, a teacher's or parent's message may be **held for approval**.
It comes back from `POST /messages` with `moderation: "pending"`.

Show it in the thread as *your own message, awaiting approval*. Do not show it as
sent, and do not expect other members to see it — they cannot.

```http
GET /approvals/mine   → { approvals: [ { approvalId, messageId, message, … } ] }
```

You are told the outcome by `approval.decided` on the websocket. On rejection,
`rejectionReason` is always present — show it. An approver can never edit a
message, so text you see is always exactly what was sent.

### Calling

```http
POST /calls                { conversationId }  → { callId, roomName }
POST /calls/:id/token                          → { token, url, roomName, expiresAt }
POST /calls/:id/accept
POST /calls/:id/decline
POST /calls/:id/end        { outcome? }
GET  /calls/history/:conversationId
```

Flow:

1. Caller `POST /calls`. Participants come from conversation membership — you
   never send a participant list.
2. Everyone receives `call.incoming` (and a VoIP push).
3. Each participant `POST /calls/:id/token` and connects to LiveKit with
   `{ token, url }`.
4. `POST /calls/:id/end` when finished.

Tokens are **short-lived (≈120 s) and scoped to one room**. Fetch one per join;
never cache or share one. The full authorization chain re-runs at token issue, so
a revoked permission takes effect on the next join.

A 1:1 call between a teacher and a parent returns
`403 COMM.BR1_TEACHER_PARENT_DIRECT`. Group calls in the Student Group are the
supported path and include the admin.

### Notifications

```http
GET    /notifications?category=&unread=&cursor=&limit=
GET    /notifications/unread-count
GET    /notifications/:id
GET    /notifications/:id/deliveries
POST   /notifications/:id/read
POST   /notifications/read-all               { category? }
POST   /notifications/read-conversation/:conversationId
```

`GET /notifications` is **keyset-paginated**: pass the previous page's
`nextCursor` back as `cursor`. The cursor is opaque — a position, not an offset
to do arithmetic on. A stale or malformed cursor returns the newest page rather
than an error, so an old bookmark is never a red screen.

A card carries everything needed to render it without a second request:

```json
{ "id", "type", "category", "priority", "title", "body", "createdAt",
  "readAt", "isEssential", "deeplink", "entityType", "entityId",
  "conversationId", "learnerId", "learnerName", "senderId", "senderName",
  "announcementId", "imageUrl" }
```

**`title` and `body` are already rendered, in the recipient's language, and are
frozen.** Do not recompose either from the other fields: they were rendered once
at creation so that a second schedule change cannot rewrite what the parent was
told the first time, and rebuilding the sentence client-side undoes exactly
that.

**`learnerName` is which child it is about.** Show it. A parent with three
children must never have to guess.

**`deeplink` is a route the server minted**, e.g.
`/chats/{conversationId}?message={messageId}`. Follow it, do not construct it —
and re-authorize on arrival: the link is a navigation hint, the backend is the
authority, and a deleted or now-forbidden target must render a fallback rather
than a crash.

**Unread comes from the server.** `GET /notifications/unread-count` returns
`{ total, byCategory }`. Never sum the page you happen to have loaded: it would
show 30 against 400 and would disagree with the same person's other device.

`read` is idempotent — calling it twice preserves the first read time — and so
is `read-all`. Opening a thread should call `read-conversation`; making a parent
dismiss the same thing twice is how people learn to ignore the badge.

### Notification preferences

```http
GET    /notifications/preferences
POST   /notifications/preferences            { category, pushEnabled }
```

Preferences control **push only**. In-app notifications are never disableable —
the centre is the record of what happened, and a setting that erases it is a
defect. A category with `isOptional: false` must render **locked, not hidden**;
the server refuses to mute it, and so should the UI.

An `isEssential` notification ignores preferences entirely, which is why a
cancelled class reaches a parent who muted class reminders.

### Announcements

```http
GET    /announcements/:id
```

The landing for an academy notification's deep link. Authorized by the
notification addressed to this actor, so an old, shared or guessed id returns
404 — and an expired one returns 410. Render both as "no longer available".

### Push

```http
POST   /notifications/devices          { token, platform, isVoip?, locale? }
DELETE /notifications/devices/:token
POST   /notifications/:id/delivered
POST   /notifications/:id/opened
```

Register on every launch and after each token rotation. Register the VoIP/CallKit
token separately with `isVoip: true`. **Multi-device is normal** — never assume
one device per user, and never unregister another device's token. `DELETE` is
scoped to the caller: you cannot unregister somebody else's device by knowing
its token.

Report `delivered`/`opened` honestly: the server does not infer them, so your
reports are the only source of those states.

**A push payload carries routing ids only** — `notificationId`, `type`,
`category`, `priority`, `entityType`, `entityId`, `conversationId`, `learnerId`,
`announcementId`, `deeplink`. No message content reaches a lock screen for
anything in the messaging category. Fetch the notification by id on tap.

## Offline and reconnect

The server gives you the four things an offline queue needs:

1. **Idempotent send** — retry with the same `clientMessageId` forever.
2. **Deterministic order** — sort by `seq` numerically; ignore `createdAt` for
   ordering.
3. **Catch-up** — `GET …/messages?after=<highest seq you hold>`.
4. **Receipt reconciliation** — monotonic (`sent < delivered < read`), so a late
   replayed `delivered` can never downgrade a `read`.

On reconnect: re-subscribe → catch up with `after` → send `message.delivered` for
anything new. Ordering is safe to replay because `seq` is server-assigned.

## What you must not build

- Any client-side check as the enforcement of BR-1. The server is the authority;
  a client-side rule is a UX affordance and nothing more.
- A phone-number field anywhere. There is none in any payload, by construction.
- A second conversation for a family when the handler changes — it is the same
  conversation with a different `handlerId`.
