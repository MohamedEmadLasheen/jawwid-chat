-- The Jawwid Core mirror: teachers, enrollments, class sessions, payments, and
-- Student Group membership -- PRD v0.1 SS7.3, SS12.4, BR-5.

select test.begin_suite('core_mirror');
select test.seed_operations();
select test.reset_core();

-- A family with an owner, via the documented path.
select set_config('chat.actor_staff_id', test.staff_id('Manager')::text, false);
select chat.ingest_core_parent(jsonb_build_object(
  'core_parent_id', '11111111-1111-1111-1111-111111111111',
  'display_name', 'Ahmed Family', 'language', 'ar'));
select chat.assign_family_owner('11111111-1111-1111-1111-111111111111',
                                test.staff_id('Owner A'), 'pilot portfolio');
select chat.ingest_core_learner(jsonb_build_object(
  'core_child_id', '22222222-2222-2222-2222-222222222221',
  'core_parent_id', '11111111-1111-1111-1111-111111111111',
  'name', 'Yusuf'));

-- Teachers ------------------------------------------------------------------
select test.ok(chat.ingest_core_teacher(jsonb_build_object(
                 'core_teacher_id', '44444444-0000-0000-0000-000000000001',
                 'display_name', 'Ustadh Kareem'),
               '2026-09-06T10:00:00Z') is not null,
               'a teacher is mirrored from Jawwid Core');

select chat.ingest_core_teacher(jsonb_build_object(
  'core_teacher_id', '44444444-0000-0000-0000-000000000001',
  'display_name', 'Ustadh Kareem Ali'), '2026-09-06T11:00:00Z');

select test.eq((select count(*)::int from chat.teacher), 1,
               're-delivering a teacher updates rather than duplicating');
select test.eq((select display_name from chat.teacher), 'Ustadh Kareem Ali',
               'and applies the newer name');

-- Ordering: an older event must not overwrite a newer one.
select chat.ingest_core_teacher(jsonb_build_object(
  'core_teacher_id', '44444444-0000-0000-0000-000000000001',
  'display_name', 'STALE NAME'), '2026-09-06T09:00:00Z');

select test.eq((select display_name from chat.teacher), 'Ustadh Kareem Ali',
               'a late-arriving older event is dropped, not applied');

-- Enrollments and Student Group membership ---------------------------------
select test.eq(chat.ingest_core_enrollment(jsonb_build_object(
                 'core_enrollment_id', '55555555-0000-0000-0000-000000000001',
                 'core_child_id', '22222222-2222-2222-2222-222222222221',
                 'core_teacher_id', '99999999-9999-9999-9999-999999999999'),
               '2026-09-06T12:00:00Z'),
               null::uuid,
               'an enrolment naming an unknown teacher is acknowledged, not applied');

select chat.ingest_core_enrollment(jsonb_build_object(
  'core_enrollment_id', '55555555-0000-0000-0000-000000000001',
  'core_child_id', '22222222-2222-2222-2222-222222222221',
  'core_teacher_id', '44444444-0000-0000-0000-000000000001',
  'subject', 'Quran'), '2026-09-06T12:00:00Z');

select test.eq((select count(*)::int from chat.conversation
                where type = 'student_group' and archived_at is null), 1,
               'the official Student Group is created automatically (PRD SS7.3)');

select test.eq((select count(*)::int from chat.conversation_member m
                join chat.conversation c on c.id = m.conversation_id
                where c.type = 'student_group' and m.left_at is null), 3,
               'it contains the parent, the assigned teacher and the primary owner');

select test.eq((select count(*)::int from chat.conversation_member m
                join chat.conversation c on c.id = m.conversation_id
                where c.type = 'student_group' and m.left_at is null
                  and m.actor_kind = 'teacher'), 1,
               'exactly one teacher is a member');

select test.ok((select count(*)::int from chat.message
                where author_type = 'system' and body like '%now teaching%') = 1,
               'the teacher addition posted a system message (PRD SS7.3)');

-- A teacher change swaps membership ----------------------------------------
select chat.ingest_core_teacher(jsonb_build_object(
  'core_teacher_id', '44444444-0000-0000-0000-000000000002',
  'display_name', 'Ustadha Noor'), '2026-09-06T13:00:00Z');

select chat.deactivate_core_entity('enrollment', '55555555-0000-0000-0000-000000000001',
                                   '2026-09-06T13:00:00Z');
