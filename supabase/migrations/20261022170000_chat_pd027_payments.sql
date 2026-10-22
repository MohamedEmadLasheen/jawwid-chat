-- PD-27 (2026-10-22): payments -- payment links, card payments (Stripe),
-- bank-transfer receipts, cash, refunds, invoices.
--
-- PD-17 made a family's instalments Chat's own record (chat.family_instalment:
-- what the family owes, paid once, voided with a reason). PD-27 adds how money
-- ARRIVES and what the family gets back:
--
--   chat.payment_request   "please pay X for Y" -- carries the unique payment
--                          link (a 256-bit token). For an enrolled family, or
--                          for a trial before Assign (trial_lesson_id); Assign
--                          attaches it to the family it creates.
--   chat.payment           money that arrived: card | bank_transfer | cash |
--                          invoice (PD-17's method). Append-only; a mistake is
--                          voided with a reason; a card payment is refunded,
--                          never voided.
--   chat.payment_refund    money given back on a payment (Stripe or staff).
--   chat.invoice           one per payment, numbered per organization and year
--                          by the database, frozen at issue (snapshot).
--   chat.payment_receipt   a parent's proof of a bank transfer, pending until a
--                          verifier approves (-> a payment) or rejects it.
--   chat.payment_checkout  every Stripe Checkout Session opened for a request;
--                          the webhook is matched against it.
--   chat.stripe_event      every verified Stripe event id, once.
--
-- EXACTLY ONCE. A Stripe event is recorded by its id (primary key), and a card
-- payment by its checkout session and its payment intent (both unique): a
-- redelivered webhook, or two different events about one session, cannot
-- record a payment twice. Refunds are unique on the Stripe refund id.
--
-- APPEND-ONLY, for every writer (the API included): chat.guard_payment_row
-- refuses DELETE on every table here, and each UPDATE may only move a row
-- forward (paid, cancelled, voided, decided, attached at Assign). The one
-- derived value is payment_request.paid_at, which follows the payments.
--
-- Down (only if no money has been recorded):
--   do $$ begin
--     if exists (select 1 from chat.payment) then
--       raise exception 'chat.payment holds payments; export them first';
--     end if;
--   end $$;
--   drop table chat.stripe_event, chat.payment_checkout, chat.invoice,
--     chat.invoice_counter, chat.payment_refund;
--   alter table chat.payment drop constraint payment_receipt_fk;
--   drop table chat.payment_receipt, chat.payment, chat.payment_request;
--   drop function chat.guard_payment_request(), chat.guard_payment(),
--     chat.guard_payment_refund(), chat.guard_invoice(),
--     chat.guard_payment_receipt(), chat.forbid_payment_delete();
--   delete from chat.notification_template
--    where key in ('payment_received', 'payment_receipt_rejected');
--   (and restore PD-17's two family_instalment constraints)

-- ===========================================================================
-- 1. PD-17's instalment learns the new methods and partial payment
-- ===========================================================================
-- A card payment has no staff recorder (Stripe confirmed it), and an instalment
-- now becomes "paid" when its payments cover it -- possibly by several, of
-- different methods. paid_method is the method of the payment that completed it.

alter table chat.family_instalment drop constraint family_instalment_paid_method_check;
alter table chat.family_instalment add constraint family_instalment_paid_method_check
  check (paid_method in ('invoice', 'bank_transfer', 'cash', 'card'));

alter table chat.family_instalment drop constraint family_instalment_payment_is_whole;
alter table chat.family_instalment add constraint family_instalment_payment_is_whole check (
  (paid_on is null) = (paid_method is null)
  and (paid_on is null) = (paid_recorded_at is null)
  and (paid_on is not null or paid_recorded_by is null)
  and (paid_on is null or paid_recorded_by is not null or paid_method = 'card')
  and (paid_on is not null or paid_reference is null));

-- ===========================================================================
-- 2. Payment requests (the payment link)
-- ===========================================================================

create table chat.payment_request (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  -- 32 random bytes, base64url: the whole capability of the link.
  token            text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  family_id        uuid references chat.family (id) on delete restrict,
  -- A trial not yet assigned (PD-16). Kept after Assign: it says where it began.
  trial_lesson_id  uuid references chat.lesson (id) on delete restrict,
  learner_id       uuid references chat.learner (id) on delete restrict,
  -- The child's name as shown on the link and the invoice (a trial's child has
  -- no learner row yet).
  child_name       text check (length(btrim(child_name)) between 1 and 120),
  -- Who is billed, as written on the invoice. Set for a trial's request from
  -- Sales' form (the family's parent is read live once it exists).
  payer_name       text check (length(btrim(payer_name)) between 1 and 120),
  instalment_id    uuid references chat.family_instalment (id) on delete restrict,
  purpose          text not null check (purpose in ('subscription', 'renewal', 'instalment', 'balance', 'other')),
  label            text not null check (length(btrim(label)) between 1 and 120),
  amount_minor     bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  plan_months      smallint check (plan_months in (1, 3, 6, 12)),
  period_start     date,
  period_end       date,
  expires_at       timestamptz not null,
  -- Set when its standing payments cover it; cleared if a void leaves it short.
  paid_at          timestamptz,
  -- null: opened by the system for a parent paying an instalment in the app.
  created_by       uuid references chat.staff (id),
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  -- null: the system (an expired instalment link replaced by a fresh one).
  cancelled_by     uuid references chat.staff (id),
  cancel_reason    text check (length(btrim(cancel_reason)) between 1 and 500),
  constraint payment_request_has_a_payer check (family_id is not null or trial_lesson_id is not null),
  constraint payment_request_instalment_is_a_familys check (instalment_id is null or family_id is not null),
  constraint payment_request_period_in_order check (period_start is null or period_end is null or period_end >= period_start),
  constraint payment_request_cancel_is_whole check (
    (cancelled_at is null) = (cancel_reason is null)
    and (cancelled_at is not null or cancelled_by is null)),
  constraint payment_request_paid_or_cancelled check (paid_at is null or cancelled_at is null)
);

