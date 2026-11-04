-- =============================================================================
-- PD-52 PR-2 · testimonials, corrections, and who a record is about
-- (docs/product/pd052-teacher-records-pages-plan.md §5.3, §8)
--
-- chat.teacher_supervision_entry gains:
--   kind 'testimonial'       staff-recorded positive feedback about a teacher;
--                            testimonial_source says how it reached the academy
--   kind 'entry_void'        the correction of one complaint or testimonial
--                            entered by mistake: refers_to it, the reason is
--                            the body, once per target. The target is hidden by
--                            default and never deleted (the table stays
--                            append-only).
--   learner_id, family_id,   the student and family (or a trial family not yet
--   trial_prospect_id        enrolled) a complaint, testimonial or grant is
--                            about. Optional; existing rows keep nulls.
--
-- The parent's praise is NOT copied here: the Grants & Testimonials page reads
-- chat.parent_feedback (category 'praise') in place, as complaints already do.
--
-- Guards (before insert, in the database so the API cannot be bypassed):
--   - the learner belongs to the family; both, and the prospect, are the
--     entry's organization; at most one of family / prospect;
--   - the teacher is or was that learner's (or family's, or prospect's)
--     teacher: the current teacher, or a lesson in the PD-26 window
--     (chat.operations_lesson_window), as chat.operations_teacher_ids counts;
--   - the author may write about that child: chat.may_supervise_learner_row
--     for a learner, the same rule over the family's children for a family;
--   - a void names a complaint or testimonial of the same teacher, never a
--     parent's own complaint (that is answered, PD-32), never one already
--     resolved or upheld (the ladder has its own "excused", PD-26).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and shapes
-- ---------------------------------------------------------------------------
alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_kind_check;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_kind_check
  check (kind in ('bonus', 'complaint', 'complaint_resolution', 'complaint_followup', 'monthly_comment', 'note', 'testimonial', 'entry_void'));

alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_followup_shape;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_followup_shape
  check ((kind in ('complaint_resolution', 'complaint_followup', 'entry_void')) = (refers_to is not null)
     and (source_message_id is null or (kind = 'complaint' and conversation_id is not null)));

alter table chat.teacher_supervision_entry
  add column testimonial_source text check (testimonial_source in ('parent_message', 'parent_call', 'staff_observation', 'other')),
  add column learner_id uuid references chat.learner (id),
  add column family_id uuid references chat.family (id),
  add column trial_prospect_id uuid references chat.trial_prospect (id);

alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_testimonial_source
  check ((kind = 'testimonial') = (testimonial_source is not null));

alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_about_shape
  check ((learner_id is null and family_id is null and trial_prospect_id is null)
      or (kind in ('complaint', 'testimonial', 'bonus')
          and (learner_id is null or family_id is not null)
          and (family_id is null or trial_prospect_id is null)));

-- A complaint or testimonial is voided once.
create unique index teacher_supervision_entry_one_void
  on chat.teacher_supervision_entry (refers_to) where kind = 'entry_void';

create index teacher_supervision_entry_by_learner on chat.teacher_supervision_entry (learner_id) where learner_id is not null;
create index teacher_supervision_entry_by_family on chat.teacher_supervision_entry (family_id) where family_id is not null;

comment on column chat.teacher_supervision_entry.learner_id is
  'PD-52: the student a complaint, testimonial or grant is about (optional).';
comment on column chat.teacher_supervision_entry.family_id is
  'PD-52: the family (the parent) it is about; required with learner_id.';
comment on column chat.teacher_supervision_entry.trial_prospect_id is
  'PD-52: a trial family not yet enrolled (Sales); never with family_id.';

-- ---------------------------------------------------------------------------
-- 2. Who a record is about
-- ---------------------------------------------------------------------------

