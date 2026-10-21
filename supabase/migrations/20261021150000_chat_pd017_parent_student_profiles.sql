-- PD-17 (2026-10-21) -- the Parent Profile, the Student Profile, and payments
-- recorded in Chat.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-17, and
-- docs/admin/pd017-parent-student-profiles.md.
--
-- WHAT IS NEW
--
--   chat.parent_file        the administration's record of a parent: phone,
--                           e-mail, emirate / governorate and an internal note.
--                           Admin-only, like chat.teacher_file (PD-10): the
--                           parent never sees the note, teachers never see any
--                           of it, and the communication engine cannot read it.
--   chat.family_billing     how the family pays (invoice | bank_transfer) and in
--                           which currency.
--   chat.family_instalment  what the family owes and has paid: one row per
--                           instalment, created alone or as a plan, paid once,
--                           voided with a reason. Never edited, never deleted.
--
-- PD-17 REVERSES PD-10 §1 FOR MONEY: Chat no longer reads invoices from Jawwid
-- Core (the owner: "we must not retrieve or reuse anything from Jawwid Core").
-- Instalments and payments are Chat's own records from here on; the Instalment
-- Payments page reads chat.family_instalment.
--
-- The family's plan stays chat.family.subscription_plan_months (1/3/6/12, the
-- Stories v2 column) and its country chat.family.country_code: one value each,
-- read by Stories targeting and the Parent Profile alike.
--
-- MONEY IS APPEND-ONLY. An instalment's amount, currency, due date, family and
-- child never change after it is written; a payment, once recorded, is never
-- changed or removed; a void is final and needs a reason. A mistake is corrected
-- by voiding the row and writing a new one, so the history always shows both.
-- chat.guard_family_instalment enforces it for every writer, the API included.
--
-- THE PHONE IS CONFINED (G-07). no-contact-channel-columns.spec.ts allows
-- exactly this one declaration, and parent-file-confinement.spec.ts fails the
-- build if any source outside src/parent-profile names the table or its fields.
-- The audit trail records WHICH fields of a parent file changed, never their
-- values, so the phone does not spread into chat.audit_log.
--
-- FAIL CLOSED. RLS on, no grant to any request role: the API's owner connection
-- writes, and the services decide who may.
--
-- ROLLBACK (refuses while money rows exist -- they are records, not cache):
--   do $$ begin
--     if exists (select 1 from chat.family_instalment) then
--       raise exception 'chat.family_instalment holds payments; export them first';
--     end if;
--   end $$;
--   drop table chat.family_instalment;
--   drop table chat.family_billing;
--   drop table chat.parent_file;
--   drop function chat.guard_family_instalment();
--   drop function chat.take_family_organization();
--   drop function chat.parent_file_take_organization();

-- ===========================================================================
-- 1. The parent file
-- ===========================================================================

