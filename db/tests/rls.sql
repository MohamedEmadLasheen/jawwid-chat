-- Row level security -- brief SS2, SS5.
--
-- Every assertion runs as the Supabase `authenticated` role impersonating a
-- real auth user, so the policies are exercised rather than bypassed.

select test.begin_suite('rls');
select test.seed_operations();
select test.reset_core();

-- Two families with a signed-in parent each.
insert into chat.contact (family_id, app_user_id, name, role_preset, can_message)
values (test.family_id('Family A'), 'aaaaaaaa-0000-0000-0000-00000000000a',
        'Parent A', 'primary_guardian', true),
       (test.family_id('Family C'), 'cccccccc-0000-0000-0000-00000000000c',
        'Parent C', 'primary_guardian', true);

insert into chat.message (thread_id, author_type, author_id, body, visibility, created_at)
select t.id, 'contact', c.id, 'Public question from family A', 'customer',
       '2026-09-07 11:50 Africa/Cairo'
from chat.thread t join chat.contact c on c.family_id = t.family_id
where t.family_id = test.family_id('Family A');

insert into chat.message (thread_id, author_type, author_id, on_behalf_mode, body, visibility)
select t.id, 'staff', test.staff_id('Owner A'), 'owner',
       'INTERNAL: she is upset about the refund', 'internal'
from chat.thread t where t.family_id = test.family_id('Family A');

-- Staff visibility ----------------------------------------------------------
select test.eq(test.count_as(test.auth_of('Owner A'), 'select count(*) from chat.family'),
               2, 'an admin can open any family (brief SS5)');

select test.eq(test.count_as(test.auth_of('Manager'), 'select count(*) from chat.family'),
               2, 'the manager sees every family');

-- Brief SS2: department staff see only families they hold a task on.
select test.eq(test.count_as(test.auth_of('Finance'), 'select count(*) from chat.family'),
               0, 'finance staff see no families by default');

insert into chat.support_case (thread_id, family_id, type)
select t.id, t.family_id, 'billing' from chat.thread t
where t.family_id = test.family_id('Family A');

insert into chat.task (case_id, family_id, type, title, owner_id, created_by)
select c.id, c.family_id, 'finance', 'Reissue the invoice',
       test.staff_id('Finance'), test.staff_id('Owner A')
from chat.support_case c where c.family_id = test.family_id('Family A');

select test.eq(test.count_as(test.auth_of('Finance'), 'select count(*) from chat.family'),
               1, 'assigning a task lets finance see exactly that one family');

select test.eq(test.count_as(test.auth_of('Finance'), 'select count(*) from chat.task'),
               1, 'and exactly their own task');

select test.eq(test.count_as(test.auth_of('Owner B'),
                             'select count(*) from chat.task'),
               1, 'admins see tasks on families they can open');

-- The family side reaches no base table ------------------------------------
select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.family'),
               0, 'a parent selecting chat.family directly gets nothing back');

select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.message'),
               0, 'a parent selecting chat.message directly gets nothing back');

select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.staff'),
               0, 'a parent cannot enumerate Jawwid staff');

-- ...and sees only their own family through the views ----------------------
select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.my_family'),
               1, 'a parent sees exactly one family through chat.my_family');

select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.my_messages'),
               1, 'a parent sees only the customer-visible message');

select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             $q$select count(*) from chat.my_messages
                                where body like 'INTERNAL:%'$q$),
               0, 'an internal note is absent from the family view, not merely hidden');

select test.eq(test.count_as('cccccccc-0000-0000-0000-00000000000c',
                             'select count(*) from chat.my_messages'),
               0, 'another family sees none of family A''s messages');

select test.eq(test.count_as('cccccccc-0000-0000-0000-00000000000c',
                             'select count(*) from chat.my_family'),
               1, 'and sees only their own family');

-- The audit log is manager-only --------------------------------------------
select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);
select chat.transfer_ownership(test.family_id('Family C'), test.staff_id('Owner D'),
                               'balancing the desks');
select set_config('chat.actor_staff_id', '', false);

select test.eq(test.count_as(test.auth_of('Manager'), 'select count(*) from chat.audit_log'),
               1, 'the manager can read the audit log');

select test.eq(test.count_as(test.auth_of('Owner A'), 'select count(*) from chat.audit_log'),
               0, 'an admin cannot read the audit log (brief SS3)');

select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.audit_log'),
               0, 'a parent certainly cannot');

-- Who may speak to the family ----------------------------------------------
-- Midday Monday: Owner A is on duty for Family A, Coverage A is not.

