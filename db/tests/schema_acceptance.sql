-- Jawwid Chat -- fresh-database acceptance test (red team, AI #9).
--
-- Asserts that a database built ONLY by scripts/db/apply.sh over
-- supabase/migrations has everything a running system needs, and nothing it
-- must not have. Red-team finding RT-023 was that the chain could not build an
-- empty database at all, which meant no provisioned environment was guaranteed
-- to carry the BR-1 triggers or the append-only triggers. This file is the
-- standing proof that the chain is whole.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/schema_acceptance.sql
--
-- It asserts presence, not shape: the migrations own the shape. Anything absent
-- here means an environment would silently lack a control.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.want_table(p_name text)
returns void language plpgsql as $$
begin
  if to_regclass('chat.' || p_name) is null then
    raise exception 'MISSING TABLE chat.%', p_name;
  end if;
  raise notice 'table    chat.%', p_name;
end; $$;

-- OD-01: some tables must NOT exist. A structure the PRD forbids is as much a
-- defect as a missing control, and asserting its absence is what stops it being
-- reintroduced by a later migration.
create or replace function pg_temp.want_no_table(p_name text, p_why text)
returns void language plpgsql as $$
begin
  if to_regclass('chat.' || p_name) is not null then
    raise exception 'FORBIDDEN TABLE chat.% still exists -- %', p_name, p_why;
  end if;
  raise notice 'absent   chat.%  (%)', p_name, p_why;
end; $$;

create or replace function pg_temp.want_trigger(p_trigger text, p_table text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'chat' and c.relname = p_table and t.tgname = p_trigger
      and not t.tgisinternal
  ) then
    raise exception 'MISSING TRIGGER %.% ', p_table, p_trigger;
  end if;
  raise notice 'trigger  %  on chat.%', p_trigger, p_table;
end; $$;

create or replace function pg_temp.want_fk(p_table text, p_column text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1
      from pg_constraint con
      join pg_class c    on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (con.conkey)
     where con.contype = 'f' and n.nspname = 'chat'
       and c.relname = p_table and a.attname = p_column
  ) then
    raise exception 'MISSING FOREIGN KEY chat.%(%)', p_table, p_column;
  end if;
  raise notice 'fk       chat.%(%)', p_table, p_column;
end; $$;

create or replace function pg_temp.want_index(p_name text)
returns void language plpgsql as $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'chat' and indexname = p_name) then
    raise exception 'MISSING INDEX chat.%', p_name;
  end if;
  raise notice 'index    %', p_name;
end; $$;

\echo ''
\echo '=== core / platform tables (RT-023: these were referenced by FK and created by nothing) ==='
select pg_temp.want_table('account');
select pg_temp.want_table('staff');
select pg_temp.want_table('family');
select pg_temp.want_table('contact');
select pg_temp.want_table('learner');
select pg_temp.want_table('message');
select pg_temp.want_table('config');
select pg_temp.want_table('event_log');
select pg_temp.want_table('audit_log');
select pg_temp.want_table('shift');
select pg_temp.want_table('coverage_rule');
select pg_temp.want_table('absence');
select pg_temp.want_table('task');
select pg_temp.want_table('handoff');

\echo ''
\echo '=== OD-01: structures the PRD forbids (must be absent) ==='
-- chat.thread carried the superseded brief's `family_id UNIQUE` invariant. PRD
-- §7.5 requires many conversations per family and §7.3 one Student Group per
-- STUDENT; neither is representable while it exists.
select pg_temp.want_no_table('thread',
  'PRD §6 has no thread entity; conversation is the only message parent');
-- PRD §6's entity list has no Case. Product decision C-3, 2026-09-06.
select pg_temp.want_no_table('support_case',
  'PRD §6 has no Case entity; use Conversation + Task + Attention + state');

\echo ''
\echo '=== communication tables ==='
select pg_temp.want_table('conversation');
select pg_temp.want_table('conversation_member');
select pg_temp.want_table('conversation_participant_state');
select pg_temp.want_table('message_attachment');
select pg_temp.want_table('message_reaction');
select pg_temp.want_table('message_receipt');
select pg_temp.want_table('message_hidden_for');
select pg_temp.want_table('message_approval');
select pg_temp.want_table('call');
select pg_temp.want_table('call_participant');
select pg_temp.want_table('outbox_event');
select pg_temp.want_table('notification');
select pg_temp.want_table('notification_template');
select pg_temp.want_table('notification_rule');
select pg_temp.want_table('device_token');
select pg_temp.want_table('quiet_hours');

\echo ''
\echo '=== BR-1 triggers (RT-024 / RT-025) ==='
select pg_temp.want_trigger('conversation_member_br1',          'conversation_member');
select pg_temp.want_trigger('conversation_member_br1_deferred', 'conversation_member');
select pg_temp.want_trigger('conversation_br1_row',             'conversation');
select pg_temp.want_trigger('conversation_type_immutable',      'conversation');
select pg_temp.want_trigger('call_participant_br1',             'call_participant');
select pg_temp.want_trigger('call_participant_br1_deferred',    'call_participant');
select pg_temp.want_trigger('call_br1_row',                     'call');
select pg_temp.want_trigger('call_type_immutable',              'call');