comment on table chat.payment_request is
  'PD-27: a request to pay, carrying the unique payment link. Terms never change; it is paid, cancelled, or attached to its family at Assign (chat.guard_payment_request).';

create index payment_request_family_idx on chat.payment_request (family_id, created_at desc);
create index payment_request_trial_idx on chat.payment_request (trial_lesson_id) where trial_lesson_id is not null;
-- One live link per instalment: an expired one is cancelled before another is made.
create unique index payment_request_one_open_per_instalment on chat.payment_request (instalment_id)
  where instalment_id is not null and paid_at is null and cancelled_at is null;

-- ===========================================================================
-- 3. Payments, refunds
-- ===========================================================================

create table chat.payment (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references chat.organization (id),
  family_id                   uuid references chat.family (id) on delete restrict,
  trial_lesson_id             uuid references chat.lesson (id) on delete restrict,
  learner_id                  uuid references chat.learner (id) on delete restrict,
  child_name                  text check (length(btrim(child_name)) between 1 and 120),
  request_id                  uuid references chat.payment_request (id) on delete restrict,
  instalment_id               uuid references chat.family_instalment (id) on delete restrict,
  method                      text not null check (method in ('card', 'bank_transfer', 'cash', 'invoice')),
  amount_minor                bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency                    text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on                     date not null,
  recorded_at                 timestamptz not null default now(),
  -- null only for a card payment: Stripe confirmed it, no one typed it.
  recorded_by                 uuid references chat.staff (id),
  reference                   text check (length(btrim(reference)) between 1 and 120),
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text unique,
  receipt_id                  uuid unique,
  voided_at                   timestamptz,
  voided_by                   uuid references chat.staff (id),
  void_reason                 text check (length(btrim(void_reason)) between 1 and 500),
  constraint payment_has_a_payer check (family_id is not null or trial_lesson_id is not null),
  constraint payment_card_is_stripes check ((method = 'card') = (stripe_checkout_session_id is not null)),
  constraint payment_has_a_recorder check (method = 'card' or recorded_by is not null),
  constraint payment_card_is_refunded_not_voided check (method <> 'card' or voided_at is null),
  constraint payment_void_is_whole check (
    (voided_at is null) = (voided_by is null)
    and (voided_at is null) = (void_reason is null))
);

