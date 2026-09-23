-- Jawwid Chat -- executable tests for the PD-6 relationship predicate.
--
-- Proves, against a real database built by the migration chain, that
-- chat.teacher_parent_authorized() answers TRUE for exactly the relationships
-- PD-6 authorizes and FALSE for everything else.
--
-- These are structural tests: they run as the database owner with the
-- application entirely out of the picture, which is the threat model the
-- predicate exists for. The API is one enforcement layer; this is the other,
-- and it has to be right on its own.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/relationship_predicate.sql
--
-- Exit code 0 and a final 'ALL PD-6 RELATIONSHIP PREDICATE TESTS PASSED' is the
-- pass condition. Any failure aborts with a non-zero exit.
--
-- SCOPE. This file owns the predicate: sections A-G test the function itself in
-- isolation, and section H proves it is actually wired to the backstop.
-- db/tests/br1_invariants.sql owns the full backstop matrix -- type
-- immutability, required admin presence, participant ceilings, every
-- legitimate channel -- and must keep passing alongside this file. Do not merge
-- the two: one answers "is the predicate right", the other "is the database
-- still guarded".

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Assertion helpers
-- ---------------------------------------------------------------------------

create or replace function pg_temp.want_true(p_label text, p_teacher uuid, p_contact uuid)
returns void
language plpgsql
as $$
declare
  v boolean;
begin
  select chat.teacher_parent_authorized(p_teacher, p_contact) into v;
  if v is null then
    raise exception 'FAIL [%]: predicate returned NULL; it must be a decision, never an unknown', p_label;
  end if;
  if not v then
    raise exception 'FAIL [%]: the predicate DENIED a relationship PD-6 authorizes', p_label;
  end if;
  raise notice 'pass  %', p_label;
end;
$$;

create or replace function pg_temp.want_false(p_label text, p_teacher uuid, p_contact uuid)
returns void
language plpgsql
as $$
declare
  v boolean;
begin
  select chat.teacher_parent_authorized(p_teacher, p_contact) into v;
  if v is null then
    raise exception 'FAIL [%]: predicate returned NULL; a predicate that guards a channel must fail closed, not unknown', p_label;
  end if;
  if v then
    raise exception 'FAIL [%]: the predicate AUTHORIZED a relationship PD-6 forbids', p_label;
  end if;
  raise notice 'pass  %', p_label;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Everything is rolled back at the end.
--
-- Unlike db/tests/br1_invariants.sql, synthetic actor ids are NOT sufficient
-- here. The old rule was decidable from actor_kind alone; PD-6 is decidable
-- only from the chain contact -> family -> learner -> teacher, so every row in
-- that chain has to be real.
--
-- Synthetic names only (QA gate G-16): no real staff name enters test data.
-- ---------------------------------------------------------------------------
begin;

-- Two organizations, to prove the tenant boundary rather than assume it.
insert into chat.organization (id, slug, display_name) values
  ('0a000000-0000-0000-0000-00000000000b', 'other-academy', 'Other Academy')
on conflict (id) do nothing;

\set org_a  '''00000000-0000-0000-0000-000000000001'''
\set org_b  '''0a000000-0000-0000-0000-00000000000b'''

insert into chat.staff (id, organization_id, name, role) values
  ('a1000000-0000-0000-0000-000000000001', :org_a::uuid, 'admin_a', 'admin'),
  ('a1000000-0000-0000-0000-00000000000b', :org_b::uuid, 'admin_b', 'admin');

-- Organization A: one family, four contacts, three learners, four teachers.
insert into chat.family (id, organization_id, display_name, owner_id) values
  ('f1000000-0000-0000-0000-000000000001', :org_a::uuid, 'family_one',
   'a1000000-0000-0000-0000-000000000001'),
  -- A second family in the same organization, so "unrelated" is a real other
  -- family rather than simply a missing row.
  ('f1000000-0000-0000-0000-000000000002', :org_a::uuid, 'family_two',
   'a1000000-0000-0000-0000-000000000001');

insert into chat.teacher (id, organization_id, name, is_active, left_at) values
  ('7e000000-0000-0000-0000-000000000001', :org_a::uuid, 'teacher_assigned',   true,  null),
  ('7e000000-0000-0000-0000-000000000002', :org_a::uuid, 'teacher_unrelated',  true,  null),
  ('7e000000-0000-0000-0000-000000000003', :org_a::uuid, 'teacher_inactive',   false, null),
  ('7e000000-0000-0000-0000-000000000004', :org_a::uuid, 'teacher_left',       true,  now()),
  -- Second learner in the same family taught by the SAME teacher: the
  -- duplicate-path case.
  ('7e000000-0000-0000-0000-000000000005', :org_a::uuid, 'teacher_second',     true,  null);

