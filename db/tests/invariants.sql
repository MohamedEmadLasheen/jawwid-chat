-- Jawwid Chat -- identity invariants.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/invariants.sql
--
-- `20260905090050_chat_identity.sql` claims this file guards chat.account
-- against acquiring a contact channel:
--
--   "Adding an email column to this table would be the ordinary way to break
--    phone/contact privacy, so it is guarded by a test (db/tests/invariants.sql)
--    and must not be added without a privacy review."
--
-- The file did not exist. The control was cited in a migration comment and
-- nowhere else, so nothing stopped the column being added. This is that guard,
-- extended to the rest of the identity foundation PR-A introduces.
--
-- Like schema_acceptance.sql it asserts SHAPE, not data: no fixture is created
-- and nothing is written.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.want_column(p_table text, p_column text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'chat' and table_name = p_table and column_name = p_column
  ) then
    raise exception 'MISSING COLUMN chat.%.%', p_table, p_column;
  end if;
  raise notice 'column   chat.%.%', p_table, p_column;
end; $$;

create or replace function pg_temp.want_constraint(p_table text, p_constraint text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = p_constraint
       and conrelid = ('chat.' || quote_ident(p_table))::regclass
  ) then
    raise exception 'MISSING CONSTRAINT %s on chat.%', p_constraint, p_table;
  end if;
  raise notice 'constr   chat.% %', p_table, p_constraint;
end; $$;

\echo ''
\echo '=== BR-2: no identity table may carry a contact channel ==='
-- The privacy guarantee this product rests on is that a phone number cannot
-- leak because no code path can obtain one. That holds only while no column
-- holds one. Checked by NAME across every identity table, so a future migration
-- adding `email` to any of them fails here rather than in production.
do $$
declare
  v_hit text;
begin
  select string_agg(table_name || '.' || column_name, ', ')
    into v_hit
    from information_schema.columns
   where table_schema = 'chat'
     and table_name in ('account', 'account_credential', 'session', 'device', 'teacher')
     and (
          column_name ~* '(phone|msisdn|mobile|email|e_mail|address|whatsapp|telegram)'
     );

  if v_hit is not null then
    raise exception
      'BR-2 VIOLATION -- contact channel on an identity table: %. chat.account and '
      'its satellites hold an opaque subject only; credentials and contact '
      'details belong to the identity provider, not here.', v_hit;
  end if;
  raise notice 'privacy  no contact-channel column on account, credential, session, device, teacher';
end $$;

\echo ''
\echo '=== identity: chat.account lifecycle ==='
select pg_temp.want_column('account', 'subject');
select pg_temp.want_column('account', 'kind');
select pg_temp.want_column('account', 'status');
select pg_temp.want_column('account', 'deactivated_at');
select pg_temp.want_column('account', 'deactivated_by');
select pg_temp.want_column('account', 'last_login_at');
select pg_temp.want_column('account', 'organization_id');
select pg_temp.want_constraint('account', 'account_kind_check');
select pg_temp.want_constraint('account', 'account_status_check');
select pg_temp.want_constraint('account', 'account_status_matches_is_active');
select pg_temp.want_constraint('account', 'account_deactivated_by_fk');

-- kind must admit exactly the three principals, and no more.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'account_kind_check'
     and conrelid = 'chat.account'::regclass;

  if v_def !~ 'teacher' then
    raise exception 'account.kind does not admit teacher: %', v_def;
  end if;
  raise notice 'lifecycle account.kind admits staff, family and teacher';
end $$;

-- The two activity flags must be unable to disagree: chat.current_account_id()
-- filters on is_active, so a suspended account whose is_active stayed true
-- would keep passing every RLS check.
do $$
begin
  begin
    insert into chat.account (subject, kind, is_active, status)
    values ('invariants-probe-' || gen_random_uuid()::text, 'staff', true, 'suspended');
    raise exception 'account_status_matches_is_active did NOT reject is_active=true with status=suspended';
  exception
    when check_violation then
      raise notice 'lifecycle is_active cannot disagree with status';
  end;
  rollback;
end $$;

\echo ''
\echo '=== identity: teacher is first class ==='
select pg_temp.want_column('teacher', 'account_id');
select pg_temp.want_column('teacher', 'name');
select pg_temp.want_column('teacher', 'is_active');
select pg_temp.want_column('teacher', 'left_at');
select pg_temp.want_column('teacher', 'core_teacher_id');
select pg_temp.want_column('teacher', 'synced_at');
select pg_temp.want_column('teacher', 'organization_id');

-- One teacher per account, and the link is one-directional: teacher -> account.
-- chat.account must NOT carry a teacher_id (the archived D-6 stopgap), or
-- teacher identity would have two homes that can disagree.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'chat' and table_name = 'account' and column_name = 'teacher_id'
  ) then
    raise exception
      'chat.account.teacher_id is present -- IDENTITY-MODEL §7 requires teacher '
      'resolution through chat.teacher, not account.teacher_id';
  end if;
  raise notice 'teacher  account carries no teacher_id; the link is teacher.account_id';
end $$;

\echo ''
\echo '=== identity: learner -> teacher is a real relationship ==='
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'learner_teacher_fk'
     and conrelid = 'chat.learner'::regclass;

  if v_def is null then
    raise exception 'MISSING learner_teacher_fk -- learner.teacher_id is still a bare uuid';
  end if;
  if v_def !~ 'REFERENCES chat\.teacher' then
    raise exception 'learner_teacher_fk does not reference chat.teacher: %', v_def;
  end if;
  raise notice 'teacher  learner.teacher_id references chat.teacher';
end $$;

