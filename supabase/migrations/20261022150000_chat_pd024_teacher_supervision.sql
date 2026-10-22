-- PD-24 (closed 2026-10-22) -- the Teacher Supervision page: leave, absences,
-- lateness, rewards and complaints in one place, each one traceable on the
-- Teacher File and, for money, in payroll.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-24, and
-- docs/admin/pd024-teacher-supervision.md.
--
-- Most of the page already existed (PD-10 complaints, PD-12 leave and the
-- discipline ladder, PD-18 payroll). This migration adds only what was missing:
--
--   chat.teacher_violation      two incidents that are not a lesson's:
--                                 absence    recorded by the Teachers department
--                                            when there is no lesson to close
--                                 complaint  an UPHELD complaint, which joins the
--                                            same monthly ladder (owner, 2026-10-22)
--   chat.teacher_supervision_entry
--                               a complaint's source (management | parent) and
--                               the supervisor handling it; follow-up notes on a
--                               complaint (kind complaint_followup)
--   chat.teacher_pay_default    the default amount of a first and second
--                               deduction, per currency (super admin). Deciding a
--                               deduction prices it at once from these, in the
--                               teacher's pay currency, so it reaches payroll with
--                               no second step. The super admin corrects a single
--                               case in Payroll, as before (a replacing row).
--   chat.teacher_away(teacher, day)
--                               whether a teacher is away on a day (leave,
--                               suspension or another day off) and until when.
--                               "On leave" is computed, never stored.
--
-- FAIL CLOSED, as PD-12 and PD-18: RLS on, no grant to any request role.

-- ===========================================================================
-- 1. Incidents that are not a lesson's
-- ===========================================================================

alter table chat.teacher_violation alter column lesson_id drop not null;

alter table chat.teacher_violation drop constraint teacher_violation_kind_check;
alter table chat.teacher_violation add constraint teacher_violation_kind_check
  check (kind in ('teacher_apology', 'teacher_no_show', 'late', 'absence', 'complaint'));

alter table chat.teacher_violation
  add column complaint_entry_id uuid unique references chat.teacher_supervision_entry (id);

-- A lesson's incident names its lesson; the other two never do. Both of those
-- are a person's act, so they name who recorded them; an absence says what
-- happened, because there is no lesson to say it.
alter table chat.teacher_violation add constraint teacher_violation_lesson_shape
  check ((kind in ('teacher_apology', 'teacher_no_show', 'late')) = (lesson_id is not null)
     and (kind = 'complaint') = (complaint_entry_id is not null)
     and (kind not in ('absence', 'complaint') or recorded_by is not null)
     and (kind <> 'absence' or note is not null));

create index teacher_violation_kind_idx on chat.teacher_violation (organization_id, kind, occurred_at desc);

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
      if not chat.is_lesson_manager(new.recorded_by, new.organization_id) then
        raise exception 'an absence or an upheld complaint is recorded by the Teachers department'
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
      if not chat.is_lesson_manager(new.recorded_by, new.organization_id) then
        raise exception 'lateness is recorded by the Teachers department' using errcode = 'insufficient_privilege';
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
    if not chat.is_lesson_manager(new.decided_by, new.organization_id) then
      raise exception 'a violation is decided by the teacher''s own Teachers department'
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

-- ===========================================================================
-- 2. Complaints: source, handler, follow-ups
-- ===========================================================================

alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_kind_check;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_kind_check
  check (kind in ('bonus', 'complaint', 'complaint_resolution', 'complaint_followup', 'monthly_comment', 'note'));

alter table chat.teacher_supervision_entry drop constraint teacher_supervision_entry_followup_shape;
alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_followup_shape
  check ((kind in ('complaint_resolution', 'complaint_followup')) = (refers_to is not null)
     and (source_message_id is null or (kind = 'complaint' and conversation_id is not null)));

-- A complaint is resolved once; follow-up notes are as many as it takes.
drop index chat.teacher_supervision_entry_one_resolution;
create unique index teacher_supervision_entry_one_resolution
  on chat.teacher_supervision_entry (refers_to) where kind = 'complaint_resolution';

-- Complaints recorded before PD-24 keep a null source and handler; the server
-- requires both from now on.
alter table chat.teacher_supervision_entry
  add column complaint_source text check (complaint_source in ('management', 'parent')),
  add column handled_by uuid references chat.staff (id);

alter table chat.teacher_supervision_entry add constraint teacher_supervision_entry_complaint_fields
  check ((complaint_source is null and handled_by is null) or kind = 'complaint');

create or replace function chat.guard_complaint_handler()
returns trigger
language plpgsql
as $$
begin
  if new.handled_by is not null and not chat.is_lesson_manager(new.handled_by, new.organization_id) then
    raise exception 'a complaint is handled by the Teachers department' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger teacher_supervision_entry_handler_is_supervisor
  before insert on chat.teacher_supervision_entry
  for each row execute function chat.guard_complaint_handler();

