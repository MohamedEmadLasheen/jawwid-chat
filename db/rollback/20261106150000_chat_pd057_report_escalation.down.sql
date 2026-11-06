-- Roll back 20261106150000_chat_pd057_report_escalation (PD-57 ENG-04): the
-- SLA alert markers, the report notification rules and texts, and the
-- `content_report` PD-47 task source.
--
-- Roll back the API first (ReportEscalationService sends these and sweeps the
-- markers). Work tasks already raised stay (chat.work_task is never deleted);
-- they render without a title's params once the source function is gone.
-- Notification rows that reference the rules keep the rule rows: delete the
-- rules only where nothing references them.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261106150000_chat_pd057_report_escalation.down.sql

set local lock_timeout = '5s';

drop trigger if exists content_report_raises_its_task on chat.content_report;
drop trigger if exists content_report_moves_its_task on chat.content_report;
drop function if exists chat.work_task_from_content_report();
drop function if exists chat.work_task_sync_content_report(uuid);
drop function if exists chat.content_report_task_assignee(uuid);
drop function if exists chat.content_report_managers(uuid);
drop table if exists chat.content_report_alert;
drop function if exists chat.guard_content_report_alert();
delete from chat.notification_template
 where key in ('report_received_staff', 'report_child_safety', 'report_due_soon', 'report_overdue', 'report_answered',
               'inbox.report_received_staff', 'inbox.report_child_safety', 'inbox.report_due_soon', 'inbox.report_overdue',
               'inbox.report_answered');
delete from chat.notification_rule r
 where r.key in ('report_received_staff', 'report_child_safety', 'report_due_soon', 'report_overdue', 'report_answered')
   and not exists (select 1 from chat.notification n where n.rule_key = r.key)
   and not exists (select 1 from chat.notification_item i where i.rule_key = r.key);
