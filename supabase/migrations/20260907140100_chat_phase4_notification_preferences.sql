-- Jawwid Chat -- Phase 4D: notification preferences, and the category a rule belongs to.
--
-- Canonical design: docs/recovery/PHASE-4-REPORT.md §8.
--
-- WHAT EXISTED. Two controls, both real and neither a preference:
--
--   chat.quiet_hours                 defer, per recipient, in their timezone
--   conversation_participant_state.muted_until   silence ONE conversation
--
-- Quiet hours answer "not now". Mute answers "not this thread". Neither
-- answers "never send me payment reminders", which is the thing a person
-- actually asks for -- and the only place that question could have been
-- answered was the client, by throwing away a notification the server had
-- already delivered to the device. A preference enforced on the receiving end
-- is not a preference; it is a display filter that still buzzes the phone.
--
-- WHY A CATEGORY COLUMN RATHER THAN A LIST IN CODE. chat.notification_rule
-- already exists precisely so that "reminder schedules are rows, never
-- hardcoded branches". A preference that mapped event types to categories in a
-- TypeScript switch would put half of that decision back into a deploy, and the
-- two halves would drift the first time somebody added a rule.

-- ---------------------------------------------------------------------------
-- 1. Every rule declares its category
-- ---------------------------------------------------------------------------

alter table chat.notification_rule
  add column if not exists category text;

-- Backfilled from the rules that exist. Deliberately coarse: a person choosing
-- what their phone may interrupt them for thinks in a handful of kinds, not in
-- the fourteen rule keys the engine happens to have.
update chat.notification_rule set category = case
  when event_type in ('message_published')                       then 'messages'
  when event_type in ('approval_requested', 'approval_decided')  then 'approvals'
  when event_type in ('call_started', 'call_missed',
                      'group_call_started')                      then 'calls'
  when event_type in ('payment_due')                             then 'payments'
  else 'classes'
end
where category is null;

alter table chat.notification_rule
  alter column category set not null;

alter table chat.notification_rule
  drop constraint if exists notification_rule_category_check;
alter table chat.notification_rule
  add constraint notification_rule_category_check
  check (category in ('messages', 'approvals', 'calls', 'payments', 'classes'));

comment on column chat.notification_rule.category is
  'What a person is choosing when they turn this off. Coarse on purpose: '
  'nobody configures fourteen rule keys.';

-- ---------------------------------------------------------------------------
-- 2. The preference
-- ---------------------------------------------------------------------------

create table if not exists chat.notification_preference (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  actor_id        uuid not null,
  category        text not null
                    check (category in ('messages', 'approvals', 'calls', 'payments', 'classes')),
  -- Present because the row exists to record a CHOICE. There is no "unset"
  -- value: a category with no row has never been chosen, and the service reads
  -- that as enabled. Storing a tri-state would mean every reader had to decide
  -- what null meant, and they would not all decide the same way.
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),

  primary key (actor_id, category)
);

comment on table chat.notification_preference is
  'Per-recipient, per-category opt-out. ABSENT means enabled: a person who has '
  'never opened the settings screen receives everything, which is the only '
  'default that cannot silently lose a notification.';

create index if not exists notification_preference_actor_idx
  on chat.notification_preference (actor_id);

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
--
-- A preference is one person's own setting and nobody else's business -- not a
-- supervisor's, not an admin's. The policy is therefore the narrowest one in
-- the schema: you, and only you.

alter table chat.notification_preference enable row level security;
alter table chat.notification_preference force row level security;

drop policy if exists notification_preference_own on chat.notification_preference;
create policy notification_preference_own on chat.notification_preference
  for all to authenticated
  using (actor_id in (select chat.current_actor_ids()))
  with check (actor_id in (select chat.current_actor_ids()));

grant select, insert, update, delete on chat.notification_preference to chat_app;
