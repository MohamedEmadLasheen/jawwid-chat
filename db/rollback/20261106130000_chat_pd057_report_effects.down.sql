-- Roll back 20261106130000_chat_pd057_report_effects (PD-57 ENG-02): the
-- `warned` notification texts and the `report_reassignment` task source.
--
-- Roll back the API first (ModerationService raises these tasks and sends the
-- warning). The work tasks already raised stay (chat.work_task is never
-- deleted); their source rows go, so they render without a title's params.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261106130000_chat_pd057_report_effects.down.sql

set local lock_timeout = '5s';

drop function if exists chat.work_task_raise_report_reassignment(uuid);
drop table if exists chat.report_reassignment_task;
drop function if exists chat.guard_report_reassignment_task();
delete from chat.notification_template where key in ('conduct_warning', 'inbox.conduct_warning');