comment on table chat.payment is
  'PD-27: money that arrived. Append-only (chat.guard_payment): never edited, never deleted; a mistake is voided with a reason, a card payment is refunded.';

create index payment_family_idx on chat.payment (family_id, paid_on desc);
create index payment_request_idx on chat.payment (request_id) where request_id is not null;
create index payment_instalment_idx on chat.payment (instalment_id) where instalment_id is not null;
create index payment_trial_idx on chat.payment (trial_lesson_id) where trial_lesson_id is not null;

create table chat.payment_refund (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  payment_id       uuid not null references chat.payment (id) on delete restrict,
  amount_minor     bigint not null check (amount_minor > 0),
  reason           text not null check (length(btrim(reason)) between 1 and 500),
  stripe_refund_id text unique,
  -- null: a refund made in the Stripe Dashboard, learned from the webhook.
  recorded_by      uuid references chat.staff (id),
  created_at       timestamptz not null default now(),
  constraint payment_refund_has_a_source check (stripe_refund_id is not null or recorded_by is not null)
);

comment on table chat.payment_refund is
  'PD-27: money given back on a payment. Never edited or deleted; the refunds of a payment never exceed it.';

create index payment_refund_payment_idx on chat.payment_refund (payment_id);

-- ===========================================================================
-- 4. Bank-transfer receipts
-- ===========================================================================

create table chat.payment_receipt (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  family_id        uuid not null references chat.family (id) on delete restrict,
  request_id       uuid not null references chat.payment_request (id) on delete restrict,
  amount_minor     bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  transferred_on   date not null,
  note             text check (length(btrim(note)) between 1 and 500),
  object_key       text not null unique check (object_key like 'payment-receipts/%'),
  mime_type        text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size        integer not null check (byte_size > 0 and byte_size <= 10485760),
  uploaded_by      uuid not null references chat.contact (id),
  uploaded_at      timestamptz not null default now(),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by      uuid references chat.staff (id),
  reviewed_at      timestamptz,
  reject_reason    text check (length(btrim(reject_reason)) between 1 and 500),
  payment_id       uuid unique references chat.payment (id),
  constraint payment_receipt_review_is_whole check (
    (status = 'pending') = (reviewed_by is null)
    and (status = 'pending') = (reviewed_at is null)
    and (status = 'rejected') = (reject_reason is not null)
    and (status = 'approved') = (payment_id is not null))
);

comment on table chat.payment_receipt is
  'PD-27: a parent''s proof of a bank transfer. Pending until a verifier approves it (a payment) or rejects it with a reason; decided once, never deleted.';

create index payment_receipt_queue_idx on chat.payment_receipt (organization_id, status, uploaded_at);
create index payment_receipt_family_idx on chat.payment_receipt (family_id, uploaded_at desc);

alter table chat.payment add constraint payment_receipt_fk
  foreign key (receipt_id) references chat.payment_receipt (id);

-- ===========================================================================
-- 5. Invoices
-- ===========================================================================

create table chat.invoice_counter (
  organization_id uuid not null references chat.organization (id),
  year            integer not null,
  last_value      integer not null,
  primary key (organization_id, year)
);

create table chat.invoice (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  -- Assigned by the database (chat.guard_invoice): JW-<year>-<000001>.
  number           text not null,
  payment_id       uuid not null unique references chat.payment (id) on delete restrict,
  family_id        uuid references chat.family (id) on delete restrict,
  trial_lesson_id  uuid references chat.lesson (id) on delete restrict,
  issued_at        timestamptz not null default now(),
  -- Everything the document prints, frozen at issue.
  snapshot         jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  voided_at        timestamptz,
  constraint invoice_number_unique unique (organization_id, number),
  constraint invoice_has_a_payer check (family_id is not null or trial_lesson_id is not null)
);