-- ===========================================================================
-- 3. Default deduction amounts, applied the moment a deduction is decided
-- ===========================================================================

create table chat.teacher_pay_default (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  kind            text not null check (kind in ('deduction_1', 'deduction_2')),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  -- 0 stops pricing this step automatically in this currency.
  amount          numeric(12, 2) not null check (amount >= 0),
  created_by      uuid not null references chat.staff (id),
  created_at      timestamptz not null default now()
);

comment on table chat.teacher_pay_default is
  'PD-24: the default amount of a first or second deduction in one currency; the newest row wins. Append-only. Super admin only.';

create index teacher_pay_default_lookup_idx on chat.teacher_pay_default (organization_id, kind, currency, created_at desc);

create or replace function chat.guard_teacher_pay_default()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from chat.staff s
     where s.id = new.created_by and s.organization_id = new.organization_id
       and s.is_active and s.left_at is null and s.role = 'super_admin'
  ) then
    raise exception 'default deduction amounts are set by the super admin' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger teacher_pay_default_is_coherent before insert on chat.teacher_pay_default
  for each row execute function chat.guard_teacher_pay_default();
create trigger teacher_pay_default_append_only before update or delete on chat.teacher_pay_default
  for each row execute function chat.forbid_payroll_rewrite();

-- The deduction's month is the violation's; its currency is the teacher's pay
-- currency in that month. No terms, or no default in that currency, leaves the
-- deduction unpriced: Payroll lists it to price by hand, as before PD-24.
create or replace function chat.price_decided_deduction()
returns trigger
language plpgsql
as $$
declare
  v_currency text;
  v_amount   numeric(12, 2);
begin
  if new.decision not in ('deduction_1', 'deduction_2') or old.decision is not null then
    return null;
  end if;
  select t.currency into v_currency
    from chat.teacher_pay_terms t
   where t.teacher_id = new.teacher_id and t.effective_month <= new.month
   order by t.effective_month desc, t.created_at desc
   limit 1;
  if v_currency is null then
    return null;
  end if;
  select d.amount into v_amount
    from chat.teacher_pay_default d
   where d.organization_id = new.organization_id and d.kind = new.decision and d.currency = v_currency
   order by d.created_at desc
   limit 1;
  if v_amount is null or v_amount = 0 then
    return null;
  end if;
  insert into chat.teacher_pay_adjustment
    (organization_id, teacher_id, kind, month, amount, currency, reason, violation_id, created_by)
  values
    (new.organization_id, new.teacher_id, 'deduction', new.month, v_amount, v_currency,
     case new.decision when 'deduction_1' then 'First deduction (default amount)'
                       else 'Second deduction (default amount)' end,
     new.id, new.decided_by);
  return null;
end;
$$;

create trigger teacher_violation_deduction_is_priced
  after update of decision on chat.teacher_violation
  for each row execute function chat.price_decided_deduction();

-- ===========================================================================
-- 4. Away: on leave, suspended, or another day off -- and until when
-- ===========================================================================

-- The academy's today (schedule.timezone), which days off are counted in.
create or replace function chat.academy_today()
returns date
language sql
stable
as $$
  select (now() at time zone coalesce(
    (select c.value #>> '{}' from chat.config c where c.key = 'schedule.timezone'), 'Africa/Cairo'))::date;
$$;

-- What keeps the teacher away on p_day (suspension over leave over a plain day
-- off), and the last day of the unbroken run of days off it starts. No row when
-- the teacher is not away that day.
create or replace function chat.teacher_away(p_teacher uuid, p_day date)
returns table (kind text, until date)
language sql
stable
as $$
  with recursive run(day) as (
    select p_day where exists (select 1 from chat.teacher_day_off o where o.teacher_id = p_teacher and o.day = p_day)
    union all
    select run.day + 1 from run
     where exists (select 1 from chat.teacher_day_off o where o.teacher_id = p_teacher and o.day = run.day + 1)
       and run.day < p_day + 400
  )
  select case when o.suspension_id is not null then 'suspended'
              when o.leave_request_id is not null then 'leave'
              else 'day_off' end,
         (select max(day) from run)
    from chat.teacher_day_off o
   where o.teacher_id = p_teacher and o.day = p_day;
$$;

-- ===========================================================================
-- 5. Card kinds, request roles
-- ===========================================================================

alter table chat.teacher_pay_default enable row level security;
revoke all on chat.teacher_pay_default from public, anon, authenticated, chat_app;

revoke all on function chat.guard_complaint_handler() from public;
revoke all on function chat.guard_teacher_pay_default() from public;
revoke all on function chat.price_decided_deduction() from public;
revoke all on function chat.academy_today() from public;
revoke all on function chat.teacher_away(uuid, date) from public;
