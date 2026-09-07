-- Jawwid Chat -- Phase 7.6/7.7: the automation engine.
--
--     Trigger  ->  Condition  ->  Action        (Phase 7 §21)
--
-- ## Rules are DATA
--
-- The same decision chat.notification_rule already made, and for the same
-- reason: "also remind the family 10 days after the due date" should be an
-- INSERT, not a deployment. Nothing in the engine knows what T-24h means.
--
-- ## What is NOT here, and why
--
-- Phase 7 §24 lists CREATE_TASK among the actions. It is deliberately absent.
-- Product decision PD-4 (closed 2026-09-07) froze chat.task and states it is
-- "not to be revived"; the same decision settled the last open use for tasks by
-- ruling that system-generated events are SYSTEM MESSAGES. So the action that
-- would have been CREATE_TASK is SEND_MESSAGE with a system author, which is
-- what PD-4 asks for and what the message pipeline already supports.
--
-- ## The three dormant triggers
--
-- CLASS_UPCOMING, PAYMENT_DUE and RENEWAL_APPROACHING are defined here and fed
-- from chat.core_event. They are NOT fed from a local mirror, because there
-- isn't one and there must not be: the product boundary puts schedules,
-- payments and renewals in Jawwid Core, reachable only through the API/webhook
-- boundary, and chat.subscription is frozen machinery no new code may depend
-- on. Inventing a billing table here would contradict that; asking a model
-- whether a payment is due would contradict §20. So these three trigger types
-- are implemented and dormant until Core delivers the events -- which is the
-- honest state of the integration, not a gap in the engine.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------

create table if not exists chat.automation_rule (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  key             text primary key,
  name            text not null,
  description     text not null default '',

  trigger_type    text not null check (trigger_type in (
                    -- Computed from data this system owns. Live today.
                    'FOLLOW_UP_DUE',
                    'MESSAGE_UNANSWERED',
                    'RISK_FLAG_CREATED',
                    -- Fed from chat.core_event. Dormant until Core delivers.
                    'CLASS_UPCOMING',
                    'PAYMENT_DUE',
                    'RENEWAL_APPROACHING')),

  -- [{"field": "family_active", "op": "eq", "value": true}, ...]
  -- Evaluated against authoritative application data by the engine, never by a
  -- model (§23). An unknown field is a FAILED condition, not an ignored one --
  -- a typo must stop a rule, never silently widen it.
  conditions      jsonb not null default '[]',

  action_type     text not null check (action_type in (
                    'SEND_MESSAGE',
                    'CREATE_NOTIFICATION',
                    'CREATE_ATTENTION_FLAG',
                    'SCHEDULE_FOLLOW_UP')),
  -- Action-specific: template_key, category, severity, offset_seconds.
  action_config   jsonb not null default '{}',

  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.automation_rule is
  'Trigger -> condition -> action, as DATA. Adding an automation is an INSERT, '
  'not a deployment. CREATE_TASK is deliberately not an action: PD-4 froze '
  'chat.task and ruled that system-generated events are system messages.';

drop trigger if exists automation_rule_set_updated_at on chat.automation_rule;
create trigger automation_rule_set_updated_at
  before update on chat.automation_rule
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The run -- idempotency and audit in one table
-- ---------------------------------------------------------------------------
--
-- Phase 7 §26 asks what triggered this, which condition matched, what was
-- attempted, whether it ran, whether it was blocked, why, and when. Those are
-- the columns. §25 asks that a job running twice must not send the same
-- reminder twice -- and that is the unique index, not a check in the engine.
--
-- ## occurrence_key is what makes "twice" meaningful
--
-- A subject is not enough. The SAME conversation legitimately triggers
-- FOLLOW_UP_DUE on many different days, and the same subscription approaches
-- renewal every term. The occurrence key names WHICH firing this is -- a due
-- date, a class start, a flag id -- so a re-run of yesterday's sweep converges
-- rather than duplicating, while tomorrow's genuinely new firing still runs.

create table if not exists chat.automation_run (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),

  rule_key        text not null references chat.automation_rule (key) on delete cascade,
  trigger_type    text not null,

  -- The thing this fired about: a conversation, a flag, a Core subject id.
  -- Not a foreign key: it points into several tables, and a Core subject has
  -- no row here at all.
  subject_id      text not null,
  occurrence_key  text not null,

  -- executed          the action ran
  -- skipped_condition a condition was not met -- the common, healthy outcome
  -- blocked           authorization, moderation or a business rule refused it
  -- failed            the action raised
  outcome         text not null check (outcome in
                    ('executed', 'skipped_condition', 'blocked', 'failed')),
  -- WHY, in words. "family_active was false", "COMM.BR1_ADMIN_PRESENCE_REQUIRED".
  detail          text not null default '',

  conversation_id uuid references chat.conversation (id) on delete set null,
  family_id       uuid references chat.family (id) on delete set null,

  created_at      timestamptz not null default now()
);

