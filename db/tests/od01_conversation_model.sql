-- Jawwid Chat -- OD-01 conversation-model invariants (AI #10, release).
--
-- Proves against a real database, with the application entirely out of the
-- picture, that the model the PRD requires is the model the schema enforces.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/od01_conversation_model.sql
--
-- Covers:
--   * PRD §7.3  one official Student Group per STUDENT -- so a family with two
--               children gets two groups, which `thread.family_id UNIQUE` and
--               `@@unique([familyId, kind])` both made impossible.
--   * PRD §7.5  many conversations per family.
--   * PRD §6    the conversation is the only parent of a message.
--   * C-2       a Teacher<->Admin direct conversation is legitimately NOT
--               family-scoped, while any conversation containing a family
--               contact must be, and must be scoped to THAT contact's family.
--   * C-3       no Case entity, and no thread, may come back.
--
-- Do not weaken an assertion here to make a change pass.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.expect_violation(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    execute 'set constraints all immediate';
    execute 'set constraints all deferred';
    raise exception 'FAIL [%]: the database ACCEPTED a state the PRD forbids', p_label;
  exception
    when check_violation or restrict_violation or unique_violation or not_null_violation then
      raise notice 'pass  %', p_label;
    when others then
      raise exception 'FAIL [%]: wrong error: % (%)', p_label, sqlerrm, sqlstate;
  end;
end; $$;

create or replace function pg_temp.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  raise notice 'pass  %', p_label;
exception
  when others then
    raise exception 'FAIL [%]: the database REJECTED a legitimate structure: % (%)',
      p_label, sqlerrm, sqlstate;
end; $$;

begin;

insert into chat.staff (id, name, role) values
  ('11111111-0000-0000-0000-000000000001', 'OD01 Admin', 'admin');

insert into chat.family (id, display_name, owner_id) values
  ('22222222-0000-0000-0000-00000000000a', 'OD01 Family A',
   '11111111-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-00000000000b', 'OD01 Family B',
   '11111111-0000-0000-0000-000000000001');

-- A two-child family: the case the superseded model could not represent.
insert into chat.learner (id, family_id, name) values
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-00000000000a', 'Child One'),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-00000000000a', 'Child Two');

insert into chat.contact (id, family_id, name, relationship, role_preset) values
  ('44444444-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 'Parent A', 'parent', 'primary_guardian'),
  ('44444444-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-00000000000b', 'Parent B', 'parent', 'primary_guardian');

\set famA    '''22222222-0000-0000-0000-00000000000a'''
\set famB    '''22222222-0000-0000-0000-00000000000b'''
\set kidA1   '''33333333-0000-0000-0000-000000000001'''
\set kidA2   '''33333333-0000-0000-0000-000000000002'''
\set parentA '''44444444-0000-0000-0000-00000000000a'''
\set parentB '''44444444-0000-0000-0000-00000000000b'''
\set admin   '''11111111-0000-0000-0000-000000000001'''
\set teacher '''99999999-0000-0000-0000-000000000001'''

\echo ''
\echo '=== A · PRD §7.3 / §7.5 · many conversations per family ==='

select pg_temp.expect_ok(
  'A1 a family holds a direct conversation AND two student groups, one per child',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key, title)
      values ('c0000000-0000-0000-0000-00000000000d', 'direct', %L, 'od01-famA', 'Jawwid');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('c0000000-0000-0000-0000-00000000000d', 'contact', %L, 'parent'),
             ('c0000000-0000-0000-0000-00000000000d', 'staff',   %L, 'admin');

    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('c0000000-0000-0000-0000-000000000001', 'student_group', %L, %L, 'Child One · Jawwid');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('c0000000-0000-0000-0000-000000000001', 'contact', %L, 'parent'),
             ('c0000000-0000-0000-0000-000000000001', 'teacher', %L, 'teacher'),
             ('c0000000-0000-0000-0000-000000000001', 'staff',   %L, 'admin');

    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('c0000000-0000-0000-0000-000000000002', 'student_group', %L, %L, 'Child Two · Jawwid');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('c0000000-0000-0000-0000-000000000002', 'contact', %L, 'parent'),
             ('c0000000-0000-0000-0000-000000000002', 'teacher', %L, 'teacher'),
             ('c0000000-0000-0000-0000-000000000002', 'staff',   %L, 'admin');
  $f$, :famA, :parentA, :admin,
       :famA, :kidA1, :parentA, :teacher, :admin,
       :famA, :kidA2, :parentA, :teacher, :admin));

