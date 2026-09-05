-- TEST FIXTURE ONLY -- never applied to a real database.
--
-- Stands in for the parts of Jawwid Core (the `auth` and `public` schemas) that
-- Jawwid Chat's integration boundary reads. Column shapes are copied from
-- second-school's live migrations so the boundary views are exercised against
-- the real contract:
--   public.profiles       20260723180000_profiles.sql
--   public.children       20260723180100_children.sql
--   public.subscriptions  20260803094000_pricing_subscriptions_billing.sql
--   public.payments       20260723180500_subscriptions_and_billing.sql
--
-- If Core changes any of these, this fixture and chat.core_* must change too --
-- that is the point of keeping the boundary narrow.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase's auth.uid(). Tests impersonate a user with
--   select set_config('request.jwt.claim.sub', '<uuid>', true);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  preferred_language text not null default 'ar'
                       check (preferred_language in ('ar', 'en')),
  role               text not null default 'parent'
                       check (role in ('parent', 'content_manager')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.children (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  age_band   int not null check (age_band between 6 and 15),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  parent_id          uuid not null references public.profiles (id) on delete cascade,
  status             text not null check (status in (
                       'trialing', 'free', 'active', 'grace_period', 'expired',
                       'cancelled', 'paused', 'pending_payment', 'failed_payment',
                       'refunded', 'lifetime')),
  start_date         timestamptz not null default now(),
  current_period_end timestamptz,
  renewal_date       timestamptz,
  cancel_at_period_end boolean not null default false,
  auto_renew         boolean not null default true,
  is_current         boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  amount          numeric(10, 2) not null,
  currency        text not null default 'AED',
  status          text not null check (status in ('succeeded', 'failed', 'refunded')),
  created_at      timestamptz not null default now()
);
