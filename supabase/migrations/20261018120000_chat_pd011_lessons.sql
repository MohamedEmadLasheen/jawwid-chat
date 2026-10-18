-- PD-9 / PD-11 T1 (2026-10-18) -- lessons, their one outcome, the report card,
-- and the late-apology ruling.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, PD-9 and PD-11.
--
-- WHAT IS NEW
--
--   chat.lesson          one row per occurrence; Chat owns it for a cut-over
--                        teacher. It is born OPEN and closes with exactly one
--                        outcome, written once.
--   chat.lesson_report   the teacher's report for a `held` lesson. A held lesson
--                        without one cannot commit.
--   chat.lesson_ruling   a decision a supervisor owes on a lesson (T1: a parent's
--                        late apology). It is the ONLY thing that may change an
--                        outcome after it was written -- no session gate does.
--   chat.message_card    the structured half of a message of the new type
--                        `card`. A card message without one cannot commit, and a
--                        client can never author one (MessageService).
--
-- THE CLOCK IS THE DATABASE'S. Whether an apology came before the start, or an
-- absence after it, is decided against now() inside the trigger, never against
-- a timestamp a request supplied.
--
-- FAIL CLOSED. RLS on, no grant to any request role: only the server reads or
-- writes these tables, through LessonService.

create extension if not exists btree_gist;

-- ===========================================================================
-- 1. The card message type
-- ===========================================================================

alter table chat.message drop constraint message_type_check;
alter table chat.message add constraint message_type_check
  check (type in ('text', 'image', 'video', 'voice', 'file', 'system', 'card'));

-- ===========================================================================
-- 2. Lessons
-- ===========================================================================

create table chat.lesson (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default chat.default_organization_id()
                     references chat.organization (id),
  learner_id       uuid not null references chat.learner (id),
  teacher_id       uuid not null references chat.teacher (id),
  kind             text not null default 'regular' check (kind in ('regular', 'makeup')),
  makeup_for       uuid references chat.lesson (id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  outcome          text check (outcome in (
                     'held', 'student_apology', 'teacher_apology',
                     'admin_cancelled', 'student_no_show', 'teacher_no_show')),
  outcome_note     text check (outcome_note is null or length(btrim(outcome_note)) between 1 and 1000),
  outcome_by_kind  text check (outcome_by_kind in ('staff', 'teacher', 'contact')),
  outcome_by       uuid,
  outcome_at       timestamptz,
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint lesson_has_a_duration
    check (ends_at > starts_at and ends_at - starts_at <= interval '4 hours'),
  constraint lesson_outcome_is_whole
    check ((outcome is null) = (outcome_at is null)
       and (outcome is null) = (outcome_by is null)
       and (outcome is null) = (outcome_by_kind is null)),
  constraint lesson_admin_cancel_names_a_reason
    check (outcome is distinct from 'admin_cancelled' or outcome_note is not null),
  constraint lesson_makeup_names_its_lesson
    check ((kind = 'makeup') = (makeup_for is not null)),
  -- Who can have recorded each outcome. Which ONE of them may, in a given
  -- request, is AuthorizationService's; this is the shape no request can break.
  constraint lesson_outcome_recorded_by_a_plausible_actor
    check (outcome is null
        or (outcome in ('held', 'student_no_show') and outcome_by_kind in ('teacher', 'staff'))
        or (outcome = 'student_apology' and outcome_by_kind in ('contact', 'staff'))
        or (outcome = 'teacher_apology' and outcome_by_kind in ('teacher', 'staff'))
        or (outcome in ('admin_cancelled', 'teacher_no_show') and outcome_by_kind = 'staff')),
  -- One teacher, one lesson at a time. An excused or cancelled lesson frees its
  -- slot, so a make-up can be booked into it.
  constraint lesson_teacher_is_never_double_booked
    exclude using gist (teacher_id with =, tstzrange(starts_at, ends_at) with &&)
    where (outcome is null or outcome in ('held', 'student_no_show', 'teacher_no_show'))
);

comment on table chat.lesson is
  'PD-9: one lesson occurrence, owned by Chat for a cut-over teacher. Closes with exactly one outcome.';

create index lesson_teacher_starts_idx on chat.lesson (teacher_id, starts_at);
create index lesson_learner_starts_idx on chat.lesson (learner_id, starts_at);
create index lesson_open_by_end_idx on chat.lesson (organization_id, ends_at) where outcome is null;

create trigger lesson_updated_at before update on chat.lesson
  for each row execute function chat.set_updated_at();

-- ===========================================================================
-- 3. Rulings (declared before the lesson guard, which reads them)
-- ===========================================================================

create table chat.lesson_ruling (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  lesson_id        uuid not null references chat.lesson (id),
  kind             text not null check (kind in ('late_apology')),
  opened_by_kind   text not null check (opened_by_kind in ('contact', 'staff')),
  opened_by        uuid not null,
  opened_at        timestamptz not null default now(),
  reason           text not null check (length(btrim(reason)) between 1 and 1000),
  decision         text check (decision in ('excused', 'teacher_credited')),
  decided_by       uuid references chat.staff (id),
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or length(btrim(decision_note)) between 1 and 1000),
  constraint lesson_ruling_decision_is_whole
    check ((decision is null) = (decided_by is null) and (decision is null) = (decided_at is null)),
  constraint lesson_ruling_one_per_kind unique (lesson_id, kind)
);

