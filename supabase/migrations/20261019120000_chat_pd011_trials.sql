-- PD-11 T4, part 1 (2026-10-19) -- trial lessons and their two facts.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, PD-9 ("a trial is a
-- lesson with kind = trial") and PD-11 (attendance is the teacher's fact,
-- conversion is Sales', and a conversion counts once Core confirms it).
--
-- WHAT IS NEW
--
--   chat.trial_prospect   a family considering Jawwid, named by display name
--                         only -- no phone, no e-mail (BR-2). Sales records it.
--                         Linked to its chat.learner once Core creates one.
--   chat.lesson           kind 'trial': a lesson for a PROSPECT, not a learner
--                         (learner_id null, prospect_id set). Everything that
--                         keeps a teacher's time -- the exclusion constraint,
--                         free slots, the materializer -- already counts it,
--                         because it is a lesson row.
--   chat.trial_outcome    Sales' fact about an ATTENDED trial: subscribed, or
--                         not subscribed with a reason. A subscription is
--                         CONFIRMED only by chat.confirm_trial_conversion(),
--                         which Core ingestion calls with Core's reference.
--
-- ALSO: chat.materialize_lessons skips the teacher's days off (section 4).
--
-- WHAT IS NOT HERE (part 2, after PD-12 S1 merges): the per-teacher trial group
-- conversation and the trial cards. Both extend PD-12's conversation type and
-- chat.message_card_kind rather than rewriting them.

-- ===========================================================================
-- 1. Prospects
-- ===========================================================================

create table chat.trial_prospect (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  display_name     text not null check (length(btrim(display_name)) between 1 and 120),
  level            text check (level is null or length(btrim(level)) between 1 and 80),
  note             text check (note is null or length(btrim(note)) between 1 and 1000),
  learner_id       uuid references chat.learner (id),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now()
);

comment on table chat.trial_prospect is
  'PD-11 T4: a prospective student, by display name only (BR-2: no contact detail). learner_id links it once Core creates the learner.';

create index trial_prospect_org_idx on chat.trial_prospect (organization_id, created_at);

create or replace function chat.guard_trial_prospect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a prospect is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    if new.learner_id is not null then
      raise exception 'a prospect is linked to a learner only when Core confirms it' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- UPDATE: the one change is the link to the learner Core created, made once,
  -- by the confirmation (server side).
  if (new.id, new.organization_id, new.display_name, new.level, new.note, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.display_name, old.level, old.note, old.created_by, old.created_at) then
    raise exception 'a prospect is not rewritten' using errcode = 'check_violation';
  end if;
  if new.learner_id is distinct from old.learner_id then
    if old.learner_id is not null or not chat.caller_is_server_side()
       or coalesce(current_setting('chat.confirming_trial', true), '') <> 'on' then
      raise exception 'a prospect is linked to its learner only by the confirmation' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.learner l where l.id = new.learner_id and l.organization_id = new.organization_id) then
      raise exception 'a prospect is linked to a learner of its organization' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger trial_prospect_is_coherent before insert or update on chat.trial_prospect
  for each row execute function chat.guard_trial_prospect();

create or replace function chat.forbid_trial_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are never deleted', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger trial_prospect_is_kept before delete on chat.trial_prospect
  for each row execute function chat.forbid_trial_delete();

-- ===========================================================================
-- 2. Trial lessons
-- ===========================================================================

alter table chat.lesson alter column learner_id drop not null;
alter table chat.lesson add column prospect_id uuid references chat.trial_prospect (id);

alter table chat.lesson drop constraint lesson_kind_check;
alter table chat.lesson add constraint lesson_kind_check check (kind in ('regular', 'makeup', 'trial'));
alter table chat.lesson add constraint lesson_trial_is_for_a_prospect
  check ((kind = 'trial') = (prospect_id is not null) and (kind = 'trial') = (learner_id is null));

create index lesson_prospect_idx on chat.lesson (prospect_id) where prospect_id is not null;

-- chat.guard_lesson, with the trial arm. Everything else is as 20261018160000.
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
  elsif new.outcome in ('rescheduled', 'suspended') then
    if now() >= old.starts_at then
      raise exception 'only a lesson that has not started can be moved or suspended' using errcode = 'check_violation';
    end if;
  end if;

  new.outcome_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 3. Sales' fact: the conversion
-- ===========================================================================

create table chat.trial_outcome (
  lesson_id              uuid primary key references chat.lesson (id),
  organization_id        uuid not null references chat.organization (id),
  result                 text not null check (result in ('subscribed', 'not_subscribed')),
  reason_code            text check (reason_code in ('price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other')),
  note                   text check (note is null or length(btrim(note)) between 1 and 1000),
  recorded_by            uuid not null references chat.staff (id),
  recorded_at            timestamptz not null default now(),
  confirmed_at           timestamptz,
  core_subscription_ref  text check (core_subscription_ref is null or length(btrim(core_subscription_ref)) between 1 and 200),
  constraint trial_outcome_reason_iff_not_subscribed check ((result = 'not_subscribed') = (reason_code is not null)),
  constraint trial_outcome_confirms_a_subscription check (confirmed_at is null or result = 'subscribed'),
  constraint trial_outcome_confirmation_is_whole check ((confirmed_at is null) = (core_subscription_ref is null))
);

