-- Jawwid Chat -- Phase 7.1: the AI foundation.
--
-- This migration adds NO intelligence. It adds the two things every later
-- Phase 7 migration depends on: a permission that says who may use the
-- assistant at all, and a record of every time the assistant was consulted.
--
-- ## What ai_invocation is for, and what it deliberately does not hold
--
-- Phase 7 §27 asks for auditability of AI operations and §44 for observability.
-- Both are satisfied by the SHAPE of a call -- which feature, for whom, against
-- which conversation, how it ended, how long it took, what it cost -- and
-- neither requires the prompt or the answer.
--
-- So there is no prompt column and no response column. Phase 7 §31 treats
-- conversation content as sensitive application data, and a table that
-- accumulated every message ever sent to a model would become the single
-- richest, least-governed copy of family communication in the system. The
-- conversation itself is already the record of what was said; this is the
-- record of what the machine was asked to do about it.

-- ---------------------------------------------------------------------------
-- 1. The invocation log
-- ---------------------------------------------------------------------------

create table if not exists chat.ai_invocation (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),

  feature         text not null check (feature in
                    ('faq', 'suggested_reply', 'summary', 'risk_detection')),

  -- Null for background work (risk detection runs on a sweep, on nobody's
  -- behalf). Not null for anything a person asked for, which is what makes
  -- "who has been summarising this family's conversation" answerable.
  actor_id        uuid references chat.staff (id) on delete set null,
  conversation_id uuid references chat.conversation (id) on delete set null,

  provider        text not null,
  -- Null when the call never reached a provider (disabled, oversized input).
  model           text,

  -- Mirrors AiFailure in src/ai/provider/ai-provider.ts, plus 'ok'. A value
  -- absent here is a value the application cannot report, so the check
  -- constraint and the union are changed together or not at all.
  status          text not null check (status in
                    ('ok', 'disabled', 'timeout', 'rate_limited',
                     'invalid_output', 'input_too_large', 'refused', 'error')),

  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer not null,

  created_at      timestamptz not null default now()
);

comment on table chat.ai_invocation is
  'One row per AI provider consultation: which feature, for whom, how it ended, '
  'what it cost. Deliberately holds NO prompt and NO response -- Phase 7 §27/§31 '
  'ask for auditability of the operation, not a second copy of family '
  'communication outside the conversation that governs it.';

-- The observability read (§44): success/failure rate and latency per feature
-- over a window.
create index if not exists ai_invocation_feature_time_idx
  on chat.ai_invocation (organization_id, feature, created_at desc);

-- "What has the assistant been asked about this conversation?" -- the audit
-- read a manager or a privacy request actually makes.
create index if not exists ai_invocation_conversation_idx
  on chat.ai_invocation (conversation_id, created_at desc)
  where conversation_id is not null;

-- Failure triage, which is the only read that wants the rare rows and would
-- otherwise scan the common ones.
create index if not exists ai_invocation_failure_idx
  on chat.ai_invocation (organization_id, created_at desc)
  where status <> 'ok';

-- ---------------------------------------------------------------------------
-- 2. Permission
-- ---------------------------------------------------------------------------
--
-- ONE key for consuming the assistant, not one per feature. The features are
-- suggestions, summaries and grounded answers about conversations the actor can
-- ALREADY read -- so the meaningful boundary is the conversation, enforced by
-- the existing read authorization, and a per-feature key would imply a
-- distinction this system does not make.
--
-- Parents and teachers do not hold it. Every Phase 7 surface is a staff
-- assistant; a parent's questions are answered by a person.

insert into chat.permission (key, description) values
('ai.use', 'Use the AI assistant: grounded answers, suggested replies and conversation summaries')
on conflict (key) do update set description = excluded.description;

-- ADMIN AND COVERAGE_ADMIN GET IDENTICAL KEYS. That is this model's stated
-- invariant (AUTHORIZATION-MODEL.md §2): the two roles differ in SCOPE, never
-- in vocabulary. A coverage admin assisting a family during a window gets the
-- same help as its supervisor, and when the window closes the reach ends by
-- scope, with no permission change.
insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  ('admin',          'ai.use'),
  ('coverage_admin', 'ai.use'),
  ('manager',        'ai.use'),
  ('super_admin',    'ai.use')
) as r(role, permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS -- deny by default
-- ---------------------------------------------------------------------------

alter table chat.ai_invocation enable row level security;

drop policy if exists ai_invocation_organization_isolation on chat.ai_invocation;
create policy ai_invocation_organization_isolation on chat.ai_invocation
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- The invocation log is an AUDIT surface, so it reads like one: audit.read,
-- which only manager and super_admin hold. An admin using the assistant does
-- not thereby get to review everyone else's use of it.
drop policy if exists ai_invocation_readable_by_auditors on chat.ai_invocation;
create policy ai_invocation_readable_by_auditors on chat.ai_invocation
  for select to authenticated
  using (chat.current_has_permission('audit.read'));

grant select on chat.ai_invocation to authenticated;
grant select, insert on chat.ai_invocation to chat_app;
grant select, insert, update, delete on chat.ai_invocation to service_role;

-- WRITES are addressed `to authenticated`, mirroring the service rule.
--
-- NOT `for all to chat_app using (true)`. That form is PERMISSIVE and would OR
-- with the read policy above, handing every authenticated session the whole
-- organization's AI audit log. The same trap that Phase 5 documented on
-- chat.story applies here (20260907150100 §6).
--
-- A row records what the CURRENT actor asked for, or a background invocation
-- with no actor. It cannot be attributed to somebody else.
drop policy if exists ai_invocation_written_by_user on chat.ai_invocation;
create policy ai_invocation_written_by_user on chat.ai_invocation
  for insert to authenticated
  with check (
    chat.current_has_permission('ai.use')
    and (actor_id is null or actor_id in (select chat.current_actor_ids()))
  );

-- ---------------------------------------------------------------------------
-- 4. Configuration
-- ---------------------------------------------------------------------------
--
-- `ai.enabled` is a kill switch that is INDEPENDENT of credentials. Removing an
-- API key disables the assistant by accident and takes a deployment; this
-- turns it off on purpose, immediately, without one -- which is what you want
-- at 2am when a model starts saying something the academy does not stand
-- behind.

insert into chat.config (key, value, scope, description) values
('ai.enabled', 'true', 'ai',
 'Master switch for every AI feature. False degrades to the pre-Phase-7 behaviour: managers write their own replies and no assistant surface appears.'),

('ai.min_confidence', '0.6', 'ai',
 'INITIAL HYPOTHESIS - below this the assistant declines rather than guesses. Applies to grounded FAQ answers and to risk classification.'),

('ai.faq_max_articles', '6', 'ai',
 'INITIAL HYPOTHESIS - how many approved knowledge articles are retrieved as grounding for one question.'),

('ai.suggestion_context_messages', '30', 'ai',
 'INITIAL HYPOTHESIS - trailing messages given to the suggested-reply prompt (Phase 7 SS30, bounded context).'),

('ai.summary_context_messages', '120', 'ai',
 'INITIAL HYPOTHESIS - trailing messages given to the summary prompt. Larger than the others because a summary that omits the original problem is worse than no summary.'),

('ai.risk_context_messages', '40', 'ai',
 'INITIAL HYPOTHESIS - trailing messages given to the risk classifier.')
on conflict (key) do nothing;
