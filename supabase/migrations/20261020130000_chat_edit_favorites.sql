-- =============================================================================
-- Edited messages and favorite chats (owner request 2026-10-19)
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
-- Favorites
-- ---------------------------------------------------------------------------

alter table chat.conversation_participant_state add column if not exists favorited_at timestamptz;

-- ---------------------------------------------------------------------------
-- Access: the API's owner connection only, like message_reaction / message_star.
-- ---------------------------------------------------------------------------

alter table chat.message_revision enable row level security;

grant select, insert, update, delete on chat.message_revision to service_role;
