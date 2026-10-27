-- PD-26 amendment (owner 2026-10-27): Operations supervisors use the Teacher
-- Supervision page for the teachers of their families.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-26 (amendment
-- 2026-10-27, Operations access); docs/admin/pd026-teacher-supervision.md.
--
-- WHAT IS NEW
--
--   chat.operations_teacher_ids(staff, at)
--       The teachers an Operations supervisor works on: the current teacher of,
--       and every teacher of a lesson of, each learner whose PD-8 supervisor is
--       one of chat.staff_principals(staff, at) -- themself, a supervisor they
--       cover as an ACTIVE backup (PD-33's cover is that activation), and every
--       member of a department they manage. Only for a live member (admin |
--       coverage) or the manager (role manager) of an Operations department;
--       anyone else has none.
--   chat.may_supervise_teacher(staff, teacher, org, at)
--       chat.is_lesson_manager (the Teachers department, as before) OR the
--       teacher is in the staff member's Operations set.
--
-- WHAT CHANGES
--
--   The PD-12/PD-26 guards that said "the Teachers department" now say "the
--   Teachers department, or the teacher's Operations supervisor": a violation
--   recorded or decided, a suspension, a supervision entry written, a
--   complaint's handler (set at creation or by PD-32's take). Nothing else.
--   The server narrows further (PD-35's strict scope for the Teachers side) and
--   answers an out-of-scope teacher as not found; these guards are the
--   backstop, and they never widen the Teachers department.
--
-- Money is untouched: payroll tables, deduction defaults and reward amounts
-- keep PD-18's super-admin-only rules.

-- ===========================================================================
-- 1. The Operations basis
-- ===========================================================================

create or replace function chat.operations_teacher_ids(p_staff uuid, p_at timestamptz default now())
returns setof uuid
language sql
stable
as $$
  with ops as (
    select s.id, s.organization_id
      from chat.staff s
     where s.id = p_staff and s.is_active and s.left_at is null
       and ((s.role = 'manager' and exists (
               select 1 from chat.department d
                where d.kind = 'operations' and d.manager_id = s.id and d.organization_id = s.organization_id))
         or (s.role in ('admin', 'coverage') and exists (
               select 1 from chat.department_member m
                 join chat.department d on d.id = m.department_id
                where m.staff_id = s.id and d.kind = 'operations')))
  ),
  learners as (
    select ls.learner_id
      from chat.learner_supervision ls
      join ops on ops.organization_id = ls.organization_id
     where ls.supervisor_id in (select chat.staff_principals(p_staff, p_at))
  )
  select l.teacher_id from chat.learner l
   where l.id in (select learner_id from learners) and l.teacher_id is not null
  union
  select le.teacher_id from chat.lesson le
   where le.learner_id in (select learner_id from learners);
$$;

comment on function chat.operations_teacher_ids(uuid, timestamptz) is
  'PD-26 amendment: the teachers an Operations supervisor works on (teachers of the learners they supervise, through chat.staff_principals).';

create or replace function chat.may_supervise_teacher(p_staff uuid, p_teacher uuid, p_org uuid, p_at timestamptz default now())
returns boolean
language sql
stable
as $$
  select p_staff is not null and (
    chat.is_lesson_manager(p_staff, p_org)
    or exists (select 1 from chat.operations_teacher_ids(p_staff, p_at) t where t = p_teacher));
$$;

comment on function chat.may_supervise_teacher(uuid, uuid, uuid, timestamptz) is
  'PD-26: the Teachers department (any teacher of the organization) or the teacher''s Operations supervisor.';

-- ===========================================================================
-- 2. The guards: "the Teachers department" -> "... or the teacher's Operations supervisor"
-- ===========================================================================

-- PD-26's violation guard (20261022150000), recorded_by / decided_by only.
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
        select * into v_complaint from chat.teacher_supervision_entry where id = new.complaint_entry_id;
        if v_complaint.id is null or v_complaint.kind <> 'complaint' or v_complaint.teacher_id <> new.teacher_id then
          raise exception 'an upheld complaint is a complaint about the same teacher' using errcode = 'foreign_key_violation';
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
      if not chat.may_supervise_teacher(new.recorded_by, new.teacher_id, new.organization_id) then
        raise exception 'lateness is recorded by the Teachers department or the teacher''s Operations supervisor' using errcode = 'insufficient_privilege';
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

-- PD-12 S2's suspension guard (20261019140000), created_by only.
create or replace function chat.guard_teacher_suspension()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a suspension is never edited or deleted' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id)
     or not chat.may_supervise_teacher(new.created_by, new.teacher_id, new.organization_id) then
    raise exception 'a suspension is decided by the teacher''s own Teachers department or Operations supervisor'
      using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- PD-32's supervision-entry guard (20261026120000), created_by only.
create or replace function chat.guard_teacher_supervision_entry()
returns trigger
language plpgsql
as $$
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
  if new.created_by is null or not chat.may_supervise_teacher(new.created_by, new.teacher_id, new.organization_id) then
    raise exception 'a supervision entry is written by the teacher''s own Teachers department'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- PD-32's take of an app complaint (20261026120000), handled_by only.
create or replace function chat.guard_teacher_supervision_entry_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.parent_feedback_id is not null and old.handled_by is null and new.handled_by is not null
     and (to_jsonb(new) - 'handled_by') = (to_jsonb(old) - 'handled_by') then
    if not chat.may_supervise_teacher(new.handled_by, new.teacher_id, new.organization_id) then
      raise exception 'a complaint is handled by the Teachers department' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = 'check_violation';
end;
$$;

-- PD-26's complaint handler (20261022150000).
create or replace function chat.guard_complaint_handler()
returns trigger
language plpgsql
as $$
begin
  if new.handled_by is not null and not chat.may_supervise_teacher(new.handled_by, new.teacher_id, new.organization_id) then
    raise exception 'a complaint is handled by the Teachers department' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function chat.operations_teacher_ids(uuid, timestamptz) from public;
revoke all on function chat.may_supervise_teacher(uuid, uuid, uuid, timestamptz) from public;
