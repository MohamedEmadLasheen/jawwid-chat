-- PD-47 (2026-10-28), PR-2 -- system tasks from their sources (Phase A).
--
-- Plan: docs/product/pd047-tasks-plan.md §3.5-§3.6, and the priority
-- amendment docs/product/pd047-amendment-priority.md §2 (owner-approved).
-- Builds on 20261029160000 (tasks) and 20261029200000 (priority).
--
-- WHAT IS NEW
--
--   Six sources, each making at most one task per occurrence (its source_key,
--   unique for ever), completing it only on positive evidence that the work
--   was done, and never removing it:
--
--   source_type         key                         assignee              rule          due
--   lesson_report       lesson_report:<lesson>      the lesson's teacher  overdue_only  end + 24 h
--   report_correction   report_correction:<req>     the lesson's teacher  overdue_only  asked + 48 h
--   lesson_ruling       lesson_ruling:<ruling>      the teacher's owner   generic       opened + 48 h
--   leave_decision      leave_decision:<req>        the teacher's owner   generic       before the first day, at most + 48 h
--   violation_decision  violation_decision:<id>     the teacher's owner   generic       recorded + 3 days
--   case                case:<case>                 the case's owner      generic       end of its due day
--
--   "The teacher's owner" is their PD-35 supervisor while live and still a
--   Teachers supervisor, else the live Teachers manager (PD-43's rule).
--
--   CREATED by chat.work_task_sweep() (the worker, every minute), and at once
--   by an AFTER INSERT trigger on the event-born sources. A lesson report is
--   raised only for lessons that ended after the first sweep
--   (tasks.lesson_report_since): no backfill of past lessons.
--   COMPLETED in the source's own transaction by an AFTER UPDATE trigger on
--   each source table (one function per table), with the person the source
--   names; the sweep re-reads the evidence as a safety net. A source that went
--   away without the work (a lesson cancelled, a request withdrawn) WITHDRAWS
--   the task: it stays, marked, until its assignee acknowledges it or a
--   manager removes it (plan Q4). A case's owner moving REASSIGNS its task.
--
--   A trigger on a source never blocks the source's own write: its task work
--   runs in a subtransaction whose failure is a warning, and the sweep
--   reconciles.
--
--   chat.task_system: set only by the helpers below, around their own writes,
--   and restored after. The guard admits a system task, a source state or
--   floor change, and the completion of a system task only with it.
--
-- FAIL CLOSED: the tables keep their RLS and revoked grants. Every function
-- pins its search_path.

-- ===========================================================================
-- 1. Who
-- ===========================================================================

-- 'staff' or 'teacher' when p_id is a person of p_org, live or not.
create or replace function chat.task_principal_any(p_id uuid, p_org uuid)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
    when exists (select 1 from chat.staff s where s.id = p_id and s.organization_id = p_org) then 'staff'
    when exists (select 1 from chat.teacher t where t.id = p_id and t.organization_id = p_org) then 'teacher'
  end;
$$;

-- The staff member a teacher's decisions go to: their PD-35 supervisor while
-- live and still a supervisor of the Teachers department, else the live
-- Teachers manager (PD-43: the manager covers an unsupervised teacher).
create or replace function chat.work_task_teacher_owner(p_teacher uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select a.supervisor_id
       from chat.teacher_supervisor_assignment a
       join chat.staff s on s.id = a.supervisor_id and s.is_active and s.left_at is null
      where a.teacher_id = p_teacher
        and exists (select 1 from chat.department_member m
                      join chat.department d on d.id = m.department_id
                     where m.staff_id = a.supervisor_id and m.position = 'supervisor' and d.kind = 'teachers')),
    (select d.manager_id
       from chat.teacher t
       join chat.department d on d.organization_id = t.organization_id and d.kind = 'teachers'
       join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
      where t.id = p_teacher
      order by d.id
      limit 1));
$$;

-- ===========================================================================
-- 2. The helpers: the only writers of system tasks
-- ===========================================================================

-- Run as the system, naming p_actor (or nobody), then put the settings back.
create or replace function chat.work_task_begin_system(p_actor uuid)
returns text[]
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := array[current_setting('chat.task_system', true),
                          current_setting('chat.task_actor', true),
                          current_setting('chat.task_note', true)];
begin
  perform set_config('chat.task_system', 'on', true);
  perform set_config('chat.task_actor', coalesce(p_actor::text, ''), true);
  perform set_config('chat.task_note', '', true);
  return v_saved;
