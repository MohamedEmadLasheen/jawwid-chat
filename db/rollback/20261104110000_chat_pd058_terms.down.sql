-- Roll back 20261104110000_chat_pd058_terms (PD-58, ENG-09: the Terms of Use data model).
--
-- Drops the two writers, the two tables and their guards. Roll back the API and
-- the clients with it (ENG-10..12): they read and write these tables.
--
-- The acceptance rows are consent records and the version rows are the owner's
-- published versions. This file REFUSES to drop either table while it holds a
-- row, unless the operator says, in the same transaction, that the records have
-- been exported and may go:
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261104110000_chat_pd058_terms.down.sql
--
--   # only after exporting both tables, and with the owner's authorization:
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" \
--     -c "select set_config('chat.rollback_discards_terms', 'on', true)" \
--     -f db/rollback/20261104110000_chat_pd058_terms.down.sql
--
-- The owner's chat.config rows that name the version in force (legal.current.*)
-- are the owner's configuration, not this migration's, and are left as they are.

do $$
declare
  v_tbl  text;
  v_rows boolean;
begin
  if coalesce(current_setting('chat.rollback_discards_terms', true), '') = 'on' then
    return;
  end if;
  -- Dynamic, so a database already rolled back (no tables) passes cleanly.
  foreach v_tbl in array array['chat.terms_acceptance', 'chat.legal_document_version'] loop
    continue when to_regclass(v_tbl) is null;
    execute format('select exists (select 1 from %s)', v_tbl) into v_rows;
    if v_rows then
      raise exception 'PD-58 rollback refused: % holds rows (consent records or published versions); export them, then set chat.rollback_discards_terms', v_tbl
        using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

drop function if exists chat.accept_legal_documents(uuid, jsonb, text, text);
drop function if exists chat.publish_legal_version(text, text, text, text, timestamptz, uuid);
-- DROP TABLE fires no row or truncate trigger; the guards go with their tables.
drop table if exists chat.terms_acceptance;
drop table if exists chat.legal_document_version;
drop function if exists chat.guard_terms_acceptance();
drop function if exists chat.guard_legal_document_version();

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261104110000_chat_pd058_terms';