select chat.ingest_core_enrollment(jsonb_build_object(
  'core_enrollment_id', '55555555-0000-0000-0000-000000000002',
  'core_child_id', '22222222-2222-2222-2222-222222222221',
  'core_teacher_id', '44444444-0000-0000-0000-000000000002'), '2026-09-06T13:00:00Z');

select test.eq((select t.display_name from chat.conversation_member m
                join chat.conversation c on c.id = m.conversation_id
                join chat.teacher t on t.id = m.actor_id
                where c.type = 'student_group' and m.left_at is null
                  and m.actor_kind = 'teacher'),
               'Ustadha Noor',
               'a teacher change in Core swaps the group membership');

select test.eq((select count(*)::int from chat.conversation_member m
                join chat.conversation c on c.id = m.conversation_id
                where c.type = 'student_group' and m.actor_kind = 'teacher'
                  and m.left_at is not null), 1,
               'the departing teacher is marked as having left, not deleted (BR-5)');

select test.ok((select count(*)::int from chat.message
                where author_type = 'system' and body like '%no longer teaching%') = 1,
               'and the removal posted its own system message');

-- Deactivating a teacher removes them everywhere ---------------------------
select chat.deactivate_core_entity('teacher', '44444444-0000-0000-0000-000000000002',
                                   '2026-09-06T14:00:00Z');

select test.eq((select count(*)::int from chat.conversation_member m
                join chat.conversation c on c.id = m.conversation_id
                where c.type = 'student_group' and m.left_at is null
                  and m.actor_kind = 'teacher'), 0,
               'a deactivated teacher leaves the group');

select test.eq((select count(*)::int from chat.teacher where is_active), 1,
               'the teacher record itself is deactivated, never deleted (BR-5)');

-- Class sessions -----------------------------------------------------------
select chat.ingest_core_class_session(jsonb_build_object(
  'core_class_session_id', '66666666-0000-0000-0000-000000000001',
  'core_child_id', '22222222-2222-2222-2222-222222222221',
  'core_teacher_id', '44444444-0000-0000-0000-000000000001',
  'starts_at', '2036-01-01T09:00:00Z',
  'join_url', 'https://example.invalid/class/abc'), '2026-09-06T15:00:00Z');

select test.eq((select next_class_at from chat.learner
                where core_child_id = '22222222-2222-2222-2222-222222222221'),
               '2036-01-01T09:00:00Z'::timestamptz,
               'a scheduled class updates the learner''s next class, which the '
               'attention engine reads');

select chat.deactivate_core_entity('class_session', '66666666-0000-0000-0000-000000000001',
                                   '2026-09-06T16:00:00Z');
select test.eq((select status from chat.class_session), 'cancelled',
               'a cancelled class is marked cancelled, not removed');

-- Payments ------------------------------------------------------------------
select chat.ingest_core_payment(jsonb_build_object(
  'core_payment_id', '77777777-0000-0000-0000-000000000001',
  'core_parent_id', '11111111-1111-1111-1111-111111111111',
  'amount', '450.00', 'currency', 'EGP', 'status', 'due',
  'due_at', '2026-09-20T00:00:00Z'), '2026-09-06T15:00:00Z');
select chat.ingest_core_payment(jsonb_build_object(
  'core_payment_id', '77777777-0000-0000-0000-000000000001',
  'core_parent_id', '11111111-1111-1111-1111-111111111111',
  'amount', '450.00', 'currency', 'EGP', 'status', 'paid',
  'paid_at', '2026-09-18T00:00:00Z'), '2026-09-06T16:00:00Z');

select test.eq((select count(*)::int from chat.payment), 1,
               'two deliveries of one payment produce one row');
select test.eq((select status from chat.payment), 'paid',
               'and the newer status wins');

-- A student leaving archives the group -------------------------------------
select chat.deactivate_core_entity('student', '22222222-2222-2222-2222-222222222221',
                                   '2026-09-06T17:00:00Z');
select test.eq((select count(*)::int from chat.conversation
                where type = 'student_group' and archived_at is not null), 1,
               'a group is archived, never deleted, when a student leaves (PRD SS7.3)');

-- The mirror carries no contact channel ------------------------------------
select test.eq((select count(*)::int from information_schema.columns
                where table_schema = 'chat'
                  and table_name in ('teacher', 'enrollment', 'class_session', 'payment')
                  and column_name ~* '(phone|mobile|email|msisdn|whatsapp|card|iban|account_number)'),
               0, 'no mirrored Core entity carries a phone number or a payment credential (BR-2)');

select test.finish();
