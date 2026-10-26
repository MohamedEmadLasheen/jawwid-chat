-- PD-31 (2026-10-26): moving one lesson, changing weekly times, changing the
-- teacher -- with nothing lost silently.
--
--   1. chat.lesson.moved_from    a lesson moved to another time continues as a new
--                                row; the old one is `rescheduled` (counted for
--                                nobody) and the new one names it. One successor
--                                per row. The family, the teacher and staff may
--                                move a lesson (guard_lesson, rebuilt from
--                                20261021120000 with the moved-lesson branch).
--   2. chat.skip_moved_occurrence  the materializer never re-creates a weekly
--                                lesson that was moved away: a rescheduled row does
--                                not hold its slot, so without this the old time
--                                came back. A trigger, so chat.materialize_lessons
--                                (which PD-30 also rewrites) is untouched.
--   3. chat.lesson_blocked_occurrence + chat.collect_blocked_occurrences
--                                a weekly lesson the materializer skipped because
--                                the teacher already had another lesson then is
--                                recorded, and staff see it in Needs action. It
--                                used to vanish.
--   4. chat.schedule_change_request  a teacher may ask too (requested_by_kind),
--                                and the request carries its start date.
--   5. chat.transfer_learner     the learner's PD-8 supervisor (an Operations
--                                supervisor, their active backup, the Operations
--                                Manager -- chat.staff_principals) may change the
--                                teacher, beside the Teachers department and the
--                                super admin.
--   6. card kind `lesson_moved`.

-- ===========================================================================
-- 1. Moved lessons
-- ===========================================================================

alter table chat.lesson add column moved_from uuid references chat.lesson (id);

comment on column chat.lesson.moved_from is
  'PD-31: the lesson this one replaces after a move to another time (that row is rescheduled). Written at insert only.';

create unique index lesson_moved_from_once on chat.lesson (moved_from) where moved_from is not null;

create or replace function chat.guard_lesson()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
  v_teacher chat.teacher%rowtype;
  v_missed  chat.lesson%rowtype;
  v_excused boolean;
  v_corr    chat.lesson_correction%rowtype;
  v_from    chat.lesson%rowtype;
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
    if new.created_by_kind in ('contact', 'teacher') then
      if new.created_by_kind = 'contact'
         and not exists (select 1 from chat.contact c where c.id = new.created_by and c.family_id = v_learner.family_id
                            and c.is_active and c.can_message) then
        raise exception 'a family books lessons only for its own children' using errcode = 'insufficient_privilege';
      end if;
      if new.created_by_kind = 'teacher' and new.created_by is distinct from new.teacher_id then
        raise exception 'a teacher books make-ups only for their own lessons' using errcode = 'insufficient_privilege';
      end if;
      if new.moved_from is null then
        select * into v_missed from chat.lesson where id = new.makeup_for;
        if new.kind <> 'makeup' or v_missed.outcome is null
           or v_missed.outcome not in ('teacher_apology', 'teacher_no_show', 'student_apology') then
          raise exception 'only the make-up an apologised or teacher-cancelled lesson owes is booked here'
            using errcode = 'check_violation';
        end if;
      end if;
      if new.starts_at <= now() then
        raise exception 'a make-up is booked in the future' using errcode = 'check_violation';
      end if;
    end if;
    -- PD-31: a moved lesson continues the one it replaces -- same learner, kind
    -- and missed lesson -- which was moved away (rescheduled) in this
    -- transaction, and is in the future. A system lesson is never a move.
    if new.moved_from is not null then
      select * into v_from from chat.lesson where id = new.moved_from;
      if v_from.id is null or v_from.learner_id is distinct from new.learner_id
         or v_from.kind is distinct from new.kind or v_from.makeup_for is distinct from new.makeup_for
         or v_from.outcome is distinct from 'rescheduled' or new.created_by_kind = 'system' then
        raise exception 'a moved lesson continues a lesson of the same learner that was moved away'
          using errcode = 'check_violation';
      end if;
      if new.starts_at <= now() then
        raise exception 'a lesson is moved to the future' using errcode = 'check_violation';
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
    if new.outcome is not null or new.apology_timing is not null then
      raise exception 'a lesson is born open' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.organization_id, new.learner_id, new.prospect_id, new.kind, new.makeup_for, new.created_by,
      new.created_by_kind, new.schedule_slot_id, new.created_at, new.moved_from)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.prospect_id, old.kind, old.makeup_for, old.created_by,
      old.created_by_kind, old.schedule_slot_id, old.created_at, old.moved_from) then
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
    if (new.outcome_note, new.outcome_by_kind, new.outcome_by, new.outcome_at, new.apology_timing)
       is distinct from (old.outcome_note, old.outcome_by_kind, old.outcome_by, old.outcome_at, old.apology_timing) then
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

  select * into v_corr from chat.lesson_correction c
   where c.lesson_id = new.id and c.txid = txid_current()
     and c.from_outcome is not distinct from old.outcome and c.to_outcome = new.outcome
   order by c.corrected_at desc
   limit 1;

  if old.outcome = 'voided' then
    raise exception 'a voided lesson is final' using errcode = 'check_violation';
  end if;

  if new.outcome = 'voided' and v_corr.id is null then
    raise exception 'a lesson is voided only by a recorded correction' using errcode = 'check_violation';
  end if;

  if old.outcome is not null then
    if new.kind = 'trial' and old.outcome in ('held', 'student_no_show') and new.outcome in ('held', 'student_no_show')
       and chat.caller_is_server_side() and coalesce(current_setting('chat.correcting_trial', true), '') = 'on' then
      -- Trial journey (20261021100000): a supervisor's correction of a trial's
      -- attendance, made only through TrialService's correction (history in
      -- chat.trial_outcome_revision).
      null;
    -- PD-15: two changes are lawful for a learner's lesson: an absence the
    -- supervisor excused, and a correction recorded in this very transaction.
    elsif not ((old.outcome = 'student_no_show' and new.outcome = 'student_apology' and v_excused)
               or v_corr.id is not null) then
      raise exception 'an outcome is written once; only an excusing ruling or a recorded correction changes it'
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

  new.apology_timing := case
    when new.outcome <> 'student_apology' then null
    when v_corr.id is not null then v_corr.apology_timing
    when now() < old.starts_at then 'before_start'
    else 'after_start'
  end;
  new.outcome_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 2. A weekly lesson moved away is not re-created
