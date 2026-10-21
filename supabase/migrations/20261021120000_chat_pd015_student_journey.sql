-- PD-15 (2026-10-21) -- the student's journey after enrolment: supervisors'
-- excuse cards, make-ups after any apology, quick lesson reports that can be
-- edited, deleted and resent, outcome corrections, and each child's
-- enrolment details.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-15.
--
-- WHAT IS NEW
--
--   chat.lesson.apology_timing   a student apology is `before_start` or
--                                `after_start`. Written by chat.guard_lesson,
--                                never by a request: the database clock (or the
--                                correction that names it) decides.
--   outcome `voided`             a lesson whose report was deleted and not
--                                resent. It is gone from every statistic.
--   chat.lesson_correction       one row per corrected outcome: from, to,
--                                reason, who, when. It is the ONLY thing besides
--                                an excusing ruling that may change a written
--                                outcome, and only in the transaction that wrote
--                                it (txid), so a correction cannot be replayed.
--   chat.lesson_report           gains the quick-report fields (lesson number,
--                                topic and next-lesson choices), who entered it,
--                                a version and a soft delete. It changes only
--                                with a chat.lesson_report_revision row written
--                                in the same transaction, which keeps the
--                                previous version.
--   report cards                 an edited report rewrites its card in place:
--                                chat.message_card.payload and the message body
--                                change only with that same revision row (and
--                                the body, as for a text edit, with a
--                                chat.message_revision row).
--   make-ups                     owed after a student apology too; a teacher may
--                                book one (created_by_kind `teacher`).
--   chat.course,                 the academy's course list, and each child's
--   chat.learner_enrollment      date of birth, course and package size,
--                                entered by Operations (Core still bills).
--
-- FAIL CLOSED. RLS on, no grant to any request role: only the server reads or
-- writes these tables.

-- ===========================================================================
-- 1. Who may correct lessons (the database floor; the API decides per request)
-- ===========================================================================

-- The super admin, the Teachers department and the Operations department
-- (manager or member) of the lesson's organization.
create or replace function chat.can_correct_lessons(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null
       and (s.role = 'super_admin'
            or exists (select 1 from chat.department d
                        where d.organization_id = p_org and d.kind in ('teachers', 'operations')
                          and (d.manager_id = s.id
                               or exists (select 1 from chat.department_member m
                                           where m.department_id = d.id and m.staff_id = s.id)))));
$$;

-- ===========================================================================
-- 2. Lessons: `voided`, the apology's timing, teachers book make-ups
-- ===========================================================================

alter table chat.lesson drop constraint lesson_outcome_check;
alter table chat.lesson add constraint lesson_outcome_check check (outcome in (
  'held', 'student_apology', 'teacher_apology', 'admin_cancelled',
  'student_no_show', 'teacher_no_show', 'rescheduled', 'suspended', 'voided'));

alter table chat.lesson drop constraint lesson_outcome_recorded_by_a_plausible_actor;
alter table chat.lesson add constraint lesson_outcome_recorded_by_a_plausible_actor
  check (outcome is null
      or (outcome in ('held', 'student_no_show') and outcome_by_kind in ('teacher', 'staff'))
      or (outcome = 'student_apology' and outcome_by_kind in ('contact', 'staff'))
      or (outcome = 'teacher_apology' and outcome_by_kind in ('teacher', 'staff'))
      or (outcome in ('admin_cancelled', 'teacher_no_show', 'rescheduled', 'suspended', 'voided')
          and outcome_by_kind = 'staff'));

alter table chat.lesson drop constraint lesson_created_by_kind_check;
alter table chat.lesson add constraint lesson_created_by_kind_check
  check (created_by_kind in ('staff', 'contact', 'teacher', 'system'));

alter table chat.lesson add column apology_timing text
  check (apology_timing in ('before_start', 'after_start'));

-- Every apology already written: an excusing ruling means it came after the start.
update chat.lesson l
   set apology_timing = case
         when exists (select 1 from chat.lesson_ruling r
                       where r.lesson_id = l.id and r.kind = 'late_apology' and r.decision = 'excused')
           then 'after_start'
         else 'before_start'
       end
 where l.outcome = 'student_apology';

alter table chat.lesson add constraint lesson_apology_has_a_timing
  check ((outcome is not distinct from 'student_apology') = (apology_timing is not null));

