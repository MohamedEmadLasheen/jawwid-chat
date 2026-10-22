-- Roll back 20261022100000_chat_pd021_password_reset (PD-21 admin password reset).
--
-- The codes are short-lived and hold no password, but each row records who
-- reset whose password and why. The audit_log rows (account.password_reset_*)
-- stay either way; this drops the codes themselves.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022100000_pd021_password_reset.down.sql

drop table chat.password_reset_code;
drop function chat.guard_password_reset_code();

delete from chat.schema_migrations where version = '20261022100000_chat_pd021_password_reset';
