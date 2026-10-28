-- PD-47 (2026-10-28), PR-2 -- system tasks from their sources (Phase A). Slot 20261029210000.
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
--   CREATED by chat.work_task_sweep() (the worker, every minute, in batches of
--   at most 60 under an advisory lock), and at once by an AFTER INSERT trigger
--   on the event-born sources. Owner, 2026-10-29: at switch-on only the last
--   14 days become tasks -- a cut-off per source, tasks.since.<source>, set on
--   first use to that moment minus 14 days; older open items stay as they are.
--   A trial lesson (no learner) raises no report task: Phase B's trial_outcome.
--   A "missing" correction whose lesson already has a report task raises none.
--   A violation whose lesson was corrected away (PD-15) is never raised, and
--   its task is withdrawn.
--   COMPLETED in the source's own transaction by an AFTER UPDATE trigger on
--   each source table (one function per table), with the person the source
--   names; the sweep re-reads the evidence as a safety net. A source that went
--   away without the work (a lesson cancelled, a request withdrawn) WITHDRAWS
--   the task: it stays, marked, until its assignee acknowledges it or a
--   manager removes it (plan Q4). A case's owner moving REASSIGNS its task.
--
--   A trigger on a source never blocks the source's own write: its task work
--   runs in a subtransaction with a 2 s lock wait. A failure, or an occurrence
--   with nobody to assign it to, is recorded in chat.work_task_source_issue,
--   warned once, and retried with a back-off; the sweep reconciles and returns
--   its counts (raised, settled, withdrawn, rerouted, failed, issues).
--   A lesson given to another teacher moves its report task; a case whose
--   owner left moves to its department's manager.
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

-- Run as the system, naming p_actor (or nobody), with a short lock wait so a
-- source's own write never queues behind a busy task row; then put every
-- setting back.
create or replace function chat.work_task_begin_system(p_actor uuid)
returns text[]
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := array[current_setting('chat.task_system', true),
                          current_setting('chat.task_actor', true),
                          current_setting('chat.task_note', true),
                          current_setting('lock_timeout')];
begin
  perform set_config('chat.task_system', 'on', true);
  perform set_config('chat.task_actor', coalesce(p_actor::text, ''), true);
  perform set_config('chat.task_note', '', true);
  perform set_config('lock_timeout', '2s', true);
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
  perform set_config('lock_timeout', coalesce(p_saved[4], '0'), true);
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

-- A source occurrence that could not become a task, or whose task could not
-- be moved on: why, how often, and when to try again. Warned once, then
-- retried with a back-off (1 h, doubling, at most a day), never every minute.
create table chat.work_task_source_issue (
  organization_id  uuid not null references chat.organization (id),
  source_key       text not null,
  reason           text not null check (length(reason) between 1 and 2000),
  attempts         integer not null default 1,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  next_try_at      timestamptz not null,
  primary key (organization_id, source_key)
);

comment on table chat.work_task_source_issue is
  'PD-47: a task source the sweep or a source trigger could not act on (no assignee, an error), with a back-off. Cleared when its task is raised.';

create or replace function chat.work_task_note_issue(p_org uuid, p_key text, p_reason text)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_first boolean;
begin
  insert into chat.work_task_source_issue (organization_id, source_key, reason, next_try_at)
  values (p_org, p_key, left(p_reason, 2000), now() + interval '1 hour')
  on conflict (organization_id, source_key) do update
     set reason = excluded.reason,
         attempts = chat.work_task_source_issue.attempts + 1,
         last_seen = now(),
         next_try_at = now() + least(interval '1 hour' * power(2, chat.work_task_source_issue.attempts), interval '24 hours')
  returning (xmax = 0) into v_first;
  if v_first then
    raise warning 'PD-47 task source %: %', p_key, p_reason;
  end if;
end;
$$;