\echo ''
\echo '=== append-only and immutability triggers ==='
select pg_temp.want_trigger('event_log_append_only', 'event_log');
select pg_temp.want_trigger('audit_log_append_only', 'audit_log');
select pg_temp.want_trigger('message_no_rewrite',    'message');

\echo ''
\echo '=== foreign keys the domain depends on ==='
select pg_temp.want_fk('family',              'owner_id');
select pg_temp.want_fk('contact',             'family_id');
select pg_temp.want_fk('learner',             'family_id');
select pg_temp.want_fk('conversation',        'family_id');
select pg_temp.want_fk('conversation_member', 'conversation_id');
select pg_temp.want_fk('message',             'conversation_id');
select pg_temp.want_fk('message_attachment',  'message_id');
select pg_temp.want_fk('message_receipt',     'message_id');
select pg_temp.want_fk('call',                'conversation_id');
select pg_temp.want_fk('call_participant',    'call_id');

\echo ''
\echo '=== indexes that carry an invariant ==='
select pg_temp.want_index('conversation_one_group_per_learner');
select pg_temp.want_index('conversation_member_unique_live');
select pg_temp.want_index('message_conversation_seq');
select pg_temp.want_index('message_idempotency');

\echo ''
\echo '=== Phase 1: identity, RBAC, supervisor scope (must exist) ==='
select pg_temp.want_table('teacher');
select pg_temp.want_table('account_credential');
select pg_temp.want_table('session');
select pg_temp.want_table('device');
select pg_temp.want_table('account_token');
select pg_temp.want_table('family_assignment');
select pg_temp.want_table('permission');
select pg_temp.want_table('role_permission');
select pg_temp.want_table('account_permission_override');

-- Teacher identity is a real relationship now, not a bare uuid on a learner.
select pg_temp.want_fk('learner', 'teacher_id');
select pg_temp.want_fk('staff', 'account_id');
select pg_temp.want_fk('contact', 'account_id');
select pg_temp.want_fk('teacher', 'account_id');
select pg_temp.want_fk('session', 'account_id');
select pg_temp.want_fk('family_assignment', 'family_id');
select pg_temp.want_fk('family_assignment', 'staff_id');

-- BR-4: one family, one live primary supervisor.
select pg_temp.want_index('family_assignment_one_live_primary');
select pg_temp.want_index('account_subject_per_organization_key');
select pg_temp.want_index('device_account_client_key');

select pg_temp.want_trigger('family_assignment_is_guarded', 'family_assignment');
select pg_temp.want_trigger('family_assignment_mirrors_owner', 'family_assignment');
select pg_temp.want_trigger('family_opens_primary_assignment', 'family');
select pg_temp.want_trigger('account_is_active_is_derived', 'account');
select pg_temp.want_trigger('teacher_deactivation_is_guarded', 'teacher');

\echo ''
\echo '=== Phase 1: the role vocabulary is the canonical one (PD-5) ==='
do $$
declare v_definition text;
begin
  select pg_get_constraintdef(c.oid) into v_definition
    from pg_constraint c join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'chat' and t.relname = 'staff' and c.conname = 'staff_role_check';

  if v_definition is null then
    raise exception 'MISSING chat.staff role CHECK';
  end if;
  if v_definition !~ 'super_admin' then
    raise exception 'chat.staff.role does not admit super_admin (PD-5)';
  end if;
  -- `coverage` followed by anything other than an underscore is the legacy
  -- role name; `coverage_admin` is the canonical one and must not match.
  if v_definition ~ '''coverage''' then
    raise exception 'the legacy role `coverage` is still admitted; PD-5 renamed it coverage_admin';
  end if;
  raise notice 'roles     super_admin present, legacy `coverage` gone';
end $$;

\echo ''
\echo '=== Phase 1: row-level security is enabled on EVERY table in the schema ==='
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'chat' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'RLS DISABLED on chat.%s -- a policy on a table with RLS off is documentation, not a control', v_missing;
  end if;
  raise notice 'rls       enabled on every table in schema chat';
end $$;

\echo ''
\echo '=== Phase 1: every root table carries the restrictive tenant policy ==='
do $$
declare v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
    from unnest(array['account','staff','family','contact','learner','conversation',
                      'message','message_approval','call','notification','device_token',
                      'quiet_hours','teacher','family_assignment','event_log','audit_log']) as t
   where to_regclass('chat.' || t) is not null
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'chat' and p.tablename = t and p.permissive = 'RESTRICTIVE');
  if v_missing is not null then
    raise exception 'MISSING tenant isolation policy on chat.%s', v_missing;
  end if;
  raise notice 'tenancy   restrictive organization policy on every root table';
end $$;

