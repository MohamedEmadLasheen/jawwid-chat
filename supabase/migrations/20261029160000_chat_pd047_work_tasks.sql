-- PD-47 (2026-10-28), PR-1 -- tasks: one durable record per responsibility.
--
-- Plan: docs/product/pd047-tasks-plan.md (APPROVED, owner Q1-Q13).
--
-- WHAT IS NEW
--
--   chat.work_task        one task, assigned to exactly one person (a staff
--                         member or a teacher). Pending while open or
--                         awaiting_decision; completed and removed are final.
--                         It leaves a person's list only by the owner's four
--                         exits: completed; out of scope, then a decision
--                         (removed, returned with instructions, reassigned);
--                         removed; reassigned. Never deleted.
--   chat.work_task_event  the task's history. Every change of the task row is
--                         written HERE, in the same transaction, with the actor
--                         the API names (chat.task_actor) and its reason or
--                         instructions (chat.task_note); a change with no live
--                         actor is refused. Comments are events too.
--                         Append-only.
--
-- NOT chat.task. The legacy table is frozen by PD-4 and still read by
-- chat.staff_can_see_family: a row there would widen who sees a family. This
-- migration neither reads nor writes it.
--
-- Who may create, see and decide is the API's (src/tasks), through
-- chat.work_task_standing below. The database keeps what it can know by
-- itself: one organization, live people, the four exits, the history.
--
-- PR-1 creates manual tasks only. System tasks (kind 'system', keyed by their
-- source) arrive with PR-2, which redefines the guard's insert branch.
--
-- EVERY CHANGE IS AN EVENT. The guard refuses an update that would write no
-- history (an instructions, source or activity change on its own); a comment
-- is the one event written directly, and it touches the task through a
-- trigger. Neither table may be truncated, except by the integration harness,
-- which says so (chat.test_truncate).
--
-- FAIL CLOSED. RLS on, no grant to any request role. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. The catalogue (PD-40)
-- ===========================================================================
select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd047 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('tasks.team', 'tasks', 'team', 'See the team''s tasks', 'عرض مهام الفريق', 'pii', false, 'PD-47'),
  ('tasks.create', 'tasks', 'create', 'Give tasks', 'إسناد المهام', 'pii', false, 'PD-47'),
  ('tasks.manage', 'tasks', 'manage', 'Remove, return and reassign tasks', 'حذف المهام وإعادتها وإعادة إسنادها', 'pii', false, 'PD-47');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'operations', 'tasks.create'),
  ('manager', 'operations', 'tasks.manage'),
  ('manager', 'operations', 'tasks.team'),
  ('manager', 'teachers', 'tasks.create'),
  ('manager', 'teachers', 'tasks.manage'),
  ('manager', 'teachers', 'tasks.team'),
  ('manager', 'sales', 'tasks.create'),
  ('manager', 'sales', 'tasks.manage'),
  ('manager', 'sales', 'tasks.team'),
  ('supervisor', 'teachers', 'tasks.create'),
  ('supervisor', 'teachers', 'tasks.team');
-- END GENERATED pd047 catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);

-- ===========================================================================
-- 2. Who a principal is, and where a viewer stands to an assignee
-- ===========================================================================

-- 'staff' or 'teacher' when p_id is a live person of p_org; null otherwise.
create or replace function chat.task_principal_kind(p_id uuid, p_org uuid)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
    when exists (select 1 from chat.staff s
                  where s.id = p_id and s.organization_id = p_org and s.is_active and s.left_at is null) then 'staff'
    when exists (select 1 from chat.teacher t
                  where t.id = p_id and t.organization_id = p_org and t.is_active and t.left_at is null) then 'teacher'
  end;
$$;

