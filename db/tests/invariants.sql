-- Structural invariants -- brief SS3, SS12.
--
-- These assert properties of the schema itself, so they fail the moment a later
-- migration weakens one of them.

select test.begin_suite('invariants');
select test.seed_operations();

-- Contact details ----------------------------------------------------------
-- Jawwid Chat stores no phone number anywhere. Calls and contact details are
-- not part of this product, and the guarantee is structural rather than a rule
-- the UI is trusted to follow: there is no column to leak.

select test.eq((select count(*)::int
                from information_schema.columns
                where table_schema = 'chat'
                  and column_name ~* '(phone|mobile|msisdn|whatsapp|tel_|_tel)'),
               0, 'no table in the chat schema has a phone-number column');

select test.eq((select count(*)::int
                from information_schema.columns c
                join information_schema.views v
                  on v.table_schema = c.table_schema and v.table_name = c.table_name
                where c.table_schema = 'chat'
                  and c.column_name ~* '(phone|mobile|msisdn|whatsapp|tel_|_tel)'),
               0, 'no chat view exposes a phone-number column');

-- The Core boundary must not widen into contact details either.
select test.eq((select count(*)::int
                from information_schema.columns
                where table_schema = 'chat' and table_name like 'core[_]%'
                  and column_name ~* '(phone|mobile|msisdn|whatsapp|email|password)'),
               0, 'the Jawwid Core boundary views expose no contact details or credentials');

-- One thread per family ----------------------------------------------------
select test.throws(
  format('insert into chat.thread (family_id) values (%L)', test.family_id('Family A')),
  'a family cannot be given a second thread (brief SS12)', '23505');

-- Messages are immutable ---------------------------------------------------
insert into chat.contact (family_id, name, role_preset, can_message)
values (test.family_id('Family A'), 'Parent A', 'primary_guardian', true);

insert into chat.message (thread_id, author_type, author_id, body, visibility)
select t.id, 'contact', c.id, 'Original wording', 'customer'
from chat.thread t join chat.contact c on c.family_id = t.family_id
where t.family_id = test.family_id('Family A');

select test.throws(
  $q$update chat.message set body = 'Rewritten wording'$q$,
  'a message cannot be edited after the fact', '23001');

select test.throws(
  $q$delete from chat.message$q$,
  'a message cannot be deleted', '23001');

select test.eq((select body from chat.message), 'Original wording',
               'the customer record still reads as it was written');

-- The logs are append-only -------------------------------------------------
select chat.log_event('family_opened', test.family_id('Family A'), null, 'staff',
                      test.staff_id('Owner A'));

select test.throws($q$update chat.event_log set type = 'message_sent'$q$,
                   'the event log cannot be rewritten', '23001');
select test.throws($q$delete from chat.event_log$q$,
                   'the event log cannot be pruned by an application', '23001');

select chat.write_audit(test.staff_id('Manager'), 'config_changed', 'config', null,
                        'tuning the night target');
select test.throws($q$update chat.audit_log set reason = 'something else'$q$,
                   'the audit log cannot be rewritten', '23001');
select test.throws($q$delete from chat.audit_log$q$,
                   'the audit log cannot be deleted', '23001');

-- An audited action must state why -----------------------------------------
select test.throws(
  format($q$insert into chat.audit_log (actor_id, action, entity, reason)
            values (%L, 'ownership_transferred', 'family', '  ')$q$,
         test.staff_id('Manager')),
  'an audit row with a blank reason is refused', '23514');

-- Every staff message declares how it was sent ------------------------------
select test.throws(
  format($q$insert into chat.message (thread_id, author_type, author_id, body, visibility)
            select id, 'staff', %L, 'No mode declared', 'customer'
            from chat.thread where family_id = %L$q$,
         test.staff_id('Owner A'), test.family_id('Family A')),
  'a staff message without on_behalf_mode is refused (brief SS12)', '23514');

select test.throws(
  format($q$insert into chat.message (thread_id, author_type, author_id, on_behalf_mode,
                                      body, visibility)
            select id, 'contact', %L, 'owner', 'Contacts have no mode', 'customer'
            from chat.thread where family_id = %L$q$,
         (select id from chat.contact limit 1), test.family_id('Family A')),
  'only staff messages carry on_behalf_mode', '23514');

-- A customer cannot author an internal note ---------------------------------
select test.throws(
  format($q$insert into chat.message (thread_id, author_type, author_id, body, visibility)
            select id, 'contact', %L, 'Sneaking into the notes', 'internal'
            from chat.thread where family_id = %L$q$,
         (select id from chat.contact limit 1), test.family_id('Family A')),
  'a contact cannot write an internal note', '23514');

-- Messages must belong to a real author on that family ---------------------
select test.throws(
  format($q$insert into chat.message (thread_id, author_type, author_id, body, visibility)
            select id, 'contact', %L, 'Wrong family', 'customer'
            from chat.thread where family_id = %L$q$,
         (select id from chat.contact limit 1), test.family_id('Family C')),
  'a contact cannot post onto another family''s thread', '23503');

-- A case belongs to its own family's thread --------------------------------
select test.throws(
  format($q$insert into chat.support_case (thread_id, family_id, type)
            select id, %L, 'general' from chat.thread where family_id = %L$q$,
         test.family_id('Family C'), test.family_id('Family A')),
  'a case cannot be attached to another family''s thread', '23503');

-- A message must actually say something ------------------------------------
select test.throws(
  format($q$insert into chat.message (thread_id, author_type, author_id, body, visibility)
            select id, 'contact', %L, null, 'customer'
            from chat.thread where family_id = %L$q$,
         (select id from chat.contact limit 1), test.family_id('Family A')),
  'an empty message with no attachment is refused', '23514');

-- A flag that changes what the team sees must say why -----------------------
select test.throws(
  format($q$update chat.family set manual_flag = 'urgent' where id = %L$q$,
         test.family_id('Family A')),
  'flagging a family urgent without a reason is refused', '23514');

-- There is no queue, and no routing table -----------------------------------
-- Brief SS12: "No queue table, no round-robin". This asserts none appeared.
select test.eq((select count(*)::int from information_schema.tables
                where table_schema = 'chat'
                  and table_name ~* '(queue|routing|assignment|round_robin|pool)'),
               0, 'the schema contains no queue, routing or assignment table');

select test.finish();
