-- PD-38 (2026-10-26): the academy scheduling calendar -- shifts, supervisor
-- colors, and ONE definition of a teacher's capacity.
--
--   1. chat.teacher_work_pattern + chat.teacher_work_window
--                                a teacher's category (full shift, part shift,
--                                hourly) and shift windows, effective-dated and
--                                append-only like learner_schedule_slot: a change
--                                closes the row in force and adds a new one, so a
--                                past month keeps the shift it was worked under.
--                                An hourly teacher's working hours are their
--                                availability (PD-11), never a second table.
--   2. chat.staff_calendar_color  an Operations supervisor's color: a key of the
--                                curated palette (each key has an AA-checked text
--                                color in the clients), never a free hex. Data, not
--                                code: no staff name appears in any source (G-20).
--   3. lesson_org_starts_idx     the academy-wide window, bounded by org + start.
--   4. chat.calendar_status      trial | active | paused | moved | void.
--      chat.calendar_capacity    per teacher and viewer-zone day: shift, working
--                                hours, leave, booked, paused, and what is left --
--                                multirange arithmetic, so overlapping lessons are
--                                merged and nothing is counted twice. The calendar's
--                                red blocks and every statistic read this one
--                                function, so they cannot disagree.
--      chat.mr_minutes / chat.mr_json  a multirange as minutes / as [[from, to], ...].

-- ===========================================================================
-- 1. Work patterns
-- ===========================================================================

create table chat.teacher_work_pattern (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id) on delete cascade,
  category         text not null check (category in ('full_shift', 'part_shift', 'hourly')),
  timezone         text not null,
  valid_from       date not null,
  valid_to         date,                          -- exclusive; null = open-ended
  reason           text check (reason is null or length(btrim(reason)) between 1 and 500),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  -- valid_to = valid_from is a pattern replaced before it began: it covers nothing.
  constraint teacher_work_pattern_has_a_span check (valid_to is null or valid_to >= valid_from),
  constraint teacher_work_pattern_periods_do_not_overlap
    exclude using gist (teacher_id with =, daterange(valid_from, valid_to) with &&)
);

comment on table chat.teacher_work_pattern is
  'PD-38: a teacher''s category and (for a shift) shift windows from valid_from. Never edited except to close it; a change is a new row.';

create index teacher_work_pattern_teacher_idx on chat.teacher_work_pattern (teacher_id, valid_from);

create table chat.teacher_work_window (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  pattern_id       uuid not null references chat.teacher_work_pattern (id) on delete cascade,
  weekday          smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_minute     integer not null check (start_minute between 0 and 1439),
  end_minute       integer not null check (end_minute between 1 and 1440),
  constraint teacher_work_window_is_a_window check (end_minute > start_minute),
  constraint teacher_work_windows_do_not_overlap
    exclude using gist (pattern_id with =, weekday with =, int4range(start_minute, end_minute) with &&)
);

comment on table chat.teacher_work_window is
  'PD-38: one shift window of a work pattern, wall-clock minutes in the pattern''s time zone. Written with its pattern, never after.';

create index teacher_work_window_pattern_idx on chat.teacher_work_window (pattern_id, weekday);

create or replace function chat.guard_teacher_work_pattern()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as part of deleting the teacher (the cascade runs after the teacher row is gone).
    if not exists (select 1 from chat.teacher t where t.id = old.teacher_id) then
      return old;
    end if;
    raise exception 'a work pattern is closed, never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    -- The one change: closing an open pattern, on or after the day it began.
    if old.valid_to is not null or new.valid_to is null
       or (new.id, new.organization_id, new.teacher_id, new.category, new.timezone, new.valid_from,
           new.reason, new.created_by, new.created_at)
          is distinct from
          (old.id, old.organization_id, old.teacher_id, old.category, old.timezone, old.valid_from,
           old.reason, old.created_by, old.created_at) then
      raise exception 'a work pattern is closed by setting valid_to, nothing else' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if not chat.is_time_zone(new.timezone) then
    raise exception 'unknown time zone %', new.timezone using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
    raise exception 'a work pattern belongs to the teacher''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teacher_work_pattern_is_coherent before insert or update or delete on chat.teacher_work_pattern
  for each row execute function chat.guard_teacher_work_pattern();

create or replace function chat.guard_teacher_work_window()
returns trigger
language plpgsql
as $$
declare
  v_pattern chat.teacher_work_pattern%rowtype;
