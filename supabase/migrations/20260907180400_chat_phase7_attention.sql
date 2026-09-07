-- Jawwid Chat -- Phase 7.5: risk detection and attention flags.
--
-- ## Why this is a NEW table and not the existing attention machinery
--
-- The product boundary (§3) freezes `attention_*`, chat.family_state_cache and
-- the attention buckets as deprecated CRM tooling: "no new code may depend on
-- it". Phase 7 §16 suggests reusing existing flag infrastructure; here that
-- would mean building the AI layer on machinery scheduled for removal. So this
-- is a new, small table -- and it is the boundary document's own note that "the
-- IDEA (needs-reply queue) returns as a conversation section in the console"
-- being implemented.
--
-- ## A flag is a REQUEST FOR ATTENTION, never a business action
--
-- Phase 7 §18. Detecting cancellation intent must not cancel anything. There is
-- no column here that any billing, subscription, assignment or lifecycle code
-- reads, and no trigger that writes to one. The only thing a flag can do is
-- appear in a manager's queue.
--
-- ## Deterministic where the facts are deterministic
--
-- Phase 7 §15/§20. "No staff reply for 30 hours" is arithmetic over
-- chat.conversation.last_customer_message_at and last_staff_message_at, and it
-- is computed in SQL by the sweep -- never asked of a model, which would be
-- slower, more expensive and wrong. The model is used only for the judgement a
-- clock cannot make: whether the words are angry, or whether "we might stop"
-- means leaving.

create table if not exists chat.attention_flag (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),

  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  family_id       uuid references chat.family (id) on delete cascade,

  risk_type       text not null check (risk_type in (
                    'frustrated_parent',
                    'unanswered_messages',
                    'potential_escalation',
                    'cancellation_intent')),

  severity        text not null check (severity in ('low', 'medium', 'high')),

  -- Null for a deterministic flag. An unanswered-messages flag is arithmetic
  -- and has no confidence to report; claiming 1.0 would put a model's units on
  -- a fact that never went near one.
  confidence      numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- WHY, in one or two sentences a manager can read (§17). Deliberately a
  -- short evidence summary and not model reasoning: §17 asks to avoid exposing
  -- internal chain-of-thought, and a manager needs "they mentioned stopping
  -- twice", not a transcript of deliberation.
  reason          text not null check (length(btrim(reason)) > 0),

  -- 'sweep' for the deterministic detector, 'ai' for the classifier. So a
  -- manager can tell a clock from a judgement, and so a bad model can be
  -- measured against flags that never involved one.
  detected_by     text not null default 'ai' check (detected_by in ('ai', 'sweep')),

  status          text not null default 'open'
                    check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),

  -- The message this was raised on. Bounds re-detection: the sweep does not
  -- raise the same risk again until the conversation has moved past it.
  detected_up_to_seq bigint not null default 0,

  resolved_by     uuid references chat.staff (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,

  created_at      timestamptz not null default now(),

  constraint attention_flag_resolution_attributed
    check (status in ('open', 'acknowledged')
           or (resolved_by is not null and resolved_at is not null))
);

comment on table chat.attention_flag is
  'A request for a manager to look at a conversation. NOT a business action: '
  'nothing in billing, subscriptions, assignment or lifecycle reads this table '
  '(Phase 7 §18). New rather than reusing the frozen attention_* machinery, '
  'which the product boundary §3 forbids new code from depending on.';

-- THE duplicate guard (§25, §40).
--
-- One OPEN flag per (conversation, risk_type). A partial unique index rather
-- than a check in the sweep, because the sweep runs on several worker replicas
-- at once and two of them classifying the same conversation in the same second
-- is the normal case, not the edge case. The database refuses the second
-- insert; the sweep does not have to win a race it cannot see.
--
-- Resolved and dismissed rows are excluded, so a risk that recurs after being
-- handled can be raised again -- which is a different event and deserves to be.
create unique index if not exists attention_flag_one_open_per_risk
  on chat.attention_flag (conversation_id, risk_type)
  where status in ('open', 'acknowledged');

-- The Manager Command Center read: what is open, worst first.
create index if not exists attention_flag_queue_idx
  on chat.attention_flag (organization_id, severity desc, created_at desc)
  where status in ('open', 'acknowledged');

create index if not exists attention_flag_family_idx
  on chat.attention_flag (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into chat.permission (key, description) values
('attention.read',    'See the attention flags raised on conversations in scope'),
('attention.resolve', 'Acknowledge, resolve or dismiss an attention flag')
on conflict (key) do update set description = excluded.description;

insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  ('admin',          'attention.read'),
  ('coverage_admin', 'attention.read'),
  ('manager',        'attention.read'),
  ('super_admin',    'attention.read'),
  ('admin',          'attention.resolve'),
  ('coverage_admin', 'attention.resolve'),
  ('manager',        'attention.resolve'),
  ('super_admin',    'attention.resolve')
) as r(role, permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- RLS -- deny by default, scoped through the conversation
-- ---------------------------------------------------------------------------

alter table chat.attention_flag enable row level security;

drop policy if exists attention_flag_organization_isolation on chat.attention_flag;
create policy attention_flag_organization_isolation on chat.attention_flag
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- Same delegation as conversation_summary: visibility follows the
-- conversation's own policies, evaluated under the caller's privileges, so a
-- supervisor sees flags on their families and not on anybody else's. A flag
-- says "this family may be about to leave", which is exactly as sensitive as
-- the conversation it was read from.
drop policy if exists attention_flag_readable on chat.attention_flag;
create policy attention_flag_readable on chat.attention_flag
  for select to authenticated
  using (
    chat.current_has_permission('attention.read')
    and exists (select 1 from chat.conversation c where c.id = conversation_id)
  );

grant select on chat.attention_flag to authenticated;
grant select, insert, update on chat.attention_flag to chat_app;
grant select, insert, update, delete on chat.attention_flag to service_role;

-- WRITES `to authenticated`, never `for all to chat_app using (true)`, which is
-- permissive and would OR away the scoping above -- publishing every family's
-- risk assessment to every authenticated session (20260907150100 §6).
--
-- Note that INSERT is not granted to authenticated at all beyond this: flags
-- are raised by the sweep, which connects as chat_service and bypasses RLS.
-- Nobody hand-writes a flag against a conversation they cannot see.
drop policy if exists attention_flag_resolved_by_staff on chat.attention_flag;
create policy attention_flag_resolved_by_staff on chat.attention_flag
  for update to authenticated
  using (
    chat.current_has_permission('attention.resolve')
    and exists (select 1 from chat.conversation c where c.id = conversation_id)
  )
  with check (chat.current_has_permission('attention.resolve'));

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
('attention.unanswered_hours', '24', 'attention',
 'INITIAL HYPOTHESIS - hours a family may wait for a staff reply before the DETERMINISTIC sweep raises an unanswered_messages flag. Arithmetic over message timestamps; no model is consulted.'),
('attention.unanswered_severe_hours', '72', 'attention',
 'INITIAL HYPOTHESIS - beyond this the same flag is raised at high severity.'),
('attention.sweep_batch', '100', 'attention',
 'INITIAL HYPOTHESIS - conversations one risk sweep examines. Bounds the cost of a single pass.'),
('attention.classify_min_customer_messages', '2', 'attention',
 'INITIAL HYPOTHESIS - a conversation is not sent to the classifier until the family has said this much. One message is not a pattern, and classifying it is how false positives are manufactured.')
on conflict (key) do nothing;
