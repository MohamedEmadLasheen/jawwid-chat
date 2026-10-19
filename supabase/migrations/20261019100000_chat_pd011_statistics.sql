-- PD-9 / PD-11 T5 (2026-10-19) -- teacher statistics.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, PD-9 ("statistics are
-- queries over lesson rows, never stored counters") and PD-11.
--
-- ONE DEFINITION PER NUMBER. Every figure the Admin Web statistics page, the
-- teacher's own workload and any export shows is read from these functions, so
-- two screens can never disagree about what "held" or "on time" means. Nothing
-- here stores a count.
--
-- A period is [p_from, p_to) as instants; the caller turns a calendar month in
-- the academy's zone into instants (StatsService).

-- ===========================================================================
-- 1. Lessons by category, kind and length
-- ===========================================================================

-- The category of one lesson at the moment of asking:
--   held | student_apology | teacher_apology | student_no_show | teacher_no_show
--   | admin_cancelled           -- closed, and counted
--   | upcoming | unreported     -- still open: not started yet / ended without an outcome
--   | rescheduled | suspended   -- replaced or paused: shown for information,
--                                  never counted for or against anyone
create or replace function chat.lesson_category(p_outcome text, p_starts_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_outcome is not null then p_outcome
    when p_starts_at > now() then 'upcoming'
    else 'unreported'
  end;
$$;

create or replace function chat.teacher_lesson_stats(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  teacher_id uuid,
  category text,
  kind text,
  duration_minutes integer,
  lessons integer,
  minutes integer
)
language sql
stable
as $$
  select l.teacher_id,
         chat.lesson_category(l.outcome, l.starts_at) as category,
         l.kind,
         (extract(epoch from (l.ends_at - l.starts_at)) / 60)::integer as duration_minutes,
         count(*)::integer as lessons,
         sum(extract(epoch from (l.ends_at - l.starts_at)) / 60)::integer as minutes
    from chat.lesson l
   where l.organization_id = p_org
     and l.starts_at >= p_from and l.starts_at < p_to
   group by 1, 2, 3, 4;
$$;

-- ===========================================================================
-- 2. Report timeliness
-- ===========================================================================

-- A held lesson's report is ON TIME when it was submitted within p_grace of the
-- lesson's end. (A report is required for every held lesson: chat.lesson_held_has_report.)
create or replace function chat.teacher_report_timeliness(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_grace interval
)
returns table (teacher_id uuid, reports integer, on_time integer, median_delay_minutes integer)
language sql
stable
as $$
  select l.teacher_id,
         count(*)::integer,
         count(*) filter (where r.submitted_at <= l.ends_at + p_grace)::integer,
         (percentile_cont(0.5) within group (
            order by greatest(0, extract(epoch from (r.submitted_at - l.ends_at)) / 60)))::integer
    from chat.lesson l
    join chat.lesson_report r on r.lesson_id = l.id
   where l.organization_id = p_org
     and l.starts_at >= p_from and l.starts_at < p_to
   group by l.teacher_id;
$$;

-- ===========================================================================
-- 3. Reply time to families
-- ===========================================================================

-- For each published message a CONTACT wrote in a group the teacher is a live
-- member of, the time until the teacher's next published message in that same
-- conversation. A message the teacher never answered counts as unanswered.
-- Only Chat can measure this; Core never saw the conversation.
create or replace function chat.teacher_reply_times(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_within interval
)
returns table (teacher_id uuid, family_messages integer, answered_within integer, median_reply_minutes integer)
language sql
stable
as $$
  with asked as (
    select m.teacher_id, msg.id, msg.conversation_id, msg.created_at
      from chat.message msg
      join chat.conversation c on c.id = msg.conversation_id
                              and c.type in ('student_group', 'family_group')
                              and c.organization_id = p_org
      join lateral (
        select cm.actor_id as teacher_id from chat.conversation_member cm
         where cm.conversation_id = msg.conversation_id and cm.actor_kind = 'teacher' and cm.left_at is null
      ) m on true
     where msg.author_type = 'contact'
       and msg.moderation = 'published'
       and msg.visibility = 'customer'
       and msg.deleted_for_all = false
       and msg.created_at >= p_from and msg.created_at < p_to
  ), answered as (
    select a.teacher_id, a.id,
           (select min(r.created_at) from chat.message r
             where r.conversation_id = a.conversation_id
               and r.author_type = 'teacher' and r.author_id = a.teacher_id
               and r.moderation = 'published'
               and r.created_at > a.created_at) - a.created_at as wait
      from asked a
  )
  select teacher_id,
         count(*)::integer,
         count(*) filter (where wait is not null and wait <= p_within)::integer,
         (percentile_cont(0.5) within group (order by extract(epoch from wait) / 60)
            filter (where wait is not null))::integer
    from answered
   group by teacher_id;
$$;

-- ===========================================================================
-- 4. Available working time (PD-9 "available scheduled hours")
-- ===========================================================================

-- Minutes of the teacher's weekly windows over the calendar days [p_from_day,
-- p_to_day) in the teacher's own zone, minus dated days off.
create or replace function chat.teacher_available_minutes(p_teacher uuid, p_from_day date, p_to_day date)
returns integer
language sql
stable
as $$
  select coalesce(sum(a.end_minute - a.start_minute), 0)::integer
    from generate_series(p_from_day, p_to_day - 1, interval '1 day') d
    join chat.teacher_availability a
      on a.teacher_id = p_teacher and a.weekday = extract(isodow from d)
   where not exists (select 1 from chat.teacher_day_off o where o.teacher_id = p_teacher and o.day = d::date);
$$;

revoke all on function chat.lesson_category(text, timestamptz) from public;
revoke all on function chat.teacher_lesson_stats(uuid, timestamptz, timestamptz) from public;
revoke all on function chat.teacher_report_timeliness(uuid, timestamptz, timestamptz, interval) from public;
revoke all on function chat.teacher_reply_times(uuid, timestamptz, timestamptz, interval) from public;
revoke all on function chat.teacher_available_minutes(uuid, date, date) from public;