begin
  if tg_op = 'DELETE' and not exists (select 1 from chat.teacher_work_pattern p where p.id = old.pattern_id) then
    return old;  -- its pattern's cascade
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'a shift window is written with its pattern, never edited' using errcode = 'check_violation';
  end if;
  select * into v_pattern from chat.teacher_work_pattern where id = new.pattern_id;
  if v_pattern.organization_id is distinct from new.organization_id then
    raise exception 'a shift window belongs to its pattern''s organization' using errcode = 'insufficient_privilege';
  end if;
  if v_pattern.category = 'hourly' then
    raise exception 'an hourly teacher''s working hours are their availability' using errcode = 'check_violation';
  end if;
  -- now() is the transaction's start: only the transaction that wrote the
  -- pattern may give it windows.
  if v_pattern.created_at <> now() then
    raise exception 'a shift window is written with its pattern' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger teacher_work_window_is_coherent before insert or update or delete on chat.teacher_work_window
  for each row execute function chat.guard_teacher_work_window();

-- ===========================================================================
-- 2. Supervisor colors
-- ===========================================================================

create table chat.staff_calendar_color (
  staff_id         uuid primary key references chat.staff (id) on delete cascade,
  organization_id  uuid not null references chat.organization (id),
  -- The curated palette (apps/admin-web .../schedule/palette.ts holds the fills,
  -- borders and AA text colors for each key, light and dark).
  color_key        text not null check (color_key in (
                     'sky', 'red', 'peach', 'green', 'purple', 'teal',
                     'amber', 'pink', 'indigo', 'olive', 'brown', 'slate')),
  set_by           uuid not null references chat.staff (id),
  set_at           timestamptz not null default now()
);

comment on table chat.staff_calendar_color is
  'PD-38: the color that marks a supervisor''s students'' lessons on the calendar. A palette key, set by the Operations Manager or the super admin.';

create or replace function chat.guard_staff_calendar_color()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if not exists (select 1 from chat.staff s where s.id = new.staff_id and s.organization_id = new.organization_id)
     or not exists (select 1 from chat.staff s where s.id = new.set_by and s.organization_id = new.organization_id) then
    raise exception 'a calendar color belongs to the staff member''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger staff_calendar_color_is_coherent before insert or update or delete on chat.staff_calendar_color
  for each row execute function chat.guard_staff_calendar_color();

-- ===========================================================================
-- 3. The academy-wide window
-- ===========================================================================

create index lesson_org_starts_idx on chat.lesson (organization_id, starts_at)
  include (teacher_id, learner_id, prospect_id, ends_at, outcome, kind);

-- ===========================================================================
-- 4. One definition per number
-- ===========================================================================

-- What a lesson is on the calendar. `moved` (the old row of a moved lesson) and
-- `void` hold no time; `paused` (a staff suspension or a PD-30 payment hold)
-- keeps its slot but is not taught.
create or replace function chat.calendar_status(p_kind text, p_outcome text)
returns text
language sql
immutable
as $$
  select case
    when p_outcome = 'rescheduled' then 'moved'
    when p_outcome = 'voided' then 'void'
    when p_outcome = 'suspended' then 'paused'
    when p_kind = 'trial' then 'trial'
    else 'active'
  end;
$$;

create or replace function chat.mr_minutes(p tstzmultirange)
returns integer
language sql
immutable
as $$
  select coalesce(round(sum(extract(epoch from upper(r) - lower(r))) / 60), 0)::integer
    from unnest(p) r;
$$;

create or replace function chat.mr_json(p tstzmultirange)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_array(lower(r), upper(r)) order by lower(r)), '[]'::jsonb)
    from unnest(p) r;
$$;