comment on table chat.automation_run is
  'One row per (rule, subject, occurrence). The unique index below IS the '
  'idempotency guarantee (Phase 7 §25): a second run of the same sweep cannot '
  'insert a second row, so it cannot send a second reminder.';

-- THE guarantee. Not a lookup the engine performs and hopes to win.
create unique index if not exists automation_run_once_per_occurrence
  on chat.automation_run (rule_key, subject_id, occurrence_key);

create index if not exists automation_run_audit_idx
  on chat.automation_run (organization_id, created_at desc);

-- Failure triage: the rare rows, without scanning the common ones.
create index if not exists automation_run_problem_idx
  on chat.automation_run (organization_id, outcome, created_at desc)
  where outcome in ('blocked', 'failed');

-- ---------------------------------------------------------------------------
-- 3. Permission
-- ---------------------------------------------------------------------------
--
-- Manager and super_admin only. An automation rule reaches every family in the
-- organization at once, which is a broader act than anything an admin does --
-- the same reasoning that made labels.manage and broadcasts.send manager-level.

insert into chat.permission (key, description) values
('automation.manage', 'Create, edit, enable and disable automation rules, and read their execution history')
on conflict (key) do update set description = excluded.description;

insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  ('manager',     'automation.manage'),
  ('super_admin', 'automation.manage')
) as r(role, permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS -- deny by default
-- ---------------------------------------------------------------------------

alter table chat.automation_rule enable row level security;
alter table chat.automation_run  enable row level security;

drop policy if exists automation_rule_organization_isolation on chat.automation_rule;
create policy automation_rule_organization_isolation on chat.automation_rule
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists automation_run_organization_isolation on chat.automation_run;
create policy automation_run_organization_isolation on chat.automation_run
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists automation_rule_readable on chat.automation_rule;
create policy automation_rule_readable on chat.automation_rule
  for select to authenticated
  using (chat.current_has_permission('automation.manage'));

-- The execution history is an audit surface and reads like one.
drop policy if exists automation_run_readable on chat.automation_run;
create policy automation_run_readable on chat.automation_run
  for select to authenticated
  using (chat.current_has_permission('automation.manage')
         or chat.current_has_permission('audit.read'));

grant select on chat.automation_rule, chat.automation_run to authenticated;
-- chat_app gets SELECT and nothing more on either table.
--
-- The engine runs in the WORKER, as chat_service. Granting chat_app INSERT on
-- automation_run without UPDATE would let a request-path caller claim an
-- occurrence and then fail to finish it -- leaving the run permanently marked
-- `executed` with an empty detail, and permanently blocking the real firing
-- through the idempotency index. Refusing the insert outright fails fast and
-- visibly instead.
grant select on chat.automation_rule, chat.automation_run to chat_app;
grant select, insert, update, delete on
  chat.automation_rule, chat.automation_run to service_role;

-- WRITES `to authenticated`, never `for all to chat_app using (true)` -- the
-- permissive form would OR away the two read policies above and hand every
-- authenticated session the organization's automation history (the trap
-- documented on chat.story, 20260907150100 §6).
--
-- The ENGINE is not covered by these: it runs in the worker as chat_service,
-- which bypasses RLS by design. These cover the human management surface.
drop policy if exists automation_rule_written_by_manager on chat.automation_rule;
create policy automation_rule_written_by_manager on chat.automation_rule
  for insert to authenticated
  with check (chat.current_has_permission('automation.manage'));

drop policy if exists automation_rule_updated_by_manager on chat.automation_rule;
create policy automation_rule_updated_by_manager on chat.automation_rule
  for update to authenticated
  using (chat.current_has_permission('automation.manage'))
  with check (chat.current_has_permission('automation.manage'));

