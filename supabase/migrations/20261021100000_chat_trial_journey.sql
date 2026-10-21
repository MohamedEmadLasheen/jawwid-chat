-- The student trial journey (2026-10-20, owner decisions in the session
-- "student trial journey"). Builds on PD-11 T4 (20261019120000 trials,
-- 20261019130000 trial group) and the Core boundary (20261019200000).
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, "Trial journey".
--
-- OWNER DECISIONS
--
--   * Jawwid Chat is the ONLY source of truth for a trial's outcome. Nothing
--     waits for Core: Sales' "subscribed" is the conversion. The two Core
--     confirmation functions and the learner-link trigger are dropped; the
--     confirmed_at / core_* columns stay (migrations are append-only) and
--     nothing reads them.
--   * A trial has exactly ONE outcome, recorded by a supervisor from the trial
--     group's "+ -> Trial" card: no_show, subscribed, or not_subscribed (with
--     a reason). An authorized supervisor may CORRECT it; every correction is
--     kept in chat.trial_outcome_revision, written by a trigger so it cannot
--     be skipped.
--   * "Subscribed" carries a form: the parent, each child, the payment. It is
--     chat.trial_subscription -- a CONFINED record (G-07, like the Teacher
--     File): no request role has a grant on it, and only src/new-students may
--     name it (test/unit/privacy/new-students-confinement.spec.ts). None of it
--     ever reaches a message, card, event, search or export.
--
-- WHAT IS NOT HERE: the trial group's membership rules (the teacher and the
-- Teachers department are permanent, Sales supervisors join and leave as they
-- choose). The row guard of 20261019130000 already admits exactly those
-- people; the rule is TrialGroupService's.

-- ===========================================================================
-- 1. One outcome per trial, three results, correctable
-- ===========================================================================

alter table chat.trial_outcome drop constraint trial_outcome_result_check;
alter table chat.trial_outcome add constraint trial_outcome_result_check
  check (result in ('subscribed', 'not_subscribed', 'no_show'));

alter table chat.trial_outcome
  add column corrected_at timestamptz,
  add column corrected_by uuid references chat.staff (id);

alter table chat.trial_outcome add constraint trial_outcome_correction_is_whole
  check ((corrected_at is null) = (corrected_by is null));

comment on table chat.trial_outcome is
  'A trial''s one outcome, recorded by a supervisor: no_show, subscribed or not_subscribed (with a reason). Chat is its only source of truth. Corrected only through chat.correcting_trial; every correction is in chat.trial_outcome_revision.';

-- The outcome agrees with the trial's attendance, which the service writes in
-- the same transaction: no_show <=> student_no_show, otherwise held.
create or replace function chat.guard_trial_outcome()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  select * into v_lesson from chat.lesson where id = new.lesson_id;
  if tg_op = 'INSERT' then
    if v_lesson.kind is distinct from 'trial' then
      raise exception 'an outcome of this kind belongs to a trial lesson' using errcode = 'check_violation';
    end if;
    if v_lesson.organization_id is distinct from new.organization_id
       or not exists (select 1 from chat.staff s where s.id = new.recorded_by and s.organization_id = new.organization_id) then
      raise exception 'a trial outcome belongs to its lesson''s organization' using errcode = 'insufficient_privilege';
    end if;
    if new.confirmed_at is not null or new.core_subscription_ref is not null or new.corrected_at is not null then
      raise exception 'a trial outcome is born as recorded' using errcode = 'check_violation';
    end if;
    new.recorded_at := now();
  else
    if (new.lesson_id, new.organization_id, new.recorded_by, new.recorded_at, new.confirmed_at, new.core_subscription_ref)
       is distinct from
       (old.lesson_id, old.organization_id, old.recorded_by, old.recorded_at, old.confirmed_at, old.core_subscription_ref) then
      raise exception 'a trial outcome keeps who recorded it and when' using errcode = 'check_violation';
    end if;
    if not chat.caller_is_server_side() or coalesce(current_setting('chat.correcting_trial', true), '') <> 'on' then
      raise exception 'a trial outcome is changed only by a correction' using errcode = 'insufficient_privilege';
    end if;
    if new.corrected_by is null or not exists (
      select 1 from chat.staff s where s.id = new.corrected_by and s.organization_id = new.organization_id
    ) then
      raise exception 'a correction names the staff member who made it' using errcode = 'check_violation';
    end if;
    new.corrected_at := now();
  end if;
  if (new.result = 'no_show') <> (v_lesson.outcome is not distinct from 'student_no_show')
     or (new.result <> 'no_show' and v_lesson.outcome is distinct from 'held') then
    raise exception 'a trial''s outcome agrees with its attendance' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 2. Correction history, append-only, written by the database
