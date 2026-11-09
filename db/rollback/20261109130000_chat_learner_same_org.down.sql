-- Roll back 20261109130000_chat_learner_same_org.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109130000_chat_learner_same_org.down.sql
--
-- Drops the one trigger the migration added. No data is involved either way.
-- This REOPENS RT-029: a learner can again be stored naming another
-- organization's teacher. chat.enforce_same_organization() is shared with the
-- family-scoped guards and is left in place.

set local lock_timeout = '5s';

drop trigger if exists learner_teacher_same_organization on chat.learner;
