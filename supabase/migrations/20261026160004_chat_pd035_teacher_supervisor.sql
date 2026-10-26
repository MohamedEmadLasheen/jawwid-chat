-- PD-35 (2026-10-26), part 2 -- teacher supervisors: each teacher's ONE
-- supervisor in the Teachers department, the scope that follows from it, and
-- the 'supervision' seat.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- WHAT IS NEW
--
--   chat.teacher_supervisor_assignment
--                          a teacher's supervisor: a primary supervisor of the
--                          Teachers department. Current state only (like PD-8's
--                          chat.learner_supervision); every change is audited.
--   chat.staff_teacher_scope(staff, teacher)
--                          how a staff member stands to a teacher: 'super_admin',
--                          'manager' (the Teachers Manager: the whole
--                          department, unassigned teachers included), 'self' or
--                          'backup' (through PD-8's staff_acts_for, so a backup
--                          link -- and a PD-33 cover -- work unchanged), or null.
--                          A FACT, whatever the switch below says.
--   chat.teacher_scope_strict()
--                          the switch TEACHER_SUPERVISOR_STRICT_SCOPE, as the API
--                          and the worker write it into chat.config at boot. OFF:
--                          the Teachers department works department-wide, as
--                          before PD-35. ON: a teacher supervisor works on their
--                          own teachers only. The API reads the same row, so the
--                          two cannot disagree.
--   staff_conversation_standing
--                          with the switch ON, a teacher's supervision
--                          conversation and trial group are the staff side of
--                          that teacher's scope only, not of the whole
--                          department. OFF: unchanged.
--   seat reason 'supervision'
--                          a teacher supervisor (or the Teachers Manager) joins,
--                          visibly, a Student Group or family group of a child
--                          taught by a teacher in their scope, or that teacher's
--                          supervision / trial group. It GRANTS access while it
--                          holds; a change of teacher or of supervisor ends it.
--                          Never in a 1:1. Assignment-based whatever the switch.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. The assignment
-- ===========================================================================

create table chat.teacher_supervisor_assignment (
  teacher_id      uuid primary key references chat.teacher (id) on delete cascade,
  organization_id uuid not null references chat.organization (id),
  supervisor_id   uuid not null references chat.staff (id),
  assigned_by     uuid references chat.staff (id),
  assigned_at     timestamptz not null default now(),
  reason          text check (reason is null or length(btrim(reason)) between 1 and 500)
);

comment on table chat.teacher_supervisor_assignment is
  'PD-35: the ONE teacher supervisor responsible for a teacher. Current state only; every change is in chat.audit_log.';

create index teacher_supervisor_assignment_supervisor_idx on chat.teacher_supervisor_assignment (supervisor_id);

create or replace function chat.guard_teacher_supervisor_assignment()
returns trigger
language plpgsql
as $$
declare
  v_teacher_org uuid;
  v_staff       chat.staff%rowtype;
begin
  select organization_id into v_teacher_org from chat.teacher where id = new.teacher_id;
  select * into v_staff from chat.staff where id = new.supervisor_id;
  if v_teacher_org is null or v_staff.id is null then
    raise exception 'a teacher assignment references a row that does not exist' using errcode = 'foreign_key_violation';
  end if;
  if v_staff.organization_id is distinct from v_teacher_org then
    raise exception 'a teacher and their supervisor belong to one organization' using errcode = 'insufficient_privilege';
  end if;
  if not v_staff.is_active or v_staff.left_at is not null then
    raise exception 'an inactive staff member cannot supervise a teacher' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from chat.department_member m
      join chat.department d on d.id = m.department_id
     where m.staff_id = new.supervisor_id and m.position = 'supervisor' and d.kind = 'teachers'
  ) then
    raise exception 'a teacher is supervised by a primary supervisor of the Teachers department'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_teacher_org;
  new.assigned_at := now();
  return new;
end;
$$;

create trigger teacher_supervisor_assignment_is_coherent before insert or update on chat.teacher_supervisor_assignment
  for each row execute function chat.guard_teacher_supervisor_assignment();

-- A supervisor who still has teachers stays where they are: reassign first, as
-- PD-8 asks for an Operations supervisor's learners.
create or replace function chat.guard_teacher_supervisor_move()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.teacher_supervisor_assignment a where a.supervisor_id = old.staff_id)
     and (tg_op = 'DELETE' or new.department_id <> old.department_id or new.position <> old.position) then
    raise exception 'reassign this supervisor''s teachers before moving them' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger department_member_keeps_teacher_assignments before update or delete on chat.department_member
  for each row execute function chat.guard_teacher_supervisor_move();