-- A make-up that was voided does not replace anything either.
drop index chat.lesson_one_live_makeup;
create unique index lesson_one_live_makeup on chat.lesson (makeup_for)
  where kind = 'makeup'
    and (outcome is null or outcome not in ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled', 'voided'));

-- ===========================================================================
-- 3. Corrections
-- ===========================================================================

create table chat.lesson_correction (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  lesson_id        uuid not null references chat.lesson (id),
  from_outcome     text not null,
  to_outcome       text not null check (to_outcome in (
                     'held', 'student_apology', 'teacher_apology', 'admin_cancelled',
                     'student_no_show', 'teacher_no_show', 'voided')),
  -- Only for a correction TO a student apology: when the family excused it.
  apology_timing   text check (apology_timing in ('before_start', 'after_start')),
  reason           text not null check (length(btrim(reason)) between 1 and 1000),
  corrected_by     uuid not null references chat.staff (id),
  corrected_at     timestamptz not null default now(),
  -- The transaction that wrote it: chat.guard_lesson honours a correction only
  -- inside that same transaction.
  txid             bigint not null default txid_current(),
  constraint lesson_correction_changes_something check (from_outcome <> to_outcome),
  constraint lesson_correction_apology_names_its_timing
    check ((to_outcome = 'student_apology') = (apology_timing is not null))
);

comment on table chat.lesson_correction is
  'PD-15: a corrected lesson outcome -- from, to, reason, who, when. Append-only; honoured by chat.guard_lesson only in the transaction that wrote it.';

create index lesson_correction_lesson_idx on chat.lesson_correction (lesson_id, corrected_at);

create or replace function chat.guard_lesson_correction()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a correction is never edited or deleted' using errcode = 'check_violation';
  end if;
  select * into v_lesson from chat.lesson where id = new.lesson_id for update;
  if v_lesson.organization_id is distinct from new.organization_id then
    raise exception 'a correction belongs to its lesson''s organization' using errcode = 'insufficient_privilege';
  end if;
  if v_lesson.kind = 'trial' then
    raise exception 'a trial is corrected through its own record' using errcode = 'check_violation';
  end if;
  if not chat.can_correct_lessons(new.corrected_by, new.organization_id) then
    raise exception 'lesson outcomes are corrected by the Teachers or Operations department or the super admin'
      using errcode = 'insufficient_privilege';
  end if;
  if v_lesson.outcome is null then
    raise exception 'only a recorded outcome is corrected' using errcode = 'check_violation';
  end if;
  if v_lesson.outcome in ('voided', 'rescheduled', 'suspended') then
    raise exception 'a % lesson is not corrected', v_lesson.outcome using errcode = 'check_violation';
  end if;
  if v_lesson.outcome is distinct from new.from_outcome then
    raise exception 'a correction starts from the lesson''s current outcome' using errcode = 'check_violation';
  end if;
  if new.to_outcome in ('held', 'student_no_show', 'teacher_no_show') and now() < v_lesson.starts_at then
    raise exception 'a lesson that has not started cannot be held or missed' using errcode = 'check_violation';
  end if;
  if new.to_outcome = 'student_apology' and new.apology_timing = 'after_start' and now() < v_lesson.starts_at then
    raise exception 'an apology after the start needs a lesson that has started' using errcode = 'check_violation';
  end if;
  new.corrected_at := now();
  new.txid := txid_current();
  return new;
end;
$$;

create trigger lesson_correction_is_coherent
  before insert or update or delete on chat.lesson_correction
  for each row execute function chat.guard_lesson_correction();

-- ===========================================================================
-- 4. The lesson guard: corrections, `voided`, timing, teacher make-ups
-- ===========================================================================

-- chat.guard_lesson as 20261021100000 (the trial journey's attendance
-- correction arm kept as it is), plus:
--   * a teacher may book a make-up for their own owed lesson, in the future;
--   * a family's or teacher's make-up may replace a student apology too;
--   * a written outcome may change through a correction of this transaction;
--   * a voided lesson is final;
--   * apology_timing is written here and only here.
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
      select * into v_missed from chat.lesson where id = new.makeup_for;
      if new.kind <> 'makeup' or v_missed.outcome is null
         or v_missed.outcome not in ('teacher_apology', 'teacher_no_show', 'student_apology') then
        raise exception 'only the make-up an apologised or teacher-cancelled lesson owes is booked here'
          using errcode = 'check_violation';
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
    if new.outcome is not null or new.apology_timing is not null then
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
-- 5. Reports: quick fields, versions, soft delete, revisions
-- ===========================================================================

alter table chat.lesson_report alter column covered drop not null;
alter table chat.lesson_report
  add column lesson_number   integer check (lesson_number is null or lesson_number between 1 and 9999),
  add column covered_topics  text[] not null default '{}'
                               check (cardinality(covered_topics) <= 12),
  add column next_tasks      text[] not null default '{}'
                               check (cardinality(next_tasks) <= 12),
  add column entered_by_kind text not null default 'teacher' check (entered_by_kind in ('teacher', 'staff')),
  add column entered_by      uuid,
  add column version         integer not null default 1 check (version >= 1),
  add column updated_at      timestamptz not null default now(),
  add column deleted_at      timestamptz,
  add column deleted_by      uuid references chat.staff (id),
  add column delete_reason   text check (delete_reason is null or length(btrim(delete_reason)) between 1 and 1000);

update chat.lesson_report set entered_by = teacher_id where entered_by is null;
alter table chat.lesson_report alter column entered_by set not null;

alter table chat.lesson_report add constraint lesson_report_says_what_was_covered
  check (covered is not null or cardinality(covered_topics) > 0);
alter table chat.lesson_report add constraint lesson_report_delete_is_whole
  check ((deleted_at is null) = (deleted_by is null) and (deleted_at is null) = (delete_reason is null));

create table chat.lesson_report_revision (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  lesson_id        uuid not null references chat.lesson_report (lesson_id),
  action           text not null check (action in ('edit', 'delete', 'resend', 'restore')),
  -- The report as it was before this change (version, fields, card message).
  previous         jsonb not null check (jsonb_typeof(previous) = 'object'),
  by_kind          text not null check (by_kind in ('teacher', 'staff')),
  by_id            uuid not null,
  at               timestamptz not null default now(),
  reason           text check (reason is null or length(btrim(reason)) between 1 and 1000),
  txid             bigint not null default txid_current(),
  constraint lesson_report_revision_delete_says_why check (action <> 'delete' or reason is not null)
);

comment on table chat.lesson_report_revision is
  'PD-15: each previous version of a lesson report, and who changed it, when and how. Append-only.';

create index lesson_report_revision_lesson_idx on chat.lesson_report_revision (lesson_id, at);

create or replace function chat.guard_lesson_report_revision()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a report revision is never edited or deleted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.lesson_report r where r.lesson_id = new.lesson_id and r.organization_id = new.organization_id) then
    raise exception 'a revision belongs to its report''s organization' using errcode = 'insufficient_privilege';
  end if;
  if new.by_kind = 'staff' and not chat.can_correct_lessons(new.by_id, new.organization_id) then
    raise exception 'reports are changed by their teacher or by the Teachers or Operations department'
      using errcode = 'insufficient_privilege';
  end if;
  if new.by_kind = 'teacher' then
    if new.action <> 'edit'
       or not exists (select 1 from chat.lesson_report r where r.lesson_id = new.lesson_id and r.teacher_id = new.by_id) then
      raise exception 'a teacher edits only their own report' using errcode = 'insufficient_privilege';
    end if;
  end if;
  new.at := now();
  new.txid := txid_current();
  return new;
