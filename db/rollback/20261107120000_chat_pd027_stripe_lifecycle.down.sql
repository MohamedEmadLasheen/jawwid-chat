-- Roll back 20261107120000_chat_pd027_stripe_lifecycle.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261107120000_chat_pd027_stripe_lifecycle.down.sql
--
-- REFUSES to run while any payment, attempt or event holds the new data: those
-- are records of real money (Stripe references, card brand and last 4, declines)
-- and dropping them loses them. Export first, e.g.
--   \copy (select id, stripe_customer_id, stripe_charge_id, payment_method_type, card_brand, card_last4, card_wallet from chat.payment where method = 'card') to 'payment-stripe-refs.csv' csv header
--   \copy chat.stripe_customer to 'stripe-customer.csv' csv header
-- then set chat.allow_pd027_lifecycle_rollback for this transaction:
--   select set_config('chat.allow_pd027_lifecycle_rollback', 'on', true);
-- The API code of this release must be rolled back FIRST (it writes these columns).

set local lock_timeout = '5s';

do $$
begin
  if coalesce(current_setting('chat.allow_pd027_lifecycle_rollback', true), '') <> 'on' and (
       exists (select 1 from chat.stripe_customer)
    or exists (select 1 from chat.payment where stripe_charge_id is not null or card_last4 is not null or stripe_customer_id is not null)
    or exists (select 1 from chat.payment_checkout where failure_count > 0 or stripe_payment_intent_id is not null)) then
    raise exception 'the Stripe lifecycle columns hold data; export it and set chat.allow_pd027_lifecycle_rollback first';
  end if;
end $$;

drop index if exists chat.stripe_event_deferred_idx;
drop index if exists chat.stripe_event_received_idx;
drop index if exists chat.stripe_event_intent_idx;
alter table chat.stripe_event
  drop column if exists stripe_created_at,
  drop column if exists payment_intent_id,
  drop column if exists object_id,
  drop column if exists organization_id;

drop index if exists chat.payment_checkout_intent_idx;
drop index if exists chat.payment_checkout_org_idx;
drop index if exists chat.payment_checkout_open_idx;
alter table chat.payment_checkout
  drop constraint if exists payment_checkout_failure_is_whole,
  drop column if exists last_failed_at,
  drop column if exists failure_code,
  drop column if exists failure_count,
  drop column if exists stripe_payment_intent_id,
  drop column if exists stripe_customer_id;

-- chat.guard_payment back to 20261022170000's body (copied verbatim), BEFORE the
-- columns go, since this release's body names them.
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

drop index if exists chat.payment_card_recorded_idx;
alter table chat.payment
  drop column if exists card_wallet,
  drop column if exists card_last4,
  drop column if exists card_brand,
  drop column if exists payment_method_type,
  drop column if exists stripe_charge_id,
  drop column if exists stripe_customer_id;

drop trigger if exists stripe_customer_never_deleted on chat.stripe_customer;
drop table if exists chat.stripe_customer;
drop function if exists chat.guard_stripe_customer();

delete from chat.schema_migrations where version = '20261107120000_chat_pd027_stripe_lifecycle';
