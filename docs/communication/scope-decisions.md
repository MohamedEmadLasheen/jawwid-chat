> **STATUS: REFERENCE** (Phase 0, 2026-09-07). D-2 ("chat.thread is kept") is SUPERSEDED by OD-01 (`20260905094000`): chat.thread no longer exists. Other decisions stand.
> Canonical index: `docs/README.md`.

# Scope and design decisions

Every decision here was forced by a conflict between two sources, or by a gap
neither source covered. Each records what was chosen and why, so a later reader
can disagree with the reasoning rather than guess at it.

## D-1 · PRD v0.1 governs, not the PDF brief

`docs/JAWWID_CHAT_BRIEF.pdf` describes a CS-only console with one thread per
family, no teachers as actors, no groups, no approval and no calling. PRD v0.1
(`docs/qa/authoritative-scope.md`) supersedes it. Confirmed with the product
owner before the conversation model was written, which is what made the
correction cheap.

## D-2 · `chat.conversation` is added; `chat.thread` is kept

The obvious move was to replace `chat.thread`. It was rejected: `chat.thread` is
the anchor for `support_case`, `task`, `handoff` and the attention/workload
engines, all of which are correct and none of which are AI #2's.

So the change is additive. `chat.conversation` is the communication channel and
carries `thread_id` back to the family's record. `chat.message` is **extended in
place** rather than recreated, so every index, constraint and foreign key AI #1
defined still holds.

Consequence: `chat.message.thread_id` is now nullable, and a message belongs to a
conversation. `message_has_conversation` requires one or the other.

## D-3 · Actors are polymorphic and un-foreign-keyed

An actor is `(actor_kind, actor_id)` where kind is contact/staff/teacher/system.
No single table can be the FK target, and ADR-004 forbids the chat schema from
referencing `auth` or `public`. Where the kind is fixed and internal —
`sticky_handler_id`, `approver_id`, `added_by` — a real FK to `chat.staff` is used.

Teacher identity is AI #1's (correction C-1) and does not exist yet. Until it
does, `PrismaIdentityService` recognises a teacher as an id appearing in
`chat.learner.teacher_id`. **This is a stub.** See `ai1-dependencies.md`.

## D-4 · Two of AI #1's constraints were narrowed

Both are in `20260905093000_chat_communication.sql` with the reasoning inline.

- **`message_is_immutable` → `message_no_rewrite`.** A blanket UPDATE ban makes
  approval decisions and soft deletion impossible. The replacement forbids what
  actually matters: body, author, conversation and seq cannot be rewritten. Proven
  by two tests in `schema-invariants.spec.ts`.
- **`audit_log_actor_id_fkey` dropped.** It assumed only employees take auditable
  actions. A parent deleting their own message is auditable, and a parent is not
  in `chat.staff`.

`chat.event_log`'s `actor_type` and `type` allow-lists were extended rather than
replaced: every pre-existing value is kept.

## D-5 · Visibility and moderation are separate columns

`visibility` (customer/internal) is *audience* — the internal-notes feature.
`moderation` (published/pending/rejected) is *approval state*. They are
orthogonal: an internal note is never held for approval, and a pending parent
message is customer-visible once approved. Collapsing them into one column would
have made "pending internal note" unrepresentable and "rejected" indistinguishable
from "internal".

## D-6 · A pending message is not delivered and not broadcast

No receipts are written and no `message.created` event is emitted while a message
is pending. Only `approval.requested` goes out, and only to staff rooms. Approval
is therefore a delivery gate, not a display flag a client could ignore.

A pending message also does not advance `last_customer_message_at`, so a held
message cannot make a conversation look answered.

## D-7 · `seq` is assigned under a row lock

`SELECT last_seq ... FOR UPDATE` inside the send transaction. Device clocks are
never trusted for ordering. Verified gap-free under concurrency.

The cost is that sends to one conversation serialize. That is the right trade for
a chat: correct order matters more than parallel writes to a single conversation.

## D-8 · Idempotency is a unique index, not a lookup

`(conversation_id, author_id, client_message_id)` unique where the key is not
null. The pre-check is only an optimisation; correctness comes from the index and
from catching `P2002` and re-reading. Verified with a 5-way concurrent burst.

## D-9 · Delivery state is never fabricated

A dispatched push is `sent`. It becomes `delivered`/`opened` only when a client
or provider says so. Where a platform reports nothing, the state stays `sent`.
Inventing delivery would make the metrics lie.

## D-10 · Quiet hours defer, never drop

A notification inside a quiet window is rescheduled to the end of it. Dropping it
would silently lose a class reminder. Exemptions are data —
`notification_rule.respect_quiet_hours` — not branches in code.

## D-11 · Reminder schedules are rows

Class T-24h/T-30m, renewal D-14/7/1/0 and payment D-7/-3/0/+3/+7 are
`chat.notification_rule` rows. Adding "remind again 10 days late" is an INSERT.

## D-12 · Conversation state is computed

Derived from `last_customer_message_at` / `last_staff_message_at` / `resolved_at`.
It is not client-settable, and it does not duplicate `support_case.status`, which
remains the ops domain.

## Known limitations

- **Assist and escalation fail closed.** The real predicate (NOW bucket, >50% of
  the response target elapsed, on-duty admin has not opened it) needs the
  attention engine. Until AI #1 supplies it, an off-duty admin asking to assist is
  denied. This is deliberate: the alternative is a client-controlled bypass.
- **Teacher identity is a stub** (D-3).
- **Two idempotency mechanisms coexist**: AI #1's `message_client_id_uniq`
  `(thread_id, client_id)` and this domain's `message_idempotency`. Both work;
  the thread-based one is dead once all sends go through conversations. Needs one
  line of reconciliation with AI #1.
- **`class_group` is modelled but unused.** Phase 2.
- **Broadcast origin is modelled but unimplemented.** Phase 2.
- **The outbox worker has no scheduler.** `OutboxWorker.drain()` and
  `NotificationService.dispatchDue()` are correct and tested but nothing calls
  them on a timer yet; wiring BullMQ is the remaining step.
- **Presence and typing require Redis.** Neither is on the message path, so the
  engine works without it; those two features degrade.
