-- TEST FIXTURE ONLY.
--
-- Builds the operating model from the brief's SS4 "Initial config" as DATA.
-- Staff are named by their function, not by the real operators' names,
-- precisely to demonstrate that no engine depends on who holds a seat:
--
--   Owner A..D   the four primary-owner admins
--   Coverage A   the coverage admin who also works Friday for every owner
--   Coverage B   the second coverage admin, weeknights only
--   Manager      no shift, catch-all rule at priority 99 -> surfaces Unattended
--
-- Shifts: owners Sat-Thu 09:00-17:00; Coverage A Sat-Thu 17:00-23:00 and
-- Fri 10:00-22:00; Coverage B Sat-Thu 17:00-23:00.

create or replace function test.reset_data()
returns void
language sql
as $$
  truncate chat.family_state_cache, chat.event_log, chat.audit_log, chat.handoff,
           chat.task, chat.message, chat.support_case, chat.thread,
           chat.family_note, chat.subscription, chat.learner, chat.contact,
           chat.family, chat.absence, chat.coverage_rule, chat.shift, chat.staff
    restart identity cascade;
$$;

create or replace function test.staff_id(p_name text)
returns uuid
language sql
stable
as $$ select id from chat.staff where name = p_name $$;

create or replace function test.family_id(p_name text)
returns uuid
language sql
stable
as $$ select id from chat.family where display_name = p_name $$;

create or replace function test.seed_operations()
returns void
language plpgsql
as $$
declare
  weekdays smallint[] := array[6,0,1,2,3,4]::smallint[];  -- Sat..Thu
  friday   smallint[] := array[5]::smallint[];
begin
  perform test.reset_data();

  insert into chat.staff (name, role, presence, auth_user_id) values
    ('Owner A',    'admin',    'online',  gen_random_uuid()),
    ('Owner B',    'admin',    'online',  gen_random_uuid()),
    ('Owner C',    'admin',    'online',  gen_random_uuid()),
    ('Owner D',    'admin',    'online',  gen_random_uuid()),
    ('Coverage A', 'coverage', 'online',  gen_random_uuid()),
    ('Coverage B', 'coverage', 'online',  gen_random_uuid()),
    ('Manager',    'manager',  'online',  gen_random_uuid()),
    ('Finance',    'finance',  'offline', gen_random_uuid());

  insert into chat.shift (staff_id, days, starts, ends)
  select test.staff_id(n), weekdays, time '09:00', time '17:00'
  from unnest(array['Owner A','Owner B','Owner C','Owner D']) n;

  insert into chat.shift (staff_id, days, starts, ends) values
    (test.staff_id('Coverage A'), weekdays, time '17:00', time '23:00'),
    (test.staff_id('Coverage A'), friday,   time '10:00', time '22:00'),
    (test.staff_id('Coverage B'), weekdays, time '17:00', time '23:00');
  -- Manager deliberately has no shift: her catch-all rule keeps her in the
  -- chain but never on duty, so uncovered hours surface as Unattended.

  -- Friday: Coverage A covers every owner.
  insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, priority)
  values (test.staff_id('Coverage A'), null, friday, 'all_day', 1);

  -- Weeknights: A covers owners A and B, B covers owners C and D.
  insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, priority)
  select test.staff_id('Coverage A'), test.staff_id(n), weekdays, 'outside_owner_shift', 1
  from unnest(array['Owner A','Owner B']) n;

  insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, priority)
  select test.staff_id('Coverage B'), test.staff_id(n), weekdays, 'outside_owner_shift', 1
  from unnest(array['Owner C','Owner D']) n;

  -- Manager catch-all, last in the chain.
  insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, priority)
  values (test.staff_id('Manager'), null, array[0,1,2,3,4,5,6]::smallint[], 'all_day', 99);

  insert into chat.family (display_name, owner_id) values
    ('Family A', test.staff_id('Owner A')),
    ('Family C', test.staff_id('Owner C'));

  insert into chat.thread (family_id)
  select id from chat.family;
end;
$$;

-- Clears the Jawwid Core shim so an integration suite starts from a known
-- state no matter what ran before it. auth.users is not dropped by the database
-- reset (it belongs to Supabase, not to this project), so it is cleared here.
create or replace function test.reset_core()
returns void
language sql
as $$
  delete from public.payments;
  delete from public.subscriptions;
  delete from public.children;
  delete from public.profiles;
  delete from auth.users;
$$;