insert into chat.contact (id, organization_id, family_id, name, role_preset,
                          can_message, can_view_progress, can_manage_schedule,
                          can_manage_billing, can_manage_contacts, can_cancel,
                          is_active) values
  ('c0000000-0000-0000-0000-000000000001', :org_a::uuid, 'f1000000-0000-0000-0000-000000000001',
   'parent_ok',        'primary_guardian',   true,  true, true, true, true, true, true),
  ('c0000000-0000-0000-0000-000000000002', :org_a::uuid, 'f1000000-0000-0000-0000-000000000001',
   'parent_inactive',  'authorized_contact', true,  true, true, true, true, true, false),
  ('c0000000-0000-0000-0000-000000000003', :org_a::uuid, 'f1000000-0000-0000-0000-000000000001',
   'parent_no_message','authorized_contact', false, true, true, true, true, true, true),
  ('c0000000-0000-0000-0000-000000000004', :org_a::uuid, 'f1000000-0000-0000-0000-000000000002',
   'parent_other_fam', 'primary_guardian',   true,  true, true, true, true, true, true);

insert into chat.learner (id, organization_id, family_id, name, teacher_id) values
  -- family_one, taught by teacher_assigned
  ('1e000000-0000-0000-0000-000000000001', :org_a::uuid, 'f1000000-0000-0000-0000-000000000001',
   'learner_one', '7e000000-0000-0000-0000-000000000001'),
  -- family_one, a SECOND learner taught by a different teacher: proves the
  -- predicate matches on any learner, not only the first.
  ('1e000000-0000-0000-0000-000000000002', :org_a::uuid, 'f1000000-0000-0000-0000-000000000001',
   'learner_two', '7e000000-0000-0000-0000-000000000005'),
  -- family_one, a learner with NO teacher assigned at all.
  ('1e000000-0000-0000-0000-000000000003', :org_a::uuid, 'f1000000-0000-0000-0000-000000000001',
   'learner_three', null),
  -- family_two, taught by the inactive and the left teachers.
  ('1e000000-0000-0000-0000-000000000004', :org_a::uuid, 'f1000000-0000-0000-0000-000000000002',
   'learner_four', '7e000000-0000-0000-0000-000000000003'),
  ('1e000000-0000-0000-0000-000000000005', :org_a::uuid, 'f1000000-0000-0000-0000-000000000002',
   'learner_five', '7e000000-0000-0000-0000-000000000004');

-- Organization B: a complete, internally valid chain of its own. Every one of
-- its rows is legitimate; the ONLY thing wrong with pairing it against
-- organization A is the tenant boundary.
insert into chat.family (id, organization_id, display_name, owner_id) values
  ('f1000000-0000-0000-0000-0000000000b1', :org_b::uuid, 'family_b',
   'a1000000-0000-0000-0000-00000000000b');
insert into chat.teacher (id, organization_id, name) values
  ('7e000000-0000-0000-0000-0000000000b1', :org_b::uuid, 'teacher_b');
insert into chat.contact (id, organization_id, family_id, name, role_preset,
                          can_message, can_view_progress, can_manage_schedule,
                          can_manage_billing, can_manage_contacts, can_cancel) values
  ('c0000000-0000-0000-0000-0000000000b1', :org_b::uuid, 'f1000000-0000-0000-0000-0000000000b1',
   'parent_b', 'primary_guardian', true, true, true, true, true, true);
insert into chat.learner (id, organization_id, family_id, name, teacher_id) values
  ('1e000000-0000-0000-0000-0000000000b1', :org_b::uuid, 'f1000000-0000-0000-0000-0000000000b1',
   'learner_b', '7e000000-0000-0000-0000-0000000000b1');

\set t_assigned   '''7e000000-0000-0000-0000-000000000001'''
\set t_unrelated  '''7e000000-0000-0000-0000-000000000002'''
\set t_inactive   '''7e000000-0000-0000-0000-000000000003'''
\set t_left       '''7e000000-0000-0000-0000-000000000004'''
\set t_second     '''7e000000-0000-0000-0000-000000000005'''
\set t_b          '''7e000000-0000-0000-0000-0000000000b1'''

