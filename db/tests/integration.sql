-- The Jawwid Core integration boundary and idempotency -- role contract SS26.

select test.begin_suite('integration');
select test.seed_operations();
select test.reset_core();

-- A parent, two children, a subscription and two payments in Jawwid Core.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'parent@example.test');

insert into public.profiles (id, full_name, preferred_language, role) values
  ('11111111-1111-1111-1111-111111111111', 'Ahmed Family', 'ar', 'parent');

insert into public.children (id, parent_id, name, age_band) values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'Yusuf', 9),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Maryam', 7);

insert into public.subscriptions (id, parent_id, status, current_period_end, renewal_date) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'active', '2026-10-01', '2026-09-20');

insert into public.payments (subscription_id, amount, status, created_at) values
  ('33333333-3333-3333-3333-333333333333', 120, 'succeeded', '2026-08-01'),
  ('33333333-3333-3333-3333-333333333333', 120, 'failed',    '2026-09-01');

-- A new family is never given an owner automatically -----------------------
select test.eq((select count(*)::int from chat.core_parent_awaiting_owner), 1,
               'the new Core parent is listed as awaiting an owner');

select test.throws(
  format('select chat.sync_from_core(%L)', '11111111-1111-1111-1111-111111111111'),
  'syncing a new family without naming an owner is refused (brief SS1)', '23514');

-- With an owner named by the manager ---------------------------------------
select chat.sync_from_core('11111111-1111-1111-1111-111111111111', test.staff_id('Owner A'));

select test.eq((select display_name from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'Ahmed Family', 'the family takes its name from Jawwid Core');

select test.eq((select count(*)::int from chat.core_parent_awaiting_owner), 0,
               'and drops off the awaiting-owner list');

select test.eq((select count(*)::int from chat.thread t
                join chat.family f on f.id = t.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'), 1,
               'exactly one thread is created for the family');

select test.eq((select count(*)::int from chat.learner l
                join chat.family f on f.id = l.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'), 2,
               'both children are mirrored as learners');

select test.eq((select renewal_due_at from chat.subscription s
                join chat.family f on f.id = s.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               '2026-09-20 00:00:00+00'::timestamptz,
               'the renewal date is mirrored from Core');

select test.eq((select last_payment_status from chat.subscription s
                join chat.family f on f.id = s.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'failed', 'the most recent payment, not the first, is the one mirrored');

select test.eq((select role_preset from chat.contact c
                join chat.family f on f.id = c.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'primary_guardian', 'the account holder becomes the Primary Guardian contact');

select test.ok((select can_message and can_manage_billing and can_cancel from chat.contact c
                join chat.family f on f.id = c.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'the Primary Guardian preset stores the full set of capability flags');

-- Re-syncing changes nothing ------------------------------------------------
select chat.sync_from_core('11111111-1111-1111-1111-111111111111', test.staff_id('Owner B'));
select chat.sync_from_core('11111111-1111-1111-1111-111111111111');

select test.eq((select count(*)::int from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'), 1,
               'syncing three times creates one family');

select test.eq((select count(*)::int from chat.contact c join chat.family f on f.id = c.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'), 1,
               'and one contact');

select test.eq((select count(*)::int from chat.learner l join chat.family f on f.id = l.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'), 2,
               'and still two learners');

select test.eq((select count(*)::int from chat.subscription s join chat.family f on f.id = s.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'), 1,
               'and one subscription');

select test.eq((select owner_id from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'),
               test.staff_id('Owner A'),
               'a later sync never reassigns ownership, even when handed another owner');

-- Core is the source of truth for its own fields ----------------------------
update public.profiles set full_name = 'Ahmed & Sons'
 where id = '11111111-1111-1111-1111-111111111111';
update public.payments set status = 'succeeded' where status = 'failed';
select chat.sync_from_core('11111111-1111-1111-1111-111111111111');

select test.eq((select display_name from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'Ahmed & Sons', 'a rename in Core flows through on the next sync');

select test.eq((select last_payment_status from chat.subscription s
                join chat.family f on f.id = s.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'succeeded', 'a payment correction in Core flows through too');

-- Webhook replay ------------------------------------------------------------
select test.eq(chat.record_core_event('evt_abc123', 'subscription.updated'), true,
               'the first delivery of an event is recorded');

select test.eq(chat.record_core_event('evt_abc123', 'subscription.updated'), false,
               'a replayed delivery of the same event is ignored');

select test.eq((select count(*)::int from chat.core_event where external_event_id = 'evt_abc123'), 1,
               'and leaves exactly one row');

select test.eq((select unprocessed_events::int from chat.sync_health where source = 'jawwid_core'), 1,
               'sync health counts the unprocessed event');

select chat.mark_core_event_processed('evt_abc123');
select test.eq((select unprocessed_events::int from chat.sync_health where source = 'jawwid_core'), 0,
               'and stops counting it once processed');

-- Message idempotency -------------------------------------------------------
select test.eq((select count(*)::int from chat.message), 0, 'no messages yet');

insert into chat.message (thread_id, author_type, author_id, body, visibility, client_id)
select t.id, 'contact', c.id, 'Sent once', 'customer', 'client-key-1'
from chat.thread t join chat.contact c on c.family_id = t.family_id
join chat.family f on f.id = t.family_id
where f.core_parent_id = '11111111-1111-1111-1111-111111111111';

select test.throws(
  format($q$insert into chat.message (thread_id, author_type, author_id, body, visibility, client_id)
            select t.id, 'contact', c.id, 'Sent once', 'customer', 'client-key-1'
            from chat.thread t join chat.contact c on c.family_id = t.family_id
            join chat.family f on f.id = t.family_id
            where f.core_parent_id = %L$q$, '11111111-1111-1111-1111-111111111111'),
  'a retried send with the same client id is refused', '23505');

select test.eq((select count(*)::int from chat.message where client_id = 'client-key-1'), 1,
               'the retry left exactly one message');

-- The same key on a different thread is a different message.
insert into chat.message (thread_id, author_type, author_id, on_behalf_mode, body, visibility, client_id)
select t.id, 'staff', test.staff_id('Owner A'), 'owner', 'Different family', 'customer', 'client-key-1'
from chat.thread t where t.family_id = test.family_id('Family A');

select test.eq((select count(*)::int from chat.message where client_id = 'client-key-1'), 2,
               'the same client id on another thread is a distinct message');

select test.finish();
