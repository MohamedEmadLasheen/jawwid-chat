-- Jawwid Chat -- foundation: schema, helpers, and the config table.
--
-- Jawwid Chat is the Customer Success operating system described in
-- docs/JAWWID_CHAT_BRIEF.pdf. It lives in the `chat` schema inside the Jawwid
-- Core Supabase database. Core (the `public` schema) stays the source of truth
-- for accounts, children, subscriptions and payments; Jawwid Chat reads Core
-- only through the chat.core_* boundary views added later in this series.
--
-- Brief SS12: "Every number in this brief is treated as a config default with a
-- comment 'initial hypothesis'." Business constants therefore live in
-- chat.config, never inline in a function body.

create schema if not exists chat;

comment on schema chat is
  'Jawwid Chat: Customer Success operating system. Owns communication and '
  'operational workflow data. Reads Jawwid Core only via chat.core_* views.';

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function chat.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blocks UPDATE and DELETE on append-only tables (event_log, audit_log,
-- message). Brief SS3 marks `message` immutable and both logs append-only.
create or replace function chat.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'chat.% is append-only; % is not permitted', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------

create table chat.config (
  key         text primary key,
  value       jsonb not null,
  scope       text not null default 'global',
  description text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

comment on table chat.config is
  'Every weight, threshold and window in the brief. Manager-editable. '
  'All seeded values are initial hypotheses to be recalibrated from event_log '
  'after 60-90 days (brief SS7).';

create trigger config_set_updated_at
  before update on chat.config
  for each row execute function chat.set_updated_at();

-- Typed accessors. These raise if a key is missing rather than silently
-- defaulting, so a deleted config row fails loudly instead of quietly changing
-- operational behaviour.
create or replace function chat.config_num(p_key text)
returns numeric
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select value into v from chat.config where key = p_key;
  if v is null then
    raise exception 'chat.config key % is not set', p_key
      using errcode = 'no_data_found';
  end if;
  return (v #>> '{}')::numeric;
end;
$$;

create or replace function chat.config_int(p_key text)
returns integer
language sql
stable
as $$ select chat.config_num(p_key)::integer $$;

create or replace function chat.config_text(p_key text)
returns text
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select value into v from chat.config where key = p_key;
  if v is null then
    raise exception 'chat.config key % is not set', p_key
      using errcode = 'no_data_found';
  end if;
  return v #>> '{}';
end;
$$;

create or replace function chat.config_json(p_key text)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  select value into v from chat.config where key = p_key;
  if v is null then
    raise exception 'chat.config key % is not set', p_key
      using errcode = 'no_data_found';
  end if;
  return v;
end;
$$;