\set p_ok         '''c0000000-0000-0000-0000-000000000001'''
\set p_inactive   '''c0000000-0000-0000-0000-000000000002'''
\set p_nomsg      '''c0000000-0000-0000-0000-000000000003'''
\set p_other_fam  '''c0000000-0000-0000-0000-000000000004'''
\set p_b          '''c0000000-0000-0000-0000-0000000000b1'''

-- ===========================================================================
-- A · The authorized relationship
-- ===========================================================================

select pg_temp.want_true(
  'A1 assigned teacher + messaging contact of that learner''s family',
  :t_assigned::uuid, :p_ok::uuid);

select pg_temp.want_true(
  'A2 the same relationship is symmetric: argument order is fixed, the fact is not',
  :t_assigned::uuid, :p_ok::uuid);

-- PD-6 case 10: several learners in the family, the target teacher assigned to
-- one of them.
select pg_temp.want_true(
  'A3 family with several learners, teacher assigned to the second one',
  :t_second::uuid, :p_ok::uuid);

-- ===========================================================================
-- B · No relationship
-- ===========================================================================

select pg_temp.want_false(
  'B1 a teacher who teaches nobody in this family',
  :t_unrelated::uuid, :p_ok::uuid);

select pg_temp.want_false(
  'B2 a parent of another family, against a real assigned teacher',
  :t_assigned::uuid, :p_other_fam::uuid);

-- PD-6 case 11: the family HAS learners, none taught by this teacher. Distinct
-- from B1 only in emphasis, and worth stating: a family with children is not
-- thereby connected to every teacher.
select pg_temp.want_false(
  'B3 family has learners but none assigned to the target teacher',
  :t_unrelated::uuid, :p_ok::uuid);

-- ===========================================================================
-- C · Liveness of each party
-- ===========================================================================

select pg_temp.want_false(
  'C1 contact is inactive',
  :t_assigned::uuid, :p_inactive::uuid);

select pg_temp.want_false(
  'C2 contact cannot message (can_message = false)',
  :t_assigned::uuid, :p_nomsg::uuid);

select pg_temp.want_false(
  'C3 teacher is inactive, though genuinely assigned to a learner of that family',
  :t_inactive::uuid, :p_other_fam::uuid);

select pg_temp.want_false(
  'C4 teacher has left_at set, though is_active is still true',
  :t_left::uuid, :p_other_fam::uuid);

-- ===========================================================================
-- D · Tenant isolation
--
-- Both chains are internally valid. Only the organization differs, so a pass
-- here cannot be explained by anything else being wrong.
-- ===========================================================================

select pg_temp.want_true(
  'D1 control: organization B''s own chain is authorized within B',
  :t_b::uuid, :p_b::uuid);

select pg_temp.want_false(
  'D2 organization A teacher + organization B parent',
  :t_assigned::uuid, :p_b::uuid);

select pg_temp.want_false(
  'D3 organization B teacher + organization A parent',
  :t_b::uuid, :p_ok::uuid);

-- A cross-tenant learner row cannot be used as a bridge either: even if one
-- were written, the predicate requires the learner to share the contact's
-- organization. chat.enforce_same_organization() should refuse the row first;
-- this asserts the predicate would not be fooled if it did not.
do $$
declare
  v_bridged boolean;
begin
  begin
    insert into chat.learner (id, organization_id, family_id, name, teacher_id)
    values ('1e000000-0000-0000-0000-0000000000c1',
            '00000000-0000-0000-0000-000000000001',
            'f1000000-0000-0000-0000-000000000001',
            'learner_bridge',
            '7e000000-0000-0000-0000-0000000000b1');   -- organization B teacher
  exception when others then
    raise notice 'pass  D4 the database refused a cross-organization learner outright (%)', sqlstate;
    return;
  end;

  select chat.teacher_parent_authorized(
           '7e000000-0000-0000-0000-0000000000b1',
           'c0000000-0000-0000-0000-000000000001') into v_bridged;
  if v_bridged then
    raise exception
      'FAIL [D4]: a cross-organization learner row bridged two tenants through the predicate';
  end if;
  raise notice 'pass  D4 a cross-organization learner row does not bridge tenants';
end;
$$;

-- ===========================================================================
-- E · Revocation -- the case that makes this a live check rather than a grant
-- ===========================================================================

do $$
declare
  v boolean;
