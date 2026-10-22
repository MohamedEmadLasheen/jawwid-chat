-- Roll back 20261022120000_chat_pd021_impersonation (PD-21 support sessions).
--
-- REFUSES while any support session exists: who acted as whom, why, and every
-- request they made is a record the academy may need; a rollback never drops
-- it. Export chat.impersonation_session and chat.impersonation_action first.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022120000_pd021_impersonation.down.sql

do $$
begin
  if exists (select 1 from chat.impersonation_session) then
    raise exception 'PD-21 impersonation rollback refused: support sessions exist (export them first; history is never dropped)';
  end if;
end;
$$;

alter table chat.message drop column impersonation_id;
drop index chat.audit_log_impersonation;
alter table chat.audit_log drop column impersonation_id;
drop table chat.impersonation_action;
drop index chat.session_one_per_impersonation;
alter table chat.session drop column impersonation_id;
drop table chat.impersonation_session;
drop function chat.guard_impersonation_session();

delete from chat.schema_migrations where version = '20261022120000_chat_pd021_impersonation';