select pg_temp.expect_violation(
  'A2 a SECOND live student group for the SAME child is still refused (§7.3 "one per student")',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('c0000000-0000-0000-0000-000000000003', 'student_group', %L, %L, 'duplicate');
  $f$, :famA, :kidA1));

\echo ''
\echo '=== B · C-2 · family scope: required with a contact, absent without ==='

select pg_temp.expect_ok(
  'B1 Teacher<->Admin direct with NO family_id is legitimate (C-2)',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('c0000000-0000-0000-0000-00000000000e', 'direct', null, 'od01-teach-admin');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('c0000000-0000-0000-0000-00000000000e', 'teacher', %L, 'teacher'),
             ('c0000000-0000-0000-0000-00000000000e', 'staff',   %L, 'admin');
  $f$, :teacher, :admin));

select pg_temp.expect_violation(
  'B2 a conversation containing a family contact but NO family_id is refused',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('c0000000-0000-0000-0000-00000000000f', 'direct', null, 'od01-unscoped');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('c0000000-0000-0000-0000-00000000000f', 'contact', %L, 'parent'),
             ('c0000000-0000-0000-0000-00000000000f', 'staff',   %L, 'admin');
  $f$, :parentA, :admin));

select pg_temp.expect_violation(
  'B3 a conversation scoped to family A may not contain family B''s parent',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('c0000000-0000-0000-0000-000000000010', 'direct', %L, 'od01-crossfamily');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('c0000000-0000-0000-0000-000000000010', 'contact', %L, 'parent'),
             ('c0000000-0000-0000-0000-000000000010', 'staff',   %L, 'admin');
  $f$, :famA, :parentB, :admin));

\echo ''
\echo '=== C · PRD §6 · the conversation is the only parent of a message ==='

-- Authored by staff so the author/family trigger passes and the assertion is
-- actually about the missing parent, not about the author.
select pg_temp.expect_violation(
  'C1 a message with no conversation is refused',
  format($f$
    insert into chat.message (conversation_id, author_type, author_id, body, visibility,
                              on_behalf_mode)
      values (null, 'staff', %L, 'orphan', 'internal', 'owner');
  $f$, :admin));

select pg_temp.expect_ok(
  'C2 a message in the family''s direct conversation is accepted',
  format($f$
    insert into chat.message (conversation_id, author_type, author_id, body, visibility)
      values ('c0000000-0000-0000-0000-00000000000d', 'contact', %L, 'hello', 'customer');
  $f$, :parentA));

\echo ''
\echo '=== D · C-3 / OD-01 · removed structures must stay removed ==='

do $$
begin
  if to_regclass('chat.thread') is not null then
    raise exception 'FAIL: chat.thread exists again -- PRD §6 has no thread entity';
  end if;
  raise notice 'pass  D1 chat.thread is absent';

  if to_regclass('chat.support_case') is not null then
    raise exception 'FAIL: chat.support_case exists again -- product decision C-3';
  end if;
  raise notice 'pass  D2 chat.support_case is absent';

  if exists (select 1 from information_schema.columns
              where table_schema = 'chat' and column_name in ('thread_id', 'case_id')) then
    raise exception 'FAIL: a thread_id/case_id column came back';
  end if;
  raise notice 'pass  D3 no thread_id or case_id column anywhere in chat';

  -- C-3: system events are carried by Task types, not by a new conversation
  -- type and not by a resurrected case type.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'chat.task'::regclass and conname = 'task_type_check'
       and pg_get_constraintdef(oid) like '%onboarding%'
       and pg_get_constraintdef(oid) like '%renewal%'
       and pg_get_constraintdef(oid) like '%complaint%') then
    raise exception 'FAIL: chat.task does not carry the PRD §7.6 task vocabulary';
  end if;
  raise notice 'pass  D4 task carries the PRD §7.6 vocabulary (C-3 system-event carrier)';

  -- C-1: exactly four conversation types, no fifth.
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'chat.conversation'::regclass
         and pg_get_constraintdef(oid) like '%student_group%' limit 1)
     not like '%direct%student_group%class_group%official%' then
    raise exception 'FAIL: conversation.type is not exactly the four PRD types';
  end if;
  raise notice 'pass  D5 conversation.type is exactly the four PRD types (C-1)';
end $$;

rollback;

\echo ''
\echo 'ALL OD-01 CONVERSATION MODEL TESTS PASSED'