begin
  -- Established above (A1), but re-assert inside this block so the transition
  -- is proven here rather than inferred from an earlier test.
  select chat.teacher_parent_authorized(
           '7e000000-0000-0000-0000-000000000001',
           'c0000000-0000-0000-0000-000000000001') into v;
  if not v then
    raise exception 'FAIL [E1]: precondition -- the relationship should be authorized before revocation';
  end if;

  -- Jawwid Core reassigns the learner to a different teacher.
  update chat.learner
     set teacher_id = '7e000000-0000-0000-0000-000000000002'
   where id = '1e000000-0000-0000-0000-000000000001';

  select chat.teacher_parent_authorized(
           '7e000000-0000-0000-0000-000000000001',
           'c0000000-0000-0000-0000-000000000001') into v;
  if v then
    raise exception
      'FAIL [E1]: the relationship survived reassignment; the predicate is caching or reading a stale path';
  end if;
  raise notice 'pass  E1 reassigning learner.teacher_id revokes on the very next evaluation';

  -- And the teacher it moved TO is authorized from that moment, with no other
  -- change: the predicate tracks the data both ways.
  select chat.teacher_parent_authorized(
           '7e000000-0000-0000-0000-000000000002',
           'c0000000-0000-0000-0000-000000000001') into v;
  if not v then
    raise exception 'FAIL [E2]: the newly assigned teacher was not authorized';
  end if;
  raise notice 'pass  E2 the newly assigned teacher is authorized immediately';

  -- Put it back, so later assertions read the fixture as documented.
  update chat.learner
     set teacher_id = '7e000000-0000-0000-0000-000000000001'
   where id = '1e000000-0000-0000-0000-000000000001';
end;
$$;

-- Deactivating the contact revokes just as immediately.
do $$
declare
  v boolean;
begin
  update chat.contact set is_active = false
   where id = 'c0000000-0000-0000-0000-000000000001';
  select chat.teacher_parent_authorized(
           '7e000000-0000-0000-0000-000000000001',
           'c0000000-0000-0000-0000-000000000001') into v;
  if v then
    raise exception 'FAIL [E3]: deactivating the contact did not revoke the relationship';
  end if;
  raise notice 'pass  E3 deactivating the contact revokes on the next evaluation';

  update chat.contact set is_active = true
   where id = 'c0000000-0000-0000-0000-000000000001';
end;
$$;

-- Offboarding the teacher revokes just as immediately.
do $$
declare
  v boolean;
begin
  update chat.teacher set left_at = now()
   where id = '7e000000-0000-0000-0000-000000000001';
  select chat.teacher_parent_authorized(
           '7e000000-0000-0000-0000-000000000001',
           'c0000000-0000-0000-0000-000000000001') into v;
  if v then
    raise exception 'FAIL [E4]: offboarding the teacher did not revoke the relationship';
  end if;
  raise notice 'pass  E4 setting teacher.left_at revokes on the next evaluation';

  update chat.teacher set left_at = null
   where id = '7e000000-0000-0000-0000-000000000001';
end;
$$;

-- ===========================================================================
-- F · Fails closed on every unknown
--
-- A predicate that guards a channel must never answer "yes" because it could
-- not establish "no". NULL is not an acceptable answer either: a caller that
-- treats NULL as falsy by accident would be relying on a coincidence.
-- ===========================================================================

select pg_temp.want_false('F1 NULL teacher',  null, :p_ok::uuid);
select pg_temp.want_false('F2 NULL contact',  :t_assigned::uuid, null);
select pg_temp.want_false('F3 both NULL',     null, null);

select pg_temp.want_false(
  'F4 an id that exists in no table at all',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid);

-- The arguments are ids, never roles. Handing the predicate a contact id in the
-- teacher position must not authorize anything -- there is no branch where a
-- caller's framing of the arguments substitutes for the rows.
select pg_temp.want_false(
  'F5 arguments transposed: contact id passed as the teacher',
  :p_ok::uuid, :t_assigned::uuid);

select pg_temp.want_false(
  'F6 a staff id in the teacher position is not a teacher',
  'a1000000-0000-0000-0000-000000000001'::uuid, :p_ok::uuid);

-- A learner with no teacher assigned authorizes nobody, and in particular the
-- NULL teacher_id must not join to a NULL argument.
select pg_temp.want_false(
  'F7 a NULL teacher_id on a learner does not match a NULL argument',
  null, :p_ok::uuid);

-- ===========================================================================
-- G · The predicate is a function of the data, not of the reader
--
-- chat.teacher_parent_authorized is SECURITY DEFINER precisely so its answer
-- does not depend on who asks. chat.teacher has RLS enabled with a restrictive
-- organization policy and no permissive policy, so a caller-rights function
-- would read zero teacher rows and quietly deny every legitimate pair.
-- ===========================================================================

