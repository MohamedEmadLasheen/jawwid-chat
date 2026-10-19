-- PD-11 T2 (2026-10-18) -- availability, regular lesson times, make-ups and the
-- make-up follow-up.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, PD-9 and PD-11.
--
-- WHAT IS NEW
--
--   chat.teacher_availability    a teacher's weekly working windows, in the
--                                teacher's own time zone (PD-9: new, not the
--                                frozen chat.shift)
--   chat.teacher_day_off         dated extra days off
--   chat.learner_schedule_slot   a learner's regular weekly lesson time. Lessons
--                                are MATERIALIZED from it a few weeks ahead by
--                                chat.materialize_lessons(); a slot is ended,
--                                never edited or deleted
--   chat.schedule_change_request a family's request to change the regular times;
--                                a Teachers-department supervisor decides it
--   chat.teacher_free_slots()          free start times for a make-up
--   chat.teacher_free_weekly_slots()   free regular weekly times
--
-- WHAT CHANGES
--
--   chat.lesson   may be created by a contact (a make-up the family booked) or
--                 by the system (materialized); gains schedule_slot_id and the
--                 outcome `rescheduled` -- a future lesson replaced by a schedule
--                 change, which statistics do not count; one live make-up per
--                 missed lesson.
--   chat.lesson_ruling  gains `makeup_followup`: what a supervisor did about a
--                 teacher-cancelled lesson that no make-up replaced.
--
-- TIME. Weekly times are wall-clock times in the TEACHER's IANA zone and become
-- instants through Postgres's own `at time zone`, so a daylight-saving change
-- moves nothing that a family sees.

-- ===========================================================================
-- 0. Time zones
-- ===========================================================================

create or replace function chat.is_time_zone(p_tz text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_timezone_names where name = p_tz);
$$;

-- ===========================================================================
-- 1. Availability and days off
-- ===========================================================================

create table chat.teacher_availability (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  weekday          smallint not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_minute     integer not null check (start_minute between 0 and 1439),
  end_minute       integer not null check (end_minute between 1 and 1440),
  timezone         text not null,
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  constraint teacher_availability_is_a_window check (end_minute > start_minute),
  constraint teacher_availability_windows_do_not_overlap
    exclude using gist (teacher_id with =, weekday with =, int4range(start_minute, end_minute) with &&)
);

comment on table chat.teacher_availability is
  'PD-9/PD-11: a teacher''s weekly working window, in the teacher''s time zone. Replaced as a whole by the Teachers department.';

create index teacher_availability_teacher_idx on chat.teacher_availability (teacher_id, weekday);

create or replace function chat.guard_teacher_availability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'an availability window is replaced, never edited' using errcode = 'check_violation';
  end if;
  if not chat.is_time_zone(new.timezone) then
    raise exception 'unknown time zone %', new.timezone using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
    raise exception 'availability belongs to the teacher''s organization' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from chat.teacher_availability a
              where a.teacher_id = new.teacher_id and a.timezone <> new.timezone) then
    raise exception 'one teacher keeps one time zone' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger teacher_availability_is_coherent before insert or update on chat.teacher_availability
  for each row execute function chat.guard_teacher_availability();

create table chat.teacher_day_off (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  day              date not null,
  reason           text check (reason is null or length(btrim(reason)) between 1 and 500),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  constraint teacher_day_off_once_per_day unique (teacher_id, day)
);

comment on table chat.teacher_day_off is
  'PD-9: a dated extra day off. Removes the day from free make-up slots; it does not cancel lessons by itself.';

create or replace function chat.guard_teacher_day_off()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a day off is removed and re-added, never edited' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
    raise exception 'a day off belongs to the teacher''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teacher_day_off_is_coherent before insert or update on chat.teacher_day_off
  for each row execute function chat.guard_teacher_day_off();

-- ===========================================================================
-- 2. Regular weekly lesson times
-- ===========================================================================

create table chat.learner_schedule_slot (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  learner_id        uuid not null references chat.learner (id),
  teacher_id        uuid not null references chat.teacher (id),
  weekday           smallint not null check (weekday between 1 and 7),
  start_minute      integer not null check (start_minute between 0 and 1439),
  duration_minutes  integer not null check (duration_minutes between 15 and 240),
  timezone          text not null,
  valid_from        date not null,
  valid_to          date,                         -- exclusive; null = open-ended
  created_by        uuid not null references chat.staff (id),
  created_at        timestamptz not null default now(),
  -- valid_to = valid_from is a slot replaced on the day it began: it owed nothing.
  constraint learner_schedule_slot_has_a_span check (valid_to is null or valid_to >= valid_from)
);

