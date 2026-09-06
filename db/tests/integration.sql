-- The Jawwid Core integration boundary.
--
-- Jawwid Core is a separate product in a separate database. Nothing here reads
-- it. Every fixture below is an integration-boundary payload, written against
-- the contract in docs/architecture/backend-contract.md §9 -- not against any
-- other repository's schema.

select test.begin_suite('integration');
select test.seed_operations();
select test.reset_core();

-- A parent Jawwid Chat has not seen before -------------------------------
select test.eq(chat.ingest_core_parent(jsonb_build_object(
                 'core_parent_id', '11111111-1111-1111-1111-111111111111',
                 'display_name',   'Ahmed Family',
                 'language',       'ar')),
               null::uuid,
               'a parent with no family yet returns no family id');

select test.eq((select count(*)::int from chat.core_parent_inbox), 1,
               'and waits in the inbox for a manager to name an owner');

-- Re-delivery converges rather than duplicating.
select chat.ingest_core_parent(jsonb_build_object(
         'core_parent_id', '11111111-1111-1111-1111-111111111111',
         'display_name',   'Ahmed Family',
         'language',       'ar'));
select test.eq((select count(*)::int from chat.core_parent_inbox), 1,
               're-delivering the same parent leaves one waiting row');

-- A learner for a family that does not exist yet is simply not applied.
select test.eq(chat.ingest_core_learner(jsonb_build_object(
                 'core_child_id',  '22222222-2222-2222-2222-222222222221',
                 'core_parent_id', '11111111-1111-1111-1111-111111111111',
                 'name',           'Yusuf')),
               null::uuid,
               'a learner arriving before its family is ignored, not an error');

select test.eq((select count(*)::int from chat.learner), 0,
               'and creates nothing');

-- Naming an owner is a manager decision ------------------------------------
select set_config('chat.actor_staff_id', test.staff_id('Owner A')::text, false);
select test.throws(
  format('select chat.assign_family_owner(%L, %L, %L)',
         '11111111-1111-1111-1111-111111111111', test.staff_id('Owner A'), 'I will take it'),
  'an admin cannot give herself a waiting family', '42501');

select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);
select test.throws(
  format('select chat.assign_family_owner(%L, %L, %L)',
         '11111111-1111-1111-1111-111111111111', test.staff_id('Owner A'), '  '),
  'assigning an owner without a reason is refused', '23514');

select test.throws(
  format('select chat.assign_family_owner(%L, %L, %L)',
         '11111111-1111-1111-1111-111111111111', test.staff_id('Finance'), 'wrong role'),
  'a family cannot be owned by a department staff member', '23514');

select chat.assign_family_owner('11111111-1111-1111-1111-111111111111',
                                test.staff_id('Owner A'), 'new family, Owner A has capacity');