comment on table chat.lesson_ruling is
  'PD-11: a decision a supervisor owes on a lesson. The only authority that may change a written outcome.';

create index lesson_ruling_open_idx on chat.lesson_ruling (organization_id, opened_at) where decision is null;

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
    end if;
    new.opened_at := now();
    return new;
  end if;

  -- UPDATE: a ruling is decided once, and nothing else about it moves.
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

create trigger lesson_ruling_is_coherent before insert or update on chat.lesson_ruling
  for each row execute function chat.guard_lesson_ruling();

create or replace function chat.forbid_lesson_ruling_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a ruling is never deleted' using errcode = 'check_violation';
end;
$$;

create trigger lesson_ruling_is_kept before delete on chat.lesson_ruling
  for each row execute function chat.forbid_lesson_ruling_delete();

-- ===========================================================================
-- 4. The lesson guard
-- ===========================================================================

create or replace function chat.guard_lesson()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
  v_teacher chat.teacher%rowtype;
  v_excused boolean;
begin
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    select * into v_teacher from chat.teacher where id = new.teacher_id;
    if v_learner.organization_id is distinct from new.organization_id
       or v_teacher.organization_id is distinct from new.organization_id
       or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a lesson, its learner, its teacher and its author share one organization'
        using errcode = 'insufficient_privilege';
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
  if (new.id, new.organization_id, new.learner_id, new.kind, new.makeup_for, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.kind, old.makeup_for, old.created_by, old.created_at) then
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

  -- The outcome is being written or changed.
  if new.outcome is null then
    raise exception 'a closed lesson is never reopened' using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from chat.lesson_ruling r
     where r.lesson_id = new.id and r.kind = 'late_apology' and r.decision = 'excused'
  ) into v_excused;

  if old.outcome is not null then
    -- The one change a ruling may make: an absence the supervisor excused.
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
  end if;

  new.outcome_at := now();
  return new;
end;
$$;

create trigger lesson_is_coherent before insert or update on chat.lesson
  for each row execute function chat.guard_lesson();

create or replace function chat.forbid_lesson_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a lesson is never deleted; cancel it' using errcode = 'check_violation';
end;
$$;

create trigger lesson_is_kept before delete on chat.lesson
  for each row execute function chat.forbid_lesson_delete();

-- ===========================================================================
-- 5. Reports
-- ===========================================================================

create table chat.lesson_report (
  lesson_id        uuid primary key references chat.lesson (id),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  covered          text not null check (length(btrim(covered)) between 1 and 1000),
  homework         text check (homework is null or length(btrim(homework)) between 1 and 1000),
  rating           smallint check (rating between 1 and 5),
  note             text check (note is null or length(btrim(note)) between 1 and 2000),
  message_id       uuid unique references chat.message (id),
  submitted_at     timestamptz not null default now()
);

comment on table chat.lesson_report is
  'PD-9: the report of a held lesson. Written once; posted once as a card into the learner''s student group.';

create or replace function chat.guard_lesson_report()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- The card is posted in the same transaction, after the report row exists.
    if old.message_id is null and new.message_id is not null
       and (new.lesson_id, new.organization_id, new.teacher_id, new.covered, new.homework, new.rating, new.note, new.submitted_at)
           is not distinct from
           (old.lesson_id, old.organization_id, old.teacher_id, old.covered, old.homework, old.rating, old.note, old.submitted_at) then
      return new;
    end if;
    raise exception 'a lesson report is written once' using errcode = 'check_violation';
  end if;
  select * into v_lesson from chat.lesson where id = new.lesson_id;
  if v_lesson.organization_id is distinct from new.organization_id then
    raise exception 'a report belongs to its lesson''s organization' using errcode = 'insufficient_privilege';
  end if;
  if v_lesson.teacher_id is distinct from new.teacher_id then
    raise exception 'a report is written by the lesson''s teacher' using errcode = 'check_violation';
  end if;
  new.submitted_at := now();
  return new;
