-- PD-11 T4, part 2 (2026-10-19) -- each teacher's trial group, and the trial cards.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, PD-11 ("Each teacher has
-- one staff-only trial group") and the T4 owner decision that the whole Sales
-- department joins it.
--
-- WHAT IS NEW
--
--   conversation type 'trial_group'   about ONE teacher (trial_teacher_id), the
--                                     shape of PD-12's teacher_supervision:
--                                     never a family, a learner or a 1:1
--   members                           the teacher (as teacher) and staff of the
--                                     Sales or Teachers department (as admin);
--                                     never a family contact
--   chat.staff_conversation_access    one more basis branch: Sales and the
--                                     Teachers department are parties to it.
--                                     The rest of the body is PD-12's, verbatim.
--   card kinds                        trial_booked, trial_cancelled,
--                                     trial_report, trial_no_show, trial_decision
--
-- Built on 20261019090000_chat_pd012_s1.sql: the type list, the access function
-- and chat.message_card_kind are extended, never rewritten from an older copy.

-- ===========================================================================
-- 1. The Sales department, as one predicate
-- ===========================================================================

-- 'manager' | 'member' | NULL, the twin of chat.teachers_department_role.
create or replace function chat.sales_department_role(p_staff uuid)
returns text
language sql
stable
as $$
  select case
    when exists (select 1 from chat.department d
                  where d.kind = 'sales' and d.manager_id = p_staff) then 'manager'
    when exists (select 1 from chat.department_member m
                   join chat.department d on d.id = m.department_id
                  where d.kind = 'sales' and m.staff_id = p_staff) then 'member'
  end;
$$;

revoke all on function chat.sales_department_role(uuid) from public;

-- ===========================================================================
-- 2. The trial group conversation
-- ===========================================================================

alter table chat.conversation drop constraint conversation_type_check;
alter table chat.conversation add constraint conversation_type_check
  check (type in ('direct', 'student_group', 'class_group', 'official', 'family_group',
                  'teacher_supervision', 'trial_group'));

alter table chat.conversation add column trial_teacher_id uuid references chat.teacher (id);

comment on column chat.conversation.trial_teacher_id is
  'PD-11 T4: the teacher a trial_group conversation belongs to. Set for that type only, never changed.';

alter table chat.conversation add constraint conversation_trial_group_shape
  check ((type = 'trial_group') = (trial_teacher_id is not null)
     and (type <> 'trial_group'
          or (family_id is null and learner_id is null and direct_key is null)));

-- One live trial group per teacher.
create unique index conversation_one_trial_group_per_teacher
  on chat.conversation (trial_teacher_id)
  where trial_teacher_id is not null and archived_at is null;

create or replace function chat.guard_trial_group_conversation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.trial_teacher_id is distinct from old.trial_teacher_id then
    raise exception 'a trial group belongs to one teacher, for good' using errcode = 'check_violation';
  end if;
  if new.trial_teacher_id is not null and not exists (
    select 1 from chat.teacher t
     where t.id = new.trial_teacher_id and t.organization_id = new.organization_id
  ) then
    raise exception 'a trial group belongs to its teacher''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger conversation_trial_group_coherent
  before insert or update of trial_teacher_id, organization_id on chat.conversation
  for each row execute function chat.guard_trial_group_conversation();

-- Who may be a member, at the row: the teacher it belongs to, as teacher; staff
-- of Sales or the Teachers department, as admin. A prospect is never a member:
-- a trial group is a staff room about prospects, not a room with them.
create or replace function chat.guard_trial_group_member()
returns trigger
language plpgsql
as $$
declare
  v_conv record;
begin
  if new.left_at is not null then
    return new;
  end if;
  select id, type, trial_teacher_id into v_conv from chat.conversation where id = new.conversation_id;
  if v_conv.type is distinct from 'trial_group' then
    return new;
  end if;
  if new.actor_kind = 'contact' then
    raise exception 'a trial group never admits a family contact' using errcode = 'check_violation';
  elsif new.actor_kind = 'teacher' then
    if new.member_role <> 'teacher' or new.actor_id <> v_conv.trial_teacher_id then
      raise exception 'a trial group admits only the teacher it belongs to' using errcode = 'check_violation';
    end if;
  elsif new.actor_kind = 'staff' then
    if new.member_role <> 'admin'
       or (chat.sales_department_role(new.actor_id) is null and chat.teachers_department_role(new.actor_id) is null) then
      raise exception 'a trial group admits staff of Sales or the Teachers department, as admin'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger conversation_member_trial_group_eligible
  before insert or update of actor_id, actor_kind, member_role, left_at on chat.conversation_member
  for each row execute function chat.guard_trial_group_member();

-- THE decision (PD-8), with PD-12's branch and one more for the trial group.
create or replace function chat.staff_conversation_access(
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

  select id, type, family_id, learner_id, organization_id into c
    from chat.conversation where id = p_conversation;
  if c.id is null or c.organization_id <> s.organization_id then return null; end if;

  if s.role = 'super_admin' then return 'super_admin'; end if;
  if s.role not in ('admin', 'coverage', 'manager') then return null; end if;

  -- PD-12: the Teachers department is the supervision conversation's staff
  -- side. Its manager is a party here, not a manager stepping in.
  if c.type = 'teacher_supervision' then
    return case when chat.teachers_department_role(p_staff) is not null then 'member' end;
  end if;

  -- PD-11 T4: a teacher's trial group is Sales' and the Teachers department's
  -- staff side -- each a party here. Nobody else below the super admin.
  if c.type = 'trial_group' then
    return case when chat.sales_department_role(p_staff) is not null
                  or chat.teachers_department_role(p_staff) is not null then 'member' end;
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
  for m in
    select cm.actor_id from chat.conversation_member cm
     where cm.conversation_id = c.id and cm.left_at is null and cm.actor_kind = 'staff'
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

-- The chat list (PD-8, PD-12), with the trial groups as one more candidate set.
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
           union
           select c.id from chat.conversation c
            where c.type = 'teacher_supervision' and c.organization_id = s.organization_id
              and chat.teachers_department_role(p_staff) is not null
           union
           select c.id from chat.conversation c
            where c.type = 'trial_group' and c.organization_id = s.organization_id
              and (chat.sales_department_role(p_staff) is not null
                   or chat.teachers_department_role(p_staff) is not null))
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

revoke all on function chat.staff_conversation_access(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
revoke all on function chat.guard_trial_group_conversation() from public;
revoke all on function chat.guard_trial_group_member() from public;

-- ===========================================================================
-- 3. Trial cards
-- ===========================================================================

insert into chat.message_card_kind (kind) values
  ('trial_booked'), ('trial_cancelled'), ('trial_report'), ('trial_no_show'), ('trial_decision');