-- How far back a source's occurrences become tasks (owner, 2026-10-29: "Yes,
-- but only recent ones"): set on first use to that moment minus 14 days, one
-- key per source, tasks.since.<source>. Older open items stay as they are.
create or replace function chat.work_task_since(p_source text)
returns timestamptz
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  insert into chat.config (key, value, description)
  values ('tasks.since.' || p_source, to_jsonb((now() - interval '14 days')::text),
          'PD-47: occurrences of this task source older than this moment do not become tasks (owner 2026-10-29: the last 14 days at switch-on).')
  on conflict (key) do nothing;
  return (select (value #>> '{}')::timestamptz from chat.config where key = 'tasks.since.' || p_source);
end;
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
    delete from chat.work_task_source_issue where organization_id = p_org and source_key = p_source_type || ':' || p_source_id;
  end if;
  perform chat.work_task_end_system(v_saved);
  return v_id;
end;
$$;

-- The source's work is done, by p_actor: the task is completed.
create or replace function chat.work_task_settle(p_org uuid, p_key text, p_actor uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  v_n     integer := 0;
  r record;
begin
  for r in
    update chat.work_task set state = 'completed', outcome = 'done'
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'completed');
    v_n := v_n + 1;
  end loop;
  perform chat.work_task_end_system(v_saved);
  return v_n;
end;
$$;

-- The source went away without its work: the task stays OPEN, marked, until a
-- person takes one of the four exits (plan §3.2, Q4).
create or replace function chat.work_task_withdraw(p_org uuid, p_key text)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(null);
  v_n     integer := 0;
  r record;
begin
  for r in
    update chat.work_task set source_state = 'withdrawn'
     where organization_id = p_org and source_key = p_key
       and state in ('open', 'awaiting_decision') and source_state = 'pending'
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'source_withdrawn');
    v_n := v_n + 1;
  end loop;
  perform chat.work_task_end_system(v_saved);
  return v_n;
end;
$$;

-- The source's owner changed (a case reassigned, a lesson's teacher changed):
-- exit 4, by p_actor when the source names one, else by the system.
create or replace function chat.work_task_reroute(p_org uuid, p_key text, p_staff uuid, p_teacher uuid, p_actor uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  v_n     integer := 0;
  r record;
begin
  for r in
    update chat.work_task set assignee_staff_id = p_staff, assignee_teacher_id = p_teacher, state = 'open'
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
       and (assignee_staff_id, assignee_teacher_id) is distinct from (p_staff, p_teacher)
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'reassigned');
    v_n := v_n + 1;
  end loop;
  perform chat.work_task_end_system(v_saved);
  return v_n;
end;
$$;

