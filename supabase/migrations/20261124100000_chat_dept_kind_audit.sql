-- Access management M2: department-kind audit corrections (owner decision 2026-11-22: "complete the department-kind audit and
-- correct all comparisons that could confuse two distinct configurable departments" BEFORE any schema change).
--
-- Today chat.department.kind is operations | teachers | sales and unique per organization, so "same kind" happened to mean
-- "same department" and a kind-agnostic rule happened to reach only core departments. The next stage lets many configurable
-- departments exist (kind 'general'), which must start with NO access to existing organizational data. This migration makes
-- the rules say what they have always meant, with NO behaviour change while only the three core kinds exist:
--
--   * chat.is_core_department_kind(kind): the one definition of "a department with built-in workflow semantics";
--   * chat.staff_department_id(staff): a person's department by ID (kind is a type, not an identity);
--   * every kind-agnostic reach rule (manager standing, supervised principals, case ownership, task standing, mention
--     targets, content-report managers) is restricted to core departments, so a configurable department's manager or
--     member can never gain family, conversation, case, task or moderation reach through them;
--   * chat.may_void_testimonial compares department ids (and core only), never kinds.
--
-- Audit registry: apps/api/test/unit/authorization/department-kind-audit.json (every function that reads a department table
-- and its classification); docs/admin/department-kind-audit.md. Rollback: db/rollback/20261124100000_chat_dept_kind_audit.down.sql.

create or replace function chat.is_core_department_kind(p_kind text)
returns boolean
language sql
immutable
as $$
  select p_kind in ('operations', 'teachers', 'sales');
$$;

create or replace function chat.staff_department_id(p_staff uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select d.id from chat.department d where d.manager_id = p_staff limit 1),
    (select m.department_id from chat.department_member m where m.staff_id = p_staff limit 1));
$$;

create or replace function chat.staff_acts_for(p_staff uuid, p_principal uuid, p_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_staff = p_principal then 'self'
    when chat.backup_is_active(p_principal, p_staff, p_at) then 'backup'
    when exists (
      select 1 from chat.department_member m
        join chat.department d on d.id = m.department_id
       where m.staff_id = p_principal and d.manager_id = p_staff and chat.is_core_department_kind(d.kind)) then 'manager'
  end;
$$;

create or replace function chat.staff_principals(p_staff uuid, p_at timestamptz)
returns setof uuid
language sql
stable
as $$
  select p_staff
  union
  select b.primary_id from chat.supervisor_backup b
   where b.backup_id = p_staff and chat.backup_is_active(b.primary_id, p_staff, p_at)
  union
  select m.staff_id from chat.department_member m
    join chat.department d on d.id = m.department_id
   where d.manager_id = p_staff and chat.is_core_department_kind(d.kind);
$$;

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
       where m.staff_id = p_staff and d.manager_id = p_viewer and d.organization_id = p_org
         and chat.is_core_department_kind(d.kind)) then 'manager'
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

create or replace function chat.work_task_unmanaged(p_org uuid, p_staff uuid, p_teacher uuid, p_creator uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select not (
    (p_staff is not null and exists (
      select 1 from chat.department_member m
        join chat.department d on d.id = m.department_id and d.organization_id = p_org and chat.is_core_department_kind(d.kind)
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

create or replace function chat.mention_role_targets(
  p_conversation uuid,
  p_role         text,
  p_at           timestamptz default now()
) returns setof uuid
language plpgsql
stable
as $$
declare
  c record;
begin
  if p_role not in ('supervisor', 'admin') then
    raise exception 'unknown role mention %', p_role using errcode = 'check_violation';
  end if;
  select id, type, family_id, learner_id, organization_id into c
    from chat.conversation where id = p_conversation;
  if c.id is null or not chat.conversation_takes_summons(c.id) then return; end if;

  return query
  with learners as (
    select c.learner_id as learner_id where c.type = 'student_group'
    union
    select cl.learner_id from chat.conversation_learner cl
     where c.type = 'family_group' and cl.conversation_id = c.id
    union
    select l.id from chat.learner l
     where c.type = 'direct' and l.family_id = c.family_id
  ),
  supervisors as (
    select distinct ls.supervisor_id as id
      from chat.learner_supervision ls
      join learners on learners.learner_id = ls.learner_id
  ),
  acting as (
    select coalesce(chat.cover_of(s.id, p_at), s.id) as id from supervisors s
  ),
  wanted as (
    select a.id from acting a
    union
    select d.manager_id
      from supervisors s
      join chat.department_member m on m.staff_id = s.id
      join chat.department d on d.id = m.department_id
     where p_role = 'admin' and d.manager_id is not null and chat.is_core_department_kind(d.kind)
  )
  select w.id
    from wanted w
    join chat.staff st on st.id = w.id
   where st.role <> 'super_admin'
     and st.is_active and st.left_at is null
     and chat.staff_conversation_standing(w.id, c.id, p_at) is not null;
end;
$$;

create or replace function chat.content_report_managers(p_report uuid)
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select distinct d.manager_id
    from chat.content_report r
    join chat.department d on d.organization_id = r.organization_id and d.id = any (r.department_ids)
    join chat.staff s on s.id = d.manager_id and s.organization_id = r.organization_id and s.is_active and s.left_at is null
   where r.id = p_report
     and chat.is_core_department_kind(d.kind)
     and r.reason <> 'child_safety'
     and not (r.subject_kind = 'staff' and r.subject_id = d.manager_id)
     and exists (select 1 from chat.staff_access_profile(s.id) p where 'moderation.view' = any (p.permissions));
$$;

create or replace function chat.case_owner_fits(p_staff uuid, p_department uuid, p_teacher uuid, p_learner uuid)
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
       and (d.manager_id = p_staff and chat.is_core_department_kind(d.kind)
            or (exists (select 1 from chat.department_member m
                         where m.department_id = d.id and m.staff_id = p_staff)
                and case d.kind
                      when 'teachers' then
                        p_teacher is null or not chat.teacher_scope_strict()
                        or chat.staff_teacher_scope(p_staff, p_teacher) is not null
                      when 'operations' then
                        p_learner is null
                        or exists (select 1 from chat.learner_supervision ls
                                    where ls.learner_id = p_learner
                                      and ls.supervisor_id in (select chat.staff_principals(p_staff, now())))
                      else false
                    end))
  );
$$;

create or replace function chat.may_void_testimonial(p_staff uuid, p_author uuid, p_org uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select p_staff is not null and (
    exists (select 1 from chat.staff s where s.id = p_staff and s.role = 'super_admin' and s.is_active and s.organization_id = p_org)
    or chat.is_operations_manager(p_staff, p_org)
    -- The SAME department (by id, never by kind: two departments of one kind are two departments) and a core one.
    or (chat.staff_department_id(p_staff) is not null
        and chat.staff_department_id(p_staff) = chat.staff_department_id(p_author)
        and chat.is_core_department_kind(chat.staff_department_kind(p_staff))));
$$;

revoke all on function chat.is_core_department_kind(text) from public;
revoke all on function chat.staff_department_id(uuid) from public;
