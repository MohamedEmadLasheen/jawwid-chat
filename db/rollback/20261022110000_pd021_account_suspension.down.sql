-- Roll back 20261022110000_chat_pd021_account_suspension (PD-21 reactivation).
--
-- Suspended accounts stay suspended; only the way back is removed.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022110000_pd021_account_suspension.down.sql

drop function chat.reactivate_account(uuid, text);

delete from chat.schema_migrations where version = '20261022110000_chat_pd021_account_suspension';