-- ===========================================================================

create table chat.trial_outcome_revision (
  id                    uuid primary key default gen_random_uuid(),
  lesson_id             uuid not null references chat.trial_outcome (lesson_id),
  organization_id       uuid not null references chat.organization (id),
  previous_result       text not null,
  previous_reason_code  text,
  previous_note         text,
  result                text not null,
  reason_code           text,
  note                  text,
  why                   text not null check (length(btrim(why)) between 1 and 1000),
  corrected_by          uuid not null references chat.staff (id),
  corrected_at          timestamptz not null default now()
);

comment on table chat.trial_outcome_revision is
  'Trial journey: every correction of a trial''s outcome, before and after, with why and by whom. Written by the trigger on chat.trial_outcome, never by hand.';

create index trial_outcome_revision_lesson_idx on chat.trial_outcome_revision (lesson_id, corrected_at);

create or replace function chat.record_trial_outcome_revision()
returns trigger
language plpgsql
as $$
declare
  v_why text := nullif(btrim(coalesce(current_setting('chat.trial_correction_reason', true), '')), '');
begin
  if v_why is null then
    raise exception 'a correction says why' using errcode = 'check_violation';
  end if;
  perform set_config('chat.writing_trial_revision', 'on', true);
  insert into chat.trial_outcome_revision (lesson_id, organization_id, previous_result, previous_reason_code,
                                           previous_note, result, reason_code, note, why, corrected_by)
  values (new.lesson_id, new.organization_id, old.result, old.reason_code, old.note,
          new.result, new.reason_code, new.note, v_why, new.corrected_by);
  perform set_config('chat.writing_trial_revision', 'off', true);
  return null;
end;
$$;

create trigger trial_outcome_correction_is_recorded
  after update on chat.trial_outcome
  for each row execute function chat.record_trial_outcome_revision();

create or replace function chat.guard_trial_outcome_revision()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and coalesce(current_setting('chat.writing_trial_revision', true), '') = 'on' then
    return new;
  end if;
  raise exception 'a trial outcome''s history is written by the correction and never changed' using errcode = 'check_violation';
end;
$$;

create trigger trial_outcome_revision_is_kept
  before insert or update or delete on chat.trial_outcome_revision
  for each row execute function chat.guard_trial_outcome_revision();

-- ===========================================================================
-- 3. A trial's attendance may be corrected (held <-> student_no_show)
-- ===========================================================================

