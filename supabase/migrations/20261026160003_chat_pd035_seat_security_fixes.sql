-- PD-35 (2026-10-26), seat security fixes -- from the department head's
-- security review of the visible seat (20261026160000), merged before the
-- review landed. Fixed forward; nothing is reverted.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- P1-1  A seat's member row is presence, never PD-8 standing. The "everything
--       else" branch of chat.staff_conversation_standing counted the seat's
--       own live staff row through staff_acts_for(holder, holder) = 'self',
--       so in an official or class-group conversation a seat:
--         * held itself up -- a backup whose link ended kept the conversation
--           as 'member', and the ineligible sweep never fired;
--         * lent access to everyone who acts for its holder (their backups,
--           their department manager);
--         * could turn a seated manager into a plain 'member', depending on
--           the order the rows were read in.
--       Both functions below now skip member rows that carry an open seat.
--       Otherwise they are 20261026160000's, unchanged.
--
-- (P1-2, P2-1, P2-2 and P2-3 are fixed in the API in the same change.)

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
    return case when chat.trial_desk_role(p_staff) is not null
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
  -- PD-35: never through a member row a seat opened. A seat is presence, not
  -- standing: counted here it would hold itself up (the holder would keep the
  -- conversation after their own basis ended) and lend access to everyone who
  -- acts for its holder.
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
           select st.conversation_id from chat.conversation_seat st
            where st.staff_id = p_staff and st.left_at is null)
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

revoke all on function chat.staff_conversation_standing(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
