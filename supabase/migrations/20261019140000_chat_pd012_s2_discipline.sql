-- PD-12 S2 (closed 2026-10-18) -- the teacher discipline ladder.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-12 §3, and
-- docs/admin/pd012-s2.md.
--
-- WHAT IS NEW
--
--   chat.teacher_violation   one row per violation: a lesson the teacher
--                            apologised for or did not give (written by a
--                            trigger on chat.lesson, the moment the outcome is
--                            written), or a held lesson the Teachers department
--                            recorded as late. It carries the ONE decision on it:
--                            warning, first/second deduction, temporary or
--                            permanent suspension -- or excused.
--   chat.teacher_suspension  a temporary (with an end) or permanent suspension,
--                            decided on a violation.
--   teacher_day_off.suspension_id
--                            a temporary suspension IS its days off in PD-11's
--                            chat.teacher_day_off (the record make-up booking
--                            reads); they never count against the leave balance.
--
-- THE LADDER IS NEVER STORED. A violation's suggested step is its rank among the
-- teacher's counted (not excused) violations of the same calendar month, in
-- schedule.timezone -- computed on every read. Only the decision a person
-- confirmed is written, with the step that was suggested at that moment.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. Suspensions
-- ===========================================================================

create table chat.teacher_suspension (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  kind             text not null check (kind in ('temporary', 'permanent')),
  starts_on        date not null,
  -- temporary: the last day of the suspension (inclusive). permanent: null.
  ends_on          date,
  reason           text not null check (length(btrim(reason)) between 1 and 1000),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  constraint teacher_suspension_shape
    check ((kind = 'temporary') = (ends_on is not null)
       and (ends_on is null or (ends_on >= starts_on and ends_on - starts_on < 92)))
);

comment on table chat.teacher_suspension is
  'PD-12: a teacher suspension decided on a violation. Temporary ones are their teacher_day_off rows; permanent ones deactivate the teacher. Never edited or deleted.';

create index teacher_suspension_teacher_idx on chat.teacher_suspension (teacher_id, starts_on desc);

create or replace function chat.guard_teacher_suspension()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a suspension is never edited or deleted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not chat.is_lesson_manager(new.created_by, new.organization_id) then
    raise exception 'a suspension is decided by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger teacher_suspension_is_kept
  before insert or update or delete on chat.teacher_suspension
  for each row execute function chat.guard_teacher_suspension();

-- A temporary suspension's days are days off: make-up booking skips them.
alter table chat.teacher_day_off
  add column suspension_id uuid references chat.teacher_suspension (id);

alter table chat.teacher_day_off add constraint teacher_day_off_one_reason
  check (leave_request_id is null or suspension_id is null);

create index teacher_day_off_suspension_idx
  on chat.teacher_day_off (suspension_id) where suspension_id is not null;

create or replace function chat.guard_day_off_suspension()
returns trigger
language plpgsql
as $$
declare
  v_s chat.teacher_suspension%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.suspension_id is not null then
      raise exception 'this day off belongs to a suspension' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.suspension_id is null then
    return new;
  end if;
  select * into v_s from chat.teacher_suspension where id = new.suspension_id;
  if v_s.kind is distinct from 'temporary' or v_s.teacher_id <> new.teacher_id
     or new.day not between v_s.starts_on and v_s.ends_on then
    raise exception 'a suspension day belongs to its temporary suspension''s teacher and dates'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger teacher_day_off_suspension_is_coherent
  before insert or delete on chat.teacher_day_off
  for each row execute function chat.guard_day_off_suspension();

-- ===========================================================================
-- 2. Violations
-- ===========================================================================

