-- PD-11 T3 (2026-10-18) -- transfers between teachers, suspensions, and the
-- Teacher Supervision timeline.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md, PD-10 and PD-11.
--
-- WHAT IS NEW
--
--   chat.learner_transfer         one row per transfer: from, to, reason, and the
--                                 handover note for the new teacher. Append-only.
--   chat.transfer_learner()       THE second writer of chat.learner.teacher_id
--                                 (PD-11: "Chat writes the teacher assignment for
--                                 cut-over teachers"). It decides who may, opens
--                                 chat.syncing_assignment for its own statement
--                                 only, and moves the learner's groups and future
--                                 lessons in the same transaction.
--   chat.learner_suspension       a learner's study paused until a return date,
--                                 or stopped. One active per learner.
--   chat.teacher_supervision_entry PD-10's supervision timeline: bonus, complaint,
--                                 monthly comment, note. Append-only.
--
-- WHAT CHANGES
--
--   chat.lesson gains the outcome `suspended`: a future lesson removed because the
--   learner's study is paused or stopped. Like `rescheduled`, statistics do not
--   count it against anyone. chat.materialize_lessons skips suspended dates.

-- ===========================================================================
-- 1. Lessons: `suspended`
-- ===========================================================================

alter table chat.lesson drop constraint lesson_outcome_check;
alter table chat.lesson add constraint lesson_outcome_check check (outcome in (
  'held', 'student_apology', 'teacher_apology', 'admin_cancelled',
  'student_no_show', 'teacher_no_show', 'rescheduled', 'suspended'));

alter table chat.lesson drop constraint lesson_outcome_recorded_by_a_plausible_actor;
alter table chat.lesson add constraint lesson_outcome_recorded_by_a_plausible_actor
  check (outcome is null
      or (outcome in ('held', 'student_no_show') and outcome_by_kind in ('teacher', 'staff'))
      or (outcome = 'student_apology' and outcome_by_kind in ('contact', 'staff'))
      or (outcome = 'teacher_apology' and outcome_by_kind in ('teacher', 'staff'))
      or (outcome in ('admin_cancelled', 'teacher_no_show', 'rescheduled', 'suspended') and outcome_by_kind = 'staff'));

-- A suspended or moved lesson must not block its own replacement: when a pause
-- ends early the materializer re-creates the occurrence. So "one lesson per
-- slot and start" holds for LIVE lessons only.
alter table chat.lesson drop constraint lesson_slot_occurrence_is_unique;
create unique index lesson_slot_occurrence_is_unique on chat.lesson (schedule_slot_id, starts_at)
  where outcome is null or outcome not in ('suspended', 'rescheduled');

-- The guard's "before the start" rule for `rescheduled` applies to `suspended`
-- too; chat.guard_lesson is redefined with the one extra arm.
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

  -- An open lesson changes teacher only with its learner (a transfer).
  if new.teacher_id is distinct from old.teacher_id
     and not exists (select 1 from chat.learner l where l.id = new.learner_id and l.teacher_id = new.teacher_id) then
    raise exception 'a lesson moves only to the learner''s assigned teacher' using errcode = 'check_violation';
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
-- 2. Transfers
-- ===========================================================================

create table chat.learner_transfer (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id),
  from_teacher_id  uuid references chat.teacher (id),
  to_teacher_id    uuid not null references chat.teacher (id),
  reason_code      text not null check (reason_code in (
                     'family_request', 'teacher_request', 'schedule_fit', 'level_fit',
                     'quality', 'teacher_leaving', 'other')),
  note             text check (note is null or length(btrim(note)) between 1 and 1000),
  handover_note    text check (handover_note is null or length(btrim(handover_note)) between 1 and 2000),
  decided_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now()
);

comment on table chat.learner_transfer is
  'PD-11: a learner moved from one teacher to another. The record of the change, its reason and the handover note. Append-only.';

create index learner_transfer_learner_idx on chat.learner_transfer (learner_id, created_at);
create index learner_transfer_teacher_idx on chat.learner_transfer (to_teacher_id);
create index learner_transfer_from_idx on chat.learner_transfer (from_teacher_id);

create or replace function chat.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger learner_transfer_is_append_only before update or delete on chat.learner_transfer
  for each row execute function chat.forbid_change();

-- May this staff member move children between teachers? The super admin, and
-- the organization's Teachers department (its manager and its members) --
-- the same people LessonService calls lesson managers.
create or replace function chat.is_lesson_manager(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null
       and (s.role = 'super_admin'
            or exists (select 1 from chat.department d
                        where d.organization_id = p_org and d.kind = 'teachers'
                          and (d.manager_id = s.id
                               or exists (select 1 from chat.department_member m
                                           where m.department_id = d.id and m.staff_id = s.id)))));
$$;

-- Moves a learner to another teacher, in the caller's transaction:
--   * chat.learner.teacher_id, through the assignment gate, for this one statement
--   * the live student group: the old teacher leaves, the new one joins and reads
--     the whole history (membership has no joined-at cut-off)
--   * every live family group about the learner: the new teacher joins (the old
--     one is pruned by learner_teacher_change_prunes_family_groups)
--   * the learner's future open lessons move to the new teacher where the new
--     teacher is free, and are `rescheduled` otherwise; their reminders are
--     re-armed for the new teacher
--   * the current regular times end today; the caller sets new ones
-- Returns the conversations the old teacher was removed from, so the caller can
-- evict their sockets (RT-009) after the commit.
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
  if not chat.is_lesson_manager(v_actor, v_learner.organization_id) then
    raise exception 'only the Teachers department moves a learner between teachers'
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
-- 3. Suspensions
-- ===========================================================================

