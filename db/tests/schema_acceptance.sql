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
