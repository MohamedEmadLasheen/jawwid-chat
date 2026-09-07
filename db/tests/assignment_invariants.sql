-- Jawwid Chat -- supervisor assignment invariants, proved against the database
-- with the application bypassed.
--
-- The service layer decides; these are the rules that hold even when it does
-- not run at all -- a manual SQL session, a future endpoint, a compromised API.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/assignment_invariants.sql
--
-- Companion: docs/architecture/SUPERVISOR-OWNERSHIP.md section 7.

\set ON_ERROR_STOP on
set client_min_messages = notice;

-- The whole file runs in ONE transaction that is rolled back at the end.
--
-- Cleaning up afterwards is not an option here: chat.audit_log and
-- chat.event_log are append-only by trigger -- correctly -- so a fixture that
-- produced an audit row could not be removed, and deleting the family would
-- cascade into logs the database refuses to delete. A rollback leaves nothing
-- behind without asking the database to forget anything it recorded.
begin;

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  if ok then raise notice 'pass  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end; $$;

/** Runs a statement and reports whether it was refused. */
create or replace function pg_temp.refused(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
  return true;
end; $$;

do $fixtures$
begin
  -- Deterministic ids so every assertion below can name them.
  insert into chat.account (id, subject, kind, status) values
    ('aa000000-0000-0000-0000-000000000001', 'assign_admin_a', 'staff', 'active'),
    ('aa000000-0000-0000-0000-000000000002', 'assign_admin_b', 'staff', 'active'),
    ('aa000000-0000-0000-0000-000000000003', 'assign_manager', 'staff', 'active'),
    ('aa000000-0000-0000-0000-000000000004', 'assign_finance', 'staff', 'active')
  ;

  insert into chat.staff (id, account_id, name, role, department) values
    ('bb000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'assign_a', 'admin', null),
    ('bb000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000002', 'assign_b', 'coverage_admin', null),
    ('bb000000-0000-0000-0000-000000000003', 'aa000000-0000-0000-0000-000000000003', 'assign_m', 'manager', null),
    ('bb000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000004', 'assign_f', 'admin', 'finance')
  ;

  insert into chat.family (id, display_name, owner_id) values
    ('cc000000-0000-0000-0000-000000000001', 'assign_family_1', 'bb000000-0000-0000-0000-000000000001')
  ;
end
$fixtures$;

\echo ''
\echo '=== A. creating a family opens its primary assignment ==='
do $a$
begin
  perform pg_temp.check(
    'A1 a family created with an owner has exactly one live primary assignment',
    (select count(*) from chat.family_assignment
      where family_id = 'cc000000-0000-0000-0000-000000000001'
        and kind = 'primary' and ended_at is null) = 1);

  perform pg_temp.check(
    'A2 that assignment names the owner',
    (select staff_id from chat.family_assignment
      where family_id = 'cc000000-0000-0000-0000-000000000001'
        and kind = 'primary' and ended_at is null)
    = 'bb000000-0000-0000-0000-000000000001');
end
$a$;

\echo ''
\echo '=== B. BR-4: one family, one primary supervisor ==='
do $b$
begin
  perform pg_temp.check(
    'B1 a second live primary assignment for the same family is refused',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000002', 'primary', 'a second owner')
    $x$));

  perform pg_temp.check(
    'B2 a TEMPORARY assignment alongside the primary is permitted -- that is cover',
    not pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000002', 'temporary',
              now() + interval '1 day', 'holiday cover')
    $x$));

  perform pg_temp.check(
    'B3 a temporary assignment with no end is refused: unbounded cover is not cover',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000002', 'temporary', 'forever')
    $x$));

  perform pg_temp.check(
    'B4 an assignment with a blank reason is refused',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000002', 'temporary', now() + interval '1 day', '   ')
    $x$));

  perform pg_temp.check(
    'B5 a window that ends before it starts is refused',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, starts_at, ends_at, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000002', 'temporary',
              now(), now() - interval '1 day', 'backwards')
    $x$));
end
$b$;

\echo ''
\echo '=== C. only an active, family-facing supervisor may hold a family ==='
do $c$
begin
  perform pg_temp.check(
    'C1 a DEPARTMENTAL staff member cannot be assigned a family',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000004', 'temporary', now() + interval '1 day', 'no')
    $x$));

  perform pg_temp.check(
    'C2 a MANAGER cannot be assigned a family: they supervise the operation, not families',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
      values ('cc000000-0000-0000-0000-000000000001',
              'bb000000-0000-0000-0000-000000000003', 'temporary', now() + interval '1 day', 'no')
    $x$));

  update chat.staff set is_active = false, left_at = now()
   where id = 'bb000000-0000-0000-0000-000000000002'
     and not exists (select 1 from chat.family_assignment
                      where staff_id = 'bb000000-0000-0000-0000-000000000002' and ended_at is null);

  perform pg_temp.check(
    'C3 an INACTIVE supervisor cannot be assigned a family',
    pg_temp.refused($x$
      insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
      select 'cc000000-0000-0000-0000-000000000001',
             'bb000000-0000-0000-0000-000000000002', 'temporary', now() + interval '1 day', 'no'
       where exists (select 1 from chat.staff
                      where id = 'bb000000-0000-0000-0000-000000000002' and not is_active)
    $x$)
    or exists (select 1 from chat.staff
                where id = 'bb000000-0000-0000-0000-000000000002' and is_active));