-- Where live staff p_viewer stands to a task assigned to p_staff or p_teacher
-- and created by p_creator, decided live, every time:
--   super_admin  the super admin of the organization: everything
--   manager      a responsible manager: the manager of the department the
--                assigned staff member belongs to; for a teacher, the
--                Teachers manager (PD-35's teacher scope); and the manager who
--                created the task (plan §3.7), wherever it went since
--   supervisor   the teacher's PD-35 supervisor (or their active backup):
--                sees the teacher's tasks, decides nothing (owner Q3)
--   null         nothing (the assignee's own standing is the API's)
create or replace function chat.work_task_standing(p_viewer uuid, p_org uuid, p_staff uuid, p_teacher uuid, p_creator uuid)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
    when v.role = 'super_admin' then 'super_admin'
    when p_staff is not null and exists (
      select 1 from chat.department_member m
        join chat.department d on d.id = m.department_id
       where m.staff_id = p_staff and d.manager_id = p_viewer and d.organization_id = p_org) then 'manager'
    when p_creator = p_viewer and v.role = 'manager' then 'manager'
    when p_teacher is not null then
      case chat.staff_teacher_scope(p_viewer, p_teacher)
        when 'manager' then 'manager'
        when 'self' then 'supervisor'
        when 'backup' then 'supervisor'
      end
  end
  from chat.staff v
  where v.id = p_viewer and v.organization_id = p_org and v.is_active and v.left_at is null;
$$;

-- No live manager stands to the task: nobody but the super admin may remove,
-- return or reassign it. The assignee left their department, its manager is
-- not live, the assignee is a manager, or (for a teacher) the Teachers
-- department has no live manager -- and no live manager created it.
create or replace function chat.work_task_unmanaged(p_org uuid, p_staff uuid, p_teacher uuid, p_creator uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select not (
    (p_staff is not null and exists (
      select 1 from chat.department_member m
        join chat.department d on d.id = m.department_id and d.organization_id = p_org
        join chat.staff mg on mg.id = d.manager_id and mg.is_active and mg.left_at is null
       where m.staff_id = p_staff))
    or (p_teacher is not null and exists (
      select 1 from chat.department d
        join chat.staff mg on mg.id = d.manager_id and mg.is_active and mg.left_at is null
       where d.organization_id = p_org and d.kind = 'teachers'))
    or (p_creator is not null and exists (
      select 1 from chat.staff c
       where c.id = p_creator and c.organization_id = p_org and c.role = 'manager' and c.is_active and c.left_at is null))
  );
$$;

-- ===========================================================================
-- 3. The task
-- ===========================================================================

create table chat.work_task (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references chat.organization (id),
  kind                 text not null check (kind in ('manual', 'system')),
  -- System tasks (PR-2): what made the task. The key is unique for ever, so a
  -- source makes its task at most once and a removed one is never re-made.
  source_type          text,
  source_id            uuid,
  source_key           text,
  source_state         text check (source_state is null or source_state in ('pending', 'withdrawn')),
  assignee_staff_id    uuid references chat.staff (id),
  assignee_teacher_id  uuid references chat.teacher (id),
  state                text not null default 'open'
                         check (state in ('open', 'awaiting_decision', 'completed', 'removed')),
  outcome              text check (outcome is null or outcome in ('done', 'acknowledged')),
  -- Manual tasks: written by their creator. A system task's title is rendered
  -- from its source at read time.
  title                text check (title is null or length(btrim(title)) between 1 and 200),
  body                 text check (body is null or length(body) <= 4000),
  due_at               timestamptz,
  -- The latest "returned with instructions" (or reassignment note); every
  -- version is in the history.
  instructions         text check (instructions is null or length(instructions) <= 2000),
  created_by           uuid references chat.staff (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- The last thing that happened, a comment included: the list's freshness.
  activity_at          timestamptz not null default now(),
  -- Who completed or removed it (staff or teacher), when and why.
  closed_by            uuid,
  closed_at            timestamptz,
  close_reason         text check (close_reason is null or length(close_reason) <= 2000),
  -- Bumped by the guard on every change: the realtime signal's order (PD-46 §3.2).
  revision             integer not null default 1,
  constraint work_task_one_assignee check (num_nonnulls(assignee_staff_id, assignee_teacher_id) = 1),
  constraint work_task_closed_shape check ((state in ('completed', 'removed')) = (closed_at is not null)),
  constraint work_task_outcome_shape check ((state = 'completed') = (outcome is not null)),
  constraint work_task_manual_shape check (kind <> 'manual' or (title is not null and created_by is not null and source_key is null)),
  constraint work_task_system_shape check (kind <> 'system' or (source_type is not null and source_key is not null and source_state is not null)),
  constraint work_task_source_once unique (organization_id, source_key)
);

comment on table chat.work_task is
  'PD-47: a task, assigned to one staff member or teacher. Never deleted; history in work_task_event. NOT the frozen legacy chat.task.';

create index work_task_staff_pending_idx on chat.work_task (assignee_staff_id, created_at desc)
  where state in ('open', 'awaiting_decision');
create index work_task_teacher_pending_idx on chat.work_task (assignee_teacher_id, created_at desc)
  where state in ('open', 'awaiting_decision');
create index work_task_decision_idx on chat.work_task (organization_id, created_at desc) where state = 'awaiting_decision';
create index work_task_org_idx on chat.work_task (organization_id, created_at desc, id desc);
create index work_task_org_pending_idx on chat.work_task (organization_id, created_at desc)
  where state in ('open', 'awaiting_decision');
create index work_task_closed_idx on chat.work_task (organization_id, closed_at desc) where closed_at is not null;

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
  -- source_state changes with PR-2's sources, which record source_withdrawn.
  if (new.id, new.organization_id, new.kind, new.source_type, new.source_id, new.source_key, new.source_state,
      new.title, new.body, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.kind, old.source_type, old.source_id, old.source_key, old.source_state,
      old.title, old.body, old.created_by, old.created_at) then
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
  -- Every change is recorded: a move, a state, a due date -- or a comment,
  -- whose event touches the task from its own trigger (activity_at only).
  if not (v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at) then
    if not (pg_trigger_depth() > 1 and new.activity_at is distinct from old.activity_at
            and new.instructions is not distinct from old.instructions) then
      raise exception 'a task changes only with a recorded event' using errcode = 'check_violation';
    end if;
  end if;

  -- activity_at is the task's last event: a comment sets it (from its own
  -- trigger), every other recorded change here.
  if v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at then
    new.activity_at := now();
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger work_task_is_coherent
  before insert or update or delete on chat.work_task
  for each row execute function chat.guard_work_task();

-- Neither table is ever truncated. The integration harness truncates chat.staff
-- ... CASCADE before every suite, which reaches both; it says so, in its own
-- transaction (chat.test_truncate = 'on').
create or replace function chat.guard_work_task_truncate()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
    return null;
  end if;
  raise exception 'tasks and their history are never truncated (a test''s cleanup sets chat.test_truncate in its transaction)' using errcode = 'check_violation';
end;
$$;

create trigger work_task_no_truncate before truncate on chat.work_task
  for each statement execute function chat.guard_work_task_truncate();

-- ===========================================================================
-- 4. The history
-- ===========================================================================

create table chat.work_task_event (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references chat.work_task (id),
  organization_id  uuid not null references chat.organization (id),
  kind             text not null check (kind in (
                     'created', 'reassigned', 'commented', 'out_of_scope', 'returned',
                     'completed', 'removed', 'due_changed', 'source_withdrawn')),
  actor_kind       text not null check (actor_kind in ('staff', 'teacher', 'system')),
  actor_id         uuid,
  from_assignee    uuid,
  to_assignee      uuid,
  body             text check (body is null or length(btrim(body)) between 1 and 4000),
  before           jsonb,
  after            jsonb,
  at               timestamptz not null default clock_timestamp(),
  constraint work_task_event_actor_shape check ((actor_kind = 'system') = (actor_id is null)),
  -- Only a task's creation and its source going away may be the system's: every exit names a person.
  constraint work_task_event_system_kinds check (actor_kind <> 'system' or kind in ('created', 'source_withdrawn')),
  constraint work_task_event_comment_has_text check (kind <> 'commented' or body is not null)
);

create index work_task_event_task_idx on chat.work_task_event (task_id, at, id);
create index work_task_event_actor_idx on chat.work_task_event (actor_id, at desc) where actor_id is not null;

create trigger work_task_event_is_append_only before update or delete on chat.work_task_event
  for each row execute function chat.forbid_change();

-- An event is written by a live person of the task's organization, named as
-- such. Only a comment is written directly, by the actor the API names; every
-- other kind comes from chat.record_work_task_event (a nested trigger).
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
  if new.actor_kind <> 'system' and chat.task_principal_kind(new.actor_id, v_org) is distinct from new.actor_kind then
    raise exception 'a task event is written by a live person of its organization (actor)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger work_task_event_has_a_live_actor before insert on chat.work_task_event
  for each row execute function chat.guard_work_task_event();

create trigger work_task_event_no_truncate before truncate on chat.work_task_event
  for each statement execute function chat.guard_work_task_truncate();

-- A comment is the task's latest activity: it touches the task (activity_at,
-- and so its revision), which the guard allows only from here.
create or replace function chat.touch_work_task_on_comment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.kind = 'commented' then
    update chat.work_task set activity_at = new.at where id = new.task_id;
  end if;
  return new;
end;
$$;

create trigger work_task_event_touches_its_task after insert on chat.work_task_event
  for each row execute function chat.touch_work_task_on_comment();

-- One event per change, in the transaction that made it, with the note
-- (comment, reason or instructions) the API set in chat.task_note.
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
  if new.due_at is distinct from old.due_at then
    insert into chat.work_task_event (task_id, organization_id, kind, actor_kind, actor_id, to_assignee, before, after)
    values (new.id, new.organization_id, 'due_changed', v_kind, v_actor, v_to,
            jsonb_build_object('dueAt', old.due_at), jsonb_build_object('dueAt', new.due_at));
  end if;
  return new;
end;
$$;

create trigger work_task_records_its_events
  after insert or update on chat.work_task
  for each row execute function chat.record_work_task_event();

-- ===========================================================================
-- 5. Fail closed
-- ===========================================================================

alter table chat.work_task       enable row level security;
alter table chat.work_task_event enable row level security;

revoke all on chat.work_task, chat.work_task_event from public, anon, authenticated, chat_app;

revoke all on function chat.task_principal_kind(uuid, uuid) from public;
revoke all on function chat.work_task_standing(uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function chat.work_task_unmanaged(uuid, uuid, uuid, uuid) from public;
revoke all on function chat.guard_work_task() from public;
revoke all on function chat.guard_work_task_truncate() from public;
revoke all on function chat.guard_work_task_event() from public;
revoke all on function chat.touch_work_task_on_comment() from public;
revoke all on function chat.record_work_task_event() from public;
