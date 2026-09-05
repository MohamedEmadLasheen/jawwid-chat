-- Jawwid Chat -- idempotent message delivery.
--
-- Not a feature from the brief: a correctness requirement for the mobile and
-- web clients. A retried send after a dropped connection must not post the
-- message twice, and the client cannot know whether the first attempt landed.
-- The client generates the id; the database refuses the duplicate.

alter table chat.message add column client_id text;

create unique index message_client_id_uniq
  on chat.message (thread_id, client_id)
  where client_id is not null;

comment on column chat.message.client_id is
  'Client-generated idempotency key, unique per thread. Null for messages '
  'created server-side (system cards, automation), which have no retry path.';
