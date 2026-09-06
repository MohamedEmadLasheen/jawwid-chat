# Communication engine (AI #2)

Owner: AI #2 · Scope: Jawwid Chat PRD v0.1 (`docs/qa/authoritative-scope.md`)

The communication domain: conversations, membership, messages, delivery,
attachments, reactions, approvals, realtime, notifications, reminders, calling.

| Document | Audience |
|---|---|
| [mobile-contract.md](mobile-contract.md) | AI #3 — Flutter |
| [admin-contract.md](admin-contract.md) | AI #4 — Admin Web |
| [test-contract.md](test-contract.md) | AI #5 — QA / Security |
| [realtime-events.md](realtime-events.md) | AI #3, AI #4 |
| [error-codes.md](error-codes.md) | AI #3, AI #4 |
| [ai1-dependencies.md](ai1-dependencies.md) | AI #1 — Backend core |
| [scope-decisions.md](scope-decisions.md) | everyone |

## The one rule

**BR-1 — Teacher ↔ Parent direct communication is forbidden, messaging and
calling alike.** They meet only inside the official Student Group.

It is enforced in four independent places. Any one of them alone would stop the
forbidden case; all four exist because a UI restriction is not an implementation
of a business rule.

1. `AuthorizationService.canOpenDirect()` refuses to create the channel.
2. `canSend()` / `canCall()` refuse to use one even if it existed.
3. `chat.enforce_direct_conversation_rules()` refuses the membership row.
4. `chat.enforce_conversation_type_immutable()` refuses to convert a group
   into a 1:1.

`AuthorizationService` is the **only** place an access decision is made.
Controllers, the websocket gateway and the workers all route through it, so a
rule can never be enforced for chat and forgotten for calls.

## Layout

```
apps/api/src/platform/        seams AI #1 owns (identity, coverage, audit) + authorization
apps/api/src/communication/   this domain
  contracts/   event + DTO + vocabulary definitions shared with clients
  conversations/ messages/ approvals/ calls/ attachments/ notifications/
  realtime/    socket.io gateway, typing, presence
  outbox/      transactional outbox + worker
  api/         REST controllers
supabase/migrations/2026090593*.sql   the schema (authoritative for DDL)
```

## Running

```bash
scripts/db/integration-db.sh reset
cd apps/api && npm install && npm test
```