end;
$$;

create or replace function chat.work_task_end_system(p_saved text[])
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  perform set_config('chat.task_system', coalesce(p_saved[1], ''), true);
  perform set_config('chat.task_actor', coalesce(p_saved[2], ''), true);
  perform set_config('chat.task_note', coalesce(p_saved[3], ''), true);
end;
$$;

create or replace function chat.work_task_signal(p_task uuid, p_revision integer, p_change text)
returns void
language sql
set search_path = chat, pg_temp
as $$
  insert into chat.outbox_event (type, payload)
  values ('task.changed', jsonb_build_object('taskId', p_task, 'revision', p_revision, 'change', p_change));
$$;

-- Make the task for one source occurrence, once. Returns its id, or null when
-- the key was already used (a task exists, or existed and was removed).
create or replace function chat.work_task_raise(
  p_org uuid, p_source_type text, p_source_id uuid, p_staff uuid, p_teacher uuid,
  p_priority text, p_category text, p_floor_rule text, p_due_at timestamptz)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(null);
  v_id    uuid;
  v_rev   integer;
begin
  insert into chat.work_task (organization_id, kind, source_type, source_id, source_key, source_state,
                              assignee_staff_id, assignee_teacher_id, priority, category, floor_rule, due_at)
  values (p_org, 'system', p_source_type, p_source_id, p_source_type || ':' || p_source_id, 'pending',
          p_staff, p_teacher, p_priority, p_category, p_floor_rule, p_due_at)
  on conflict (organization_id, source_key) do nothing
  returning id, revision into v_id, v_rev;
  if v_id is not null then
    perform chat.work_task_signal(v_id, v_rev, 'created');
  end if;
  perform chat.work_task_end_system(v_saved);
  return v_id;
end;
$$;

-- The source's work is done, by p_actor: the task is completed.
create or replace function chat.work_task_settle(p_org uuid, p_key text, p_actor uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  r record;
begin
  for r in
    update chat.work_task set state = 'completed', outcome = 'done'
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'completed');
  end loop;
  perform chat.work_task_end_system(v_saved);
end;
$$;

-- The source went away without its work: the task stays, marked.
create or replace function chat.work_task_withdraw(p_org uuid, p_key text)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(null);
  r record;
begin
  for r in
    update chat.work_task set source_state = 'withdrawn'
     where organization_id = p_org and source_key = p_key
       and state in ('open', 'awaiting_decision') and source_state = 'pending'
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'source_withdrawn');
  end loop;
  perform chat.work_task_end_system(v_saved);
end;
$$;

-- The source's owner changed (a case reassigned), by p_actor: exit 4.
create or replace function chat.work_task_reroute(p_org uuid, p_key text, p_staff uuid, p_teacher uuid, p_actor uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  r record;
begin
  for r in
    update chat.work_task set assignee_staff_id = p_staff, assignee_teacher_id = p_teacher, state = 'open'
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
       and (assignee_staff_id, assignee_teacher_id) is distinct from (p_staff, p_teacher)
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'reassigned');
  end loop;
  perform chat.work_task_end_system(v_saved);
end;
$$;

-- The source's due date changed (a case's), by p_actor.
create or replace function chat.work_task_redate(p_org uuid, p_key text, p_due_at timestamptz, p_actor uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  r record;
begin
  for r in
    update chat.work_task set due_at = p_due_at
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
       and due_at is distinct from p_due_at
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'due_changed');
  end loop;
  perform chat.work_task_end_system(v_saved);
end;
$$;

-- ===========================================================================
-- 3. The sources: one raise function each
-- ===========================================================================

-- The end of an academy day (00:00 of the next one), as a moment.
create or replace function chat.work_task_end_of_day(p_day date)
returns timestamptz
language sql
stable
set search_path = chat, pg_temp
as $$
  select ((p_day + 1)::timestamp) at time zone chat.work_task_academy_zone();
$$;

create or replace function chat.work_task_raise_lesson_report(p_lesson uuid)
returns uuid
language sql
set search_path = chat, pg_temp
as $$
  select chat.work_task_raise(l.organization_id, 'lesson_report', l.id, null, l.teacher_id,
                              'medium', 'operational', 'overdue_only', l.ends_at + interval '24 hours')
    from chat.lesson l
    join chat.teacher t on t.id = l.teacher_id and t.is_active and t.left_at is null
   where l.id = p_lesson and l.outcome is null and l.ends_at <= now();
$$;

