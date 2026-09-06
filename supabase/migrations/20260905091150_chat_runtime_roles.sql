-- Jawwid Chat -- create the roles the RLS policies grant to.
--
-- 20260905091200_chat_rls.sql grants to `authenticated`, `anon` and
-- `service_role`. Those roles are created for you by Supabase; they do NOT
-- exist on a stock PostgreSQL. Since the product owner's decision on
-- 2026-09-05 made Jawwid Chat the owner of its own database, applying the
-- migration series to a clean cluster failed at that point with:
--
--     ERROR:  role "authenticated" does not exist
--
-- The database must be able to build itself from an empty stock PostgreSQL, so
-- the roles are created here rather than assumed. Idempotent, and deliberately
-- ordered immediately before the migration that first references them.
--
-- These are NOLOGIN group roles. Nothing authenticates as them directly; the
-- API connects as its own login role and, where it adopts a caller's rights,
-- does so with SET LOCAL ROLE. Creating them does not grant anything by itself
-- -- 20260905091200 does that.
--
-- NOTE FOR AI #1: the RLS design assumes a PostgREST-style deployment in which
-- clients connect to Postgres directly and their JWT selects the role. In the
-- architecture actually being built (client -> NestJS -> Postgres) the API
-- connects as one role, so these policies constrain nothing unless the API sets
-- the role and the claims per request. That is a real design decision and it is
-- still open; this migration only makes the series applicable.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches Supabase's definition: the trusted server-side role bypasses RLS.
    create role service_role nologin bypassrls;
  end if;
end
$$;