end;
$$;

create trigger lesson_report_revision_is_coherent
  before insert or update or delete on chat.lesson_report_revision
  for each row execute function chat.guard_lesson_report_revision();

create or replace function chat.report_revised_now(p_lesson uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from chat.lesson_report_revision v
                  where v.lesson_id = p_lesson and v.txid = txid_current());
$$;

-- chat.guard_lesson_report as 20261018120000, plus: a report changes through a
-- revision written in this transaction; its identity never changes.
create or replace function chat.guard_lesson_report()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.lesson_id, new.organization_id, new.teacher_id, new.submitted_at)
       is distinct from (old.lesson_id, old.organization_id, old.teacher_id, old.submitted_at) then
      raise exception 'a lesson report''s identity never changes' using errcode = 'check_violation';
    end if;
    -- The card is posted in the same transaction, after the report row exists.
    if old.message_id is null and new.message_id is not null
       and (new.covered, new.homework, new.rating, new.note, new.lesson_number, new.covered_topics, new.next_tasks,
            new.entered_by_kind, new.entered_by, new.version, new.deleted_at)
           is not distinct from
           (old.covered, old.homework, old.rating, old.note, old.lesson_number, old.covered_topics, old.next_tasks,
            old.entered_by_kind, old.entered_by, old.version, old.deleted_at) then
      return new;
    end if;
    if not chat.report_revised_now(old.lesson_id) then
      raise exception 'a lesson report changes only through a recorded revision' using errcode = 'check_violation';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
    end if;
    return new;
  end if;
  select * into v_lesson from chat.lesson where id = new.lesson_id;
  if v_lesson.organization_id is distinct from new.organization_id then
    raise exception 'a report belongs to its lesson''s organization' using errcode = 'insufficient_privilege';
  end if;
  if v_lesson.teacher_id is distinct from new.teacher_id then
    raise exception 'a report is written by the lesson''s teacher' using errcode = 'check_violation';
  end if;
  -- A writer that predates PD-15 (the trial report) names no enterer: the teacher.
  new.entered_by := coalesce(new.entered_by, new.teacher_id);
  if new.entered_by_kind = 'teacher' and new.entered_by is distinct from new.teacher_id then
    raise exception 'a teacher enters only their own report' using errcode = 'check_violation';
  end if;
  if new.entered_by_kind = 'staff' and not chat.can_correct_lessons(new.entered_by, new.organization_id) then
    raise exception 'a report is entered by its teacher, or by staff correcting the lesson'
      using errcode = 'insufficient_privilege';
  end if;
  if new.deleted_at is not null or new.version <> 1 then
    raise exception 'a report is born live, at version 1' using errcode = 'check_violation';
  end if;
  new.submitted_at := now();
  new.updated_at := now();
  return new;