select test.allowed_for(test.auth_of('Owner A'),
  format($q$insert into chat.message (thread_id, author_type, author_id, on_behalf_mode,
                                      body, visibility)
            select id, 'staff', %L, 'owner', 'Reply from the owner', 'customer'
            from chat.thread where family_id = %L$q$,
         test.staff_id('Owner A'), test.family_id('Family A')),
  'the owner may reply to her own family during her shift');

select test.denied_for(test.auth_of('Coverage A'),
  format($q$insert into chat.message (thread_id, author_type, author_id, on_behalf_mode,
                                      body, visibility)
            select id, 'staff', %L, 'coverage', 'Reply from coverage', 'customer'
            from chat.thread where family_id = %L$q$,
         test.staff_id('Coverage A'), test.family_id('Family A')),
  'coverage may not reply while the owner is on duty', '42501');

-- Brief SS2: finance staff never message families, task or no task.
select test.denied_for(test.auth_of('Finance'),
  format($q$insert into chat.message (thread_id, author_type, author_id, on_behalf_mode,
                                      body, visibility)
            select id, 'staff', %L, 'owner', 'Finance speaking', 'customer'
            from chat.thread where family_id = %L$q$,
         test.staff_id('Finance'), test.family_id('Family A')),
  'finance staff can never message a family, even one they hold a task on', '42501');

-- Brief SS5: any admin may write an internal note on any family at any time.
select test.allowed_for(test.auth_of('Coverage A'),
  format($q$insert into chat.message (thread_id, author_type, author_id, on_behalf_mode,
                                      body, visibility)
            select id, 'staff', %L, 'coverage', 'Note while off duty', 'internal'
            from chat.thread where family_id = %L$q$,
         test.staff_id('Coverage A'), test.family_id('Family A')),
  'any admin may write an internal note on any family at any time');

-- Nobody may post as somebody else.
select test.denied_for(test.auth_of('Coverage A'),
  format($q$insert into chat.message (thread_id, author_type, author_id, on_behalf_mode,
                                      body, visibility)
            select id, 'staff', %L, 'owner', 'Impersonating the owner', 'customer'
            from chat.thread where family_id = %L$q$,
         test.staff_id('Owner A'), test.family_id('Family A')),
  'a staff member cannot post under another staff member''s name', '42501');

-- Configuration is manager-only --------------------------------------------
-- RLS filters an UPDATE to zero rows rather than raising, so this asserts the
-- effect rather than an exception: the statement runs and changes nothing.
select test.eq(test.count_as(test.auth_of('Owner A'),
  $q$with denied as (
       update chat.config set value = '999' where key = 'attention.bucket.now' returning 1)
     select count(*)::int from denied$q$),
  0, 'an admin editing the thresholds updates zero rows');

select test.eq((select value from chat.config where key = 'attention.bucket.now'),
               '60'::jsonb,
               'and the threshold is genuinely unchanged afterwards');

select test.allowed_for(test.auth_of('Manager'),
  $q$update chat.config set value = '60' where key = 'attention.bucket.now'$q$,
  'the manager can edit the weights and thresholds');

select test.denied_for(test.auth_of('Owner A'),
  format($q$insert into chat.shift (staff_id, days, starts, ends)
            values (%L, array[1]::smallint[], '09:00', '17:00')$q$,
         test.staff_id('Owner A')),
  'an admin cannot edit the roster', '42501');

-- The family-side write path ------------------------------------------------
select test.allowed_for('aaaaaaaa-0000-0000-0000-00000000000a',
  $q$select chat.post_customer_message('Following up on my question', 'mobile-key-1')$q$,
  'a permitted contact can post a message through the RPC');

select test.eq(test.count_as('aaaaaaaa-0000-0000-0000-00000000000a',
                             'select count(*) from chat.my_messages'),
               3, 'the parent now sees their two messages and the owner''s reply');

update chat.contact set can_message = false
 where app_user_id = 'aaaaaaaa-0000-0000-0000-00000000000a';

select test.denied_for('aaaaaaaa-0000-0000-0000-00000000000a',
  $q$select chat.post_customer_message('Trying again', 'mobile-key-2')$q$,
  'a contact without can_message is refused by the server, not by the UI', '42501');

select test.denied_for('99999999-9999-9999-9999-999999999999',
  $q$select chat.post_customer_message('I am nobody', 'mobile-key-3')$q$,
  'an account with no Jawwid Chat contact cannot post at all', '42501');

select test.finish();
