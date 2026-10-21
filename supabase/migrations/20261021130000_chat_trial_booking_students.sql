-- Trial booking with students (2026-10-21, owner decisions in the session
-- "student trial journey"). Builds on 20261021100000_chat_trial_journey.
--
-- OWNER DECISIONS
--
--   * A trial booking may be for SEVERAL students (siblings, or a small group).
--     The supervisor types each student's name, level and note while booking;
--     there is no separate "record a prospect" step. The booking keeps ONE
--     outcome (one chat.trial_outcome per trial lesson), as before.
--   * Operations supervisors work trials exactly like Sales: they book, record
--     every outcome, fill the subscription form, and join or leave trial groups.
--     "The trial desk" = Sales or Operations.
--
-- WHAT IS NEW
--
--   chat.trial_desk_role(staff)  'sales' | 'operations' | NULL
--   chat.trial_student           the students of one booking (its prospect),
--                                in order; written with the booking, never
--                                rewritten. Existing prospects are backfilled
--                                as one student each.
--   chat.trial_prospect          display_name is now the booking's label (the
--                                students' names joined), so it may be longer.
--   moving a trial               a booked trial that has not started can be moved
--                                (time, length, teacher). Like every PD-11 move,
--                                the old row becomes `rescheduled` and the trial
--                                continues as a new row; statistics count it once
--                                (chat.teacher_trial_stats ignores the old row),
--                                and the move is announced by a `trial_rescheduled`
--                                card.
--
-- The three trial-group access functions are redefined from their latest copy
-- (20261019130000) with one change each: Sales becomes the trial desk.

-- ===========================================================================
-- 1. The trial desk
-- ===========================================================================

create or replace function chat.trial_desk_role(p_staff uuid)
returns text
language sql
stable
as $$
  select case
    when chat.sales_department_role(p_staff) is not null then 'sales'
    when chat.operations_department_role(p_staff) is not null then 'operations'
  end;
$$;

revoke all on function chat.trial_desk_role(uuid) from public;

-- ===========================================================================
-- 2. Trial groups: the trial desk is a party (was: Sales)
-- ===========================================================================

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
       or (chat.trial_desk_role(new.actor_id) is null and chat.teachers_department_role(new.actor_id) is null) then
      raise exception 'a trial group admits staff of Sales, Operations or the Teachers department, as admin'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

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
              and (chat.trial_desk_role(p_staff) is not null
                   or chat.teachers_department_role(p_staff) is not null))
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

revoke all on function chat.staff_conversation_access(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
revoke all on function chat.guard_trial_group_member() from public;

-- ===========================================================================
-- 3. The students of a booking
-- ===========================================================================

alter table chat.trial_prospect drop constraint trial_prospect_display_name_check;
alter table chat.trial_prospect add constraint trial_prospect_display_name_check
  check (length(btrim(display_name)) between 1 and 600);

comment on table chat.trial_prospect is
  'PD-11 T4 / trial booking: the party a trial is booked for -- one or more students (chat.trial_student), by display name only (BR-2). display_name is their names joined, for cards and lists.';

create table chat.trial_student (
  id               uuid primary key default gen_random_uuid(),
  prospect_id      uuid not null references chat.trial_prospect (id),
  organization_id  uuid not null references chat.organization (id),
  position         smallint not null check (position between 1 and 10),
  display_name     text not null check (length(btrim(display_name)) between 1 and 120),
  level            text check (level is null or length(btrim(level)) between 1 and 80),
  note             text check (note is null or length(btrim(note)) between 1 and 1000),
  created_at       timestamptz not null default now(),
  constraint trial_student_position_unique unique (prospect_id, position)
);

comment on table chat.trial_student is
  'Trial booking: one student of a trial booking, by display name only (BR-2). Written with the booking, never rewritten or deleted.';

create or replace function chat.guard_trial_student()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a trial''s students are written with the booking and never changed' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from chat.trial_prospect p where p.id = new.prospect_id and p.organization_id = new.organization_id
  ) then
    raise exception 'a trial student belongs to its booking''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger trial_student_is_kept
  before insert or update or delete on chat.trial_student
  for each row execute function chat.guard_trial_student();

-- Every existing booking: its one student, as it was recorded.
insert into chat.trial_student (prospect_id, organization_id, position, display_name, level, note, created_at)
select p.id, p.organization_id, 1, p.display_name, p.level, p.note, p.created_at
  from chat.trial_prospect p;

alter table chat.trial_student enable row level security;
revoke all on chat.trial_student from public, anon, authenticated, chat_app;
revoke all on function chat.guard_trial_student() from public;

-- ===========================================================================
-- 4. Moving a trial
-- ===========================================================================

insert into chat.message_card_kind (kind) values ('trial_rescheduled');

-- chat.teacher_trial_stats as 20261021100000, with one line: the old row of a
-- moved trial is not a trial of its own.
create or replace function chat.teacher_trial_stats(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (teacher_id uuid, total int, conducted int, subscribed int, not_subscribed int,
               no_show int, awaiting int, upcoming int, cancelled int)
language sql
stable
as $$
  with t as (
    select l.teacher_id,
           l.outcome = 'held' as attended,
           case
             when o.result is not null then o.result
             when l.outcome = 'student_no_show' then 'no_show'
             when l.outcome is null and l.starts_at > now() then 'upcoming'
             when l.outcome is null or l.outcome = 'held' then 'awaiting'
             else 'cancelled'
           end as result
      from chat.lesson l
      left join chat.trial_outcome o on o.lesson_id = l.id
     where l.kind = 'trial' and l.organization_id = p_org
       and l.starts_at >= p_from and l.starts_at < p_to
       -- A moved trial is counted once, as its new row.
       and l.outcome is distinct from 'rescheduled'
  )
  select teacher_id,
         count(*) filter (where result in ('subscribed', 'not_subscribed', 'no_show', 'awaiting'))::int,
         count(*) filter (where attended)::int,
         count(*) filter (where result = 'subscribed')::int,
         count(*) filter (where result = 'not_subscribed')::int,
         count(*) filter (where result = 'no_show')::int,
         count(*) filter (where result = 'awaiting')::int,
         count(*) filter (where result = 'upcoming')::int,
         count(*) filter (where result = 'cancelled')::int
    from t
   group by teacher_id;
$$;

revoke all on function chat.teacher_trial_stats(uuid, timestamptz, timestamptz) from public, anon, authenticated, chat_app;
