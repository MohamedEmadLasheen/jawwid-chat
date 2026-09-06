-- Jawwid Chat -- Chat-owned actor identity.
--
-- Jawwid Chat runs on its own PostgreSQL database. It has no `auth` schema, no
-- Supabase identity, and no foreign key into any other product's tables. Every
-- actor -- staff and family contact alike -- resolves through chat.account.
--
-- chat.account deliberately holds NO contact channel: no phone, no email, no
-- messaging handle. `subject` is the opaque identifier the identity provider
-- puts in the token's `sub` claim; credentials and contact details live there,
-- not here. Adding an email column to this table would be the ordinary way to
-- break phone/contact privacy, so it is guarded by a test
-- (db/tests/invariants.sql) and must not be added without a privacy review.

create table chat.account (
  id         uuid primary key default gen_random_uuid(),
  subject    text not null unique,
  kind       text not null check (kind in ('staff', 'family')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table chat.account is
  'The only identity table. `subject` is an opaque token subject from Jawwid '
  'Chat''s identity provider -- never a phone number, an email address or any '
  'other contact channel.';

create trigger account_set_updated_at
  before update on chat.account
  for each row execute function chat.set_updated_at();

-- Who is calling ------------------------------------------------------------
-- Two transports are supported, because Jawwid Chat is reached both ways:
--
--   * an API service opens a pooled connection and sets chat.actor_subject per
--     request;
--   * a gateway that forwards a verified JWT puts the claims in
--     request.jwt.claims.
--
-- Neither is trusted to be present. A caller with neither is anonymous, and
-- every policy denies an anonymous caller.

create or replace function chat.current_subject()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('chat.actor_subject', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )
$$;

create or replace function chat.current_account_id()
returns uuid
language sql
stable
as $$
  select a.id
  from chat.account a
  where a.subject = chat.current_subject()
    and a.is_active
$$;