\echo ''
\echo '=== Phase 1: the policy helpers still run as their owner ==='
-- CREATE OR REPLACE FUNCTION resets every attribute the new definition does not
-- restate, so a later edit can silently drop SECURITY DEFINER from a helper an
-- RLS policy depends on. That happened once during Phase 1 and produced
-- "permission denied for table account" on an ordinary SELECT. This gate is
-- what makes it fail here instead of in an environment.
do $$
declare v_missing text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'chat'
     and p.proname in ('current_account_id', 'current_actor_ids', 'current_staff_id',
                       'staff_in_scope', 'staff_can_see_family', 'can_read_conversation',
                       'is_live_member', 'account_has_permission')
     and not p.prosecdef;
  if v_missing is not null then
    raise exception 'POLICY HELPER NOT SECURITY DEFINER: chat.%s -- RLS will fail closed on every read', v_missing;
  end if;
  raise notice 'helpers   every policy helper still runs as its owner';
end $$;

\echo ''
\echo '=== Phase 1 closure: the runtime role, throttling and tenant natural keys ==='
select pg_temp.want_table('auth_throttle');

-- The two connection roles, and what each of them must and must not be.
do $$
declare r record;
begin
  for r in select * from (values ('chat_app', false), ('chat_service', true)) as v(name, bypass)
  loop
    if not exists (select 1 from pg_roles where rolname = r.name) then
      raise exception 'MISSING ROLE % -- the API and the worker have nothing to connect as', r.name;
    end if;
    if (select rolbypassrls from pg_roles where rolname = r.name) <> r.bypass then
      raise exception 'ROLE % has the wrong BYPASSRLS setting (expected %)', r.name, r.bypass;
    end if;
    if not (select rolinherit from pg_roles where rolname = r.name) then
      raise exception 'ROLE % is NOINHERIT -- it would match no policy written `to authenticated`', r.name;
    end if;
    if (select rolsuper from pg_roles where rolname = r.name) then
      raise exception 'ROLE % is a superuser', r.name;
    end if;
  end loop;

  -- Membership has to be INHERITED, not merely held: a policy `to authenticated`
  -- is matched with pg_has_role(..., 'USAGE'), which a non-inheriting member
  -- fails. Getting this wrong makes the application see zero rows everywhere.
  if not exists (
    select 1 from pg_auth_members m
      join pg_roles member on member.oid = m.member
      join pg_roles role   on role.oid   = m.roleid
     where member.rolname = 'chat_app' and role.rolname = 'authenticated'
       and m.inherit_option) then
    raise exception 'chat_app does not INHERIT authenticated -- every policy would fail closed';
  end if;

  if (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'chat') = 'chat_app' then
    raise exception 'chat_app owns the chat schema -- an owner bypasses every policy';
  end if;
  if has_schema_privilege('chat_app', 'chat', 'create') then
    raise exception 'chat_app may CREATE in the chat schema';
  end if;

  raise notice 'roles     chat_app is least-privileged and inherits authenticated';
end $$;

-- The application must be able to do its job as chat_app, or least privilege
-- is a configuration that takes the product down.
do $$
declare v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
    from unnest(array['conversation','conversation_member','message','message_receipt',
                      'message_approval','call','call_participant','notification',
                      'device_token','outbox_event','event_log','audit_log',
                      'session','device','account','account_credential','account_token']) as t
   where not has_table_privilege('chat_app', 'chat.' || t, 'insert');
  if v_missing is not null then
    raise exception 'chat_app cannot INSERT into chat.%s -- the application would fail closed', v_missing;
  end if;
  raise notice 'grants    chat_app can write everything the application writes';
end $$;

-- Tenancy M-2: the natural keys that identify tenant-owned rows.
do $$
begin
  if exists (select 1 from pg_indexes where schemaname='chat'
              and indexname in ('device_token_token_key','call_room_name_key',
                                'notification_dedupe_key_key')) then
    raise exception 'a tenant-owned natural key is still GLOBALLY unique (TENANCY-MODEL M-2)';
  end if;
  perform 1 from pg_indexes where schemaname='chat'
    and indexname = 'device_token_token_per_organization_key';
  if not found then
    raise exception 'MISSING device_token_token_per_organization_key';
  end if;
  raise notice 'tenancy   push tokens, call rooms and dedupe keys are per organization';
end $$;

select pg_temp.want_trigger('device_token_handover_is_guarded', 'device_token');

\echo ''
\echo '=== isolation: no Jawwid Core and no Second School objects may be required ==='
do $$
declare v_foreign text;
begin
  select string_agg(schemaname || '.' || tablename, ', ')
    into v_foreign
    from pg_tables
   where schemaname not in ('pg_catalog', 'information_schema', 'chat');
  if v_foreign is not null then
    raise exception 'FOREIGN OBJECTS PRESENT: % -- the chain must not depend on another product''s database', v_foreign;
  end if;
  if exists (select 1 from information_schema.schemata where schema_name = 'auth') then
    raise exception 'auth SCHEMA PRESENT -- Jawwid Chat must not depend on Supabase identity';
  end if;
  raise notice 'isolation  no non-chat tables, no auth schema';
end $$;

\echo ''
\echo 'FRESH DATABASE ACCEPTANCE PASSED'
