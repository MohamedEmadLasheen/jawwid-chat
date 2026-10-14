-- Roll back 20261014150000_chat_rt032_revocation_journal (RT-032 deactivation journal and gate).
--
-- Drops the eight journal triggers, the trigger function and
-- chat.deactivate_principal(). KEEPS chat.principal_revocation with every row
-- (an audit record of who took whom out of service, and when it was
-- confirmed) and its immutability guard; KEEPS chat.invoking_role() and
-- chat.caller_is_server_side() (shared with the staff-profile work, and
-- referenced by its policies on that history), withdrawing only the
-- service_role grant this migration added. No other table data is touched.
--
-- What is lost: deactivations are no longer journaled, so none passes the
-- completion barrier unless it is made through the API -- RT-032 is OPEN again
-- -- and request roles may again deactivate where their grants and RLS allow.
-- The API keeps running: RevocationConfirmer finds nothing new to confirm, and
-- the operator CLI (deactivate-principal) refuses, the operation being gone.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261014150000_rt032.down.sql

drop trigger if exists account_revocation_journal on chat.account;
drop trigger if exists account_deletion_journal on chat.account;
drop trigger if exists contact_revocation_journal on chat.contact;
drop trigger if exists contact_deletion_journal on chat.contact;
drop trigger if exists staff_revocation_journal on chat.staff;
drop trigger if exists staff_deletion_journal on chat.staff;
drop trigger if exists teacher_revocation_journal on chat.teacher;
drop trigger if exists teacher_deletion_journal on chat.teacher;
drop function if exists chat.journal_principal_revocation();
drop function if exists chat.deactivate_principal(text, uuid, text, uuid, text);
revoke execute on function chat.invoking_role() from service_role;

delete from chat.schema_migrations where version = '20261014150000_chat_rt032_revocation_journal';