comment on table chat.learner_schedule_slot is
  'PD-11: a learner''s regular weekly lesson time, in the teacher''s time zone. Ended by setting valid_to; lessons are materialized from it.';

create index learner_schedule_slot_learner_idx on chat.learner_schedule_slot (learner_id) where valid_to is null;
create index learner_schedule_slot_teacher_idx on chat.learner_schedule_slot (teacher_id, weekday);

create or replace function chat.guard_learner_schedule_slot()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    if v_learner.organization_id is distinct from new.organization_id
       or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a schedule slot belongs to its learner''s organization' using errcode = 'insufficient_privilege';
    end if;
    if v_learner.teacher_id is distinct from new.teacher_id then
      raise exception 'a regular lesson time is with the learner''s assigned teacher' using errcode = 'check_violation';
    end if;
    if not chat.is_time_zone(new.timezone) then
      raise exception 'unknown time zone %', new.timezone using errcode = 'check_violation';
    end if;
    if new.valid_to is not null then
      raise exception 'a schedule slot is created open-ended' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- UPDATE: the one change is ending it, once.
  if old.valid_to is not null then
    raise exception 'an ended schedule slot is final' using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.learner_id, new.teacher_id, new.weekday, new.start_minute,
      new.duration_minutes, new.timezone, new.valid_from, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.teacher_id, old.weekday, old.start_minute,
      old.duration_minutes, old.timezone, old.valid_from, old.created_by, old.created_at) then
    raise exception 'a schedule slot is ended, never edited' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger learner_schedule_slot_is_coherent before insert or update on chat.learner_schedule_slot
  for each row execute function chat.guard_learner_schedule_slot();

create or replace function chat.forbid_schedule_slot_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a schedule slot is ended, never deleted' using errcode = 'check_violation';
end;
$$;

create trigger learner_schedule_slot_is_kept before delete on chat.learner_schedule_slot
  for each row execute function chat.forbid_schedule_slot_delete();

-- ===========================================================================
-- 3. Lessons: who created them, which slot, `rescheduled`, one live make-up
-- ===========================================================================

alter table chat.lesson drop constraint lesson_created_by_fkey;
alter table chat.lesson alter column created_by drop not null;
alter table chat.lesson add column created_by_kind text not null default 'staff'
  check (created_by_kind in ('staff', 'contact', 'system'));
alter table chat.lesson add constraint lesson_creator_is_named
  check ((created_by_kind = 'system') = (created_by is null));
alter table chat.lesson add column schedule_slot_id uuid references chat.learner_schedule_slot (id);
alter table chat.lesson add constraint lesson_slot_occurrence_is_unique unique (schedule_slot_id, starts_at);

alter table chat.lesson drop constraint lesson_outcome_check;
alter table chat.lesson add constraint lesson_outcome_check check (outcome in (
  'held', 'student_apology', 'teacher_apology', 'admin_cancelled',
  'student_no_show', 'teacher_no_show', 'rescheduled'));

alter table chat.lesson drop constraint lesson_outcome_recorded_by_a_plausible_actor;
alter table chat.lesson add constraint lesson_outcome_recorded_by_a_plausible_actor
  check (outcome is null
      or (outcome in ('held', 'student_no_show') and outcome_by_kind in ('teacher', 'staff'))
      or (outcome = 'student_apology' and outcome_by_kind in ('contact', 'staff'))
      or (outcome = 'teacher_apology' and outcome_by_kind in ('teacher', 'staff'))
      or (outcome in ('admin_cancelled', 'teacher_no_show', 'rescheduled') and outcome_by_kind = 'staff'));

