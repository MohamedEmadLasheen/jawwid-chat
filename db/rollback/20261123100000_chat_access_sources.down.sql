-- Roll back 20261123100000_chat_access_sources (access management M1). Read-only function: nothing else depends on it
-- except the staff-accounts "access" endpoints, so roll the API back with it.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261123100000_chat_access_sources.down.sql
-- Then: delete from chat.schema_migrations where version = '20261123100000_chat_access_sources';
drop function if exists chat.staff_access_sources(uuid);
