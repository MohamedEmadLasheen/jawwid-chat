-- Roll back 20261102160000_chat_pd052_records_notifications (PD-52 PR-6).
--
-- Drops the two rules and their texts. Entries and pushes already written for
-- them go first (chat.notification.rule_key references the rule). Roll back
-- the API release with it: OutboxWorker.deliverTeacherRecord emits under these
-- rules, and the producers enqueue teacher_records.* events (an event left in
-- the outbox after the rollback falls to the worker's default branch).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102160000_pd052_records_notifications.down.sql

delete from chat.notification where rule_key in ('teacher_complaint_received', 'teacher_praise_received');
delete from chat.notification_item where rule_key in ('teacher_complaint_received', 'teacher_praise_received');
delete from chat.notification_rule where key in ('teacher_complaint_received', 'teacher_praise_received');
delete from chat.notification_template
 where key in ('teacher_complaint_received', 'teacher_praise_received',
               'inbox.teacher_complaint_received', 'inbox.teacher_praise_received');
