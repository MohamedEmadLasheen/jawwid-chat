-- =============================================================================
-- Forwarded messages (Chat UI group B, owner decisions 2026-10-19)
-- =============================================================================
--
-- Anyone may forward any message they can READ into any conversation they can
-- WRITE in (up to ten at once); photos, voice notes and files too. A forward is
-- a NEW message authored by the forwarder, sent through the ordinary send path
-- -- so it inherits BR-1, staff scope, silencing and approval -- and its media
-- are COPIED into the destination's namespace, never shared by key.
--
-- `forwarded` is what a client sees ("Forwarded"). `forwarded_from_message_id`
-- is provenance for audit only and is never sent to a client: naming the source
-- would tell a reader of the destination that a message exists elsewhere.
-- ON DELETE SET NULL: the original's removal does not take the copy with it.

alter table chat.message
  add column if not exists forwarded boolean not null default false,
  add column if not exists forwarded_from_message_id uuid
    references chat.message (id) on delete set null;

comment on column chat.message.forwarded is
  'A copy forwarded from another message by its author (the forwarder). Shown as "Forwarded".';
comment on column chat.message.forwarded_from_message_id is
  'Audit provenance of a forward. Never returned to a client.';

-- A forward always names where it came from, and only a forward does.
alter table chat.message drop constraint if exists message_forward_provenance;
alter table chat.message add constraint message_forward_provenance
  check (forwarded or forwarded_from_message_id is null);
