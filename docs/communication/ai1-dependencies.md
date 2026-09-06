# Dependencies on AI #1

What the communication engine consumes, what it stubs, and the exact changes
needed. Nothing here is duplicated inside the communication domain.

## Consumed today

| Dependency | How it is used |
|---|---|
| `chat.on_duty(family_id, at)` | Called directly by `SqlCoverageService`. The algorithm is **not** reimplemented. `null` means Unattended. |
| `chat.staff` / `chat.family` / `chat.contact` / `chat.learner` | Read-only, through `PrismaIdentityService`. |
| `chat.thread` | Kept as the family's record; conversations link to it via `thread_id`. |
| `chat.event_log` / `chat.audit_log` | Written in the same transaction as the action. |
| `chat.config` | Every threshold and window. No number is hardcoded. |

## Stubs to replace

### 1 · Authentication (highest priority)

The actor arrives as `X-Actor-Id` / websocket `auth.actorId`. Replace with token
verification in `ActorId` (`src/communication/api/actor.decorator.ts`) and in
`RealtimeGateway.handleConnection`.

Both places already resolve the actor through `IdentityService` and re-run
authorization, so this is a two-file change and no endpoint or payload changes.

### 2 · Teacher identity (QA correction C-1)

`PrismaIdentityService.resolveActor` recognises a teacher as an id appearing in
`chat.learner.teacher_id`. It has no name, locale or active flag — teachers
render as "Teacher".

Needed: a real teacher record with a display name and a locale, resolvable by id.
Replace the marked block; the `Actor` shape does not change.

### 3 · The assist / escalation grant

`canSend()` fails closed for both. The predicate needs the attention and
response-target engines:

> family in the NOW bucket, waited > 50% of the response target, and the on-duty
> admin has not opened it — or the on-duty admin explicitly requested help.

Please expose it as a service the authorization path can call, e.g.
`assistGrant(familyId, staffId, at): Promise<boolean>`. Do **not** move the gate
into a caller: `AuthorizationService` is contractually the only place an access
decision is made.

## Changes this domain made to shared objects

All in `20260905093000_chat_communication.sql`, each with the reasoning inline.
Please review; a different resolution is fine as long as the capability survives.

| Change | Why |
|---|---|
| `chat.message` extended in place (`conversation_id`, `seq`, `moderation`, `origin`, `type`, `reply_to_message_id`, `client_message_id`, soft-delete columns) | rather than a second message table |
| `chat.message.thread_id` now nullable | a message belongs to a conversation; `message_has_conversation` requires one or the other |
| `message_author_type_check` admits `'teacher'` | PRD ships a Teacher app |
| `message_is_immutable` → `message_no_rewrite` | approval decisions and soft deletes are lawful state changes; body/author/conversation/seq stay immutable |
| `message_has_content` also allows `type <> 'text'` | attachment metadata moved to `chat.message_attachment`; without this every voice note is rejected |
| `event_log_actor_type_check` admits `'teacher'` | teachers now act in their own right |
| `event_log_type_check` extended | 8 communication event types added; every existing value kept |
| `audit_log_actor_id_fkey` dropped | parents and teachers take auditable actions and are not in `chat.staff` |

## Reconciliation needed

1. **Two idempotency mechanisms.** Yours is `message_client_id_uniq
   (thread_id, client_id)`; this domain's is `message_idempotency
   (conversation_id, author_id, client_message_id)`. Both work. Once all sends go
   through conversations, `client_id` is dead — suggest dropping it and its index.
2. **`chat.event_log` / `chat.audit_log` are created idempotently** in
   `20260905093200_chat_shared_logs.sql` with `if not exists`, matching your
   column names exactly. When your migration runs first it is a pure no-op. Delete
   my file whenever you prefer.
3. **Migration branch split.** `20260905093000` depends on `chat.family` /
   `chat.thread` / `chat.staff`, which live only on `feat/backend-foundation`.
   Until those branches merge, only the composed set applies
   (`scripts/db/integration-db.sh`).

## Owned by neither of us

The **attention** and **workload** engines are in your migrations
(`chat.attention_score`, `chat.workload_score`) and QA's inventory assigns them to
AI #2 — but they are outside the AI #2 brief and this domain has not touched
them. Worth an explicit owner before the release gate; today the SQL exists and
nothing calls it.