comment on table chat.trial_outcome is
  'PD-11 T4: Sales'' fact about an attended trial. A subscription counts for the teacher only once confirmed_at is set by chat.confirm_trial_conversion (Core).';

create index trial_outcome_unconfirmed_idx on chat.trial_outcome (organization_id, recorded_at)
  where result = 'subscribed' and confirmed_at is null;

create or replace function chat.guard_trial_outcome()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_lesson from chat.lesson where id = new.lesson_id;
    if v_lesson.kind is distinct from 'trial' then
      raise exception 'an outcome of this kind belongs to a trial lesson' using errcode = 'check_violation';
    end if;
    if v_lesson.organization_id is distinct from new.organization_id
       or not exists (select 1 from chat.staff s where s.id = new.recorded_by and s.organization_id = new.organization_id) then
      raise exception 'a trial outcome belongs to its lesson''s organization' using errcode = 'insufficient_privilege';
    end if;
    if v_lesson.outcome is distinct from 'held' then
      raise exception 'only a trial the prospect attended can lead to a subscription decision' using errcode = 'check_violation';
    end if;
    if new.confirmed_at is not null then
      raise exception 'a subscription is confirmed by Core, never at recording' using errcode = 'check_violation';
    end if;
    new.recorded_at := now();
    return new;
  end if;
  -- UPDATE: only the confirmation, once, by the server-side confirmation.
  if (new.lesson_id, new.organization_id, new.result, new.reason_code, new.note, new.recorded_by, new.recorded_at)
     is distinct from
     (old.lesson_id, old.organization_id, old.result, old.reason_code, old.note, old.recorded_by, old.recorded_at) then
    raise exception 'a trial outcome is written once' using errcode = 'check_violation';
  end if;
  if old.confirmed_at is not null then
    raise exception 'a confirmed subscription is final' using errcode = 'check_violation';
  end if;
  if not chat.caller_is_server_side() or coalesce(current_setting('chat.confirming_trial', true), '') <> 'on' then
    raise exception 'a subscription is confirmed only by chat.confirm_trial_conversion' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger trial_outcome_is_coherent before insert or update on chat.trial_outcome
  for each row execute function chat.guard_trial_outcome();
create trigger trial_outcome_is_kept before delete on chat.trial_outcome
  for each row execute function chat.forbid_trial_delete();

-- The ONE way a subscription becomes confirmed: Core ingestion (server side)
-- reports the subscription it recorded for the trial's prospect, optionally
-- with the learner it created, which links the prospect to that learner.
create or replace function chat.confirm_trial_conversion(
  p_lesson_id uuid, p_core_subscription_ref text, p_learner_id uuid default null
) returns void
language plpgsql
as $$
declare
  v_outcome chat.trial_outcome%rowtype;
  v_prospect uuid;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server confirms a subscription' using errcode = 'insufficient_privilege';
  end if;
  select * into v_outcome from chat.trial_outcome where lesson_id = p_lesson_id for update;
  if v_outcome.lesson_id is null or v_outcome.result <> 'subscribed' then
    raise exception 'no subscription was recorded for this trial' using errcode = 'check_violation';
  end if;
  if v_outcome.confirmed_at is not null then
    return; -- a redelivered confirmation is a no-op
  end if;
  perform set_config('chat.confirming_trial', 'on', true);
  update chat.trial_outcome
     set confirmed_at = now(), core_subscription_ref = p_core_subscription_ref
   where lesson_id = p_lesson_id;
  if p_learner_id is not null then
    select prospect_id into v_prospect from chat.lesson where id = p_lesson_id;
    update chat.trial_prospect set learner_id = p_learner_id where id = v_prospect and learner_id is null;
  end if;
  perform set_config('chat.confirming_trial', 'off', true);
end;
$$;

-- ===========================================================================
-- 4. The materializer honours a teacher's day off
-- ===========================================================================

-- T2's materializer generated regular lessons ~4 weeks ahead without looking at
-- chat.teacher_day_off, so a day off recorded further out (an approved PD-12
-- leave, a PD-12 suspension day) was filled with lessons later. Free slots
-- already skip those days; the materializer now does too. Unchanged otherwise.
create or replace function chat.materialize_lessons(p_from timestamptz, p_until timestamptz)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('chat.materialize_lessons'));
  with occurrences as (
    select s.*, d::date as day, ((d::date + make_interval(mins => s.start_minute)) at time zone s.timezone) as at
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
       and not chat.learner_suspended_on(o.learner_id, o.day)
       and not exists (select 1 from chat.teacher_day_off off where off.teacher_id = o.teacher_id and off.day = o.day)
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
  on conflict (schedule_slot_id, starts_at) where outcome is null or outcome not in ('suspended', 'rescheduled')
  do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function chat.materialize_lessons(timestamptz, timestamptz) from public;

-- ===========================================================================
-- 5. Request roles
-- ===========================================================================

alter table chat.trial_prospect enable row level security;
alter table chat.trial_outcome  enable row level security;
revoke all on chat.trial_prospect, chat.trial_outcome from public, anon, authenticated, chat_app;

revoke all on function chat.guard_trial_prospect() from public;
revoke all on function chat.guard_trial_outcome() from public;
revoke all on function chat.forbid_trial_delete() from public;
revoke all on function chat.confirm_trial_conversion(uuid, text, uuid) from public, anon, authenticated, chat_app;
