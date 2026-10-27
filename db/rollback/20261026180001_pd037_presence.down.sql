-- Roll back 20261026180001_chat_pd037_presence (PD-37 hide-my-last-seen switch).
--
-- Safe with rows present: dropping the column shows everyone's last seen to
-- staff again, the behaviour before the switch existed.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261026180001_pd037_presence.down.sql

delete from chat.config where key = 'abuse.throttle.presence_read_actor';

alter table chat.staff drop column if exists hide_last_seen;

delete from chat.schema_migrations where version = '20261026180001_chat_pd037_presence';