-- One live make-up per missed lesson. A make-up that itself did not happen
-- through the teacher, or was moved, no longer counts as the replacement.
create unique index lesson_one_live_makeup on chat.lesson (makeup_for)
  where kind = 'makeup'
    and (outcome is null or outcome not in ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled'));

create or replace function chat.guard_lesson()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
  v_teacher chat.teacher%rowtype;
  v_missed  chat.lesson%rowtype;
  v_excused boolean;
begin
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    select * into v_teacher from chat.teacher where id = new.teacher_id;
    if v_learner.organization_id is distinct from new.organization_id
       or v_teacher.organization_id is distinct from new.organization_id then
      raise exception 'a lesson, its learner, its teacher and its author share one organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.created_by_kind = 'staff'
       and not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a lesson, its learner, its teacher and its author share one organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.created_by_kind = 'contact' then
      -- A family books exactly one thing: the make-up a teacher-cancelled lesson owes them.
      if not exists (select 1 from chat.contact c where c.id = new.created_by and c.family_id = v_learner.family_id
                        and c.is_active and c.can_message) then
        raise exception 'a family books lessons only for its own children' using errcode = 'insufficient_privilege';
      end if;
      select * into v_missed from chat.lesson where id = new.makeup_for;
      if new.kind <> 'makeup' or v_missed.outcome is null
         or v_missed.outcome not in ('teacher_apology', 'teacher_no_show') then
        raise exception 'a family books only the make-up a teacher-cancelled lesson owes' using errcode = 'check_violation';
      end if;
      if new.starts_at <= now() then
        raise exception 'a make-up is booked in the future' using errcode = 'check_violation';
      end if;
    end if;
    if new.created_by_kind = 'system' and new.schedule_slot_id is null then
      raise exception 'the system creates lessons only from a schedule slot' using errcode = 'check_violation';
    end if;
    if not v_teacher.is_active or v_teacher.left_at is not null then
      raise exception 'an inactive teacher cannot be given a lesson' using errcode = 'check_violation';
    end if;
    if v_learner.teacher_id is distinct from new.teacher_id then
      raise exception 'a lesson is taught by the learner''s assigned teacher' using errcode = 'check_violation';
    end if;
    if new.makeup_for is not null and not exists (
      select 1 from chat.lesson m where m.id = new.makeup_for and m.learner_id = new.learner_id
    ) then
      raise exception 'a make-up replaces a lesson of the same learner' using errcode = 'check_violation';
    end if;
    if new.outcome is not null then
      raise exception 'a lesson is born open' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.organization_id, new.learner_id, new.kind, new.makeup_for, new.created_by,
      new.created_by_kind, new.schedule_slot_id, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.kind, old.makeup_for, old.created_by,
      old.created_by_kind, old.schedule_slot_id, old.created_at) then
    raise exception 'a lesson''s identity never changes' using errcode = 'check_violation';
  end if;

  if old.outcome is not null
     and (new.teacher_id, new.starts_at, new.ends_at) is distinct from (old.teacher_id, old.starts_at, old.ends_at) then
    raise exception 'a closed lesson cannot be moved' using errcode = 'check_violation';
  end if;

  if new.outcome is not distinct from old.outcome then
    if (new.outcome_note, new.outcome_by_kind, new.outcome_by, new.outcome_at)
       is distinct from (old.outcome_note, old.outcome_by_kind, old.outcome_by, old.outcome_at) then
      raise exception 'an outcome is written once' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.outcome is null then
    raise exception 'a closed lesson is never reopened' using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from chat.lesson_ruling r
     where r.lesson_id = new.id and r.kind = 'late_apology' and r.decision = 'excused'
  ) into v_excused;

  if old.outcome is not null then
    if not (old.outcome = 'student_no_show' and new.outcome = 'student_apology' and v_excused) then
      raise exception 'an outcome is written once; only an excusing ruling turns an absence into an apology'
        using errcode = 'check_violation';
    end if;
  elsif new.outcome in ('held', 'student_no_show', 'teacher_no_show') then
    if now() < old.starts_at then
      raise exception 'a lesson that has not started cannot be held or missed' using errcode = 'check_violation';
    end if;
  elsif new.outcome = 'student_apology' then
    if now() >= old.starts_at and not v_excused then
      raise exception 'an apology after the start is a late apology, decided by a ruling'
        using errcode = 'check_violation';
    end if;
  elsif new.outcome = 'teacher_apology' then
    if now() >= old.starts_at then
      raise exception 'a teacher apology after the start is a teacher absence' using errcode = 'check_violation';
    end if;
  elsif new.outcome = 'rescheduled' then
    if now() >= old.starts_at then
      raise exception 'only a lesson that has not started can be rescheduled' using errcode = 'check_violation';
    end if;
  end if;

  new.outcome_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 4. Make-up follow-up rulings
-- ===========================================================================

