-- Ownership, owner-locking and offboarding -- brief SS0, SS3, SS5, SS8, SS12.

select test.begin_suite('ownership');
select test.seed_operations();

-- owner_id is unreachable except through transfer_ownership() ---------------
select test.throws(
  format('update chat.family set owner_id = %L where id = %L',
         test.staff_id('Owner B'), test.family_id('Family A')),
  'a direct UPDATE of family.owner_id is refused', '23001');

select test.eq((select owner_id from chat.family where display_name = 'Family A'),
               test.staff_id('Owner A'),
               'the refused update left the owner unchanged');

-- Only a manager may transfer -----------------------------------------------
select set_config('chat.actor_staff_id', test.staff_id('Owner A')::text, false);
select test.throws(
  format('select chat.transfer_ownership(%L, %L, %L)',
         test.family_id('Family A'), test.staff_id('Owner B'), 'owner tries to hand over'),
  'an admin cannot transfer ownership', '42501');

select set_config('chat.actor_staff_id', test.staff_id('Coverage A')::text, false);
select test.throws(
  format('select chat.transfer_ownership(%L, %L, %L)',
         test.family_id('Family A'), test.staff_id('Coverage A'), 'coverage grabs the family'),
  'coverage cannot transfer ownership (brief SS5)', '42501');

-- Manager transfers ---------------------------------------------------------
select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);

select test.throws(
  format('select chat.transfer_ownership(%L, %L, %L)',
         test.family_id('Family A'), test.staff_id('Owner B'), '   '),
  'a transfer without a reason is refused', '23514');

select test.throws(
  format('select chat.transfer_ownership(%L, %L, %L)',
         test.family_id('Family A'), test.staff_id('Finance'), 'wrong role'),
  'ownership cannot move to a non-admin role', '23514');

-- A case and a task must survive the transfer.
insert into chat.support_case (thread_id, family_id, type, opened_by)
select t.id, t.family_id, 'technical', test.staff_id('Owner A')
from chat.thread t where t.family_id = test.family_id('Family A');

insert into chat.task (case_id, family_id, type, title, owner_id, created_by)
select c.id, c.family_id, 'technical', 'Check the audio pipeline',
       test.staff_id('Finance'), test.staff_id('Owner A')
from chat.support_case c where c.family_id = test.family_id('Family A');

select chat.transfer_ownership(test.family_id('Family A'), test.staff_id('Owner B'),
                               'Owner A moved to the onboarding desk');

select test.eq((select owner_id from chat.family where display_name = 'Family A'),
               test.staff_id('Owner B'),
               'a manager transfer moves the owner');

select test.eq((select count(*)::int from chat.audit_log
                where action = 'ownership_transferred'
                  and entity_id = test.family_id('Family A')
                  and reason = 'Owner A moved to the onboarding desk'), 1,
               'the transfer wrote an audit row carrying the reason');

select test.eq((select (before ->> 'owner_id')::uuid from chat.audit_log
                where action = 'ownership_transferred' limit 1),
               test.staff_id('Owner A'),
               'the audit row records who held the family before');

select test.eq((select count(*)::int from chat.support_case
                where family_id = test.family_id('Family A')), 1,
               'cases survive an ownership change');

select test.eq((select count(*)::int from chat.task
                where family_id = test.family_id('Family A')), 1,
               'tasks survive an ownership change');

-- Deactivation cannot orphan a family ---------------------------------------
select test.throws(
  format('update chat.staff set is_active = false, left_at = now() where id = %L',
         test.staff_id('Owner B')),
  'an owner with families cannot simply be deactivated', '23001');

-- Offboarding ---------------------------------------------------------------
select test.reset_data();
select test.seed_operations();
select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);

insert into chat.family (display_name, owner_id)
select 'Family A' || g, test.staff_id('Owner A') from generate_series(2, 4) g;

select test.eq((select count(*)::int from chat.family where owner_id = test.staff_id('Owner A')), 4,
               'owner A holds four families before offboarding');

select count(*)::int from chat.offboard_staff(test.staff_id('Owner A'), 'left the company');

select test.eq((select count(*)::int from chat.family where owner_id = test.staff_id('Owner A')), 0,
               'offboarding leaves no family owned by the departing admin');

