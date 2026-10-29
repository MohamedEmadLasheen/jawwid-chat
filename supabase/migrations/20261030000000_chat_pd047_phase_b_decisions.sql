-- PD-47 (2026-10-29), PR-6c -- tasks for the Teachers department's decisions (Phase B). Slot 20261030000000.
--
-- Plan: docs/product/pd047-tasks-plan.md §3.6 (Phase B decisions and the
-- makeup_owed note, department head 2026-10-29). Builds on 20261029210000
-- (PR-2), 20261029235800 (PR-6a: the settle window) and 20261029235900
-- (PR-6b: the guard, redefined here when a source needs it). Announced with
-- the generic task_assigned, whose rule row exists; no new rule key.
--
--   source_type      key                          assignee                                    due
--   complaint        complaint:<entry>            the teacher's supervisor, else the          filed + 48 h
--                                                 Teachers manager (work_task_teacher_owner)
--
--   Every one: operational, medium; reassignable by hand. The records that
--   already exist decide them; no new state (department head, 2026-10-29).
--
--   complaint        a PD-26 complaint on the Teacher File
--                    (chat.teacher_supervision_entry, kind complaint). Done
--                    when a complaint_resolution entry refers to it, by who
--                    wrote it. A parent's complaint (PD-32) is one of these:
--                    its feedback raises no task of its own.
--
--   RAISED by chat.work_task_sweep_decisions() (the worker, every minute, its
--   own advisory lock and batches), past PR-6a's settle window. COMPLETED at
--   once by triggers on the sources (one function per table), never blocking
--   the source's write; the sweep re-reads the evidence. OWNERS who leave: an
--   open task moves to its source's owner now, else an `orphaned:` issue the
--   super admin may act on (PR-6b).
--
--   Cut-offs (owner 2026-10-29, the last 14 days at switch-on): each by when
--   its source was filed, asked or closed.
--
--   Never in a task: a complaint's or a feedback's words, a request's slots.
--   Tasks names its source by id and reads names behind sign-in.
--
-- FAIL CLOSED: revoked grants as PR-1/PR-2. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. Who, and what the source says now
-- ===========================================================================

