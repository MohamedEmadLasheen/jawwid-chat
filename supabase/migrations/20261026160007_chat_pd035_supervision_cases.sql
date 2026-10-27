-- PD-35 (2026-10-27), B5 -- escalation cases.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- WHAT IS NEW
--
--   chat.supervision_case  something a supervisor cannot settle alone, escalated
--                          to the Teachers or the Operations department: about a
--                          teacher, a lesson, a learner, a complaint or a parent's
--                          feedback (the subject), with an owner (by default the
--                          department's manager), a due date and a status
--                          (open -> in_progress -> resolved | cancelled).
--                          Never deleted; a closed case stays closed.
--   chat.supervision_case_event
--                          the case's history. Every change of the case row is one
--                          event, written HERE in the same transaction, with the
--                          actor the API names (chat.case_actor); a change with no
--                          actor is refused. Notes are events too. Append-only.
--   chat.supervision_case_due_notice
--                          "due soon" was announced for this due date (PD-34
--                          delivers it; B5 only enqueues case.due_soon once per
--                          date).
--
-- Who may open, see and act is the API's (src/cases): the subject's scope is
-- PD-35's teacher scope and the PD-11 lesson standing. The database keeps what
-- it can know by itself: one organization, a subject that exists, an owner
-- inside the target department, the history.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. The case
-- ===========================================================================

create table chat.supervision_case (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references chat.organization (id),
  subject_kind          text not null check (subject_kind in ('teacher', 'lesson', 'learner', 'complaint', 'feedback')),
  subject_id            uuid not null,
  -- Derived from the subject by the guard: who the case is about.
  teacher_id            uuid references chat.teacher (id),
  learner_id            uuid references chat.learner (id),
  target_department_id  uuid not null references chat.department (id),
  title                 text not null check (length(btrim(title)) between 1 and 200),
  body                  text check (body is null or length(body) <= 4000),
  owner_id              uuid references chat.staff (id),
  due_on                date,
  status                text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  opened_by             uuid not null references chat.staff (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  closed_at             timestamptz,
  constraint supervision_case_closed_shape check ((closed_at is not null) = (status in ('resolved', 'cancelled')))
);

comment on table chat.supervision_case is
  'PD-35 B5: an escalation case to the Teachers or Operations department. Never deleted; history in supervision_case_event.';

create index supervision_case_owner_idx on chat.supervision_case (owner_id, status);
create index supervision_case_target_idx on chat.supervision_case (target_department_id, status);
create index supervision_case_opener_idx on chat.supervision_case (opened_by, created_at desc);
create index supervision_case_due_idx on chat.supervision_case (due_on) where status in ('open', 'in_progress');

-- May `p_staff` own a case sent to `p_department`? Its manager, or an active
-- member of it, of the same organization.
create or replace function chat.case_owner_fits(p_staff uuid, p_department uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from chat.department d
      join chat.staff s on s.id = p_staff and s.organization_id = d.organization_id
                       and s.is_active and s.left_at is null
     where d.id = p_department
       and (d.manager_id = p_staff
            or exists (select 1 from chat.department_member m
                        where m.department_id = d.id and m.staff_id = p_staff))
  );
$$;

create or replace function chat.guard_supervision_case()
returns trigger
language plpgsql
as $$
declare
  v_actor  text := nullif(current_setting('chat.case_actor', true), '');
  v_org    uuid;
  v_teach  uuid;
  v_learn  uuid;
  v_kind   text;
begin
  if tg_op = 'DELETE' then
    raise exception 'a case is never deleted; it is cancelled' using errcode = 'check_violation';
  end if;
  if v_actor is null then
    raise exception 'a case changes only with its actor named (chat.case_actor)' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if (new.id, new.organization_id, new.subject_kind, new.subject_id, new.teacher_id, new.learner_id,
        new.target_department_id, new.title, new.body, new.opened_by, new.created_at)
       is distinct from
       (old.id, old.organization_id, old.subject_kind, old.subject_id, old.teacher_id, old.learner_id,
        old.target_department_id, old.title, old.body, old.opened_by, old.created_at) then
      raise exception 'only a case''s owner, due date and status change' using errcode = 'check_violation';
    end if;
    if old.status in ('resolved', 'cancelled') then
      raise exception 'a closed case stays closed' using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status then
      if not (old.status = 'open' and new.status in ('in_progress', 'resolved', 'cancelled')
              or old.status = 'in_progress' and new.status in ('resolved', 'cancelled')) then
        raise exception 'a case moves open -> in_progress -> resolved | cancelled' using errcode = 'check_violation';
      end if;
    end if;
    new.closed_at := case when new.status in ('resolved', 'cancelled') then now() end;
  else
    -- The subject exists, and decides the organization and who it is about.
    case new.subject_kind
      when 'teacher' then
        select organization_id, id, null into v_org, v_teach, v_learn from chat.teacher where id = new.subject_id;
      when 'lesson' then
        select organization_id, teacher_id, learner_id into v_org, v_teach, v_learn from chat.lesson where id = new.subject_id;
      when 'learner' then
        select organization_id, teacher_id, id into v_org, v_teach, v_learn from chat.learner where id = new.subject_id;
      when 'complaint' then
        select organization_id, teacher_id, null into v_org, v_teach, v_learn
          from chat.teacher_supervision_entry where id = new.subject_id and kind = 'complaint';
      when 'feedback' then -- a parent's feedback (PD-32)
        select organization_id, teacher_id, learner_id into v_org, v_teach, v_learn from chat.parent_feedback where id = new.subject_id;
      else
        v_org := null; -- an unknown kind; its CHECK runs after this trigger
    end case;
    if v_org is null then
      raise exception 'a case is about something that exists' using errcode = 'foreign_key_violation';
    end if;
    select kind into v_kind from chat.department where id = new.target_department_id and organization_id = v_org;
    if v_kind not in ('teachers', 'operations') or v_kind is null then
      raise exception 'a case goes to the Teachers or the Operations department of its organization' using errcode = 'check_violation';
    end if;
    if new.opened_by::text <> v_actor then
      raise exception 'a case is opened by its actor' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'open' then
      raise exception 'a case is opened open' using errcode = 'check_violation';
    end if;
    new.organization_id := v_org;
    new.teacher_id := v_teach;
    new.learner_id := v_learn;
    new.created_at := now();
    new.closed_at := null;
  end if;

  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not chat.case_owner_fits(new.owner_id, new.target_department_id) then
    raise exception 'a case is owned inside its target department' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger supervision_case_is_coherent
  before insert or update or delete on chat.supervision_case
  for each row execute function chat.guard_supervision_case();

-- ===========================================================================
-- 2. The history
-- ===========================================================================

create table chat.supervision_case_event (
  id        uuid primary key default gen_random_uuid(),
  case_id   uuid not null references chat.supervision_case (id),
  kind      text not null check (kind in ('opened', 'assigned', 'status', 'due', 'note')),
  actor_id  uuid not null references chat.staff (id),
  before    jsonb,
  after     jsonb,
  note      text check (note is null or length(btrim(note)) between 1 and 2000),
  at        timestamptz not null default clock_timestamp(),
  constraint supervision_case_note_has_text check (kind <> 'note' or note is not null)
);

create index supervision_case_event_case_idx on chat.supervision_case_event (case_id, at);
create index supervision_case_event_actor_idx on chat.supervision_case_event (actor_id, at desc);

create trigger supervision_case_event_is_append_only before update or delete on chat.supervision_case_event
  for each row execute function chat.forbid_change();

-- One event per change, in the transaction that made it. A status change may
-- carry its note (chat.case_note), so "resolved: why" is one event.
create or replace function chat.record_supervision_case_event()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := current_setting('chat.case_actor', true)::uuid;
  v_note  text := nullif(btrim(coalesce(current_setting('chat.case_note', true), '')), '');
begin
  if tg_op = 'INSERT' then
    insert into chat.supervision_case_event (case_id, kind, actor_id, after)
    values (new.id, 'opened', v_actor,
            jsonb_build_object('ownerId', new.owner_id, 'dueOn', new.due_on, 'status', new.status));
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into chat.supervision_case_event (case_id, kind, actor_id, before, after)
    values (new.id, 'assigned', v_actor, jsonb_build_object('ownerId', old.owner_id), jsonb_build_object('ownerId', new.owner_id));
  end if;
  if new.status is distinct from old.status then
    insert into chat.supervision_case_event (case_id, kind, actor_id, before, after, note)
    values (new.id, 'status', v_actor, jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), v_note);
  end if;
  if new.due_on is distinct from old.due_on then
    insert into chat.supervision_case_event (case_id, kind, actor_id, before, after)
    values (new.id, 'due', v_actor, jsonb_build_object('dueOn', old.due_on), jsonb_build_object('dueOn', new.due_on));
  end if;
  return new;
end;
$$;

create trigger supervision_case_records_its_events
  after insert or update on chat.supervision_case
  for each row execute function chat.record_supervision_case_event();

-- ===========================================================================
-- 3. "Due soon", once per due date
-- ===========================================================================

create table chat.supervision_case_due_notice (
  case_id      uuid not null references chat.supervision_case (id),
  due_on       date not null,
  announced_at timestamptz not null default now(),
  primary key (case_id, due_on)
);

-- ===========================================================================
-- 4. Fail closed
-- ===========================================================================

alter table chat.supervision_case            enable row level security;
alter table chat.supervision_case_event      enable row level security;
alter table chat.supervision_case_due_notice enable row level security;

revoke all on chat.supervision_case, chat.supervision_case_event, chat.supervision_case_due_notice
  from public, anon, authenticated, chat_app;

revoke all on function chat.case_owner_fits(uuid, uuid) from public;
revoke all on function chat.guard_supervision_case() from public;
revoke all on function chat.record_supervision_case_event() from public;