-- ===========================================================================

create or replace function chat.skip_moved_occurrence()
returns trigger
language plpgsql
as $$
begin
  if new.created_by_kind = 'system' and new.schedule_slot_id is not null and exists (
    select 1 from chat.lesson x
     where x.schedule_slot_id = new.schedule_slot_id
       and x.starts_at = new.starts_at
       and x.outcome = 'rescheduled'
       and exists (select 1 from chat.lesson y where y.moved_from = x.id)) then
    return null;
  end if;
  return new;
end;
$$;

create trigger lesson_moved_occurrence_stays_moved before insert on chat.lesson
  for each row execute function chat.skip_moved_occurrence();

-- ===========================================================================
-- 3. Weekly lessons the teacher's other lessons blocked
-- ===========================================================================

create table chat.lesson_blocked_occurrence (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  learner_id        uuid not null references chat.learner (id),
  teacher_id        uuid not null references chat.teacher (id),
  schedule_slot_id  uuid not null references chat.learner_schedule_slot (id),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null check (ends_at > starts_at),
  blocked_by        uuid not null references chat.lesson (id),
  detected_at       timestamptz not null default now(),
  resolution        text check (resolution in ('scheduled', 'dismissed', 'cleared')),
  resolved_at       timestamptz,
  resolved_by       uuid references chat.staff (id),
  lesson_id         uuid references chat.lesson (id),
  note              text check (note is null or length(btrim(note)) between 1 and 1000),
  constraint lesson_blocked_occurrence_resolution_is_whole
    check ((resolution is null) = (resolved_at is null)
           and (resolution = 'scheduled') = (lesson_id is not null)
           and (resolution in ('scheduled', 'dismissed')) = (resolved_by is not null))
);

comment on table chat.lesson_blocked_occurrence is
  'PD-31: a weekly lesson chat.materialize_lessons could not create because the teacher already had another lesson at that time. Staff schedule it elsewhere or dismiss it; it clears itself when the time frees up and the lesson is created.';