create table chat.teacher_violation (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  teacher_id        uuid not null references chat.teacher (id),
  lesson_id         uuid not null references chat.lesson (id),
  kind              text not null check (kind in ('teacher_apology', 'teacher_no_show', 'late')),
  -- When it happened (the lesson's start), and the calendar month it counts in
  -- (first day, in schedule.timezone).
  occurred_at       timestamptz not null,
  month             date not null check (extract(day from month) = 1),
  late_minutes      integer check (late_minutes is null or late_minutes between 1 and 240),
  recorded_by       uuid references chat.staff (id),
  recorded_at       timestamptz not null default now(),
  -- late: what the recorder saw (optional).
  note              text check (note is null or length(btrim(note)) between 1 and 1000),
  decision          text check (decision in ('warning', 'deduction_1', 'deduction_2',
                                             'temporary_suspension', 'permanent_suspension', 'excused')),
  suggested_step    integer check (suggested_step is null or suggested_step between 1 and 5),
  decision_note     text check (decision_note is null or length(btrim(decision_note)) between 1 and 1000),
  decided_by        uuid references chat.staff (id),
  decided_at        timestamptz,
  suspension_id     uuid unique references chat.teacher_suspension (id),

  constraint teacher_violation_once_per_lesson unique (lesson_id, kind),
  constraint teacher_violation_late_shape
    check ((kind = 'late') = (late_minutes is not null) and (kind <> 'late' or recorded_by is not null)),
  constraint teacher_violation_decision_is_whole
    check ((decision is null) = (decided_by is null) and (decision is null) = (decided_at is null)
       and (decision is null) = (suggested_step is null)),
  constraint teacher_violation_excuse_says_why
    check (decision is distinct from 'excused' or decision_note is not null),
  constraint teacher_violation_suspension_shape
    check ((decision in ('temporary_suspension', 'permanent_suspension')) = (suspension_id is not null))
);

comment on table chat.teacher_violation is
  'PD-12: a lesson the teacher apologised for, did not give, or started late, and the one decision on it. The ladder step is computed, never stored; never deleted.';

create index teacher_violation_teacher_month_idx on chat.teacher_violation (teacher_id, month, occurred_at);
create index teacher_violation_open_idx on chat.teacher_violation (organization_id, occurred_at) where decision is null;

-- The calendar month a moment counts in: the academy's (schedule.timezone).
create or replace function chat.academy_month(p_at timestamptz)
returns date
language sql
stable
as $$
  select date_trunc('month', p_at at time zone coalesce(
    (select c.value #>> '{}' from chat.config c where c.key = 'schedule.timezone'), 'Africa/Cairo'))::date;
$$;

create or replace function chat.guard_teacher_violation()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'a violation is never deleted; excuse it' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select * into v_lesson from chat.lesson where id = new.lesson_id;
    if v_lesson.organization_id is distinct from new.organization_id or v_lesson.teacher_id is distinct from new.teacher_id then
      raise exception 'a violation is the lesson''s own teacher''s, in its organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.kind = 'late' then
      if v_lesson.outcome is distinct from 'held' then
        raise exception 'lateness is recorded on a lesson that was held' using errcode = 'check_violation';
      end if;
      if not chat.is_lesson_manager(new.recorded_by, new.organization_id) then
        raise exception 'lateness is recorded by the Teachers department' using errcode = 'insufficient_privilege';
      end if;
    elsif v_lesson.outcome is distinct from new.kind then
      raise exception 'a % violation needs a lesson closed as %', new.kind, new.kind using errcode = 'check_violation';
    end if;
    if new.decision is not null then
      raise exception 'a violation is recorded undecided' using errcode = 'check_violation';
    end if;
    new.occurred_at := v_lesson.starts_at;
    new.month := chat.academy_month(v_lesson.starts_at);
    new.recorded_at := now();
    return new;
  end if;

  -- UPDATE: the decision is written once, and nothing else moves.
  if old.decision is not null then
    raise exception 'a violation is decided once' using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.teacher_id, new.lesson_id, new.kind, new.occurred_at, new.month,
      new.late_minutes, new.recorded_by, new.recorded_at, new.note)
     is distinct from
     (old.id, old.organization_id, old.teacher_id, old.lesson_id, old.kind, old.occurred_at, old.month,
      old.late_minutes, old.recorded_by, old.recorded_at, old.note) then
    raise exception 'only the decision on a violation may be written' using errcode = 'check_violation';
  end if;
  if new.decision is not null then
    if not chat.is_lesson_manager(new.decided_by, new.organization_id) then
      raise exception 'a violation is decided by the teacher''s own Teachers department'
        using errcode = 'insufficient_privilege';
    end if;
    if new.suspension_id is not null and not exists (
      select 1 from chat.teacher_suspension s
       where s.id = new.suspension_id and s.teacher_id = new.teacher_id
         and s.kind = case new.decision when 'temporary_suspension' then 'temporary' else 'permanent' end
    ) then
      raise exception 'a suspension decision names that teacher''s suspension of the same kind'
        using errcode = 'check_violation';
    end if;
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger teacher_violation_is_coherent
  before insert or update or delete on chat.teacher_violation
  for each row execute function chat.guard_teacher_violation();

-- A lesson the teacher apologised for or did not give IS a violation, from the
-- moment its outcome is written -- whoever wrote it. Lessons cancelled by the
-- academy (leave, suspension) are admin_cancelled and never reach this.
create or replace function chat.record_teacher_violation()
returns trigger
language plpgsql
as $$
begin
  if new.outcome in ('teacher_apology', 'teacher_no_show')
     and new.outcome is distinct from old.outcome then
    insert into chat.teacher_violation (organization_id, teacher_id, lesson_id, kind, occurred_at, month)
    values (new.organization_id, new.teacher_id, new.id, new.outcome, new.starts_at, chat.academy_month(new.starts_at))
    on conflict (lesson_id, kind) do nothing;
  end if;
  return null;
end;
$$;

create trigger lesson_outcome_records_teacher_violation
  after update of outcome on chat.lesson
  for each row execute function chat.record_teacher_violation();

-- ===========================================================================
-- 3. Card kinds
-- ===========================================================================

insert into chat.message_card_kind (kind) values
  ('discipline_warning'), ('discipline_deduction'), ('discipline_suspension');

-- ===========================================================================
-- 4. Request roles: none
-- ===========================================================================

alter table chat.teacher_violation  enable row level security;
alter table chat.teacher_suspension enable row level security;
revoke all on chat.teacher_violation, chat.teacher_suspension from public, anon, authenticated, chat_app;

revoke all on function chat.guard_teacher_suspension() from public;
revoke all on function chat.guard_day_off_suspension() from public;
revoke all on function chat.guard_teacher_violation() from public;
revoke all on function chat.record_teacher_violation() from public;
revoke all on function chat.academy_month(timestamptz) from public;
