-- Roll back 20261014120000_chat_pd007_restore_br1_direct (PD-7 database half).
--
-- Restores the PD-6 database rule (a direct teacher<->parent channel is permitted
-- for an authorized relationship) EXACTLY: it drops the PD-7 message guard and
-- re-runs 20260923140000 verbatim, which is idempotent (create or replace, drop
-- of an overload that no longer exists, create index if not exists, comments).
-- No table data is read, changed or deleted.
--
-- A POLICY DECISION, not a fix: run only on the product owner's instruction to
-- return to PD-6, and roll the API back with it (the API at PD-7 still refuses
-- the pair, which is the safe direction but not PD-6).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261014120000_pd007.down.sql
--
-- `-1` makes the whole rollback one transaction: it applies completely or not at all.

drop trigger if exists message_br1_direct_guard on chat.message;
drop function if exists chat.enforce_br1_direct_message();

\ir ../../supabase/migrations/20260923140000_chat_pd006_authorization_switch.sql

delete from chat.schema_migrations where version = '20261014120000_chat_pd007_restore_br1_direct';
