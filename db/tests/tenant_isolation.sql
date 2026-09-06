-- Tenant isolation -- PRD v0.1 §2.3.
--
-- Two organizations exist for the length of this suite. Every assertion runs as
-- the `authenticated` role impersonating a real token subject, so the policies
-- and the composite keys are exercised rather than bypassed.

select test.begin_suite('tenant_isolation');

-- Organization A: the founding organization, seeded by the standard fixture.
select set_config('chat.organization_id',
                  (select id from chat.organization where slug = 'jawwid')::text, false);
select test.seed_operations();

-- Organization B.
do $$
begin
  if not exists (select 1 from chat.organization where slug = 'academy-b') then
    perform chat.bootstrap_organization('academy-b', 'Academy B');
  end if;
end;
$$;

select test.eq((select count(*)::int from chat.config c
                join chat.organization o on o.id = c.organization_id
                where o.slug = 'academy-b') > 0, true,
               'a new organization is bootstrapped with its own copy of the config');

select set_config('chat.organization_id',
                  (select id from chat.organization where slug = 'academy-b')::text, false);

insert into chat.staff (name, role, presence) values ('B Manager', 'manager', 'online');
insert into chat.staff (name, role, presence) values ('B Owner', 'admin', 'online');
-- Deliberately the SAME token subject organization A's owner uses: two academies
-- with two identity providers can mint the same subject.
select chat.link_staff_account((select id from chat.staff where name = 'B Owner'),
                               'staff:owner-a');
select chat.link_staff_account((select id from chat.staff where name = 'B Manager'),
                               'staff:b-manager');

insert into chat.family (display_name, owner_id)
values ('B Family', (select id from chat.staff where name = 'B Owner'));

select test.eq((select count(*)::int from chat.family), 3,
               'three families exist across the two organizations');

-- A colliding subject is accepted, and is not a way to reach two tenants -----
-- The explicit setting is cleared first: with it in place it would answer, and
-- the ambiguity this asserts on would never be reached.
select set_config('chat.organization_id', '', false);

select test.eq((select count(*)::int from chat.account where subject = 'staff:owner-a'), 2,
               'the same subject exists in both organizations');

select test.eq(test.count_as('staff:owner-a', 'select count(*)::int from chat.family'),
               0,
               'a subject that matches two organizations resolves to neither, and sees nothing');

-- Reading across organizations ---------------------------------------------
select test.eq(test.count_as('staff:manager', 'select count(*)::int from chat.family'),
               2, 'organization A''s manager sees only organization A''s two families');

select test.eq(test.count_as('staff:b-manager', 'select count(*)::int from chat.family'),
               1, 'organization B''s manager sees only organization B''s one family');

select test.eq(test.count_as('staff:b-manager',
                 format('select count(*)::int from chat.family where id = %L',
                        test.family_id('Family A'))),
               0, 'naming organization A''s family id explicitly returns nothing to B');

select test.eq(test.count_as('staff:manager',
                 'select count(*)::int from chat.staff'),
               8, 'and the staff roster does not leak across organizations either');

select test.eq(test.count_as('staff:b-manager', 'select count(*)::int from chat.audit_log'),
               0, 'organization B''s manager cannot read organization A''s audit log');

-- Mutating across organizations --------------------------------------------
select test.eq(test.count_as('staff:b-manager',
                 format($q$with attempt as (
                            update chat.family set display_name = 'HIJACKED'
                             where id = %L returning 1)
                          select count(*)::int from attempt$q$, test.family_id('Family A'))),
               0, 'organization B cannot update organization A''s family');

select test.eq((select display_name from chat.family where display_name = 'Family A'),
               'Family A', 'and the row is untouched');

select test.eq(test.count_as('staff:b-manager',
                 format($q$with attempt as (
                            update chat.support_case set status = 'closed'
                             where family_id = %L returning 1)
                          select count(*)::int from attempt$q$, test.family_id('Family A'))),
               0, 'nor any of its cases');

-- Writing a row stamped as another organization ----------------------------
select test.denied_for('staff:b-manager',
  format($q$insert into chat.family (display_name, owner_id, organization_id)
            values ('Smuggled', %L, %L)$q$,
         (select id from chat.staff where name = 'B Owner'),
         (select id from chat.organization where slug = 'jawwid')),
  'organization B cannot insert a row stamped as organization A', '42501');