create or replace function chat.work_task_raise_report_correction(p_request uuid)
returns uuid
language sql
set search_path = chat, pg_temp
as $$
  select chat.work_task_raise(r.organization_id, 'report_correction', r.id, null, r.teacher_id,
                              'medium', 'operational', 'overdue_only', r.requested_at + interval '48 hours')
    from chat.report_correction_request r
    join chat.teacher t on t.id = r.teacher_id and t.is_active and t.left_at is null
   where r.id = p_request and r.resolution is null;
$$;

create or replace function chat.work_task_raise_lesson_ruling(p_ruling uuid)
returns uuid
language sql
set search_path = chat, pg_temp
as $$
  select chat.work_task_raise(r.organization_id, 'lesson_ruling', r.id, chat.work_task_teacher_owner(l.teacher_id), null,
                              'medium', 'operational', 'generic', r.opened_at + interval '48 hours')
    from chat.lesson_ruling r
    join chat.lesson l on l.id = r.lesson_id
   where r.id = p_ruling and r.decision is null and chat.work_task_teacher_owner(l.teacher_id) is not null;
$$;

-- High when the leave starts within 3 days; due before its first day, and
-- within 48 h of the request at the latest.
create or replace function chat.work_task_raise_leave_decision(p_request uuid)
returns uuid
language sql
set search_path = chat, pg_temp
as $$
  select chat.work_task_raise(r.organization_id, 'leave_decision', r.id, chat.work_task_teacher_owner(r.teacher_id), null,
                              case when r.first_day <= chat.academy_today() + 3 then 'high' else 'medium' end,
                              'operational', 'generic',
                              least(r.requested_at + interval '48 hours', chat.work_task_end_of_day(r.first_day - 1)))
    from chat.teacher_leave_request r
   where r.id = p_request and r.state = 'requested' and chat.work_task_teacher_owner(r.teacher_id) is not null;
$$;

create or replace function chat.work_task_raise_violation_decision(p_violation uuid)
returns uuid
language sql
set search_path = chat, pg_temp
as $$
  select chat.work_task_raise(v.organization_id, 'violation_decision', v.id, chat.work_task_teacher_owner(v.teacher_id), null,
                              'medium', 'operational', 'generic', v.recorded_at + interval '72 hours')
    from chat.teacher_violation v
   where v.id = p_violation and v.decision is null and chat.work_task_teacher_owner(v.teacher_id) is not null;
$$;

