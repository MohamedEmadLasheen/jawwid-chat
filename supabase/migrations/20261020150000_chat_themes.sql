-- =============================================================================
-- Chat themes (owner decisions 2026-10-20)
-- =============================================================================
--
--   * PRIVATE: a theme is the viewer's own choice for one chat. It lives on the
--     viewer's own row of chat.conversation_participant_state (with mute, pin
--     and favourite), so nobody else's view of the chat ever changes.
--   * PRESETS + OWN PHOTO: one of eight named backgrounds, and optionally a
--     photo the viewer uploads as that chat's wallpaper.
--   * SYNCED: stored here, so it follows the account to every device.
--
-- A theme only ever changes the background behind the messages. Bubbles keep
-- their own, contrast-checked colours, so text is readable on every theme and
-- over any photo (the clients also dim a photo).

alter table chat.conversation_participant_state
  add column if not exists theme text,
  add column if not exists wallpaper_object_key text;

alter table chat.conversation_participant_state
  drop constraint if exists conversation_participant_state_theme_known;
alter table chat.conversation_participant_state
  add constraint conversation_participant_state_theme_known
  check (theme is null or theme in ('lagoon', 'sand', 'rose', 'sky', 'lilac', 'olive', 'slate', 'dusk'));

-- `wallpapers/<actor_id>/<conversation_id>/<uuid>`, naming THIS row's actor and
-- conversation: a key copied from anywhere else can never be stored here, so
-- the media route's owner check has a structural backstop.
alter table chat.conversation_participant_state
  drop constraint if exists conversation_participant_state_wallpaper_key_shape;
alter table chat.conversation_participant_state
  add constraint conversation_participant_state_wallpaper_key_shape
  check (
    wallpaper_object_key is null or (
      wallpaper_object_key ~ '^wallpapers/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(wallpaper_object_key, '/', 2) = actor_id::text
      and split_part(wallpaper_object_key, '/', 3) = conversation_id::text
    )
  );

create unique index if not exists conversation_participant_state_wallpaper_key_unique
  on chat.conversation_participant_state (wallpaper_object_key)
  where wallpaper_object_key is not null;

comment on column chat.conversation_participant_state.theme is
  'The viewer''s own background preset for this chat (null = the default look). Private to the viewer.';
comment on column chat.conversation_participant_state.wallpaper_object_key is
  'The viewer''s own wallpaper photo for this chat: wallpapers/<actor_id>/<conversation_id>/<uuid>. Served only to its owner, re-authorized per request.';
