-- PD-59 (owner decision 2026-11-21): an ACTIVE trial follow-up task follows the prospect's CURRENT
-- Sales owner, and the previous owner stops reaching the prospect through it.
--
-- Before: chat.work_task_trial_sales_owner named the prospect's CREATOR (created_by), so a lead the Sales
-- manager reassigned left its outcome task, and the prospect's name and trial time in the task body,
-- with the old person. After:
--
--   1. chat.work_task_trial_sales_owner(lesson) is, in order: the prospect's owner while live Sales staff
--      of the academy (chat.sales_lead_owner_eligible: also the super admin, as a lead's owner may be);
--      else the live Sales manager; else the live super admin; else null (the sweep records an issue, as
--      before). Never a departed person, never a non-Sales person, never the creator as such. An
--      unowned prospect therefore goes to the Sales manager, then the super admin.
--
--   2. A trigger on chat.trial_prospect (owner_staff_id changed) re-points the prospect's OPEN
--      trial_outcome tasks, in the reassignment's own transaction, through the PD-47 mover
--      chat.work_task_reroute (so the task's own history gets a `reassigned` event, the realtime signal
--      goes out, and the guard rules apply). It also writes chat.audit_log `sales_lead.task_moved`:
--      staff ids and ids of the task and the lead only, never a name or a value. The actor is the one
--      the API names in the transaction-local setting chat.sales_lead_actor (else the system).
--
--      Race-free against the hand-over sweep: the trigger takes the sweep's own advisory lock
--      (transaction-scoped), so a sweep that read the old owner has committed (and its task is moved
--      by this trigger), and a sweep that starts later is skipped until this transaction commits and
--      then reads the new owner. A failure rolls the reassignment back: moving the task is a privacy
--      step, never swallowed (unlike the source triggers, whose failure is only a late task).
--
--   Closed (completed, removed) tasks are never touched, history rows are never rewritten, and tasks of
--   prospects that are not reassigned are never touched. Nothing is backfilled (see the slot note): an
--   open task of a lead reassigned before this migration keeps its assignee until the lead is
--   reassigned again or the assignee leaves.
--
-- Idempotent and additive: create or replace function, drop trigger if exists + create trigger.
-- Rollback: db/rollback/20261121110000_chat_pd059_trial_task_follows_owner.down.sql.

create or replace function chat.work_task_trial_sales_owner(p_lesson uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select p.owner_staff_id
       from chat.lesson l
       join chat.trial_prospect p on p.id = l.prospect_id
      where l.id = p_lesson
        and p.owner_staff_id is not null
        and chat.sales_lead_owner_eligible(p.owner_staff_id, p.organization_id)),
    (select s.id
       from chat.lesson l
       join chat.department d on d.organization_id = l.organization_id and d.kind = 'sales'
       join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
      where l.id = p_lesson
      order by d.id
      limit 1),
    (select chat.work_task_super_admin(l.organization_id) from chat.lesson l where l.id = p_lesson));
$$;

create or replace function chat.work_task_from_prospect_owner()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid := nullif(current_setting('chat.sales_lead_actor', true), '')::uuid;
  v_to    uuid;
  r       record;
begin
  -- Serialise with the hand-over sweep (see the header). Held until this transaction ends.
  perform pg_advisory_xact_lock(hashtext('chat.work_task_sweep_handover'));
  for r in
    select t.id as task_id, t.organization_id as org, t.source_key as key, l.id as lesson,
           t.assignee_staff_id as now_on
      from chat.lesson l
      join chat.work_task t on t.organization_id = l.organization_id and t.source_key = 'trial_outcome:' || l.id
     where l.prospect_id = new.id and l.kind = 'trial'
       and t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.assignee_staff_id is not null
     order by t.id
  loop
    v_to := chat.work_task_trial_sales_owner(r.lesson);
    if v_to is null or v_to = r.now_on then
      continue;
    end if;
    if chat.work_task_reroute(r.org, r.key, v_to, null, v_actor) > 0 then
      insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
      values (v_actor, 'sales_lead.task_moved', 'trial_prospect', new.id,
              jsonb_build_object('fromStaffId', r.now_on),
              jsonb_build_object('toStaffId', v_to, 'taskId', r.task_id, 'leadId', new.id),
              'the trial follow-up task follows the lead''s new owner (PD-59)');
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function chat.work_task_from_prospect_owner() from public;

drop trigger if exists trial_prospect_owner_moves_its_tasks on chat.trial_prospect;
create trigger trial_prospect_owner_moves_its_tasks after update of owner_staff_id on chat.trial_prospect
  for each row
  when (old.owner_staff_id is distinct from new.owner_staff_id)
  execute function chat.work_task_from_prospect_owner();
