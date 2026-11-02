-- Roll back 20261102270000_chat_pd046_lesson_create_key (PD-46 PR-2c): POST /lessons forgets its Idempotency-Key.
-- Deploy the API without PR-2c first (it writes the column).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102270000_chat_pd046_lesson_create_key.down.sql

set local lock_timeout = '5s';

drop index if exists chat.lesson_create_key_once;
alter table chat.lesson drop column if exists create_key;

delete from chat.schema_migrations where version = '20261102270000_chat_pd046_lesson_create_key';
