-- Roll back 20261102150000_chat_pd046_lesson_revision_and_events (PD-46 PR-1).
--
-- Drops the two lesson triggers and their functions, the unannounced-change
-- table, the outbox idempotency key and chat.lesson.revision. Unannounced rows
-- are signals only (no data depends on them); outbox rows already enqueued keep
-- their payloads and lose only the key. Roll back the API and worker release
-- with it: LessonEvents, the outbox worker and the sweep read these.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102150000_chat_pd046_lesson_revision_and_events.down.sql

drop trigger if exists lesson_change_unannounced on chat.lesson;
drop trigger if exists lesson_bumps_revision on chat.lesson;
drop function if exists chat.lesson_note_unannounced();
drop function if exists chat.lesson_bump_revision();
drop table if exists chat.lesson_change_unannounced;
drop index if exists chat.outbox_event_idempotency_key;
alter table chat.outbox_event drop column if exists idempotency_key;
alter table chat.lesson drop column if exists revision;

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102150000_chat_pd046_lesson_revision_and_events';
