-- =============================================================================
-- PD-52 PR-6 · who is told about a complaint or a parent's praise
-- (docs/product/pd052-teacher-records-pages-plan.md §7)
--
--   teacher_complaint_received  a parent files a complaint in the app, or a staff
--                               complaint names a family: the teacher's PD-35
--                               supervisor (else the Teachers manager) and the
--                               child's PD-8 supervisor -- a Center entry and a
--                               generic push, quiet hours kept
--   teacher_praise_received     a parent praises a teacher: the teacher's
--                               supervisor (else the Teachers manager) -- a
--                               Center entry only, never a push
--
-- OutboxWorker.deliverTeacherRecord chooses the recipients (recipient_role
-- 'staff' is not a filter), once per record and recipient (the dedupe key),
-- never the one who filed it and never the teacher. The texts are generic: no
-- teacher, child, family or words of the parent -- a lock screen is not behind
-- sign-in, and the page re-checks who may see the record. The PD-47 follow-up
-- task is unchanged.
--
-- Idempotent (G-19).
-- =============================================================================

insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('teacher_complaint_received', 'teacher_complaint_received', 0, 'teacher_complaint_received', 'staff', 'push', 'normal', true),
  ('teacher_praise_received',    'teacher_praise_received',    0, 'teacher_praise_received',    'staff', 'push', 'low',    true)
on conflict (key) do nothing;

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('teacher_complaint_received', 'en', 'Jawwid', 'A complaint about a teacher arrived.'),
    ('teacher_complaint_received', 'ar', 'جَوِّد', 'وصلت شكوى بشأن أحد المعلمين.'),
    ('teacher_praise_received', 'en', 'Jawwid', 'A parent praised a teacher.'),
    ('teacher_praise_received', 'ar', 'جَوِّد', 'أثنى ولي أمر على أحد المعلمين.'),
    ('inbox.teacher_complaint_received', 'en', 'New complaint about a teacher', 'A complaint about a teacher arrived. Open it in Attendance & complaints.'),
    ('inbox.teacher_complaint_received', 'ar', 'شكوى جديدة بشأن معلم', 'وصلت شكوى بشأن أحد المعلمين. افتحها في صفحة الحضور والتأخير والأعذار والشكاوى.'),
    ('inbox.teacher_praise_received', 'en', 'A parent praised a teacher', 'A parent praised a teacher. Read it in Grants & testimonials.'),
    ('inbox.teacher_praise_received', 'ar', 'ثناء من ولي أمر', 'أثنى ولي أمر على أحد المعلمين. اقرأه في صفحة المنح والشهادات الطيبة.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);
