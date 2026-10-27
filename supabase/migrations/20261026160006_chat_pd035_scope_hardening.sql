-- PD-35 (2026-10-26), scope hardening -- from the department head's review of
-- #136 (20261026160004), before the strict switch may ever be turned on.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- 1. The assignment guard checked "is a primary supervisor of the Teachers
--    department" with a bare EXISTS. Under READ COMMITTED a concurrent removal
--    from the department (whose own guard saw no assignment yet) slipped past
--    it, leaving a teacher assigned to someone outside the department. The
--    guard now locks that membership row FOR SHARE, so the removal and the
--    assignment serialize, and one of them refuses.
--    And chat.staff_teacher_scope re-checks the department for the self /
--    backup path, so an assignment left behind by any route grants nothing.
-- 3. The move guard ignored a change of department_member.staff_id (handing a
--    supervisor's row to someone else). It is now covered too.

-- ===========================================================================
-- 1. The assignment guard: lock the membership it relies on
-- ===========================================================================

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
  -- FOR SHARE: a concurrent removal or move of this row waits for us (and its
  -- own guard then sees the assignment), or we wait for it and find no row.
  perform 1
     from chat.department_member m
     join chat.department d on d.id = m.department_id
    where m.staff_id = new.supervisor_id and m.position = 'supervisor' and d.kind = 'teachers'
      for share of m;
  if not found then
    raise exception 'a teacher is supervised by a primary supervisor of the Teachers department'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_teacher_org;
  new.assigned_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 3. The move guard: a change of staff_id is a move too
-- ===========================================================================

create or replace function chat.guard_teacher_supervisor_move()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.teacher_supervisor_assignment a where a.supervisor_id = old.staff_id)
     and (tg_op = 'DELETE'
          or new.staff_id <> old.staff_id
          or new.department_id <> old.department_id
          or new.position <> old.position) then
    raise exception 'reassign this supervisor''s teachers before moving them' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ===========================================================================
-- 1. The scope re-checks the department
-- ===========================================================================

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

  -- The assigned supervisor must still be a primary supervisor of the Teachers
  -- department: an assignment left behind grants nothing.
  select chat.staff_acts_for(p_staff, a.supervisor_id, p_at) into v
    from chat.teacher_supervisor_assignment a
   where a.teacher_id = p_teacher
     and exists (select 1 from chat.department_member m
                   join chat.department d on d.id = m.department_id
                  where m.staff_id = a.supervisor_id and m.position = 'supervisor' and d.kind = 'teachers');
  return case when v in ('self', 'backup') then v end;
end;
$$;

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
       and exists (select 1 from chat.department_member m
                     join chat.department d on d.id = m.department_id
                    where m.staff_id = a.supervisor_id and m.position = 'supervisor' and d.kind = 'teachers')
       and a.supervisor_id in (
         select p from chat.staff_principals(p_staff, p_at) p
          where p = p_staff or chat.staff_acts_for(p_staff, p, p_at) = 'backup');
end;
$$;

revoke all on function chat.guard_teacher_supervisor_assignment() from public;
revoke all on function chat.guard_teacher_supervisor_move() from public;
revoke all on function chat.staff_teacher_scope(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_supervised_teacher_ids(uuid, timestamptz) from public;
