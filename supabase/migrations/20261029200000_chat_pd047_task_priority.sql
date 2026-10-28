-- PD-47 priority amendment (2026-10-28), PR-1b -- task priority, category and urgency.
--
-- Plan: docs/product/pd047-amendment-priority.md (revision 2, APPROVED by the
-- owner 2026-10-28). Builds on 20261029160000_chat_pd047_work_tasks.sql.
--
-- WHAT IS NEW
--
--   chat.work_task.priority      the MANUAL level (high | medium | low), set by
--                                the creator, changed by a decider; recorded as
--                                priority_changed
--   chat.work_task.category      financial | operational, fixed at creation;
--                                financial sorts first inside each colour
--   chat.work_task.floor_rule    how the due date raises the level: generic
--                                (overdue or 24 h -> high, 3 days -> medium),
--                                overdue_only (routine work: medium until
--                                overdue), instalment (D-7 medium, D0 high, on
--                                the academy's calendar), none; fixed at creation
--   chat.work_task.source_floor  a level a source raises the task to (the
--                                package balance, PR-2b); null here
--   chat.work_task_effective     the EFFECTIVE level, computed at read time from
--                                the above, the due date and a reference time.
--                                Never stored, so it cannot go stale.
--
-- The guard and the history trigger are redefined: a priority change is a
-- recorded change, and category, floor rule and source floor never change by
-- hand. Everything else is exactly 20261029160000's.
--
-- FAIL CLOSED: the tables keep their RLS and revoked grants. Every function
-- pins its search_path.

-- ===========================================================================
-- 1. The columns
-- ===========================================================================

alter table chat.work_task
  add column priority     text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  add column category     text not null default 'operational' check (category in ('financial', 'operational')),
  add column floor_rule   text not null default 'generic' check (floor_rule in ('generic', 'overdue_only', 'instalment', 'none')),
  add column source_floor text check (source_floor is null or source_floor in ('high', 'medium'));

alter table chat.work_task
  add constraint work_task_manual_floor check (kind <> 'manual' or (floor_rule = 'generic' and source_floor is null));

-- The sort reads pending rows in due order; the effective level is computed on them.
create index work_task_pending_due_idx on chat.work_task (organization_id, due_at nulls last, created_at, id)
  where state in ('open', 'awaiting_decision');
create index work_task_staff_pending_due_idx on chat.work_task (assignee_staff_id, due_at nulls last, created_at)
  where state in ('open', 'awaiting_decision');
create index work_task_teacher_pending_due_idx on chat.work_task (assignee_teacher_id, due_at nulls last, created_at)
  where state in ('open', 'awaiting_decision');

-- ===========================================================================
-- 2. The effective level
-- ===========================================================================

-- The academy's time zone (the same "today" as chat.academy_today()).
create or replace function chat.work_task_academy_zone()
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce((select c.value #>> '{}' from chat.config c where c.key = 'schedule.timezone'), 'Africa/Cairo');
$$;

-- The effective level of a task at p_as_of: the highest of its manual level,
-- what its floor rule gives, and its source floor. Pending tasks only; a
-- closed task shows its manual level. Measured to the minute (owner Q-P2),
-- except the instalment rule, which counts the academy's calendar days.
--   rank    3 high | 2 medium | 1 low
--   reason  manual | due_soon | overdue | source -- whatever raised it
create or replace function chat.work_task_effective(
  p_priority text, p_floor_rule text, p_due_at timestamptz, p_source_floor text, p_state text,
  p_as_of timestamptz, p_zone text,
  out rank integer, out level text, out reason text)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_date   integer := 0;
  v_why    text;
  v_source integer := case p_source_floor when 'high' then 3 when 'medium' then 2 else 0 end;
  v_day0   timestamptz;
begin
  rank := case p_priority when 'high' then 3 when 'medium' then 2 else 1 end;
  reason := 'manual';
  if p_state in ('open', 'awaiting_decision') then
    if p_floor_rule = 'generic' and p_due_at is not null then
      if p_due_at < p_as_of then
        v_date := 3; v_why := 'overdue';
      elsif p_due_at <= p_as_of + interval '24 hours' then
        v_date := 3; v_why := 'due_soon';
      elsif p_due_at <= p_as_of + interval '72 hours' then
        v_date := 2; v_why := 'due_soon';
      end if;
    elsif p_floor_rule = 'overdue_only' then
      -- Routine work (lesson reports and their kin): Yellow while pending, Red
      -- only once overdue (owner 2026-10-28).
      if p_due_at is not null and p_due_at < p_as_of then
        v_date := 3; v_why := 'overdue';
      else
        v_date := 2; v_why := 'due_soon';
      end if;
    elsif p_floor_rule = 'instalment' and p_due_at is not null then
      -- due_at is the start of the due day (D0) in the academy's zone.
      v_day0 := p_due_at;
      if p_as_of >= ((v_day0 at time zone p_zone) + interval '1 day') at time zone p_zone then
        v_date := 3; v_why := 'overdue';
      elsif p_as_of >= v_day0 then
        v_date := 3; v_why := 'due_soon';
      elsif p_as_of >= ((v_day0 at time zone p_zone) - interval '7 days') at time zone p_zone then
        v_date := 2; v_why := 'due_soon';
      end if;
    end if;
    if v_date > rank then
      rank := v_date; reason := v_why;
    end if;
    if v_source > rank then
      rank := v_source; reason := 'source';
    end if;
  end if;
  level := case rank when 3 then 'high' when 2 then 'medium' else 'low' end;
end;
$$;

-- ===========================================================================
-- 3. The history: priority_changed, and source_raised for PR-2b
-- ===========================================================================

alter table chat.work_task_event drop constraint work_task_event_kind_check;
alter table chat.work_task_event add constraint work_task_event_kind_check check (kind in (
  'created', 'reassigned', 'commented', 'out_of_scope', 'returned',
  'completed', 'removed', 'due_changed', 'source_withdrawn', 'priority_changed', 'source_raised'));
alter table chat.work_task_event drop constraint work_task_event_system_kinds;
alter table chat.work_task_event add constraint work_task_event_system_kinds
  check (actor_kind <> 'system' or kind in ('created', 'source_withdrawn', 'source_raised'));

-- ===========================================================================
-- 4. The guard and the history trigger, redefined
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
begin
  if tg_op = 'DELETE' then
    raise exception 'a task is never deleted; it is completed, removed or reassigned' using errcode = 'check_violation';
  end if;
  if v_actor is null then
    raise exception 'a task changes only with its actor named (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  v_org := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  if chat.task_principal_kind(v_actor::uuid, v_org) is null then
    raise exception 'a task is changed by a live person of its organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(new.assignee_staff_id, new.assignee_teacher_id) <> 1 then
    raise exception 'a task is assigned to exactly one person' using errcode = 'check_violation';
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
  if (new.id, new.organization_id, new.kind, new.source_type, new.source_id, new.source_key, new.source_state,
      new.source_floor, new.category, new.floor_rule, new.title, new.body, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.kind, old.source_type, old.source_id, old.source_key, old.source_state,
      old.source_floor, old.category, old.floor_rule, old.title, old.body, old.created_by, old.created_at) then
    raise exception 'a task''s what, source and creator never change' using errcode = 'check_violation';
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
          or new.priority is distinct from old.priority) then
    if not (pg_trigger_depth() > 1 and new.activity_at is distinct from old.activity_at
            and new.instructions is not distinct from old.instructions) then
      raise exception 'a task changes only with a recorded event' using errcode = 'check_violation';
    end if;
  end if;

  -- activity_at is the task's last event: a comment sets it (from its own
  -- trigger), every other recorded change here.
  if v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
     or new.priority is distinct from old.priority then
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
  v_actor  uuid := current_setting('chat.task_actor', true)::uuid;
  v_note   text := nullif(btrim(coalesce(current_setting('chat.task_note', true), '')), '');
  v_kind   text := chat.task_principal_kind(v_actor, new.organization_id);
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

revoke all on function chat.work_task_academy_zone() from public;
revoke all on function chat.work_task_effective(text, text, timestamptz, text, text, timestamptz, text) from public;
revoke all on function chat.guard_work_task() from public;
revoke all on function chat.record_work_task_event() from public;
