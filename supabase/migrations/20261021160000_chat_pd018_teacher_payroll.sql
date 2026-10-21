-- PD-18 (closed 2026-10-21) -- teacher payroll lives in Chat. Reverses PD-10
-- item 4 ("payroll stays in Core, never stored in Chat").
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-18, and
-- docs/admin/teacher-file.md.
--
-- WHAT THIS ADDS
--
--   chat.teacher_file.teaching_market  the market a teacher teaches for. Employment,
--                                      not finance: the Teachers department reads it.
--   chat.teacher_pay_terms             salary type, currency and amount, one version
--                                      per effective month. Append-only.
--   chat.teacher_payout_account        how the teacher is paid (e-wallet, InstaPay,
--                                      bank transfer). The account details are
--                                      ENCRYPTED by the server (AES-256-GCM); the
--                                      database holds ciphertext, the method and
--                                      the last four characters only.
--   chat.teacher_pay_adjustment        the amount of a bonus or deduction, linked
--                                      to the recorded bonus (PD-11) or deduction
--                                      decision (PD-12) when there is one.
--                                      Append-only; a correction replaces a row.
--
-- WHAT THIS DOES NOT ADD
--
--   A stored month total. The financial summary (base pay + bonuses -
--   deductions) is computed on every read from these rows and chat.lesson, so
--   it cannot drift from them.
--   Any payment. Chat records what is owed and how to pay; nobody pays from here.
--
-- WHO READS IT. The super admin only (PD-10's finance tier, kept by PD-18). No
-- request role has a grant on any of these tables, and
-- test/unit/privacy/teacher-file-confinement.spec.ts fails the build if any
-- source outside src/teacher-file names them.

-- ===========================================================================
-- 1. Teaching market (employment)
-- ===========================================================================

alter table chat.teacher_file
  add column teaching_market text
    constraint teacher_file_teaching_market_shape check (length(btrim(teaching_market)) between 1 and 80);

-- ===========================================================================
-- 2. Pay terms, versioned by effective month
-- ===========================================================================

create table chat.teacher_pay_terms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  teacher_id      uuid not null references chat.teacher (id) on delete cascade,
  -- The first payroll month (academy calendar, chat.academy_month) these terms apply to.
  effective_month date not null check (extract(day from effective_month) = 1),
  salary_type     text not null check (salary_type in ('shift', 'hourly')),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  monthly_amount  numeric(12, 2) check (monthly_amount > 0),
  hourly_rate     numeric(12, 2) check (hourly_rate > 0),
  reason          text not null check (length(btrim(reason)) between 1 and 500),
  created_by      uuid not null references chat.staff (id),
  created_at      timestamptz not null default now(),
  -- A shift-based salary is a fixed monthly amount; an hourly one is a rate
  -- paid on the hours of the lessons the teacher held that month.
  constraint teacher_pay_terms_amount_matches_type check (
    (salary_type = 'shift' and monthly_amount is not null and hourly_rate is null)
    or (salary_type = 'hourly' and hourly_rate is not null and monthly_amount is null)
  )
);

comment on table chat.teacher_pay_terms is
  'PD-18: a teacher''s salary terms from an effective month. Never updated or deleted: a change is a new row. Super admin only.';

create index teacher_pay_terms_teacher_idx on chat.teacher_pay_terms (teacher_id, effective_month desc, created_at desc);

-- ===========================================================================
-- 3. The payout account (encrypted details)
-- ===========================================================================

create table chat.teacher_payout_account (
  teacher_id      uuid primary key references chat.teacher (id) on delete cascade,
  organization_id uuid not null references chat.organization (id),
  method          text not null check (method in ('e_wallet', 'instapay', 'bank_transfer')),
  -- iv (12 bytes) || auth tag (16 bytes) || ciphertext of the details JSON.
  -- The additional authenticated data binds it to (organization, teacher,
  -- method), so a ciphertext copied onto another row does not decrypt.
  details_sealed  bytea not null check (octet_length(details_sealed) > 28),
  key_id          text not null check (key_id ~ '^[a-z0-9_-]{1,32}$'),
  last4           text not null check (last4 ~ '^[0-9A-Za-z]{1,4}$'),
  updated_at      timestamptz not null default now(),
  updated_by      uuid not null references chat.staff (id)
);

comment on table chat.teacher_payout_account is
  'PD-18: how a teacher is paid. Details are sealed by the server (AES-256-GCM); only the method and last four characters are clear. Super admin only.';

create trigger teacher_payout_account_updated_at before update on chat.teacher_payout_account
  for each row execute function chat.set_updated_at();

-- ===========================================================================
-- 4. Amounts of bonuses and deductions
-- ===========================================================================

create table chat.teacher_pay_adjustment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  teacher_id      uuid not null references chat.teacher (id) on delete cascade,
  kind            text not null check (kind in ('bonus', 'deduction')),
  -- The payroll month it is paid or deducted in.
  month           date not null check (extract(day from month) = 1),
  amount          numeric(12, 2) not null check (amount >= 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  reason          text not null check (length(btrim(reason)) between 1 and 500),
  -- What it prices, when it prices something already recorded.
  bonus_entry_id  uuid references chat.teacher_supervision_entry (id),
  violation_id    uuid references chat.teacher_violation (id),
  -- A correction: this row supersedes `replaces`. Amount 0 cancels.
  replaces        uuid references chat.teacher_pay_adjustment (id),
  created_by      uuid not null references chat.staff (id),
  created_at      timestamptz not null default now(),
  constraint teacher_pay_adjustment_source_matches_kind check (
    (bonus_entry_id is null or kind = 'bonus')
    and (violation_id is null or kind = 'deduction')
  ),
  constraint teacher_pay_adjustment_zero_only_cancels check (amount > 0 or replaces is not null)
);

