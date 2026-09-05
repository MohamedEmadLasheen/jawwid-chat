-- Jawwid Chat -- the coverage engine (brief SS4).
--
-- chat.on_duty(family, at) is a direct transcription of the brief's pseudocode.
-- It is the ONLY function in this schema that decides who handles a family.
-- Brief SS12: "No code path assigns a message/family to a staff member other
-- than via on_duty() (+ stickiness, assist, escalation - all logged with
-- reason)." Stickiness is applied by chat.effective_handler(), which wraps
-- on_duty() rather than replacing it.
--
-- Returning NULL is a real answer, not a failure: nobody is on duty, the family
-- is Unattended, and the manager is alerted. Brief SS4: "Never silently assigned."

-- Wall-clock helpers -------------------------------------------------------

create or replace function chat.local_at(p_at timestamptz)
returns timestamp
language sql
stable
as $$ select p_at at time zone chat.config_text('schedule.timezone') $$;

comment on function chat.local_at is
  'Every shift, coverage and absence comparison happens in the operational '
  'timezone from chat.config, never in the server timezone.';

-- True when a local wall-clock instant falls inside a recurring day/time window.
-- A window whose end is at or before its start wraps past midnight and is
-- anchored to the day it started on (so a Thursday 17:00-01:00 shift is still
-- "Thursday" at 00:30 on Friday). Half-open: [from, to).
create or replace function chat.window_contains(
  p_local timestamp,
  p_days  smallint[],
  p_from  time,
  p_to    time
) returns boolean
language sql
immutable
as $$
  select case
    when p_from < p_to then
      extract(dow from p_local)::smallint = any (p_days)
      and p_local::time >= p_from
      and p_local::time <  p_to
    else
      -- Wraps midnight: either late on a listed day, or early on the day after.
      (extract(dow from p_local)::smallint = any (p_days) and p_local::time >= p_from)
      or (((extract(dow from p_local)::integer + 6) % 7)::smallint = any (p_days)
          and p_local::time < p_to)
  end
$$;

-- Shifts and absences ------------------------------------------------------

create or replace function chat.in_shift(p_staff_id uuid, p_at timestamptz)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from chat.shift s
    where s.staff_id = p_staff_id
      and chat.local_at(p_at)::date >= s.valid_from
      and (s.valid_to is null or chat.local_at(p_at)::date <= s.valid_to)
      and chat.window_contains(chat.local_at(p_at), s.days, s.starts, s.ends)
  )
$$;

create or replace function chat.is_absent(p_staff_id uuid, p_at timestamptz)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from chat.absence a
    where a.staff_id = p_staff_id
      and p_at >= a.from_at
      and p_at <  a.to_at
  )
$$;

-- The backup named on the absence that is currently in force. Most recently
-- starting absence wins if they overlap.
create or replace function chat.absence_backup(p_staff_id uuid, p_at timestamptz)
returns uuid
language sql
stable
as $$
  select a.backup_id
  from chat.absence a
  where a.staff_id = p_staff_id
    and p_at >= a.from_at
    and p_at <  a.to_at
  order by a.from_at desc
  limit 1
$$;

-- The chain ----------------------------------------------------------------
-- [owner] + coverage_rules(owner, now) sorted by priority (brief SS4).

create or replace function chat.coverage_chain(p_owner_id uuid, p_at timestamptz)
returns table (staff_id uuid, chain_position integer, rule_id uuid)
language sql
stable
as $$
  with local as (select chat.local_at(p_at) as l)
  select p_owner_id, 0, null::uuid
  union all
  select r.covering_id,
         row_number() over (order by r.priority, r.created_at, r.id)::integer,
         r.id
  from chat.coverage_rule r
  cross join local
  join chat.staff cs on cs.id = r.covering_id and cs.is_active
  where (r.covered_id = p_owner_id or r.covered_id is null)
    and local.l::date >= r.valid_from
    and (r.valid_to is null or local.l::date <= r.valid_to)
    and extract(dow from local.l)::smallint = any (r.days)
    and case r.window_mode
          when 'all_day' then true
          when 'custom'  then chat.window_contains(local.l, r.days, r.custom_from, r.custom_to)
          when 'outside_owner_shift' then not chat.in_shift(p_owner_id, p_at)
        end
  order by 2
$$;

comment on function chat.coverage_chain is
  'Inactive covering staff are skipped so an offboarded admin can never be '
  'returned by on_duty(). The rule stays in the table and is surfaced to the '
  'manager as an orphaned coverage rule (brief SS8 offboarding).';

-- on_duty ------------------------------------------------------------------

create or replace function chat.on_duty(p_family_id uuid, p_at timestamptz default now())
returns uuid
language plpgsql
stable
as $$
declare
  v_owner  uuid;
  v_link   record;
  v_backup uuid;
begin
  select owner_id into v_owner from chat.family where id = p_family_id;
  if v_owner is null then
    return null;
  end if;

  for v_link in select staff_id from chat.coverage_chain(v_owner, p_at) loop
    -- The owner is in the chain at position 0 but may have been deactivated
    -- between offboarding and reassignment; never return inactive staff.
    if not exists (select 1 from chat.staff s
                   where s.id = v_link.staff_id and s.is_active) then
      continue;
    end if;

    if chat.is_absent(v_link.staff_id, p_at) then
      v_backup := chat.absence_backup(v_link.staff_id, p_at);
      if v_backup is not null
         and not chat.is_absent(v_backup, p_at)
         and chat.in_shift(v_backup, p_at) then
        return v_backup;
      end if;
      continue;
    end if;

    if chat.in_shift(v_link.staff_id, p_at) then
      return v_link.staff_id;
    end if;
  end loop;

  -- Nobody on duty -> Unattended list + manager alert.
  return null;
end;
$$;

-- Stickiness ---------------------------------------------------------------
-- Brief SS4: a staff member who replied within the grace window and is still
-- online keeps the thread past shift end.

create or replace function chat.effective_handler(p_family_id uuid, p_at timestamptz default now())
returns uuid
language plpgsql
stable
as $$
declare
  v_sticky uuid;
begin
  select t.sticky_handler_id into v_sticky
  from chat.thread t
  join chat.staff s on s.id = t.sticky_handler_id
  where t.family_id = p_family_id
    and t.sticky_until > p_at
    and s.is_active
    and s.presence = 'online';

  if v_sticky is not null then
    return v_sticky;
  end if;

  return chat.on_duty(p_family_id, p_at);
end;
$$;

comment on function chat.effective_handler is
  'on_duty() plus the stickiness override. Inbox queries and the state cache '
  'use this; anything reasoning about the roster itself uses on_duty() directly.';

-- Applied when a staff member replies, so stickiness is set from one place.
create or replace function chat.extend_stickiness(p_thread_id uuid, p_staff_id uuid)
returns void
language sql
as $$
  update chat.thread
     set sticky_handler_id = p_staff_id,
         sticky_until = now() + make_interval(mins => chat.config_int('handoff.grace_minutes'))
   where id = p_thread_id;
$$;