select test.eq((select display_name from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'Ahmed Family', 'the family is created from the waiting payload');

select test.eq((select count(*)::int from chat.core_parent_inbox), 0,
               'and leaves the waiting list');

select test.eq((select count(*)::int from chat.thread t join chat.family f on f.id = t.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'), 1,
               'exactly one thread is created');

select test.eq((select role_preset from chat.contact c join chat.family f on f.id = c.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'primary_guardian', 'the account holder becomes the Primary Guardian');

select test.eq((select account_id from chat.contact c join chat.family f on f.id = c.family_id
                where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
               null::uuid,
               'that contact has no account until they actually sign in');

select test.eq((select count(*)::int from chat.audit_log where action = 'family_owner_assigned'), 1,
               'naming an owner is audited with its reason');

-- Now the same payloads apply --------------------------------------------
select test.eq(chat.ingest_core_parent(jsonb_build_object(
                 'core_parent_id', '11111111-1111-1111-1111-111111111111',
                 'display_name',   'Ahmed & Sons',
                 'language',       'ar')),
               (select id from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'once the family exists the same payload updates it');

select test.eq((select display_name from chat.family
                where core_parent_id = '11111111-1111-1111-1111-111111111111'),
               'Ahmed & Sons', 'a rename in Core flows through the boundary');

select chat.ingest_core_learner(jsonb_build_object(
         'core_child_id',  '22222222-2222-2222-2222-222222222221',
         'core_parent_id', '11111111-1111-1111-1111-111111111111',
         'name',           'Yusuf',
         'next_class_at',  '2026-09-07T12:30:00+02:00'));
select chat.ingest_core_learner(jsonb_build_object(
         'core_child_id',  '22222222-2222-2222-2222-222222222222',
         'core_parent_id', '11111111-1111-1111-1111-111111111111',
         'name',           'Maryam'));

select test.eq((select count(*)::int from chat.learner), 2, 'both learners are materialised');

select chat.ingest_core_learner(jsonb_build_object(
         'core_child_id',  '22222222-2222-2222-2222-222222222221',
         'core_parent_id', '11111111-1111-1111-1111-111111111111',
         'name',           'Yusuf Ahmed'));

select test.eq((select count(*)::int from chat.learner), 2,
               're-delivering a learner updates rather than duplicating');
select test.eq((select name from chat.learner
                where core_child_id = '22222222-2222-2222-2222-222222222221'),
               'Yusuf Ahmed', 'and applies the new name');

-- Subscription vocabulary is translated, never adopted ---------------------
select chat.ingest_core_subscription(jsonb_build_object(
         'core_subscription_id', '33333333-3333-3333-3333-333333333333',
         'core_parent_id',       '11111111-1111-1111-1111-111111111111',
         'status',               'failed_payment',
         'renewal_due_at',       '2026-09-20T00:00:00Z',
         'last_payment_status',  'failed',
         'last_payment_at',      '2026-09-01T00:00:00Z'));

select test.eq((select status from chat.subscription), 'past_due',
               'Jawwid Core''s failed_payment is translated to Jawwid Chat''s past_due');

select test.eq((select renewal_due_at from chat.subscription),
               '2026-09-20 00:00:00+00'::timestamptz, 'the renewal date is materialised');

-- A status Jawwid Chat has never been told about must not break ingestion.
select chat.ingest_core_subscription(jsonb_build_object(
         'core_subscription_id', '33333333-3333-3333-3333-333333333333',
         'core_parent_id',       '11111111-1111-1111-1111-111111111111',
         'status',               'some_new_core_status'));

select test.eq((select status from chat.subscription), 'unknown',
               'an unmapped Core status degrades to unknown instead of failing');

select test.eq((select count(*)::int from chat.unmapped_core_subscription_status), 1,
               'and is reported so the map can be corrected');

-- Correcting the map is a config edit, not a migration.
update chat.config
   set value = value || '{"some_new_core_status":"paused"}'::jsonb
 where key = 'integration.subscription_status_map';

select chat.ingest_core_subscription(jsonb_build_object(
         'core_subscription_id', '33333333-3333-3333-3333-333333333333',
         'core_parent_id',       '11111111-1111-1111-1111-111111111111',
         'status',               'some_new_core_status'));

select test.eq((select status from chat.subscription), 'paused',
               'adding the mapping in config fixes it with no deploy');

select test.eq((select count(*)::int from chat.subscription), 1,
               'four deliveries of one subscription produced one row');

-- Webhook replay ------------------------------------------------------------
select test.eq(chat.record_core_event('evt_abc123', 'subscription.updated'), true,
               'the first delivery of an event is recorded');

select test.eq(chat.record_core_event('evt_abc123', 'subscription.updated'), false,
               'a replayed delivery of the same event is ignored');

select test.eq((select count(*)::int from chat.core_event where external_event_id = 'evt_abc123'), 1,
               'and leaves exactly one row');

select chat.record_sync_result('jawwid_core', 'ok');
select test.eq((select unprocessed_events::int from chat.sync_health where source = 'jawwid_core'), 1,
               'sync health counts the unprocessed event');

select chat.mark_core_event_processed('evt_abc123');
select test.eq((select unprocessed_events::int from chat.sync_health where source = 'jawwid_core'), 0,
               'and stops counting it once processed');

-- Message idempotency -------------------------------------------------------
select chat.link_contact_account(
  (select c.id from chat.contact c join chat.family f on f.id = c.family_id
    where f.core_parent_id = '11111111-1111-1111-1111-111111111111'),
  'family:ahmed');

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

insert into chat.message (thread_id, author_type, author_id, on_behalf_mode, body, visibility, client_id)
select t.id, 'staff', test.staff_id('Owner A'), 'owner', 'Different family', 'customer', 'client-key-1'
from chat.thread t where t.family_id = test.family_id('Family A');

select test.eq((select count(*)::int from chat.message where client_id = 'client-key-1'), 2,
               'the same client id on another thread is a distinct message');

select test.finish();
