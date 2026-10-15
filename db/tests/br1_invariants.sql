-- Jawwid Chat -- executable BR-1 invariant tests (red team, AI #9).
--
-- RE-VERSIONED 2026-10-14 BY PD-7, which supersedes PD-6 (2026-09-23).
--
--     PD-6  teacher + AUTHORIZED parent, direct  ->  PERMITTED
--     PD-7  teacher + ANY parent, direct         ->  REFUSED   (A1-A4, D1, D5, D7)
--
-- The PD-6 "permitted" cases were turned into refusals, not deleted, and the
-- PD-6 window gets its own section (H): a direct teacher<->parent conversation
-- or call written before PD-7 stays readable and its lifecycle writes still
-- succeed, but it accepts no new teacher/parent message and no revived member.
--
-- Every other assertion in this file is untouched and must keep passing:
-- RT-024 type immutability (B1, B2, D2), RT-025 required admin presence on
-- every group type (C1-C5), the participant ceilings, and every legitimate
-- channel (E1-E7).
--
-- Proves, against a real database built by the migration chain, that a
-- Teacher<->Parent 1:1 channel cannot be constructed by ANY route, whatever
-- their relationship, and that every legitimate channel still can.
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

-- ---------------------------------------------------------------------------
-- The assignment gate
-- ---------------------------------------------------------------------------
--
-- chat.guard_learner_assignment_change()
-- (20260923130000_chat_learner_assignment_authority) makes
-- chat.learner.teacher_id writable only inside the ingestion path: the
-- teacher<->learner assignment is the academy's fact and Chat mirrors it
-- rather than authoring it. It opens for a transaction that sets
-- chat.syncing_assignment, exactly as chat.guard_owner_change does for
-- family.owner_id.
--
-- EVERY teacher_id write in this file -- the fixtures, and the reassignments
-- that stand in for a revoked relationship -- is standing in for what
-- ingestion would have written. So this transaction opens the gate once, here,
-- where it is visible, rather than sprinkling set_config through the cases.
--
-- This does NOT weaken the guard, and it is not this file's job to test it:
-- that control has its own suite, apps/api/test/integration/
-- learner-assignment-authority.spec.ts, which proves both that an application
-- write is refused and that the gated write succeeds. The setting is
-- transaction-local (third argument true) and dies with the rollback below.
select set_config('chat.syncing_assignment', 'on', true);

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

-- PD-6 fixtures. The old rule was decidable from actor_kind alone, so the ids
-- above needed no backing rows. The new rule is decidable only from
-- contact -> family -> learner -> teacher, so the AUTHORIZED cases need a real
-- chain. The UNAUTHORIZED cases deliberately keep the synthetic ids: an id with
-- no rows behind it has no relationship, which is exactly the state they test.
insert into chat.teacher (id, name) values
  ('77777777-7777-7777-7777-777777777771', 'teacher_real'),
  ('77777777-7777-7777-7777-777777777772', 'teacher_other');

insert into chat.contact (id, family_id, name, role_preset, can_message,
                          can_view_progress, can_manage_schedule,
                          can_manage_billing, can_manage_contacts, can_cancel) values
  ('66666666-6666-6666-6666-666666666661', '22222222-2222-2222-2222-222222222222',
   'parent_real', 'primary_guardian', true, true, true, true, true, true);

-- The link that authorizes teacher_real <-> parent_real, and nobody else.
insert into chat.learner (id, family_id, name, teacher_id) values
  ('33333333-3333-3333-3333-333333333336', '22222222-2222-2222-2222-222222222222',
   'Learner Four', '77777777-7777-7777-7777-777777777771');

-- Stable actor ids. For the UNAUTHORIZED cases only actor_kind and member_role
-- matter, exactly as before PD-6.
\set teacher '''99999999-9999-9999-9999-999999999999'''
\set parent  '''88888888-8888-8888-8888-888888888888'''
\set admin   '''11111111-1111-1111-1111-111111111111'''
\set fam     '''22222222-2222-2222-2222-222222222222'''
\set learner  '''33333333-3333-3333-3333-333333333333'''
\set learner2 '''33333333-3333-3333-3333-333333333334'''
\set learner3 '''33333333-3333-3333-3333-333333333335'''
\set t_real  '''77777777-7777-7777-7777-777777777771'''
\set t_other '''77777777-7777-7777-7777-777777777772'''
\set p_real  '''66666666-6666-6666-6666-666666666661'''

-- ===========================================================================
-- A · PD-7 · No direct teacher/parent channel may be CREATED
--
-- Under PD-6 this section separated authorized from unauthorized pairs. PD-7
-- refuses both: the relationship no longer opens anything.
-- ===========================================================================
select pg_temp.expect_violation(
  'A1 direct conversation: teacher + UNRELATED parent is refused at creation',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('a0000000-0000-0000-0000-000000000001', 'direct', %L, 'rt-a1');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-000000000001', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-000000000001', 'contact', %L, 'parent');
  $f$, :fam, :teacher, :parent));