comment on table chat.teacher_pay_adjustment is
  'PD-18: the amount of a teacher''s bonus or deduction. Never updated or deleted: a correction is a new row that replaces it. Super admin only.';

create index teacher_pay_adjustment_teacher_idx on chat.teacher_pay_adjustment (teacher_id, month desc);
-- A row is corrected at most once (corrections form a chain), and a recorded
-- bonus or deduction decision is priced by one original row.
create unique index teacher_pay_adjustment_replaced_once on chat.teacher_pay_adjustment (replaces) where replaces is not null;
create unique index teacher_pay_adjustment_one_per_bonus on chat.teacher_pay_adjustment (bonus_entry_id)
  where bonus_entry_id is not null and replaces is null;
create unique index teacher_pay_adjustment_one_per_violation on chat.teacher_pay_adjustment (violation_id)
  where violation_id is not null and replaces is null;

-- ===========================================================================
-- 5. Coherence: same organization, real staff, real sources
-- ===========================================================================

create or replace function chat.guard_teacher_payroll_row()
returns trigger
language plpgsql
as $$
declare
  v_teacher_org uuid;
  v_author      uuid;
  v_target      chat.teacher_pay_adjustment%rowtype;
begin
  select organization_id into v_teacher_org from chat.teacher where id = new.teacher_id;
  if v_teacher_org is distinct from new.organization_id then
    raise exception 'a payroll row belongs to the teacher''s organization' using errcode = 'insufficient_privilege';
  end if;
  -- The payout account names its editor `updated_by`; the append-only tables `created_by`.
  v_author := coalesce(to_jsonb(new) ->> 'created_by', to_jsonb(new) ->> 'updated_by')::uuid;
  if not exists (
    select 1 from chat.staff s where s.id = v_author and s.organization_id = new.organization_id and s.is_active
  ) then
    raise exception 'payroll is written by active staff of its organization' using errcode = 'insufficient_privilege';
  end if;

  if tg_table_name = 'teacher_pay_adjustment' then
    if new.bonus_entry_id is not null and not exists (
      select 1 from chat.teacher_supervision_entry e
       where e.id = new.bonus_entry_id and e.teacher_id = new.teacher_id and e.kind = 'bonus'
    ) then
      raise exception 'a bonus amount prices a bonus recorded for the same teacher' using errcode = 'foreign_key_violation';
    end if;
    if new.violation_id is not null and not exists (
      select 1 from chat.teacher_violation v
       where v.id = new.violation_id and v.teacher_id = new.teacher_id and v.decision in ('deduction_1', 'deduction_2')
    ) then
      raise exception 'a deduction amount prices a deduction decided for the same teacher' using errcode = 'foreign_key_violation';
    end if;
    if new.replaces is not null then
      select * into v_target from chat.teacher_pay_adjustment where id = new.replaces;
      if v_target.id is null or v_target.teacher_id <> new.teacher_id or v_target.kind <> new.kind
         or v_target.bonus_entry_id is distinct from new.bonus_entry_id
         or v_target.violation_id is distinct from new.violation_id then
        raise exception 'a correction replaces an amount of the same kind, teacher and source' using errcode = 'foreign_key_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger teacher_pay_terms_is_coherent before insert on chat.teacher_pay_terms
  for each row execute function chat.guard_teacher_payroll_row();
create trigger teacher_payout_account_is_coherent before insert or update on chat.teacher_payout_account
  for each row execute function chat.guard_teacher_payroll_row();
create trigger teacher_pay_adjustment_is_coherent before insert on chat.teacher_pay_adjustment
  for each row execute function chat.guard_teacher_payroll_row();

-- Terms and amounts are a record: a correction is a new row.
create or replace function chat.forbid_payroll_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only: record a new row instead', tg_table_name using errcode = 'check_violation';
end;
$$;

create trigger teacher_pay_terms_append_only before update or delete on chat.teacher_pay_terms
  for each row execute function chat.forbid_payroll_rewrite();
create trigger teacher_pay_adjustment_append_only before update or delete on chat.teacher_pay_adjustment
  for each row execute function chat.forbid_payroll_rewrite();

-- ===========================================================================
-- 6. Grants: none. Only the server reads or writes payroll.
-- ===========================================================================

alter table chat.teacher_pay_terms enable row level security;
alter table chat.teacher_payout_account enable row level security;
alter table chat.teacher_pay_adjustment enable row level security;
revoke all on chat.teacher_pay_terms from public, anon, authenticated, chat_app;
revoke all on chat.teacher_payout_account from public, anon, authenticated, chat_app;
revoke all on chat.teacher_pay_adjustment from public, anon, authenticated, chat_app;

revoke all on function chat.guard_teacher_payroll_row() from public;
revoke all on function chat.forbid_payroll_rewrite() from public;