end;
$$;

-- "held requires a LIVE report" -- as 20261021100000 (a trial Sales decided
-- needs none), with a deleted report no longer counting as one.
create or replace function chat.assert_held_lesson_has_report()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from chat.lesson l where l.id = new.id and l.outcome = 'held')
     and not exists (select 1 from chat.lesson_report r where r.lesson_id = new.id and r.deleted_at is null)
     and not exists (
       select 1 from chat.lesson l join chat.trial_outcome o on o.lesson_id = l.id
        where l.id = new.id and l.kind = 'trial' and o.result in ('subscribed', 'not_subscribed')
     ) then
    raise exception 'a held lesson has a report' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

-- The report itself may be deleted only when its lesson is no longer held (the
-- service corrects the lesson in the same transaction). Checked at commit.
create or replace function chat.assert_deleted_report_lesson_not_held()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null
     and exists (select 1 from chat.lesson l where l.id = new.lesson_id and l.outcome = 'held') then
    raise exception 'a held lesson keeps a live report; correct the lesson or resend the report'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger lesson_report_deleted_lesson_not_held
  after update on chat.lesson_report
  deferrable initially deferred
  for each row execute function chat.assert_deleted_report_lesson_not_held();

-- ===========================================================================
-- 6. Cards that follow their report
-- ===========================================================================

-- chat.guard_message_card as 20261018120000, plus: a report card's payload may
-- follow its report, in the transaction that revised it.
create or replace function chat.guard_message_card()
returns trigger
language plpgsql
as $$
declare
  v_message chat.message%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.message_id, new.organization_id, new.kind, new.lesson_id)
       is not distinct from (old.message_id, old.organization_id, old.kind, old.lesson_id)
       and old.kind = 'lesson_report' and old.lesson_id is not null
       and chat.report_revised_now(old.lesson_id) then
      return new;
    end if;
    raise exception 'a card is written once' using errcode = 'check_violation';
  end if;
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

-- chat.forbid_message_rewrite as 20261020400000 (PD-14), plus one more lawful
-- rewrite: a report card whose report was revised in this transaction, with
-- the previous body kept in chat.message_revision exactly as for a text edit.
create or replace function chat.forbid_message_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     and old.deleted_for_all = false and new.deleted_for_all = false then
    if not (
      new.edited_at is not null
      and new.edited_at is distinct from old.edited_at
      and old.moderation = 'published'
      and new.moderation = 'published'
      and new.body is not null
      and (old.type = 'text'
           or (old.type = 'card' and exists (
                 select 1 from chat.message_card c
                  where c.message_id = old.id and c.kind = 'lesson_report'
                    and c.lesson_id is not null and chat.report_revised_now(c.lesson_id))))
      and exists (
        select 1 from chat.message_revision r
         where r.message_id = old.id
           and r.edited_at = new.edited_at
           and r.previous_body is not distinct from old.body
      )
    ) then
      raise exception 'chat.message.body is immutable once sent'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if new.author_id is distinct from old.author_id
     or new.author_type is distinct from old.author_type
     or new.conversation_id is distinct from old.conversation_id
     or new.seq is distinct from old.seq then
    raise exception 'chat.message identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

