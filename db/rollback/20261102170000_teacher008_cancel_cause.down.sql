-- Roll back 20261102170000_chat_teacher008_cancel_cause (TEACHER-008: a lesson
-- cancelled because of the teacher owes a make-up).
--
-- Restores chat.lesson_owes_makeup and chat.work_task_makeup_causes() to their
-- definitions of 20261030000000 (PD-47 phase B) FIRST -- the current ones read
-- cancel_cause -- then drops the CHECK and the column. Lessons cancelled for
-- the teacher in the meantime stop owing a make-up; a makeup_owed task already
-- raised for one is left to the PD-47 sweep. Roll back the API release with
-- it: LessonService writes cancel_cause and lists 'teacher_cancelled'.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102170000_teacher008_cancel_cause.down.sql

create or replace function chat.lesson_owes_makeup(p_lesson uuid, p_causes text[])
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce((
    select l.kind <> 'trial'
           and l.outcome = any (p_causes)
           and not exists (
             select 1 from chat.lesson m
              where m.makeup_for = l.id and m.kind = 'makeup'
                and (m.outcome is null or m.outcome not in ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled', 'voided')))
           and not exists (select 1 from chat.lesson_ruling r where r.lesson_id = l.id and r.kind = 'makeup_followup')
      from chat.lesson l
     where l.id = p_lesson), false);
$$;
revoke all on function chat.lesson_owes_makeup(uuid, text[]) from public;

create or replace function chat.work_task_makeup_causes()
returns text[]
language sql
immutable
set search_path = chat, pg_temp
as $$
  select array['teacher_apology', 'teacher_no_show']::text[];
$$;
revoke all on function chat.work_task_makeup_causes() from public;

-- PD-47's decision verdict and sweep, as 20261030000000 defined them.
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
  if p_type = 'feedback' then
    select case when f.status = 'resolved' then 'done' else 'back' end,
           case when f.status = 'resolved' then f.responded_by end
      into verdict, actor
      from chat.parent_feedback f where f.id = p_source and f.category <> 'complaint';
    verdict := coalesce(verdict, 'gone');
  end if;
  if p_type = 'schedule_change' then
    select case q.status when 'pending' then 'back' when 'withdrawn' then 'gone' else 'done' end,
           case when q.status in ('approved', 'rejected') then q.decided_by end
      into verdict, actor
      from chat.schedule_change_request q where q.id = p_source;
    verdict := coalesce(verdict, 'gone');
  end if;
  if p_type = 'makeup_owed' then
    v_original := chat.work_task_makeup_original(p_source);
    -- Corrected away: the lesson is no longer one its teacher missed.
    if v_original is null or not exists (select 1 from chat.lesson o where o.id = v_original and o.kind <> 'trial'
                                            and o.outcome = any (chat.work_task_makeup_causes())) then
      return;
    end if;
    -- When this episode's own lesson was booked: null for the original (every
    -- make-up of it comes after). Make-ups are compared with make-ups by when
    -- each was booked -- one clock, never a booking against an outcome time.
    select s.created_at into v_since from chat.lesson s where s.id = p_source and p_source <> v_original;
    -- Booked: the first make-up anywhere in the chain booked after this
    -- episode's lesson (a later one that died opens the next episode).
    select 'done', chat.work_task_lesson_actor(m.created_by_kind, m.created_by) into verdict, actor
      from chat.lesson m
     where m.id in (select chat.work_task_makeup_chain(v_original)) and m.id <> p_source
       and (v_since is null or m.created_at > v_since)
     order by m.created_at, m.id
     limit 1;
    if verdict = 'done' then
      return;
    end if;
    -- Ruled on and DECIDED (a substitute, a credit, an extension, waived); a
    -- ruling still pending keeps it owed.
    select 'done', r.decided_by into verdict, actor
      from chat.lesson_ruling r
     where (r.lesson_id = v_original or r.lesson_id in (select chat.work_task_makeup_chain(v_original)))
       and r.kind = 'makeup_followup' and r.decision is not null
     order by r.decided_at
     limit 1;
    if verdict = 'done' then
      return;
    end if;
    -- Still owed only while this is the current episode.
    verdict := case when chat.work_task_makeup_episode(v_original) = p_source then 'back' else 'gone' end;
  end if;
end;
$$;

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
  s_feedback  timestamptz;
  s_schedule  timestamptz;
  s_makeup  timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_decisions')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_complaint := chat.work_task_since('complaint');
  s_feedback := chat.work_task_since('feedback');
  s_schedule := chat.work_task_since('schedule_change');
  s_makeup := chat.work_task_since('makeup_owed');

  -- The issue log shrinks with these sources too: an occurrence whose task
  -- closed, whose work is done or gone, or an orphan given an owner again.
  -- Only these sources' keys.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
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
         and not exists (select 1 from chat.teacher_supervision_entry res where res.refers_to = e.id and res.kind = 'complaint_resolution')
      union all
      select f.organization_id, 'feedback', f.id, 'feedback:' || f.id, f.created_at
        from chat.parent_feedback f
       where f.category <> 'complaint' and f.status <> 'resolved' and f.created_at >= s_feedback
      union all
      select q.organization_id, 'schedule_change', q.id, 'schedule_change:' || q.id, q.created_at
        from chat.schedule_change_request q
       where q.status = 'pending' and q.created_at >= s_schedule
      union all
      select l.organization_id, 'makeup_owed', l.id, 'makeup_owed:' || ep.id, coalesce(ep.outcome_at, ep.ends_at)
        from chat.lesson l
        cross join lateral (select x.id, x.outcome_at, x.ends_at from chat.lesson x where x.id = chat.work_task_makeup_episode(l.id)) ep
       where l.kind <> 'trial' and not (l.kind = 'makeup' and l.makeup_for is not null)
         and l.outcome = any (chat.work_task_makeup_causes())
         and (select v.verdict from chat.work_task_decision_verdict('makeup_owed', ep.id) v) = 'back'
         and coalesce(ep.outcome_at, ep.ends_at) >= s_makeup
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
            when 'feedback' then chat.work_task_raise_feedback(r.id)
            when 'schedule_change' then chat.work_task_raise_schedule_change(r.id)
            when 'makeup_owed' then chat.work_task_raise_makeup_owed(r.id)
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
         and t.source_type in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
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
       and t.source_type in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
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
       and t.source_type in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
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

drop function if exists chat.lesson_is_makeup_cause(text, text, text[]);

alter table chat.lesson drop constraint if exists lesson_cancel_cause;
alter table chat.lesson drop column if exists cancel_cause;

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102170000_chat_teacher008_cancel_cause';