create table chat.parent_file (
  contact_id      uuid primary key references chat.contact (id) on delete cascade,
  organization_id uuid not null,
  phone text constraint parent_file_phone_is_admin_only check (length(btrim(phone)) between 5 and 32),
  email           text check (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Emirate (UAE) or governorate (Egypt and others): free text, the country is
  -- chat.family.country_code.
  region          text check (length(btrim(region)) between 1 and 80),
  -- What the administration knows about this parent. Never shown to the parent.
  admin_note      text check (length(btrim(admin_note)) between 1 and 1000),
  updated_by      uuid references chat.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.parent_file is
  'PD-17: the administration''s record of a parent (phone, e-mail, region, internal note). Admin-only; read and written only by src/parent-profile. No name (chat.contact.name) and no photo (chat.contact.avatar_object_key).';

-- The organization is the contact's, whatever the writer sent.
create or replace function chat.parent_file_take_organization()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.contact_id <> old.contact_id then
    raise exception 'a parent file stays with its parent' using errcode = 'check_violation';
  end if;
  new.organization_id := (select c.organization_id from chat.contact c where c.id = new.contact_id);
  if new.organization_id is null then
    raise exception 'a parent file needs its parent' using errcode = 'foreign_key_violation';
  end if;
  return new;
end
$$;

create trigger parent_file_take_organization
  before insert or update on chat.parent_file
  for each row execute function chat.parent_file_take_organization();

create trigger parent_file_set_updated_at
  before update on chat.parent_file
  for each row execute function chat.set_updated_at();

-- ===========================================================================
-- 2. How the family pays
-- ===========================================================================

create table chat.family_billing (
  family_id       uuid primary key references chat.family (id) on delete cascade,
  organization_id uuid not null,
  payment_method  text check (payment_method in ('invoice', 'bank_transfer')),
  currency        text check (currency ~ '^[A-Z]{3}$'),
  updated_by      uuid references chat.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.family_billing is
  'PD-17: how a family pays (invoice | bank_transfer) and its currency. The plan is chat.family.subscription_plan_months.';

-- The organization is the family's, whatever the writer sent.
create or replace function chat.take_family_organization()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  new.organization_id := (select f.organization_id from chat.family f where f.id = new.family_id);
  if new.organization_id is null then
    raise exception 'a billing row needs its family' using errcode = 'foreign_key_violation';
  end if;
  return new;
end
$$;

create trigger family_billing_take_organization
  before insert or update on chat.family_billing
  for each row execute function chat.take_family_organization();

create trigger family_billing_set_updated_at
  before update on chat.family_billing
  for each row execute function chat.set_updated_at();

-- ===========================================================================
-- 3. Instalments and payments
-- ===========================================================================

create table chat.family_instalment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  -- RESTRICT, not cascade: a family with payment history is not deleted by accident.
  family_id       uuid not null references chat.family (id) on delete restrict,
  -- Set when the instalment is for one child; null = the family's.
  learner_id      uuid references chat.learner (id) on delete restrict,
  -- Instalments created together as one plan share this id.
  plan_id         uuid,
  label           text not null check (length(btrim(label)) between 1 and 120),
  amount_minor    bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  due_date        date not null,
  created_by      uuid not null references chat.staff (id),
  created_at      timestamptz not null default now(),
  -- The payment: the day the money arrived, how, an optional reference (a bank
  -- transfer number, an invoice number), and who recorded it when.
  paid_on         date,
  paid_method     text check (paid_method in ('invoice', 'bank_transfer')),
  paid_reference  text check (length(btrim(paid_reference)) between 1 and 120),
  paid_recorded_by uuid references chat.staff (id),
  paid_recorded_at timestamptz,
  voided_at       timestamptz,
  voided_by       uuid references chat.staff (id),
  void_reason     text check (length(btrim(void_reason)) between 1 and 500),
  constraint family_instalment_payment_is_whole check (
    (paid_on is null) = (paid_method is null)
    and (paid_on is null) = (paid_recorded_by is null)
    and (paid_on is null) = (paid_recorded_at is null)
    and (paid_on is not null or paid_reference is null)),
  constraint family_instalment_void_is_whole check (
    (voided_at is null) = (voided_by is null)
    and (voided_at is null) = (void_reason is null))
);

comment on table chat.family_instalment is
  'PD-17: what a family owes and has paid. Append-only: amounts never change, a payment is never removed, a void is final with a reason (chat.guard_family_instalment).';

create index family_instalment_family_idx on chat.family_instalment (family_id, due_date);
create index family_instalment_open_idx on chat.family_instalment (organization_id, due_date)
  where paid_on is null and voided_at is null;

create or replace function chat.guard_family_instalment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_staff_org uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'an instalment is never deleted; void it with a reason'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := (select f.organization_id from chat.family f where f.id = new.family_id);
    if new.organization_id is null then
      raise exception 'an instalment needs its family' using errcode = 'foreign_key_violation';
    end if;
    if new.learner_id is not null and not exists (
      select 1 from chat.learner l where l.id = new.learner_id and l.family_id = new.family_id
    ) then
      raise exception 'an instalment for a child is for a child of that family'
        using errcode = 'check_violation';
    end if;
    select s.organization_id into v_staff_org from chat.staff s where s.id = new.created_by;
    if v_staff_org is distinct from new.organization_id then
      raise exception 'an instalment is written by staff of the family''s organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.paid_on is not null or new.voided_at is not null then
      raise exception 'an instalment is created open; pay or void it afterwards'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: only an open row changes, and only by being paid or voided.
  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.family_id <> old.family_id
     or new.learner_id is distinct from old.learner_id
     or new.plan_id is distinct from old.plan_id
     or new.label <> old.label
     or new.amount_minor <> old.amount_minor
     or new.currency <> old.currency
     or new.due_date <> old.due_date
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'an instalment''s terms never change; void it and write a new one'
      using errcode = 'check_violation';
  end if;
  if old.voided_at is not null then
    raise exception 'a voided instalment is final' using errcode = 'check_violation';
  end if;
  if old.paid_on is not null and (
       new.paid_on is distinct from old.paid_on
    or new.paid_method is distinct from old.paid_method
    or new.paid_reference is distinct from old.paid_reference
    or new.paid_recorded_by is distinct from old.paid_recorded_by
    or new.paid_recorded_at is distinct from old.paid_recorded_at) then
    raise exception 'a recorded payment never changes; void the instalment instead'
      using errcode = 'check_violation';
  end if;
  if new.paid_recorded_by is not null and new.paid_recorded_by is distinct from old.paid_recorded_by then
    select s.organization_id into v_staff_org from chat.staff s where s.id = new.paid_recorded_by;
    if v_staff_org is distinct from new.organization_id then
      raise exception 'a payment is recorded by staff of the family''s organization'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.voided_by is not null then
    select s.organization_id into v_staff_org from chat.staff s where s.id = new.voided_by;
    if v_staff_org is distinct from new.organization_id then
      raise exception 'an instalment is voided by staff of the family''s organization'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;

create trigger family_instalment_is_append_only
  before insert or update or delete on chat.family_instalment
  for each row execute function chat.guard_family_instalment();

-- ===========================================================================
-- 4. Families already enrolled from New Students (PD-16)
-- ===========================================================================
-- The phone and e-mail Sales typed, and how the family said it would pay. From
-- here on NewStudentEnrolmentService writes the same at Assign.

insert into chat.parent_file (contact_id, organization_id, phone, email)
select e.contact_id, e.organization_id, btrim(t.phone), lower(btrim(t.email))
  from chat.student_enrolment e
  join chat.trial_subscription t on t.lesson_id = e.lesson_id
on conflict (contact_id) do nothing;

insert into chat.family_billing (family_id, organization_id, payment_method, currency)
select e.family_id, e.organization_id, t.payment_method, t.currency
  from chat.student_enrolment e
  join chat.trial_subscription t on t.lesson_id = e.lesson_id
on conflict (family_id) do nothing;

-- ===========================================================================
-- 5. Fail closed
-- ===========================================================================

alter table chat.parent_file enable row level security;
alter table chat.family_billing enable row level security;
alter table chat.family_instalment enable row level security;
revoke all on chat.parent_file, chat.family_billing, chat.family_instalment
  from public, anon, authenticated, chat_app;

revoke all on function chat.parent_file_take_organization() from public;
revoke all on function chat.take_family_organization() from public;
revoke all on function chat.guard_family_instalment() from public;