select pg_temp.expect_violation(
  'A2 PD-7: direct conversation teacher + AUTHORIZED parent is REFUSED too',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('a0000000-0000-0000-0000-00000000000a', 'direct', %L, 'pd6-a2');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-00000000000a', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-00000000000a', 'contact', %L, 'parent');
  $f$, :fam, :t_real, :p_real));

select pg_temp.expect_violation(
  'A3 a REAL teacher with no learner in that family is refused',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('a0000000-0000-0000-0000-00000000000b', 'direct', %L, 'pd6-a3');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-00000000000b', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-00000000000b', 'contact', %L, 'parent');
  $f$, :fam, :t_other, :p_real));

-- The relationship is not a role. A real teacher and a real parent of a real
-- family, with the learner link pointing elsewhere, is refused.
select pg_temp.expect_violation(
  'A4 a revoked learner link refuses a NEW channel for the same pair',
  format($f$
    update chat.learner set teacher_id = %L
     where id = '33333333-3333-3333-3333-333333333336';
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('a0000000-0000-0000-0000-00000000000c', 'direct', %L, 'pd6-a4');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('a0000000-0000-0000-0000-00000000000c', 'teacher', %L, 'teacher'),
             ('a0000000-0000-0000-0000-00000000000c', 'contact', %L, 'parent');
  $f$, :t_other, :fam, :t_real, :p_real));

-- Put the relationship back for the sections below.
update chat.learner set teacher_id = :t_real
 where id = '33333333-3333-3333-3333-333333333336';

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
  'D1 a direct call pairing a teacher with an UNRELATED parent is refused',
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
  'D5 PD-7: a direct call between a teacher and an AUTHORIZED parent is REFUSED too',
  format($f$
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('b0000000-0000-0000-0000-00000000000a', 'direct', %L, 'pd6-d5');
    insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
      values ('b0000000-0000-0000-0000-00000000000a', 'teacher', %L, 'teacher'),
             ('b0000000-0000-0000-0000-00000000000a', 'contact', %L, 'parent');
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('c0000000-0000-0000-0000-00000000000a',
              'b0000000-0000-0000-0000-00000000000a', %L, %L, 'direct', 'pd6-room-d5');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('c0000000-0000-0000-0000-00000000000a', %L, 'teacher'),
             ('c0000000-0000-0000-0000-00000000000a', %L, 'contact');
  $f$, :fam, :t_real, :p_real, :fam, :t_real, :t_real, :p_real));

-- ...but a NEW call for the revoked pair is refused.
select pg_temp.expect_violation(
  'D7 a NEW direct call is refused once the relationship is revoked',
  format($f$
    update chat.learner set teacher_id = %L
     where id = '33333333-3333-3333-3333-333333333336';
    insert into chat.conversation (id, type, family_id, direct_key)
      values ('b0000000-0000-0000-0000-00000000000b', 'direct', %L, 'pd6-d7');
    insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
      values ('c0000000-0000-0000-0000-00000000000b',
              'b0000000-0000-0000-0000-00000000000b', %L, %L, 'direct', 'pd6-room-d7');
    insert into chat.call_participant (call_id, actor_id, actor_kind)
      values ('c0000000-0000-0000-0000-00000000000b', %L, 'teacher'),
             ('c0000000-0000-0000-0000-00000000000b', %L, 'contact');
  $f$, :t_other, :fam, :fam, :t_real, :t_real, :p_real));