-- The lessons that hold calendar time in [p_from, p_to): every status but
-- `void`, and not a PD-30 payment hold whose slot was filled again after the
-- unlock (history, not a second lesson at that time -- as GET /lessons).
create or replace function chat.calendar_lessons(p_org uuid, p_teachers uuid[], p_from timestamptz, p_to timestamptz)
returns setof chat.lesson
language sql
stable
as $$
  select l.*
    from chat.lesson l
   where l.organization_id = p_org
     and (p_teachers is null or l.teacher_id = any (p_teachers))
     -- A lesson lasts at most 4 hours (lesson_has_a_duration): the index bounds the scan.
     and l.starts_at >= p_from - interval '4 hours' and l.starts_at < p_to
     and l.ends_at > p_from
     and chat.calendar_status(l.kind, l.outcome) <> 'void'
     -- CASE, not AND: with a NULL outcome `NOT (NULL AND EXISTS ...)` still
     -- runs the subquery, once per lesson of the window (17 s for a month of
     -- 100 teachers). Only a system hold ever asks.
     and case when l.outcome = 'suspended' and l.outcome_by_kind = 'system' and l.schedule_slot_id is not null
              then not exists (select 1 from chat.lesson x
                                where x.schedule_slot_id = l.schedule_slot_id and x.starts_at = l.starts_at
                                  and x.id <> l.id and (x.outcome is null or x.outcome <> 'suspended'))
              else true end;
$$;

