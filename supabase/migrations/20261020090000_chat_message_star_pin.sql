-- =============================================================================
-- Starred and pinned messages (Chat UI group B, owner decisions 2026-10-19)
-- =============================================================================
--
-- STAR: a private bookmark. One row per (message, actor); nobody else ever sees
-- it. Listed back to its owner as "Starred messages", only while the owner may
-- still read the message.
--
-- PIN: shared with everyone in the conversation. Anyone who may WRITE in the
-- conversation may pin or unpin (owner decision: "anyone who can write"); at
-- most THREE per conversation -- pinning a fourth replaces the oldest, in the
-- same transaction (MessageService.pin). The cap is also enforced here, so no
-- writer can exceed it whatever the application does.
--
-- Both follow chat.message_reaction: they hang off chat.message (and cascade
-- with it), inherit the organization through it, and are written only by the
-- API's owner connection. RLS is enabled with NO policy, so the request roles
-- (authenticated, chat_app) reach nothing here by construction.

create table if not exists chat.message_star (
  message_id uuid not null references chat.message (id) on delete cascade,
  actor_id   uuid not null,
  starred_at timestamptz not null default clock_timestamp(),
  primary key (message_id, actor_id)
);

comment on table chat.message_star is
  'A private bookmark: (message, actor). Visible only to that actor, and only '
  'while they may still read the message.';

create index if not exists message_star_actor_idx
  on chat.message_star (actor_id, starred_at desc);

create table if not exists chat.message_pin (
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  message_id      uuid not null references chat.message (id) on delete cascade,
  pinned_by       uuid not null,
  pinned_by_kind  text not null check (pinned_by_kind in ('staff', 'contact', 'teacher')),
  pinned_at       timestamptz not null default clock_timestamp(),
  primary key (conversation_id, message_id)
);

comment on table chat.message_pin is
  'A message pinned for everyone in its conversation. At most three per '
  'conversation; the message must belong to that conversation.';

create index if not exists message_pin_conversation_idx
  on chat.message_pin (conversation_id, pinned_at);

-- A pin names a message OF THIS conversation, and a conversation holds at most
-- three. Checked on the row, so a direct SQL session is held to it as well.
create or replace function chat.enforce_message_pin()
returns trigger
language plpgsql
as $$
declare
  v_conv uuid;
  v_count int;
begin
  select conversation_id into v_conv from chat.message where id = new.message_id;
  if v_conv is distinct from new.conversation_id then
    raise exception 'a pinned message must belong to the conversation it is pinned in'
      using errcode = 'check_violation';
  end if;
  select count(*) into v_count from chat.message_pin where conversation_id = new.conversation_id;
  if v_count >= 3 then
    raise exception 'a conversation holds at most three pinned messages'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists message_pin_guard on chat.message_pin;
create trigger message_pin_guard
  before insert on chat.message_pin
  for each row execute function chat.enforce_message_pin();

alter table chat.message_star enable row level security;
alter table chat.message_pin enable row level security;

grant select, insert, update, delete on chat.message_star to service_role;
grant select, insert, update, delete on chat.message_pin to service_role;
