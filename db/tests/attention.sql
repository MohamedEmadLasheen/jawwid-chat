-- Attention and workload engines -- brief SS6, SS7, SS12.
--
-- Reference moment: Monday 2026-09-07 12:00 Africa/Cairo, inside every owner's
-- shift. Response target there is 30 minutes (now_other/day), or 10 minutes
-- once a blocking case exists (now_blocking/day).

select test.begin_suite('attention');
select test.seed_operations();

insert into chat.contact (family_id, name, role_preset, can_message)
select id, 'Parent of ' || display_name, 'primary_guardian', true
from chat.family;

-- Nothing happening ---------------------------------------------------------
select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               0::numeric, 'a family with no activity scores zero');

select test.eq(chat.attention_bucket(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               'quiet', 'a family nobody has messaged is QUIET, not waiting on the family');

select test.eq(chat.response_target_minutes(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               30, 'inside the owner shift the non-blocking target is 30 minutes');

select test.eq(chat.response_target_minutes(test.family_id('Family A'), '2026-09-07 19:00 Africa/Cairo'),
               45, 'at night the target relaxes to 45 minutes');

select test.eq(chat.response_target_minutes(test.family_id('Family A'), '2026-09-11 12:00 Africa/Cairo'),
               60, 'on Friday the target is 60 minutes');

-- An unanswered customer message -------------------------------------------
insert into chat.message (thread_id, author_type, author_id, body, visibility, created_at)
select t.id, 'contact', c.id, 'The class link is not working', 'customer',
       '2026-09-07 11:50 Africa/Cairo'
from chat.thread t
join chat.contact c on c.family_id = t.family_id
where t.family_id = test.family_id('Family A');

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               40::numeric, '10 minutes unanswered scores 30 base + 10 waiting');

select test.eq(chat.attention_bucket(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               'today', 'that puts the family in TODAY');

select test.eq(chat.attention_top_reason(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               'waiting 10 minutes for a reply',
               'the top reason is readable text, not a number or a priority label');

-- The waiting component is capped, and the target breach adds on top.
select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 13:20 Africa/Cairo'),
               110::numeric,
               '90 minutes unanswered: 30 + capped 40 waiting + 40 for the breached target');

select test.eq(chat.attention_bucket(test.family_id('Family A'), '2026-09-07 13:20 Africa/Cairo'),
               'now', 'a breached target puts the family in NOW');

-- 25 minutes waiting is past 70% of the 30 minute target but not past it.
select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:15 Africa/Cairo'),
               (30 + 25 + 20)::numeric,
               'at 70% of the target the at-risk points apply instead of the breach points');

-- An internal note is not a reply -------------------------------------------
insert into chat.message (thread_id, author_type, author_id, on_behalf_mode, body, visibility, created_at)
select t.id, 'staff', test.staff_id('Owner A'), 'owner', 'Checking with technical', 'internal',
       '2026-09-07 11:55 Africa/Cairo'
from chat.thread t where t.family_id = test.family_id('Family A');

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               40::numeric,
               'writing an internal note does not make a waiting family look answered');

-- A real reply clears it ----------------------------------------------------
insert into chat.message (thread_id, author_type, author_id, on_behalf_mode, body, visibility, created_at)
select t.id, 'staff', test.staff_id('Owner A'), 'owner', 'Sending a new link now', 'customer',
       '2026-09-07 11:58 Africa/Cairo'
from chat.thread t where t.family_id = test.family_id('Family A');

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               0::numeric, 'a customer-visible reply clears the unanswered signal');

select test.eq(chat.attention_bucket(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               'waiting_on_family', 'staff spoke last and nothing is due: WAITING ON FAMILY');

-- Blocking issues tighten the target and add points -------------------------
select test.reset_data();
select test.seed_operations();
insert into chat.contact (family_id, name, role_preset, can_message)
select id, 'Parent', 'primary_guardian', true from chat.family;

insert into chat.message (thread_id, author_type, author_id, body, visibility, created_at)
select t.id, 'contact', c.id, 'She cannot join at all', 'customer',
       '2026-09-07 11:50 Africa/Cairo'
from chat.thread t join chat.contact c on c.family_id = t.family_id
where t.family_id = test.family_id('Family A');

insert into chat.support_case (thread_id, family_id, type, is_blocking)
select t.id, t.family_id, 'technical', true
from chat.thread t where t.family_id = test.family_id('Family A');

select test.eq(chat.response_target_minutes(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               10, 'an open blocking case tightens the target to 10 minutes');

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               (30 + 10 + 40 + 35)::numeric,
               'unanswered + breached tighter target + blocking issue');

-- Tier is a multiplier, not an addition -------------------------------------
update chat.family set tier = 'priority', tier_reason = 'founding family'
 where display_name = 'Family A';

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               round(115 * 1.2, 2),
               'a priority family is multiplied by 1.2, not given a flat bonus');

-- Renewal urgency is owner-only ---------------------------------------------
select test.reset_data();
select test.seed_operations();

insert into chat.subscription (family_id, status, renewal_due_at)
values (test.family_id('Family A'), 'active', '2026-09-09 12:00 Africa/Cairo');

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo',
                                    test.staff_id('Owner A')),
               25::numeric, 'the owner sees the urgent renewal signal at two days out');

select test.eq(chat.attention_score(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo',
                                    test.staff_id('Coverage A')),
               0::numeric,
               'coverage is not pushed a renewal decision she is not allowed to make');

-- Thresholds are configuration ----------------------------------------------
select test.reset_data();
select test.seed_operations();
insert into chat.contact (family_id, name, role_preset, can_message)
select id, 'Parent', 'primary_guardian', true from chat.family;
insert into chat.message (thread_id, author_type, author_id, body, visibility, created_at)
select t.id, 'contact', c.id, 'Hello', 'customer', '2026-09-07 11:50 Africa/Cairo'
from chat.thread t join chat.contact c on c.family_id = t.family_id
where t.family_id = test.family_id('Family A');

select test.eq(chat.attention_bucket(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               'today', 'scoring 40 lands in TODAY under the seeded thresholds');

update chat.config set value = '35' where key = 'attention.bucket.now';
select test.eq(chat.attention_bucket(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo'),
               'now', 'lowering the NOW threshold in config moves the family, with no deploy');
update chat.config set value = '60' where key = 'attention.bucket.now';

-- The cache -----------------------------------------------------------------
select chat.recompute_family_state(test.family_id('Family A'), '2026-09-07 12:00 Africa/Cairo');
select test.eq((select on_duty_id from chat.family_state_cache
                where family_id = test.family_id('Family A')),
               test.staff_id('Owner A'), 'the cache records who is on duty');
select test.eq((select bucket from chat.family_state_cache
                where family_id = test.family_id('Family A')),
               'today', 'the cache records the bucket');

select chat.recompute_family_state(test.family_id('Family A'), '2026-09-07 23:30 Africa/Cairo');
select test.eq((select on_duty_id from chat.family_state_cache
                where family_id = test.family_id('Family A')),
               null::uuid, 'out of hours the cache shows nobody on duty: the Unattended list');

select test.finish();
