-- =============================================================================
-- PD-52 PR-5 · the Sales basis on the teacher-records pages
-- (docs/product/pd052-teacher-records-pages-plan.md §5.4, §11 b -- owner: yes, narrowly)
--
-- Sales sees and records rows about the trials it reads and the families it
-- owns: trial lateness, complaints (and their follow-ups), testimonials, and
-- grants without an amount. Never a decision, a step, a deduction, a balance,
-- a regular lesson's discipline, or a row about the teacher alone.
--
--   chat.sales_basis(staff)              'manager' | 'member' | null, the role re-checked
--   chat.sales_family_ids(staff)         families it owns (chat.family_sales_owner, PD-42);
--                                        the Sales manager: those its department owns
--   chat.sales_learner_ids(staff)        their children
--   chat.sales_prospect_ids(staff, at)   trial families with a trial in the PD-26 window
--                                        (Sales reads every trial, PD-11 T4)
--   chat.sales_teacher_ids(staff, at)    those trials' teachers and the children's current teachers
--   chat.may_record_teacher_row(staff, teacher, learner, prospect, org, at)
--                                        the write backstop: the PD-26 rule, or Sales on a
--                                        child or trial in reach that this teacher teaches or taught
--
-- chat.may_supervise_teacher is NOT widened: Sales can never decide, take or
-- uphold. Only these insert guards read the new rule:
--   chat.guard_teacher_supervision_entry        complaint, follow-up, testimonial, grant,
--                                               a testimonial's correction
--   chat.guard_teacher_supervision_entry_about  the child / family / trial links
--   chat.guard_teacher_violation                lateness on a trial
-- =============================================================================

create function chat.sales_basis(p_staff uuid)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
    when s.role = 'manager' and chat.sales_department_role(s.id) = 'manager' then 'manager'
    when s.role in ('admin', 'coverage') and chat.sales_department_role(s.id) = 'member' then 'member'
  end
    from chat.staff s
   where s.id = p_staff and s.is_active and s.left_at is null;
$$;

create function chat.sales_family_ids(p_staff uuid)
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select o.family_id
    from chat.family_sales_owner o
    join chat.staff s on s.id = p_staff and s.organization_id = o.organization_id
   where (chat.sales_basis(p_staff) = 'member' and o.staff_id = p_staff)
      or (chat.sales_basis(p_staff) = 'manager' and chat.sales_department_role(o.staff_id) is not null);
$$;

create function chat.sales_learner_ids(p_staff uuid)
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select l.id from chat.learner l where l.family_id in (select chat.sales_family_ids(p_staff));
$$;

create function chat.sales_prospect_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select distinct le.prospect_id
    from chat.lesson le
    join chat.staff s on s.id = p_staff and s.organization_id = le.organization_id
   where chat.sales_basis(p_staff) is not null
     and le.prospect_id is not null
     and le.starts_at >= p_at - chat.operations_lesson_window();
$$;

create function chat.sales_teacher_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select le.teacher_id
    from chat.lesson le
   where le.prospect_id in (select chat.sales_prospect_ids(p_staff, p_at))
     and le.starts_at >= p_at - chat.operations_lesson_window()
  union
  select l.teacher_id
    from chat.learner l
   where l.id in (select chat.sales_learner_ids(p_staff)) and l.teacher_id is not null;
$$;

create function chat.may_record_teacher_row(p_staff uuid, p_teacher uuid, p_learner uuid, p_prospect uuid, p_org uuid, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select p_staff is not null and (
    (p_prospect is null and chat.may_supervise_learner_row(p_staff, p_teacher, p_learner, p_org, p_at))
    or (p_learner is null and p_prospect is null and chat.may_supervise_teacher(p_staff, p_teacher, p_org, p_at))
    or (chat.sales_basis(p_staff) is not null
        and exists (select 1 from chat.staff s where s.id = p_staff and s.organization_id = p_org)
        and ((p_learner is not null and p_prospect is null
              and p_learner in (select chat.sales_learner_ids(p_staff))
              and chat.teaches_or_taught(p_teacher, p_learner, p_at))
          or (p_learner is null and p_prospect is not null
              and p_prospect in (select chat.sales_prospect_ids(p_staff, p_at))
              and exists (select 1 from chat.lesson le
                           where le.prospect_id = p_prospect and le.teacher_id = p_teacher
                             and le.starts_at >= p_at - chat.operations_lesson_window()
                             and le.starts_at <= p_at)))));
$$;

comment on function chat.may_record_teacher_row(uuid, uuid, uuid, uuid, uuid, timestamptz) is
  'PD-52: may this staff member record a row about this teacher and child (or trial family)? The PD-26 rule, or Sales on a child of a family it owns or a trial it reads.';

-- ---------------------------------------------------------------------------
-- The Sales bundles: both pages' view and record keys, never decide
-- ---------------------------------------------------------------------------
select set_config('chat.pd040_catalogue_change', 'on', true);
-- BEGIN GENERATED pd052sales catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'sales', 'teacher_attendance.record'),
  ('manager', 'sales', 'teacher_attendance.view'),
  ('manager', 'sales', 'teacher_grants.record'),
  ('manager', 'sales', 'teacher_grants.view'),
  ('supervisor', 'sales', 'teacher_attendance.record'),
  ('supervisor', 'sales', 'teacher_attendance.view'),
  ('supervisor', 'sales', 'teacher_grants.record'),
  ('supervisor', 'sales', 'teacher_grants.view');
