-- chat.on_duty() -- brief SS4.
--
-- Anchors (Africa/Cairo): Mon 2026-09-07, Fri 2026-09-11, Sat 2026-09-05.

select test.begin_suite('coverage');
select test.seed_operations();

-- Owner in shift -----------------------------------------------------------
select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               test.staff_id('Owner A'),
               'weekday midday: the owner handles her own family');

-- Owner off shift ----------------------------------------------------------
select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 19:00 Africa/Cairo'),
               test.staff_id('Coverage A'),
               'weeknight: owner A''s family routes to her configured coverage');

select test.eq(chat.on_duty(test.family_id('Family C'), '2026-09-07 19:00 Africa/Cairo'),
               test.staff_id('Coverage B'),
               'weeknight: owner C''s family routes to a different coverage admin');

-- Shift boundaries are half-open -------------------------------------------
select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 16:59 Africa/Cairo'),
               test.staff_id('Owner A'),
               'one minute before shift end the owner is still on duty');

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 17:00 Africa/Cairo'),
               test.staff_id('Coverage A'),
               'at 17:00 exactly the handover has happened');

-- Friday -------------------------------------------------------------------
select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-11 12:00 Africa/Cairo'),
               test.staff_id('Coverage A'),
               'Friday: the all-owners rule covers owner A');

select test.eq(chat.on_duty(test.family_id('Family C'), '2026-09-11 12:00 Africa/Cairo'),
               test.staff_id('Coverage A'),
               'Friday: the same admin covers owner C, not her weeknight coverage');

-- Nobody on duty -----------------------------------------------------------
select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 23:30 Africa/Cairo'),
               null::uuid,
               'after the last shift nobody is on duty: Unattended, never silently assigned');

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 08:00 Africa/Cairo'),
               null::uuid,
               'before the first shift the family is Unattended');

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-11 23:00 Africa/Cairo'),
               null::uuid,
               'late Friday, after the Friday shift ends, is Unattended');

-- The manager's catch-all rule keeps her in the chain but she has no shift,
-- which is exactly how uncovered hours surface as Unattended.
select test.ok(exists (
                 select 1 from chat.coverage_chain(test.staff_id('Owner A'),
                                                   '2026-09-07 23:30 Africa/Cairo')
                 where staff_id = test.staff_id('Manager')),
               'the manager is in the chain at 23:30 but is not on duty');

-- Absence ------------------------------------------------------------------
insert into chat.absence (staff_id, from_at, to_at, backup_id, type, activated_by)
values (test.staff_id('Owner A'), '2026-09-07 00:00 Africa/Cairo',
        '2026-09-08 00:00 Africa/Cairo', test.staff_id('Owner B'), 'planned',
        test.staff_id('Manager'));

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               test.staff_id('Owner B'),
               'absent owner with a backup who is on shift: the backup handles it');

-- Backup also absent -> the backup is refused and the chain continues.
insert into chat.absence (staff_id, from_at, to_at, type, activated_by)
values (test.staff_id('Owner B'), '2026-09-07 00:00 Africa/Cairo',
        '2026-09-08 00:00 Africa/Cairo', 'sick', test.staff_id('Manager'));

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               null::uuid,
               'absent owner whose backup is also absent falls through to Unattended, '
               'because outside_owner_shift coverage does not apply during the owner''s own shift');

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 19:00 Africa/Cairo'),
               test.staff_id('Coverage A'),
               'that same evening, normal coverage still applies');

select test.reset_data();
select test.seed_operations();

-- A backup who is not on shift is refused ----------------------------------
insert into chat.absence (staff_id, from_at, to_at, backup_id, type, activated_by)
values (test.staff_id('Owner A'), '2026-09-07 00:00 Africa/Cairo',
        '2026-09-08 00:00 Africa/Cairo', test.staff_id('Coverage A'), 'planned',
        test.staff_id('Manager'));

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               null::uuid,
               'a backup who is off shift at that moment is not activated');

select test.reset_data();
select test.seed_operations();

-- Deactivated staff are never on duty --------------------------------------
update chat.staff set is_active = false, left_at = now() where name = 'Coverage A';

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 19:00 Africa/Cairo'),
               null::uuid,
               'a deactivated coverage admin is dropped from the chain, not silently used');

update chat.staff set is_active = true, left_at = null where name = 'Coverage A';
update chat.staff set is_active = false, left_at = now() where name = 'Owner A';

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               null::uuid,
               'a deactivated owner is skipped: the family is Unattended until reassigned');

select test.reset_data();
select test.seed_operations();

-- Coverage is configuration, not code --------------------------------------
delete from chat.coverage_rule
 where covering_id = test.staff_id('Coverage A') and covered_id is null;

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-11 12:00 Africa/Cairo'),
               null::uuid,
               'removing the Friday rule changes the answer: nothing about Friday is hardcoded');

insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, priority)
values (test.staff_id('Coverage B'), null, array[5]::smallint[], 'all_day', 1);
insert into chat.shift (staff_id, days, starts, ends)
values (test.staff_id('Coverage B'), array[5]::smallint[], time '10:00', time '22:00');

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-11 12:00 Africa/Cairo'),
               test.staff_id('Coverage B'),
               'a different admin configured for Friday now covers it');

-- Priority ordering --------------------------------------------------------
insert into chat.coverage_rule (covering_id, covered_id, days, window_mode, priority)
values (test.staff_id('Coverage A'), null, array[5]::smallint[], 'all_day', 0);

select test.eq(chat.on_duty(test.family_id('Family A'), '2026-09-11 12:00 Africa/Cairo'),
               test.staff_id('Coverage A'),
               'a lower priority number wins when both admins are on shift');

-- Midnight-wrapping shifts -------------------------------------------------
select test.ok(chat.window_contains(timestamp '2026-09-08 00:30',
                                    array[1]::smallint[], time '22:00', time '02:00'),
               'a Monday 22:00-02:00 window still contains 00:30 on Tuesday');

select test.ok(not chat.window_contains(timestamp '2026-09-08 03:00',
                                        array[1]::smallint[], time '22:00', time '02:00'),
               'that window does not contain 03:00 on Tuesday');

select test.ok(not chat.window_contains(timestamp '2026-09-08 00:30',
                                        array[2]::smallint[], time '22:00', time '02:00'),
               'a Tuesday-anchored wrapping window does not contain 00:30 on Tuesday');

select test.finish();
