-- Roll back 20261031160000_chat_pd053_call_connection_grace (CHATSCHED-013 dropped calls).
--
-- Drops the end reason, the interruption mark and the connected-time columns.
-- Durations already written stay as they are (connected time). The config key,
-- the push texts and the rule go too; a call_connection_lost notification
-- already scheduled keeps its row only if its rule survives, so its rows go
-- first. Roll back the API release with it: CallService and
-- MediaPresenceService read these columns.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261031160000_pd053_call_connection_grace.down.sql

delete from chat.notification where rule_key = 'call_connection_lost';
delete from chat.notification_rule where key = 'call_connection_lost';
delete from chat.notification_template where key in ('call_connection_lost', 'inbox.call_connection_lost');
delete from chat.config where key = 'call.reconnect_grace_seconds';

drop index if exists chat.call_interrupted_idx;
alter table chat.call drop constraint if exists call_connected_seconds_nonnegative;
alter table chat.call drop constraint if exists call_end_reason_valid;
alter table chat.call_participant
  drop column if exists media_last_joined_at;
alter table chat.call
  drop column if exists was_connected,
  drop column if exists connected_seconds,
  drop column if exists connected_since,
  drop column if exists interrupted_at,
  drop column if exists end_reason;