comment on table chat.invoice is
  'PD-27: one invoice per payment, numbered per organization and year, frozen at issue. Voided with its payment; never edited or deleted.';

create index invoice_family_idx on chat.invoice (family_id, issued_at desc);

-- ===========================================================================
-- 6. Stripe
-- ===========================================================================

create table chat.payment_checkout (
  stripe_session_id text primary key,
  organization_id   uuid not null references chat.organization (id),
  request_id        uuid not null references chat.payment_request (id) on delete restrict,
  amount_minor      bigint not null check (amount_minor > 0),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  status            text not null default 'open' check (status in ('open', 'complete', 'expired', 'failed')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  updated_at        timestamptz not null default now()
);

comment on table chat.payment_checkout is
  'PD-27: every Stripe Checkout Session opened for a request -- the amount and currency the webhook must match.';

create index payment_checkout_request_idx on chat.payment_checkout (request_id, created_at desc);

create table chat.stripe_event (
  id          text primary key,
  type        text not null,
  livemode    boolean not null,
  received_at timestamptz not null default now(),
  outcome     text not null
);

comment on table chat.stripe_event is
  'PD-27: every verified Stripe webhook event, once. A redelivery finds its row and does nothing.';

-- ===========================================================================
-- 7. The guards
-- ===========================================================================

create or replace function chat.forbid_payment_delete()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  raise exception '% is never deleted', tg_table_name using errcode = 'insufficient_privilege';
end
$$;

-- The payer's organization: the family's, else the trial lesson's.
create or replace function chat.payer_organization(p_family uuid, p_trial uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select f.organization_id from chat.family f where f.id = p_family),
    (select l.organization_id from chat.lesson l where l.id = p_trial))
$$;

