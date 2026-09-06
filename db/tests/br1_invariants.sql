-- Jawwid Chat -- executable BR-1 invariant tests (red team, AI #9).
--
-- Proves, against a real database built by the migration chain, that the
-- forbidden Teacher<->Parent 1:1 channel cannot be constructed by ANY route,
-- and that every legitimate channel still can.
--
-- These are structural tests: they run as the database owner with the
-- application entirely out of the picture, which is the threat model the
-- backstop exists for. If they pass here, no API bug can reintroduce the
-- forbidden state.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/br1_invariants.sql
--
-- Exit code 0 and a final 'ALL BR-1 INVARIANT TESTS PASSED' is the pass
-- condition. Any failure aborts with a non-zero exit.
--
-- Covers red-team findings RT-024 (type-change bypass, messaging and calling)
-- and RT-025 (required admin presence; class_group out of scope of the old
-- trigger). Do not weaken an assertion here to make a change pass.

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- The BR-1 constraint triggers are DEFERRABLE INITIALLY DEFERRED, so they fire
-- at COMMIT -- which never happens inside a plpgsql subtransaction. Each helper
-- therefore forces the pending checks with SET CONSTRAINTS ALL IMMEDIATE, which
-- evaluates them here and now, and restores DEFERRED afterwards so the next
-- test can still build a group one member at a time (see E4).
create or replace function pg_temp.expect_violation(p_label text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
    execute 'set constraints all immediate';   -- fire the deferred BR-1 checks
    execute 'set constraints all deferred';
    raise exception 'FAIL [%]: the database ACCEPTED a state BR-1 forbids', p_label;
  exception
    when check_violation or restrict_violation then
      raise notice 'pass  %', p_label;
    when others then
      -- Anything else means the statement failed for the wrong reason; a test
      -- that passes because of a typo is worse than no test.
      raise exception 'FAIL [%]: wrong error: % (%)', p_label, sqlerrm, sqlstate;
  end;
end;
$$;

create or replace function pg_temp.expect_ok(p_label text, p_sql text)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  execute 'set constraints all immediate';   -- the legitimate case must survive it
  execute 'set constraints all deferred';
  raise notice 'pass  %', p_label;
exception
  when others then
    raise exception 'FAIL [%]: the database REJECTED a legitimate channel: % (%)',
      p_label, sqlerrm, sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Everything is rolled back at the end.
-- ---------------------------------------------------------------------------
begin;

insert into chat.staff (id, name, role)
values ('11111111-1111-1111-1111-111111111111', 'Red Team Admin', 'admin');

insert into chat.family (id, display_name, owner_id)
values ('22222222-2222-2222-2222-222222222222', 'Red Team Family',
        '11111111-1111-1111-1111-111111111111');

-- One live student_group per learner is a correct existing constraint
-- (conversation_one_group_per_learner), so each test that must SUCCEED in
-- building a group needs its own learner.
insert into chat.learner (id, family_id, name) values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Learner One'),
  ('33333333-3333-3333-3333-333333333334', '22222222-2222-2222-2222-222222222222', 'Learner Two'),
  ('33333333-3333-3333-3333-333333333335', '22222222-2222-2222-2222-222222222222', 'Learner Three');

-- Stable actor ids. Only actor_kind and member_role matter to BR-1.
\set teacher '''99999999-9999-9999-9999-999999999999'''
\set parent  '''88888888-8888-8888-8888-888888888888'''
\set admin   '''11111111-1111-1111-1111-111111111111'''
\set fam     '''22222222-2222-2222-2222-222222222222'''
\set learner  '''33333333-3333-3333-3333-333333333333'''
\set learner2 '''33333333-3333-3333-3333-333333333334'''
\set learner3 '''33333333-3333-3333-3333-333333333335'''

-- ===========================================================================
-- A · The forbidden channel cannot be CREATED           (the original control)
-- ===========================================================================
select pg_temp.expect_violation(
  'A1 direct conversation: teacher + parent is refused at creation',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('a0000000-0000-0000-0000-000000000001', 'direct', %L, 'rt-a1');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000001', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000001', 'contact', %L, 'parent');
  $f$, :fam, :teacher, :parent));

-- ===========================================================================
-- B · RT-024 · The forbidden channel cannot be REACHED BY MUTATION
-- ===========================================================================
select pg_temp.expect_violation(
  'B1 RT-024: a legal Student Group cannot be promoted to type=direct',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('a0000000-0000-0000-0000-000000000002', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000002', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000002', 'contact', %L, 'parent'),
             ('a0000000-0000-0000-0000-000000000002', 'staff',   %L, 'admin');
    update chat.conversation
       set type = 'direct', direct_key = 'promoted-by-attacker', learner_id = null
     where id = 'a0000000-0000-0000-0000-000000000002';
  $f$, :fam, :learner, :teacher, :parent, :admin));