alter table chat.lesson_ruling drop constraint lesson_ruling_kind_check;
alter table chat.lesson_ruling add constraint lesson_ruling_kind_check
  check (kind in ('late_apology', 'makeup_followup'));
alter table chat.lesson_ruling drop constraint lesson_ruling_decision_check;
alter table chat.lesson_ruling add constraint lesson_ruling_decision_check check (
  decision is null
  or (kind = 'late_apology' and decision in ('excused', 'teacher_credited'))
  or (kind = 'makeup_followup' and decision in ('substitute_teacher', 'family_credit', 'package_extension', 'waived')));

create or replace function chat.guard_lesson_ruling()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_lesson from chat.lesson where id = new.lesson_id;
    if v_lesson.organization_id is distinct from new.organization_id then
      raise exception 'a ruling belongs to its lesson''s organization' using errcode = 'insufficient_privilege';
    end if;
    if new.decision is not null then
      raise exception 'a ruling is opened undecided' using errcode = 'check_violation';
    end if;
    if new.kind = 'late_apology' then
      if now() < v_lesson.starts_at then
        raise exception 'an apology before the start is not late' using errcode = 'check_violation';
      end if;
      if now() > v_lesson.starts_at + interval '48 hours' then
        raise exception 'a late apology is accepted for 48 hours after the start' using errcode = 'check_violation';
      end if;
      if v_lesson.outcome is not null and v_lesson.outcome <> 'student_no_show' then
        raise exception 'a late apology applies only to an absence' using errcode = 'check_violation';
      end if;
    elsif new.kind = 'makeup_followup' then
      if new.opened_by_kind <> 'staff' then
        raise exception 'a make-up follow-up is recorded by the Teachers department' using errcode = 'check_violation';
      end if;
      if v_lesson.outcome is null or v_lesson.outcome not in ('teacher_apology', 'teacher_no_show') then
        raise exception 'a make-up follow-up applies to a lesson the teacher did not give' using errcode = 'check_violation';
      end if;
      if exists (select 1 from chat.lesson m where m.makeup_for = v_lesson.id and m.kind = 'makeup'
                   and (m.outcome is null or m.outcome not in ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled'))) then
        raise exception 'this lesson already has its make-up' using errcode = 'check_violation';
      end if;
    end if;
    new.opened_at := now();
    return new;
  end if;

  if old.decision is not null then
    raise exception 'a decided ruling is final' using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.lesson_id, new.kind, new.opened_by_kind, new.opened_by, new.opened_at, new.reason)
     is distinct from
     (old.id, old.organization_id, old.lesson_id, old.kind, old.opened_by_kind, old.opened_by, old.opened_at, old.reason) then
    raise exception 'only the decision of a ruling may be written' using errcode = 'check_violation';
  end if;
  if new.decision is not null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 5. Regular-time change requests
-- ===========================================================================

create table chat.schedule_change_request (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id),
  requested_by     uuid not null references chat.contact (id),
  slots            jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 7),
  note             text check (note is null or length(btrim(note)) between 1 and 1000),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by       uuid references chat.staff (id),
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or length(btrim(decision_note)) between 1 and 1000),
  created_at       timestamptz not null default now(),
  constraint schedule_change_request_decision_is_whole
    check ((status in ('approved', 'rejected')) = (decided_by is not null) and (decided_by is null) = (decided_at is null))
);

comment on table chat.schedule_change_request is
  'PD-11: a family asks for new regular lesson times chosen from the teacher''s free weekly slots; a Teachers-department supervisor decides.';

create unique index schedule_change_request_one_pending on chat.schedule_change_request (learner_id) where status = 'pending';

create or replace function chat.guard_schedule_change_request()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    if v_learner.organization_id is distinct from new.organization_id
       or not exists (select 1 from chat.contact c where c.id = new.requested_by and c.family_id = v_learner.family_id) then
      raise exception 'a family asks only about its own children' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'pending' then
      raise exception 'a request is opened pending' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'a decided request is final' using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.learner_id, new.requested_by, new.slots, new.note, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.requested_by, old.slots, old.note, old.created_at) then
    raise exception 'only the decision of a request may be written' using errcode = 'check_violation';
  end if;
  if new.decided_by is not null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger schedule_change_request_is_coherent before insert or update on chat.schedule_change_request
  for each row execute function chat.guard_schedule_change_request();

