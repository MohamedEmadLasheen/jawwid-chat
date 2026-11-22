-- Roll back 20261124100000_chat_dept_kind_audit: the eight rules return to their previous bodies (20261015120000 PD-8,
-- 20261026160007 PD-35, 20261026170000 PD-36, 20261029160000 PD-47, 20261031180000 PD-52, 20261106150000 PD-57) and the two helpers go.
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261124100000_chat_dept_kind_audit.down.sql
-- Then: delete from chat.schema_migrations where version = '20261124100000_chat_dept_kind_audit';

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
       where m.staff_id = p_principal and d.manager_id = p_staff) then 'manager'
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
   where d.manager_id = p_staff;
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
     where p_role = 'admin' and d.manager_id is not null
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
       and (d.manager_id = p_staff
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
    or (chat.staff_department_kind(p_staff) is not null
        and chat.staff_department_kind(p_staff) = chat.staff_department_kind(p_author)));
$$;

drop function chat.staff_department_id(uuid);
drop function chat.is_core_department_kind(text);
