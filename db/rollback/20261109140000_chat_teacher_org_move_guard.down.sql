-- Roll back 20261109140000_chat_teacher_org_move_guard.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109140000_chat_teacher_org_move_guard.down.sql
--
-- Drops the trigger and its function. No data is involved either way.
-- This REOPENS the parent side of RT-029: a teacher can again be moved to
-- another organization while learners in the old one still name them. The
-- child-side guard (learner_teacher_same_organization, 20261109130000) is
-- left in place.

set local lock_timeout = '5s';

drop trigger if exists teacher_org_move_keeps_learners on chat.teacher;
drop function if exists chat.guard_teacher_organization_move();
