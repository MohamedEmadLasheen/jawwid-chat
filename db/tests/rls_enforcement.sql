-- Jawwid Chat -- row-level security, proved live.
--
-- Phase 0's finding was that RLS was DEFINED BUT INERT: seventeen tables had it
-- disabled outright, and no code ever set the session variables the policies
-- resolve the caller through. A false security boundary is worse than none,
-- because it gets cited as a control.
--
-- This file is the standing proof that it is a real one. Every assertion runs
-- as the `authenticated` role with a caller context set exactly the way
-- PrismaService.withActor() sets it -- so what is proved here is what the API
-- gets at runtime.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/rls_enforcement.sql
--
-- Companion: docs/security/RLS-STRATEGY.md section 7.

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  if ok then raise notice 'pass  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end; $$;

-- Become a caller, exactly as the API does per request.
create or replace function pg_temp.become(p_subject text)
returns void language plpgsql as $$
begin
  perform set_config('chat.actor_subject', p_subject, true);
  perform set_config('chat.actor_organization', '', true);
end; $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two supervisors, two families, one shared organization.
-- ---------------------------------------------------------------------------

insert into chat.account (id, subject, kind, status) values
  ('11110000-0000-0000-0000-000000000001', 'rls_admin_a', 'staff',  'active'),
  ('11110000-0000-0000-0000-000000000002', 'rls_admin_b', 'staff',  'active'),
  ('11110000-0000-0000-0000-000000000003', 'rls_manager', 'staff',  'active'),
  ('11110000-0000-0000-0000-000000000004', 'rls_parent_a','family', 'active'),
  ('11110000-0000-0000-0000-000000000005', 'rls_parent_b','family', 'active'),
  ('11110000-0000-0000-0000-000000000006', 'rls_teacher', 'teacher','active');

