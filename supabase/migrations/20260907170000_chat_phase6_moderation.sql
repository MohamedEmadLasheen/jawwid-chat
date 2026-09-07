-- Jawwid Chat -- Phase 6A: smart moderation.
--
-- Canonical design: docs/recovery/PHASE-6-REPORT.md.
--
-- WHAT THIS REPLACES
--
-- Until now moderation was one predicate, in chat.conversation:
--
--     group conversation + teacher_requires_approval  -> hold
--     group conversation + parent_requires_approval   -> hold
--
-- Nothing looked at what the message SAID. Every teacher message in every
-- Student Group waited for a supervisor, including "Assalamu alaikum, Yusuf did
-- very well today" -- so the queue was mostly noise, and the messages that
-- genuinely needed a human were buried in it. The PRD calls this the MVP's
-- "simple policy" and schedules the rest for later; this is later.
--
-- Phase 6 keeps the same trust boundary and the same queue, and inserts a
-- CONTENT SCAN in front of the hold decision:
--
--     scan the body against the enabled rules
--       no match  -> send normally
--       match     -> hold, recording WHICH rules matched and how severely
--
-- THREE THINGS THIS MIGRATION DELIBERATELY DOES NOT DO
--
--   1. It does not remove teacher_requires_approval / parent_requires_approval.
--      They are a PRD requirement (approvals A2: "a per-conversation approval
--      policy, server-supplied"), and the DTO, Prisma, Admin Web and the
--      Flutter client all read them. They become a trigger-maintained mirror of
--      the new per-role MODE, so every existing reader keeps working unchanged.
--      This is the same technique Phase 3 used for chat.learner.teacher_id.
--
--   2. It does not invent the academy's word lists. The structural detectors
--      (phone number, e-mail address, URL) are derived from the shape of the
--      data and ship enabled. The POLICY categories -- forbidden words and
--      phrases, cancellation, resignation -- ship as DISABLED starter rules
--      with their patterns visible, because a list of words the academy
--      forbids is a business decision this repository does not hold. Enabling
--      one is a click in Rule Management, not a deploy.
--
--   3. It does not add a scheduler. Escalation is a deadline sweep and runs in
--      the existing worker loop beside the missed-call and story-expiry sweeps.

-- ---------------------------------------------------------------------------
-- 1. The rule catalogue
-- ---------------------------------------------------------------------------
--
-- A rule is DATA, not code. That is the whole point of the table: adding
-- "detect messages that mention a competitor" must be an INSERT a manager can
-- make, not a deploy. The scanner knows how to apply a `word`, a `phrase` and a
-- `regex`; it knows nothing about any particular rule.
--
-- WHY category AND severity ARE SEPARATE COLUMNS
--   `category` says what KIND of thing was found and is what the moderator
--   reads on the card ("a phone number"). `severity` says how much it matters
--   and is what orders the queue. Collapsing them would mean every phone number
--   is equally urgent as every other, which is exactly the flattening that
--   makes an operator stop reading the queue.

create table if not exists chat.moderation_rule (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  name            text not null,
  category        text not null,
  severity        text not null,
  match_type      text not null,
  pattern         text not null,
  -- A built-in ships with the system. It may be disabled, retuned or
  -- re-severitied like any other rule -- but it may not be deleted, so a
  -- structural detector cannot be lost by somebody tidying the list. The
  -- absence of a DELETE grant for chat_app is what actually enforces that;
  -- this column is how the UI explains it.
  is_builtin      boolean not null default false,
  is_enabled      boolean not null default true,
  -- Why this rule exists, in the words of whoever added it. Shown beside the
  -- match in the queue: a moderator acting on a rule they cannot explain is a
  -- moderator who will start approving everything.
  notes           text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint moderation_rule_category_check
    check (category in ('phone_number', 'email_address', 'url',
                        'forbidden_word', 'forbidden_phrase',
                        'cancellation', 'resignation', 'custom')),
  constraint moderation_rule_severity_check
    check (severity in ('low', 'medium', 'high', 'critical')),
  constraint moderation_rule_match_type_check
    check (match_type in ('word', 'phrase', 'regex')),
  constraint moderation_rule_name_present
    check (btrim(name) <> ''),
  -- An empty pattern matches everything, which would hold every message in the
  -- academy. Refused structurally rather than trusted to the service.
  constraint moderation_rule_pattern_present
    check (btrim(pattern) <> ''),
  -- A LENGTH BOUND, NOT A SAFETY GUARANTEE. Catastrophic backtracking is a
  -- property of a pattern's SHAPE, not its size, and the real defences are in
  -- the engine: patterns are compiled and shape-checked when they are written
  -- (ModerationRuleService.validatePattern), the scanned body is capped at
  -- communication.message_max_length, and a scan that exceeds its time budget
  -- fails CLOSED -- the message is held rather than let through. This bound
  -- exists so that a pathological pattern cannot also be a large one.
  constraint moderation_rule_pattern_bounded
    check (length(pattern) <= 512)
);

comment on table chat.moderation_rule is
  'The moderation rule catalogue. A rule is data: adding a detection category '
  'is an INSERT a manager makes through Rule Management, not a deploy. Built-in '
  'rules may be disabled and retuned but never deleted -- chat_app holds no '
  'DELETE privilege on this table.';

comment on column chat.moderation_rule.match_type is
  'word   = the token, on word boundaries, case- and diacritic-insensitively. '
  'phrase = the whole sequence, whitespace-normalised. '
  'regex  = a JavaScript regular expression, compiled and shape-checked when '
  'the rule is written. The engine is JavaScript, so the pattern is NOT '
  'validated here: validating it with PostgreSQL''s regex engine would accept '
  'patterns the scanner rejects and reject patterns it accepts.';

-- One rule per name per organization, case-insensitively: two rules called
-- "Phone number" and "phone number" are a list nobody can maintain.
create unique index if not exists moderation_rule_name_key
  on chat.moderation_rule (organization_id, lower(name));

-- THE scan query: every enabled rule for this organization, once per scanned
-- message. Partial, because the disabled ones are never read by the scanner.
create index if not exists moderation_rule_enabled_idx
  on chat.moderation_rule (organization_id, category)
  where is_enabled;

drop trigger if exists moderation_rule_set_updated_at on chat.moderation_rule;
create trigger moderation_rule_set_updated_at
  before update on chat.moderation_rule
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. What a scan found
-- ---------------------------------------------------------------------------
--
-- One row per (message, rule) match. A message that shares a phone number
-- INSIDE a cancellation request matches two rules and gets two rows, because
-- "flagged: high" is not an answer a moderator can act on and "a phone number
-- and a cancellation phrase" is.
--
-- WHY THE RULE'S NAME, CATEGORY AND SEVERITY ARE COPIED ONTO THE FLAG
--   A rule is editable. If the flag only pointed at chat.moderation_rule, then
--   re-severitising a rule next month would silently rewrite the reason a
--   message was held last month, and the moderation history would describe a
--   decision nobody made. The flag records what the rule SAID AT THE TIME; the
--   foreign key is there so the queue can link to the rule as it is now.

create table if not exists chat.message_moderation_flag (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  message_id      uuid not null references chat.message (id) on delete cascade,
  -- Nullable: a rule that is one day removed must not take the history of
  -- every message it flagged with it.
  rule_id         uuid references chat.moderation_rule (id) on delete set null,
  rule_name       text not null,
  category        text not null,
  severity        text not null,
  -- The matched text, bounded. The moderator sees the whole body anyway; this
  -- is so the card can say WHERE without them re-reading 4000 characters.
  matched_excerpt text,
  created_at      timestamptz not null default now(),

  constraint message_moderation_flag_severity_check
    check (severity in ('low', 'medium', 'high', 'critical')),
  constraint message_moderation_flag_excerpt_bounded
    check (matched_excerpt is null or length(matched_excerpt) <= 200)
);

comment on table chat.message_moderation_flag is
  'Why a message was held: one row per matched rule, carrying the rule''s name, '
  'category and severity AS THEY WERE AT SCAN TIME. Retuning a rule never '
  'rewrites the reason an earlier message was held.';

-- A rescan (or a retried send) must not double-record the same rule.
create unique index if not exists message_moderation_flag_unique_idx
  on chat.message_moderation_flag (message_id, rule_id)
  where rule_id is not null;

-- The queue joins flags to their message, and the moderation history of one
-- message is read on every card.
create index if not exists message_moderation_flag_message_idx
  on chat.message_moderation_flag (message_id);

-- "How often does this rule actually fire?" -- the question that tells a
-- manager which rule is producing noise.
create index if not exists message_moderation_flag_rule_idx
  on chat.message_moderation_flag (rule_id, created_at desc)
  where rule_id is not null;

-- Append-only, like chat.message_revision, chat.event_log and chat.audit_log.
-- The reason a message was held is evidence; evidence that can be edited after
-- the fact is not evidence.
create or replace function chat.forbid_moderation_flag_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception 'chat.message_moderation_flag is append-only'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists message_moderation_flag_append_only on chat.message_moderation_flag;
create trigger message_moderation_flag_append_only
  before update or delete on chat.message_moderation_flag
  for each row execute function chat.forbid_moderation_flag_rewrite();

-- ---------------------------------------------------------------------------
-- 3. The approval row learns four things
-- ---------------------------------------------------------------------------
--
-- chat.message_approval already carries the decision, the approver, the
-- rejection reason and the timestamps. Phase 6 adds only what it genuinely
-- cannot express:
--
--   trigger_source    was this held by the conversation's policy, or because
--                     the scanner found something? Without it the queue cannot
--                     tell "everything is held here" from "this one is
--                     suspicious", and neither can a report.
--   highest_severity  the queue's ordering key. Denormalised from the flags on
--                     purpose: ordering a queue by an aggregate over a child
--                     table is a sort nobody can index.
--   escalated_at      when this passed the configured threshold unanswered.
--   edited_at/by      an approver used EDIT THEN SEND.
--
-- WHAT IS NOT ADDED, AND WHY: a column for the original body. There is already
-- one place the original lives -- chat.message_revision, whose revision 1 is
-- "the body the message was SENT with" -- and a second copy would be a second
-- answer to "what did the teacher actually write".

alter table chat.message_approval
  add column if not exists trigger_source   text not null default 'policy',
  add column if not exists highest_severity text,
  add column if not exists escalated_at     timestamptz,
  add column if not exists escalated_to     uuid references chat.staff (id),
  add column if not exists edited_at        timestamptz,
  add column if not exists edited_by        uuid references chat.staff (id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'approval_trigger_source_check') then
    alter table chat.message_approval add constraint approval_trigger_source_check
      check (trigger_source in ('policy', 'scan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_highest_severity_check') then
    alter table chat.message_approval add constraint approval_highest_severity_check
      check (highest_severity is null
             or highest_severity in ('low', 'medium', 'high', 'critical'));
  end if;
  -- An edit is stamped or it did not happen -- the same rule
  -- chat.forbid_message_rewrite applies to the message itself.
  if not exists (select 1 from pg_constraint where conname = 'approval_edit_is_stamped') then
    alter table chat.message_approval add constraint approval_edit_is_stamped
      check ((edited_at is null) = (edited_by is null));
  end if;
  -- An escalation names who it went to, or it is not an escalation. This is
  -- the defect finding ES-1 in product-operations/escalation-model.md: "an
  -- escalation that nobody receives is worse than none".
  if not exists (select 1 from pg_constraint where conname = 'approval_escalation_has_target') then
    alter table chat.message_approval add constraint approval_escalation_has_target
      check ((escalated_at is null) = (escalated_to is null));
  end if;
end $$;

comment on column chat.message_approval.trigger_source is
  'policy = the conversation holds every message from this role. '
  'scan    = the content scanner matched at least one enabled rule.';

comment on column chat.message_approval.edited_at is
  'Set when an approver used EDIT THEN SEND. The body they replaced is '
  'chat.message_revision revision 1; the body they sent is on the message. '
  'Both survive, which is the point.';

-- THE ESCALATION SWEEP'S ENTIRE PREDICATE: pending, not yet escalated, old
-- enough. Partial and tiny -- it indexes the queue, not the history.
create index if not exists message_approval_escalation_idx
  on chat.message_approval (created_at)
  where decision = 'pending' and escalated_at is null;

-- The manager's escalated view, newest first.
create index if not exists message_approval_escalated_idx
  on chat.message_approval (escalated_at desc)
  where escalated_at is not null;

-- Ordering the queue by urgency then age, which is how a moderator reads it.
create index if not exists message_approval_severity_idx
  on chat.message_approval (highest_severity, created_at)
  where decision = 'pending';

-- 20260905093000 says "No expiry in MVP: a pending message stays pending until
-- a human decides." Phase 6 adds escalation, not expiry -- an unanswered
-- message is raised to a manager, never silently dropped -- so the comment is
-- restated rather than contradicted.
comment on table chat.message_approval is
  'The moderation queue. A pending message NEVER expires: it stays pending '
  'until a human decides. Past moderation.escalation_hours it is escalated to '
  'a manager, which changes who is accountable for it and nothing else.';

-- ---------------------------------------------------------------------------
-- 4. Per-role moderation MODE on the conversation
-- ---------------------------------------------------------------------------
--
--   off    this role's messages are never held here.
--   smart  scan; hold only what matches a rule.          <- the Phase 6 default
--   all    hold every message from this role.            <- the old behaviour
--
-- `all` is retained deliberately. A group under review, a teacher on a
-- probationary period, a family in a dispute -- "hold everything from this
-- role in this conversation" is a real operational need, and Phase 6 must not
-- remove the only control that expressed it.
--
-- THE BACKFILL IS THE PRODUCT DECISION, MADE EXPLICIT: every conversation that
-- was holding messages moves to `smart`, not to `all`. That is the objective of
-- this phase -- teachers stop waiting for routine messages -- and it is written
-- here rather than in a service so that the state of the system after this
-- migration is a fact about the database.

alter table chat.conversation
  add column if not exists teacher_moderation text not null default 'smart',
  add column if not exists parent_moderation  text not null default 'smart';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_teacher_moderation_check') then
    alter table chat.conversation add constraint conversation_teacher_moderation_check
      check (teacher_moderation in ('off', 'smart', 'all'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversation_parent_moderation_check') then
    alter table chat.conversation add constraint conversation_parent_moderation_check
      check (parent_moderation in ('off', 'smart', 'all'));
  end if;
end $$;

-- Backfill from the booleans, once. Idempotent because it only touches rows
-- whose mode still disagrees with the boolean it was derived from.
update chat.conversation
   set teacher_moderation = case when teacher_requires_approval then 'smart' else 'off' end
 where (teacher_requires_approval and teacher_moderation = 'off')
    or (not teacher_requires_approval and teacher_moderation <> 'off');

update chat.conversation
   set parent_moderation = case when parent_requires_approval then 'smart' else 'off' end
 where (parent_requires_approval and parent_moderation = 'off')
    or (not parent_requires_approval and parent_moderation <> 'off');

-- The mirror. Phase 3 used exactly this shape to keep chat.learner.teacher_id
-- in step with chat.learner_teacher_assignment, and for the same reason: every
-- pre-existing reader keeps working, unchanged, forever.
--
-- It reconciles in BOTH directions, because both are real callers: Phase 6 code
-- writes the mode, and anything written before Phase 6 -- including the
-- conversation DTO's round trip -- writes the boolean.
create or replace function chat.sync_conversation_moderation()
returns trigger
language plpgsql
as $$
begin
  -- The MODE is authoritative when it is the thing that changed.
  if tg_op = 'INSERT' or new.teacher_moderation is distinct from old.teacher_moderation then
    new.teacher_requires_approval := (new.teacher_moderation <> 'off');
  elsif new.teacher_requires_approval is distinct from old.teacher_requires_approval then
    -- An older caller flipped the boolean. `true` means "moderate this role",
    -- and what that means now is `smart`.
    new.teacher_moderation := case when new.teacher_requires_approval then 'smart' else 'off' end;
  end if;

  if tg_op = 'INSERT' or new.parent_moderation is distinct from old.parent_moderation then
    new.parent_requires_approval := (new.parent_moderation <> 'off');
  elsif new.parent_requires_approval is distinct from old.parent_requires_approval then
    new.parent_moderation := case when new.parent_requires_approval then 'smart' else 'off' end;
  end if;

  return new;
end;
$$;

comment on function chat.sync_conversation_moderation is
  'Keeps chat.conversation.{teacher,parent}_requires_approval a mirror of the '
  'Phase 6 {teacher,parent}_moderation mode, in both directions, so every '
  'pre-Phase-6 reader and writer keeps working unchanged.';

drop trigger if exists conversation_sync_moderation on chat.conversation;
create trigger conversation_sync_moderation
  before insert or update on chat.conversation
  for each row execute function chat.sync_conversation_moderation();

-- ---------------------------------------------------------------------------
-- 5. Permissions
-- ---------------------------------------------------------------------------
--
-- `messages.moderate` already exists and already means "decide an approval".
-- Phase 6 does NOT widen it: deciding one message and rewriting the rules that
-- decide every message are different powers, and an admin holds the first.
--
-- WHY moderation_rules.manage IS MANAGER-AND-ABOVE
--   A rule applies to every conversation in the organization. An admin who
--   could disable the phone-number rule could disable it for families that are
--   not theirs -- which is precisely the scope escape the supervisor model
--   exists to prevent. It is the same reasoning that made labels.manage a
--   manager's act while filing a family under a label is an admin's.

insert into chat.permission (key, description) values
('moderation_rules.manage',
 'Create, edit, enable and disable the moderation rules that apply to the whole organization')
on conflict (key) do update set description = excluded.description;

insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  ('manager',     'moderation_rules.manage'),
  ('super_admin', 'moderation_rules.manage')
) as r(role, permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Runtime privileges
-- ---------------------------------------------------------------------------
--
-- NOTE WHAT IS NOT GRANTED:
--
--   * NO DELETE on chat.moderation_rule. A rule is disabled, never deleted --
--     otherwise the flags that reference it lose their rule, and "which rule
--     held this message" becomes unanswerable. Withholding the privilege makes
--     that a property of the role rather than a convention.
--
--   * NO UPDATE and NO DELETE on chat.message_moderation_flag. It is
--     append-only; the trigger above says so and the privileges agree, so a
--     bug that tried to rewrite the evidence fails twice.

grant select on chat.moderation_rule, chat.message_moderation_flag to authenticated;
grant select, insert, update on chat.moderation_rule            to chat_app;
grant select, insert         on chat.message_moderation_flag    to chat_app;
grant select, insert, update, delete on
  chat.moderation_rule, chat.message_moderation_flag to service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
--
-- DENY BY DEFAULT.
--
-- READ OF THE RULES is staff-wide on purpose and is the one deliberate breadth
-- here: an admin deciding an approval must be able to see the rule that caused
-- it, or the queue's "reason" is a name they cannot check. A teacher and a
-- parent get no policy at all -- publishing the detection patterns to the
-- people being detected would tell them exactly how to word their way past it.
--
-- READ OF THE FLAGS follows the MESSAGE, not the rule: a flag is visible to
-- whoever may moderate the conversation the message is in. A teacher cannot
-- read the flags on their own held message -- that is the queue's business,
-- and the sender is told the outcome, not the detection internals.
--
-- The blanket `for all to chat_app using (true)` form is NOT used. It is
-- PERMISSIVE, it ORs with every other policy on the table, and it would
-- silently cancel both read policies below. (Phase 5 shipped exactly that
-- mistake once; see docs/recovery/PHASE-5-REPORT.md.)

alter table chat.moderation_rule            enable row level security;
alter table chat.message_moderation_flag    enable row level security;

drop policy if exists moderation_rule_organization_isolation on chat.moderation_rule;
create policy moderation_rule_organization_isolation on chat.moderation_rule
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists moderation_rule_readable_by_moderators on chat.moderation_rule;
create policy moderation_rule_readable_by_moderators on chat.moderation_rule
  for select to authenticated
  using (chat.current_has_permission('messages.moderate')
         or chat.current_has_permission('moderation_rules.manage'));

-- Writes mirror the service rule exactly. Addressed `to authenticated` rather
-- than `to chat_app`, so the policy constrains the real caller.
drop policy if exists moderation_rule_written_by_managers on chat.moderation_rule;
create policy moderation_rule_written_by_managers on chat.moderation_rule
  for insert to authenticated
  with check (chat.current_has_permission('moderation_rules.manage'));

drop policy if exists moderation_rule_updated_by_managers on chat.moderation_rule;
create policy moderation_rule_updated_by_managers on chat.moderation_rule
  for update to authenticated
  using (chat.current_has_permission('moderation_rules.manage'))
  with check (chat.current_has_permission('moderation_rules.manage'));

drop policy if exists message_moderation_flag_organization_isolation
  on chat.message_moderation_flag;
create policy message_moderation_flag_organization_isolation on chat.message_moderation_flag
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists message_moderation_flag_readable_by_moderators
  on chat.message_moderation_flag;
create policy message_moderation_flag_readable_by_moderators on chat.message_moderation_flag
  for select to authenticated
  using (
    chat.current_has_permission('messages.moderate')
    and exists (select 1 from chat.message m
                 where m.id = message_id
                   and chat.can_read_conversation(m.conversation_id))
  );

drop policy if exists message_moderation_flag_written_by_scanner
  on chat.message_moderation_flag;
create policy message_moderation_flag_written_by_scanner on chat.message_moderation_flag
  for insert to authenticated
  with check (exists (select 1 from chat.message m
                       where m.id = message_id
                         and chat.can_read_conversation(m.conversation_id)));

-- ---------------------------------------------------------------------------
-- 7b. How the SCANNER reads the rules
-- ---------------------------------------------------------------------------
--
-- THE PROBLEM THE READ POLICY ABOVE CREATES, AND IT IS NOT OBVIOUS.
--
-- The scanner runs inside the SENDER'S request. The sender is usually a teacher
-- or a parent -- exactly the two actors the read policy correctly refuses. So
-- under RLS the scanner would load ZERO rules, find nothing, and report every
-- message SAFE. Moderation would silently stop working, and nothing would fail:
-- messages would simply flow. That is a fail-OPEN, and it is the worst
-- available outcome.
--
-- (Found by execution, not by reading: apps/api/test/integration/
-- phase6-runtime-rls.spec.ts sends a teacher's flagged message through the
-- `chat_app` connection and asserts it is held. It was not.)
--
-- SCANNING IS A SYSTEM ACT PERFORMED DURING A USER'S REQUEST, not a user's
-- read, and it is expressed as one: a SECURITY DEFINER function that returns
-- only the fields the engine applies, granted to `chat_app` and NOT to
-- `authenticated`. A teacher's session cannot call it, and the rule text never
-- leaves the server -- ModerationRuleService.enabledRules feeds it straight to
-- the matcher, and the client-facing list() still reads the table through RLS
-- as the user, so the UI's access is unchanged.
--
-- This is the same division the Command Center functions use, for the same
-- reason: the API authorizes the caller, and the definer function exists so
-- that a legitimate server-side aggregate is not narrowed to whatever the
-- connection happens to be able to see.

create or replace function chat.enabled_moderation_rules(p_organization_id uuid)
returns table (
  id         uuid,
  name       text,
  category   text,
  severity   text,
  match_type text,
  pattern    text
)
language sql
stable
security definer
set search_path = chat, pg_catalog
as $$
  select r.id, r.name, r.category, r.severity, r.match_type, r.pattern
    from chat.moderation_rule r
   where r.is_enabled
     and (p_organization_id is null or r.organization_id = p_organization_id)
   order by
     -- Most severe first. This matters for exactly one reason: if the scan's
     -- time budget runs out, the rules that did NOT run are the least severe
     -- ones, which is the failure that costs least. (The scan fails closed
     -- either way -- see ContentScanner.)
     case r.severity
       when 'critical' then 0 when 'high' then 1
       when 'medium'   then 2 else 3
     end,
     r.created_at;
$$;

comment on function chat.enabled_moderation_rules is
  'The enabled rules, for the SCANNER. SECURITY DEFINER because the scan runs '
  'inside the sender''s request and the sender is usually a teacher or a parent '
  '-- who must not be able to read the detection patterns, and whose session '
  'would otherwise load zero rules and make every message look safe. Granted to '
  'chat_app only; the client-facing list still reads the table under RLS.';

revoke all on function chat.enabled_moderation_rules(uuid) from public;
grant execute on function chat.enabled_moderation_rules(uuid) to chat_app, service_role;

-- ---------------------------------------------------------------------------
-- 8. The event vocabulary
-- ---------------------------------------------------------------------------
--
-- chat.event_log.type is a CLOSED vocabulary, widened by every phase that adds
-- an event. Read from the LIVE constraint and merely extended with an OR, as
-- Phase 5 did: re-enumerating the existing names by hand is how one of them
-- gets dropped and an unrelated engine starts failing on a valid write.

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'chat.event_log'::regclass
     and conname  = 'event_log_type_check';

  if v_def is null then
    raise exception 'event_log_type_check not found; refusing to guess the vocabulary';
  end if;

  if v_def like '%message_flagged%' then
    return;
  end if;

  v_def := regexp_replace(v_def, '^CHECK\s*', '');

  execute 'alter table chat.event_log drop constraint event_log_type_check';
  execute 'alter table chat.event_log add constraint event_log_type_check check ('
       || v_def
       || ' or type = any (array['
       || '''message_flagged'', ''message_moderation_edited'', '
       || '''moderation_escalated'', ''moderation_rule_changed'''
       || ']::text[]))';
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Configuration -- every number is a row
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  -- THE FIGURE IS THE PHASE 6 BRIEF'S OWN ("3-4 hours"), not one this
  -- repository invented, and it is a row precisely so the academy can set the
  -- real one without a deploy. The PRD lists escalation as post-MVP and states
  -- no duration, so there was no existing policy to reconcile against.
  ('moderation.escalation_hours', '3'::jsonb, 'communication',
   'Hours a moderation item may stay pending before it is escalated to a manager. Escalation changes who is accountable; it never sends, rejects or expires the message.'),
  ('moderation.queue_page_size', '200'::jsonb, 'communication',
   'Maximum moderation queue items returned in one page.'),
  ('moderation.escalation_sweep_batch', '200'::jsonb, 'communication',
   'How many overdue pending approvals one escalation sweep claims.'),
  ('moderation.max_pattern_length', '512'::jsonb, 'communication',
   'Maximum characters in a rule pattern. Mirrors the CHECK on chat.moderation_rule.pattern.'),
  ('moderation.scan_budget_ms', '250'::jsonb, 'communication',
   'Time budget for scanning one message against every enabled rule. A scan that exceeds it fails CLOSED -- the message is held -- because a moderation control that did not finish must never be reported as "safe".')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 10. The built-in rules
-- ---------------------------------------------------------------------------
--
-- TWO GROUPS, AND THE DIFFERENCE BETWEEN THEM IS THE POINT.
--
-- ENABLED -- the structural detectors. A phone number, an e-mail address and a
-- URL are recognisable from their SHAPE. Detecting them is not a business
-- policy, and PRD BR-2 already tells us why the academy cares: Jawwid Chat
-- exists because "the relationship, the history and the phone number belong to
-- the employee, not to Jawwid". A teacher passing a parent their own number is
-- the platform being routed around, which is the thing this product was built
-- to stop.
--
-- DISABLED -- the policy categories. Which words the academy forbids, and what
-- counts as a cancellation or a resignation, are business decisions this
-- repository does not hold. Inventing a word list and shipping it enabled
-- would be presenting a guess as the academy's policy. They ship visible,
-- editable and OFF, so enabling one is a deliberate act by somebody who knows
-- the business -- and the starter patterns mean that act is a click, not a
-- morning's work.
--
-- ON THE PHONE PATTERNS: the scanner NORMALISES before it matches -- Arabic
-- Indic digits (٠-٩) and Eastern Arabic digits (۰-۹) fold to ASCII, and common
-- separators are removed. That is engine behaviour rather than pattern
-- complexity, so these patterns stay legible. Without it, a number written in
-- Arabic numerals -- the normal case in an Arabic-first product -- would pass
-- straight through every one of them.

insert into chat.moderation_rule
  (name, category, severity, match_type, pattern, is_builtin, is_enabled, notes)
values
  -- International, and the general case. 8-15 digits after a country code is
  -- E.164's own range. Anchored on a leading + so that a long invoice number
  -- is not a phone number.
  ('International phone number', 'phone_number', 'high', 'regex',
   '\+\d{8,15}', true, true,
   'Any number written in international form. Detected because a contact channel outside Jawwid defeats the record the academy keeps of what was said (PRD BR-2).'),

  -- Egypt. chat.config schedule.timezone is Africa/Cairo and the academy
  -- operates there, so the local mobile format is the one most likely to be
  -- written without a country code. 01 + [0125] + 8 digits is the whole space.
  ('Egyptian mobile number', 'phone_number', 'high', 'regex',
   '(?<!\d)01[0125]\d{8}(?!\d)', true, true,
   'Egyptian mobile written locally, e.g. 010xxxxxxxx. The lookarounds stop it matching a fragment of a longer digit run.'),

  -- Saudi Arabia and the Gulf, where a large part of an online Arabic and
  -- Quran academy's families live. 05 + 8 digits.
  ('Gulf mobile number', 'phone_number', 'high', 'regex',
   '(?<!\d)05\d{8}(?!\d)', true, true,
   'Saudi and Gulf mobile written locally, e.g. 05xxxxxxxx.'),

  -- Deliberately conservative. A pattern that accepts every RFC 5322 address
  -- also accepts a great deal that is not one, and a false positive here holds
  -- a teacher''s message for no reason.
  ('E-mail address', 'email_address', 'high', 'regex',
   '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', true, true,
   'An e-mail address is a contact channel outside Jawwid, exactly as a phone number is.'),

  -- MEDIUM, not high, and this is a judgement worth stating: a URL is not
  -- inherently a leak. A teacher linking a recitation on YouTube is doing
  -- their job. The rule holds the message for a human rather than refusing
  -- it, and the academy can disable it, narrow it to an allow-list with a
  -- custom regex, or raise it -- which is what "the URL policy is
  -- configurable" has to mean to be worth anything.
  ('Web link', 'url', 'medium', 'regex',
   '(?:https?://|www\.)\S{2,}', true, true,
   'A link is held for a look, not refused: a teacher sharing a recitation is doing their job. Disable this rule, or narrow it, if the academy''s policy differs.'),

  -- ---- policy categories: shipped OFF ------------------------------------
  ('Cancellation intent (Arabic)', 'cancellation', 'critical', 'phrase',
   'الغاء الاشتراك', true, false,
   'STARTER PATTERN, NOT THE ACADEMY''S POLICY. Enable and extend once operations confirms what counts as a cancellation. A cancellation reaching a parent unread is the most expensive message this product carries.'),

  ('Cancellation intent (English)', 'cancellation', 'critical', 'phrase',
   'cancel my subscription', true, false,
   'STARTER PATTERN, NOT THE ACADEMY''S POLICY. See the Arabic rule above.'),

  ('Resignation intent (Arabic)', 'resignation', 'critical', 'phrase',
   'تقديم استقالتي', true, false,
   'STARTER PATTERN, NOT THE ACADEMY''S POLICY. A teacher resigning inside a family group is a message the academy must see before the family does.'),

  ('Resignation intent (English)', 'resignation', 'critical', 'phrase',
   'my resignation', true, false,
   'STARTER PATTERN, NOT THE ACADEMY''S POLICY. See the Arabic rule above.')
on conflict do nothing;