-- The case's owner, else its target department's manager.
create or replace function chat.work_task_case_assignee(p_case uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(c.owner_id, d.manager_id)
    from chat.supervision_case c join chat.department d on d.id = c.target_department_id
   where c.id = p_case;
$$;

create or replace function chat.work_task_raise_case(p_case uuid)
returns uuid
language sql
set search_path = chat, pg_temp
as $$
  select chat.work_task_raise(c.organization_id, 'case', c.id, chat.work_task_case_assignee(c.id), null,
                              'medium', 'operational', 'generic',
                              case when c.due_on is not null then chat.work_task_end_of_day(c.due_on) end)
    from chat.supervision_case c
   where c.id = p_case and c.status in ('open', 'in_progress') and chat.work_task_case_assignee(c.id) is not null;
$$;

-- ===========================================================================
-- 4. The sweep: create what is missing, reconcile what is done
-- ===========================================================================

-- Run by the worker every minute. Each row is its own subtransaction: one bad
-- row is a warning, never a stopped sweep. Returns how many rows it touched.
create or replace function chat.work_task_sweep()
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_since timestamptz;
  v_n     integer := 0;
  r       record;
begin
  -- Lesson reports start with the first sweep: no backfill of past lessons.
  insert into chat.config (key, value, description)
  values ('tasks.lesson_report_since', to_jsonb(now()::text),
          'PD-47: lesson-report tasks are raised for lessons that ended after this moment (the first sweep).')
  on conflict (key) do nothing;
  v_since := (select (value #>> '{}')::timestamptz from chat.config where key = 'tasks.lesson_report_since');

  -- Create.
  for r in
    select 'lesson_report' as src, l.id from chat.lesson l
     where l.outcome is null and l.ends_at <= now() and l.ends_at >= v_since
       and not exists (select 1 from chat.work_task t where t.organization_id = l.organization_id and t.source_key = 'lesson_report:' || l.id)
    union all
    select 'report_correction', q.id from chat.report_correction_request q
     where q.resolution is null
       and not exists (select 1 from chat.work_task t where t.organization_id = q.organization_id and t.source_key = 'report_correction:' || q.id)
    union all
    select 'lesson_ruling', q.id from chat.lesson_ruling q
     where q.decision is null
       and not exists (select 1 from chat.work_task t where t.organization_id = q.organization_id and t.source_key = 'lesson_ruling:' || q.id)
    union all
    select 'leave_decision', q.id from chat.teacher_leave_request q
     where q.state = 'requested'
       and not exists (select 1 from chat.work_task t where t.organization_id = q.organization_id and t.source_key = 'leave_decision:' || q.id)
    union all
    select 'violation_decision', q.id from chat.teacher_violation q
     where q.decision is null
       and not exists (select 1 from chat.work_task t where t.organization_id = q.organization_id and t.source_key = 'violation_decision:' || q.id)
    union all
    select 'case', q.id from chat.supervision_case q
     where q.status in ('open', 'in_progress')
       and not exists (select 1 from chat.work_task t where t.organization_id = q.organization_id and t.source_key = 'case:' || q.id)
  loop
    begin
      case r.src
        when 'lesson_report' then perform chat.work_task_raise_lesson_report(r.id);
        when 'report_correction' then perform chat.work_task_raise_report_correction(r.id);
        when 'lesson_ruling' then perform chat.work_task_raise_lesson_ruling(r.id);
        when 'leave_decision' then perform chat.work_task_raise_leave_decision(r.id);
        when 'violation_decision' then perform chat.work_task_raise_violation_decision(r.id);
        when 'case' then perform chat.work_task_raise_case(r.id);
      end case;
      v_n := v_n + 1;
    exception when others then
      raise warning 'PD-47 sweep: raising % % failed: %', r.src, r.id, sqlerrm;
    end;
  end loop;

  -- Reconcile: positive evidence only, re-read now.
  for r in
    select t.organization_id as org, t.source_key as key, t.source_type as src,
           case t.source_type
             when 'lesson_report' then (select case when l.outcome in ('held', 'student_no_show') then 'done'
                                                   when l.outcome is not null then 'gone' end
                                          from chat.lesson l where l.id = t.source_id)
             when 'report_correction' then (select case when q.resolution in ('corrected', 'filed') then 'done'
                                                       when q.resolution = 'withdrawn' then 'gone' end
                                              from chat.report_correction_request q where q.id = t.source_id)
             when 'lesson_ruling' then (select case when q.decision is not null then 'done' end
                                          from chat.lesson_ruling q where q.id = t.source_id)
             when 'leave_decision' then (select case when q.state in ('approved', 'declined', 'cancelled') then 'done'
                                                    when q.state = 'withdrawn' then 'gone' end
                                           from chat.teacher_leave_request q where q.id = t.source_id)
             when 'violation_decision' then (select case when q.decision is not null then 'done' end
                                               from chat.teacher_violation q where q.id = t.source_id)
             when 'case' then (select case when q.status in ('resolved', 'cancelled') then 'done' end
                                 from chat.supervision_case q where q.id = t.source_id)
           end as verdict,
           case t.source_type
             when 'lesson_report' then (select l.outcome_by from chat.lesson l where l.id = t.source_id)
             when 'report_correction' then (select q.resolved_by from chat.report_correction_request q where q.id = t.source_id)
             when 'lesson_ruling' then (select q.decided_by from chat.lesson_ruling q where q.id = t.source_id)
             when 'leave_decision' then (select coalesce(q.decided_by, q.ended_by) from chat.teacher_leave_request q where q.id = t.source_id)
             when 'violation_decision' then (select q.decided_by from chat.teacher_violation q where q.id = t.source_id)
             when 'case' then (select e.actor_id from chat.supervision_case_event e
                                where e.case_id = t.source_id and e.kind = 'status' order by e.at desc limit 1)
           end as actor
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision') and t.source_state = 'pending'
  loop
    begin
      if r.verdict = 'done' and r.actor is not null then
        perform chat.work_task_settle(r.org, r.key, r.actor);
        v_n := v_n + 1;
      elsif r.verdict = 'gone' then
        perform chat.work_task_withdraw(r.org, r.key);
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'PD-47 sweep: reconciling % failed: %', r.key, sqlerrm;
    end;
  end loop;

  -- A case's owner is the task's assignee.
  for r in
    select t.organization_id as org, t.source_key as key, chat.work_task_case_assignee(t.source_id) as owner,
           (select e.actor_id from chat.supervision_case_event e
             where e.case_id = t.source_id and e.kind in ('assigned', 'opened') order by e.at desc limit 1) as actor
      from chat.work_task t
     where t.kind = 'system' and t.source_type = 'case' and t.state in ('open', 'awaiting_decision')
       and t.assignee_staff_id is distinct from chat.work_task_case_assignee(t.source_id)
  loop
    begin
      if r.owner is not null and r.actor is not null then
        perform chat.work_task_reroute(r.org, r.key, r.owner, null, r.actor);
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'PD-47 sweep: rerouting % failed: %', r.key, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

-- ===========================================================================
-- 5. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

create or replace function chat.work_task_from_lesson()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if old.outcome is null and new.outcome is not null then
    begin
      if new.outcome in ('held', 'student_no_show') then
        perform chat.work_task_settle(new.organization_id, 'lesson_report:' || new.id, new.outcome_by);
      else
        perform chat.work_task_withdraw(new.organization_id, 'lesson_report:' || new.id);
      end if;
    exception when others then
      raise warning 'PD-47: lesson % task: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

create trigger lesson_settles_its_task after update of outcome on chat.lesson
  for each row execute function chat.work_task_from_lesson();

create or replace function chat.work_task_from_report_correction()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_report_correction(new.id);
    elsif old.resolution is null and new.resolution in ('corrected', 'filed') then
      perform chat.work_task_settle(new.organization_id, 'report_correction:' || new.id, new.resolved_by);
    elsif old.resolution is null and new.resolution = 'withdrawn' then
      perform chat.work_task_withdraw(new.organization_id, 'report_correction:' || new.id);
    end if;
  exception when others then
    raise warning 'PD-47: correction request % task: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger report_correction_request_raises_its_task after insert or update of resolution on chat.report_correction_request
  for each row execute function chat.work_task_from_report_correction();

create or replace function chat.work_task_from_lesson_ruling()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_lesson_ruling(new.id);
    elsif old.decision is null and new.decision is not null then
      perform chat.work_task_settle(new.organization_id, 'lesson_ruling:' || new.id, new.decided_by);
    end if;
  exception when others then
    raise warning 'PD-47: ruling % task: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger lesson_ruling_raises_its_task after insert or update of decision on chat.lesson_ruling
  for each row execute function chat.work_task_from_lesson_ruling();

create or replace function chat.work_task_from_leave_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_leave_decision(new.id);
    elsif old.state = 'requested' and new.state in ('approved', 'declined') then
      perform chat.work_task_settle(new.organization_id, 'leave_decision:' || new.id, new.decided_by);
    elsif old.state = 'requested' and new.state = 'withdrawn' then
      perform chat.work_task_withdraw(new.organization_id, 'leave_decision:' || new.id);
    end if;
  exception when others then
    raise warning 'PD-47: leave request % task: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger teacher_leave_request_raises_its_task after insert or update of state on chat.teacher_leave_request
  for each row execute function chat.work_task_from_leave_request();

create or replace function chat.work_task_from_violation()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_violation_decision(new.id);
    elsif old.decision is null and new.decision is not null then
      perform chat.work_task_settle(new.organization_id, 'violation_decision:' || new.id, new.decided_by);
    end if;
  exception when others then
    raise warning 'PD-47: violation % task: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger teacher_violation_raises_its_task after insert or update of decision on chat.teacher_violation
  for each row execute function chat.work_task_from_violation();

-- A case: opened, assigned, re-dated, closed -- by the actor its own guard
-- already requires (chat.case_actor).
create or replace function chat.work_task_from_case()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid := nullif(current_setting('chat.case_actor', true), '')::uuid;
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_case(new.id);
    else
      if new.status in ('resolved', 'cancelled') and old.status in ('open', 'in_progress') then
        perform chat.work_task_settle(new.organization_id, 'case:' || new.id, v_actor);
      else
        if new.owner_id is distinct from old.owner_id and chat.work_task_case_assignee(new.id) is not null then
          perform chat.work_task_reroute(new.organization_id, 'case:' || new.id, chat.work_task_case_assignee(new.id), null, v_actor);
        end if;
        if new.due_on is distinct from old.due_on then
          perform chat.work_task_redate(new.organization_id, 'case:' || new.id,
                                        case when new.due_on is not null then chat.work_task_end_of_day(new.due_on) end, v_actor);
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'PD-47: case % task: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger supervision_case_raises_its_task after insert or update on chat.supervision_case
  for each row execute function chat.work_task_from_case();

-- ===========================================================================
-- 6. The guard, the history trigger and the event guard, redefined
-- ===========================================================================

create or replace function chat.guard_work_task()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor    text := nullif(current_setting('chat.task_actor', true), '');
  v_note     text := nullif(btrim(coalesce(current_setting('chat.task_note', true), '')), '');
  v_org      uuid;
  v_moved    boolean;
  v_returned boolean;
  -- PD-47 PR-2: a source's own helpers (chat.work_task_raise / _settle /
  -- _withdraw / _reroute / _redate) say so; nothing else may set it.
  v_system   boolean := coalesce(current_setting('chat.task_system', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'a task is never deleted; it is completed, removed or reassigned' using errcode = 'check_violation';
  end if;
  if v_actor is null and not v_system then
    raise exception 'a task changes only with its actor named (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  v_org := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  -- A person acts live. A source names who did its work, who may have left since.
  if v_actor is not null and not v_system and chat.task_principal_kind(v_actor::uuid, v_org) is null then
    raise exception 'a task is changed by a live person of its organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if v_actor is not null and v_system and chat.task_principal_any(v_actor::uuid, v_org) is null then
    raise exception 'a source names a person of the task''s organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(new.assignee_staff_id, new.assignee_teacher_id) <> 1 then
    raise exception 'a task is assigned to exactly one person' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.kind = 'system' then
    if not v_system or new.created_by is not null then
      raise exception 'a system task is made by its source (chat.work_task_raise)' using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'open' or new.source_state is distinct from 'pending' or new.source_floor is not null then
      raise exception 'a system task is created open and pending' using errcode = 'check_violation';
    end if;
    if chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), new.organization_id) is null then
      raise exception 'a task is assigned to a live person of its organization' using errcode = 'check_violation';
    end if;
    new.outcome := null;
    new.closed_by := null;
    new.closed_at := null;
    new.close_reason := null;
    new.instructions := null;
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.kind <> 'manual' then
      raise exception 'a system task is made by its source' using errcode = 'check_violation';
    end if;
    if new.created_by is null or new.created_by::text <> v_actor then
      raise exception 'a manual task is created by its actor' using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'open' then
      raise exception 'a task is created open' using errcode = 'check_violation';
    end if;
    -- PD-47 priority: a manual task's urgency follows its due date (the
    -- generic floor); only a source names another rule or raises a floor.
    if new.floor_rule <> 'generic' or new.source_floor is not null then
      raise exception 'a manual task has the generic floor and no source floor' using errcode = 'check_violation';
    end if;
    if chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), new.organization_id) is null then
      raise exception 'a task is assigned to a live person of its organization' using errcode = 'check_violation';
    end if;
    new.outcome := null;
    new.closed_by := null;
    new.closed_at := null;
    new.close_reason := null;
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    return new;
  end if;

  -- UPDATE
  -- source_state and source_floor change with the sources (PR-2, PR-2b), which
  -- record source_withdrawn and source_raised. A category and a floor rule are
  -- fixed at creation (PD-47 priority amendment §1).
  if (new.id, new.organization_id, new.kind, new.source_type, new.source_id, new.source_key,
      new.category, new.floor_rule, new.title, new.body, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.kind, old.source_type, old.source_id, old.source_key,
      old.category, old.floor_rule, old.title, old.body, old.created_by, old.created_at) then
    raise exception 'a task''s what, source and creator never change' using errcode = 'check_violation';
  end if;
  -- The source's state and floor are the source's alone (its helpers).
  if (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor) then
    if not v_system then
      raise exception 'a task''s source state and floor change only with its source' using errcode = 'check_violation';
    end if;
    if new.source_state is distinct from old.source_state and not (old.source_state = 'pending' and new.source_state = 'withdrawn') then
      raise exception 'a source is withdrawn once, never revived' using errcode = 'check_violation';
    end if;
  end if;
  if old.state in ('completed', 'removed') then
    raise exception 'a closed task stays closed' using errcode = 'check_violation';
  end if;

  v_moved := (new.assignee_staff_id, new.assignee_teacher_id) is distinct from (old.assignee_staff_id, old.assignee_teacher_id);
  v_returned := old.state = 'awaiting_decision' and new.state = 'open' and not v_moved;
  if v_moved and chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), old.organization_id) is null then
    raise exception 'a task is reassigned to a live person of its organization' using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    -- The four exits, and nothing else.
    if not (old.state = 'open' and new.state in ('awaiting_decision', 'completed', 'removed')
            or old.state = 'awaiting_decision' and new.state in ('open', 'completed', 'removed')) then
      raise exception 'a task moves only by its four exits' using errcode = 'check_violation';
    end if;
    if new.state = 'awaiting_decision' and v_note is null then
      raise exception 'out of scope needs a comment (chat.task_note)' using errcode = 'check_violation';
    end if;
    if new.state = 'removed' and v_note is null then
      raise exception 'a removal needs a reason (chat.task_note)' using errcode = 'check_violation';
    end if;
    if v_returned and v_note is null then
      raise exception 'a return needs instructions (chat.task_note)' using errcode = 'check_violation';
    end if;
    -- A system task is completed by its work (its source's helper), or
    -- acknowledged by its assignee once its source went away (plan Q4).
    if new.state = 'completed' and old.kind = 'system' and not v_system
       and not (new.outcome = 'acknowledged' and old.source_state = 'withdrawn') then
      raise exception 'a system task is completed by doing its work' using errcode = 'check_violation';
    end if;
    if new.outcome = 'acknowledged' and not (old.kind = 'system' and old.source_state = 'withdrawn') then
      raise exception 'only a task whose source went away is acknowledged' using errcode = 'check_violation';
    end if;
    if new.state in ('completed', 'removed') then
      new.closed_by := v_actor::uuid;
      new.closed_at := now();
      new.close_reason := v_note;
    end if;
  elsif (new.outcome, new.closed_by, new.closed_at, new.close_reason)
        is distinct from (old.outcome, old.closed_by, old.closed_at, old.close_reason) then
    raise exception 'a task is closed only by moving to completed or removed' using errcode = 'check_violation';
  end if;

  -- Instructions come with a return or a reassignment, which record them.
  if new.instructions is distinct from old.instructions and not (v_returned or v_moved) then
    raise exception 'instructions come with a return or a reassignment' using errcode = 'check_violation';
  end if;
  -- Every change is recorded: a move, a state, a due date, a priority -- or a
  -- comment, whose event touches the task from its own trigger (activity_at only).
  if not (v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
          or new.priority is distinct from old.priority
          or (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor)) then
    if not (pg_trigger_depth() > 1 and new.activity_at is distinct from old.activity_at
            and new.instructions is not distinct from old.instructions) then
      raise exception 'a task changes only with a recorded event' using errcode = 'check_violation';
    end if;
  end if;

  -- activity_at is the task's last event: a comment sets it (from its own
  -- trigger), every other recorded change here.
  if v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
     or new.priority is distinct from old.priority
     or (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor) then
    new.activity_at := now();
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function chat.record_work_task_event()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  uuid := nullif(current_setting('chat.task_actor', true), '')::uuid;
  v_note   text := nullif(btrim(coalesce(current_setting('chat.task_note', true), '')), '');
  -- No actor: the system (a source creating or withdrawing). A source may name
  -- someone who has left since, so its kind is read whether live or not.
  v_kind   text := case when v_actor is null then 'system'
                        else coalesce(chat.task_principal_kind(v_actor, new.organization_id),
                                      chat.task_principal_any(v_actor, new.organization_id)) end;
  v_from   uuid;
  v_to     uuid := coalesce(new.assignee_staff_id, new.assignee_teacher_id);
  v_moved  boolean;
