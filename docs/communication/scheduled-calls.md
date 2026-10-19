# Scheduled calls and call links (PD-13)

Status: IMPLEMENTED on `claude/calls-page` (2026-10-19). Owner decisions: see
`docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-13.

## The model in one paragraph

A scheduled call is an **announcement inside one conversation**, never a grant.
It belongs to exactly one conversation (a 1:1 or a group). Creating one posts a
card into that conversation, so every member sees it. Nothing rings until a
member taps **Join** inside the join window. The first Join starts the call
through the ordinary call path (`CallService.start`), and every later Join takes
that member's seat in the live call (`CallService.accept`). Authorization is
decided again at every step by the rules that already exist. A **call link** is
the same row with `kind: 'link'`: it starts now, so it is joinable immediately.
A link is a name, not a capability. Opening it requires being signed in and
able to read the conversation. There is no guest access.

## Rules

| Action | Who | Decided by |
|---|---|---|
| Schedule / create link | anyone who may **start** a call in the conversation right now | `CallService.callCapability` (the same `decideInitiate` as `POST /calls`). So a parent cannot schedule a group call (PD-2), and nobody can schedule a teacher↔parent 1:1 (PD-7). |
| See (list, get) | anyone who can read the conversation | `canRead` (404 otherwise, indistinguishably) |
| Join | any member with a seat | `CallService.start` (first) / `accept` (later). A parent's Join on a group call nobody has started is refused with `COMM.PARENT_CANNOT_START_GROUP_CALL`; show "waiting for the host". |
| Cancel | the creator only, before it is over | service; posts a `call_schedule_cancelled` card |

Join window: from **10 minutes before** `startsAt` until **2 hours after** it.
A link's `startsAt` is the moment it was created.

## Endpoints (all under `/api/v1`, bearer auth)

### `POST /scheduled-calls`

```json
{ "conversationId": "uuid", "kind": "scheduled" | "link", "startsAt": "ISO-8601 (required for scheduled)", "title": "optional, ≤120" }
```

The response is a `ScheduledCallDto`. The errors are:
- 400 `COMMON.VALIDATION`: the message names the field.
- 404 `COMM.CONVERSATION_NOT_FOUND`.
- 403 with the call-capability refusal code, for example `COMM.PARENT_CANNOT_START_GROUP_CALL`, `COMM.BR1_TEACHER_PARENT_DIRECT` or `COMM.NOT_CONVERSATION_MEMBER`.

### `GET /scheduled-calls`
Returns `{ items: ScheduledCallDto[] }`: the caller's not-cancelled calls that are not yet over, soonest first, at most 50.

### `GET /scheduled-calls/:id`
Returns a `ScheduledCallDto`. Returns 404 `COMM.SCHEDULED_CALL_NOT_FOUND` when the call does not exist or the caller cannot read its conversation.

### `POST /scheduled-calls/:id/cancel`
Returns a `ScheduledCallDto`. Only the creator may cancel (403 `COMM.SCHEDULED_CALL_DENIED` otherwise). Cancelling a call that is already over is 409 `COMM.SCHEDULED_CALL_NOT_JOINABLE`. Cancelling twice is idempotent.

### `POST /scheduled-calls/:id/join`
Returns `{ "callId": "uuid", "conversationId": "uuid", "mode": "started" | "joined" }`.

- `started`: the caller started the call, which is now ringing the others. The client behaves exactly as after `POST /calls`, in the outgoing ringing state.
- `joined`: a call is already live here and the caller has a seat. The client runs the incoming-accept path: `POST /calls/:id/accept`, then `POST /calls/:id/token`, then joins the media.
- If this device is already ringing for that `callId`, it just accepts.

Joins are serialized per scheduled call, so two simultaneous Joins produce one call.

Errors:
- 409 `COMM.SCHEDULED_CALL_NOT_JOINABLE`: cancelled, not open yet, or over.
- 403 `COMM.PARENT_CANNOT_START_GROUP_CALL` and the other start refusals.
- 409 `COMM.CALL_NOT_A_PARTICIPANT`: a call is live but the caller has no seat in it.

### `ScheduledCallDto`

```json
{
  "id": "uuid", "conversationId": "uuid",
  "kind": "scheduled" | "link", "title": "string|null",
  "startsAt": "ISO", "joinableFrom": "ISO", "joinableUntil": "ISO",
  "state": "upcoming" | "open" | "cancelled" | "over",
  "createdBy": { "actorId": "uuid", "displayName": "string|null" },
  "canCancel": true
}
```

`state` is computed with the server's clock at response time. Clients re-derive "can I join yet" from `joinableFrom`/`joinableUntil` and treat the server's answer to Join as final.

## Chat cards

The cards travel as ordinary `type: "card"` messages, so they arrive through `message.created` and push.

| `card.kind` | When | Payload |
|---|---|---|
| `call_scheduled` | a call is scheduled | `scheduledCallId, kind, title, startsAt, joinableFrom, joinableUntil, when, byName` |
| `call_link` | a link is created | same fields |
| `call_schedule_cancelled` | the creator cancels | same fields |

`when` is the start time already formatted in the academy's zone and the scheduler's language. `body` is a plain-text fallback for older clients. A card never carries a phone number, a room name or a token.

A client draws `call_scheduled` and `call_link` with a **Join** button, enabled inside `[joinableFrom, joinableUntil]`. The button calls `POST /scheduled-calls/:id/join`. The card content is written once and never changes, so a cancellation arrives as a separate card. Join on a cancelled call returns 409.

## Deliberately not built (follow-ups)

- **Reminder pushes** before the start. Today the card's own `message.created` push is the only notification.
- **Editing or rescheduling.** For now you cancel and create a new one.
- **Guest links**, by owner decision.
- A scheduled call covering **several separate 1:1 chats**, by owner decision: pick their group instead.
