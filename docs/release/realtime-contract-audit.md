# Realtime Contract Audit — End to End

Date: 2026-09-06 · Auditor: AI #4 · Status: 🔴 **NOT RECONCILED**
Chain audited per event: **client consumer → client contract → server producer → transport → recipient authorization**

## 1. Method

For each event I traced: does the Admin Web subscribe to it · is it in AI #2's
`contracts/events.ts` · is it enqueued by a real service · does the outbox worker
fan it out · is delivery authorized per recipient.

`STATUS` ∈ `IMPLEMENTED · PARTIAL · NO PRODUCER · CONTRACT MISMATCH · UNVERIFIED`.

## 2. Admin Web's 11 subscriptions

| # | Admin event | In AI #2 contract | Server producer | Worker fan-out | Status |
|---|---|---|---|---|---|
| 1 | `message.created` | ✅ same name | `message.service.ts:225`, `approval.service.ts:187` | ✅ explicit case; internal notes → staff rooms only | **CONTRACT MISMATCH** — payload `{family_id, message}` vs `{conversationId, messageId, seq, …}` |
| 2 | `presence.changed` | ✅ same name | ❌ none found | — | **NO PRODUCER** |
| 3 | `handoff.created` | ❌ **removed** from contract | ❌ none | — | **NO PRODUCER** |
| 4 | `family.updated` | ❌ | ❌ | — | **NO PRODUCER** |
| 5 | `case.updated` | ❌ | ❌ | — | **NO PRODUCER** |
| 6 | `task.updated` | ❌ | ❌ | — | **NO PRODUCER** |
| 7 | `coverage.changed` | ❌ | ❌ | — | **NO PRODUCER** |
| 8 | `ownership.changed` | ❌ | ❌ | — | **NO PRODUCER** |
| 9 | `unattended.changed` | ❌ | ❌ | — | **NO PRODUCER** |
| 10 | `escalation.created` | ❌ | ❌ | — | **NO PRODUCER** |
| 11 | `shift.ending` | ❌ | ❌ | — | **NO PRODUCER** |

**10 of 11 have no producer. The eleventh has an incompatible payload. Zero are IMPLEMENTED.**

## 3. AI #2's 19 canonical events

| Event | Producer | Worker | Admin consumer | Status |
|---|---|---|---|---|
| `message.created` | ✅ | ✅ explicit | ⚠️ name matches, payload differs | **CONTRACT MISMATCH** |
| `message.deleted` | `message.service.ts:559` | default | ❌ | **PARTIAL** (no admin consumer) |
| `message.receipt.updated` | ❌ not found | — | ❌ | **NO PRODUCER** |
| `reaction.added` / `reaction.removed` | ✅ `:475/:494` | default | ❌ | **PARTIAL** |
| `typing.started` / `typing.stopped` | ✅ gateway `:113/:130` | n/a (direct) | ❌ | **PARTIAL** |
| `presence.changed` | ❌ | — | ✅ subscribed | **NO PRODUCER** |
| `conversation.updated` | ✅ `message.service.ts:238` | default | ❌ | **PARTIAL** |
| `conversation.membership_changed` | ✅ `conversation.service.ts:305,394` | default | ❌ | **PARTIAL** |
| `approval.requested` | ✅ `message.service.ts:208` | ✅ staff-only fan-out | ❌ **admin has no approvals UI** | **PARTIAL** |
| `approval.decided` | ✅ `approval.service.ts:200` | ✅ | ❌ | **PARTIAL** |
| `call.incoming` | ✅ `call.service.ts:94` | ✅ | ❌ | **PARTIAL** |
| `call.accepted` | ❌ not found | — | ❌ | **NO PRODUCER** |
| `call.declined` / `call.ended` | ✅ `:202/:232` | default | ❌ | **PARTIAL** |
| `call.participant_joined` | ✅ `:186` | default | ❌ | **PARTIAL** |
| `call.participant_left` | ❌ not found | — | ❌ | **NO PRODUCER** |
| `notification.created` | via `notifyNewMessage` | ✅ | ❌ | **PARTIAL** |

## 4. Structural gap — not just missing names

This is the finding that matters, and renaming events will not fix it.

**AI #2 fans out per *conversation room*** (`room.conversation(conversationId)`)
or to explicit actor rooms. **Every Admin Web operational event is
family-scoped or staff-scoped, not conversation-scoped**: ownership changed,
coverage changed, workload/unattended changed, shift ending, follow-up due.

There is **no room concept for staff operational events**. So even a perfectly
renamed `ownership.changed` has nowhere to be delivered. The admin inbox's entire
freshness model — which is the product's primary surface — has no transport.

**Required:** a staff/operational room dimension (e.g. `room.staff(staffId)`,
`room.family(familyId)`) alongside the conversation rooms, with server-side
subscription. The client must never choose its own rooms.

## 5. Transport and authorization defects

| ID | Defect | Consequence |
|---|---|---|
| **RTC-1** | Gateway declared `@WebSocketGateway({ cors: { origin: false } })` | Admin Web's cross-origin socket is **blocked outright**. No admin realtime can work today regardless of events. |
| **RTC-2** | Namespace mismatch — admin connects to `/staff`; gateway declares no namespace (default `/`) | No connection even if CORS were fixed. |
| **RTC-3** | AI #9 **RT-009**: realtime session never re-evaluates identity | A revoked/offboarded session keeps receiving. Compounds JC-006. |
| **RTC-4** | Recipient authorization is by room membership only | Per-event authorization (e.g. internal notes) is handled correctly for `message.created` via staff-room fan-out, but is **not a general mechanism**. |

**Positive finding worth preserving:** the worker deliberately routes
`visibility: INTERNAL` messages to staff rooms only, never the conversation room
where a parent listens, and `approval.requested` to deciding staff only. That is
correct privacy behaviour and must survive any renaming.

## 6. Candidate authority

AI #2's `contracts/events.ts` is the **strongest candidate**: it is typed, has a
no-raw-strings rule, carries an explicit privacy constraint (no phone/email/
address in payloads), and is the only one with real producers.

**But it is not authoritative merely because it exists**, and it is not
sufficient as written:

- it has **no vocabulary at all** for the operating model — ownership, coverage,
  attention, workload, unattended, tasks, shift boundaries — which is the
  majority of the admin product;
- it presumes conversation-scoped delivery only (§4);
- `message.receipt.updated`, `presence.changed`, `call.accepted` and
  `call.participant_left` are declared but unproduced.

**The final authority must be the approved PRD + the reconciled conversation
model, with AI #2's contract extended to cover operational events.** My 11 event
names should be treated as a **requirements list for the operating model**, not
as a competing contract — they describe what the admin surface needs to stay
fresh, and that need is real even though my names are not.

## 7. Exit criteria

- [ ] One event contract, generated — zero hand-written event names in any client
- [ ] Operational room dimension exists and is server-assigned
- [ ] Every declared event has a producer, or is removed from the contract
- [ ] CORS + namespace agreed; admin socket actually connects (RTC-1/2)
- [ ] Socket auth verifies a token and re-evaluates identity (RT-009, RC-03)
- [ ] Internal-note and approval privacy routing preserved under the new contract