create or replace function chat.staff_of(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select p_staff is null or exists (select 1 from chat.staff s where s.id = p_staff and s.organization_id = p_org)
$$;

create or replace function chat.guard_payment_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.organization_id := chat.payer_organization(new.family_id, new.trial_lesson_id);
    if new.organization_id is null then
      raise exception 'a payment request needs its family or trial' using errcode = 'foreign_key_violation';
    end if;
    if new.family_id is not null and new.trial_lesson_id is not null then
      raise exception 'a payment request is made for a family or for a trial, not both'
        using errcode = 'check_violation';
    end if;
    if new.learner_id is not null and not exists (
      select 1 from chat.learner l where l.id = new.learner_id and l.family_id = new.family_id) then
      raise exception 'a payment request for a child is for a child of that family' using errcode = 'check_violation';
    end if;
    if new.instalment_id is not null and not exists (
      select 1 from chat.family_instalment i
       where i.id = new.instalment_id and i.family_id = new.family_id
         and i.paid_on is null and i.voided_at is null) then
      raise exception 'a payment request pays an open instalment of its family' using errcode = 'check_violation';
    end if;
    if not chat.staff_of(new.created_by, new.organization_id) then
      raise exception 'a payment request is made by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    if new.paid_at is not null or new.cancelled_at is not null then
      raise exception 'a payment request is created open' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: the terms never change.
  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.token <> old.token
     or new.trial_lesson_id is distinct from old.trial_lesson_id
     or new.child_name is distinct from old.child_name
     or new.payer_name is distinct from old.payer_name
     or new.instalment_id is distinct from old.instalment_id
     or new.purpose <> old.purpose
     or new.label <> old.label
     or new.amount_minor <> old.amount_minor
     or new.currency <> old.currency
     or new.plan_months is distinct from old.plan_months
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.expires_at <> old.expires_at
     or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'a payment request''s terms never change; cancel it and make another'
      using errcode = 'check_violation';
  end if;
  -- Attached once, at Assign: a trial's request gains its family (and child).
  if new.family_id is distinct from old.family_id then
    if old.family_id is not null or old.trial_lesson_id is null
       or chat.payer_organization(new.family_id, null) is distinct from old.organization_id then
      raise exception 'a payment request is attached to a family only once, from its trial'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.learner_id is distinct from old.learner_id then
    if old.learner_id is not null or not exists (
      select 1 from chat.learner l where l.id = new.learner_id and l.family_id = new.family_id) then
      raise exception 'a payment request''s child is set once, to a child of its family'
        using errcode = 'check_violation';
    end if;
  end if;
  -- paid_at follows the payments that stand: set when they first cover the
  -- request, cleared only when a void leaves it short again (the service
  -- decides; the payments themselves are the append-only record).
  if old.paid_at is not null and new.paid_at is not null and new.paid_at <> old.paid_at then
    raise exception 'a paid request keeps the moment it was paid' using errcode = 'check_violation';
  end if;
  if old.cancelled_at is not null and (
       new.cancelled_at is distinct from old.cancelled_at
    or new.cancelled_by is distinct from old.cancelled_by
    or new.cancel_reason is distinct from old.cancel_reason) then
    raise exception 'a cancelled request stays cancelled' using errcode = 'check_violation';
  end if;
  if not chat.staff_of(new.cancelled_by, new.organization_id) then
    raise exception 'a payment request is cancelled by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger payment_request_guard
  before insert or update on chat.payment_request
  for each row execute function chat.guard_payment_request();
create trigger payment_request_never_deleted
  before delete on chat.payment_request
  for each row execute function chat.forbid_payment_delete();

create or replace function chat.guard_payment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r chat.payment_request%rowtype;
begin
  if tg_op = 'INSERT' then
    new.organization_id := chat.payer_organization(new.family_id, new.trial_lesson_id);
    if new.organization_id is null then
      raise exception 'a payment needs its family or trial' using errcode = 'foreign_key_violation';
    end if;
    if new.request_id is not null then
      select * into r from chat.payment_request where id = new.request_id;
      if r.family_id is distinct from new.family_id
         or (new.family_id is null and r.trial_lesson_id is distinct from new.trial_lesson_id) then
        raise exception 'a payment pays a request of its own payer' using errcode = 'check_violation';
      end if;
      -- null is allowed: money for an instalment's link that arrives after the
      -- instalment was paid otherwise or voided is still recorded (never lost).
      if r.instalment_id is not null and new.instalment_id is not null and new.instalment_id <> r.instalment_id then
        raise exception 'a payment of an instalment''s request pays that instalment' using errcode = 'check_violation';
      end if;
    end if;
    if new.instalment_id is not null and not exists (
      select 1 from chat.family_instalment i
       where i.id = new.instalment_id and i.family_id = new.family_id and i.voided_at is null) then
      raise exception 'a payment pays an instalment of its family that stands' using errcode = 'check_violation';
    end if;
    if new.learner_id is not null and not exists (
      select 1 from chat.learner l where l.id = new.learner_id and l.family_id = new.family_id) then
      raise exception 'a payment for a child is for a child of that family' using errcode = 'check_violation';
    end if;
    if not chat.staff_of(new.recorded_by, new.organization_id) then
      raise exception 'a payment is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    if new.voided_at is not null then
      raise exception 'a payment is recorded standing; void it afterwards' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.trial_lesson_id is distinct from old.trial_lesson_id
     or new.child_name is distinct from old.child_name
     or new.request_id is distinct from old.request_id
     or new.instalment_id is distinct from old.instalment_id
     or new.method <> old.method
     or new.amount_minor <> old.amount_minor
     or new.currency <> old.currency
     or new.paid_on <> old.paid_on
     or new.recorded_at <> old.recorded_at
     or new.recorded_by is distinct from old.recorded_by
     or new.reference is distinct from old.reference
     or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.receipt_id is distinct from old.receipt_id then
    raise exception 'a recorded payment never changes; void or refund it' using errcode = 'check_violation';
  end if;
  if new.family_id is distinct from old.family_id then
    if old.family_id is not null or old.trial_lesson_id is null
       or chat.payer_organization(new.family_id, null) is distinct from old.organization_id then
      raise exception 'a payment is attached to a family only once, from its trial' using errcode = 'check_violation';
    end if;
  end if;
  if new.learner_id is distinct from old.learner_id then
    if old.learner_id is not null or not exists (
      select 1 from chat.learner l where l.id = new.learner_id and l.family_id = new.family_id) then
      raise exception 'a payment''s child is set once, to a child of its family' using errcode = 'check_violation';
    end if;
  end if;
  if old.voided_at is not null and (
       new.voided_at is distinct from old.voided_at
    or new.voided_by is distinct from old.voided_by
    or new.void_reason is distinct from old.void_reason) then
    raise exception 'a voided payment is final' using errcode = 'check_violation';
  end if;
  if not chat.staff_of(new.voided_by, new.organization_id) then
    raise exception 'a payment is voided by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger payment_guard
  before insert or update on chat.payment
  for each row execute function chat.guard_payment();
create trigger payment_never_deleted
  before delete on chat.payment
  for each row execute function chat.forbid_payment_delete();

create or replace function chat.guard_payment_refund()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  p chat.payment%rowtype;
  v_refunded bigint;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a refund never changes' using errcode = 'check_violation';
  end if;
  -- Serialize refunds of one payment: the sum is checked under the payment's lock.
  select * into p from chat.payment where id = new.payment_id for update;
  if not found then
    raise exception 'a refund needs its payment' using errcode = 'foreign_key_violation';
  end if;
  new.organization_id := p.organization_id;
  if p.voided_at is not null then
    raise exception 'a voided payment is not refunded' using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount_minor), 0) into v_refunded from chat.payment_refund where payment_id = p.id;
  if v_refunded + new.amount_minor > p.amount_minor then
    raise exception 'the refunds of a payment never exceed it' using errcode = 'check_violation';
  end if;
  if not chat.staff_of(new.recorded_by, new.organization_id) then
    raise exception 'a refund is recorded by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger payment_refund_guard
  before insert or update on chat.payment_refund
  for each row execute function chat.guard_payment_refund();
