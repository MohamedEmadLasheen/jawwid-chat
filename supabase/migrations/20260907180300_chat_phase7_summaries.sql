-- Jawwid Chat -- Phase 7.4: conversation summaries.
--
-- ## Authorization is the conversation's, not the summary's
--
-- Phase 7 §14: if a person cannot read a conversation, they cannot read its
-- summary. A summary is a DERIVED COPY of a conversation, so a permission model
-- of its own would be a second, weaker answer to a question the system already
-- answers -- and the weaker answer is the one an attacker would use. The read
-- policy below therefore delegates: it grants nothing that
-- chat.conversation's own visibility does not already grant.
--
-- ## Why the summary is cached, and why up_to_seq is the cache key
--
-- Summarising is slow and costs money, and a manager opening the same thread
-- three times should pay once. But a cached summary of a conversation that has
-- since moved on is actively misleading -- worse than no summary, because it
-- reads as current. up_to_seq records the last message included, so a cached
-- row is reusable exactly while the conversation has not advanced past it, and
-- staleness is a comparison rather than a guess about elapsed time.

create table if not exists chat.conversation_summary (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),

  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  generated_by    uuid references chat.staff (id) on delete set null,

  -- The four sections Phase 7 §12 requires. Separate columns rather than one
  -- blob: a client renders them as labelled sections, and a model that
  -- returned three of the four fails validation here instead of producing a
  -- summary that quietly lacks "pending action" -- the section a manager
  -- actually acts on.
  problem           text not null,
  what_was_done     text not null,
  pending_action    text not null,
  important_history text not null,

  -- Phase 7 §13: what the model INFERRED rather than read. Kept structurally
  -- separate from the four sections because a hedge inside prose is a hedge a
  -- hurried reader skips, while a distinct "inferred, not stated" list cannot
  -- be mistaken for the record.
  inferences        text[] not null default '{}',

  -- The last message.seq included. The cache key, and the staleness test.
  up_to_seq         bigint not null,
  model             text,
  created_at        timestamptz not null default now()
);

comment on table chat.conversation_summary is
  'A cached, structured summary of one conversation up to a known message seq. '
  'Readable exactly by those who may read the conversation (Phase 7 §14); '
  'reusable exactly while the conversation has not advanced past up_to_seq.';

-- The cache lookup: newest summary for this conversation.
create index if not exists conversation_summary_lookup_idx
  on chat.conversation_summary (conversation_id, up_to_seq desc, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS -- deny by default, and delegated to the conversation
-- ---------------------------------------------------------------------------

alter table chat.conversation_summary enable row level security;

drop policy if exists conversation_summary_organization_isolation on chat.conversation_summary;
create policy conversation_summary_organization_isolation on chat.conversation_summary
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- THE §14 rule, expressed as a subquery against chat.conversation rather than
-- as a re-derivation of who may read what.
--
-- `exists (select 1 from chat.conversation ...)` runs under the CALLER's
-- privileges, so chat.conversation's own row-level policies apply to that
-- subquery. If the conversation is not visible to this session, the subquery
-- finds nothing and the summary is not visible either -- automatically, and
-- without this policy containing a single membership or scope rule that could
-- drift from the real one.
--
-- Staff only, additionally: a summary is an operational artefact written for
-- whoever is handling the case, and it names what staff still owe the family.
drop policy if exists conversation_summary_readable_with_conversation on chat.conversation_summary;
create policy conversation_summary_readable_with_conversation on chat.conversation_summary
  for select to authenticated
  using (
    chat.current_has_permission('ai.use')
    and exists (
      select 1 from chat.conversation c
      where c.id = conversation_id
    )
  );

grant select on chat.conversation_summary to authenticated;
grant select, insert on chat.conversation_summary to chat_app;
grant select, insert, update, delete on chat.conversation_summary to service_role;

-- WRITE `to authenticated`, never `for all to chat_app using (true)` -- which
-- is permissive and would OR away the delegation above, making every summary in
-- the organization readable by every authenticated session and turning this
-- table into precisely the authorization bypass §14 forbids.
drop policy if exists conversation_summary_written_by_reader on chat.conversation_summary;
create policy conversation_summary_written_by_reader on chat.conversation_summary
  for insert to authenticated
  with check (
    chat.current_has_permission('ai.use')
    and (generated_by is null or generated_by in (select chat.current_actor_ids()))
    and exists (
      select 1 from chat.conversation c
      where c.id = conversation_id
    )
  );
