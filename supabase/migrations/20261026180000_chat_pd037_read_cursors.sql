-- =============================================================================
-- PD-37 P1a-1: read and delivery cursors (read receipts, WhatsApp-style)
-- =============================================================================
--
-- Each person's place in a conversation already lives on
-- chat.conversation_participant_state.last_read_seq. PD-37 makes it the
-- authority for ticks:
--
--   * last_read_seq       only moves FORWARD (the API writes GREATEST); a late
--                         or replayed "read up to 3" after "read up to 9" is a
--                         no-op, never a rewind.
--   * last_delivered_seq  NEW. How far this person's devices have the
--                         conversation. A read implies delivered, so the API
--                         keeps last_delivered_seq >= last_read_seq.
--   * last_read_at        NEW. When the read cursor last moved.
--
-- The per-message rows in chat.message_receipt stay the record of who read
-- which message when (Message info); the cursors move them in one statement
-- instead of loading every message id of the conversation.
--
-- Additive and idempotent: re-applying this file changes nothing.

alter table chat.conversation_participant_state
  add column if not exists last_delivered_seq bigint not null default 0;

alter table chat.conversation_participant_state
  add column if not exists last_read_at timestamptz;

comment on column chat.conversation_participant_state.last_delivered_seq is
  'PD-37: how far this person''s devices have the conversation. Forward-only; never below last_read_seq.';
comment on column chat.conversation_participant_state.last_read_at is
  'PD-37: when last_read_seq last moved forward.';

-- Each cursor move is a write and, for a seated reader, an outbox row: bound
-- how often one actor may make one (docs/security/ABUSE-LIMITS.md).
insert into chat.config (key, value, scope, description) values
('abuse.throttle.receipt_cursor_actor', '240'::jsonb, 'abuse',
 '[hypothesis] PD-37: read and delivery cursor moves (POST .../messages/read and '
 '.../messages/delivered) one actor may make per window. A client sends one per '
 'incoming message per open chat; four a second sustained is far above that.')
on conflict (key) do nothing;

-- The cursor update joins a person's receipts to the conversation's messages
-- by seq; message_conversation_seq_desc serves the message side and
-- message_receipt_actor_idx (actor_id, state) the receipt side.