-- ---------------------------------------------------------------------------
-- 5. The reminder rules (Phase 7 §19), as data
-- ---------------------------------------------------------------------------
--
-- Four reminders. The follow-up one runs today; the other three are dormant
-- until Jawwid Core delivers their events, and are seeded DISABLED so that a
-- deployment does not carry a rule that can never match and looks broken.

insert into chat.automation_rule
  (key, name, description, trigger_type, conditions, action_type, action_config, enabled)
values
('followup.due',
 'Follow-up reminder',
 'A conversation was marked for follow-up and the deadline has passed. Reminds the assigned supervisor, not the family.',
 'FOLLOW_UP_DUE',
 '[{"field": "conversation_open", "op": "eq", "value": true}]'::jsonb,
 'CREATE_NOTIFICATION',
 '{"template_key": "followup_due", "category": "followup", "recipient": "assigned_staff", "priority": "normal"}'::jsonb,
 true),

('conversation.unanswered',
 'Unanswered family message',
 'A family has been waiting longer than attention.unanswered_hours. Deterministic: computed from message timestamps, never from a model.',
 'MESSAGE_UNANSWERED',
 '[{"field": "conversation_open", "op": "eq", "value": true}, {"field": "family_active", "op": "eq", "value": true}]'::jsonb,
 'CREATE_ATTENTION_FLAG',
 '{"risk_type": "unanswered_messages", "severity": "medium"}'::jsonb,
 true),

('class.upcoming',
 'Class reminder',
 'DORMANT. Fires on a core_event of type class.upcoming. Disabled until Jawwid Core delivers schedule events -- Chat holds no schedule table and must not mirror one.',
 'CLASS_UPCOMING',
 '[{"field": "family_active", "op": "eq", "value": true}, {"field": "notifications_enabled", "op": "eq", "value": true}]'::jsonb,
 'CREATE_NOTIFICATION',
 '{"template_key": "class_reminder", "category": "class", "recipient": "family_contacts", "priority": "normal"}'::jsonb,
 false),

('payment.due',
 'Payment / installment reminder',
 'DORMANT. Fires on a core_event of type payment.due. Disabled until Core delivers billing events -- Chat has no invoice table and chat.subscription is frozen machinery.',
 'PAYMENT_DUE',
 '[{"field": "family_active", "op": "eq", "value": true}, {"field": "notifications_enabled", "op": "eq", "value": true}]'::jsonb,
 'CREATE_NOTIFICATION',
 '{"template_key": "payment_reminder", "category": "billing", "recipient": "family_contacts", "priority": "high"}'::jsonb,
 false),

('renewal.approaching',
 'Renewal reminder',
 'DORMANT. Fires on a core_event of type renewal.approaching. Renewals live in Jawwid Core (product boundary §1.2).',
 'RENEWAL_APPROACHING',
 '[{"field": "family_active", "op": "eq", "value": true}, {"field": "notifications_enabled", "op": "eq", "value": true}]'::jsonb,
 'CREATE_NOTIFICATION',
 '{"template_key": "renewal_reminder", "category": "billing", "recipient": "family_contacts", "priority": "normal"}'::jsonb,
 false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. The follow-up deadline
-- ---------------------------------------------------------------------------
--
-- FOLLOW_UP_DUE needs something to be due. An additive nullable column on
-- chat.conversation, which is where the deadline belongs: a follow-up is a
-- property of the conversation, and putting it anywhere else would mean two
-- places could disagree about whether one is outstanding.
--
-- Additive and nullable on purpose (Phase 7 §46): no existing row changes
-- meaning, every existing query is unaffected, and null -- the value every
-- current conversation gets -- means "no follow-up outstanding", which is true.

alter table chat.conversation
  add column if not exists follow_up_at timestamptz;

comment on column chat.conversation.follow_up_at is
  'When a supervisor said they would come back to this. Null means no '
  'follow-up is outstanding. Read by the FOLLOW_UP_DUE trigger; cleared when '
  'the follow-up is honoured.';

-- The trigger's only query: which follow-ups are due. Partial, because the
-- overwhelming majority of conversations have no follow-up at all and should
-- not be in this index.
create index if not exists conversation_follow_up_due_idx
  on chat.conversation (follow_up_at)
  where follow_up_at is not null;