-- A teacher's capacity per day of the viewer's zone (p_zone), over the days
-- [p_from, p_to). Shift windows and working hours are wall-clock times in the
-- teacher's zone, made instants in Postgres (DST is the database's job), then
-- cut into the viewer's days. Per (teacher, day):
--
--   shift      the shift windows (full / part shift), or empty
--   work       working hours = availability (hourly, or no pattern yet), or empty
--   leave      approved leave and days off, whole local days
--   booked     every lesson reserved for a student (active + trial, whatever its
--              outcome) -- overlaps merged
--   paused     paused lessons' time not also booked
--   in_shift_booked / in_shift_paused / in_shift_leave / empty
--              a partition of the shift: booked first, then paused, then leave;
--              empty is what is left -- the calendar's red
--   free       the same remainder of working hours (hourly; not red)
--   outside    booked time outside the shift and the working hours
--
-- Utilization = in_shift_booked / (shift - in_shift_leave).
create or replace function chat.calendar_capacity(p_org uuid, p_teachers uuid[], p_from date, p_to date, p_zone text)
returns table (
  teacher_id      uuid,
  day             date,
  category        text,
  shift           tstzmultirange,
  work            tstzmultirange,
  leave           tstzmultirange,
  booked          tstzmultirange,
  paused          tstzmultirange,
  in_shift_booked tstzmultirange,
  in_shift_paused tstzmultirange,
  in_shift_leave  tstzmultirange,
  empty           tstzmultirange,
  free            tstzmultirange,
  outside         tstzmultirange
)
language sql
stable
-- JIT compiling this plan cost ~420 ms against ~45 ms of work (a month of 100
-- teachers, PG 17): many small multirange operations, nothing to vectorize.
-- (Only here: a SET clause stops a SQL function being inlined, and
-- chat.calendar_lessons must stay inlinable to keep its index scan.)
set jit = off
as $$
  with span as (
    select (p_from::timestamp at time zone p_zone) as lo, (p_to::timestamp at time zone p_zone) as hi
  ),
  teachers as (
    select t.id,
           (select min(a.timezone) from chat.teacher_availability a where a.teacher_id = t.id) as avail_tz
      from chat.teacher t
     where t.organization_id = p_org
       and (p_teachers is null or t.id = any (p_teachers))
  ),
  -- Every teacher's local days around the span (a day either side covers any
  -- zone offset), with the pattern in force that day.
  local_days as (
    select t.id as teacher_id, ld::date as ld, p.id as pattern_id,
           coalesce(p.category, 'unset') as category,
           coalesce(p.timezone, t.avail_tz, p_zone) as tz,
           t.avail_tz
      from teachers t
     cross join generate_series(p_from - 2, p_to + 1, interval '1 day') ld
      left join chat.teacher_work_pattern p
        on p.teacher_id = t.id and p.valid_from <= ld::date and (p.valid_to is null or ld::date < p.valid_to)
  ),
  shift_pieces as (
    select d.teacher_id,
           tstzrange((d.ld + make_interval(mins => w.start_minute)) at time zone d.tz,
                     (d.ld + make_interval(mins => w.end_minute)) at time zone d.tz) as r
      from local_days d
      join chat.teacher_work_window w on w.pattern_id = d.pattern_id and w.weekday = extract(isodow from d.ld)
     where d.category in ('full_shift', 'part_shift')
  ),
  work_pieces as (
    select d.teacher_id,
           tstzrange((d.ld + make_interval(mins => a.start_minute)) at time zone a.timezone,
                     (d.ld + make_interval(mins => a.end_minute)) at time zone a.timezone) as r
      from local_days d
      join chat.teacher_availability a on a.teacher_id = d.teacher_id and a.weekday = extract(isodow from d.ld)
     where d.category in ('hourly', 'unset')
  ),
  leave_pieces as (
    select d.teacher_id,
           tstzrange(d.ld::timestamp at time zone d.tz, (d.ld + 1)::timestamp at time zone d.tz) as r
      from local_days d
     where exists (select 1 from chat.teacher_day_off o where o.teacher_id = d.teacher_id and o.day = d.ld)
        or exists (select 1 from chat.teacher_leave_request q
                    where q.teacher_id = d.teacher_id and q.state = 'approved'
                      and d.ld between q.first_day and q.last_day)
  ),
  lessons as (
    select l.teacher_id, tstzrange(l.starts_at, l.ends_at) as r, chat.calendar_status(l.kind, l.outcome) as st
      from span, chat.calendar_lessons(p_org, p_teachers, span.lo, span.hi) l
  ),
  shift_t as (select s.teacher_id, range_agg(s.r) as m from shift_pieces s group by s.teacher_id),
  work_t as (select w.teacher_id, range_agg(w.r) as m from work_pieces w group by w.teacher_id),
  leave_t as (select v.teacher_id, range_agg(v.r) as m from leave_pieces v group by v.teacher_id),
  lessons_t as (
    select l.teacher_id,
           range_agg(l.r) filter (where l.st in ('active', 'trial')) as booked,
           range_agg(l.r) filter (where l.st = 'paused') as paused
      from lessons l
     group by l.teacher_id
  ),
  per_teacher as (
    select t.id as teacher_id,
           coalesce(s.m, '{}'::tstzmultirange) as shift,
           coalesce(w.m, '{}'::tstzmultirange) as work,
           coalesce(v.m, '{}'::tstzmultirange) as leave,
           coalesce(l.booked, '{}'::tstzmultirange) as booked,
           coalesce(l.paused, '{}'::tstzmultirange) as paused
      from teachers t
      left join shift_t s on s.teacher_id = t.id
      left join work_t w on w.teacher_id = t.id
      left join leave_t v on v.teacher_id = t.id
      left join lessons_t l on l.teacher_id = t.id
  ),
  cut as (
    select pt.teacher_id, b.day,
           pt.shift * b.r as shift,
           pt.work * b.r as work,
           pt.leave * b.r as leave,
           pt.booked * b.r as booked,
           (pt.paused - pt.booked) * b.r as paused
      from per_teacher pt
     cross join (
       select d::date as day,
              tstzmultirange(tstzrange(d::date::timestamp at time zone p_zone, (d::date + 1)::timestamp at time zone p_zone)) as r
         from generate_series(p_from, p_to - 1, interval '1 day') d
     ) b
  )
  select c.teacher_id, c.day,
         coalesce((select p.category from chat.teacher_work_pattern p
                    where p.teacher_id = c.teacher_id and p.valid_from <= c.day
                      and (p.valid_to is null or c.day < p.valid_to)), 'unset') as category,
         c.shift, c.work, c.leave, c.booked, c.paused,
         c.booked * c.shift as in_shift_booked,
         c.paused * c.shift as in_shift_paused,
         (c.leave * c.shift) - c.booked - c.paused as in_shift_leave,
         c.shift - c.booked - c.paused - c.leave as empty,
         c.work - c.booked - c.paused - c.leave as free,
         c.booked - c.shift - c.work as outside
    from cut c;
$$;

-- ===========================================================================
-- Grants: server-side only, like the PD-11 statistics functions
-- ===========================================================================

alter table chat.teacher_work_pattern enable row level security;
alter table chat.teacher_work_window enable row level security;
alter table chat.staff_calendar_color enable row level security;
revoke all on chat.teacher_work_pattern, chat.teacher_work_window, chat.staff_calendar_color
  from public, anon, authenticated, chat_app;

revoke all on function chat.guard_teacher_work_pattern() from public;
revoke all on function chat.guard_teacher_work_window() from public;
revoke all on function chat.guard_staff_calendar_color() from public;
revoke all on function chat.calendar_status(text, text) from public;
revoke all on function chat.mr_minutes(tstzmultirange) from public;
revoke all on function chat.mr_json(tstzmultirange) from public;
revoke all on function chat.calendar_lessons(uuid, uuid[], timestamptz, timestamptz) from public;
revoke all on function chat.calendar_capacity(uuid, uuid[], date, date, text) from public;