-- Is (or was, within the PD-26 window) this teacher the teacher of this learner?
create function chat.teaches_or_taught(p_teacher uuid, p_learner uuid, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  -- A lesson only booked, not yet begun, is not "taught" (review of #374).
  select exists (select 1 from chat.learner l where l.id = p_learner and l.teacher_id = p_teacher)
      or exists (select 1 from chat.lesson le
                  where le.learner_id = p_learner and le.teacher_id = p_teacher
                    and le.starts_at >= p_at - chat.operations_lesson_window()
                    and le.starts_at <= p_at
                    and (le.outcome is null or le.outcome not in ('admin_cancelled', 'rescheduled', 'student_apology', 'suspended', 'voided')));
$$;

comment on function chat.teaches_or_taught(uuid, uuid, timestamptz) is
  'PD-52: the learner''s current teacher, or the teacher of one of their lessons in the 30 days up to now (begun, not called off).';

create function chat.guard_teacher_supervision_entry_about()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_family uuid;
  v_org    uuid;
begin
  if new.learner_id is null and new.family_id is null and new.trial_prospect_id is null then
    return new;
  end if;

  if new.learner_id is not null then
    select l.family_id, l.organization_id into v_family, v_org from chat.learner l where l.id = new.learner_id;
    if v_family is distinct from new.family_id or v_org is distinct from new.organization_id then
      raise exception 'a record''s student belongs to its family and organization' using errcode = 'check_violation';
    end if;
    if not chat.teaches_or_taught(new.teacher_id, new.learner_id) then
      raise exception 'a record is about a student this teacher teaches or taught' using errcode = 'check_violation';
    end if;
    if new.created_by is not null
       and not chat.may_supervise_learner_row(new.created_by, new.teacher_id, new.learner_id, new.organization_id) then
      raise exception 'a record about a student is written by that student''s supervisors' using errcode = 'insufficient_privilege';
    end if;
  elsif new.family_id is not null then
    if not exists (select 1 from chat.family f where f.id = new.family_id and f.organization_id = new.organization_id) then
      raise exception 'a record''s family belongs to its organization' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.learner l
                    where l.family_id = new.family_id and chat.teaches_or_taught(new.teacher_id, l.id)) then
      raise exception 'a record is about a family whose child this teacher teaches or taught' using errcode = 'check_violation';
    end if;
    if new.created_by is not null
       and not exists (select 1 from chat.learner l
                        where l.family_id = new.family_id
                          and chat.may_supervise_learner_row(new.created_by, new.teacher_id, l.id, new.organization_id)) then
      raise exception 'a record about a family is written by that family''s supervisors' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.trial_prospect_id is not null then
    if not exists (select 1 from chat.trial_prospect p where p.id = new.trial_prospect_id and p.organization_id = new.organization_id) then
      raise exception 'a record''s trial family belongs to its organization' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.lesson le
                    where le.prospect_id = new.trial_prospect_id and le.teacher_id = new.teacher_id
                      and le.starts_at >= now() - chat.operations_lesson_window()
                      and le.starts_at <= now()) then
      raise exception 'a record is about a trial this teacher taught' using errcode = 'check_violation';
    end if;
    -- Who may write about a trial family is PR-5's (Sales); until then only the
    -- Teachers department, whose guard (chat.may_supervise_teacher) already ran.
    if new.created_by is not null and not chat.is_lesson_manager(new.created_by, new.organization_id) then
      raise exception 'a record about a trial is written by the Teachers department' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger teacher_supervision_entry_about_is_coherent
  before insert on chat.teacher_supervision_entry
  for each row execute function chat.guard_teacher_supervision_entry_about();

-- The department a staff member runs or belongs to (one at most, PD-8).
create function chat.staff_department_kind(p_staff uuid)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select d.kind from chat.department d where d.manager_id = p_staff limit 1),
    (select d.kind from chat.department_member m join chat.department d on d.id = m.department_id where m.staff_id = p_staff limit 1));
$$;

