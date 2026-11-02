-- Roll back 20261102130000_chat_pd055_learner_rewards (PD-55 PR-4).
--
-- Turning `rewards.enabled` off is the first lever and keeps every reward.
-- This file removes them: the table (and every reward in it), its guard, the
-- two access helpers and the rewards.* configuration. Roll back the API and
-- the clients with it: they read and write this table.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102130000_pd055_learner_rewards.down.sql

drop table if exists chat.learner_reward_event;
drop function if exists chat.guard_learner_reward_event();
drop function if exists chat.guard_learner_reward_event_truncate();
drop function if exists chat.may_reward_learner(uuid, uuid);
drop function if exists chat.may_read_learner_rewards(uuid, uuid);
delete from chat.config where key in (
  'rewards.enabled', 'rewards.lesson_badge_thresholds',
  'rewards.award_window_before_minutes', 'rewards.award_window_after_minutes');

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102130000_chat_pd055_learner_rewards';
