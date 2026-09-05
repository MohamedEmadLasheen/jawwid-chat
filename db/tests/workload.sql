-- Workload engine -- brief SS7, SS12.

select test.begin_suite('workload');
select test.reset_data();
select test.seed_operations();

-- Brief SS7: "Number of families is never part of workload."
insert into chat.family (display_name, owner_id)
select 'Quiet family ' || g, test.staff_id('Owner A') from generate_series(1, 20) g;
insert into chat.thread (family_id)
select id from chat.family f where not exists (select 1 from chat.thread t where t.family_id = f.id);

select test.eq((select count(*)::int from chat.families_on_duty(test.staff_id('Owner A'),
                                                                '2026-09-07 12:00 Africa/Cairo')),
               21, 'owner A is on duty for 21 families at midday');

select test.eq(chat.workload_score(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               0::numeric, 'twenty-one quiet families are zero workload');

select test.eq(chat.workload_level(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               'LOW', 'and the level stays LOW');

-- Real work counts ----------------------------------------------------------
insert into chat.contact (family_id, name, role_preset, can_message)
select id, 'Parent', 'primary_guardian', true from chat.family;

insert into chat.message (thread_id, author_type, author_id, body, visibility, created_at)
select t.id, 'contact', c.id, 'Question', 'customer', '2026-09-07 11:55 Africa/Cairo'
from chat.thread t
join chat.contact c on c.family_id = t.family_id
join chat.family f on f.id = t.family_id
where f.owner_id = test.staff_id('Owner A')
  and f.display_name in ('Family A', 'Quiet family 1', 'Quiet family 2');

select test.eq((select count from chat.workload_units(test.staff_id('Owner A'),
                                                      '2026-09-07 12:00 Africa/Cairo')
                where unit = 'needs_reply'), 3, 'three families are waiting for a reply');

select test.eq(chat.workload_score(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               3::numeric, 'three unanswered families weigh 3.0');

-- Cases add their own weight, and complaints weigh more than the base case.
insert into chat.support_case (thread_id, family_id, type, severity)
select t.id, t.family_id, 'complaint', 'high'
from chat.thread t where t.family_id = test.family_id('Family A');

select test.eq(chat.workload_score(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               (3 + 1.0 + 1.5)::numeric,
               'an open complaint adds the active-case weight plus the complaint weight');

-- Levels are config-driven --------------------------------------------------
select test.eq(chat.workload_level(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               'LOW', 'a score of 5.5 is still LOW');

update chat.config set value = '4' where key = 'workload.level.medium';
select test.eq(chat.workload_level(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               'MEDIUM', 'lowering the MEDIUM threshold in config raises the level');
update chat.config set value = '8' where key = 'workload.level.medium';

-- capacity_override replaces the HIGH threshold for one person.
update chat.staff set capacity_override = 5 where id = test.staff_id('Owner A');
select test.eq(chat.workload_level(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               'HIGH', 'a personal capacity override lowers that admin''s HIGH threshold');
update chat.staff set capacity_override = null where id = test.staff_id('Owner A');

-- A burst of unanswered families is HIGH whatever the score.
update chat.config set value = '3' where key = 'workload.reply_burst';
select test.eq(chat.workload_level(test.staff_id('Owner A'), '2026-09-07 12:00 Africa/Cairo'),
               'HIGH', 'reaching the reply burst forces HIGH regardless of the score');
update chat.config set value = '6' where key = 'workload.reply_burst';

-- Covered families count fully on the covering admin ------------------------
select test.eq(chat.workload_score(test.staff_id('Coverage A'), '2026-09-07 12:00 Africa/Cairo'),
               0::numeric, 'at midday the coverage admin carries none of this');

-- By the evening those three messages have blown through the 45 minute night
-- target, so each also counts as an SLA risk on top of its needs_reply unit.
select test.eq(chat.workload_score(test.staff_id('Coverage A'), '2026-09-07 19:00 Africa/Cairo'),
               (3 + 1.0 + 1.5 + 4.5)::numeric,
               'in the evening the same work counts fully on the covering admin, '
               'now carrying SLA risk as well');

select test.eq(chat.workload_score(test.staff_id('Owner A'), '2026-09-07 19:00 Africa/Cairo'),
               0::numeric, 'and no longer on the owner, who is off shift');

select test.finish();
