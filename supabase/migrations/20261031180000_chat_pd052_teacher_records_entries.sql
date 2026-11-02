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
as $$
  select exists (select 1 from chat.learner l where l.id = p_learner and l.teacher_id = p_teacher)
      or exists (select 1 from chat.lesson le
                  where le.learner_id = p_learner and le.teacher_id = p_teacher
                    and le.starts_at >= p_at - chat.operations_lesson_window()
                    and (le.outcome is null or le.outcome not in ('admin_cancelled', 'rescheduled', 'student_apology', 'suspended', 'voided')));
$$;

comment on function chat.teaches_or_taught(uuid, uuid, timestamptz) is
  'PD-52: the learner''s current teacher, or the teacher of one of their lessons in the PD-26 window (not called off).';

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
                      and le.starts_at >= now() - chat.operations_lesson_window()) then
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
    select * into v_target from chat.teacher_supervision_entry where id = new.refers_to;
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
revoke all on function chat.work_task_from_supervision_void() from public;