insert into chat.staff (id, account_id, name, role) values
  ('22220000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'rls_a', 'admin'),
  ('22220000-0000-0000-0000-000000000002', '11110000-0000-0000-0000-000000000002', 'rls_b', 'admin'),
  ('22220000-0000-0000-0000-000000000003', '11110000-0000-0000-0000-000000000003', 'rls_m', 'manager');

insert into chat.teacher (id, account_id, name) values
  ('33330000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000006', 'rls_t');

insert into chat.family (id, display_name, owner_id) values
  ('44440000-0000-0000-0000-000000000001', 'rls_family_a', '22220000-0000-0000-0000-000000000001'),
  ('44440000-0000-0000-0000-000000000002', 'rls_family_b', '22220000-0000-0000-0000-000000000002');

insert into chat.contact (id, account_id, family_id, name, role_preset, can_message,
                          can_view_progress, can_manage_schedule, can_manage_billing,
                          can_manage_contacts, can_cancel) values
  ('55550000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000004',
   '44440000-0000-0000-0000-000000000001', 'rls_parent_a', 'primary_guardian',
   true, true, true, true, true, true),
  ('55550000-0000-0000-0000-000000000002', '11110000-0000-0000-0000-000000000005',
   '44440000-0000-0000-0000-000000000002', 'rls_parent_b', 'primary_guardian',
   true, true, true, true, true, true);

insert into chat.learner (id, family_id, name, teacher_id) values
  ('66660000-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000001',
   'rls_learner', '33330000-0000-0000-0000-000000000001');

insert into chat.conversation (id, type, family_id, direct_key, title) values
  ('77770000-0000-0000-0000-000000000001', 'direct', '44440000-0000-0000-0000-000000000001',
   'rls:a', 'Jawwid'),
  ('77770000-0000-0000-0000-000000000002', 'direct', '44440000-0000-0000-0000-000000000002',
   'rls:b', 'Jawwid');

insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
  ('77770000-0000-0000-0000-000000000001', 'contact', '55550000-0000-0000-0000-000000000001', 'parent'),
  ('77770000-0000-0000-0000-000000000001', 'staff',   '22220000-0000-0000-0000-000000000001', 'admin'),
  ('77770000-0000-0000-0000-000000000002', 'contact', '55550000-0000-0000-0000-000000000002', 'parent'),
  ('77770000-0000-0000-0000-000000000002', 'staff',   '22220000-0000-0000-0000-000000000002', 'admin');

-- A staff-authored message must declare how it was sent (on_behalf_mode); the
-- database enforces it, which is why the internal note carries one here.
insert into chat.message (id, conversation_id, author_type, author_id, body, visibility,
                          on_behalf_mode, seq) values
  ('88880000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-000000000001',
   'contact', '55550000-0000-0000-0000-000000000001', 'family A says hello', 'customer', null, 1),
  ('88880000-0000-0000-0000-000000000002', '77770000-0000-0000-0000-000000000002',
   'contact', '55550000-0000-0000-0000-000000000002', 'family B says hello', 'customer', null, 1),
  ('88880000-0000-0000-0000-000000000003', '77770000-0000-0000-0000-000000000001',
   'staff', '22220000-0000-0000-0000-000000000001', 'an internal note', 'internal', 'owner', 2);

grant usage on schema chat to authenticated;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== A. the caller role does not bypass RLS ==='
-- ---------------------------------------------------------------------------
do $a$
begin
  perform pg_temp.check(
    'A1 the `authenticated` role is NOBYPASSRLS -- otherwise every policy below is theatre',
    not coalesce((select rolbypassrls from pg_roles where rolname = 'authenticated'), true));

  perform pg_temp.check(
    'A2 chat_app, the API''s connection role, is NOBYPASSRLS',
    not coalesce((select rolbypassrls from pg_roles where rolname = 'chat_app'), true));

  perform pg_temp.check(
    'A3 chat_service, the worker''s role, DOES bypass -- it acts for the system',
    coalesce((select rolbypassrls from pg_roles where rolname = 'chat_service'), false));
end
$a$;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== B. an anonymous caller sees nothing ==='
-- ---------------------------------------------------------------------------
set local role authenticated;
do $b$
begin
  perform pg_temp.become('');
  perform pg_temp.check('B1 no families',      (select count(*) from chat.family) = 0);
  perform pg_temp.check('B2 no conversations', (select count(*) from chat.conversation) = 0);
  perform pg_temp.check('B3 no messages',      (select count(*) from chat.message) = 0);

  perform pg_temp.become('nobody-at-all');
  perform pg_temp.check('B4 an unknown subject is equally blind',
    (select count(*) from chat.conversation) = 0);
end
$b$;
reset role;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== C. a supervisor sees their own families and no others ==='
-- ---------------------------------------------------------------------------
set local role authenticated;
do $c$
begin
  perform pg_temp.become('rls_admin_a');

  perform pg_temp.check('C1 supervisor A sees family A',
    exists (select 1 from chat.family where id = '44440000-0000-0000-0000-000000000001'));
  perform pg_temp.check('C2 supervisor A does NOT see family B',
    not exists (select 1 from chat.family where id = '44440000-0000-0000-0000-000000000002'));
  perform pg_temp.check('C3 an unscoped SELECT returns only their own',
    (select count(*) from chat.family) = 1);

  perform pg_temp.check('C4 supervisor A sees conversation A',
    exists (select 1 from chat.conversation where id = '77770000-0000-0000-0000-000000000001'));
  perform pg_temp.check(
    'C5 naming family B''s conversation id directly still returns nothing (IDOR)',
    not exists (select 1 from chat.conversation where id = '77770000-0000-0000-0000-000000000002'));
  perform pg_temp.check(
    'C6 family B''s messages are invisible even when named by id',
    not exists (select 1 from chat.message where id = '88880000-0000-0000-0000-000000000002'));
end
$c$;
reset role;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== D. reassignment moves what the database will show ==='
-- ---------------------------------------------------------------------------
select chat.assign_family_supervisor(
  '44440000-0000-0000-0000-000000000001',
  '22220000-0000-0000-0000-000000000002',
  'the family moved',
  '22220000-0000-0000-0000-000000000003');

set local role authenticated;
do $d$
begin
  perform pg_temp.become('rls_admin_a');
  perform pg_temp.check('D1 the PREVIOUS supervisor can no longer see the family',
    not exists (select 1 from chat.family where id = '44440000-0000-0000-0000-000000000001'));
  perform pg_temp.check('D2 nor its conversation',
    not exists (select 1 from chat.conversation where id = '77770000-0000-0000-0000-000000000001'));

  perform pg_temp.become('rls_admin_b');
  perform pg_temp.check('D3 the NEW supervisor sees both families',
    (select count(*) from chat.family) = 2);
  perform pg_temp.check('D4 and the moved family''s conversation',
    exists (select 1 from chat.conversation where id = '77770000-0000-0000-0000-000000000001'));
end
$d$;
reset role;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== E. a family contact sees only their own family ==='
-- ---------------------------------------------------------------------------
set local role authenticated;
do $e$
begin
  perform pg_temp.become('rls_parent_a');

  perform pg_temp.check('E1 sees their own conversation',
    exists (select 1 from chat.conversation where id = '77770000-0000-0000-0000-000000000001'));
  perform pg_temp.check('E2 does NOT see another family''s conversation',
    not exists (select 1 from chat.conversation where id = '77770000-0000-0000-0000-000000000002'));
  perform pg_temp.check('E3 does NOT see another family''s messages',
    not exists (select 1 from chat.message where id = '88880000-0000-0000-0000-000000000002'));
  perform pg_temp.check(
    'E4 CANNOT see an internal note in their OWN conversation -- it is not merely hidden by a client',
    not exists (select 1 from chat.message where id = '88880000-0000-0000-0000-000000000003'));
  perform pg_temp.check('E5 sees their own customer-visible message',
    exists (select 1 from chat.message where id = '88880000-0000-0000-0000-000000000001'));
end
$e$;
reset role;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== F. a teacher sees the families they teach, and nothing else ==='
-- ---------------------------------------------------------------------------
set local role authenticated;
do $f$
begin
  perform pg_temp.become('rls_teacher');
  perform pg_temp.check(
    'F1 a teacher who is not a conversation member sees no conversation',
    (select count(*) from chat.conversation) = 0);
end
$f$;
reset role;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== G. a manager sees the organization ==='
-- ---------------------------------------------------------------------------
set local role authenticated;
do $g$
begin
  perform pg_temp.become('rls_manager');
  perform pg_temp.check('G1 a manager sees every family in the organization',
    (select count(*) from chat.family) = 2);
  perform pg_temp.check('G2 and every conversation in it',
    (select count(*) from chat.conversation) = 2);
end
$g$;
reset role;

-- ---------------------------------------------------------------------------
\echo ''
\echo '=== H. credentials and sessions are unreachable by construction ==='
-- ---------------------------------------------------------------------------
set local role authenticated;
do $h$
declare v_denied boolean;
begin
  -- No GRANT at all, so this is not "a policy returned no rows" -- the role has
  -- no privilege on the table. A policy mistake could not widen it.
  begin
    perform 1 from chat.account_credential;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check('H1 chat.account_credential is not readable by an authenticated caller', v_denied);

  begin
    perform 1 from chat.session;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check('H2 chat.session is not readable by an authenticated caller', v_denied);

  begin
    perform 1 from chat.account_token;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check('H3 chat.account_token is not readable by an authenticated caller', v_denied);

  begin
    perform 1 from chat.account;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check('H4 chat.account itself is not enumerable', v_denied);
end
$h$;
reset role;

rollback;

\echo ''
\echo 'ALL RLS ENFORCEMENT TESTS PASSED'
