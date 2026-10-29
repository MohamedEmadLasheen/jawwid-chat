-- PD-35 (2026-10-27), B6 -- department rooms (work groups).
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- WHAT IS NEW
--
--   conversation type 'department_room'
--                          one per department (chat.conversation.department_id),
--                          staff-only: the department's manager and its members.
--                          Where "talk to other supervisors and the Teachers
--                          Manager" happens -- staff-to-staff 1:1s stay disabled
--                          (owner Q2). Kept in line by the API whenever the
--                          structure changes, and healed by the worker's sweep.
--   chat.department_room_party
--                          live: the department's manager, or a member of it --
--                          active staff of its organization.
--   chat.staff_conversation_standing / chat.staff_visible_conversation_ids
--                          one more branch each, the rest verbatim from
--                          20261026160004 / 20261026160003: 'member' while you are
--                          in the room's department, never through a member row.
--   card kind 'case_escalated'
--                          B5's case, announced in its target department's room
--                          (ids and names only; the case is read in Escalations).
--
-- FAIL CLOSED: the member guard refuses a contact, a teacher and any staff
-- outside the department at the row.

-- ===========================================================================
-- 1. Who belongs to a department, live
-- ===========================================================================

create or replace function chat.department_room_party(p_staff uuid, p_department uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from chat.department d
      join chat.staff s on s.id = p_staff and s.organization_id = d.organization_id
                       and s.is_active and s.left_at is null
                       and s.role in ('admin', 'coverage', 'manager')
     where d.id = p_department
       and (d.manager_id = p_staff
            or exists (select 1 from chat.department_member m
                        where m.department_id = d.id and m.staff_id = p_staff))
  );
$$;

-- ===========================================================================
-- 2. The room
-- ===========================================================================

alter table chat.conversation drop constraint conversation_type_check;
alter table chat.conversation add constraint conversation_type_check
  check (type in ('direct', 'student_group', 'class_group', 'official', 'family_group',
                  'teacher_supervision', 'trial_group', 'department_room'));

alter table chat.conversation add column department_id uuid references chat.department (id);

comment on column chat.conversation.department_id is
  'PD-35 B6: the department a department_room belongs to. Set for that type only, never changed.';

alter table chat.conversation add constraint conversation_department_room_shape
  check ((type = 'department_room') = (department_id is not null)
     and (type <> 'department_room'
          or (family_id is null and learner_id is null and direct_key is null
              and supervised_teacher_id is null and trial_teacher_id is null)));

-- One live room per department.
create unique index conversation_one_room_per_department
  on chat.conversation (department_id)
  where department_id is not null and archived_at is null;

create or replace function chat.guard_department_room_conversation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.department_id is distinct from old.department_id then
    raise exception 'a department room belongs to one department, for good' using errcode = 'check_violation';
  end if;
  if new.department_id is not null and not exists (
    select 1 from chat.department d
     where d.id = new.department_id and d.organization_id = new.organization_id
  ) then
    raise exception 'a department room belongs to its department''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger conversation_department_room_coherent
  before insert or update of department_id, organization_id on chat.conversation
  for each row execute function chat.guard_department_room_conversation();

-- Who may be a member, at the row: staff of the room's department, as admin.
-- Never a contact, never a teacher.
create or replace function chat.guard_department_room_member()
returns trigger
language plpgsql
as $$
declare
  v_conv record;
begin
  if new.left_at is not null then
    return new;
  end if;
  select id, type, department_id into v_conv from chat.conversation where id = new.conversation_id;
  if v_conv.type is distinct from 'department_room' then
    return new;
  end if;
  if new.actor_kind <> 'staff' or new.member_role <> 'admin'
     or not chat.department_room_party(new.actor_id, v_conv.department_id) then
    raise exception 'a department room admits only its department''s staff, as admin' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger conversation_member_department_room_eligible
  before insert or update of actor_id, actor_kind, member_role, left_at on chat.conversation_member
  for each row execute function chat.guard_department_room_member();

-- ===========================================================================
-- 3. The PD-8 decision and the chat list: one more branch each
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

  select id, type, family_id, learner_id, organization_id, supervised_teacher_id, trial_teacher_id, department_id into c
    from chat.conversation where id = p_conversation;
  if c.id is null or c.organization_id <> s.organization_id then return null; end if;

  if s.role = 'super_admin' then return 'super_admin'; end if;
  if s.role not in ('admin', 'coverage', 'manager') then return null; end if;

  -- PD-35 B6: a department room is its department's: the manager and the
  -- members are parties, live -- leaving the department ends access at once.
  -- Nobody else below the super admin, and never through a member row.
  if c.type = 'department_room' then
    return case when chat.department_room_party(p_staff, c.department_id) then 'member' end;
  end if;

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

create or replace function chat.staff_visible_conversation_ids(p_staff uuid, p_at timestamptz default now())
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
  if s.role = 'super_admin' then
    return query select c.id from chat.conversation c where c.organization_id = s.organization_id;
    return;
  end if;
  return query
    with principals as (select chat.staff_principals(p_staff, p_at) as id),
         learners as (
           select ls.learner_id from chat.learner_supervision ls
            where ls.supervisor_id in (select id from principals)),
         candidates as (
           select c.id from chat.conversation c
            where c.type = 'student_group' and c.learner_id in (select learner_id from learners)
           union
           select cl.conversation_id from chat.conversation_learner cl
            where cl.learner_id in (select learner_id from learners)
           union
           select cm.conversation_id from chat.conversation_member cm
            where cm.left_at is null and cm.actor_kind = 'staff'
              and cm.actor_id in (select id from principals)
              and not exists (select 1 from chat.conversation_seat st
                               where st.member_id = cm.id and st.left_at is null)
           union
           select c.id from chat.conversation c
            where c.type = 'teacher_supervision' and c.organization_id = s.organization_id
              and chat.teachers_department_role(p_staff) is not null
           union
           select c.id from chat.conversation c
            where c.type = 'trial_group' and c.organization_id = s.organization_id
              and (chat.trial_desk_role(p_staff) is not null
                   or chat.teachers_department_role(p_staff) is not null)
           union
           select c.id from chat.conversation c
            where c.type = 'department_room' and c.organization_id = s.organization_id
              and chat.department_room_party(p_staff, c.department_id)
           union
           select st.conversation_id from chat.conversation_seat st
            where st.staff_id = p_staff and st.left_at is null)
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

-- ===========================================================================
-- 4. B5's card
-- ===========================================================================

insert into chat.message_card_kind (kind) values ('case_escalated')
on conflict do nothing;

-- ===========================================================================
-- 5. Fail closed
-- ===========================================================================

revoke all on function chat.department_room_party(uuid, uuid) from public;
revoke all on function chat.guard_department_room_conversation() from public;
revoke all on function chat.guard_department_room_member() from public;
revoke all on function chat.staff_conversation_standing(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