create or replace function chat.forbid_schedule_change_request_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a schedule change request is decided or withdrawn, never deleted' using errcode = 'check_violation';
end;
$$;

create trigger schedule_change_request_is_kept before delete on chat.schedule_change_request
  for each row execute function chat.forbid_schedule_change_request_delete();

-- ===========================================================================
-- 6. Cards
-- ===========================================================================

alter table chat.message_card drop constraint message_card_kind_check;
alter table chat.message_card add constraint message_card_kind_check check (kind in (
  'lesson_report', 'lesson_absence', 'lesson_apology', 'lesson_teacher_apology',
  'lesson_cancelled', 'lesson_late_apology', 'lesson_ruling',
  'lesson_makeup_booked', 'lesson_makeup_resolved',
  'schedule_change_requested', 'schedule_change_decided'));

-- ===========================================================================
-- 7. Free time
-- ===========================================================================

-- Free start times for one lesson of p_duration minutes, every p_step minutes,
-- inside the teacher's working windows, not on a day off, and not overlapping
-- any lesson that still holds the teacher's time.
create or replace function chat.teacher_free_slots(
  p_teacher uuid, p_from timestamptz, p_until timestamptz, p_duration integer, p_step integer
)
returns table (starts_at timestamptz)
language sql
stable
as $$
  with tz as (
    select min(a.timezone) as name from chat.teacher_availability a where a.teacher_id = p_teacher
  ),
  days as (
    select d::date as day
      from tz, generate_series((p_from at time zone tz.name)::date, (p_until at time zone tz.name)::date, interval '1 day') d
     where tz.name is not null
  ),
  candidates as (
    select ((days.day + make_interval(mins => m)) at time zone a.timezone) as starts_at
      from days
      join chat.teacher_availability a
        on a.teacher_id = p_teacher and a.weekday = extract(isodow from days.day)
      cross join lateral generate_series(a.start_minute, a.end_minute - p_duration, p_step) m
     where not exists (select 1 from chat.teacher_day_off o where o.teacher_id = p_teacher and o.day = days.day)
  )
  select c.starts_at
    from candidates c
   where c.starts_at >= p_from
     and c.starts_at < p_until
     and not exists (
       select 1 from chat.lesson l
        where l.teacher_id = p_teacher
          and (l.outcome is null or l.outcome in ('held', 'student_no_show', 'teacher_no_show'))
          and tstzrange(l.starts_at, l.ends_at) && tstzrange(c.starts_at, c.starts_at + make_interval(mins => p_duration)))
   order by c.starts_at;
$$;

-- Free regular weekly times: working windows minus the active regular slots of
-- the teacher's OTHER learners. Answered in the teacher's zone.
create or replace function chat.teacher_free_weekly_slots(
  p_teacher uuid, p_duration integer, p_step integer, p_except_learner uuid
)
returns table (weekday smallint, start_minute integer, timezone text)
language sql
stable
as $$
  select a.weekday, m::integer, a.timezone
    from chat.teacher_availability a
    cross join lateral generate_series(a.start_minute, a.end_minute - p_duration, p_step) m
   where a.teacher_id = p_teacher
     and not exists (
       select 1 from chat.learner_schedule_slot s
        where s.teacher_id = p_teacher
          and s.learner_id is distinct from p_except_learner
          and (s.valid_to is null or s.valid_to > current_date)
          and s.weekday = a.weekday
          and int4range(s.start_minute, s.start_minute + s.duration_minutes) && int4range(m, m + p_duration))
   order by a.weekday, m;
$$;

-- ===========================================================================
-- 8. Materializing lessons from regular times
-- ===========================================================================