select test.eq((select is_active from chat.staff where name = 'Owner A'), false,
               'the departing admin is deactivated');

select test.ok((select count(distinct owner_id)::int from chat.family) > 1,
               'families were spread across several admins rather than piled on one');

select test.eq((select count(*)::int from chat.audit_log where action = 'staff_offboarded'), 1,
               'offboarding wrote a single audit row');

select test.eq((select count(*)::int from chat.audit_log where action = 'ownership_transferred'), 4,
               'every reassignment is individually audited');

select test.ok((select count(*)::int from chat.orphaned_coverage_rule) > 0,
               'coverage rules referencing the departed admin are surfaced, not deleted');

-- Offboarding to a named admin ---------------------------------------------
select test.reset_data();
select test.seed_operations();
select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);
select count(*)::int from chat.offboard_staff(test.staff_id('Owner A'), 'maternity leave',
                                              test.staff_id('Owner D'));

select test.eq((select count(*)::int from chat.family where owner_id = test.staff_id('Owner D')), 1,
               'a named successor receives the families');

select set_config('chat.actor_staff_id', test.staff_id('Owner B')::text, false);
select test.throws(
  format('select * from chat.offboard_staff(%L, %L)', test.staff_id('Owner C'), 'not my call'),
  'an admin cannot offboard a colleague', '42501');

-- Owner-locking is computed from config -------------------------------------
select test.reset_data();
select test.seed_operations();

insert into chat.support_case (thread_id, family_id, type, severity)
select t.id, t.family_id, x.type, x.severity
from chat.thread t
join chat.family f on f.id = t.family_id and f.display_name = 'Family A'
cross join (values ('renewal', null), ('cancellation', null), ('onboarding', null),
                   ('at_risk', null), ('complaint', 'high'), ('complaint', 'low'),
                   ('technical', null), ('billing', null), ('general', null))
           as x(type, severity);

select test.eq((select count(*)::int from chat.support_case where owner_locked), 5,
               'renewal, cancellation, onboarding, at_risk and complaint[high] are owner-locked');

select test.ok(not (select owner_locked from chat.support_case
                    where type = 'complaint' and severity = 'low'),
               'a low-severity complaint is not owner-locked');

select test.ok(not (select owner_locked from chat.support_case where type = 'technical'),
               'an operational case is not owner-locked');

-- Changing the config changes the lock, without a deploy.
update chat.config set value = '["renewal"]'::jsonb where key = 'cases.owner_locked_types';
update chat.support_case set type = type;  -- re-evaluates the trigger

select test.eq((select count(*)::int from chat.support_case where owner_locked), 2,
               'narrowing the config narrows what is owner-locked (renewal + complaint[high])');

update chat.config
   set value = '["renewal","cancellation","onboarding","at_risk"]'::jsonb
 where key = 'cases.owner_locked_types';
update chat.support_case set type = type;

-- Coverage cannot close an owner-locked case --------------------------------
select set_config('chat.actor_staff_id', test.staff_id('Coverage A')::text, false);
select test.throws(
  format('update chat.support_case set status = %L, resolved_at = now() where id = %L',
         'resolved', (select id from chat.support_case where type = 'renewal')),
  'coverage cannot resolve an owner-locked case (brief SS5)', '42501');

select test.throws(
  format('update chat.support_case set status = %L, resolved_at = now(), closed_at = now() '
         'where id = %L', 'closed', (select id from chat.support_case where type = 'cancellation')),
  'coverage cannot close an owner-locked case either', '42501');

update chat.support_case set status = 'resolved', resolved_at = now()
 where type = 'technical';
select test.eq((select status from chat.support_case where type = 'technical'), 'resolved',
               'coverage can resolve an ordinary operational case');

-- The owner and the manager can.
select set_config('chat.actor_staff_id', test.staff_id('Owner A')::text, false);
update chat.support_case set status = 'resolved', resolved_at = now() where type = 'renewal';
select test.eq((select status from chat.support_case where type = 'renewal'), 'resolved',
               'the family owner may resolve her own owner-locked case');

select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);
update chat.support_case set status = 'resolved', resolved_at = now() where type = 'cancellation';
select test.eq((select status from chat.support_case where type = 'cancellation'), 'resolved',
               'a manager may resolve an owner-locked case');

select test.finish();