-- Who a decision task belongs to now, by its source (as its raise names it).
create or replace function chat.work_task_decision_owner(p_type text, p_source uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select case p_type
    when 'complaint' then (select chat.work_task_teacher_owner(e.teacher_id) from chat.teacher_supervision_entry e where e.id = p_source)
  end;
$$;

-- What a source says of its work now: 'done' (with who did it, or nobody),
-- 'gone' (the work no longer exists), or 'back' (it is still owed).
create or replace function chat.work_task_decision_verdict(p_type text, p_source uuid, out verdict text, out actor uuid)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_original uuid;
  v_since    timestamptz;
begin
  verdict := 'gone';
  if p_type = 'complaint' then
    select r.created_by into actor from chat.teacher_supervision_entry r
     where r.refers_to = p_source and r.kind = 'complaint_resolution';
    if actor is not null then
      verdict := 'done';
    elsif exists (select 1 from chat.teacher_supervision_entry e where e.id = p_source and e.kind = 'complaint') then
      verdict := 'back';
    end if;
  end if;
end;
$$;

-- ===========================================================================
-- 2. The sources: one raise function each
-- ===========================================================================

create or replace function chat.work_task_raise_complaint(p_entry uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.teacher_supervision_entry;
  v_owner uuid;
begin
  select * into e from chat.teacher_supervision_entry where id = p_entry;
  if e.id is null or e.kind <> 'complaint' or e.created_at < chat.work_task_since('complaint')
     or exists (select 1 from chat.teacher_supervision_entry r where r.refers_to = e.id and r.kind = 'complaint_resolution') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(e.teacher_id);
  if v_owner is null then
    perform chat.work_task_note_issue(e.organization_id, 'complaint:' || e.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(e.organization_id, 'complaint', e.id, v_owner, null,
                              'medium', 'operational', 'generic', e.created_at + interval '48 hours');
end;
$$;

-- ===========================================================================
-- 3. The sweep: create what is missing, reconcile what is done, follow owners
-- ===========================================================================

-- As PR-6b's chat.work_task_sweep_handover: at most p_batch (capped at 60)
-- rows per call, each its own subtransaction; one sweep at a time.
create or replace function chat.work_task_sweep_decisions(p_batch integer default 50)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_left      integer := least(greatest(coalesce(p_batch, 50), 1), 60);
  v_raised    integer := 0;
  v_settled   integer := 0;
  v_withdrawn integer := 0;
  v_restored  integer := 0;
  v_rerouted  integer := 0;
  v_orphaned  integer := 0;
  v_failed    integer := 0;
  v_declined  integer := 0;
  v_more      boolean := false;
  r           record;
  v_settle    interval := chat.work_task_settle_window();
  s_complaint  timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_decisions')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_complaint := chat.work_task_since('complaint');

  -- The issue log shrinks with these sources too: an occurrence whose task
  -- closed, whose work is done or gone, or an orphan given an owner again.
  -- Only these sources' keys.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('complaint')
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and t.state in ('completed', 'removed'))
          or (select v.verdict from chat.work_task_decision_verdict(split_part(i.source_key, ':', 1),
                                                                     split_part(i.source_key, ':', 2)::uuid) v)
             is distinct from 'back'
          or i.reason like 'orphaned:%'
             and exists (select 1 from chat.work_task t
                          where t.organization_id = i.organization_id and t.source_key = i.source_key
                            and (chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is not null
                                 or chat.work_task_decision_owner(t.source_type, t.source_id) is not null)));

  -- Create.
  for r in
    select x.org, x.src, x.id, x.key from (
      select e.organization_id as org, 'complaint' as src, e.id, 'complaint:' || e.id as key, e.created_at as at
        from chat.teacher_supervision_entry e
       where e.kind = 'complaint' and e.created_at >= s_complaint
         and not exists (select 1 from chat.teacher_supervision_entry r where r.refers_to = e.id and r.kind = 'complaint_resolution')
    ) x
     where x.at <= now() - v_settle
       and not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.key)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.key and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if (case r.src
            when 'complaint' then chat.work_task_raise_complaint(r.id)
          end) is not null then
        v_raised := v_raised + 1;
      else
        v_declined := v_declined + 1;
        if not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = r.org and i.source_key = r.key and i.next_try_at > now()) then
          perform chat.work_task_note_issue(r.org, r.key, 'not raised: its source declined it (see its raise rule)');
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- Reconcile: the evidence re-read now. A withdrawn task may come back, or be done.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key, t.source_state, v.verdict, v.actor
        from chat.work_task t
        cross join lateral chat.work_task_decision_verdict(t.source_type, t.source_id) v
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
         and t.source_type in ('complaint')
    ) y
     where y.source_state = 'pending' and y.verdict in ('done', 'gone')
        or y.source_state = 'withdrawn' and y.verdict in ('back', 'done')
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if r.verdict = 'done' then
        v_settled := v_settled + chat.work_task_settle(r.org, r.key, r.actor);
      elsif r.verdict = 'gone' then
        v_withdrawn := v_withdrawn + chat.work_task_withdraw(r.org, r.key);
      else
        v_restored := v_restored + chat.work_task_restore(r.org, r.key);
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- Owners: an open task whose assignee left moves to its source's owner now.
  for r in
    select t.organization_id as org, t.source_key as key, chat.work_task_decision_owner(t.source_type, t.source_id) as owner
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('complaint')
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_decision_owner(t.source_type, t.source_id) is not null
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      v_rerouted := v_rerouted + chat.work_task_reroute(r.org, r.key, r.owner, null, null);
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- An assignee who left with nobody live to follow: recorded for the super admin.
  for r in
    select t.organization_id as org, t.source_key as key
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('complaint')
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_decision_owner(t.source_type, t.source_id) is null
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    perform chat.work_task_note_issue(r.org, r.key,
      'orphaned: its assignee left and nobody live follows (the teacher''s supervisor or the Teachers manager): the super admin may reassign it');
    v_orphaned := v_orphaned + 1;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'restored', v_restored, 'rerouted', v_rerouted, 'orphaned', v_orphaned,
                            'failed', v_failed, 'declined', v_declined, 'more', v_more,
                            'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 4. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

-- A complaint resolved on the Teacher File: its task is done, by who resolved it.
create or replace function chat.work_task_from_supervision_entry()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_settle(new.organization_id, 'complaint:' || new.refers_to, new.created_by);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'complaint:' || new.refers_to, sqlerrm);
  end;
  return null;
end;
$$;

create trigger supervision_entry_settles_its_complaint after insert on chat.teacher_supervision_entry
  for each row when (new.kind = 'complaint_resolution' and new.refers_to is not null)
  execute function chat.work_task_from_supervision_entry();

-- ===========================================================================
-- 6. Fail closed
-- ===========================================================================

revoke all on function chat.work_task_decision_owner(text, uuid) from public;
revoke all on function chat.work_task_decision_verdict(text, uuid) from public;
revoke all on function chat.work_task_sweep_decisions(integer) from public;
revoke all on function chat.work_task_raise_complaint(uuid) from public;
revoke all on function chat.work_task_from_supervision_entry() from public;