-- Creates the open lessons every active slot owes between p_from and p_until.
-- Idempotent (one lesson per slot and start), serialized by an advisory lock so
-- two workers cannot race into the exclusion constraint, and it skips an
-- occurrence that would collide with a lesson already holding the teacher's
-- time (a make-up booked into it) or whose learner has moved to another teacher.
create or replace function chat.materialize_lessons(p_from timestamptz, p_until timestamptz)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('chat.materialize_lessons'));
  with occurrences as (
    select s.*, ((d::date + make_interval(mins => s.start_minute)) at time zone s.timezone) as at
      from chat.learner_schedule_slot s
      cross join lateral generate_series(
        greatest(s.valid_from, (p_from at time zone s.timezone)::date),
        least(coalesce(s.valid_to - 1, 'infinity'::date), (p_until at time zone s.timezone)::date),
        interval '1 day') d
     where extract(isodow from d) = s.weekday
  ), eligible as (
    select o.* from occurrences o
      join chat.learner l on l.id = o.learner_id and l.teacher_id = o.teacher_id
      join chat.teacher t on t.id = o.teacher_id and t.is_active and t.left_at is null
     where o.at >= p_from and o.at < p_until
       and not exists (
         select 1 from chat.lesson x
          where x.teacher_id = o.teacher_id
            and (x.outcome is null or x.outcome in ('held', 'student_no_show', 'teacher_no_show'))
            and tstzrange(x.starts_at, x.ends_at) && tstzrange(o.at, o.at + make_interval(mins => o.duration_minutes)))
  )
  insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at,
                           created_by_kind, created_by, schedule_slot_id)
  select e.organization_id, e.learner_id, e.teacher_id, 'regular', e.at,
         e.at + make_interval(mins => e.duration_minutes), 'system', null, e.id
    from eligible e
  on conflict (schedule_slot_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================================================================
-- 8b. Lesson reminders
-- ===========================================================================

-- Set once the reminders of a lesson have been scheduled, so the sweep that
-- schedules them reads each lesson once. Not part of the lesson's identity or
-- outcome: chat.guard_lesson leaves it writable.
alter table chat.lesson add column reminders_scheduled_at timestamptz;
create index lesson_reminders_due_idx on chat.lesson (starts_at)
  where outcome is null and reminders_scheduled_at is null;

-- Push privacy (2026-10-14): a reminder on the lock screen names nobody and
-- shows no time a reader in another zone would misread.
insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale, 1, v.title, v.body
  from (values
    ('lesson_reminder_tomorrow', 'en', 'Jawwid', 'Reminder: there is a lesson tomorrow.'),
    ('lesson_reminder_tomorrow', 'ar', 'جوّيد',  'تذكير: لديكم حصة غدًا.'),
    ('lesson_reminder_soon',     'en', 'Jawwid', 'A lesson starts in 30 minutes.'),
    ('lesson_reminder_soon',     'ar', 'جوّيد',  'تبدأ الحصة بعد ٣٠ دقيقة.'),
    ('lesson_reminder_teacher',  'en', 'Jawwid', 'Your next lesson starts in 15 minutes.'),
    ('lesson_reminder_teacher',  'ar', 'جوّيد',  'تبدأ حصتك القادمة بعد ١٥ دقيقة.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- Rules are data (ReminderService): changing an offset is an UPDATE, not a release.
insert into chat.notification_rule (key, event_type, offset_seconds, template_key, recipient_role, respect_quiet_hours)
values
  ('lesson_parent_t24h',  'lesson_scheduled', -86400, 'lesson_reminder_tomorrow', 'parent',  true),
  ('lesson_parent_t30m',  'lesson_scheduled', -1800,  'lesson_reminder_soon',     'parent',  false),
  ('lesson_teacher_t15m', 'lesson_scheduled', -900,   'lesson_reminder_teacher',  'teacher', false)
on conflict (key) do nothing;

-- ===========================================================================
-- 9. Request roles
-- ===========================================================================

alter table chat.teacher_availability     enable row level security;
alter table chat.teacher_day_off          enable row level security;
alter table chat.learner_schedule_slot    enable row level security;
alter table chat.schedule_change_request  enable row level security;

revoke all on chat.teacher_availability, chat.teacher_day_off, chat.learner_schedule_slot,
              chat.schedule_change_request
  from public, anon, authenticated, chat_app;

revoke all on function chat.is_time_zone(text) from public;
revoke all on function chat.guard_teacher_availability() from public;
revoke all on function chat.guard_teacher_day_off() from public;
revoke all on function chat.guard_learner_schedule_slot() from public;
revoke all on function chat.forbid_schedule_slot_delete() from public;
revoke all on function chat.guard_schedule_change_request() from public;
revoke all on function chat.forbid_schedule_change_request_delete() from public;
revoke all on function chat.teacher_free_slots(uuid, timestamptz, timestamptz, integer, integer) from public;
revoke all on function chat.teacher_free_weekly_slots(uuid, integer, integer, uuid) from public;
revoke all on function chat.materialize_lessons(timestamptz, timestamptz) from public;
