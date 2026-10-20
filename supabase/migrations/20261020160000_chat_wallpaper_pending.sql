-- =============================================================================
-- Chat wallpaper: at most one pending upload per viewer and chat
-- (review of PR #72, 2026-10-20)
-- =============================================================================
--
-- POST /conversations/:id/wallpaper/upload used to hand out a fresh signed PUT
-- every time, and an upload that was never committed stayed in object storage
-- for ever: any member could fill the bucket with 4 MB files nothing referenced.
--
-- Now the key just authorized is recorded here. Authorizing again deletes the
-- previous pending object; committing requires exactly this key and clears it.
-- So a viewer holds at most two objects per chat: the wallpaper in use and one
-- upload in flight. The key has the same shape rule as the wallpaper itself --
-- it names THIS row's actor and conversation -- and is unique.

alter table chat.conversation_participant_state
  add column if not exists wallpaper_pending_key text;

alter table chat.conversation_participant_state
  drop constraint if exists conversation_participant_state_wallpaper_pending_shape;
alter table chat.conversation_participant_state
  add constraint conversation_participant_state_wallpaper_pending_shape
  check (
    wallpaper_pending_key is null or (
      wallpaper_pending_key ~ '^wallpapers/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(wallpaper_pending_key, '/', 2) = actor_id::text
      and split_part(wallpaper_pending_key, '/', 3) = conversation_id::text
    )
  );

create unique index if not exists conversation_participant_state_wallpaper_pending_unique
  on chat.conversation_participant_state (wallpaper_pending_key)
  where wallpaper_pending_key is not null;

comment on column chat.conversation_participant_state.wallpaper_pending_key is
  'The viewer''s one authorized-but-uncommitted wallpaper upload for this chat. Replaced (and its object deleted) by the next authorization; cleared on commit.';