do $$
declare
  v_secdef boolean;
  v_path   text[];
begin
  select p.prosecdef, p.proconfig
    into v_secdef, v_path
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'chat' and p.proname = 'teacher_parent_authorized';

  if not coalesce(v_secdef, false) then
    raise exception
      'FAIL [G1]: chat.teacher_parent_authorized is not SECURITY DEFINER; under chat.teacher''s restrictive RLS it would deny every legitimate relationship';
  end if;
  raise notice 'pass  G1 the predicate runs as its owner, so its answer does not vary by reader';

  if v_path is null or not (v_path @> array['search_path=chat, pg_temp']) then
    raise exception
      'FAIL [G2]: SECURITY DEFINER without a pinned search_path (got %)', v_path;
  end if;
  raise notice 'pass  G2 search_path is pinned, as SECURITY DEFINER requires';
end;
$$;

-- PUBLIC must not hold execute on a SECURITY DEFINER function by default.
do $$
begin
  if has_function_privilege('public', 'chat.teacher_parent_authorized(uuid, uuid)', 'execute') then
    raise exception 'FAIL [G3]: PUBLIC may execute the predicate; the default grant was not revoked';
  end if;
  raise notice 'pass  G3 the default PUBLIC execute grant is revoked';
end;
$$;

-- ===========================================================================
-- H · The backstop now enforces the predicate
--
-- RE-VERSIONED 2026-09-23 by the PD-6 authorization switch. Until that switch
-- landed, this section asserted the OPPOSITE -- that the old BR-1 rule still
-- refused every direct teacher<->parent conversation -- and it is what caught
-- the switch the moment it was made. It now asserts the rule that replaced it.
--
-- db/tests/br1_invariants.sql carries the full backstop matrix. These two
-- assertions exist here so that this file, which owns the predicate, also
-- proves the predicate is actually WIRED to something. A predicate that is
-- correct and connected to nothing enforces nothing.
-- ===========================================================================

do $$
declare
  v_conv uuid := 'cc000000-0000-0000-0000-000000000001';
begin
  begin
    insert into chat.conversation (id, organization_id, type, direct_key, family_id)
    values (v_conv, '00000000-0000-0000-0000-000000000001', 'direct',
            'pd6-authorized-probe', 'f1000000-0000-0000-0000-000000000001');
    insert into chat.conversation_member (conversation_id, actor_id, actor_kind, member_role) values
      (v_conv, '7e000000-0000-0000-0000-000000000001', 'teacher', 'teacher'),
      (v_conv, 'c0000000-0000-0000-0000-000000000001', 'contact', 'parent');
    set constraints all immediate;
    set constraints all deferred;
    raise notice 'pass  H1 the backstop PERMITS a direct channel for an authorized relationship';
  exception
    when others then
      raise exception
        'FAIL [H1]: the backstop REFUSED an authorized teacher/parent direct conversation: % (%)',
        sqlerrm, sqlstate;
  end;
end;
$$;

do $$
declare
  v_conv uuid := 'cc000000-0000-0000-0000-000000000002';
begin
  begin
    insert into chat.conversation (id, organization_id, type, direct_key, family_id)
    values (v_conv, '00000000-0000-0000-0000-000000000001', 'direct',
            'pd6-unauthorized-probe', 'f1000000-0000-0000-0000-000000000001');
    insert into chat.conversation_member (conversation_id, actor_id, actor_kind, member_role) values
      -- teacher_unrelated teaches nobody in this family.
      (v_conv, '7e000000-0000-0000-0000-000000000002', 'teacher', 'teacher'),
      (v_conv, 'c0000000-0000-0000-0000-000000000001', 'contact', 'parent');
    set constraints all immediate;
    set constraints all deferred;
    raise exception
      'FAIL [H2]: the backstop ACCEPTED a direct teacher/parent conversation with no authorized relationship';
  exception
    when check_violation or restrict_violation then
      raise notice 'pass  H2 the backstop REFUSES a direct channel with no authorized relationship';
    when others then
      if sqlerrm like 'FAIL [H2]%' then raise; end if;
      raise exception 'FAIL [H2]: wrong error: % (%)', sqlerrm, sqlstate;
  end;
  set constraints all deferred;
end;
$$;

rollback;

\echo 'ALL PD-6 RELATIONSHIP PREDICATE TESTS PASSED'
