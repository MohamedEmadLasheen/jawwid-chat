-- Roll back 20261015120000_chat_pd008_org_structure (PD-8 organization structure).
--
-- REFUSES while any family group still exists: those conversations, their
-- messages and their learners are the families' history (BR-5) and are never
-- dropped by a rollback. Archive-and-retype them by a reviewed data migration
-- first, or do not roll back.
--
-- Otherwise drops the scope functions, the five PD-8 tables (departments,
-- membership, per-learner supervision, backup links, group learners) and the
-- family_group type, and restores the pre-PD-8 chat.message staff policies
-- exactly as 20260905094000 defined them. The API of the PD-8 release cannot
-- run against the result -- deploy the previous API with it.
--
-- What is lost: the organization structure itself (re-enter it, or restore
-- from backup; every change is also in chat.audit_log), and staff scope returns
-- to family.owner_id / on_duty() in the previous API.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261015120000_pd008.down.sql

do $$
begin
  if exists (select 1 from chat.conversation where type = 'family_group') then
    raise exception 'PD-8 rollback refused: family_group conversations exist (history is never dropped)';
  end if;
end;
$$;

-- chat.message policies, as 20260905094000 left them.
drop policy if exists message_visible_to_staff on chat.message;
create policy message_visible_to_staff on chat.message for select to authenticated
  using (exists (select 1 from chat.conversation c
                  where c.id = message.conversation_id
                    and c.family_id is not null
                    and chat.staff_can_see_family(c.family_id)));

drop policy if exists message_written_by_staff on chat.message;
create policy message_written_by_staff on chat.message for insert to authenticated
  with check (
    author_type = 'staff'
    and author_id = chat.current_staff_id()
    and (
      (visibility = 'internal'
       and chat.current_staff_role() = any (array['admin', 'coverage', 'manager']))
      or
      (visibility = 'customer'
       and chat.staff_may_send(
             chat.current_staff_id(),
             (select c.family_id from chat.conversation c where c.id = message.conversation_id),
             on_behalf_mode))
    ));

drop function if exists chat.current_staff_conversation_access(uuid);
drop function if exists chat.staff_visible_conversation_ids(uuid, timestamptz);
drop function if exists chat.staff_conversation_access(uuid, uuid, timestamptz);
drop function if exists chat.conversation_responsible_supervisor(uuid);
drop function if exists chat.staff_reaches_family(uuid, uuid, timestamptz);
drop function if exists chat.staff_principals(uuid, timestamptz);
drop function if exists chat.staff_acts_for(uuid, uuid, timestamptz);
drop function if exists chat.backup_is_active(uuid, uuid, timestamptz);

drop trigger if exists learner_teacher_change_prunes_family_groups on chat.learner;
drop trigger if exists conversation_member_family_group_eligible on chat.conversation_member;
drop trigger if exists conversation_family_group_coherent on chat.conversation;
drop function if exists chat.prune_teachers_after_teacher_change();
drop function if exists chat.guard_family_group_member();
drop function if exists chat.family_group_coherence_from_conversation();

drop table if exists chat.conversation_learner;
drop table if exists chat.supervisor_backup;
drop table if exists chat.learner_supervision;
drop table if exists chat.department_member;
drop table if exists chat.department;

drop function if exists chat.prune_teachers_after_anchor_removed();
drop function if exists chat.prune_family_group_teachers(uuid);
drop function if exists chat.family_group_coherence_from_supervision();
drop function if exists chat.family_group_coherence_from_anchor();
drop function if exists chat.assert_family_group_coherent(uuid);
drop function if exists chat.guard_conversation_learner();
drop function if exists chat.guard_supervisor_backup();
drop function if exists chat.guard_learner_supervision();
drop function if exists chat.guard_department_member_delete();
drop function if exists chat.guard_department_member();
drop function if exists chat.guard_department();

alter table chat.conversation drop constraint if exists conversation_family_group_has_family;
alter table chat.conversation drop constraint if exists conversation_type_check;
alter table chat.conversation add constraint conversation_type_check
  check (type in ('direct', 'student_group', 'class_group', 'official'));

delete from chat.schema_migrations where version = '20261015120000_chat_pd008_org_structure';