create trigger payment_refund_never_deleted
  before delete on chat.payment_refund
  for each row execute function chat.forbid_payment_delete();

create or replace function chat.guard_invoice()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  p chat.payment%rowtype;
  v_year integer;
  v_next integer;
begin
  if tg_op = 'INSERT' then
    select * into p from chat.payment where id = new.payment_id;
    if not found then
      raise exception 'an invoice needs its payment' using errcode = 'foreign_key_violation';
    end if;
    new.organization_id := p.organization_id;
    new.family_id := p.family_id;
    new.trial_lesson_id := p.trial_lesson_id;
    new.voided_at := null;
    -- The number is the database's: per organization and calendar year, gapless
    -- under concurrency (the counter row is the lock).
    v_year := extract(year from coalesce(new.issued_at, now()))::integer;
    insert into chat.invoice_counter as c (organization_id, year, last_value)
    values (new.organization_id, v_year, 1)
    on conflict (organization_id, year) do update set last_value = c.last_value + 1
    returning last_value into v_next;
    new.number := 'JW-' || v_year || '-' || lpad(v_next::text, 6, '0');
    return new;
  end if;

  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.number <> old.number
     or new.payment_id <> old.payment_id
     or new.trial_lesson_id is distinct from old.trial_lesson_id
     or new.issued_at <> old.issued_at
     or new.snapshot <> old.snapshot then
    raise exception 'an issued invoice never changes' using errcode = 'check_violation';
  end if;
  if new.family_id is distinct from old.family_id
     and (old.family_id is not null or new.family_id is distinct from (select family_id from chat.payment where id = new.payment_id)) then
    raise exception 'an invoice follows its payment''s family' using errcode = 'check_violation';
  end if;
  if old.voided_at is not null and new.voided_at is distinct from old.voided_at then
    raise exception 'a voided invoice is final' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger invoice_guard
  before insert or update on chat.invoice
  for each row execute function chat.guard_invoice();
