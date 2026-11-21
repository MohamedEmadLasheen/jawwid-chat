-- =============================================================================
-- PD-59 · Sales pipeline: leads with protected contact details
--
-- A lead is a chat.trial_prospect (no second lead system). This migration adds
--   1. nullable pipeline columns to chat.trial_prospect: the STORED stages
--      (new_lead, contacted, lost before any trial), the lost reason, when the
--      lead was last contacted, the next follow-up and its note, and the
--      hand-over made without a trial (converted_at / converted_family_id).
--      Trial Booked, Trial Completed, Converted-by-trial and Lost-by-trial are
--      DERIVED on read from the prospect's lessons and chat.trial_outcome and are
--      never stored.
--   2. chat.sales_lead_contact -- a CONFINED table (G-07, like
--      chat.trial_subscription, 20261021100000): the prospective parent's name,
--      phone, WhatsApp number and e-mail, kept apart from every parent and contact
--      table until conversion. THE CONTACT COLUMNS ARE DELIBERATE (owner decision
--      2026-11-21, PD-59). No request role has a grant; row-level security is on
--      with no policy; only src/sales-pipeline names it
--      (sales-pipeline-confinement.spec.ts fails the build otherwise).
--
-- Additive and backwards compatible: every new column is nullable, no existing
-- row, constraint, trigger or function changes. chat.guard_trial_prospect
-- compares named columns on UPDATE, so the new ones are writable by the API
-- exactly as it writes any column the guard does not name.
-- Idempotent: applying this file again changes nothing.
-- Rollback: db/rollback/20261121100000_chat_pd059_sales_pipeline.down.sql
-- =============================================================================

alter table chat.trial_prospect
  add column if not exists pipeline_stage      text,
  add column if not exists lost_reason         text,
  add column if not exists last_contacted_at   timestamptz,
  add column if not exists next_follow_up_on   date,
  add column if not exists follow_up_note      text,
  add column if not exists converted_at        timestamptz,
  add column if not exists converted_family_id uuid references chat.family (id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_pipeline_stage_known') then
    alter table chat.trial_prospect add constraint trial_prospect_pipeline_stage_known
      check (pipeline_stage is null or pipeline_stage in ('new_lead', 'contacted', 'lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_lost_reason_coherent') then
    alter table chat.trial_prospect add constraint trial_prospect_lost_reason_coherent
      check (coalesce(pipeline_stage = 'lost', false) = (lost_reason is not null)
             and (lost_reason is null or lost_reason in ('price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_follow_up_note_length') then
    alter table chat.trial_prospect add constraint trial_prospect_follow_up_note_length
      check (follow_up_note is null or length(btrim(follow_up_note)) between 1 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trial_prospect_conversion_coherent') then
    alter table chat.trial_prospect add constraint trial_prospect_conversion_coherent
      check ((converted_at is null) = (converted_family_id is null));
  end if;
end
$$;

create index if not exists trial_prospect_follow_up_idx
  on chat.trial_prospect (organization_id, next_follow_up_on)
  where next_follow_up_on is not null;

-- ---------------------------------------------------------------------------
-- The confined contact
-- ---------------------------------------------------------------------------

create table if not exists chat.sales_lead_contact (
  prospect_id      uuid primary key references chat.trial_prospect (id),
  organization_id  uuid not null references chat.organization (id),
  parent_name      text not null check (length(btrim(parent_name)) between 1 and 120),
  phone            text constraint sales_lead_contact_phone_is_confined check (phone is null or length(btrim(phone)) between 5 and 32),
  whatsapp         text constraint sales_lead_contact_whatsapp_is_confined check (whatsapp is null or length(btrim(whatsapp)) between 5 and 32),
  email            text check (email is null or (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$')),
  -- The number's country (ISO 3166-1 alpha-2), to read a local number when the lead is converted.
  country_code     text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  created_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references chat.staff (id),
  updated_at       timestamptz,
  -- A lead with no way to reach the parent is not a lead.
  constraint sales_lead_contact_has_channel check (num_nonnulls(phone, whatsapp, email) > 0)
);

comment on table chat.sales_lead_contact is
  'PD-59: a prospective parent''s contact, kept apart from every parent record until conversion. CONFINED: no request-role grant; only src/sales-pipeline reads or writes it. Never in a message, card, event, search, log or export. Deleted when the lead is linked to an existing family.';

create or replace function chat.guard_sales_lead_contact()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- Only after the hand-over: the family's own record holds the contact now.
    if not exists (select 1 from chat.trial_prospect p where p.id = old.prospect_id and p.converted_at is not null) then
      raise exception 'a lead''s contact is deleted only when the lead is converted' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if not exists (select 1 from chat.trial_prospect p where p.id = new.prospect_id and p.organization_id = new.organization_id) then
    raise exception 'a lead''s contact belongs to its prospect''s organization' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a lead''s contact is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    new.created_at := now();
    new.updated_at := null;
    new.updated_by := null;
  else
    if (new.prospect_id, new.organization_id, new.created_by, new.created_at)
       is distinct from (old.prospect_id, old.organization_id, old.created_by, old.created_at) then
      raise exception 'a lead''s contact keeps its prospect, who recorded it and when' using errcode = 'check_violation';
    end if;
    if new.updated_by is null or not exists (
      select 1 from chat.staff s where s.id = new.updated_by and s.organization_id = new.organization_id
    ) then
      raise exception 'a change to a lead''s contact names who made it' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists sales_lead_contact_is_coherent on chat.sales_lead_contact;
create trigger sales_lead_contact_is_coherent
  before insert or update or delete on chat.sales_lead_contact
  for each row execute function chat.guard_sales_lead_contact();

-- ---------------------------------------------------------------------------
-- Access: only the API's service
-- ---------------------------------------------------------------------------

alter table chat.sales_lead_contact enable row level security;
revoke all on chat.sales_lead_contact from public, anon, authenticated, chat_app;
revoke all on function chat.guard_sales_lead_contact() from public;
