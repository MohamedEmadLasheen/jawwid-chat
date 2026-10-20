-- =============================================================================
-- Edited messages, chat labels and favorite chats (owner request 2026-10-19)
-- =============================================================================
--
-- EDIT. A sent message's body was made immutable by 20260905093000
-- (chat.forbid_message_rewrite), and that protection stays for every rewrite
-- that is not a recorded edit. An edit is lawful only when:
--
--   * the message is a published, never-moderated TEXT message, not deleted;
--   * the same transaction wrote a chat.message_revision row holding the body
--     being replaced, stamped with the new edited_at.
--
-- So no edit can happen without leaving the previous wording behind, and a
-- message that went through approval can never be changed afterwards -- an
-- approved text is exactly the text that was approved (admin-contract.md:
-- "an approver can never edit a message"; neither can its author, after).
-- Who may edit, and for how long, is the API's decision (MessageService.edit);
-- this is the floor any writer is held to.
--
-- LABELS. An organization's shared tags for conversations ("Payment issue",
-- "Trial", ...). Staff only: created, renamed, recoloured and deleted by
-- conversation staff, applied to conversations they can read, and never sent
-- to a parent or a teacher.
--
-- FAVORITES. A viewer's own list of chats, like pinned/archived/muted: one
-- column on chat.conversation_participant_state.

-- ---------------------------------------------------------------------------
-- Edit
-- ---------------------------------------------------------------------------

alter table chat.message add column if not exists edited_at timestamptz;

create table if not exists chat.message_revision (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references chat.message (id) on delete cascade,
  previous_body  text not null,
  edited_by      uuid not null,
  edited_by_kind text not null check (edited_by_kind in ('staff', 'contact', 'teacher')),
  edited_at      timestamptz not null
);

comment on table chat.message_revision is
  'The wording a message had before each edit. Written in the same transaction '
  'as the edit; chat.forbid_message_rewrite refuses an edit without one.';

create index if not exists message_revision_message_idx
  on chat.message_revision (message_id, edited_at);

-- A revision is history: never rewritten.
create or replace function chat.forbid_revision_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception 'chat.message_revision rows are immutable'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists message_revision_no_rewrite on chat.message_revision;
create trigger message_revision_no_rewrite
  before update on chat.message_revision
  for each row execute function chat.forbid_revision_rewrite();

create or replace function chat.forbid_message_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     and old.deleted_for_all = false and new.deleted_for_all = false then
    -- The one lawful rewrite: a recorded edit of a published, unmoderated text.
    if not (
      new.edited_at is not null
      and new.edited_at is distinct from old.edited_at
      and old.type = 'text'
      and old.moderation = 'published'
      and new.moderation = 'published'
      and new.body is not null
      and not exists (select 1 from chat.message_approval a where a.message_id = old.id)
      and exists (
        select 1 from chat.message_revision r
         where r.message_id = old.id
           and r.edited_at = new.edited_at
           and r.previous_body is not distinct from old.body
      )
    ) then
      raise exception 'chat.message.body is immutable once sent'
        using errcode = 'restrict_violation';
    end if;
  end if;
  if new.author_id is distinct from old.author_id
     or new.author_type is distinct from old.author_type
     or new.conversation_id is distinct from old.conversation_id
     or new.seq is distinct from old.seq then
    raise exception 'chat.message identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

insert into chat.config (key, value, scope, description) values
  ('communication.edit_window_minutes', '15'::jsonb, 'communication',
   '[hypothesis] How long after sending an author may edit a text message.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------

create table if not exists chat.chat_label (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  -- One of the eight label tones the clients draw (1..8).
  color           smallint not null default 1 check (color between 1 and 8),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.chat_label is
  'An organization''s shared conversation label. Staff only; never served to a '
  'parent or a teacher.';

create unique index if not exists chat_label_org_name_key
  on chat.chat_label (organization_id, lower(btrim(name)));

drop trigger if exists chat_label_set_updated_at on chat.chat_label;
create trigger chat_label_set_updated_at
  before update on chat.chat_label
  for each row execute function chat.set_updated_at();

create table if not exists chat.conversation_label (
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  label_id        uuid not null references chat.chat_label (id) on delete cascade,
  labeled_by      uuid not null,
  labeled_at      timestamptz not null default now(),
  primary key (conversation_id, label_id)
);

create index if not exists conversation_label_label_idx
  on chat.conversation_label (label_id);

-- A label is applied only inside its own organization, whoever writes.
create or replace function chat.enforce_conversation_label_tenant()
returns trigger
language plpgsql
as $$
declare
  v_label_org uuid;
  v_conv_org  uuid;
begin
  select organization_id into v_label_org from chat.chat_label where id = new.label_id;
  select organization_id into v_conv_org from chat.conversation where id = new.conversation_id;
  if v_label_org is distinct from v_conv_org then
    raise exception 'a label belongs to the organization of the conversation it is applied to'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_label_tenant on chat.conversation_label;
create trigger conversation_label_tenant
  before insert or update on chat.conversation_label
  for each row execute function chat.enforce_conversation_label_tenant();

-- ---------------------------------------------------------------------------
-- Favorites
-- ---------------------------------------------------------------------------

alter table chat.conversation_participant_state add column if not exists favorited_at timestamptz;

-- ---------------------------------------------------------------------------
-- Access: the API's owner connection only, like message_reaction / message_star.
-- ---------------------------------------------------------------------------

alter table chat.message_revision enable row level security;
alter table chat.chat_label enable row level security;
alter table chat.conversation_label enable row level security;

grant select, insert, update, delete on chat.message_revision to service_role;
grant select, insert, update, delete on chat.chat_label to service_role;
grant select, insert, update, delete on chat.conversation_label to service_role;