insert into chat.message_card_kind (kind) values ('lesson_corrected') on conflict do nothing;

-- ===========================================================================
-- 7. Statistics: voided lessons count nowhere; the apology's timing
-- ===========================================================================

-- As 20261019100000, without voided lessons.
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
     and l.outcome is distinct from 'voided'
   group by 1, 2, 3, 4;
$$;

-- As 20261019100000, counting only the live report of a lesson that is held.
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
    join chat.lesson_report r on r.lesson_id = l.id and r.deleted_at is null
   where l.organization_id = p_org
     and l.outcome = 'held'
     and l.starts_at >= p_from and l.starts_at < p_to
   group by l.teacher_id;
$$;

-- Student apologies by when the family excused the learner.
create or replace function chat.teacher_apology_timing_stats(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (teacher_id uuid, kind text, before_start integer, after_start integer)
language sql
stable
as $$
  select l.teacher_id, l.kind,
         count(*) filter (where l.apology_timing = 'before_start')::integer,
         count(*) filter (where l.apology_timing = 'after_start')::integer
    from chat.lesson l
   where l.organization_id = p_org
     and l.outcome = 'student_apology'
     and l.starts_at >= p_from and l.starts_at < p_to
   group by 1, 2;
$$;

-- ===========================================================================
-- 8. Courses and each child's enrolment details
-- ===========================================================================

create table chat.course (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  name             text not null check (length(btrim(name)) between 1 and 80),
  is_active        boolean not null default true,
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table chat.course is
  'PD-15: the academy''s courses, as Operations names them. Retired, never deleted, so a child''s history keeps its name.';

create unique index course_name_is_unique on chat.course (organization_id, lower(btrim(name)));

create trigger course_updated_at before update on chat.course
  for each row execute function chat.set_updated_at();

create or replace function chat.forbid_course_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a course is never deleted; retire it' using errcode = 'check_violation';
end;
$$;

create trigger course_is_kept before delete on chat.course
  for each row execute function chat.forbid_course_delete();

create table chat.learner_enrollment (
  learner_id       uuid primary key references chat.learner (id),
  organization_id  uuid not null references chat.organization (id),
  birth_date       date check (birth_date is null or birth_date >= date '1920-01-01'),
  course_id        uuid references chat.course (id),
  -- The package bought for this child: the total number of lessons it includes.
  package_lessons  integer check (package_lessons is null or package_lessons between 1 and 1000),
  updated_by       uuid not null references chat.staff (id),
  updated_at       timestamptz not null default now()
);

comment on table chat.learner_enrollment is
  'PD-15: a child''s date of birth, course and package size, entered by Operations. Current state; every change is in chat.audit_log. Core still bills.';

create or replace function chat.guard_learner_enrollment()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'enrolment details are cleared, never deleted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.learner l where l.id = new.learner_id and l.organization_id = new.organization_id) then
    raise exception 'enrolment details belong to the child''s organization' using errcode = 'insufficient_privilege';
  end if;
  if new.course_id is not null
     and not exists (select 1 from chat.course c where c.id = new.course_id and c.organization_id = new.organization_id) then
    raise exception 'a course of the child''s organization' using errcode = 'insufficient_privilege';
  end if;
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'a date of birth is in the past' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger learner_enrollment_is_coherent
  before insert or update or delete on chat.learner_enrollment
  for each row execute function chat.guard_learner_enrollment();

-- ===========================================================================
-- 9. Request roles: none
-- ===========================================================================

alter table chat.lesson_correction       enable row level security;
alter table chat.lesson_report_revision  enable row level security;
alter table chat.course                  enable row level security;
alter table chat.learner_enrollment      enable row level security;

revoke all on chat.lesson_correction, chat.lesson_report_revision, chat.course, chat.learner_enrollment
  from public, anon, authenticated, chat_app;

revoke all on function chat.can_correct_lessons(uuid, uuid) from public;
revoke all on function chat.guard_lesson_correction() from public;
revoke all on function chat.guard_lesson_report_revision() from public;
revoke all on function chat.report_revised_now(uuid) from public;
revoke all on function chat.assert_deleted_report_lesson_not_held() from public;
revoke all on function chat.teacher_apology_timing_stats(uuid, timestamptz, timestamptz) from public;
revoke all on function chat.forbid_course_delete() from public;
revoke all on function chat.guard_learner_enrollment() from public;