begin
  if tg_op = 'INSERT' then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, after)
    values (new.id, new.organization_id, 'created', v_kind, v_actor, v_to,
            jsonb_build_object('dueAt', new.due_at));
    return new;
  end if;

  v_from := coalesce(old.assignee_staff_id, old.assignee_teacher_id);
  v_moved := v_from is distinct from v_to;
  if v_moved then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, from_assignee, to_assignee, body)
    values (new.id, new.organization_id, 'reassigned', v_kind, v_actor, v_from, v_to, v_note);
  end if;
  if new.state is distinct from old.state then
    if new.state = 'awaiting_decision' then
      insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body)
      values (new.id, new.organization_id, 'out_of_scope', v_kind, v_actor, v_to, v_note);
    elsif new.state = 'open' and not v_moved then
      insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body)
      values (new.id, new.organization_id, 'returned', v_kind, v_actor, v_to, v_note);
    elsif new.state in ('completed', 'removed') then
      insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, body, after)
      values (new.id, new.organization_id, new.state, v_kind, v_actor, v_to, v_note,
              case when new.outcome is not null then jsonb_build_object('outcome', new.outcome) end);
    end if;
  end if;
  if new.source_state is distinct from old.source_state then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'source_withdrawn', 'system', null, v_to,
            jsonb_build_object('sourceState', old.source_state), jsonb_build_object('sourceState', new.source_state));
  end if;
  if new.source_floor is distinct from old.source_floor then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'source_raised', 'system', null, v_to,
            jsonb_build_object('sourceFloor', old.source_floor), jsonb_build_object('sourceFloor', new.source_floor));
  end if;
  if new.priority is distinct from old.priority then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'priority_changed', v_kind, v_actor, v_to,
            jsonb_build_object('priority', old.priority), jsonb_build_object('priority', new.priority));
  end if;
  if new.due_at is distinct from old.due_at then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'due_changed', v_kind, v_actor, v_to,
            jsonb_build_object('dueAt', old.due_at), jsonb_build_object('dueAt', new.due_at));
  end if;
  return new;