select pg_temp.expect_violation(
  'B2 RT-024: conversation.type is immutable even between harmless group types',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('a0000000-0000-0000-0000-000000000003', 'student_group', %L, %L, 'RT group');
    update chat.conversation set type = 'class_group', learner_id = null
     where id = 'a0000000-0000-0000-0000-000000000003';
  $f$, :fam, :learner));

-- ===========================================================================
-- C · RT-025 · Required admin presence, on every group type
-- ===========================================================================
select pg_temp.expect_violation(
  'C1 RT-025: a student_group of {teacher, parent} with NO admin is refused',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('a0000000-0000-0000-0000-000000000004', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000004', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000004', 'contact', %L, 'parent');
  $f$, :fam, :learner, :teacher, :parent));

select pg_temp.expect_violation(
  'C2 RT-025: class_group is in scope too (the old trigger ignored it)',
  format($f$
    insert into chat.conversation (id, type, family_id, title)
      values ('a0000000-0000-0000-0000-000000000005', 'class_group', %L, 'RT class');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000005', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000005', 'contact', %L, 'parent');
  $f$, :fam, :teacher, :parent));

select pg_temp.expect_violation(
  'C3 RT-025: the last admin cannot be removed from a teacher+parent group',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('a0000000-0000-0000-0000-000000000006', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000006', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000006', 'contact', %L, 'parent'),
             ('a0000000-0000-0000-0000-000000000006', 'staff',   %L, 'admin');
    update chat.conversation_member set left_at = now()
     where conversation_id = 'a0000000-0000-0000-0000-000000000006' and actor_kind = 'staff';
  $f$, :fam, :learner, :teacher, :parent, :admin));

select pg_temp.expect_violation(
  'C4 RT-025: deleting the admin row outright is refused the same way',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('a0000000-0000-0000-0000-000000000007', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000007', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000007', 'contact', %L, 'parent'),
             ('a0000000-0000-0000-0000-000000000007', 'staff',   %L, 'admin');
    delete from chat.conversation_member
     where conversation_id = 'a0000000-0000-0000-0000-000000000007' and actor_kind = 'staff';
  $f$, :fam, :learner, :teacher, :parent, :admin));

select pg_temp.expect_violation(
  'C5 RT-025: a teacher cannot satisfy admin presence by claiming member_role=admin',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('a0000000-0000-0000-0000-000000000008', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000008', 'teacher', %L, 'admin'),
             ('a0000000-0000-0000-0000-000000000008', 'contact', %L, 'parent');
  $f$, :fam, :learner, :teacher, :parent));

-- ===========================================================================
-- D · Calling -- the same invariant, by the same routes
-- ===========================================================================
select pg_temp.expect_violation(
  'D1 a direct call pairing a teacher with a parent is refused',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('b0000000-0000-0000-0000-000000000001', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('b0000000-0000-0000-0000-000000000001', 'teacher', %L, 'teacher'),
             ('b0000000-0000-0000-0000-000000000001', 'contact', %L, 'parent'),
             ('b0000000-0000-0000-0000-000000000001', 'staff',   %L, 'admin');
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('c0000000-0000-0000-0000-000000000001',
              'b0000000-0000-0000-0000-000000000001', %L, %L, 'direct', 'rt-room-d1');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('c0000000-0000-0000-0000-000000000001', %L, 'teacher'),
             ('c0000000-0000-0000-0000-000000000001', %L, 'contact');
  $f$, :fam, :learner, :teacher, :parent, :admin, :fam, :teacher, :teacher, :parent));

select pg_temp.expect_violation(
  'D2 RT-024: a group call cannot be promoted to type=direct',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('b0000000-0000-0000-0000-000000000002', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('b0000000-0000-0000-0000-000000000002', 'teacher', %L, 'teacher'),
             ('b0000000-0000-0000-0000-000000000002', 'contact', %L, 'parent'),
             ('b0000000-0000-0000-0000-000000000002', 'staff',   %L, 'admin');
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('c0000000-0000-0000-0000-000000000002',
              'b0000000-0000-0000-0000-000000000002', %L, %L, 'group', 'rt-room-d2');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('c0000000-0000-0000-0000-000000000002', %L, 'teacher'),
             ('c0000000-0000-0000-0000-000000000002', %L, 'contact'),
             ('c0000000-0000-0000-0000-000000000002', %L, 'staff');
    update chat.call set type = 'direct' where id = 'c0000000-0000-0000-0000-000000000002';
  $f$, :fam, :learner, :teacher, :parent, :admin, :fam, :admin, :teacher, :parent, :admin));

