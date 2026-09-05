-- TEST FIXTURE ONLY -- a minimal assertion library.
--
-- Assertions record results rather than aborting, so one run reports every
-- failure. test.finish() raises at the end if anything failed, which makes psql
-- exit non-zero under ON_ERROR_STOP.

create schema if not exists test;

drop table if exists test.result;
create table test.result (
  id     serial primary key,
  suite  text,
  label  text not null,
  passed boolean not null,
  detail text
);

create or replace function test.ok(p_cond boolean, p_label text, p_detail text default null)
returns void
language sql
as $$
  insert into test.result (suite, label, passed, detail)
  values (current_setting('test.suite', true), p_label, coalesce(p_cond, false), p_detail);
$$;

create or replace function test.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void
language sql
as $$
  insert into test.result (suite, label, passed, detail)
  values (current_setting('test.suite', true), p_label,
          p_actual is not distinct from p_expected,
          case when p_actual is not distinct from p_expected then null
               else format('expected %L, got %L', p_expected, p_actual) end);
$$;

-- Runs a statement and asserts it fails. Optionally asserts the SQLSTATE, so a
-- test cannot pass because of an unrelated error such as a typo.
create or replace function test.throws(
  p_sql text, p_label text, p_sqlstate text default null
) returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_sqlstate is not null and v_state <> p_sqlstate then
      perform test.ok(false, p_label,
        format('expected SQLSTATE %s, got %s: %s', p_sqlstate, v_state, v_msg));
    else
      perform test.ok(true, p_label, v_msg);
    end if;
    return;
  end;
  perform test.ok(false, p_label, 'statement was expected to fail but succeeded');
end;
$$;

create or replace function test.finish()
returns void
language plpgsql
as $$
declare
  v_total  integer;
  v_failed integer;
  r        record;
begin
  select count(*), count(*) filter (where not passed) into v_total, v_failed from test.result;

  for r in select suite, label, passed, detail from test.result order by id loop
    raise notice '% % %', case when r.passed then 'ok  ' else 'FAIL' end,
      coalesce(r.suite || ' / ', '') || r.label,
      coalesce(' -- ' || r.detail, '');
  end loop;

  raise notice '--- % assertions, % failed ---', v_total, v_failed;

  if v_failed > 0 then
    raise exception '% of % assertions failed', v_failed, v_total
      using errcode = 'assert_failure';
  end if;
end;
$$;

create or replace function test.begin_suite(p_name text)
returns void
language plpgsql
as $$
begin
  delete from test.result;
  perform set_config('test.suite', p_name, false);
end;
$$;

-- Runs a query as the Supabase `authenticated` role, impersonating one auth
-- user, so RLS is genuinely exercised rather than bypassed by the superuser
-- that owns the schema. Results are returned to the caller, which is still the
-- owner, so assertions can be recorded normally.
create or replace function test.count_as(p_auth_user uuid, p_sql text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_auth_user::text, ''), true);
  set local role authenticated;
  execute p_sql into v_count;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v_count;
exception when others then
  reset role;
  raise;
end;
$$;

-- Asserts that a statement fails when run as that user.
create or replace function test.denied_for(
  p_auth_user uuid, p_sql text, p_label text, p_sqlstate text default null
) returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_auth_user::text, ''), true);
  set local role authenticated;
  begin
    execute p_sql;
    reset role;
    perform test.ok(false, p_label, 'the statement was permitted but should not have been');
    return;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  reset role;
  if p_sqlstate is not null and v_state <> p_sqlstate then
    perform test.ok(false, p_label, format('expected SQLSTATE %s, got %s: %s',
                                           p_sqlstate, v_state, v_msg));
  else
    perform test.ok(true, p_label, v_msg);
  end if;
end;
$$;

-- Runs a statement as that user and asserts it succeeds.
create or replace function test.allowed_for(p_auth_user uuid, p_sql text, p_label text)
returns void
language plpgsql
as $$
declare
  v_msg text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_auth_user::text, ''), true);
  set local role authenticated;
  begin
    execute p_sql;
    reset role;
    perform test.ok(true, p_label);
    return;
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  reset role;
  perform test.ok(false, p_label, v_msg);
end;
$$;

create or replace function test.auth_of(p_staff_name text)
returns uuid
language sql
stable
as $$ select auth_user_id from chat.staff where name = p_staff_name $$;
