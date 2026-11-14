-- =============================================================================
-- PD-58 · Terms of Use: the order versions were published in (ENG-10)
--
-- Spec of record: docs/release/google-play-blocker-roadmap-2026-11-03.md §7.2
-- and the P-3 rule (docs/legal/developer-implementation-guide.md §1.3): an
-- account must have accepted the latest version that requires acceptance AT OR
-- BEFORE the version in force, or any LATER one. "Before" and "later" need an
-- order the publisher cannot bend.
--
-- 20261107110000 (on main, not edited) gives no such order:
--   * effective_at is whatever chat.publish_legal_version is given, so a
--     version published second but backdated sorted before the first, and an
--     account that accepted only the first counted as having accepted it;
--   * two versions published in one transaction share created_at (now() is the
--     transaction's time), so the order fell to the version name, where text
--     sorts 'v9' after 'v10'.
--
-- This migration:
--   1. adds chat.legal_document_version.publish_seq, a bigint identity
--      (GENERATED ALWAYS: no caller chooses it), unique, not null. Rows already
--      there are numbered by (created_at, effective_at, document_key, version)
--      -- their publication order as far as it can be known -- before the
--      identity takes over above the highest number. The API orders by it.
--   2. replaces the table's ONE guard function (AGENTS.md: one trigger function
--      per table) with the same body plus one rule: a NEW version's
--      effective_at may not be earlier than the latest effective_at already
--      published for its document. The same time is allowed (versions published
--      together). An identical retry of an existing version is not a new
--      version: it is let through to chat.publish_legal_version's own
--      ON CONFLICT DO NOTHING and idempotency check, unchanged.
--
-- No row is inserted; no wording, URL or version name is here (N-3).
-- Idempotent: applying this file again changes nothing.
-- Rollback: db/rollback/20261107130000_chat_pd058_publish_order.down.sql
-- Slot: 20261107130000, reserved for ENG-10 by the lead on 2026-11-07.
-- =============================================================================

do $$
declare
  v_next bigint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'chat' and table_name = 'legal_document_version' and column_name = 'publish_seq'
  ) then
    alter table chat.legal_document_version add column publish_seq bigint;

    -- Number what is already published. The guard refuses every UPDATE, so it
    -- is set aside for this one statement, inside this migration's transaction.
    alter table chat.legal_document_version disable trigger legal_document_version_is_append_only;
    update chat.legal_document_version l
       set publish_seq = o.n
      from (select document_key, version,
                   row_number() over (order by created_at, effective_at, document_key, version) as n
              from chat.legal_document_version) o
     where o.document_key = l.document_key and o.version = l.version;
    alter table chat.legal_document_version enable trigger legal_document_version_is_append_only;

    alter table chat.legal_document_version alter column publish_seq set not null;
    select coalesce(max(publish_seq), 0) + 1 into v_next from chat.legal_document_version;
    execute format(
      'alter table chat.legal_document_version alter column publish_seq add generated always as identity (start with %s)',
      v_next);
    alter table chat.legal_document_version
      add constraint legal_document_version_publish_seq_key unique (publish_seq);
  end if;
end;
$$;

comment on column chat.legal_document_version.publish_seq is
  'PD-58: the order versions were published in, assigned by the database (identity, GENERATED ALWAYS). The API reads "at or before" and "later" (P-3) by it -- never by effective_at, which the publisher supplies, nor by the version name.';

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
  -- P-3: a version that asks nobody to accept again needs an earlier one that
  -- did, or the document would have no version anybody must accept.
  if not new.requires_reacceptance
     and not exists (select 1 from chat.legal_document_version l
                      where l.document_key = new.document_key and l.requires_reacceptance) then
    raise exception 'the first version of % requires acceptance; publish it with requires_reacceptance true', new.document_key
      using errcode = 'check_violation';
  end if;
  -- ENG-10: a new version is never backdated before what is already published
  -- for its document. (An identical retry of an existing version goes on to
  -- ON CONFLICT DO NOTHING in chat.publish_legal_version.)
  if not exists (select 1 from chat.legal_document_version l
                  where l.document_key = new.document_key and l.version = new.version)
     and exists (select 1 from chat.legal_document_version l
                  where l.document_key = new.document_key and l.effective_at > new.effective_at) then
    raise exception 'effective_at of % % is earlier than a version already published for it; a new version is never backdated',
      new.document_key, new.version
      using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;

revoke all on function chat.guard_legal_document_version() from public, anon, authenticated, chat_app;
