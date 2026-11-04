-- =============================================================================
-- PD-58 · Terms of Use: the data model (ENG-09)
--
-- Spec of record: docs/release/google-play-blocker-roadmap-2026-11-03.md §7.1-7.3
-- (the owner approved A-3). Each account accepts TWO documents: its kind's terms
-- and the shared Code of Conduct.
--
--   chat.account.kind   terms document     plus
--   family              terms_family       code_of_conduct
--   teacher             terms_teacher      code_of_conduct
--   staff               terms_staff        code_of_conduct   (Sales and the Super Admin too)
--
--   chat.legal_document_version  one row per (document, version) the owner
--                                publishes: the version's name as the owner
--                                gives it, its Arabic and English URLs, when it
--                                takes effect. Append-only; written only by
--                                chat.publish_legal_version, which the owner's
--                                release process runs.
--   chat.terms_acceptance        one row per (account, document, version):
--                                when it was accepted (the database's clock),
--                                from which client and in which locale.
--                                Immutable; written only by
--                                chat.accept_legal_documents.
--
-- NOTHING LEGAL SHIPS HERE (N-3 is pending). The code holds the four document
-- KEYS only. No wording, no URL and no version name is in this file: no version
-- row is inserted, and the configuration rows that name the version in force
-- (chat.config `legal.current.<document_key>`, §7.2) are the owner's to set.
-- The API refuses to boot in production without them (§7.3, ENG-10).
--
-- IMMUTABILITY. Each table has ONE guard function (AGENTS.md), fired row-level
-- for INSERT/UPDATE/DELETE and statement-level for TRUNCATE:
--   * UPDATE and DELETE are always refused. There is no erasure exception:
--     §7.2 keeps acceptance rows through an erasure as the consent record, and
--     chat.erase_account anonymises the account row, it never deletes it.
--   * TRUNCATE is refused unless a test's cleanup says so in its own
--     transaction (chat.test_truncate), as for PD-47/48/49/55's tables.
--   * INSERT stamps the time from the database (a caller cannot backdate), and
--     an acceptance must be of a document the account's kind accepts.
--   * The account foreign key is ON DELETE RESTRICT: an account that accepted
--     terms is never hard-deleted out from under its record.
--
-- RLS is fail-closed on both tables. No request role (anon, authenticated,
-- chat_app) may write either table or execute either writer; a signed-in
-- account reads only its OWN acceptances; nobody but the server reads versions.
--
-- Erasure: acceptance rows are KEPT (20261102210000's retention header says so).
--
-- Idempotent: applying this file again changes nothing.
-- Rollback: db/rollback/20261104110000_chat_pd058_terms.down.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The versions the owner publishes
-- ---------------------------------------------------------------------------

create table if not exists chat.legal_document_version (
  document_key  text not null
    constraint legal_document_version_document_key_check
    check (document_key in ('terms_family', 'terms_teacher', 'terms_staff', 'code_of_conduct')),
  -- The owner's own name for the version: any text, but never blank, padded or
  -- carrying control characters.
  version       text not null
    constraint legal_document_version_version_check
    check (length(version) between 1 and 64 and version = btrim(version) and version !~ '[[:cntrl:]]'),
  url_ar        text not null
    constraint legal_document_version_url_ar_check
    check (length(url_ar) <= 2048 and url_ar ~ '^https://[^[:space:]]+$'),
  url_en        text not null
    constraint legal_document_version_url_en_check
    check (length(url_en) <= 2048 and url_en ~ '^https://[^[:space:]]+$'),
  effective_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- The account that ran the release, when it ran as one. Not a foreign key:
  -- like the audit log's actor, the record outlives whatever happens to it.
  created_by    uuid,
  primary key (document_key, version)
);

comment on table chat.legal_document_version is
  'PD-58: a version of a legal document (terms_family, terms_teacher, terms_staff, code_of_conduct) as the owner published it, with its Arabic and English URLs. Append-only; written only by chat.publish_legal_version. No row ships in a migration.';

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
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists legal_document_version_is_append_only on chat.legal_document_version;
create trigger legal_document_version_is_append_only
  before insert or update or delete on chat.legal_document_version
  for each row execute function chat.guard_legal_document_version();
drop trigger if exists legal_document_version_no_truncate on chat.legal_document_version;
create trigger legal_document_version_no_truncate
  before truncate on chat.legal_document_version
  for each statement execute function chat.guard_legal_document_version();

-- ---------------------------------------------------------------------------
-- 2. The acceptances
-- ---------------------------------------------------------------------------

create table if not exists chat.terms_acceptance (
  account_id    uuid not null references chat.account (id) on delete restrict,
  document_key  text not null
    constraint terms_acceptance_document_key_check
    check (document_key in ('terms_family', 'terms_teacher', 'terms_staff', 'code_of_conduct')),
  version       text not null,
  accepted_at   timestamptz not null default now(),
  client        text not null
    constraint terms_acceptance_client_check
    check (client in ('android', 'ios', 'web_portal', 'admin_web')),
  -- A BCP 47-shaped tag as the client sent it: 'ar', 'en', 'ar-EG'.
  locale        text not null
    constraint terms_acceptance_locale_check
    check (length(locale) <= 35 and locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$'),
  primary key (account_id, document_key, version),
  foreign key (document_key, version)
    references chat.legal_document_version (document_key, version) on delete restrict
);

-- Who accepted a given version (a new version asks again; the old rows stay).
-- The per-request read (one account's acceptances) is the primary key.
create index if not exists terms_acceptance_document_idx
  on chat.terms_acceptance (document_key, version);

comment on table chat.terms_acceptance is
  'PD-58: an account accepted a version of its terms or of the Code of Conduct, at accepted_at (the database clock), from client, in locale. Immutable: never updated, deleted or truncated; kept through an account erasure as the consent record. Written only by chat.accept_legal_documents.';

create or replace function chat.guard_terms_acceptance()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_kind text;
begin
  if tg_op = 'TRUNCATE' then
    if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
      return null;
    end if;
    raise exception 'terms acceptances are never truncated' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'a terms acceptance is a record; it is never changed' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a terms acceptance is a record; it is never removed' using errcode = 'check_violation';
  end if;

  select a.kind into v_kind from chat.account a where a.id = new.account_id;
  if v_kind is null then
    raise exception 'no such account' using errcode = 'foreign_key_violation';
  end if;
  -- A-3: each kind accepts its own terms and the shared Code of Conduct.
  if new.document_key is distinct from 'code_of_conduct'
     and new.document_key is distinct from (case v_kind
                                              when 'family'  then 'terms_family'
                                              when 'teacher' then 'terms_teacher'
                                              when 'staff'   then 'terms_staff'
                                            end) then
    raise exception '% is not a document a % account accepts', new.document_key, v_kind
      using errcode = 'check_violation';
  end if;
  new.accepted_at := now();
  return new;
end;
$$;

drop trigger if exists terms_acceptance_is_a_record on chat.terms_acceptance;
create trigger terms_acceptance_is_a_record
  before insert or update or delete on chat.terms_acceptance
  for each row execute function chat.guard_terms_acceptance();
drop trigger if exists terms_acceptance_no_truncate on chat.terms_acceptance;
create trigger terms_acceptance_no_truncate
  before truncate on chat.terms_acceptance
  for each statement execute function chat.guard_terms_acceptance();

-- ---------------------------------------------------------------------------
-- 3. The two writers (server-side only)
-- ---------------------------------------------------------------------------

-- The owner's release process publishes a version. Idempotent for a retry: the
-- same version with the same URLs again returns false and changes nothing; the
-- same version with anything different is refused (publish a new version).
-- p_effective_at null means now for a new version, and is not compared on a retry.
create or replace function chat.publish_legal_version(
  p_document_key  text,
  p_version       text,
  p_url_ar        text,
  p_url_en        text,
  p_effective_at  timestamptz default null,
  p_created_by    uuid default null
) returns boolean
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_added integer;
  v_row   chat.legal_document_version%rowtype;
begin
  if p_created_by is not null and not exists (select 1 from chat.account a where a.id = p_created_by) then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;
  insert into chat.legal_document_version (document_key, version, url_ar, url_en, effective_at, created_by)
  values (p_document_key, p_version, p_url_ar, p_url_en, coalesce(p_effective_at, now()), p_created_by)
  on conflict (document_key, version) do nothing;
  get diagnostics v_added = row_count;
  if v_added = 1 then
    return true;
  end if;

  select * into v_row from chat.legal_document_version
   where document_key = p_document_key and version = p_version;
  if v_row.url_ar is distinct from p_url_ar
     or v_row.url_en is distinct from p_url_en
     or (p_effective_at is not null and v_row.effective_at is distinct from p_effective_at) then
    raise exception '% version % is already published, and a published version never changes', p_document_key, p_version
      using errcode = 'check_violation';
  end if;
  return false;
end;
$$;

comment on function chat.publish_legal_version(text, text, text, text, timestamptz, uuid) is
  'PD-58: the owner''s release process publishes a legal document version. Idempotent for an identical retry; a changed version is refused. Server-side only.';

-- The API records an acceptance. It passes the AUTHENTICATED account (the
-- token's), never an id from a request body, and the documents the account
-- accepted: [{"document_key": ..., "version": ...}, ...]. Idempotent: an
-- acceptance already recorded keeps its first time; returns the rows added.
-- One refusal records nothing (the whole call is one statement).
create or replace function chat.accept_legal_documents(
  p_account_id  uuid,
  p_documents   jsonb,
  p_client      text,
  p_locale      text
) returns integer
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_added integer;
  v_total integer := 0;
  r       record;
begin
  if not exists (select 1 from chat.account a where a.id = p_account_id and a.is_active) then
    raise exception 'no such active account' using errcode = 'no_data_found';
  end if;
  if p_documents is null or jsonb_typeof(p_documents) <> 'array'
     or jsonb_array_length(p_documents) not between 1 and 8 then
    raise exception 'accepting terms names at least one document (and at most 8)' using errcode = 'check_violation';
  end if;

  for r in
    select d ->> 'document_key' as document_key, d ->> 'version' as version
      from jsonb_array_elements(p_documents) d
  loop
    if r.document_key is null or r.version is null then
      raise exception 'each accepted document names its document_key and version' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.legal_document_version l
                    where l.document_key = r.document_key and l.version = r.version) then
      raise exception '% version % is not published', r.document_key, r.version using errcode = 'foreign_key_violation';
    end if;
    insert into chat.terms_acceptance (account_id, document_key, version, client, locale)
    values (p_account_id, r.document_key, r.version, p_client, p_locale)
    on conflict (account_id, document_key, version) do nothing;
    get diagnostics v_added = row_count;
    v_total := v_total + v_added;
  end loop;
  return v_total;
end;
$$;

comment on function chat.accept_legal_documents(uuid, jsonb, text, text) is
  'PD-58: records that an account accepted legal document versions, from a client, in a locale. Idempotent; the first acceptance keeps its time. Server-side only.';

-- ---------------------------------------------------------------------------
-- 4. RLS and privileges: fail-closed
-- ---------------------------------------------------------------------------

alter table chat.legal_document_version enable row level security;
alter table chat.terms_acceptance enable row level security;

revoke all on chat.legal_document_version from public, anon, authenticated, chat_app;
revoke all on chat.terms_acceptance from public, anon, authenticated, chat_app;

-- A signed-in account reads its own acceptances; nothing else, and no writes.
grant select on chat.terms_acceptance to authenticated;
drop policy if exists terms_acceptance_own on chat.terms_acceptance;
create policy terms_acceptance_own on chat.terms_acceptance
  for select to authenticated
  using (account_id = chat.current_account_id());

revoke all on function chat.guard_legal_document_version() from public, anon, authenticated, chat_app;
revoke all on function chat.guard_terms_acceptance() from public, anon, authenticated, chat_app;
revoke all on function chat.publish_legal_version(text, text, text, text, timestamptz, uuid) from public, anon, authenticated, chat_app;
revoke all on function chat.accept_legal_documents(uuid, jsonb, text, text) from public, anon, authenticated, chat_app;