end;
$$;

create or replace function chat.guard_work_task_event()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid := (select organization_id from chat.work_task where id = new.task_id);
begin
  if v_org is null or new.organization_id is distinct from v_org then
    raise exception 'a task event belongs to its task''s organization' using errcode = 'check_violation';
  end if;
  if pg_trigger_depth() <= 1 then
    if new.kind <> 'commented' then
      raise exception 'only a comment is written directly; every other event is the task''s own' using errcode = 'insufficient_privilege';
    end if;
    if new.actor_id is null or new.actor_id::text is distinct from nullif(current_setting('chat.task_actor', true), '') then
      raise exception 'a comment is written by its actor (chat.task_actor)' using errcode = 'insufficient_privilege';
    end if;
    -- A comment says only who, what and its text: written now, about the
    -- task's current assignee. It cannot be back-dated or carry a move.
    new.at := clock_timestamp();
    new.from_assignee := null;
    new.to_assignee := (select coalesce(t.assignee_staff_id, t.assignee_teacher_id) from chat.work_task t where t.id = new.task_id);
    new.before := null;
    new.after := null;
  end if;
  -- A person writes live. A source's helper may name who did its work even if
  -- they have left since (chat.task_system).
  if new.actor_kind <> 'system'
     and chat.task_principal_kind(new.actor_id, v_org) is distinct from new.actor_kind
     and not (coalesce(current_setting('chat.task_system', true), '') = 'on'
              and chat.task_principal_any(new.actor_id, v_org) is not distinct from new.actor_kind) then
    raise exception 'a task event is written by a live person of its organization (actor)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 7. Fail closed