-- Owner decision on #374: who may correct a staff testimonial.
create function chat.may_void_testimonial(p_staff uuid, p_author uuid, p_org uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select p_staff is not null and (
    exists (select 1 from chat.staff s where s.id = p_staff and s.role = 'super_admin' and s.is_active and s.organization_id = p_org)
    or chat.is_operations_manager(p_staff, p_org)
    or (chat.staff_department_kind(p_staff) is not null
        and chat.staff_department_kind(p_staff) = chat.staff_department_kind(p_author)));
$$;

-- ---------------------------------------------------------------------------
-- 3. Follow-ups, resolutions and voids (PD-10's guard, 20261018170000)
-- ---------------------------------------------------------------------------
create or replace function chat.guard_teacher_supervision_followup()
returns trigger
language plpgsql
as $$
declare
  v_target   chat.teacher_supervision_entry%rowtype;
  v_conv_org uuid;
begin
  if new.refers_to is not null then
    -- The target row is locked, so a void, a resolution and an uphold of one
    -- complaint are serialized: whichever commits first, the others see it
    -- (review of #374).
    select * into v_target from chat.teacher_supervision_entry where id = new.refers_to for update;
    if v_target.id is null or v_target.teacher_id <> new.teacher_id
       or (new.kind <> 'entry_void' and v_target.kind <> 'complaint')
       or (new.kind = 'entry_void' and v_target.kind not in ('complaint', 'testimonial')) then
      raise exception 'a follow-up, resolution or void refers to a complaint (or, for a void, a testimonial) about the same teacher'
        using errcode = 'foreign_key_violation';
    end if;
    if new.kind = 'entry_void' then
      if v_target.parent_feedback_id is not null then
        raise exception 'a parent''s own complaint is answered, never voided' using errcode = 'check_violation';
      end if;
      if exists (select 1 from chat.teacher_supervision_entry r where r.refers_to = v_target.id and r.kind = 'complaint_resolution')
         or exists (select 1 from chat.teacher_violation v where v.complaint_entry_id = v_target.id) then
        raise exception 'a complaint already resolved or upheld is not voided' using errcode = 'check_violation';
      end if;
      -- Owner decision on #374: a testimonial is corrected by the department
      -- that recorded it, or by the Operations Manager or the super admin.
      if v_target.kind = 'testimonial' and not chat.may_void_testimonial(new.created_by, v_target.created_by, new.organization_id) then
        raise exception 'a testimonial is corrected by the department that recorded it, the Operations Manager or the super admin'
          using errcode = 'insufficient_privilege';
      end if;
    elsif exists (select 1 from chat.teacher_supervision_entry x where x.refers_to = v_target.id and x.kind = 'entry_void') then
      raise exception 'a voided complaint takes no follow-up' using errcode = 'check_violation';
    end if;
  end if;
  if new.conversation_id is not null then
    select organization_id into v_conv_org from chat.conversation where id = new.conversation_id;
    if v_conv_org is distinct from new.organization_id then
      raise exception 'a supervision entry''s conversation belongs to its organization'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.source_message_id is not null and not exists (
    select 1 from chat.message m where m.id = new.source_message_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'a complaint''s source message belongs to its conversation'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- PD-26's violation guard (20261027160000), with PD-52's void check and lock.
create or replace function chat.guard_teacher_violation()
returns trigger
language plpgsql
as $$
declare
  v_lesson    chat.lesson%rowtype;
  v_complaint chat.teacher_supervision_entry%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'a violation is never deleted; excuse it' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.kind in ('absence', 'complaint') then
      if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id) then
        raise exception 'a violation is its teacher''s, in their organization' using errcode = 'insufficient_privilege';
      end if;
      if not chat.may_supervise_teacher(new.recorded_by, new.teacher_id, new.organization_id) then
        raise exception 'an absence or an upheld complaint is recorded by the Teachers department or the teacher''s Operations supervisor'
          using errcode = 'insufficient_privilege';
      end if;
      if new.kind = 'complaint' then
        -- Locked, as a void or a resolution of it locks it (PD-52, review of #374).
        select * into v_complaint from chat.teacher_supervision_entry where id = new.complaint_entry_id for update;
        if v_complaint.id is null or v_complaint.kind <> 'complaint' or v_complaint.teacher_id <> new.teacher_id then
          raise exception 'an upheld complaint is a complaint about the same teacher' using errcode = 'foreign_key_violation';
        end if;
        -- PD-52: a complaint entered by mistake is never upheld, nor counted on the ladder.
        if exists (select 1 from chat.teacher_supervision_entry x where x.refers_to = v_complaint.id and x.kind = 'entry_void') then
          raise exception 'a voided complaint is not upheld' using errcode = 'check_violation';
        end if;
        -- It counts in the month the complaint was made.
        new.occurred_at := v_complaint.created_at;
      elsif new.occurred_at > now() then
        raise exception 'an absence is recorded once it has happened' using errcode = 'check_violation';
      end if;
      if new.decision is not null then
        raise exception 'a violation is recorded undecided' using errcode = 'check_violation';
      end if;
      new.month := chat.academy_month(new.occurred_at);
      new.recorded_at := now();
      return new;
    end if;

    select * into v_lesson from chat.lesson where id = new.lesson_id;
    if v_lesson.organization_id is distinct from new.organization_id or v_lesson.teacher_id is distinct from new.teacher_id then
      raise exception 'a violation is the lesson''s own teacher''s, in its organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.kind = 'late' then
      if v_lesson.outcome is distinct from 'held' then
        raise exception 'lateness is recorded on a lesson that was held' using errcode = 'check_violation';
      end if;
      if not chat.may_supervise_learner_row(new.recorded_by, new.teacher_id, v_lesson.learner_id, new.organization_id) then
        raise exception 'lateness is recorded by the Teachers department or the Operations supervisor of the lesson''s child' using errcode = 'insufficient_privilege';
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
      new.late_minutes, new.recorded_by, new.recorded_at, new.note, new.complaint_entry_id)
     is distinct from
     (old.id, old.organization_id, old.teacher_id, old.lesson_id, old.kind, old.occurred_at, old.month,
      old.late_minutes, old.recorded_by, old.recorded_at, old.note, old.complaint_entry_id) then
    raise exception 'only the decision on a violation may be written' using errcode = 'check_violation';
  end if;
  if new.decision is not null then
    if not chat.may_supervise_teacher(new.decided_by, new.teacher_id, new.organization_id) then
      raise exception 'a violation is decided by the teacher''s own Teachers department or Operations supervisor'
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

-- A voided complaint's PD-47 follow-up task is settled, as a resolution settles it.
create function chat.work_task_from_supervision_void()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if exists (select 1 from chat.teacher_supervision_entry e where e.id = new.refers_to and e.kind = 'complaint') then
    begin
      perform chat.work_task_settle(new.organization_id, 'complaint:' || new.refers_to, new.created_by);
    exception when others then
      perform chat.work_task_note_issue(new.organization_id, 'complaint:' || new.refers_to, sqlerrm);
    end;
  end if;
  return null;
end;
$$;

create trigger supervision_void_settles_its_complaint after insert on chat.teacher_supervision_entry
  for each row when (new.kind = 'entry_void' and new.refers_to is not null)
  execute function chat.work_task_from_supervision_void();

revoke all on function chat.guard_teacher_supervision_entry_about() from public;
revoke all on function chat.teaches_or_taught(uuid, uuid, timestamptz) from public;
revoke all on function chat.staff_department_kind(uuid) from public;
revoke all on function chat.may_void_testimonial(uuid, uuid, uuid) from public;
revoke all on function chat.work_task_from_supervision_void() from public;
