-- Jawwid Chat -- Phase 7.3: suggested replies.
--
-- ## The one rule
--
-- A suggestion is a DRAFT. It is not a message, it is not queued for delivery,
-- and nothing in this system turns one into a message except a person pressing
-- send. Phase 7 §10 states it; this schema is shaped so that it is hard to
-- violate by accident.
--
-- The important design choice is that chat.ai_suggestion is NOT chat.message
-- with a flag. A pending row in the message table -- however carefully
-- filtered -- is one forgotten `where` clause away from being delivered by the
-- outbox, counted as unread, or shown in a parent's thread. A draft in its own
-- table cannot be delivered by code that does not know it exists, and the only
-- bridge is SuggestionService.send, which calls MessageService.send exactly as
-- a manager typing the words would.
--
-- The consequence: an AI-drafted reply is subject to canSend, BR-1, scope and
-- moderation, because it goes through the same pipeline and is authored by the
-- MANAGER, not by the model.

create table if not exists chat.ai_suggestion (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),

  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  -- Who asked for it. A suggestion belongs to the person who requested it: it
  -- was drafted against what THEY may read, so it is not another supervisor's
  -- to send.
  requested_by    uuid not null references chat.staff (id) on delete cascade,

  -- The drafted words. Reviewed as text by a human before they go anywhere.
  body            text not null check (length(btrim(body)) > 0),

  -- pending       -> awaiting the human decision
  -- sent          -> sent unchanged
  -- edited_sent   -> the manager rewrote it first (the useful signal: a high
  --                  edited_sent rate means the drafts are not good enough)
  -- dismissed     -> explicitly rejected
  -- superseded    -> a newer suggestion replaced it, or the conversation moved on
  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'edited_sent', 'dismissed', 'superseded')),

  -- What the model was, and how sure it said it was. Kept for §44, and so a
  -- bad batch of suggestions can be traced to a model change.
  model           text,
  confidence      numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Approved articles the draft was grounded on, if any. uuid[] rather than a
  -- join table: it is read whole, never queried across, and never joined.
  knowledge_ids   uuid[] not null default '{}',

  -- The message that was actually sent, when one was. This is the audit link
  -- between "the assistant proposed" and "this went to the family".
  sent_message_id uuid references chat.message (id) on delete set null,

  resolved_by     uuid references chat.staff (id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),

  -- A resolved suggestion names who resolved it and when. Without this a row
  -- could report "sent" with nobody attached, which is precisely the claim
  -- this table exists to make impossible.
  constraint ai_suggestion_resolution_attributed
    check (status = 'pending'
           or (resolved_by is not null and resolved_at is not null)),
  -- ...and a sent one names the message. "Sent, but we cannot say what" is not
  -- an auditable outcome.
  constraint ai_suggestion_sent_names_message
    check (status not in ('sent', 'edited_sent') or sent_message_id is not null)
);

comment on table chat.ai_suggestion is
  'A drafted reply awaiting a human decision. Deliberately NOT a row in '
  'chat.message with a flag: a draft in its own table cannot be delivered by '
  'code that does not know it exists, and the only bridge to delivery is '
  'SuggestionService.send, which goes through MessageService.send authored by '
  'the manager (Phase 7 §10).';

-- The console read: what is waiting for me on this conversation.
create index if not exists ai_suggestion_pending_idx
  on chat.ai_suggestion (conversation_id, created_at desc)
  where status = 'pending';

-- "How often are the drafts good enough to send unchanged?" (§44)
create index if not exists ai_suggestion_outcome_idx
  on chat.ai_suggestion (organization_id, status, created_at desc);

create index if not exists ai_suggestion_requester_idx
  on chat.ai_suggestion (requested_by, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS -- deny by default
-- ---------------------------------------------------------------------------

alter table chat.ai_suggestion enable row level security;

drop policy if exists ai_suggestion_organization_isolation on chat.ai_suggestion;
create policy ai_suggestion_organization_isolation on chat.ai_suggestion
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- A suggestion is visible to the person who asked for it, and to auditors.
--
-- NOT to every member of the conversation. A draft is an unreviewed machine
-- opinion about what to say to a family, and the family is IN the conversation.
-- Widening this to conversation membership would put the drafts in front of
-- the parent they are about.
drop policy if exists ai_suggestion_readable_by_requester on chat.ai_suggestion;
create policy ai_suggestion_readable_by_requester on chat.ai_suggestion
  for select to authenticated
  using (requested_by in (select chat.current_actor_ids())
         or chat.current_has_permission('audit.read'));

grant select on chat.ai_suggestion to authenticated;
grant select, insert, update on chat.ai_suggestion to chat_app;
grant select, insert, update, delete on chat.ai_suggestion to service_role;

-- WRITES `to authenticated`, never `for all to chat_app using (true)` -- the
-- permissive form would OR away the read policy above and show every
-- supervisor's drafts to every authenticated session (20260907150100 §6).

drop policy if exists ai_suggestion_written_by_requester on chat.ai_suggestion;
create policy ai_suggestion_written_by_requester on chat.ai_suggestion
  for insert to authenticated
  with check (
    chat.current_has_permission('ai.use')
    -- A suggestion cannot be created on somebody else's behalf. If it could,
    -- one supervisor could plant a draft in another's queue.
    and requested_by in (select chat.current_actor_ids())
    -- And it starts pending. There is no INSERT that arrives already sent.
    and status = 'pending'
  );

drop policy if exists ai_suggestion_resolved_by_requester on chat.ai_suggestion;
create policy ai_suggestion_resolved_by_requester on chat.ai_suggestion
  for update to authenticated
  using (requested_by in (select chat.current_actor_ids()))
  with check (requested_by in (select chat.current_actor_ids()));

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
('ai.suggestion_stale_minutes', '120', 'ai',
 'INITIAL HYPOTHESIS - a pending suggestion older than this is superseded rather than offered, because the conversation has moved on and a stale draft is worse than none.')
on conflict (key) do nothing;