create unique index lesson_blocked_occurrence_once on chat.lesson_blocked_occurrence (schedule_slot_id, starts_at);
create index lesson_blocked_occurrence_open on chat.lesson_blocked_occurrence (organization_id) where resolution is null;

create or replace function chat.guard_lesson_blocked_occurrence()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a blocked weekly lesson is resolved, never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if old.resolution is not null then
      raise exception 'a resolved blocked lesson is final' using errcode = 'check_violation';
    end if;
    if (new.id, new.organization_id, new.learner_id, new.teacher_id, new.schedule_slot_id, new.starts_at,
        new.ends_at, new.blocked_by, new.detected_at)
       is distinct from
       (old.id, old.organization_id, old.learner_id, old.teacher_id, old.schedule_slot_id, old.starts_at,
        old.ends_at, old.blocked_by, old.detected_at) then
      raise exception 'only the resolution of a blocked lesson may be written' using errcode = 'check_violation';
    end if;
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create trigger lesson_blocked_occurrence_is_kept before update or delete on chat.lesson_blocked_occurrence
  for each row execute function chat.guard_lesson_blocked_occurrence();

-- Records every occurrence between p_from and p_until that the materializer
-- passed over because another lesson already holds the teacher's time, and
-- clears the open ones that now have their lesson or no longer exist. The
-- occurrence rule is chat.materialize_lessons' own, minus the collision.
create or replace function chat.collect_blocked_occurrences(p_from timestamptz, p_until timestamptz)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with occurrences as (
    select s.*, d::date as day, ((d::date + make_interval(mins => s.start_minute)) at time zone s.timezone) as at
      from chat.learner_schedule_slot s
      cross join lateral generate_series(
        greatest(s.valid_from, (p_from at time zone s.timezone)::date),
        least(coalesce(s.valid_to - 1, 'infinity'::date), (p_until at time zone s.timezone)::date),
        interval '1 day') d
     where extract(isodow from d) = s.weekday
  ), missing as (
    select o.*, b.id as blocker
      from occurrences o
      join chat.learner l on l.id = o.learner_id and l.teacher_id = o.teacher_id
      join chat.teacher t on t.id = o.teacher_id and t.is_active and t.left_at is null
      cross join lateral (
        select x.id from chat.lesson x
         where x.teacher_id = o.teacher_id
           and (x.outcome is null or x.outcome in ('held', 'student_no_show', 'teacher_no_show'))
           and tstzrange(x.starts_at, x.ends_at) && tstzrange(o.at, o.at + make_interval(mins => o.duration_minutes))
         order by x.starts_at
         limit 1) b
     where o.at >= p_from and o.at < p_until
       and not chat.learner_suspended_on(o.learner_id, o.day)
       and not exists (select 1 from chat.teacher_day_off off where off.teacher_id = o.teacher_id and off.day = o.day)
       and not exists (select 1 from chat.lesson z where z.schedule_slot_id = o.id and z.starts_at = o.at)
  )
  insert into chat.lesson_blocked_occurrence (organization_id, learner_id, teacher_id, schedule_slot_id,
                                              starts_at, ends_at, blocked_by)
  select m.organization_id, m.learner_id, m.teacher_id, m.id, m.at,
         m.at + make_interval(mins => m.duration_minutes), m.blocker
    from missing m
  on conflict (schedule_slot_id, starts_at) do nothing;
  get diagnostics v_count = row_count;

  -- Cleared: the lesson exists now (the blocker moved away), or the weekly time
  -- ended, or the learner changed teacher.
  update chat.lesson_blocked_occurrence b set resolution = 'cleared'
   where b.resolution is null
     and (exists (select 1 from chat.lesson z
                   where z.schedule_slot_id = b.schedule_slot_id and z.starts_at = b.starts_at
                     and (z.outcome is null or z.outcome not in ('suspended', 'rescheduled')))
          or exists (select 1 from chat.learner_schedule_slot s
                      where s.id = b.schedule_slot_id and s.valid_to is not null
                        and s.valid_to <= (b.starts_at at time zone s.timezone)::date)
          or not exists (select 1 from chat.learner l where l.id = b.learner_id and l.teacher_id = b.teacher_id));
  return v_count;