-- The source's due date changed (a case's), by p_actor.
create or replace function chat.work_task_redate(p_org uuid, p_key text, p_due_at timestamptz, p_actor uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  v_n     integer := 0;
  r record;
begin
  for r in
    update chat.work_task set due_at = p_due_at
     where organization_id = p_org and source_key = p_key and state in ('open', 'awaiting_decision')
       and due_at is distinct from p_due_at
     returning id, revision
  loop
    perform chat.work_task_signal(r.id, r.revision, 'due_changed');
    v_n := v_n + 1;
  end loop;
  perform chat.work_task_end_system(v_saved);
  return v_n;
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

-- PD-15: a violation stands while it is decided, has no lesson, or its lesson
-- still has the outcome it was recorded for (lateness: held). An undecided
-- violation whose lesson was corrected away can no longer be decided
-- (DisciplineService.standing), so its task is withdrawn and never raised.
create or replace function chat.work_task_violation_stands(p_violation uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select v.decision is not null or v.lesson_id is null
      or (select l.outcome from chat.lesson l where l.id = v.lesson_id)
         is not distinct from (case when v.kind = 'late' then 'held' else v.kind end)
    from chat.teacher_violation v where v.id = p_violation;
$$;

-- A lesson report: a real lesson (not a trial: those are Phase B's
-- trial_outcome) of a live teacher, ended, without an outcome.
create or replace function chat.work_task_raise_lesson_report(p_lesson uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  l chat.lesson;
begin
  select * into l from chat.lesson where id = p_lesson;
  if l.id is null or l.learner_id is null or l.outcome is not null or l.ends_at > now()
     or l.ends_at < chat.work_task_since('lesson_report') then
    return null;
  end if;
  if chat.task_principal_kind(l.teacher_id, l.organization_id) is distinct from 'teacher' then
    perform chat.work_task_note_issue(l.organization_id, 'lesson_report:' || l.id, 'the lesson''s teacher is not active');
    return null;
  end if;
  return chat.work_task_raise(l.organization_id, 'lesson_report', l.id, null, l.teacher_id,
                              'medium', 'operational', 'overdue_only', l.ends_at + interval '24 hours');
end;
$$;

-- A correction request. A "missing" one whose lesson already has a report
-- task asks for that same work: it raises nothing of its own.
create or replace function chat.work_task_raise_report_correction(p_request uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q chat.report_correction_request;
begin
  select * into q from chat.report_correction_request where id = p_request;
  if q.id is null or q.resolution is not null or q.requested_at < chat.work_task_since('report_correction') then
    return null;
  end if;
  if q.kind = 'missing' and exists (
       select 1 from chat.work_task t
        where t.organization_id = q.organization_id and t.source_key = 'lesson_report:' || q.lesson_id
          and t.state in ('open', 'awaiting_decision')) then
    return null;
  end if;
  if chat.task_principal_kind(q.teacher_id, q.organization_id) is distinct from 'teacher' then
    perform chat.work_task_note_issue(q.organization_id, 'report_correction:' || q.id, 'the lesson''s teacher is not active');
    return null;
  end if;
  return chat.work_task_raise(q.organization_id, 'report_correction', q.id, null, q.teacher_id,
                              'medium', 'operational', 'overdue_only', q.requested_at + interval '48 hours');
end;
$$;

create or replace function chat.work_task_raise_lesson_ruling(p_ruling uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q       chat.lesson_ruling;
  v_owner uuid;
begin
  select * into q from chat.lesson_ruling where id = p_ruling;
  if q.id is null or q.decision is not null or q.opened_at < chat.work_task_since('lesson_ruling') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner((select l.teacher_id from chat.lesson l where l.id = q.lesson_id));
  if v_owner is null then
    perform chat.work_task_note_issue(q.organization_id, 'lesson_ruling:' || q.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(q.organization_id, 'lesson_ruling', q.id, v_owner, null,
                              'medium', 'operational', 'generic', q.opened_at + interval '48 hours');
end;
$$;

-- High when the leave starts within 3 days; due before its first day, and
-- within 48 h of the request at the latest.
create or replace function chat.work_task_raise_leave_decision(p_request uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q       chat.teacher_leave_request;
  v_owner uuid;
begin
  select * into q from chat.teacher_leave_request where id = p_request;
  if q.id is null or q.state <> 'requested' or q.requested_at < chat.work_task_since('leave_decision') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(q.teacher_id);
  if v_owner is null then
    perform chat.work_task_note_issue(q.organization_id, 'leave_decision:' || q.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(q.organization_id, 'leave_decision', q.id, v_owner, null,
                              case when q.first_day <= chat.academy_today() + 3 then 'high' else 'medium' end,
                              'operational', 'generic',
                              least(q.requested_at + interval '48 hours', chat.work_task_end_of_day(q.first_day - 1)));
end;
$$;

create or replace function chat.work_task_raise_violation_decision(p_violation uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v       chat.teacher_violation;
  v_owner uuid;
begin
  select * into v from chat.teacher_violation where id = p_violation;
  if v.id is null or v.decision is not null or v.recorded_at < chat.work_task_since('violation_decision')
     or not chat.work_task_violation_stands(v.id) then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(v.teacher_id);
  if v_owner is null then
    perform chat.work_task_note_issue(v.organization_id, 'violation_decision:' || v.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(v.organization_id, 'violation_decision', v.id, v_owner, null,
                              'medium', 'operational', 'generic', v.recorded_at + interval '72 hours');
end;
$$;

-- The case's owner while live, else its target department's live manager.
create or replace function chat.work_task_case_assignee(p_case uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select o.id from chat.staff o where o.id = c.owner_id and o.is_active and o.left_at is null),
    (select m.id from chat.staff m where m.id = d.manager_id and m.is_active and m.left_at is null))
    from chat.supervision_case c join chat.department d on d.id = c.target_department_id
   where c.id = p_case;
$$;

create or replace function chat.work_task_raise_case(p_case uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  c        chat.supervision_case;
  v_owner  uuid;
begin
  select * into c from chat.supervision_case where id = p_case;
  if c.id is null or c.status not in ('open', 'in_progress') or c.created_at < chat.work_task_since('case') then
    return null;
  end if;
  v_owner := chat.work_task_case_assignee(c.id);
  if v_owner is null then
    perform chat.work_task_note_issue(c.organization_id, 'case:' || c.id, 'neither the case''s owner nor its department''s manager is active');
    return null;
  end if;
  return chat.work_task_raise(c.organization_id, 'case', c.id, v_owner, null, 'medium', 'operational', 'generic',
                              case when c.due_on is not null then chat.work_task_end_of_day(c.due_on) end);
end;
$$;

-- ===========================================================================
-- 4. The sweep: create what is missing, reconcile what is done
-- ===========================================================================

-- Run by the worker every minute, in batches: at most p_batch (capped at 60)
-- rows per call, each its own subtransaction, so one call never overflows the
-- 64 cached subtransactions; `more` says another batch is waiting. Only one
-- sweep runs at a time (an advisory lock); a second returns skipped. A row
-- with a recorded issue waits for its back-off. Returns the counts.
create or replace function chat.work_task_sweep(p_batch integer default 50)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_left      integer := least(greatest(coalesce(p_batch, 50), 1), 60);
  v_raised    integer := 0;
  v_settled   integer := 0;
  v_withdrawn integer := 0;
  v_rerouted  integer := 0;
  v_failed    integer := 0;
  v_more      boolean := false;
  v_n         integer;
  r           record;
  s_lesson    timestamptz;
  s_corr      timestamptz;
  s_ruling    timestamptz;
  s_leave     timestamptz;
  s_violation timestamptz;
  s_case      timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_lesson := chat.work_task_since('lesson_report');
  s_corr := chat.work_task_since('report_correction');
  s_ruling := chat.work_task_since('lesson_ruling');
  s_leave := chat.work_task_since('leave_decision');
  s_violation := chat.work_task_since('violation_decision');
  s_case := chat.work_task_since('case');

  -- Create: occurrences with no task yet, and no back-off running.
  for r in
    select x.org, x.src, x.id from (
      select l.organization_id as org, 'lesson_report' as src, l.id, l.ends_at as at from chat.lesson l
       where l.outcome is null and l.learner_id is not null and l.ends_at <= now()
         and l.ends_at >= s_lesson
      union all
      select q.organization_id, 'report_correction', q.id, q.requested_at from chat.report_correction_request q
       where q.resolution is null and q.requested_at >= s_corr
      union all
      select q.organization_id, 'lesson_ruling', q.id, q.opened_at from chat.lesson_ruling q
       where q.decision is null and q.opened_at >= s_ruling
      union all
      select q.organization_id, 'leave_decision', q.id, q.requested_at from chat.teacher_leave_request q
       where q.state = 'requested' and q.requested_at >= s_leave
      union all
      select q.organization_id, 'violation_decision', q.id, q.recorded_at from chat.teacher_violation q
       where q.decision is null and q.recorded_at >= s_violation
      union all
      select q.organization_id, 'case', q.id, q.created_at from chat.supervision_case q
       where q.status in ('open', 'in_progress') and q.created_at >= s_case
    ) x
     where not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.src || ':' || x.id)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.src || ':' || x.id and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if (case r.src
            when 'lesson_report' then chat.work_task_raise_lesson_report(r.id)
            when 'report_correction' then chat.work_task_raise_report_correction(r.id)
            when 'lesson_ruling' then chat.work_task_raise_lesson_ruling(r.id)
            when 'leave_decision' then chat.work_task_raise_leave_decision(r.id)
            when 'violation_decision' then chat.work_task_raise_violation_decision(r.id)
            when 'case' then chat.work_task_raise_case(r.id)
          end) is not null then
        v_raised := v_raised + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.src || ':' || r.id, sqlerrm);
    end;
  end loop;

  -- Reconcile: positive evidence only, re-read now.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key,
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
               when 'violation_decision' then (select case when q.decision is not null then 'done'
                                                          when not chat.work_task_violation_stands(q.id) then 'gone' end
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
    ) y
     where y.verdict = 'gone' or (y.verdict = 'done' and y.actor is not null)
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if r.verdict = 'done' then
        v_n := chat.work_task_settle(r.org, r.key, r.actor);
        v_settled := v_settled + v_n;
      else
        v_n := chat.work_task_withdraw(r.org, r.key);
        v_withdrawn := v_withdrawn + v_n;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- Owners: a case's task follows its (live) owner, else its department's
  -- manager; a lesson report follows the lesson's teacher.
  for r in
    select t.organization_id as org, t.source_key as key,
           case t.source_type when 'case' then chat.work_task_case_assignee(t.source_id) end as staff_id,
           case t.source_type when 'lesson_report' then (select l.teacher_id from chat.lesson l where l.id = t.source_id) end as teacher_id,
           case t.source_type when 'case' then
             (select e.actor_id from chat.supervision_case_event e
               where e.case_id = t.source_id and e.kind in ('assigned', 'opened') order by e.at desc limit 1) end as actor
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and ((t.source_type = 'case'
             and chat.work_task_case_assignee(t.source_id) is not null
             and t.assignee_staff_id is distinct from chat.work_task_case_assignee(t.source_id))
         or (t.source_type = 'lesson_report'
             and t.assignee_teacher_id is distinct from (select l.teacher_id from chat.lesson l where l.id = t.source_id)))
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      -- A departed owner leaves no actor of the move: then it is the system's.
      v_n := chat.work_task_reroute(r.org, r.key, r.staff_id, r.teacher_id,
                                    case when r.staff_id is not null and chat.task_principal_any(r.actor, r.org) is not null then r.actor end);
      v_rerouted := v_rerouted + v_n;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'rerouted', v_rerouted, 'failed', v_failed, 'more', v_more,
                            'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 5. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================
--
-- One function per table. Each runs its task work in a subtransaction: a
-- failure is recorded (chat.work_task_note_issue), warned once, and left to
-- the sweep; the source's own write always goes through. Each fires only when
-- the column it reads changed (WHEN).

create or replace function chat.work_task_from_lesson()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v record;
begin
  begin
    if old.outcome is null and new.outcome is not null then
      if new.outcome in ('held', 'student_no_show') then
        perform chat.work_task_settle(new.organization_id, 'lesson_report:' || new.id, new.outcome_by);
      else
        perform chat.work_task_withdraw(new.organization_id, 'lesson_report:' || new.id);
      end if;
    end if;
    -- A lesson given to another teacher moves its report task (plan §3.2).
    if new.teacher_id is distinct from old.teacher_id then
      perform chat.work_task_reroute(new.organization_id, 'lesson_report:' || new.id, null, new.teacher_id, null);
    end if;
    -- An outcome corrected away withdraws its undecided violations' tasks (PD-15).
    if new.outcome is distinct from old.outcome then
      for v in select q.id from chat.teacher_violation q
                where q.lesson_id = new.id and q.decision is null and not chat.work_task_violation_stands(q.id)
      loop
        perform chat.work_task_withdraw(new.organization_id, 'violation_decision:' || v.id);
      end loop;
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'lesson_report:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger lesson_moves_its_tasks after update of outcome, teacher_id on chat.lesson
  for each row
  when (old.outcome is distinct from new.outcome or old.teacher_id is distinct from new.teacher_id)
  execute function chat.work_task_from_lesson();

create or replace function chat.work_task_from_report_correction()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_report_correction(new.id);
    elsif new.resolution in ('corrected', 'filed') then
      perform chat.work_task_settle(new.organization_id, 'report_correction:' || new.id, new.resolved_by);
    elsif new.resolution = 'withdrawn' then
      perform chat.work_task_withdraw(new.organization_id, 'report_correction:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'report_correction:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger report_correction_request_raises_its_task after insert on chat.report_correction_request
  for each row execute function chat.work_task_from_report_correction();
create trigger report_correction_request_settles_its_task after update of resolution on chat.report_correction_request
  for each row when (old.resolution is null and new.resolution is not null)
  execute function chat.work_task_from_report_correction();

create or replace function chat.work_task_from_lesson_ruling()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_lesson_ruling(new.id);
    else
      perform chat.work_task_settle(new.organization_id, 'lesson_ruling:' || new.id, new.decided_by);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'lesson_ruling:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger lesson_ruling_raises_its_task after insert on chat.lesson_ruling
  for each row execute function chat.work_task_from_lesson_ruling();
create trigger lesson_ruling_settles_its_task after update of decision on chat.lesson_ruling
  for each row when (old.decision is null and new.decision is not null)
  execute function chat.work_task_from_lesson_ruling();

create or replace function chat.work_task_from_leave_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_leave_decision(new.id);
    elsif new.state in ('approved', 'declined') then
      perform chat.work_task_settle(new.organization_id, 'leave_decision:' || new.id, new.decided_by);
    elsif new.state = 'withdrawn' then
      perform chat.work_task_withdraw(new.organization_id, 'leave_decision:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'leave_decision:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger teacher_leave_request_raises_its_task after insert on chat.teacher_leave_request
  for each row execute function chat.work_task_from_leave_request();
create trigger teacher_leave_request_settles_its_task after update of state on chat.teacher_leave_request
  for each row when (old.state = 'requested' and new.state is distinct from old.state)
  execute function chat.work_task_from_leave_request();

create or replace function chat.work_task_from_violation()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_violation_decision(new.id);
    else
      perform chat.work_task_settle(new.organization_id, 'violation_decision:' || new.id, new.decided_by);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'violation_decision:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger teacher_violation_raises_its_task after insert on chat.teacher_violation
  for each row execute function chat.work_task_from_violation();
create trigger teacher_violation_settles_its_task after update of decision on chat.teacher_violation
  for each row when (old.decision is null and new.decision is not null)
  execute function chat.work_task_from_violation();

-- A case: opened, assigned, re-dated, closed -- by the actor its own guard
-- already requires (chat.case_actor), read inside the subtransaction.
create or replace function chat.work_task_from_case()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid;
begin
  begin
    v_actor := nullif(current_setting('chat.case_actor', true), '')::uuid;
    if tg_op = 'INSERT' then
      perform chat.work_task_raise_case(new.id);
    elsif new.status in ('resolved', 'cancelled') and old.status in ('open', 'in_progress') then
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
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'case:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger supervision_case_raises_its_task after insert on chat.supervision_case
  for each row execute function chat.work_task_from_case();
create trigger supervision_case_moves_its_task after update of owner_id, status, due_on on chat.supervision_case
  for each row
  when (old.owner_id is distinct from new.owner_id or old.status is distinct from new.status or old.due_on is distinct from new.due_on)
  execute function chat.work_task_from_case();

-- The history may name the system as the actor of a reassignment: a source
-- moved its own owner (a lesson's teacher, a departed case owner).
alter table chat.work_task_event drop constraint work_task_event_system_kinds;
alter table chat.work_task_event add constraint work_task_event_system_kinds
  check (actor_kind <> 'system' or kind in ('created', 'source_withdrawn', 'source_raised', 'reassigned'));

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
    if new.created_by is null or new.created_by::text is distinct from v_actor then
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
  -- A lesson report and a correction are the lesson's teacher's, and a case's
  -- task follows the case's owner: only their source moves them (PR-2).
  if v_moved and old.kind = 'system' and old.source_type in ('lesson_report', 'report_correction', 'case') and not v_system then
    raise exception 'this task follows its source: change the lesson''s teacher or the case''s owner' using errcode = 'check_violation';
  end if;
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
            jsonb_build_object('dueAt', new.due_at, 'priority', new.priority, 'category', new.category));
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

alter table chat.work_task_source_issue enable row level security;
revoke all on chat.work_task_source_issue from public, anon, authenticated, chat_app;

revoke all on function chat.task_principal_any(uuid, uuid) from public;
revoke all on function chat.work_task_teacher_owner(uuid) from public;
revoke all on function chat.work_task_begin_system(uuid) from public;
revoke all on function chat.work_task_end_system(text[]) from public;
revoke all on function chat.work_task_signal(uuid, integer, text) from public;
revoke all on function chat.work_task_note_issue(uuid, text, text) from public;
revoke all on function chat.work_task_since(text) from public;
revoke all on function chat.work_task_raise(uuid, text, uuid, uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function chat.work_task_settle(uuid, text, uuid) from public;
revoke all on function chat.work_task_withdraw(uuid, text) from public;
revoke all on function chat.work_task_reroute(uuid, text, uuid, uuid, uuid) from public;
revoke all on function chat.work_task_redate(uuid, text, timestamptz, uuid) from public;
revoke all on function chat.work_task_end_of_day(date) from public;
revoke all on function chat.work_task_violation_stands(uuid) from public;
revoke all on function chat.work_task_raise_lesson_report(uuid) from public;
revoke all on function chat.work_task_raise_report_correction(uuid) from public;
revoke all on function chat.work_task_raise_lesson_ruling(uuid) from public;
revoke all on function chat.work_task_raise_leave_decision(uuid) from public;
revoke all on function chat.work_task_raise_violation_decision(uuid) from public;
revoke all on function chat.work_task_case_assignee(uuid) from public;
revoke all on function chat.work_task_raise_case(uuid) from public;
revoke all on function chat.work_task_sweep(integer) from public;
revoke all on function chat.work_task_from_lesson() from public;
revoke all on function chat.work_task_from_report_correction() from public;
revoke all on function chat.work_task_from_lesson_ruling() from public;
revoke all on function chat.work_task_from_leave_request() from public;
revoke all on function chat.work_task_from_violation() from public;
revoke all on function chat.work_task_from_case() from public;
revoke all on function chat.guard_work_task() from public;
revoke all on function chat.record_work_task_event() from public;
revoke all on function chat.guard_work_task_event() from public;