-- organization_id is immutable ---------------------------------------------
select test.throws(
  format($q$update chat.family set organization_id = %L where id = %L$q$,
         (select id from chat.organization where slug = 'academy-b'),
         test.family_id('Family A')),
  'a family cannot be moved between organizations, even by the schema owner', '23001');

select test.throws(
  format($q$update chat.staff set organization_id = %L where name = 'Owner A'$q$,
         (select id from chat.organization where slug = 'academy-b')),
  'nor can a staff member', '23001');

select test.throws(
  format($q$update chat.config set organization_id = %L
             where key = 'attention.bucket.now'$q$,
         (select id from chat.organization where slug = 'academy-b')),
  'nor a configuration row', '23001');

-- Cross-organization references are unrepresentable -------------------------
select test.throws(
  format($q$insert into chat.family (display_name, owner_id, organization_id)
            values ('Cross owned', %L, %L)$q$,
         (select id from chat.staff where name = 'B Owner'),
         (select id from chat.organization where slug = 'jawwid')),
  'a family cannot be owned by a staff member in another organization', '23503');

select test.throws(
  format($q$insert into chat.learner (family_id, name, organization_id)
            values (%L, 'Smuggled learner', %L)$q$,
         test.family_id('Family A'),
         (select id from chat.organization where slug = 'academy-b')),
  'a learner cannot be attached to a family in another organization', '23503');

-- Jawwid Core ingestion cannot cross organizations --------------------------
-- The same Core identifier delivered to both organizations is two records, not
-- a collision: each Core instance owns its own id space.
select set_config('chat.organization_id',
                  (select id from chat.organization where slug = 'jawwid')::text, false);
select chat.ingest_core_teacher(jsonb_build_object(
  'core_teacher_id', '44444444-0000-0000-0000-0000000000aa',
  'display_name', 'A''s teacher'), '2026-09-06T10:00:00Z');

select set_config('chat.organization_id',
                  (select id from chat.organization where slug = 'academy-b')::text, false);
select chat.ingest_core_teacher(jsonb_build_object(
  'core_teacher_id', '44444444-0000-0000-0000-0000000000aa',
  'display_name', 'B''s teacher'), '2026-09-06T10:00:00Z');

select test.eq((select count(*)::int from chat.teacher
                where core_teacher_id = '44444444-0000-0000-0000-0000000000aa'), 2,
               'the same Core teacher id in two organizations creates two records');

select test.eq((select t.display_name from chat.teacher t
                join chat.organization o on o.id = t.organization_id
                where t.core_teacher_id = '44444444-0000-0000-0000-0000000000aa'
                  and o.slug = 'jawwid'),
               'A''s teacher',
               'and organization A''s record was not overwritten by organization B''s');

-- The same webhook event id from two Cores is two events.
select test.eq(chat.record_core_event('evt_shared', 'teacher.upserted'), true,
               'organization B records the event');
select set_config('chat.organization_id',
                  (select id from chat.organization where slug = 'jawwid')::text, false);
select test.eq(chat.record_core_event('evt_shared', 'teacher.upserted'), true,
               'organization A records the same event id independently');
select test.eq(chat.record_core_event('evt_shared', 'teacher.upserted'), false,
               'but a genuine replay inside one organization is still refused');

-- A parent id shared between two Cores does not merge two families.
select chat.ingest_core_parent(jsonb_build_object(
  'core_parent_id', '11111111-0000-0000-0000-0000000000aa',
  'display_name', 'A''s parent'), '2026-09-06T10:00:00Z');
select set_config('chat.organization_id',
                  (select id from chat.organization where slug = 'academy-b')::text, false);
select chat.ingest_core_parent(jsonb_build_object(
  'core_parent_id', '11111111-0000-0000-0000-0000000000aa',
  'display_name', 'B''s parent'), '2026-09-06T10:00:00Z');

select test.eq((select count(*)::int from chat.core_parent_inbox
                where core_parent_id = '11111111-0000-0000-0000-0000000000aa'), 2,
               'the same Core parent id waits separately in each organization');

-- Leave the database single-tenant again. Every other suite relies on
-- chat.current_organization_id() falling back to "the only organization", which
-- deliberately stops working while a second one exists.
select test.reset_data();
delete from chat.config
 where organization_id <> (select id from chat.organization where slug = 'jawwid');
delete from chat.organization where slug <> 'jawwid';

select test.eq((select count(*)::int from chat.organization), 1,
               'the suite leaves exactly the founding organization behind');

select set_config('chat.organization_id', '', false);
select test.finish();