end;
$$;

-- ===========================================================================
-- 4. A teacher may ask for new weekly times; a request says from when
-- ===========================================================================

alter table chat.schedule_change_request drop constraint schedule_change_request_requested_by_fkey;
alter table chat.schedule_change_request
  add column requested_by_kind text not null default 'contact' check (requested_by_kind in ('contact', 'teacher')),
  add column effective_from    date;

comment on column chat.schedule_change_request.requested_by is
  'A chat.contact of the learner''s family (requested_by_kind contact) or the learner''s teacher (teacher, PD-31). Checked by chat.guard_schedule_change_request.';

create or replace function chat.guard_schedule_change_request()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_learner from chat.learner where id = new.learner_id;
    if v_learner.organization_id is distinct from new.organization_id then
      raise exception 'a family asks only about its own children' using errcode = 'insufficient_privilege';
    end if;
    if new.requested_by_kind = 'contact'
       and not exists (select 1 from chat.contact c where c.id = new.requested_by and c.family_id = v_learner.family_id) then
      raise exception 'a family asks only about its own children' using errcode = 'insufficient_privilege';
    end if;
    if new.requested_by_kind = 'teacher' and new.requested_by is distinct from v_learner.teacher_id then
      raise exception 'a teacher asks only about their own students' using errcode = 'insufficient_privilege';
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
  if (new.id, new.organization_id, new.learner_id, new.requested_by, new.requested_by_kind, new.slots, new.note,
      new.effective_from, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.requested_by, old.requested_by_kind, old.slots, old.note,
      old.effective_from, old.created_at) then
    raise exception 'only the decision of a request may be written' using errcode = 'check_violation';
  end if;
  if new.decided_by is not null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 5. Who may change a learner's teacher
-- ===========================================================================

create or replace function chat.transfer_learner(
  p_learner_id     uuid,
  p_to_teacher_id  uuid,
  p_reason_code    text,
  p_note           text,
  p_handover_note  text,
  p_actor_id       uuid
) returns table (conversation_id uuid, removed_teacher_id uuid)
language plpgsql
as $$
declare
  v_actor   uuid := chat.trusted_staff_actor(p_actor_id);
  v_learner chat.learner%rowtype;
  v_to      chat.teacher%rowtype;
  v_from    uuid;
  v_conv    record;
  v_lesson  record;
  v_tz      text;