-- No orphans. The foreign key makes this impossible going forward; this proves
-- the backfill left nothing behind.
do $$
declare v_orphans bigint;
begin
  select count(*) into v_orphans
    from chat.learner l
   where l.teacher_id is not null
     and not exists (select 1 from chat.teacher t where t.id = l.teacher_id);

  if v_orphans > 0 then
    raise exception 'ORPHANS: % learner rows point at a missing teacher', v_orphans;
  end if;
  raise notice 'teacher  no orphan learner.teacher_id values';
end $$;

\echo ''
\echo '=== authentication storage ==='
select pg_temp.want_column('account_credential', 'password_hash');
select pg_temp.want_column('account_credential', 'failed_attempts');
select pg_temp.want_column('account_credential', 'locked_until');
select pg_temp.want_column('session', 'refresh_token_hash');
select pg_temp.want_column('session', 'device_id');
select pg_temp.want_column('session', 'revoked_at');
select pg_temp.want_column('session', 'revoked_by');
select pg_temp.want_column('session', 'ip_hash');
select pg_temp.want_column('session', 'organization_id');
select pg_temp.want_column('device', 'account_id');
select pg_temp.want_column('device', 'platform');
select pg_temp.want_constraint('session', 'session_expiry_after_creation');

-- The refresh token is stored hashed and uniquely: UNIQUE is what makes
-- rotation reuse detectable, because a replayed token cannot be inserted twice.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'chat' and tablename = 'session'
       and indexdef ~* 'UNIQUE' and indexdef ~* 'refresh_token_hash'
  ) then
    raise exception 'session.refresh_token_hash is not UNIQUE -- reuse detection depends on it';
  end if;
  raise notice 'auth     session.refresh_token_hash is unique (reuse detectable)';
end $$;

-- No column may hold a token or password in the clear.
do $$
declare v_hit text;
begin
  select string_agg(table_name || '.' || column_name, ', ')
    into v_hit
    from information_schema.columns
   where table_schema = 'chat'
     and table_name in ('session', 'account_credential')
     and column_name in ('refresh_token', 'access_token', 'token', 'password', 'secret', 'ip', 'ip_address');

  if v_hit is not null then
    raise exception 'PLAINTEXT CREDENTIAL COLUMN: % -- tokens are stored hashed, IPs hashed', v_hit;
  end if;
  raise notice 'auth     no plaintext token, password or raw IP column';
end $$;

\echo ''
\echo '=== row level security on the identity tables ==='
do $$
declare
  t text;
begin
  foreach t in array array['account_credential', 'session', 'device', 'teacher'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'chat' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'RLS NOT ENABLED on chat.%', t;
    end if;
  end loop;
  raise notice 'rls      enabled on credential, session, device, teacher';
end $$;

-- Credentials must be unreachable by the logged-in role by construction: RLS on
-- and no policy at all means `authenticated` matches nothing.
do $$
declare v_policies int;
begin
  select count(*) into v_policies
    from pg_policies where schemaname = 'chat' and tablename = 'account_credential';

  if v_policies > 0 then
    raise exception
      'chat.account_credential has % polic(y/ies) -- RLS-STRATEGY §4 requires none, '
      'so that password material is unreadable by construction', v_policies;
  end if;
  raise notice 'rls      account_credential has no policy: unreadable by authenticated';
end $$;

\echo ''
\echo '=== connection roles ==='
do $$
declare
  v_app     pg_roles%rowtype;
  v_service pg_roles%rowtype;
begin
  select * into v_app     from pg_roles where rolname = 'chat_app';
  select * into v_service from pg_roles where rolname = 'chat_service';

  if v_app.rolname is null then
    raise exception 'MISSING ROLE chat_app';
  end if;
  if v_service.rolname is null then
    raise exception 'MISSING ROLE chat_service';
  end if;

  -- The single most important property in this file. If chat_app can bypass
  -- RLS then engaging RLS later changes nothing at all, and the second layer
  -- the strategy is built on does not exist.
  if v_app.rolbypassrls then
    raise exception
      'chat_app HAS BYPASSRLS -- the API request role must be subject to every policy';
  end if;
  if not v_app.rolcanlogin then
    raise exception 'chat_app cannot log in';
  end if;
  if not v_app.rolinherit then
    raise exception
      'chat_app does not inherit -- it would not acquire the grants made to '
      '`authenticated`, and policies written `to authenticated` would not apply';
  end if;

  if not v_service.rolbypassrls then
    raise exception 'chat_service lacks BYPASSRLS -- workers act for the system';
  end if;

  raise notice 'roles    chat_app: login, inherit, NOBYPASSRLS';
  raise notice 'roles    chat_service: login, inherit, BYPASSRLS';
end $$;

-- chat_app must reach the policy target, or every grant made to `authenticated`
-- is invisible to it.
do $$
begin
  if not pg_has_role('chat_app', 'authenticated', 'USAGE') then
    raise exception 'chat_app is not an inheriting member of authenticated';
  end if;
  if not pg_has_role('chat_service', 'service_role', 'USAGE') then
    raise exception 'chat_service is not an inheriting member of service_role';
  end if;
  raise notice 'roles    memberships resolve: chat_app->authenticated, chat_service->service_role';
end $$;

-- Ownership: the API role must own nothing, or it bypasses RLS on what it owns
-- regardless of the policies.
do $$
declare v_owned text;
begin
  select string_agg(c.relname, ', ')
    into v_owned
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r     on r.oid = c.relowner
   where n.nspname = 'chat' and c.relkind in ('r', 'p') and r.rolname = 'chat_app';

  if v_owned is not null then
    raise exception 'chat_app OWNS chat tables (%) -- an owner bypasses RLS', v_owned;
  end if;
  raise notice 'roles    chat_app owns no table in schema chat';
end $$;

\echo ''
\echo 'IDENTITY INVARIANTS PASSED'
