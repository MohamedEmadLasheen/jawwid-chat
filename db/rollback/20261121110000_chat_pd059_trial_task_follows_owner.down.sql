-- Roll back 20261121110000_chat_pd059_trial_task_follows_owner (PD-59, the trial follow-up task follows
-- the lead's owner).
--
-- Drops the trigger that moves an open trial_outcome task when its lead is reassigned, and restores
-- chat.work_task_trial_sales_owner to the body 20261029235900 defined (the prospect's CREATOR while live
-- Sales, else the Sales manager, else the super admin). Tasks already moved stay where they are (the
-- history in chat.work_task_event and the `sales_lead.task_moved` audit rows are append-only and are kept);
-- after the rollback the hand-over sweep moves a task only when its assignee leaves, as before.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121110000_chat_pd059_trial_task_follows_owner.down.sql
--
-- Then delete the ledger row: delete from chat.schema_migrations where version =
-- '20261121110000_chat_pd059_trial_task_follows_owner';

drop trigger if exists trial_prospect_owner_moves_its_tasks on chat.trial_prospect;
drop function if exists chat.work_task_from_prospect_owner();
-- Who records a trial's outcome: the prospect's creator while live and still
-- in Sales, else the live Sales manager, else the live super admin.
create or replace function chat.work_task_trial_sales_owner(p_lesson uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select p.created_by
       from chat.lesson l
       join chat.trial_prospect p on p.id = l.prospect_id
       join chat.staff s on s.id = p.created_by and s.is_active and s.left_at is null
      where l.id = p_lesson
        and (exists (select 1 from chat.department_member m join chat.department d on d.id = m.department_id
                      where m.staff_id = p.created_by and d.kind = 'sales')
             or exists (select 1 from chat.department d where d.manager_id = p.created_by and d.kind = 'sales'))),
    (select s.id
       from chat.lesson l
       join chat.department d on d.organization_id = l.organization_id and d.kind = 'sales'
       join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
      where l.id = p_lesson
      order by d.id
      limit 1),
    (select chat.work_task_super_admin(l.organization_id) from chat.lesson l where l.id = p_lesson));
$$;