-- chat.guard_lesson as 20261019120000, with one arm: a trial's attendance may
-- move between held and student_no_show inside a correction.
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
    select * into v_teacher from chat.teacher where id = new.teacher_id;

    if new.kind = 'trial' then
      -- A trial: a prospect and a teacher of this organization, booked by staff.
      if v_teacher.organization_id is distinct from new.organization_id
         or not exists (select 1 from chat.trial_prospect p where p.id = new.prospect_id and p.organization_id = new.organization_id) then
        raise exception 'a trial, its prospect and its teacher share one organization' using errcode = 'insufficient_privilege';
      end if;
      if new.created_by_kind <> 'staff'
         or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
        raise exception 'a trial is booked by staff' using errcode = 'check_violation';
      end if;
      if not v_teacher.is_active or v_teacher.left_at is not null then
        raise exception 'an inactive teacher cannot be given a lesson' using errcode = 'check_violation';
      end if;
      if new.outcome is not null then
        raise exception 'a lesson is born open' using errcode = 'check_violation';
      end if;
      return new;
    end if;

    select * into v_learner from chat.learner where id = new.learner_id;
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
  if (new.id, new.organization_id, new.learner_id, new.prospect_id, new.kind, new.makeup_for, new.created_by,
      new.created_by_kind, new.schedule_slot_id, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.prospect_id, old.kind, old.makeup_for, old.created_by,
      old.created_by_kind, old.schedule_slot_id, old.created_at) then
    raise exception 'a lesson''s identity never changes' using errcode = 'check_violation';
  end if;

  if old.outcome is not null
     and (new.teacher_id, new.starts_at, new.ends_at) is distinct from (old.teacher_id, old.starts_at, old.ends_at) then
    raise exception 'a closed lesson cannot be moved' using errcode = 'check_violation';
  end if;

  if new.teacher_id is distinct from old.teacher_id then
    if new.kind = 'trial' then
      -- A trial may be handed to another active teacher of the organization.
      if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id
                       and t.is_active and t.left_at is null) then
        raise exception 'a trial moves only to an active teacher of its organization' using errcode = 'check_violation';
      end if;
    elsif not exists (select 1 from chat.learner l where l.id = new.learner_id and l.teacher_id = new.teacher_id) then
      raise exception 'a lesson moves only to the learner''s assigned teacher' using errcode = 'check_violation';
    end if;
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
    if new.kind = 'trial' and old.outcome in ('held', 'student_no_show') and new.outcome in ('held', 'student_no_show')
       and chat.caller_is_server_side() and coalesce(current_setting('chat.correcting_trial', true), '') = 'on' then
      -- Trial journey: a supervisor's correction of a trial's attendance,
      -- made only through TrialService's correction (history in
      -- chat.trial_outcome_revision).
      null;
    elsif not (old.outcome = 'student_no_show' and new.outcome = 'student_apology' and v_excused) then
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
  elsif new.outcome in ('rescheduled', 'suspended') then
    if now() >= old.starts_at then
      raise exception 'only a lesson that has not started can be moved or suspended' using errcode = 'check_violation';
    end if;
  end if;

  new.outcome_at := now();
  return new;
end;
$$;
-- "A held lesson has a report" (20261018120000), with one exception: a TRIAL
-- whose student Sales recorded as subscribed or not subscribed was attended by
-- that record, whether or not the teacher wrote a trial report. Still checked
-- at commit, so the trial and its outcome are written in one transaction.
create or replace function chat.assert_held_lesson_has_report()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.lesson l where l.id = new.id and l.outcome = 'held')
     and not exists (select 1 from chat.lesson_report r where r.lesson_id = new.id)
     and not exists (
       select 1 from chat.lesson l join chat.trial_outcome o on o.lesson_id = l.id
        where l.id = new.id and l.kind = 'trial' and o.result in ('subscribed', 'not_subscribed')
     ) then
    raise exception 'a held lesson has a report' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- The same check when an outcome is corrected away from a decision: a trial
-- left "held" with neither a report nor a decision would break the rule above
-- without touching chat.lesson.
create or replace function chat.assert_trial_outcome_keeps_attendance_coherent()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.lesson l where l.id = new.lesson_id and l.outcome = 'held')
     and new.result not in ('subscribed', 'not_subscribed')
     and not exists (select 1 from chat.lesson_report r where r.lesson_id = new.lesson_id) then
    raise exception 'a held lesson has a report' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger trial_outcome_keeps_held_coherent
  after insert or update on chat.trial_outcome
  deferrable initially deferred
  for each row execute function chat.assert_trial_outcome_keeps_attendance_coherent();

-- ===========================================================================
-- 4. The subscription form -- CONFINED (G-07)
-- ===========================================================================