-- END GENERATED pd052sales catalogue rows
select set_config('chat.pd040_catalogue_change', 'off', true);

-- ---------------------------------------------------------------------------
-- The guards (each the latest definition, with the Sales branch added)
-- ---------------------------------------------------------------------------

-- 20261027160000's supervision-entry guard.
create or replace function chat.guard_teacher_supervision_entry()
returns trigger
language plpgsql
as $$
declare
  v_target chat.teacher_supervision_entry%rowtype;
begin
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id) then
    raise exception 'a supervision entry is written by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  if new.parent_feedback_id is not null then
    -- PD-32: the app writes the complaint a parent filed, about that feedback's teacher.
    if new.kind <> 'complaint' or new.handled_by is not null
       or not exists (select 1 from chat.parent_feedback f
                       where f.id = new.parent_feedback_id and f.category = 'complaint'
                         and f.teacher_id = new.teacher_id and f.organization_id = new.organization_id
                         and f.body = new.body) then
      raise exception 'an app complaint is the parent''s own complaint about that teacher'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.created_by is null then
    raise exception 'a supervision entry is written by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  if chat.may_supervise_teacher(new.created_by, new.teacher_id, new.organization_id) then
    return new;
  end if;
  -- PD-52: Sales writes a complaint, a follow-up, a testimonial or a grant, and
  -- corrects a testimonial -- each about a child of a family it owns or a
  -- trial it reads (chat.may_record_teacher_row). Never a resolution, a
  -- correction of a complaint, or anything about the teacher alone.
  if chat.sales_basis(new.created_by) is not null and new.kind in ('complaint', 'complaint_followup', 'testimonial', 'bonus', 'entry_void') then
    if new.refers_to is not null then
      -- Locked, as the follow-up guard locks it (20261031180000): a void, a
      -- follow-up and a resolution of one entry serialize (review of #383).
      select * into v_target from chat.teacher_supervision_entry where id = new.refers_to for update;
      if v_target.id is not null and (new.kind <> 'entry_void' or v_target.kind = 'testimonial')
         and (v_target.learner_id is not null or v_target.trial_prospect_id is not null)
         -- A testimonial is corrected only by the department that recorded it,
         -- the Operations Manager or the super admin -- Sales included (owner
         -- decision on #374; the follow-up guard checks every author too).
         and (new.kind <> 'entry_void' or chat.may_void_testimonial(new.created_by, v_target.created_by, new.organization_id))
         and chat.may_record_teacher_row(new.created_by, new.teacher_id, v_target.learner_id, v_target.trial_prospect_id, new.organization_id) then
        return new;
      end if;
    elsif new.kind <> 'entry_void' and (new.learner_id is not null or new.trial_prospect_id is not null)
          and chat.may_record_teacher_row(new.created_by, new.teacher_id, new.learner_id, new.trial_prospect_id, new.organization_id) then
      return new;
    end if;
  end if;
  raise exception 'a supervision entry is written by the teacher''s own Teachers department'
    using errcode = 'insufficient_privilege';
end;
$$;

-- 20261031180000's link guard (with its review-of-#374 bound).
create or replace function chat.guard_teacher_supervision_entry_about()
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
       and not chat.may_record_teacher_row(new.created_by, new.teacher_id, new.learner_id, null, new.organization_id) then
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
                          and chat.may_record_teacher_row(new.created_by, new.teacher_id, l.id, null, new.organization_id)) then
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
    -- PD-52 PR-5: the Teachers department, or Sales for a trial it reads.
    if new.created_by is not null
       and not chat.is_lesson_manager(new.created_by, new.organization_id)
       and not chat.may_record_teacher_row(new.created_by, new.teacher_id, null, new.trial_prospect_id, new.organization_id) then
      raise exception 'a record about a trial is written by the Teachers department or Sales' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- 20261031180000's violation guard (void check and lock, review of #374): lateness on a trial.
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
      -- PD-52: Sales records lateness on a trial it reads (chat.may_record_teacher_row).
      if not (chat.may_supervise_learner_row(new.recorded_by, new.teacher_id, v_lesson.learner_id, new.organization_id)
              or (v_lesson.learner_id is null and v_lesson.prospect_id is not null
                  and chat.may_record_teacher_row(new.recorded_by, new.teacher_id, null, v_lesson.prospect_id, new.organization_id))) then
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

revoke all on function chat.sales_basis(uuid) from public;
revoke all on function chat.sales_family_ids(uuid) from public;
revoke all on function chat.sales_learner_ids(uuid) from public;
revoke all on function chat.sales_prospect_ids(uuid, timestamptz) from public;
revoke all on function chat.sales_teacher_ids(uuid, timestamptz) from public;
revoke all on function chat.may_record_teacher_row(uuid, uuid, uuid, uuid, uuid, timestamptz) from public;
