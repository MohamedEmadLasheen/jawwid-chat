-- INTEGRATION TEST SCAFFOLDING — never applied to a real database.
--
-- Stands in for the Jawwid Core tables that 20260905090900_chat_core_integration
-- reads through its chat.core_* views.
--
-- PROVENANCE (this matters):
-- Derived ONLY from the columns that Jawwid Chat's own migration selects. It is
-- NOT copied from second-school's migrations. docs/release/database-decision.md
-- DB-4 prohibits citing another product's schema as this repository's contract,
-- and the pre-existing db/test/00_core_shim.sql does exactly that.
--
-- STATUS: scaffolding for a KNOWN-VIOLATING state.
-- DB-2 replaces the chat.core_* SQL views with the approved integration
-- boundary (API / webhooks). When that lands, this file and the migration it
-- supports both disappear. Its existence is not an endorsement.
--
-- Why it is applied at all: 20260905091200_chat_rls depends on chat.sync_state,
-- which 090900 creates, so the Core-coupled migration cannot simply be skipped.
-- That coupling is itself a finding (defect log JC-009).

create schema if not exists public;

create table if not exists public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text,
  preferred_language text,
  role               text,
  created_at         timestamptz not null default now()
);

create table if not exists public.children (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references public.profiles (id) on delete cascade,
  name       text,
  age_band   text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  parent_id           uuid references public.profiles (id) on delete cascade,
  status              text,
  current_period_end  timestamptz,
  renewal_date        timestamptz,
  is_current          boolean not null default true,
  created_at          timestamptz not null default now()
);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions (id) on delete cascade,
  status          text,
  created_at      timestamptz not null default now()
);