update chat.learner set teacher_id = :t_real
 where id = '33333333-3333-3333-3333-333333333336';

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

-- ===========================================================================
-- H · PD-7 · The PD-6 window: history stays, nothing new gets in
--
-- PD-6 (2026-09-23 .. 2026-10-14) allowed direct teacher<->parent
-- conversations and calls for an authorized pair, so such rows may exist. They
-- are written here with triggers disabled, which is how a row from before
-- 20261014120000 looks to the database today.
-- ===========================================================================
set session_replication_role = replica;
insert into chat.conversation (id, type, family_id, direct_key)
  values ('f0000000-0000-0000-0000-000000000001', 'direct', :fam, 'pd6-era');
insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values ('f0000000-0000-0000-0000-000000000001', 'teacher', :t_real, 'teacher'),
         ('f0000000-0000-0000-0000-000000000001', 'contact', :p_real, 'parent');
insert into chat.call (id, conversation_id, family_id, initiator_id, type, room_name)
  values ('f1000000-0000-0000-0000-000000000001',
          'f0000000-0000-0000-0000-000000000001', :fam, :t_real, 'direct', 'pd6-era-room');
insert into chat.call_participant (call_id, actor_id, actor_kind)
  values ('f1000000-0000-0000-0000-000000000001', :t_real, 'teacher'),
         ('f1000000-0000-0000-0000-000000000001', :p_real, 'contact');
set session_replication_role = origin;

-- The call lifecycle must survive: re-checking BR-1 on UPDATE would strand a
-- PD-6-era call ACTIVE forever.
select pg_temp.expect_ok(
  'D6 a PD-6-era direct call can still be ENDED',
  $f$
    update chat.call
       set status = 'ended', ended_at = now(), outcome = 'answered', duration_seconds = 30
     where id = 'f1000000-0000-0000-0000-000000000001';
  $f$);

select pg_temp.expect_violation(
  'H1 PD-7: the TEACHER may not post into a PD-6-era direct conversation',
  format($f$
    insert into chat.message (conversation_id, author_type, author_id, body, visibility)
      values ('f0000000-0000-0000-0000-000000000001', 'teacher', %L, 'hello', 'customer');
  $f$, :t_real));

select pg_temp.expect_violation(
  'H2 PD-7: the PARENT may not post into it either',
  format($f$
    insert into chat.message (conversation_id, author_type, author_id, body, visibility)
      values ('f0000000-0000-0000-0000-000000000001', 'contact', %L, 'hello', 'customer');
  $f$, :p_real));

select pg_temp.expect_ok(
  'H3 a SYSTEM message into it is still accepted (the backend may annotate history)',
  $f$
    insert into chat.message (conversation_id, author_type, author_id, body, visibility, origin)
      values ('f0000000-0000-0000-0000-000000000001', 'system', null, '{"kind":"note"}', 'customer', 'automation');
  $f$);

select pg_temp.expect_ok(
  'H4 a member may still LEAVE the PD-6-era conversation',
  format($f$
    update chat.conversation_member set left_at = now()
     where conversation_id = 'f0000000-0000-0000-0000-000000000001' and actor_id = %L;
  $f$, :p_real));

select pg_temp.expect_violation(
  'H5 PD-7: reviving the departed parent re-creates the pairing and is refused',
  format($f$
    update chat.conversation_member set left_at = null
     where conversation_id = 'f0000000-0000-0000-0000-000000000001' and actor_id = %L;
  $f$, :p_real));

select pg_temp.expect_ok(
  'H6 a teacher message into a Teacher <-> Admin direct is untouched by the message guard',
  format($f$
    insert into chat.message (conversation_id, author_type, author_id, body, visibility)
      values ('d0000000-0000-0000-0000-000000000001', 'teacher', %L, 'hello admin', 'customer');
  $f$, :teacher));

rollback;

\echo ''
\echo 'ALL BR-1 INVARIANT TESTS PASSED'
