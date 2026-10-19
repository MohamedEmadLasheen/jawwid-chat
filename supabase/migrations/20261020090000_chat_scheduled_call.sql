-- PD-13 (2026-10-19) -- scheduled calls and members-only call links.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-13, and
-- docs/communication/scheduled-calls.md.
--
-- WHAT IS NEW
--
--   chat.scheduled_call   one row per scheduled call or call link. It belongs to
--                         exactly ONE conversation (owner decision: a call
--                         always happens inside one conversation; several
--                         people means their group). Its card is posted there,
--                         so every member sees it.
--
-- WHAT IT IS NOT
--
--   * Not a call. No chat.call row exists until somebody taps Join inside the
--     window; the call is then started (or joined) through the existing call
--     path, which decides authorization again from scratch. A scheduled call
--     grants nothing.
--   * Not a capability. Its id is a name: joining it requires reading its
--     conversation and being a participant of the call, exactly as for any
--     other call. There is no guest access and no token in a link.
--   * Not edited. A row is created, optionally linked to the call it started,
--     and optionally cancelled -- nothing else moves.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

create table chat.scheduled_call (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  conversation_id  uuid not null references chat.conversation (id),
  -- 'scheduled': chosen date and time. 'link': joinable from the moment it is made.
  kind             text not null check (kind in ('scheduled', 'link')),
  title            text check (title is null or length(btrim(title)) between 1 and 120),
  starts_at        timestamptz not null,
  created_by       uuid not null,
  created_by_kind  text not null check (created_by_kind in ('contact', 'staff', 'teacher')),
  created_at       timestamptz not null default now(),
  -- The card message that announced it in the conversation.
  message_id       uuid unique references chat.message (id),
  -- The call the first Join started. Later joiners join that call while it is live.
  call_id          uuid references chat.call (id),
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  constraint scheduled_call_cancel_is_whole
    check ((cancelled_at is null) = (cancelled_by is null))
);

comment on table chat.scheduled_call is
  'PD-13: a scheduled call or members-only call link, inside one conversation. Announces itself with a card; grants nothing -- Join starts or joins a call through the ordinary call path.';

create index scheduled_call_conversation_idx on chat.scheduled_call (conversation_id, starts_at);
create index scheduled_call_upcoming_idx on chat.scheduled_call (organization_id, starts_at) where cancelled_at is null;

create or replace function chat.guard_scheduled_call()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a scheduled call is never deleted; cancel it' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from chat.conversation c
       where c.id = new.conversation_id and c.organization_id = new.organization_id
    ) then
      raise exception 'a scheduled call is filed under its conversation''s organization'
        using errcode = 'insufficient_privilege';
    end if;
    if new.cancelled_at is not null or new.call_id is not null then
      raise exception 'a scheduled call is created open' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: the card, the call and the cancellation are each written once.
  if (new.id, new.organization_id, new.conversation_id, new.kind, new.title, new.starts_at,
      new.created_by, new.created_by_kind, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.conversation_id, old.kind, old.title, old.starts_at,
      old.created_by, old.created_by_kind, old.created_at) then
    raise exception 'a scheduled call is never edited' using errcode = 'check_violation';
  end if;
  if old.message_id is not null and new.message_id is distinct from old.message_id then
    raise exception 'a scheduled call''s card is written once' using errcode = 'check_violation';
  end if;
  if old.cancelled_at is not null
     and (new.cancelled_at, new.cancelled_by) is distinct from (old.cancelled_at, old.cancelled_by) then
    raise exception 'a scheduled call is cancelled once' using errcode = 'check_violation';
  end if;
  if new.call_id is distinct from old.call_id and new.call_id is not null and not exists (
    select 1 from chat.call k
     where k.id = new.call_id and k.conversation_id = new.conversation_id
  ) then
    raise exception 'a scheduled call starts a call in its own conversation' using errcode = 'check_violation';
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

create trigger scheduled_call_is_coherent
  before insert or update or delete on chat.scheduled_call
  for each row execute function chat.guard_scheduled_call();

-- ===========================================================================
-- Card kinds
-- ===========================================================================

insert into chat.message_card_kind (kind) values
  ('call_scheduled'), ('call_link'), ('call_schedule_cancelled');

-- ===========================================================================
-- Request roles: none
-- ===========================================================================

alter table chat.scheduled_call enable row level security;
revoke all on chat.scheduled_call from public, anon, authenticated, chat_app;
revoke all on function chat.guard_scheduled_call() from public;
