-- PD-35 (2026-10-26), part 1 -- the VISIBLE SEAT: one primitive for joining a
-- conversation by choice and leaving it again, shared by every feature that
-- needs it (PD-35's teacher supervisors, PD-36's @mentions, a manual join).
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- WHAT IS NEW
--
--   chat.seat_reason        why a seat may be taken, as rows: adding a reason is
--                           an INSERT plus its eligibility function, never an
--                           edit of this file. Each row says whether the seat
--                           itself GRANTS access, whether it may be taken in a
--                           family 1:1, and after how many idle days it ends.
--   chat.conversation_seat  one staff member's seat in one conversation: why,
--                           who, since when, until when and how it ended. The
--                           server writes it through ConversationSeatService
--                           only; it is never deleted.
--   basis 'seated'          chat.staff_conversation_access answers 'seated' for
--                           a seat whose reason grants access, while that
--                           reason's eligibility function still holds -- asked
--                           on EVERY access, so lost eligibility ends access at
--                           once, before any sweep tidies the seat away. It is
--                           the WEAKEST basis: anyone with a PD-8 basis keeps
--                           theirs (and with it PD-14 moderation and the
--                           escalation mode), because the PD-8 decision is
--                           asked first and is unchanged.
--   chat.staff_conversation_standing
--                           the PD-8 decision exactly as it was (the body of
--                           chat.staff_conversation_access before this file),
--                           under a name of its own so an eligibility function
--                           can ask "standing without the seat" without asking
--                           itself.
--
-- WHAT A SEAT IS. In a group: a live, non-silent conversation_member row
-- (member_id), so the seated person is listed, notified and may speak and call
-- as a member (PD-19). In a family-scoped DIRECT -- whose two members are its
-- identity (direct_key; BR-1's trigger caps it at two) -- an EFFECTIVE seat with
-- no member row (member_id null), for reasons that allow it; notifications reach
-- the seated person. A reason that grants access is never allowed in a direct.
--
-- FAIL CLOSED. RLS on, no grant to any request role. The request role reaches
-- these tables only through chat.current_staff_conversation_access (security
-- definer, PD-8).

-- ===========================================================================
-- 1. Reasons
-- ===========================================================================

create table chat.seat_reason (
  reason            text primary key check (reason ~ '^[a-z][a-z_]{1,40}$'),
  -- Does an open seat for this reason make 'seated' an access basis? When false
  -- the seat is presence only: the person needs a PD-8 basis of their own.
  grants_access     boolean not null default false,
  -- May it be taken, as an effective seat, in a family-scoped direct?
  allowed_in_direct boolean not null default false,
  -- (p_staff uuid, p_conversation uuid, p_at timestamptz) returns boolean:
  -- does the seat still hold? Asked on every access (granting reasons) and by
  -- the sweep (every reason).
  eligibility_fn    regprocedure not null,
  -- A seat whose holder wrote nothing here for this many days ends ('idle').
  -- 0 = never.
  idle_days         integer not null default 14 check (idle_days between 0 and 365),
  constraint seat_reason_granting_never_in_direct check (not (grants_access and allowed_in_direct))
);

comment on table chat.seat_reason is
  'PD-35: why a conversation seat may be taken. A reason is a row; its eligibility function decides whether a seat still holds.';

create or replace function chat.guard_seat_reason()
returns trigger
language plpgsql
as $$
declare
  v_args oidvector;
  v_ret  oid;
begin
  select p.proargtypes, p.prorettype into v_args, v_ret from pg_proc p where p.oid = new.eligibility_fn;
  if v_args is distinct from '2950 2950 1184'::oidvector or v_ret is distinct from 'boolean'::regtype then
    raise exception 'a seat eligibility function takes (uuid, uuid, timestamptz) and returns boolean'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger seat_reason_is_coherent before insert or update on chat.seat_reason
  for each row execute function chat.guard_seat_reason();

-- ===========================================================================
-- 2. The PD-8 decision, renamed: standing without any seat
-- ===========================================================================

-- The body of chat.staff_conversation_access as of 20261021130000, unchanged.
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

-- ===========================================================================
-- 3. Seats
-- ===========================================================================

create table chat.conversation_seat (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  conversation_id  uuid not null references chat.conversation (id) on delete cascade,
  staff_id         uuid not null references chat.staff (id),
  reason           text not null references chat.seat_reason (reason),
  -- What the seat came from, when its reason has one (PD-36: the mention).
  source_id        uuid,
  -- The member row the seat opened; null only for an effective seat in a direct.
  member_id        uuid unique references chat.conversation_member (id),
  note             text check (note is null or length(btrim(note)) between 1 and 200),
  joined_at        timestamptz not null default now(),
  -- The holder's last message here (a trigger on chat.message keeps it).
  last_active_at   timestamptz,
  left_at          timestamptz,
  -- left        the holder left
  -- idle        nothing written here for the reason's idle_days
  -- ineligible  the reason's eligibility no longer holds
  -- removed     the member row was ended by someone else (membership edit)
  -- absorbed    the holder became a member in their own right (e.g. the
  --             group's new supervisor); the member row stays theirs
  left_kind        text check (left_kind in ('left', 'idle', 'ineligible', 'removed', 'absorbed')),
  constraint conversation_seat_left_shape check ((left_at is null) = (left_kind is null))
);

comment on table chat.conversation_seat is
  'PD-35: a staff member''s visible seat in a conversation, taken by choice for a reason (chat.seat_reason). Written by the server only; never deleted.';

create unique index conversation_seat_one_open
  on chat.conversation_seat (conversation_id, staff_id) where left_at is null;
create index conversation_seat_staff_open_idx
  on chat.conversation_seat (staff_id) where left_at is null;
create index conversation_seat_open_idx
  on chat.conversation_seat (reason, joined_at) where left_at is null;

create or replace function chat.guard_conversation_seat()
returns trigger
language plpgsql
as $$
declare
  v_staff  chat.staff%rowtype;
  v_conv   record;
  v_reason chat.seat_reason%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Only with its conversation (on delete cascade), never on its own.
    if exists (select 1 from chat.conversation where id = old.conversation_id) then
      raise exception 'a seat is never deleted; it is left' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.left_at is not null then
      raise exception 'a seat that was left is a record' using errcode = 'check_violation';
    end if;
    if (new.id, new.organization_id, new.conversation_id, new.staff_id, new.reason, new.source_id,
        new.member_id, new.note, new.joined_at)
       is distinct from
       (old.id, old.organization_id, old.conversation_id, old.staff_id, old.reason, old.source_id,
        old.member_id, old.note, old.joined_at) then
      raise exception 'only a seat''s activity and its end change' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into v_staff from chat.staff where id = new.staff_id;
  select id, type, family_id, organization_id, archived_at into v_conv
    from chat.conversation where id = new.conversation_id;
  select * into v_reason from chat.seat_reason where reason = new.reason;
  if v_staff.id is null or v_conv.id is null or v_reason.reason is null then
    raise exception 'a seat references a row that does not exist' using errcode = 'foreign_key_violation';
  end if;
  if v_staff.organization_id is distinct from v_conv.organization_id then
    raise exception 'a seat is taken in the staff member''s own organization' using errcode = 'insufficient_privilege';
  end if;
  if not v_staff.is_active or v_staff.left_at is not null
     or v_staff.role not in ('super_admin', 'admin', 'coverage', 'manager') then
    raise exception 'only live conversation staff take a seat' using errcode = 'check_violation';
  end if;
  if v_conv.archived_at is not null then
    raise exception 'an archived conversation takes no seat' using errcode = 'check_violation';
  end if;
  if new.left_at is not null then
    raise exception 'a seat is opened, then left' using errcode = 'check_violation';
  end if;

  if v_conv.type = 'direct' then
    if not v_reason.allowed_in_direct or v_conv.family_id is null then
      raise exception 'this seat cannot be taken in a direct conversation' using errcode = 'check_violation';
    end if;
    if new.member_id is not null then
      raise exception 'a direct conversation''s seat is effective: no member row' using errcode = 'check_violation';
    end if;
  else
    if new.member_id is null or not exists (
      select 1 from chat.conversation_member m
       where m.id = new.member_id and m.conversation_id = new.conversation_id
         and m.actor_kind = 'staff' and m.actor_id = new.staff_id
         and m.left_at is null and not m.is_silent
    ) then
      raise exception 'a seat is the staff member''s own live, visible member row' using errcode = 'check_violation';
    end if;
  end if;

  new.organization_id := v_conv.organization_id;
  new.joined_at := now();
  new.last_active_at := null;
  return new;
end;
$$;

create trigger conversation_seat_is_coherent before insert or update or delete on chat.conversation_seat
  for each row execute function chat.guard_conversation_seat();

-- A member row ended by anything other than the seat service (a membership
-- edit, a sync) ends the seat it carried, so a seat never outlives its row.
create or replace function chat.close_seat_with_member()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if new.left_at is not null and old.left_at is null then
    update chat.conversation_seat set left_at = new.left_at, left_kind = 'removed'
     where member_id = new.id and left_at is null;
  end if;
  return new;
end;
$$;

create trigger conversation_member_closes_seat after update of left_at on chat.conversation_member
  for each row execute function chat.close_seat_with_member();

-- A seat holder's message here is activity: it keeps the seat from going idle.
create or replace function chat.touch_seat_on_message()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if new.author_type = 'staff' and new.author_id is not null and new.conversation_id is not null then
    update chat.conversation_seat set last_active_at = new.created_at
     where conversation_id = new.conversation_id and staff_id = new.author_id and left_at is null;
  end if;
  return new;
end;
$$;

create trigger message_touches_seat after insert on chat.message
  for each row execute function chat.touch_seat_on_message();

-- ===========================================================================
-- 4. Eligibility
-- ===========================================================================

-- Does this open seat still hold? Dispatches to its reason's function.
create or replace function chat.seat_eligible(p_seat uuid, p_at timestamptz default now())
returns boolean
language plpgsql
stable
as $$
declare
  r record;
  v boolean;
begin
  select s.staff_id, s.conversation_id, s.left_at, sr.eligibility_fn into r
    from chat.conversation_seat s
    join chat.seat_reason sr on sr.reason = s.reason
   where s.id = p_seat;
  if r.staff_id is null or r.left_at is not null then return false; end if;
  execute format('select %s($1, $2, $3)', (r.eligibility_fn::oid)::regproc) into v
    using r.staff_id, r.conversation_id, p_at;
  return coalesce(v, false);
end;
$$;

-- The eligibility of a seat that is presence only: the holder's own PD-8
-- standing, which a seat never supplies.
create or replace function chat.seat_eligible_by_standing(p_staff uuid, p_conversation uuid, p_at timestamptz)
returns boolean
language sql
stable
as $$
  select chat.staff_conversation_standing(p_staff, p_conversation, p_at) is not null;
$$;

insert into chat.seat_reason (reason, grants_access, allowed_in_direct, eligibility_fn, idle_days) values
  -- A staff member with a PD-8 basis makes their presence visible.
  ('manual',  false, true, 'chat.seat_eligible_by_standing(uuid, uuid, timestamptz)'::regprocedure, 14),
  -- PD-36: summoned by an @mention. PD-36 adds the "live mention" check to the
  -- API's join policy; staying needs standing, as for a manual seat.
  ('mention', false, true, 'chat.seat_eligible_by_standing(uuid, uuid, timestamptz)'::regprocedure, 14);

-- ===========================================================================
-- 5. THE decision (PD-8), with the seat as its weakest basis
-- ===========================================================================

create or replace function chat.staff_conversation_access(
  p_staff        uuid,
  p_conversation uuid,
  p_at           timestamptz default now()
) returns text
language plpgsql
stable
as $$
declare
  v text;
begin
  -- Any PD-8 basis wins: a manager or a supervisor who also holds a seat stays
  -- a manager or a supervisor.
  v := chat.staff_conversation_standing(p_staff, p_conversation, p_at);
  if v is not null then return v; end if;

  -- PD-35: an open seat whose reason grants access, while it still holds.
  if exists (
    select 1
      from chat.conversation_seat st
      join chat.seat_reason sr on sr.reason = st.reason and sr.grants_access
      join chat.staff s on s.id = st.staff_id
      join chat.conversation c on c.id = st.conversation_id
     where st.staff_id = p_staff and st.conversation_id = p_conversation and st.left_at is null
       and s.is_active and s.left_at is null and s.role in ('admin', 'coverage', 'manager')
       and c.organization_id = s.organization_id
       and chat.seat_eligible(st.id, p_at)
  ) then
    return 'seated';
  end if;
  return null;
end;
$$;

-- The chat list (PD-8), with the caller's open seats as one more candidate set.
-- Still filtered through the exact decision above.
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
                   or chat.teachers_department_role(p_staff) is not null)
           union
           select st.conversation_id from chat.conversation_seat st
            where st.staff_id = p_staff and st.left_at is null)
    select k.id from candidates k
     where chat.staff_conversation_access(p_staff, k.id, p_at) is not null;