end
$c$;

\echo ''
\echo '=== D. reassignment is atomic, audited, and mirrored ==='
do $d$
declare v_previous uuid;
begin
  -- Reinstate the cover admin so they can receive the family.
  update chat.staff set is_active = true, left_at = null
   where id = 'bb000000-0000-0000-0000-000000000002';

  select staff_id into v_previous from chat.family_assignment
   where family_id = 'cc000000-0000-0000-0000-000000000001'
     and kind = 'primary' and ended_at is null;

  perform chat.assign_family_supervisor(
    'cc000000-0000-0000-0000-000000000001',
    'bb000000-0000-0000-0000-000000000002',
    'the family moved',
    'bb000000-0000-0000-0000-000000000003');

  perform pg_temp.check(
    'D1 exactly one live primary assignment survives the reassignment',
    (select count(*) from chat.family_assignment
      where family_id = 'cc000000-0000-0000-0000-000000000001'
        and kind = 'primary' and ended_at is null) = 1);

  perform pg_temp.check(
    'D2 it names the new supervisor',
    (select staff_id from chat.family_assignment
      where family_id = 'cc000000-0000-0000-0000-000000000001'
        and kind = 'primary' and ended_at is null)
    = 'bb000000-0000-0000-0000-000000000002');

  perform pg_temp.check(
    'D3 the previous assignment is ENDED, with its reason -- history, not a delete',
    exists (select 1 from chat.family_assignment
             where family_id = 'cc000000-0000-0000-0000-000000000001'
               and staff_id = v_previous and kind = 'primary'
               and ended_at is not null and ended_reason = 'the family moved'));

  perform pg_temp.check(
    'D4 family.owner_id mirrors the live primary assignment',
    (select owner_id from chat.family where id = 'cc000000-0000-0000-0000-000000000001')
    = 'bb000000-0000-0000-0000-000000000002');

  perform pg_temp.check(
    'D5 the reassignment is in the audit log, with its reason',
    exists (select 1 from chat.audit_log
             where entity = 'family'
               and entity_id = 'cc000000-0000-0000-0000-000000000001'
               and action = 'ownership_transferred'
               and reason = 'the family moved'));

  perform pg_temp.check(
    'D6 a reassignment with no reason is refused',
    pg_temp.refused($x$
      select chat.assign_family_supervisor(
        'cc000000-0000-0000-0000-000000000001',
        'bb000000-0000-0000-0000-000000000001', '  ',
        'bb000000-0000-0000-0000-000000000003')
    $x$));

  perform pg_temp.check(
    'D7 a NON-MANAGER cannot reassign a supervisor',
    pg_temp.refused($x$
      select chat.assign_family_supervisor(
        'cc000000-0000-0000-0000-000000000001',
        'bb000000-0000-0000-0000-000000000001', 'I would like this family',
        'bb000000-0000-0000-0000-000000000001')
    $x$));

  perform pg_temp.check(
    'D8 family.owner_id cannot be written directly, outside the assignment path',
    pg_temp.refused($x$
      update chat.family set owner_id = 'bb000000-0000-0000-0000-000000000001'
       where id = 'cc000000-0000-0000-0000-000000000001'
    $x$));
end
$d$;

\echo ''
\echo '=== E. scope follows the assignment, immediately ==='
do $e$
begin
  perform pg_temp.check(
    'E1 the new supervisor is in scope',
    chat.staff_in_scope('cc000000-0000-0000-0000-000000000001',
                        'bb000000-0000-0000-0000-000000000002'));

  perform pg_temp.check(
    'E2 the previous supervisor is NOT -- no cache, no session to wait out',
    not chat.staff_in_scope('cc000000-0000-0000-0000-000000000001',
                            'bb000000-0000-0000-0000-000000000001'));

  perform pg_temp.check(
    'E3 a manager reaches the family without an assignment: organization-wide',
    chat.staff_in_scope('cc000000-0000-0000-0000-000000000001',
                        'bb000000-0000-0000-0000-000000000003'));

  perform pg_temp.check(
    'E4 a departmental staff member reaches nothing',
    not chat.staff_in_scope('cc000000-0000-0000-0000-000000000001',
                            'bb000000-0000-0000-0000-000000000004'));

  -- An expired temporary window grants nothing, with no sweep having run.
  insert into chat.family_assignment (family_id, staff_id, kind, starts_at, ends_at, reason)
  values ('cc000000-0000-0000-0000-000000000001',
          'bb000000-0000-0000-0000-000000000001', 'temporary',
          now() - interval '2 days', now() - interval '1 day', 'expired cover');

  perform pg_temp.check(
    'E5 an EXPIRED temporary assignment grants nothing, sweep or no sweep',
    not chat.staff_in_scope('cc000000-0000-0000-0000-000000000001',
                            'bb000000-0000-0000-0000-000000000001'));
end
$e$;

\echo ''
\echo '=== F. a supervisor holding families cannot simply be deactivated ==='
do $f$
begin
  perform pg_temp.check(
    'F1 deactivating a supervisor who still holds a family is refused',
    pg_temp.refused($x$
      update chat.staff set is_active = false, left_at = now()
       where id = 'bb000000-0000-0000-0000-000000000002'
    $x$));
end
$f$;

rollback;

\echo ''
\echo 'ALL SUPERVISOR ASSIGNMENT INVARIANTS PASSED'
