-- PD-27 completion (2026-11-07): the Stripe lifecycle -- references, failed
-- attempts, deferred refunds, reconciliation. docs/admin/pd027-stripe-lifecycle.md.
--
-- ADDITIVE ONLY. Every new column is nullable or has a default; no existing
-- column, constraint, row or index is changed or removed. chat.guard_payment is
-- replaced by the same function plus the new columns in its "never changes" list
-- (and a card-only check on insert): every rule it enforced before still holds.
--
--   chat.stripe_customer    one Stripe Customer per family and mode, created by
--                           Chat with metadata only (no name, no e-mail).
--   chat.payment            + the Stripe customer and charge, and the payment
--                           method (type, card brand, last 4, wallet). Card only,
--                           written at insert, never changed. Brand and last 4 are
--                           not cardholder data; no card number or CVC ever
--                           reaches Chat (Stripe-hosted Checkout).
--   chat.payment_checkout   + the customer and payment intent Stripe used, and
--                           declined attempts (count, Stripe's decline code, when).
--   chat.stripe_event       + the object the event was about, its payment intent,
--                           and Stripe's own time: the audit trail, and how a
--                           refund that arrived before its payment is found again.
--
-- Down: db/rollback/20261107120000_chat_pd027_stripe_lifecycle.down.sql

set local lock_timeout = '5s';

-- ===========================================================================
-- 1. Stripe Customers
-- ===========================================================================

create table chat.stripe_customer (
  family_id          uuid not null references chat.family (id) on delete restrict,
  -- A test-mode customer does not exist in live mode (and the reverse).
  livemode           boolean not null,
  organization_id    uuid not null references chat.organization (id),
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  created_at         timestamptz not null default now(),
  primary key (family_id, livemode)
);

comment on table chat.stripe_customer is
  'PD-27: the Stripe Customer Chat created for a family (metadata only). Never changed or deleted.';

create or replace function chat.guard_stripe_customer()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is distinct from (select f.organization_id from chat.family f where f.id = new.family_id) then
      raise exception 'a Stripe customer belongs to its family''s organization' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  raise exception 'a Stripe customer mapping never changes' using errcode = 'check_violation';
end
$$;

create trigger stripe_customer_guard
  before insert or update on chat.stripe_customer
  for each row execute function chat.guard_stripe_customer();
create trigger stripe_customer_never_deleted
  before delete on chat.stripe_customer
  for each row execute function chat.forbid_payment_delete();

alter table chat.stripe_customer enable row level security;
revoke all on chat.stripe_customer from public, anon, authenticated, chat_app;
revoke all on function chat.guard_stripe_customer() from public;

-- ===========================================================================
-- 2. A payment's Stripe references and payment method
-- ===========================================================================

alter table chat.payment
  add column stripe_customer_id  text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  add column stripe_charge_id    text unique check (stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9]{1,250}$'),
  add column payment_method_type text check (payment_method_type ~ '^[a-z_]{1,40}$'),
  add column card_brand          text check (card_brand ~ '^[a-z_]{1,30}$'),
  add column card_last4          text check (card_last4 ~ '^[0-9]{4}$'),
  add column card_wallet         text check (card_wallet ~ '^[a-z_]{1,30}$');

comment on column chat.payment.card_last4 is
  'PD-27: the last four digits Stripe reports. Never a card number; Chat never sees one.';

create index payment_card_recorded_idx on chat.payment (organization_id, recorded_at desc);

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
    -- 20261107120000: Stripe's references and the payment method are a card payment's only.
    if new.method <> 'card' and (
         new.stripe_customer_id is not null or new.stripe_charge_id is not null
      or new.payment_method_type is not null or new.card_brand is not null
      or new.card_last4 is not null or new.card_wallet is not null) then
      raise exception 'only a card payment carries Stripe references' using errcode = 'check_violation';
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
     or new.receipt_id is distinct from old.receipt_id
     -- 20261107120000
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_charge_id is distinct from old.stripe_charge_id
     or new.payment_method_type is distinct from old.payment_method_type
     or new.card_brand is distinct from old.card_brand
     or new.card_last4 is distinct from old.card_last4
     or new.card_wallet is distinct from old.card_wallet then
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

revoke all on function chat.guard_payment() from public;

-- ===========================================================================
-- 3. Card attempts: the customer, the intent, and declines
-- ===========================================================================

alter table chat.payment_checkout
  add column stripe_customer_id       text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  add column stripe_payment_intent_id text check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]{1,250}$'),
  add column failure_count            integer not null default 0 check (failure_count >= 0),
  -- Stripe's decline_code or error code (e.g. insufficient_funds). Never its message, never card data.
  add column failure_code             text check (failure_code ~ '^[a-z0-9_]{1,64}$'),
  add column last_failed_at           timestamptz,
  add constraint payment_checkout_failure_is_whole check ((failure_count = 0) = (last_failed_at is null));

create index payment_checkout_open_idx on chat.payment_checkout (created_at) where status = 'open';
create index payment_checkout_org_idx on chat.payment_checkout (organization_id, created_at desc);
create index payment_checkout_intent_idx on chat.payment_checkout (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- ===========================================================================
-- 4. Webhook audit: what each event was about
-- ===========================================================================

alter table chat.stripe_event
  -- The academy the event concerns, when Chat knows it (a checkout or payment of
  -- its own); null for an event about something Chat did not open.
  add column organization_id   uuid references chat.organization (id),
  add column object_id         text check (length(object_id) between 1 and 255),
  add column payment_intent_id text check (payment_intent_id ~ '^pi_[A-Za-z0-9]{1,250}$'),
  add column stripe_created_at timestamptz;

create index stripe_event_intent_idx on chat.stripe_event (payment_intent_id) where payment_intent_id is not null;
create index stripe_event_received_idx on chat.stripe_event (organization_id, received_at desc);
create index stripe_event_deferred_idx on chat.stripe_event (received_at) where outcome = 'refund_deferred';