-- ===========================================================================

revoke all on function chat.task_principal_any(uuid, uuid) from public;
revoke all on function chat.work_task_teacher_owner(uuid) from public;
revoke all on function chat.work_task_begin_system(uuid) from public;
revoke all on function chat.work_task_end_system(text[]) from public;
revoke all on function chat.work_task_signal(uuid, integer, text) from public;
revoke all on function chat.work_task_raise(uuid, text, uuid, uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function chat.work_task_settle(uuid, text, uuid) from public;
revoke all on function chat.work_task_withdraw(uuid, text) from public;
revoke all on function chat.work_task_reroute(uuid, text, uuid, uuid, uuid) from public;
revoke all on function chat.work_task_redate(uuid, text, timestamptz, uuid) from public;
revoke all on function chat.work_task_end_of_day(date) from public;
revoke all on function chat.work_task_raise_lesson_report(uuid) from public;
revoke all on function chat.work_task_raise_report_correction(uuid) from public;
revoke all on function chat.work_task_raise_lesson_ruling(uuid) from public;
revoke all on function chat.work_task_raise_leave_decision(uuid) from public;
revoke all on function chat.work_task_raise_violation_decision(uuid) from public;
revoke all on function chat.work_task_case_assignee(uuid) from public;
revoke all on function chat.work_task_raise_case(uuid) from public;
revoke all on function chat.work_task_sweep() from public;
revoke all on function chat.work_task_from_lesson() from public;
revoke all on function chat.work_task_from_report_correction() from public;
revoke all on function chat.work_task_from_lesson_ruling() from public;
revoke all on function chat.work_task_from_leave_request() from public;
revoke all on function chat.work_task_from_violation() from public;
revoke all on function chat.work_task_from_case() from public;
revoke all on function chat.guard_work_task() from public;
revoke all on function chat.record_work_task_event() from public;
revoke all on function chat.guard_work_task_event() from public;
