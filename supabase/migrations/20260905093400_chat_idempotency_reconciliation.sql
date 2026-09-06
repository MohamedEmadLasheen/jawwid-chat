-- Jawwid Chat -- reconcile the two message idempotency mechanisms.
--
-- Two enforcement mechanisms coexisted on chat.message:
--
--   message_client_id_uniq   (thread_id, client_id)                          AI #1
--   message_idempotency      (conversation_id, author_id, client_message_id) AI #2
--
-- Both were individually correct; keeping both is not. They key on different
-- columns, so two sends that one treats as duplicates the other treats as
-- distinct, and which one applies depends on which column the caller happened to
-- populate. An idempotency guarantee that depends on that is not a guarantee.
--
-- The surviving mechanism keys on conversation_id -- the model PRD v0.1
-- requires -- and additionally scopes to author_id, so two participants in the
-- same conversation cannot collide on the same client-generated key.
--
-- ONLY THE INDEX IS DROPPED, NOT THE COLUMN.
-- chat.message.client_id belongs to the superseded thread-per-family model and
-- no code writes it (verified: no reference in apps/api/src or
-- apps/admin-web/src). It cannot be dropped here because chat.my_messages --
-- AI #1's view, created by 20260905091100_chat_authorization -- selects it, and
-- dropping the column would require CASCADE and would take their view with it.
--
-- AI #1: please remove `client_id` from chat.my_messages and then drop the
-- column. Until then the column remains, permanently null, enforcing nothing.

drop index if exists chat.message_client_id_uniq;

comment on column chat.message.client_id is
  'DEPRECATED, always null. Superseded by client_message_id. Retained only '
  'because chat.my_messages still selects it; remove from that view, then drop.';

comment on column chat.message.client_message_id is
  'The single idempotency key. Unique per (conversation_id, author_id) where '
  'not null -- see index message_idempotency. Retrying a send with the same '
  'value returns the original message instead of creating a second.';
