-- Roll back 20261109150000_chat_org_moves_guarded.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109150000_chat_org_moves_guarded.down.sql
--
-- Drops the three immutability triggers and their functions. No data is
-- involved either way. This REOPENS the RT-029 parent side for chat.family
-- and chat.conversation (their organization_id can change again, leaving
-- children behind) and the commit-time race. chat.teacher falls back to
-- teacher_org_move_keeps_learners (20261109140000), which this migration left
-- in place.

set local lock_timeout = '5s';

drop trigger if exists family_org_immutable on chat.family;
drop trigger if exists conversation_org_immutable on chat.conversation;
drop trigger if exists teacher_org_immutable on chat.teacher;

drop function if exists chat.family_organization_immutable();
drop function if exists chat.conversation_organization_immutable();
drop function if exists chat.teacher_organization_immutable();
