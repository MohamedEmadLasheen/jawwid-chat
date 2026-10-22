-- Roll back 20261022120000_chat_pd022_account_time_zone (PD-22 account time zones).
--
-- Safe to run with rows present: a zone is re-reported by the phone on its next
-- launch, so nothing entered by hand is lost except a manual choice, which the
-- person makes again. The v2 reminder texts are removed, so the v1 texts (no
-- time) are what TemplateService renders again.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022120000_pd022.down.sql

delete from chat.notification_template
 where version = 2
   and key in ('lesson_reminder_tomorrow', 'lesson_reminder_soon', 'lesson_reminder_teacher');

drop table chat.actor_time_zone;
drop function chat.guard_actor_time_zone();

delete from chat.schema_migrations where version = '20261022120000_chat_pd022_account_time_zone';