select pg_temp.expect_violation(
  'D3 a group call of {teacher, parent} with no staff participant is refused',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('b0000000-0000-0000-0000-000000000003', 'student_group', %L, %L, 'RT group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('b0000000-0000-0000-0000-000000000003', 'teacher', %L, 'teacher'),
             ('b0000000-0000-0000-0000-000000000003', 'contact', %L, 'parent'),
             ('b0000000-0000-0000-0000-000000000003', 'staff',   %L, 'admin');
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('c0000000-0000-0000-0000-000000000003',
              'b0000000-0000-0000-0000-000000000003', %L, %L, 'group', 'rt-room-d3');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('c0000000-0000-0000-0000-000000000003', %L, 'teacher'),
             ('c0000000-0000-0000-0000-000000000003', %L, 'contact');
  $f$, :fam, :learner, :teacher, :parent, :admin, :fam, :admin, :teacher, :parent));

-- ===========================================================================
-- E · The legitimate channels MUST still work.
--     A backstop that blocks the product is a failure, not a fix.
-- ===========================================================================
select pg_temp.expect_ok(
  'E1 Teacher <-> Admin direct conversation is permitted',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('d0000000-0000-0000-0000-000000000001', 'direct', %L, 'rt-e1');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000001', 'teacher', %L, 'teacher'),
             ('d0000000-0000-0000-0000-000000000001', 'staff',   %L, 'admin');
  $f$, :fam, :teacher, :admin));

select pg_temp.expect_ok(
  'E2 Parent <-> Admin direct conversation is permitted',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('d0000000-0000-0000-0000-000000000002', 'direct', %L, 'rt-e2');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000002', 'contact', %L, 'parent'),
             ('d0000000-0000-0000-0000-000000000002', 'staff',   %L, 'admin');
  $f$, :fam, :parent, :admin));

select pg_temp.expect_ok(
  'E3 the official Student Group (teacher + parent + admin) is permitted',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('d0000000-0000-0000-0000-000000000003', 'student_group', %L, %L, 'Official group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000003', 'teacher', %L, 'teacher'),
             ('d0000000-0000-0000-0000-000000000003', 'contact', %L, 'parent'),
             ('d0000000-0000-0000-0000-000000000003', 'staff',   %L, 'admin');
  $f$, :fam, :learner, :teacher, :parent, :admin));

select pg_temp.expect_ok(
  'E4 the admin may be added LAST -- deferred checking must allow the build order',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('d0000000-0000-0000-0000-000000000004', 'student_group', %L, %L, 'Built in order');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000004', 'teacher', %L, 'teacher');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000004', 'contact', %L, 'parent');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000004', 'staff', %L, 'admin');
  $f$, :fam, :learner2, :teacher, :parent, :admin));

select pg_temp.expect_ok(
  'E5 a group voice call inside that Student Group is permitted',
  format($f$
    insert into chat.conversation (id, type, family_id, learner_id, title)
      values ('d0000000-0000-0000-0000-000000000005', 'student_group', %L, %L, 'Callable group');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('d0000000-0000-0000-0000-000000000005', 'teacher', %L, 'teacher'),
             ('d0000000-0000-0000-0000-000000000005', 'contact', %L, 'parent'),
             ('d0000000-0000-0000-0000-000000000005', 'staff',   %L, 'admin');
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('e0000000-0000-0000-0000-000000000005',
              'd0000000-0000-0000-0000-000000000005', %L, %L, 'group', 'rt-room-e5');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('e0000000-0000-0000-0000-000000000005', %L, 'teacher'),
             ('e0000000-0000-0000-0000-000000000005', %L, 'contact'),
             ('e0000000-0000-0000-0000-000000000005', %L, 'staff');
  $f$, :fam, :learner3, :teacher, :parent, :admin, :fam, :admin, :teacher, :parent, :admin));

select pg_temp.expect_ok(
  'E6 a Teacher <-> Admin direct CALL is permitted',
  format($f$
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('e0000000-0000-0000-0000-000000000006',
              'd0000000-0000-0000-0000-000000000001', %L, %L, 'direct', 'rt-room-e6');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('e0000000-0000-0000-0000-000000000006', %L, 'teacher'),
             ('e0000000-0000-0000-0000-000000000006', %L, 'staff');
  $f$, :fam, :admin, :teacher, :admin));

select pg_temp.expect_ok(
  'E7 an admin whose connection drops mid-call does not invalidate the call',
  format($f$
    update chat.call_participant set left_at = now()
     where call_id = 'e0000000-0000-0000-0000-000000000005' and actor_kind = 'staff';
  $f$));

rollback;

\echo ''
\echo 'ALL BR-1 INVARIANT TESTS PASSED'
