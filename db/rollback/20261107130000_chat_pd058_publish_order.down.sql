-- Roll back 20261107130000_chat_pd058_publish_order (PD-58, ENG-10: the order
-- versions were published in).
--
-- Restores chat.guard_legal_document_version to 20261107110000's body and drops
-- chat.legal_document_version.publish_seq. Roll back the API with it: the
-- ENG-10 API orders versions by publish_seq.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261107130000_chat_pd058_publish_order.down.sql
--
-- No row is removed: the published versions stay. Dropping the column loses only
-- the publication order of versions published since; their created_at remains.
-- Then delete the ledger row: delete from chat.schema_migrations where version =
-- '20261107130000_chat_pd058_publish_order';

create or replace function chat.guard_legal_document_version()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
      return null;
    end if;
    raise exception 'published legal document versions are never truncated' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'a published legal document version is never changed; publish a new version' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a published legal document version is never removed' using errcode = 'check_violation';
  end if;
  if not new.requires_reacceptance
     and not exists (select 1 from chat.legal_document_version l
                      where l.document_key = new.document_key and l.requires_reacceptance) then
    raise exception 'the first version of % requires acceptance; publish it with requires_reacceptance true', new.document_key
      using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;

revoke all on function chat.guard_legal_document_version() from public, anon, authenticated, chat_app;

alter table chat.legal_document_version drop constraint if exists legal_document_version_publish_seq_key;
alter table chat.legal_document_version drop column if exists publish_seq;
