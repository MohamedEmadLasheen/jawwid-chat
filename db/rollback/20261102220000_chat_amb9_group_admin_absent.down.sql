-- Roll back 20261102220000_chat_amb9_group_admin_absent (AMB-9: a group left
-- without a live admin becomes a Needs-action task).
--
-- The tasks it raised stay: chat.work_task rows are never deleted (the guard
-- refuses it). They keep their source key and read with no title params once
-- the spell table is gone; close any still open by hand (Remove, with a
-- reason) before or after. Roll back the API release with it: TaskService
-- calls chat.work_task_sweep_group_admin every minute.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102220000_chat_amb9_group_admin_absent.down.sql

drop trigger if exists staff_liveness_moves_group_admin_tasks on chat.staff;
drop trigger if exists conversation_member_moves_group_admin_task on chat.conversation_member;
drop function if exists chat.work_task_group_admin_from_staff();
drop function if exists chat.work_task_group_admin_from_member();
drop function if exists chat.work_task_sweep_group_admin(integer);
drop function if exists chat.work_task_raise_group_admin_absent(uuid);
drop function if exists chat.work_task_group_admin_verdict(uuid);
drop function if exists chat.work_task_group_admin_spell_owner(uuid);
drop function if exists chat.work_task_open_group_admin_spell(uuid);
drop function if exists chat.group_admin_returned_by(uuid);
drop table if exists chat.work_task_group_admin_spell;
drop function if exists chat.work_task_group_admin_owner(uuid);
drop function if exists chat.group_admin_absent_since(uuid);
drop function if exists chat.group_admin_absent(uuid);
drop function if exists chat.group_admin_present(uuid);
drop function if exists chat.group_pairs_teacher_and_parent(uuid);
delete from chat.work_task_source_issue where split_part(source_key, ':', 1) = 'group_admin_absent';
delete from chat.config where key = 'tasks.since.group_admin_absent';

delete from chat.schema_migrations where version = '20261102220000_chat_amb9_group_admin_absent';