create table chat.learner_suspension (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references chat.organization (id),
  learner_id          uuid not null references chat.learner (id),
  kind                text not null check (kind in ('temporary', 'permanent')),
  reason_code         text not null check (reason_code in (
                        'travel', 'exams', 'health', 'holiday', 'financial', 'schedule',
                        'quality', 'finished', 'moved_elsewhere', 'other')),
  note                text check (note is null or length(btrim(note)) between 1 and 1000),
  starts_on           date not null,
  return_on           date,
  status              text not null default 'active' check (status in ('active', 'ended')),
  ended_at            timestamptz,
  ended_by            uuid references chat.staff (id),
  return_notified_at  timestamptz,
  created_by          uuid not null references chat.staff (id),
  created_at          timestamptz not null default now(),
  constraint learner_suspension_return_matches_kind
    check ((kind = 'temporary') = (return_on is not null)),
  constraint learner_suspension_return_after_start
    check (return_on is null or return_on > starts_on),
  constraint learner_suspension_end_is_whole
    check ((status = 'ended') = (ended_at is not null))
);

comment on table chat.learner_suspension is
  'PD-11: a learner''s study paused until return_on (temporary) or stopped (permanent). Core holds the package; Chat stops the lessons.';

create unique index learner_suspension_one_active on chat.learner_suspension (learner_id) where status = 'active';
create index learner_suspension_org_idx on chat.learner_suspension (organization_id, status, kind);

create or replace function chat.guard_learner_suspension()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.learner l where l.id = new.learner_id and l.organization_id = new.organization_id)
       or not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a suspension belongs to its learner''s organization' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'active' then
      raise exception 'a suspension is recorded active' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'ended' then
    raise exception 'an ended suspension is final' using errcode = 'check_violation';
  end if;
  -- While active: it may be extended (return_on), its notice re-armed, or ended.
  if (new.id, new.organization_id, new.learner_id, new.kind, new.reason_code, new.note, new.starts_on,
      new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.learner_id, old.kind, old.reason_code, old.note, old.starts_on,
      old.created_by, old.created_at) then
    raise exception 'a suspension is extended or ended, never rewritten' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger learner_suspension_is_coherent before insert or update on chat.learner_suspension
  for each row execute function chat.guard_learner_suspension();

create trigger learner_suspension_is_kept before delete on chat.learner_suspension
  for each row execute function chat.forbid_change();

-- Is the learner's study paused or stopped on this (zone-local) date?
create or replace function chat.learner_suspended_on(p_learner uuid, p_day date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.learner_suspension s
     where s.learner_id = p_learner and s.status = 'active'
       and p_day >= s.starts_on
       and (s.return_on is null or p_day < s.return_on));
$$;

-- The materializer, now skipping suspended dates.
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

-- ===========================================================================
-- 4. The Teacher Supervision timeline
-- ===========================================================================

create table chat.teacher_supervision_entry (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  kind             text not null check (kind in ('bonus', 'complaint', 'monthly_comment', 'note')),
  body             text not null check (length(btrim(body)) between 1 and 2000),
  -- monthly_comment: the month it is about (first day). A correction adds a new row.
  period           date check (period is null or extract(day from period) = 1),
  conversation_id  uuid references chat.conversation (id),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  constraint teacher_supervision_monthly_names_its_month check ((kind = 'monthly_comment') = (period is not null))
);

comment on table chat.teacher_supervision_entry is
  'PD-10/PD-11: one typed entry on a teacher''s supervision timeline. Append-only. Read by the Teachers department and the super admin only.';

create index teacher_supervision_entry_teacher_idx on chat.teacher_supervision_entry (teacher_id, created_at);

create or replace function chat.guard_teacher_supervision_entry()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not chat.is_lesson_manager(new.created_by, new.organization_id) then
    raise exception 'a supervision entry is written by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teacher_supervision_entry_is_coherent before insert on chat.teacher_supervision_entry
  for each row execute function chat.guard_teacher_supervision_entry();
create trigger teacher_supervision_entry_is_append_only before update or delete on chat.teacher_supervision_entry
  for each row execute function chat.forbid_change();

-- ===========================================================================
-- 5. Cards
-- ===========================================================================

alter table chat.message_card drop constraint message_card_kind_check;
alter table chat.message_card add constraint message_card_kind_check check (kind in (
  'lesson_report', 'lesson_absence', 'lesson_apology', 'lesson_teacher_apology',
  'lesson_cancelled', 'lesson_late_apology', 'lesson_ruling',
  'lesson_makeup_booked', 'lesson_makeup_resolved',
  'schedule_change_requested', 'schedule_change_decided',
  'learner_transferred', 'learner_handover',
  'learner_suspended', 'learner_return_soon', 'learner_resumed',
  'teacher_bonus'));

-- ===========================================================================
-- 6. Request roles
-- ===========================================================================

alter table chat.learner_transfer            enable row level security;
alter table chat.learner_suspension          enable row level security;
alter table chat.teacher_supervision_entry   enable row level security;

revoke all on chat.learner_transfer, chat.learner_suspension, chat.teacher_supervision_entry
  from public, anon, authenticated, chat_app;

revoke all on function chat.forbid_change() from public;
revoke all on function chat.is_lesson_manager(uuid, uuid) from public;
revoke all on function chat.transfer_learner(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, chat_app;
revoke all on function chat.guard_learner_suspension() from public;
revoke all on function chat.learner_suspended_on(uuid, date) from public;
revoke all on function chat.guard_teacher_supervision_entry() from public;
