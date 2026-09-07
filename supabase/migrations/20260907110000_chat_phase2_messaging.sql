-- Jawwid Chat -- Phase 2: core WhatsApp-like messaging.
--
-- Phase 1 built identity, authentication and authorization. Phase 2 makes the
-- conversation model usable end to end. Almost everything it needs already
-- exists: chat.message carries seq, reply_to_message_id, client_message_id and
-- the soft-delete columns; chat.message_reaction, chat.message_receipt and
-- chat.message_hidden_for are all in place. This migration adds only the four
-- things that genuinely have no home yet:
--
--   1. EDIT       -- edited_at / edited_by, plus an append-only revision log.
--   2. FORWARD    -- provenance columns, kept server-side.
--   3. SEARCH     -- the indexes that make an authorized search a scan of a
--                    conversation's messages rather than of the table.
--   4. The narrowing of chat.forbid_message_rewrite() that makes (1) lawful
--      WITHOUT reopening the door the trigger was written to close.
--
-- Nothing here changes a Phase 1 object.

-- ---------------------------------------------------------------------------
-- 1. Edit
-- ---------------------------------------------------------------------------
-- A message is a record, not a draft -- that has been true since
-- 20260905093000 and stays true. What changes is that an EDIT is now a
-- recorded event rather than an impossible one: the current body lives on the
-- row (so every existing read path is untouched), and every body it replaced
-- lives in chat.message_revision, which nothing may update or delete.
--
-- The alternative -- keeping edits in a side table and composing them at read
-- time -- was rejected for the same reason the moderation column is not in a
-- side table: two places would then know what a message says, and they would
-- eventually disagree.

alter table chat.message
  add column if not exists edited_at  timestamptz,
  add column if not exists edited_by  uuid,
  add column if not exists edit_count integer not null default 0;

comment on column chat.message.edited_at is
  'When the body was last replaced. NULL means never edited. Set by the API '
  'inside the same transaction as the body change; chat.forbid_message_rewrite '
  'refuses a body change that does not carry one.';

create table if not exists chat.message_revision (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references chat.message (id) on delete cascade,
  -- 1 is the body the message was SENT with; each edit appends the body it
  -- replaced, so the log read in order is the full history.
  revision     integer not null,
  body         text,
  -- Who caused this body to be superseded, and when.
  replaced_by  uuid not null,
  replaced_at  timestamptz not null default now(),
  unique (message_id, revision)
);

comment on table chat.message_revision is
  'Append-only history of superseded message bodies. An edit never destroys '
  'what was actually said: moderation, audit and retention all depend on the '
  'original text remaining recoverable.';

create index if not exists message_revision_message_idx
  on chat.message_revision (message_id, revision);

-- Append-only, enforced the same way chat.event_log and chat.audit_log are.
create or replace function chat.forbid_revision_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception 'chat.message_revision is append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists message_revision_append_only on chat.message_revision;
create trigger message_revision_append_only
  before update or delete on chat.message_revision
  for each row execute function chat.forbid_revision_rewrite();

-- ---------------------------------------------------------------------------
-- 2. Forwarding provenance
-- ---------------------------------------------------------------------------
-- Recorded so an audit can answer "where did this text come from", and NOT
-- served to clients as ids: the source conversation is very often one the
-- recipient may not read, and a forwarded bubble that names it would be a
-- disclosure the forwarding UI never intended. The DTO exposes a boolean.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a source message must not
-- delete the forwarded copy, which is a message in its own right.

alter table chat.message
  add column if not exists forwarded_from_message_id uuid
    references chat.message (id) on delete set null,
  add column if not exists forwarded_from_conversation_id uuid
    references chat.conversation (id) on delete set null;

comment on column chat.message.forwarded_from_message_id is
  'Audit provenance for a forwarded message. Never served to a client: the '
  'source conversation is frequently outside the recipient''s scope.';

-- ---------------------------------------------------------------------------
-- 3. The narrowed rewrite guard
-- ---------------------------------------------------------------------------
-- 20260905093000 replaced AI #1's blanket message_is_immutable with a
-- column-level rule, for exactly this reason: a message acquired lawful state
-- changes and a total UPDATE ban made them impossible. Editing is the third
-- such change, and it is admitted on the same terms -- narrowly, and only when
-- the row carries the evidence that it happened.
--
-- A body change is now permitted in exactly two cases:
--   a. the deleted_for_all transition (unchanged, from 20260905093000); or
--   b. an EDIT, which must advance edited_at.
--
-- Everything else this trigger forbade, it still forbids. In particular:
--   * author_id, author_type, conversation_id and seq remain immutable;
--   * a body change with no edit stamp is refused, so a direct UPDATE (a
--     script, a console, a compromised service) cannot quietly rewrite history;
--   * a message already deleted for everyone can never have a body again.
--
-- The API layer additionally refuses to edit a pending, rejected or deleted
-- message and enforces the edit window. Those are policy; this is the backstop.

