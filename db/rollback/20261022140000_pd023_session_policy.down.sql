-- Roll back 20261022140000_chat_pd023_session_policy (PD-23 session lifetimes).
--
-- Live sessions keep their current expires_at; refresh goes back to a fresh
-- 30-day window with no absolute limit once the previous API is deployed.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022140000_pd023_session_policy.down.sql

alter table chat.session
  drop constraint session_authenticated_before_created,
  drop constraint session_remembered_only_on_web,
  drop constraint session_client_known,
  drop column remembered,
  drop column client,
  drop column authenticated_at;

delete from chat.schema_migrations where version = '20261022140000_chat_pd023_session_policy';
