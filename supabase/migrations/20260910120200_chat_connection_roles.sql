-- Jawwid Chat -- the two connection roles the application will use.
-- PR-A of the authentication rollout (`docs/security/RLS-STRATEGY.md` §3,
-- CANONICAL).
--
-- WHY
-- ---
-- RLS is defined but inert. The API connects with one login role from
-- DATABASE_URL which is the table owner in every environment provisioned so
-- far, and a table owner bypasses RLS unless it is forced. So the 42 policies
-- constrain nothing on the request path, and `AuthorizationService` is the only
-- live boundary.
--
-- RLS-STRATEGY §3 fixes that with two roles rather than with FORCE ROW LEVEL
-- SECURITY: the API stops being an owner, instead of the owner being made to
-- obey its own policies. This migration creates the roles and their grants.
--
-- IT DOES NOT ACTIVATE RLS. DATABASE_URL still points at the existing role,
-- nothing calls set_config('chat.actor_subject', ...), and the messaging tables
-- still have no per-actor policies. Switching the connection over is a later,
-- separately reviewable step, because doing it before those policies exist
-- would deny every read.
--
-- 20260905091150 created the three NOLOGIN policy targets (anon, authenticated,
-- service_role). These two are the LOGIN roles that adopt them.

do $roles$
begin
  -- The API request path. NOBYPASSRLS is the whole point: this role must be
  -- subject to the policies, which an owner or a superuser would not be.
  if not exists (select 1 from pg_roles where rolname = 'chat_app') then
    create role chat_app login inherit nobypassrls;
  end if;

  -- Workers, migrations, integration ingestion and backups. Acts for the
  -- system, not for a user, so it bypasses RLS; every action it takes is
  -- audited by the event that caused it.
  --
  -- BYPASSRLS is a role ATTRIBUTE and attributes are not inherited, so
  -- membership of service_role would not confer it. It is set here directly.
  if not exists (select 1 from pg_roles where rolname = 'chat_service') then
    create role chat_service login inherit bypassrls;
  end if;
end
$roles$;

-- Re-assert the attributes even when the roles already existed, so a cluster
-- where someone created chat_app by hand cannot end up with BYPASSRLS.
alter role chat_app     nobypassrls inherit login;
alter role chat_service bypassrls   inherit login;

-- Membership. chat_app has INHERIT, so it acquires everything granted to
-- `authenticated` without SET ROLE, and pg_has_role(chat_app,'authenticated',
-- 'USAGE') becomes true -- which is what makes the policies written
-- `to authenticated` apply to it.
grant authenticated to chat_app;
grant service_role  to chat_service;

comment on role chat_app is
  'API request path. NOBYPASSRLS. Not an owner of any object: it sees only what '
  'the policies allow, once DATABASE_URL is repointed in the RLS activation PR.';

comment on role chat_service is
  'Workers, migrations and ingestion. BYPASSRLS because it acts for the system.';

-- No password is set here. A password in a migration would be committed to the
-- repository; the deployment sets it out of band, which is why these roles
-- cannot connect until it does.
