-- TEST FIXTURE ONLY.
--
-- Jawwid Chat runs on plain PostgreSQL and owns its whole schema. There is no
-- `auth` schema, no Supabase image, and no stand-in for another product's
-- tables: this file creates the two database roles the application connects as,
-- and nothing else.
--
-- The absence of a Jawwid Core fixture here is the point. Core-sourced data
-- reaches Jawwid Chat as integration-boundary payloads, and those payloads are
-- fixtures in db/tests/integration.sql, written against the documented contract
-- rather than against any other repository's migrations.

do $$
begin
  -- The role an authenticated caller is switched to. RLS policies target it.
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  -- The role trusted server-side workers use. Bypasses RLS by design.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;
