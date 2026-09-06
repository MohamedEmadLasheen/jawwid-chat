-- Jawwid Chat -- the database roles the RLS policies are written against.
--
-- WHY THIS EXISTS
-- ---------------
-- 20260905091200_chat_rls grants to, and writes policies `to`, three roles:
-- `authenticated`, `service_role` and `anon`. On a Supabase-hosted database
-- those roles are supplied by the platform image. Jawwid Chat, per
-- docs/release/database-decision.md, owns its own PostgreSQL database and must
-- build from an empty one -- and on plain PostgreSQL those roles do not exist,
-- so 091200 failed with:
--
--   ERROR:  role "authenticated" does not exist
--
-- That failure was red-team finding RT-023: the migration chain could not
-- recreate the database from zero, which meant no environment provisioned from
-- this repository was guaranteed to have the BR-1 triggers, the append-only
-- triggers, or these policies.
--
-- This migration creates the roles when they are absent and does nothing when
-- they are already present, so the same chain applies to a bare `postgres:17`
-- and to a Supabase image without divergence. It deliberately does NOT change
-- the policy model, the role names, or who is granted what -- that is AI #1's
-- design and is untouched here.
--
-- These are NOLOGIN roles. Nothing can connect as them; the application
-- connects as its own user and assumes the role, which is the same shape the
-- hosted platform uses.

do $$
begin
  -- Unauthenticated callers. Granted nothing by 091200; named so a policy can
  -- state explicitly that anonymous access is denied rather than implied.
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  -- Any caller carrying a verified identity: staff and family contacts alike.
  -- Every policy in 091200 narrows what this role can see.
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  -- Trusted backend workers (outbox drain, reminders, migrations). Bypasses RLS
  -- because it acts for the system, not for a user.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

comment on schema chat is
  'Jawwid Chat: Customer Success operating system. Owns its own PostgreSQL '
  'database. Reads Jawwid Core only through the chat.core_event integration '
  'boundary -- never across a database link.';