-- ===========================================================================
-- 2. Scope
-- ===========================================================================

create or replace function chat.teacher_scope_strict()
returns boolean
language sql
stable
as $$
  select coalesce((select c.value = 'true'::jsonb from chat.config c where c.key = 'teacher_supervisor.strict_scope'), false);
$$;

insert into chat.config (key, value, scope, description) values
  ('teacher_supervisor.strict_scope', 'false'::jsonb, 'teachers',
   'PD-35: written at boot from TEACHER_SUPERVISOR_STRICT_SCOPE. true = a teacher supervisor works on their own teachers only.')
on conflict (key) do nothing;

create or replace function chat.staff_teacher_scope(p_staff uuid, p_teacher uuid, p_at timestamptz default now())
returns text
language plpgsql
stable
as $$
declare
  s record;
  v_teacher_org uuid;
  v text;
begin
  select id, role, organization_id, (is_active and left_at is null) as live into s
    from chat.staff where id = p_staff;
  if s.id is null or not s.live then return null; end if;
  select organization_id into v_teacher_org from chat.teacher where id = p_teacher;
  if v_teacher_org is null or v_teacher_org <> s.organization_id then return null; end if;

  if s.role = 'super_admin' then return 'super_admin'; end if;
  if s.role = 'manager' and exists (
    select 1 from chat.department d
     where d.kind = 'teachers' and d.manager_id = p_staff and d.organization_id = s.organization_id
  ) then
    return 'manager';
  end if;
  if s.role not in ('admin', 'coverage') then return null; end if;

  select chat.staff_acts_for(p_staff, a.supervisor_id, p_at) into v
    from chat.teacher_supervisor_assignment a where a.teacher_id = p_teacher;
  return case when v in ('self', 'backup') then v end;
end;
$$;

-- The teachers p_staff works on: every teacher of the organization for the
-- super admin and the Teachers Manager; otherwise the teachers of the
-- supervisors they act for (themselves, a primary they back up).
create or replace function chat.staff_supervised_teacher_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language plpgsql
stable
as $$
declare
  s record;
begin
  select id, role, organization_id, (is_active and left_at is null) as live into s
    from chat.staff where id = p_staff;
  if s.id is null or not s.live then return; end if;
  if s.role = 'super_admin' or (s.role = 'manager' and exists (
       select 1 from chat.department d
        where d.kind = 'teachers' and d.manager_id = p_staff and d.organization_id = s.organization_id)) then
    return query select t.id from chat.teacher t where t.organization_id = s.organization_id;
    return;
  end if;
  if s.role not in ('admin', 'coverage') then return; end if;
  return query
    select a.teacher_id from chat.teacher_supervisor_assignment a
     where a.organization_id = s.organization_id
       and a.supervisor_id in (
         select p from chat.staff_principals(p_staff, p_at) p
          where p = p_staff or chat.staff_acts_for(p_staff, p, p_at) = 'backup');
end;
$$;

-- ===========================================================================
-- 3. The PD-8 decision: the supervision conversation and the trial group follow
--    the teacher's scope when the switch is ON
-- ===========================================================================

create or replace function chat.staff_conversation_standing(
  p_staff        uuid,
  p_conversation uuid,
  p_at           timestamptz default now()
) returns text
language plpgsql
stable
as $$
declare
  s      record;
  c      record;
  v      text;
  m      record;
