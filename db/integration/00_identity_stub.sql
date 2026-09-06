-- INTEGRATION TEST SCAFFOLDING — never applied to a real database.
--
-- WHY THIS FILE EXISTS, AND WHY IT MUST DIE
-- -----------------------------------------
-- docs/release/database-decision.md fixes the architecture: Jawwid Chat owns
-- its own PostgreSQL database and does not depend on Jawwid Core's database or
-- on Supabase's `auth` schema.
--
-- The migrations do not fully honour that yet. The entire remaining coupling is
-- ONE function call:
--
--   20260905090700_chat_ownership_invariants.sql
--     chat.current_staff_id() -> ... where s.auth_user_id = auth.uid()
--
-- `chat.staff.auth_user_id` is a plain uuid with NO foreign key, so nothing
-- else is bound to Supabase. This stub therefore supplies `auth.uid()` alone.
--
-- It is scaffolding for a KNOWN-VIOLATING state (database-decision.md DB-1) and
-- must NOT be read as an endorsement of the Core-coupled design. When DB-1
-- lands and chat.current_staff_id() reads a Chat-owned session, DELETE THIS
-- FILE and the line that applies it.
--
-- Deliberately NOT provided here: auth.users (no FK needs it), and any
-- public.* Core table (the current migrations reference none — Core data must
-- arrive through the integration boundary, not SQL).

create schema if not exists auth;

-- Supabase's auth.uid(). Tests impersonate an actor with:
--   select set_config('request.jwt.claim.sub', '<uuid>', true);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

comment on function auth.uid() is
  'INTEGRATION SCAFFOLDING ONLY. Removed by database-decision.md DB-1.';

-- ---------------------------------------------------------------------------
-- Supabase-convention roles required by 20260905091200_chat_rls.
--
-- These are ordinary local PostgreSQL roles. Creating them couples the test
-- database to a NAMING convention, not to Jawwid Core's database, so this part
-- is compatible with the standalone decision. If Chat's deployment target is
-- not Supabase, the RLS migration's role names are the thing to revisit --
-- flagged for AI #1, not resolved here.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;
