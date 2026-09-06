-- Jawwid Chat -- communication domain (AI #2).
--
-- Owns: conversations, membership, message delivery, attachments, reactions,
-- receipts, approvals, outbox, notifications/reminders, calls.
--
-- AUTHORITATIVE SCOPE: Jawwid Chat PRD v0.1 (docs/qa/authoritative-scope.md).
-- Correction C-2 of that document is implemented here: a single
-- thread-per-family cannot represent the PRD's concurrent channels
-- (Parent<->Admin, Teacher<->Admin, Student Group), and cannot carry the
-- per-conversation participant set that BR-1 must be enforced against.
--
-- RELATIONSHIP TO chat.thread (AI #1):
--   chat.thread is NOT dropped. It remains the family's continuous
--   customer-success record that chat.support_case, chat.task, chat.handoff and
--   the attention/workload engines hang off. This migration is purely additive:
--   chat.conversation is the communication channel, and it links back to the
--   family thread so the ops layer keeps working unchanged.
--   chat.message is EXTENDED in place (new columns), never recreated, so every
--   index, constraint and foreign key AI #1 defined on it still holds.
--
-- BR-1 -- Teacher <-> Parent direct communication is FORBIDDEN, messaging and
-- calling alike. Enforced three times over: in the API authorization service,
-- by the membership trigger below, and by the call participant trigger below.
-- A UI restriction is not an implementation of BR-1.
--
-- PHONE PRIVACY: no table here has a phone, email or address column. Actors are
-- opaque uuids, so a phone number cannot travel through a conversation,
-- message, call, notification or realtime event.
--
-- ACTOR REFERENCES (ADR-004): an actor is (actor_kind, actor_id). Because an
-- actor may be a staff member, a family contact or a teacher, the column cannot
-- foreign-key to a single table, and per ADR-004 the chat schema does not
-- reference auth or public at all. Where the kind is fixed and internal --
-- sticky_handler_id, approver_id -- a real foreign key to chat.staff is used.
-- Teacher identity is AI #1's (correction C-1); nothing here creates it.

-- ---------------------------------------------------------------------------
-- Conversation
-- ---------------------------------------------------------------------------

create table chat.conversation (
  id            uuid primary key default gen_random_uuid(),

  type          text not null
                check (type in ('direct', 'student_group', 'class_group', 'official')),

  -- The family this channel belongs to. Null for staff-only conversations.
  family_id     uuid references chat.family (id) on delete cascade,

  -- The family's continuous record. Coverage or a handler change never creates
  -- a second conversation; the relationship belongs to the family.
  thread_id     uuid references chat.thread (id) on delete cascade,

  -- A student group is scoped to exactly one learner.
  learner_id    uuid references chat.learner (id) on delete cascade,

  title         text,

  -- Canonical identity of a 1:1 channel: the two participant ids, sorted and
  -- joined. Makes get-or-create idempotent and a duplicate 1:1 impossible.
  direct_key    text unique,

  -- Communication-level lifecycle. chat.support_case.status is the ops domain
  -- and is deliberately not duplicated here.
  state         text not null default 'open'
                check (state in ('open', 'waiting_on_customer',
                                 'waiting_on_jawwid', 'resolved')),

  -- Group approval policy. PRD MVP: approve / reject / rejection reason.
  teacher_requires_approval boolean not null default true,
  parent_requires_approval  boolean not null default true,

  sticky_handler_id uuid references chat.staff (id) on delete set null,
  sticky_until      timestamptz,

  -- Server-assigned monotonic message counter. Ordering never depends on a
  -- device clock.
  last_seq          bigint not null default 0,

  last_customer_message_at timestamptz,
  last_staff_message_at    timestamptz,
  last_activity_at         timestamptz not null default now(),
  resolved_at              timestamptz,
  -- Archived, never hard-deleted: history stays readable under RBAC.
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint conversation_group_has_learner
    check (type <> 'student_group' or learner_id is not null),
  constraint conversation_direct_has_key
    check (type <> 'direct' or direct_key is not null),
  constraint conversation_sticky_is_complete
    check ((sticky_handler_id is null) = (sticky_until is null))
);

comment on table chat.conversation is
  'A communication channel with an explicit participant set. BR-1 is enforced '
  'against chat.conversation_member, never against the UI.';

-- One official group per learner, while it is live.
create unique index conversation_one_group_per_learner
  on chat.conversation (learner_id)
  where type = 'student_group' and archived_at is null;

create index conversation_family_activity_idx
  on chat.conversation (family_id, last_activity_at desc);
create index conversation_thread_idx on chat.conversation (thread_id);
create index conversation_activity_idx on chat.conversation (last_activity_at desc);

create trigger conversation_set_updated_at
  before update on chat.conversation
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership -- the set BR-1 is enforced against
-- ---------------------------------------------------------------------------

create table chat.conversation_member (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,

  actor_kind      text not null
                  check (actor_kind in ('contact', 'staff', 'teacher')),
  actor_id        uuid not null,

  -- Why this actor is present. Drives approval policy and call permissions.
  member_role     text not null
                  check (member_role in ('parent', 'teacher', 'admin', 'observer')),

  -- A coverage admin may sit in a group without participating.
  is_silent       boolean not null default false,

  -- Membership is never mutated by a teacher or a parent; managers only.
  added_by        uuid references chat.staff (id) on delete set null,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz
);

comment on table chat.conversation_member is
  'Explicit participant set. Teachers and parents may share a student_group; '
  'they may never share a direct conversation (enforced below).';

create unique index conversation_member_unique_live
  on chat.conversation_member (conversation_id, actor_id)
  where left_at is null;

create index conversation_member_actor_idx
  on chat.conversation_member (actor_id) where left_at is null;
create index conversation_member_conversation_idx
  on chat.conversation_member (conversation_id) where left_at is null;

create or replace function chat.enforce_direct_conversation_rules()
returns trigger
language plpgsql
as $$
declare
  v_type  text;
  v_kinds text[];
  v_live  integer;
begin
  select type into v_type from chat.conversation where id = new.conversation_id;

  if v_type is distinct from 'direct' then
    return new;
  end if;

  select array_agg(distinct actor_kind), count(*)
    into v_kinds, v_live
    from chat.conversation_member
   where conversation_id = new.conversation_id
     and left_at is null;

  if v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[] then
    raise exception
      'BR-1 violation: a direct conversation may never contain both a teacher and a family contact'
      using errcode = 'check_violation';
  end if;

  if v_live > 2 then
    raise exception 'a direct conversation may not have more than two participants'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function chat.enforce_direct_conversation_rules() is
  'BR-1 backstop. Even a compromised API or a manual SQL session cannot create '
  'a teacher<->parent 1:1 channel.';

create trigger conversation_member_br1
  after insert or update on chat.conversation_member
  for each row execute function chat.enforce_direct_conversation_rules();

-- JC-008. The membership trigger guards only one of BR-1's two inputs: it fires
-- when the participant set changes, but not when the conversation's TYPE
-- changes. Without this, a lawful teacher+parent group could be converted into
-- a forbidden 1:1 with a plain UPDATE, and every row involved would still look
-- individually valid.
--
-- A conversation's type is fixed at creation. Converting a group into a 1:1 (or
-- back) silently rewrites who is allowed to speak to whom, so it is refused
-- outright rather than re-validated.
create or replace function chat.enforce_conversation_type_immutable()
returns trigger
language plpgsql
as $$
declare
  v_kinds text[];
begin
  if new.type is not distinct from old.type then
    return new;
  end if;

  if new.type = 'direct' then
    select array_agg(distinct actor_kind) into v_kinds
      from chat.conversation_member
     where conversation_id = new.id and left_at is null;

    if v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[] then
      raise exception
        'BR-1 violation: a conversation containing a teacher and a family contact may not become a direct conversation'
        using errcode = 'check_violation';
    end if;
  end if;

  raise exception
    'chat.conversation.type is immutable: converting between a group and a 1:1 would rewrite who may communicate'
    using errcode = 'restrict_violation';
end;
$$;

create trigger conversation_type_immutable
  before update on chat.conversation
  for each row execute function chat.enforce_conversation_type_immutable();

-- ---------------------------------------------------------------------------
-- chat.message -- EXTENDED IN PLACE (AI #1's table, AI #2's domain)
-- ---------------------------------------------------------------------------
-- Every column AI #1 defined is kept. thread_id becomes nullable because a
-- message now belongs to a conversation; existing ops indexes and foreign keys
-- continue to hold.

alter table chat.message
  add column conversation_id uuid references chat.conversation (id) on delete cascade,

  -- Deterministic ordering, assigned server-side under a row lock.
  add column seq bigint,

  add column type text not null default 'text'
      check (type in ('text', 'image', 'video', 'voice', 'file', 'system')),

  -- Moderation, orthogonal to visibility. Drives the approval queue.
  add column moderation text not null default 'published'
      check (moderation in ('published', 'pending', 'rejected')),

  add column origin text not null default 'user'
      check (origin in ('user', 'automation', 'broadcast')),

  add column reply_to_message_id uuid references chat.message (id) on delete set null,

  -- Client-supplied idempotency key. Retrying a send is free.
  add column client_message_id text,

  add column deleted_at timestamptz,
  add column deleted_by uuid,
  add column deleted_for_all boolean not null default false,
  add column redacted_reason text;

alter table chat.message alter column thread_id drop not null;

-- PRD requires a Teacher app, so a teacher can author a message.
alter table chat.message drop constraint if exists message_author_type_check;
alter table chat.message add constraint message_author_type_check
  check (author_type in ('contact', 'staff', 'teacher', 'system'));

-- A message belongs to a conversation once this migration is in force.
alter table chat.message add constraint message_has_conversation
  check (conversation_id is not null or thread_id is not null);

-- AI #1's message_has_content check assumed attachment metadata lived in the
-- `attachments` jsonb column. It now lives in chat.message_attachment, because
-- object storage needs an object key, a checksum, a duration and a thumbnail
-- key that a jsonb blob was not carrying. A media message therefore
-- legitimately has an empty jsonb, and without this the database would reject
-- every voice note. The original intent -- a message must say something -- is
-- preserved for text messages.
alter table chat.message drop constraint if exists message_has_content;
alter table chat.message add constraint message_has_content
  check (body is not null or jsonb_array_length(attachments) > 0 or type <> 'text');

comment on column chat.message.seq is
  'Per-conversation monotonic sequence. Clients reconstruct order from this '
  'after reconnect, delayed delivery, retries or multi-device sends. Device '
  'clocks are never trusted for ordering.';

create unique index message_conversation_seq
  on chat.message (conversation_id, seq)
  where conversation_id is not null;

-- THE idempotency guarantee. NULLs are distinct in Postgres, so messages
-- without a client key are unaffected.
create unique index message_idempotency
  on chat.message (conversation_id, author_id, client_message_id)
  where client_message_id is not null;

create index message_conversation_seq_desc
  on chat.message (conversation_id, seq desc);
create index message_pending_approval_idx
  on chat.message (conversation_id) where moderation = 'pending';

-- AI #1 made chat.message wholly append-only (message_is_immutable), which was
-- right for the thread model where a message had no lifecycle after sending.
-- PRD v0.1 gives it two lawful state changes: an approval decision
-- (pending -> published/rejected) and a soft delete. A blanket UPDATE ban makes
-- both impossible, and working around it -- deleting and re-inserting, or
-- keeping moderation in a side table that can drift from the message -- would be
-- worse for auditability than a narrow rule.
--
-- The blanket trigger is therefore replaced by a column-level one below.
-- What actually matters is unchanged and now enforced precisely: body,
-- author, conversation and seq remain immutable once sent.
drop trigger if exists message_is_immutable on chat.message;

-- A sent message is a record, not a draft.
create or replace function chat.forbid_message_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     and old.deleted_for_all = false and new.deleted_for_all = false then
    raise exception 'chat.message.body is immutable once sent'
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

create trigger message_no_rewrite
  before update on chat.message
  for each row execute function chat.forbid_message_rewrite();

-- ---------------------------------------------------------------------------
-- chat.event_log vocabulary (AI #1's table, extended for the communication domain)
-- ---------------------------------------------------------------------------
-- Two extensions, both required by PRD v0.1:
--   1. 'teacher' becomes a valid actor. The PRD ships a Teacher app, so a
--      teacher acts in their own right and their actions must be loggable.
--   2. The communication events below join the vocabulary. Names follow AI #1's
--      existing snake_case convention, and every pre-existing value is kept.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'event_log_actor_type_check') then
    alter table chat.event_log drop constraint event_log_actor_type_check;
    alter table chat.event_log add constraint event_log_actor_type_check
      check (actor_type in ('contact', 'staff', 'teacher', 'system'));
  end if;

  if exists (select 1 from pg_constraint where conname = 'event_log_type_check') then
    alter table chat.event_log drop constraint event_log_type_check;
    alter table chat.event_log add constraint event_log_type_check
      check (type in (
        -- AI #1's existing vocabulary, unchanged
        'message_received', 'message_sent', 'internal_note_added',
        'case_opened', 'case_status_changed', 'case_resolved', 'case_closed',
        'case_reopened', 'case_escalated', 'case_auto_resolved',
        'task_created', 'task_completed', 'task_cancelled',
        'handoff_created', 'handoff_acknowledged',
        'coverage_started', 'coverage_ended', 'sticky_started', 'sticky_expired',
        'absence_activated', 'absence_auto_detected', 'unattended_detected',
        'ownership_transferred', 'family_state_changed', 'family_flagged',
        'payment_failed', 'payment_succeeded', 'renewal_due',
        'subscription_synced', 'class_reminder_due', 'class_attended',
        'class_missed', 'attention_order_disputed', 'family_opened',
        'assist_requested',
        -- communication domain (AI #2)
        'conversation_created', 'conversation_archived',
        'student_group_created', 'student_group_membership_synced',
        'message_approved', 'message_rejected',
        'call_started', 'call_ended'
      ));
  end if;
end $$;

-- chat.audit_log.actor_id was foreign-keyed to chat.staff, which encoded the
-- assumption that only employees take auditable actions. PRD v0.1 breaks that
-- assumption: a parent deleting their own message and a teacher having a message
-- rejected are both auditable, and both actors are non-staff. Since an actor may
-- now be a staff member, a contact or a teacher, no single table can be the
-- foreign-key target (ADR-004 also forbids reaching outside the chat schema), so
-- the constraint is dropped rather than repointed. actor_id keeps its meaning and
-- its index; what is lost is referential enforcement against one specific table.
alter table chat.audit_log drop constraint if exists audit_log_actor_id_fkey;

-- ---------------------------------------------------------------------------
-- Attachments, reactions, receipts, per-user state
-- ---------------------------------------------------------------------------
-- AI #1's chat.message.attachments jsonb column stays for compatibility but is
-- superseded by this table: object storage needs a key, a checksum, a duration
-- and a thumbnail, and binary content must never sit in Postgres.

create table chat.message_attachment (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references chat.message (id) on delete cascade,
  kind          text not null check (kind in ('image', 'video', 'voice', 'file')),
  object_key    text not null unique,
  mime_type     text not null,
  byte_size     integer not null check (byte_size > 0),
  checksum_sha256 text,
  original_name text,
  duration_ms   integer,
  width         integer,
  height        integer,
  thumbnail_object_key text,
  created_at    timestamptz not null default now()
);

create index message_attachment_message_idx on chat.message_attachment (message_id);

create table chat.message_reaction (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references chat.message (id) on delete cascade,
  actor_id   uuid not null,
  emoji      text not null,
  created_at timestamptz not null default now(),
  -- One reaction per actor per message; changing it replaces it.
  unique (message_id, actor_id)
);

create table chat.message_receipt (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references chat.message (id) on delete cascade,
  actor_id     uuid not null,
  state        text not null default 'sent'
               check (state in ('sent', 'delivered', 'read')),
  sent_at      timestamptz not null default now(),
  delivered_at timestamptz,
  read_at      timestamptz,
  unique (message_id, actor_id)
);

comment on table chat.message_receipt is
  'Per-recipient delivery state. Transitions are monotonic (sent < delivered < '
  'read) so a replayed acknowledgement after reconnect cannot downgrade state.';

create index message_receipt_actor_idx on chat.message_receipt (actor_id, state);

-- "Delete for me". Never affects another participant's copy.
create table chat.message_hidden_for (
  message_id uuid not null references chat.message (id) on delete cascade,
  actor_id   uuid not null,
  hidden_at  timestamptz not null default now(),
  primary key (message_id, actor_id)
);

-- Archive / mute / pin are per-user preferences, never global state. A parent
-- pinning a conversation does not pin it for the admin.
create table chat.conversation_participant_state (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  actor_id        uuid not null,
  last_read_seq   bigint not null default 0,
  archived_at     timestamptz,
  muted_until     timestamptz,
  pinned_at       timestamptz,
  updated_at      timestamptz not null default now(),
  unique (conversation_id, actor_id)
);

create trigger conversation_participant_state_set_updated_at
  before update on chat.conversation_participant_state
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Message approval
-- ---------------------------------------------------------------------------

create table chat.message_approval (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references chat.message (id) on delete cascade,
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  requested_by    uuid not null,
  -- The approver is the family's active handler, always a staff member.
  approver_id     uuid references chat.staff (id) on delete restrict,
  decision        text not null default 'pending'
                  check (decision in ('pending', 'approved', 'rejected')),
  -- An approver rejects with a reason. An approver never edits the message.
  rejection_reason text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,

  constraint approval_decision_consistent
    check ((decision = 'pending') = (decided_at is null)),
  constraint approval_rejection_has_reason
    check (decision <> 'rejected' or rejection_reason is not null)
);

comment on table chat.message_approval is
  'No expiry in MVP: a pending message stays pending until a human decides.';

create index message_approval_queue_idx
  on chat.message_approval (conversation_id, created_at)
  where decision = 'pending';

-- ---------------------------------------------------------------------------
-- Transactional outbox
-- ---------------------------------------------------------------------------

create table chat.outbox_event (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  payload      jsonb not null,
  status       text not null default 'pending'
               check (status in ('pending', 'published', 'failed')),
  attempts     integer not null default 0,
  last_error   text,
  available_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  published_at timestamptz
);

comment on table chat.outbox_event is
  'Written in the same transaction as the domain change, drained by a worker. '
  'A committed message can never lose its realtime fan-out or its notification.';

create index outbox_event_due_idx
  on chat.outbox_event (available_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Notification + reminder engine
-- ---------------------------------------------------------------------------

create table chat.device_token (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null,
  token        text not null unique,
  platform     text not null check (platform in ('android', 'ios', 'web')),
  -- VoIP/CallKit tokens are a separate channel from ordinary push.
  is_voip      boolean not null default false,
  locale       text not null default 'ar' check (locale in ('ar', 'en')),
  is_active    boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table chat.device_token is
  'One actor may hold many tokens. Never assume one user = one device.';

create index device_token_actor_idx on chat.device_token (actor_id) where is_active;

create table chat.notification_template (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  locale     text not null check (locale in ('ar', 'en')),
  version    integer not null default 1,
  title      text not null,
  body       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (key, locale, version)
);

comment on table chat.notification_template is
  'Bilingual and versioned. Notification text never lives in a controller.';

create table chat.notification_rule (
  key             text primary key,
  event_type      text not null,
  -- Signed seconds relative to the anchor. -86400 = 24h before.
  offset_seconds  integer not null default 0,
  template_key    text not null,
  recipient_role  text not null,
  channel         text not null default 'push' check (channel in ('push', 'in_app')),
  priority        text not null default 'normal'
                  check (priority in ('critical', 'high', 'normal', 'low')),
  respect_quiet_hours boolean not null default true,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);

comment on table chat.notification_rule is
  'Reminder schedules are rows, never hardcoded branches.';

create table chat.notification (
  id           uuid primary key default gen_random_uuid(),

  -- THE deduplication guarantee. The same key can never be delivered twice,
  -- across retries, worker restarts, rule edits or duplicate source events.
  dedupe_key   text not null unique,

  rule_key     text references chat.notification_rule (key) on delete set null,
  template_key text not null,
  event_type   text not null,
  recipient_id uuid not null,
  locale       text not null default 'ar' check (locale in ('ar', 'en')),
  channel      text not null default 'push' check (channel in ('push', 'in_app')),
  priority     text not null default 'normal'
               check (priority in ('critical', 'high', 'normal', 'low')),

  family_id       uuid references chat.family (id) on delete cascade,
  conversation_id uuid references chat.conversation (id) on delete cascade,
  variables       jsonb not null default '{}'::jsonb,

  -- Platforms do not all report every state. Unknown stays unknown; a delivery
  -- state is never fabricated.
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'sent', 'delivered', 'opened',
                                 'failed', 'suppressed', 'cancelled')),
  scheduled_at timestamptz not null,
  sent_at      timestamptz,
  delivered_at timestamptz,
  opened_at    timestamptz,
  failed_at    timestamptz,
  failure_code text,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index notification_due_idx
  on chat.notification (scheduled_at) where status = 'scheduled';
create index notification_recipient_idx
  on chat.notification (recipient_id, created_at desc);

create table chat.quiet_hours (
  actor_id     uuid primary key,
  timezone     text not null default 'Africa/Cairo',
  -- Minutes from local midnight. 1320 = 22:00, 480 = 08:00.
  start_minute integer not null default 1320 check (start_minute between 0 and 1439),
  end_minute   integer not null default 480 check (end_minute between 0 and 1439),
  enabled      boolean not null default true
);

comment on table chat.quiet_hours is
  'Incoming calls and critical reminders are exempt. The exemption is a column '
  'on chat.notification_rule, not a branch in code.';

-- ---------------------------------------------------------------------------
-- Calling (PRD MVP: voice, 1:1 and group. No recording.)
-- ---------------------------------------------------------------------------

create table chat.call (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  family_id       uuid references chat.family (id) on delete set null,
  initiator_id    uuid not null,
  type            text not null check (type in ('direct', 'group')),
  -- Room names are server-minted. A client-supplied room name is never trusted.
  room_name       text not null unique,
  status          text not null default 'ringing'
                  check (status in ('ringing', 'active', 'ended')),
  outcome         text check (outcome in ('answered', 'missed', 'declined')),
  started_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  duration_seconds integer,
  created_at      timestamptz not null default now(),

  constraint call_outcome_when_ended
    check (status <> 'ended' or outcome is not null)
);

comment on table chat.call is
  'No audio recording in MVP. Columns for it are deliberately absent; adding '
  'them later is a policy decision, not an accident.';

create index call_family_started_idx on chat.call (family_id, started_at desc);
create index call_conversation_idx on chat.call (conversation_id, started_at desc);

create table chat.call_participant (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid not null references chat.call (id) on delete cascade,
  actor_id   uuid not null,
  -- Recorded so a call's authorization can be audited after the fact.
  actor_kind text not null check (actor_kind in ('contact', 'staff', 'teacher')),
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  left_at    timestamptz,
  unique (call_id, actor_id)
);

create or replace function chat.enforce_call_participant_rules()
returns trigger
language plpgsql
as $$
declare
  v_type  text;
  v_kinds text[];
begin
  select type into v_type from chat.call where id = new.call_id;

  select array_agg(distinct actor_kind) into v_kinds
    from chat.call_participant where call_id = new.call_id;

  if v_type = 'direct'
     and v_kinds @> array['teacher']::text[]
     and v_kinds @> array['contact']::text[] then
    raise exception
      'BR-1 violation: a direct call may never pair a teacher with a family contact'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger call_participant_br1
  after insert or update on chat.call_participant
  for each row execute function chat.enforce_call_participant_rules();