end;
$$;

-- ===========================================================================
-- 6. The sweep: seats that no longer hold, or went idle
-- ===========================================================================

-- Ends, in the caller's transaction, at most p_limit open seats that are no
-- longer eligible or whose holder wrote nothing for the reason's idle_days, and
-- returns them. One conditional UPDATE with SKIP LOCKED: safe on every replica
-- at once. The caller ends the member rows, posts the lines and evicts.
create or replace function chat.claim_seat_sweep(p_now timestamptz, p_limit integer)
returns table (seat_id uuid, conversation_id uuid, staff_id uuid, member_id uuid, reason text, left_kind text)
language plpgsql
as $$
begin
  return query
    with due as (
      select s.id,
             case
               when not chat.seat_eligible(s.id, p_now) then 'ineligible'
               when r.idle_days > 0
                    and coalesce(s.last_active_at, s.joined_at) < p_now - make_interval(days => r.idle_days) then 'idle'
             end as kind
        from chat.conversation_seat s
        join chat.seat_reason r on r.reason = s.reason
       where s.left_at is null
       order by s.joined_at
       for update of s skip locked
    ), picked as (
      select d.id, d.kind from due d where d.kind is not null limit p_limit
    )
    update chat.conversation_seat s
       set left_at = p_now, left_kind = p.kind
      from picked p
     where s.id = p.id and s.left_at is null
    returning s.id, s.conversation_id, s.staff_id, s.member_id, s.reason, s.left_kind;
end;
$$;

-- ===========================================================================
-- 7. Fail closed
-- ===========================================================================

alter table chat.seat_reason       enable row level security;
alter table chat.conversation_seat enable row level security;
revoke all on chat.seat_reason, chat.conversation_seat from public, anon, authenticated, chat_app;

revoke all on function chat.guard_seat_reason() from public;
revoke all on function chat.guard_conversation_seat() from public;
revoke all on function chat.close_seat_with_member() from public;
revoke all on function chat.touch_seat_on_message() from public;
revoke all on function chat.seat_eligible(uuid, timestamptz) from public;
revoke all on function chat.seat_eligible_by_standing(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_conversation_standing(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_conversation_access(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_visible_conversation_ids(uuid, timestamptz) from public;
revoke all on function chat.claim_seat_sweep(timestamptz, integer) from public;