begin
  select id, role, organization_id, (is_active and left_at is null) as live into s
    from chat.staff where id = p_staff;
  if s.id is null or not s.live then return null; end if;

  select id, type, family_id, learner_id, organization_id, supervised_teacher_id, trial_teacher_id into c
    from chat.conversation where id = p_conversation;
  if c.id is null or c.organization_id <> s.organization_id then return null; end if;

  if s.role = 'super_admin' then return 'super_admin'; end if;
  if s.role not in ('admin', 'coverage', 'manager') then return null; end if;

  -- PD-12: the Teachers department is the supervision conversation's staff
  -- side. Its manager is a party here, not a manager stepping in. PD-35: with
  -- the switch ON, only the staff whose scope covers this teacher.
  if c.type = 'teacher_supervision' then
    if chat.teachers_department_role(p_staff) is null then return null; end if;
    if chat.teacher_scope_strict()
       and chat.staff_teacher_scope(p_staff, c.supervised_teacher_id, p_at) is null then
      return null;
    end if;
    return 'member';
  end if;

  -- PD-11 T4: a teacher's trial group is Sales' and the Teachers department's
  -- staff side -- each a party here. Nobody else below the super admin. PD-35:
  -- the Teachers department's side follows the teacher's scope when ON.
  if c.type = 'trial_group' then
    if chat.trial_desk_role(p_staff) is not null then return 'member'; end if;
    if chat.teachers_department_role(p_staff) is null then return null; end if;
    if chat.teacher_scope_strict()
       and chat.staff_teacher_scope(p_staff, c.trial_teacher_id, p_at) is null then
      return null;
    end if;
    return 'member';
  end if;

  -- Groups: the supervisor of the learners the group is about.
  if c.type in ('student_group', 'family_group') then
    select x.basis into v from (
      select chat.staff_acts_for(p_staff, ls.supervisor_id, p_at) as basis
        from chat.learner_supervision ls
       where (c.type = 'student_group' and ls.learner_id = c.learner_id)
          or (c.type = 'family_group' and ls.learner_id in (
                select cl.learner_id from chat.conversation_learner cl where cl.conversation_id = c.id))
    ) x
    where x.basis is not null
    order by case x.basis when 'self' then 1 when 'backup' then 2 else 3 end
    limit 1;
    return case v when 'self' then 'responsible' else v end;
  end if;

  -- Everything else: through a live staff member of the conversation. For a
  -- family conversation that member must still reach the family, so a
  -- supervisor whose children were all reassigned away loses the parent's 1:1.
  -- PD-35 (part 1): never through a member row a seat opened.
  for m in
    select cm.actor_id from chat.conversation_member cm
     where cm.conversation_id = c.id and cm.left_at is null and cm.actor_kind = 'staff'
       and not exists (select 1 from chat.conversation_seat st where st.member_id = cm.id and st.left_at is null)
  loop
    v := chat.staff_acts_for(p_staff, m.actor_id, p_at);
    continue when v is null;
    if c.family_id is not null and chat.staff_reaches_family(m.actor_id, c.family_id, p_at) is null then
      continue;
    end if;
    return case v when 'self' then 'member' else v end;
  end loop;
  return null;
end;
$$;

-- ===========================================================================
-- 4. The 'supervision' seat
-- ===========================================================================

-- A group of a teacher the staff member's scope covers (whatever the switch:
-- joining is by assignment).
create or replace function chat.seat_eligible_supervision(p_staff uuid, p_conversation uuid, p_at timestamptz)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.conversation c
     where c.id = p_conversation and c.archived_at is null
       and (
         (c.type = 'student_group' and exists (
            select 1 from chat.learner l
             where l.id = c.learner_id and l.teacher_id is not null
               and chat.staff_teacher_scope(p_staff, l.teacher_id, p_at) is not null))
         or (c.type = 'family_group' and exists (
            select 1 from chat.conversation_learner cl
              join chat.learner l on l.id = cl.learner_id
             where cl.conversation_id = c.id and l.teacher_id is not null
               and chat.staff_teacher_scope(p_staff, l.teacher_id, p_at) is not null))
         or (c.type = 'teacher_supervision'
             and chat.staff_teacher_scope(p_staff, c.supervised_teacher_id, p_at) is not null)
         or (c.type = 'trial_group'
             and chat.staff_teacher_scope(p_staff, c.trial_teacher_id, p_at) is not null)));
$$;

insert into chat.seat_reason (reason, grants_access, allowed_in_direct, eligibility_fn, idle_days) values
  ('supervision', true, false, 'chat.seat_eligible_supervision(uuid, uuid, timestamptz)'::regprocedure, 14);

-- ===========================================================================
-- 5. Fail closed
-- ===========================================================================

alter table chat.teacher_supervisor_assignment enable row level security;
revoke all on chat.teacher_supervisor_assignment from public, anon, authenticated, chat_app;

revoke all on function chat.guard_teacher_supervisor_assignment() from public;
revoke all on function chat.guard_teacher_supervisor_move() from public;
revoke all on function chat.teacher_scope_strict() from public;
revoke all on function chat.staff_teacher_scope(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_supervised_teacher_ids(uuid, timestamptz) from public;
revoke all on function chat.staff_conversation_standing(uuid, uuid, timestamptz) from public;
revoke all on function chat.seat_eligible_supervision(uuid, uuid, timestamptz) from public;
