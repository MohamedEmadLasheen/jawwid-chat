-- Roll back 20261106170000_chat_pd030_d3_push_wording: the pushes go back to
-- version 1 of 20261026140000 ("{learner}'s lessons are paused").
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261106170000_chat_pd030_d3_push_wording.down.sql

set local lock_timeout = '5s';

delete from chat.notification_template
 where key in ('subscription_locked', 'subscription_unlocked') and version = 2;

delete from chat.schema_migrations where version = '20261106170000_chat_pd030_d3_push_wording';