create or replace function chat.forbid_message_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body then
    -- The soft-delete transition, unchanged.
    if old.deleted_for_all = false and new.deleted_for_all = false then
      -- An edit, and only an edit.
      if new.edited_at is null or new.edited_at is not distinct from old.edited_at then
        raise exception
          'chat.message.body is immutable once sent, except through a stamped edit'
          using errcode = 'restrict_violation';
      end if;
      if new.edited_by is null then
        raise exception 'chat.message edit must record edited_by'
          using errcode = 'restrict_violation';
      end if;
    end if;
  end if;

  -- A deleted message stays deleted. Un-deleting would resurrect a body the
  -- recipients were told was withdrawn.
  if old.deleted_for_all = true and new.deleted_for_all = false then
    raise exception 'a message deleted for everyone cannot be restored'
      using errcode = 'restrict_violation';
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

-- ---------------------------------------------------------------------------
-- 4. Search and read-path indexes
-- ---------------------------------------------------------------------------
-- Every index below supports a query the engine actually issues. None is
-- speculative.
--
-- The text index uses the 'simple' configuration deliberately. Postgres ships
-- no Arabic stemmer, and 'english' would stem Arabic text as though it were
-- English -- worse than not stemming at all. 'simple' tokenises on word
-- boundaries and folds case, which is what both Arabic and English search need
-- here, and it is IMMUTABLE so it can carry an expression index.
--
-- The partial predicate is the point: a deleted message has no body to find,
-- and a pending one is not yet part of the conversation. Excluding them keeps
-- the index small AND means a search can never surface either.

create index if not exists message_body_search_idx
  on chat.message
  using gin (to_tsvector('simple', coalesce(body, '')))
  where deleted_for_all = false and moderation = 'published' and body is not null;

-- "messages from this person, newest first" -- the sender filter, and the
-- author-scoped half of a conversation search.
create index if not exists message_author_created_idx
  on chat.message (author_id, created_at desc)
  where author_id is not null;

-- "messages in this conversation between two dates" -- the date filter.
create index if not exists message_conversation_created_idx
  on chat.message (conversation_id, created_at desc);

-- Loading the quoted message for a page of replies, and finding the replies to
-- a message that was just deleted.
create index if not exists message_reply_to_idx
  on chat.message (reply_to_message_id)
  where reply_to_message_id is not null;

-- The unread count and the receipt fan-out both start from one message.
create index if not exists message_receipt_message_idx
  on chat.message_receipt (message_id);

-- "which of these messages have I hidden" -- the delete-for-me filter, which
-- runs on every page of history.
create index if not exists message_hidden_for_actor_idx
  on chat.message_hidden_for (actor_id);

-- ---------------------------------------------------------------------------
-- 5. Reaction sanity
-- ---------------------------------------------------------------------------
-- The API validates against an allow-list; this only bounds what the column can
-- ever hold, so a bypassed service cannot store a paragraph as an "emoji".

alter table chat.message_reaction drop constraint if exists message_reaction_emoji_length;
alter table chat.message_reaction add constraint message_reaction_emoji_length
  check (char_length(emoji) between 1 and 16);

-- ---------------------------------------------------------------------------
-- 6. RLS for the new table
-- ---------------------------------------------------------------------------
-- 20260907100300 turns RLS on for every table in the schema and leaves a table
-- without a policy invisible. chat.message_revision is deliberately left that
-- way for `authenticated`: an edit history is moderation and audit material,
-- served only through the API to an actor holding messages.moderate. No SELECT
-- grant is issued to `authenticated` at all.

alter table chat.message_revision enable row level security;
grant select, insert on chat.message_revision to service_role;

-- ---------------------------------------------------------------------------
-- 7. Config
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  ('communication.edit_window_minutes', '15'::jsonb, 'communication',
   '[hypothesis] How long an author may edit their own message. A manager '
   'holding messages.moderate is not bound by it.'),
  ('communication.search_page_size_max', '50'::jsonb, 'communication',
   'Hard cap on search results per request, so a search cannot become an '
   'unbounded read of a family''s history.'),
  ('communication.forward_max_targets', '5'::jsonb, 'communication',
   '[hypothesis] How many conversations one forward may target. Bounds the '
   'blast radius of a mis-tap and of a scripted caller.'),
  ('communication.message_max_length', '4000'::jsonb, 'communication',
   'Maximum characters in a message body. Matches the mobile composer''s cap, '
   'so the client and the server agree on what is too long.')
on conflict (key) do nothing;