begin
  select * into v_learner from chat.learner where id = p_learner_id for update;
  if v_learner.id is null then
    raise exception 'learner % does not exist', p_learner_id using errcode = 'no_data_found';
  end if;
  -- PD-31: the Teachers department and the super admin, or the learner's
  -- PD-8 supervisor -- through chat.staff_principals, which also answers for
  -- an active backup and the Operations Manager.
  if not (chat.is_lesson_manager(v_actor, v_learner.organization_id)
          or exists (select 1 from chat.learner_supervision ls
                      where ls.learner_id = p_learner_id
                        and ls.organization_id = v_learner.organization_id
                        and ls.supervisor_id in (select chat.staff_principals(v_actor, now())))) then
    raise exception 'only the Teachers department or the learner''s supervisor moves a learner between teachers'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_to from chat.teacher where id = p_to_teacher_id;
  if v_to.id is null or v_to.organization_id is distinct from v_learner.organization_id then
    raise exception 'the new teacher belongs to the learner''s organization' using errcode = 'insufficient_privilege';
  end if;
  if not v_to.is_active or v_to.left_at is not null then
    raise exception 'an inactive teacher cannot take a learner' using errcode = 'check_violation';
  end if;
  v_from := v_learner.teacher_id;
  if v_from = p_to_teacher_id then
    raise exception 'the learner already has this teacher' using errcode = 'check_violation';
  end if;

  perform set_config('chat.syncing_assignment', 'on', true);
  update chat.learner set teacher_id = p_to_teacher_id where id = p_learner_id;
  perform set_config('chat.syncing_assignment', 'off', true);

  -- The student group: swap the teacher.
  for v_conv in
    select c.id from chat.conversation c
     where c.type = 'student_group' and c.learner_id = p_learner_id and c.archived_at is null
  loop
    if v_from is not null then
      update chat.conversation_member m set left_at = now()
       where m.conversation_id = v_conv.id and m.actor_id = v_from and m.left_at is null;
      if found then
        conversation_id := v_conv.id; removed_teacher_id := v_from; return next;
      end if;
    end if;
    if not exists (select 1 from chat.conversation_member m
                    where m.conversation_id = v_conv.id and m.actor_id = p_to_teacher_id and m.left_at is null) then
      insert into chat.conversation_member (conversation_id, actor_id, actor_kind, member_role)
      values (v_conv.id, p_to_teacher_id, 'teacher', 'teacher');
    end if;
  end loop;

  -- Family groups about the learner: the old teacher was pruned by the trigger
  -- (unless they still teach a sibling there); the new one joins.
  for v_conv in
    select c.id from chat.conversation c
      join chat.conversation_learner cl on cl.conversation_id = c.id
     where cl.learner_id = p_learner_id and c.type = 'family_group' and c.archived_at is null
  loop
    if v_from is not null and not exists (
      select 1 from chat.conversation_member m
       where m.conversation_id = v_conv.id and m.actor_id = v_from and m.left_at is null) then
      conversation_id := v_conv.id; removed_teacher_id := v_from; return next;
    end if;
    if not exists (select 1 from chat.conversation_member m
                    where m.conversation_id = v_conv.id and m.actor_id = p_to_teacher_id and m.left_at is null) then
      insert into chat.conversation_member (conversation_id, actor_id, actor_kind, member_role)
      values (v_conv.id, p_to_teacher_id, 'teacher', 'teacher');
    end if;
  end loop;

  -- Regular times end today (in their own zone); the caller sets the new ones.
  update chat.learner_schedule_slot s
     set valid_to = greatest(s.valid_from, (now() at time zone s.timezone)::date)
   where s.learner_id = p_learner_id and s.valid_to is null;

  -- Future open lessons follow the learner where the new teacher is free.
  for v_lesson in
    select l.id, l.starts_at, l.ends_at from chat.lesson l
     where l.learner_id = p_learner_id and l.outcome is null and l.starts_at > now()
     order by l.starts_at
  loop
    if exists (
      select 1 from chat.lesson x
       where x.teacher_id = p_to_teacher_id
         and (x.outcome is null or x.outcome in ('held', 'student_no_show', 'teacher_no_show'))
         and tstzrange(x.starts_at, x.ends_at) && tstzrange(v_lesson.starts_at, v_lesson.ends_at)) then
      update chat.lesson set outcome = 'rescheduled', outcome_note = 'teacher changed; the new teacher is not free then',
             outcome_by_kind = 'staff', outcome_by = v_actor, outcome_at = now()
       where id = v_lesson.id;
    else
      update chat.lesson set teacher_id = p_to_teacher_id, reminders_scheduled_at = null where id = v_lesson.id;
    end if;
    update chat.notification set status = 'cancelled'
     where status = 'scheduled' and dedupe_key like '%:' || v_lesson.id::text || ':%';
  end loop;

  insert into chat.learner_transfer (organization_id, learner_id, from_teacher_id, to_teacher_id,
                                     reason_code, note, handover_note, decided_by)
  values (v_learner.organization_id, p_learner_id, v_from, p_to_teacher_id,
          p_reason_code, p_note, p_handover_note, v_actor);

  perform chat.write_audit(
    v_actor, 'learner.transferred', 'learner', p_learner_id, coalesce(p_note, p_reason_code),
    jsonb_build_object('teacher_id', v_from),
    jsonb_build_object('teacher_id', p_to_teacher_id, 'reason_code', p_reason_code));
  return;
end;
$$;

-- ===========================================================================
-- 6. Cards and request roles
-- ===========================================================================

insert into chat.message_card_kind (kind) values ('lesson_moved');

alter table chat.lesson_blocked_occurrence enable row level security;
revoke all on chat.lesson_blocked_occurrence from public, anon, authenticated, chat_app;

revoke all on function chat.skip_moved_occurrence() from public;
revoke all on function chat.guard_lesson_blocked_occurrence() from public;
revoke all on function chat.collect_blocked_occurrences(timestamptz, timestamptz) from public;
revoke all on function chat.transfer_learner(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, chat_app;