create trigger invoice_never_deleted
  before delete on chat.invoice
  for each row execute function chat.forbid_payment_delete();

create or replace function chat.guard_payment_receipt()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r chat.payment_request%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into r from chat.payment_request where id = new.request_id;
    if not found or r.family_id is distinct from new.family_id then
      raise exception 'a receipt answers a request of its family' using errcode = 'check_violation';
    end if;
    new.organization_id := r.organization_id;
    if not exists (
      select 1 from chat.contact c where c.id = new.uploaded_by and c.family_id = new.family_id) then
      raise exception 'a receipt is uploaded by a parent of its family' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'pending' then
      raise exception 'a receipt is uploaded pending' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status <> 'pending' then
    raise exception 'a decided receipt is final' using errcode = 'check_violation';
  end if;
  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.family_id <> old.family_id
     or new.request_id <> old.request_id
     or new.amount_minor <> old.amount_minor
     or new.currency <> old.currency
     or new.transferred_on <> old.transferred_on
     or new.note is distinct from old.note
     or new.object_key <> old.object_key
     or new.mime_type <> old.mime_type
     or new.byte_size <> old.byte_size
     or new.uploaded_by <> old.uploaded_by
     or new.uploaded_at <> old.uploaded_at then
    raise exception 'a receipt never changes; it is approved or rejected' using errcode = 'check_violation';
  end if;
  if not chat.staff_of(new.reviewed_by, new.organization_id) then
    raise exception 'a receipt is decided by staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger payment_receipt_guard
  before insert or update on chat.payment_receipt
  for each row execute function chat.guard_payment_receipt();
create trigger payment_receipt_never_deleted
  before delete on chat.payment_receipt
  for each row execute function chat.forbid_payment_delete();

create trigger stripe_event_never_deleted
  before delete on chat.stripe_event
  for each row execute function chat.forbid_payment_delete();

-- ===========================================================================
-- 8. What the parents are told
-- ===========================================================================

insert into chat.notification_template (key, locale, title, body) values
  ('payment_received', 'ar', 'جوّيد',
   'وصلتنا دفعتكم {amount} {currency}. الفاتورة {invoice_number} في المدفوعات.'),
  ('payment_received', 'en', 'Jawwid',
   'We received your payment of {amount} {currency}. Invoice {invoice_number} is in Payments.'),
  ('payment_receipt_rejected', 'ar', 'جوّيد',
   'لم نتمكن من تأكيد إيصال التحويل ({amount} {currency}): {reason}'),
  ('payment_receipt_rejected', 'en', 'Jawwid',
   'We could not confirm your transfer receipt ({amount} {currency}): {reason}')
on conflict (key, locale, version) do nothing;

-- ===========================================================================
-- 9. Fail closed
-- ===========================================================================

alter table chat.payment_request enable row level security;
alter table chat.payment enable row level security;
alter table chat.payment_refund enable row level security;
alter table chat.payment_receipt enable row level security;
alter table chat.invoice_counter enable row level security;
alter table chat.invoice enable row level security;
alter table chat.payment_checkout enable row level security;
alter table chat.stripe_event enable row level security;
revoke all on chat.payment_request, chat.payment, chat.payment_refund, chat.payment_receipt,
  chat.invoice_counter, chat.invoice, chat.payment_checkout, chat.stripe_event
  from public, anon, authenticated, chat_app;

revoke all on function chat.forbid_payment_delete() from public;
revoke all on function chat.payer_organization(uuid, uuid) from public;
revoke all on function chat.staff_of(uuid, uuid) from public;
revoke all on function chat.guard_payment_request() from public;
revoke all on function chat.guard_payment() from public;
revoke all on function chat.guard_payment_refund() from public;
revoke all on function chat.guard_invoice() from public;
revoke all on function chat.guard_payment_receipt() from public;