end;
$$;

create trigger lesson_report_is_coherent before insert or update on chat.lesson_report
  for each row execute function chat.guard_lesson_report();

create or replace function chat.forbid_lesson_report_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a lesson report is never deleted' using errcode = 'check_violation';
end;
$$;

create trigger lesson_report_is_kept before delete on chat.lesson_report
  for each row execute function chat.forbid_lesson_report_delete();

-- "held requires a report", checked at commit so the lesson and its report can
-- be written in either order inside one transaction.
create or replace function chat.assert_held_lesson_has_report()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.lesson l where l.id = new.id and l.outcome = 'held')
     and not exists (select 1 from chat.lesson_report r where r.lesson_id = new.id) then
    raise exception 'a held lesson has a report' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_held_has_report
  after insert or update on chat.lesson
  deferrable initially deferred
  for each row execute function chat.assert_held_lesson_has_report();

-- ...and a report exists only for a held lesson.
create or replace function chat.assert_report_lesson_is_held()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from chat.lesson l where l.id = new.lesson_id and l.outcome = 'held') then
    raise exception 'only a held lesson has a report' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_report_lesson_is_held
  after insert on chat.lesson_report
  deferrable initially deferred
  for each row execute function chat.assert_report_lesson_is_held();

-- ===========================================================================
-- 6. Message cards
-- ===========================================================================

create table chat.message_card (
  message_id       uuid primary key references chat.message (id),
  organization_id  uuid not null references chat.organization (id),
  kind             text not null check (kind in (
                     'lesson_report', 'lesson_absence', 'lesson_apology',
                     'lesson_teacher_apology', 'lesson_cancelled',
                     'lesson_late_apology', 'lesson_ruling')),
  lesson_id        uuid references chat.lesson (id),
  payload          jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object')
);

comment on table chat.message_card is
  'PD-11: the structured half of a card message -- what a ticket recorded. Written by the server only.';

create index message_card_lesson_idx on chat.message_card (lesson_id) where lesson_id is not null;

create or replace function chat.guard_message_card()
returns trigger
language plpgsql
as $$
declare
  v_message chat.message%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a card is written once' using errcode = 'check_violation';
  end if;
  select * into v_message from chat.message where id = new.message_id;
  if v_message.type is distinct from 'card' then
    raise exception 'a card belongs to a message of type card' using errcode = 'check_violation';
  end if;
  if v_message.organization_id is distinct from new.organization_id then
    raise exception 'a card belongs to its message''s organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger message_card_is_coherent before insert or update or delete on chat.message_card
  for each row execute function chat.guard_message_card();

create or replace function chat.assert_card_message_has_card()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'card' and not exists (select 1 from chat.message_card c where c.message_id = new.id) then
    raise exception 'a card message carries its card' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger message_card_message_has_card
  after insert on chat.message
  deferrable initially deferred
  for each row execute function chat.assert_card_message_has_card();

-- ===========================================================================
-- 7. Event vocabulary and request roles
-- ===========================================================================

-- PD-9 keeps class_attended / class_missed and emits them from outcomes; the
-- vocabulary already carries both, so nothing is added to event_log here.

alter table chat.lesson         enable row level security;
alter table chat.lesson_report  enable row level security;
alter table chat.lesson_ruling  enable row level security;
alter table chat.message_card   enable row level security;

revoke all on chat.lesson, chat.lesson_report, chat.lesson_ruling, chat.message_card
  from public, anon, authenticated, chat_app;

revoke all on function chat.guard_lesson() from public;
revoke all on function chat.guard_lesson_ruling() from public;
revoke all on function chat.guard_lesson_report() from public;
revoke all on function chat.guard_message_card() from public;
revoke all on function chat.assert_held_lesson_has_report() from public;
revoke all on function chat.assert_report_lesson_is_held() from public;
revoke all on function chat.assert_card_message_has_card() from public;
revoke all on function chat.forbid_lesson_delete() from public;
revoke all on function chat.forbid_lesson_ruling_delete() from public;
revoke all on function chat.forbid_lesson_report_delete() from public;