-- THE CONTACT COLUMNS ARE DELIBERATE. Phone privacy is structural (G-07): no
-- actor or communication entity carries a phone or an e-mail. The owner decided
-- (2026-10-20) that Sales' subscription form records the parent's phone and
-- e-mail for the New Students page. This table holds them, and the structure
-- stays intact because nothing in the communication engine can read it: no
-- request role has a grant, and new-students-confinement.spec.ts fails the
-- build if any source outside src/new-students names it. The G-07 tripwire's
-- ALLOWED list names exactly this declaration.
create table chat.trial_subscription (
  lesson_id        uuid primary key references chat.trial_outcome (lesson_id),
  organization_id  uuid not null references chat.organization (id),
  parent_name      text not null check (length(btrim(parent_name)) between 1 and 120),
  email            text check (email is null or (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone            text not null constraint trial_subscription_phone_is_confined check (length(btrim(phone)) between 5 and 32),
  -- Each child: {name, age, course, teacherId, packagePrice, lessonPrice,
  -- schedule: [{weekday 1..7 (ISO), time "HH:MM"}]}. Validated by the service;
  -- the shape's outline is checked here.
  children         jsonb not null check (jsonb_typeof(children) = 'array' and jsonb_array_length(children) between 1 and 10),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  payment_method   text not null check (payment_method in ('bank_transfer', 'invoice')),
  recorded_by      uuid not null references chat.staff (id),
  recorded_at      timestamptz not null default now(),
  updated_by       uuid references chat.staff (id),
  updated_at       timestamptz,
  -- Set when the outcome is corrected away from "subscribed"; cleared if it is
  -- corrected back. The row is never deleted.
  withdrawn_at     timestamptz
);

comment on table chat.trial_subscription is
  'Trial journey: Sales'' subscription form for a subscribed trial -- parent, children, payment. CONFINED: no request-role grant; only src/new-students reads or writes it. Never in a message, card, event, search or export.';

create or replace function chat.guard_trial_subscription()
returns trigger
language plpgsql
as $$
declare
  v_outcome chat.trial_outcome%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'a subscription form is never deleted' using errcode = 'check_violation';
  end if;
  select * into v_outcome from chat.trial_outcome where lesson_id = new.lesson_id;
  if v_outcome.organization_id is distinct from new.organization_id then
    raise exception 'a subscription form belongs to its trial''s organization' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.staff s where s.id = new.recorded_by and s.organization_id = new.organization_id) then
      raise exception 'a subscription form is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    new.recorded_at := now();
    new.updated_at := null;
    new.updated_by := null;
  else
    if (new.lesson_id, new.organization_id, new.recorded_by, new.recorded_at)
       is distinct from (old.lesson_id, old.organization_id, old.recorded_by, old.recorded_at) then
      raise exception 'a subscription form keeps who recorded it and when' using errcode = 'check_violation';
    end if;
    if new.updated_by is null or not exists (
      select 1 from chat.staff s where s.id = new.updated_by and s.organization_id = new.organization_id
    ) then
      raise exception 'a change to a subscription form names who made it' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  -- A live form belongs to a subscribed trial; a withdrawn one to a corrected one.
  if (new.withdrawn_at is null) <> (v_outcome.result = 'subscribed') then
    raise exception 'a subscription form is live exactly while its trial is subscribed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trial_subscription_is_coherent
  before insert or update or delete on chat.trial_subscription
  for each row execute function chat.guard_trial_subscription();

create index trial_subscription_org_idx on chat.trial_subscription (organization_id, recorded_at desc)
  where withdrawn_at is null;

-- ===========================================================================
-- 5. Core confirmation retired
-- ===========================================================================

drop trigger if exists learner_links_confirmed_trials on chat.learner;
drop function if exists chat.link_confirmed_trials_to_learner();
drop function if exists chat.confirm_trial_subscription(uuid, text, text);
drop function if exists chat.confirm_trial_conversion(uuid, text, uuid);

-- ===========================================================================
-- 6. Teacher statistics: each trial counted once, by its one outcome
-- ===========================================================================

-- Per teacher, the trials that start in [p_from, p_to), each counted ONCE by
-- its current outcome (so a correction moves it, never doubles it):
--
--   subscribed / not_subscribed / no_show   the supervisor's recorded outcome
--                                           (or the teacher's own "did not
--                                           attend" before any supervisor's)
--   awaiting    started, nothing recorded -- or attended, no decision yet
--   upcoming    not started yet
--   cancelled   did not take place (Jawwid or the teacher cancelled, moved,
--               suspended) -- shown, never part of the total
--
--   total     = subscribed + not_subscribed + no_show + awaiting
--   conducted = the trials the student attended (subscribed + not_subscribed
--               + attended-awaiting-decision)
--
-- Computed from Chat's own records only.
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

-- ===========================================================================
-- 7. Card kind and grants
-- ===========================================================================

insert into chat.message_card_kind (kind) values ('trial_correction');

alter table chat.trial_outcome_revision enable row level security;
alter table chat.trial_subscription     enable row level security;
revoke all on chat.trial_outcome_revision, chat.trial_subscription from public, anon, authenticated, chat_app;

revoke all on function chat.guard_trial_outcome() from public;
revoke all on function chat.record_trial_outcome_revision() from public;
revoke all on function chat.guard_trial_outcome_revision() from public;
revoke all on function chat.guard_trial_subscription() from public;
revoke all on function chat.assert_trial_outcome_keeps_attendance_coherent() from public;
