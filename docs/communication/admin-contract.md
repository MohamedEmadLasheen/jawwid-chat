> **STATUS: REFERENCE** (Phase 0, 2026-09-07). As above — contract of record is `docs/contracts/API-CONTRACT.md`.
> Canonical index: `docs/README.md`.

# Admin contract (AI #4)

What Admin Web can consume from the communication engine. Object shapes, the
websocket contract and error codes are shared with mobile — see
[mobile-contract.md](mobile-contract.md), [realtime-events.md](realtime-events.md)
and [error-codes.md](error-codes.md). This document covers what is
admin-specific.

## Authentication

Same seam as mobile: `X-Actor-Id: <staff id>` today, a bearer token later. The
staff role is resolved server-side from `chat.staff`; the client never asserts a
role.

## What an admin can see that others cannot

- **Any family conversation.** A parent or teacher must be a member; family-facing
  staff (admin / coverage / manager) may open any conversation. Finance,
  technical and academic staff may open none.
- **Internal notes** — `visibility: "internal"`. Invisible to parents and
  teachers, and never delivered to them. Render them inline in the thread in a
  distinct style.
- **Pending messages** — held for approval, invisible to the rest of the group.

## Conversations for a family

```http
GET /conversations           → all conversations, newest activity first
```

A family has several concurrent conversations, and the UI should reflect that:

| Type | Who is in it |
|---|---|
| `direct` (parent ↔ admin) | one contact + Jawwid staff |
| `direct` (teacher ↔ admin) | one teacher + Jawwid staff |
| `student_group` | parents + assigned teacher + family owner |

Filter by `familyId`. `chat.conversation.threadId` links back to the family's
`chat.thread`, which remains the anchor for cases, tasks, handoffs and the
attention/workload engines — those are unchanged and are not this domain's.

### Conversation state

`state` is **computed**, never stored or client-set:

| Value | Meaning |
|---|---|
| `waiting_on_jawwid` | last customer message is newer than the last staff message (`needsReply`) |
| `waiting_on_customer` | staff replied last |
| `resolved` | explicitly resolved; a new customer message reopens it |
| `open` | nothing said yet |

This does **not** replace `chat.support_case.status`. Case status is the ops
domain and is unchanged; this is the communication-level projection.

## Composer authority

Whether the logged-in admin may reply is a **server** decision. Call the send
endpoint and handle the error rather than reimplementing the rule:

| Situation | Result |
|---|---|
| On duty for the family (`chat.on_duty()`) | allowed; `onBehalfMode` derived |
| Sticky handler, window still open | allowed |
| Manager | always allowed |
| Internal note | always allowed, any family, any time |
| Off duty, customer-facing | `403 COMM.NOT_ON_DUTY` |
| Off duty, requesting assist/escalation | `403 COMM.ASSIST_NOT_PERMITTED` — see below |

`onBehalfMode` is **derived** from `on_duty()` and family ownership. Sending it
does not change it: a manager cannot stamp a message as the family's owner.
Display it on staff messages ("replied as coverage") — it is the audit trail the
brief requires.

> **"Reply as assist" is currently unavailable and fails closed.** Its real
> precondition (family in the NOW bucket, waited > 50% of the response target,
> on-duty admin has not opened it) depends on the attention engine, which is
> AI #1's. Until that grant exists the server denies it. Do not build a UI that
> implies it works; a disabled control with a tooltip is the honest rendering.

## Approval queue

```http
GET  /approvals/pending?conversationId=…   → { approvals: [...] }
POST /approvals/:id/approve
POST /approvals/:id/reject                 { reason }
GET  /approvals/history/:conversationId
```

Each entry carries the full `message`, so the queue can render the exact content
awaiting a decision.

Rules to build against:

- The approver is the family's **active handler** (sticky handler, else
  `chat.on_duty()`), or any manager. Anyone else gets `403 COMM.CANNOT_APPROVE`.
- **A rejection requires a reason** (`400 COMM.APPROVAL_REASON_REQUIRED`). It is
  stored and shown to the sender, so treat it as user-facing copy.
- **An approver can never edit a message.** There is no edit endpoint and the
  database refuses the update. If content is unacceptable, reject it with a reason
  and send a separate message. Do not build an edit affordance.
- Decisions are **once-only**. A second decision returns
  `409 COMM.APPROVAL_ALREADY_DECIDED` — refresh the queue rather than retrying.
- **Nothing expires.** A pending message stays pending until a human acts, so the
  queue is a real backlog: show age, and sort oldest-first.

Live updates: `approval.requested` (staff rooms only) and `approval.decided`.

## Membership

```http
POST /conversations/:id/members
{ action: "add" | "remove", actorId, actorKind, memberRole, isSilent?, reason }
```

Staff only; `reason` is required and written to `chat.audit_log`. Teachers and
parents receive `403 COMM.CANNOT_MANAGE_MEMBERSHIP` — including a parent trying
to remove the admin from a group, which is a BR-1 bypass attempt.

Group membership is normally **derived from Core**, not hand-managed:

```http
POST /conversations/student-group              { learnerId }   // create
POST /conversations/student-group/:learnerId/sync              // reconcile
```

Call `sync` after a teacher change, a contact change or an ownership transfer. It
retires departed members with `left_at` (never deletes them) and writes a system
message so the group can see what changed.

A student leaving archives the group; history stays readable under RBAC.

## Call history

```http
GET /calls/history/:conversationId
```

Returns type, status, outcome (`answered` / `missed` / `declined`), timestamps,
duration and participants. **No audio is recorded in MVP** and no phone number
appears anywhere. Realtime: the `call.*` events.

## Notifications

Reminder rules and templates are **data**, in `chat.notification_rule` and
`chat.notification_template`. If you build a settings screen, edit those rows —
offsets, channel, priority, quiet-hours exemption and enable/disable are all
columns. Nothing about a schedule is compiled into the code.

`chat.notification` rows carry per-recipient status (`scheduled`, `sent`,
`delivered`, `opened`, `failed`, …) and are the basis of any delivery report.
Note that `sent` does **not** get promoted to `delivered` without a real
acknowledgement — an operational dashboard must show "sent" honestly rather than
implying delivery.

## What this domain does not own

Cases, tasks, handoff cards, the attention score and buckets, the workload
engine, the Unattended list, shifts/coverage/absence config, ownership transfer,
and the manager dashboard's aggregates. Those are AI #1 and remain on
`chat.thread`, `chat.support_case`, `chat.task`, `chat.handoff`. This domain adds
conversations and everything inside them.
