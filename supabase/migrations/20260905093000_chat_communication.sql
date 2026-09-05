-- Jawwid Chat -- communication domain (AI #2).
--
-- Owns: conversations, membership, messages, attachments, reactions, receipts,
-- approvals, outbox, notifications/reminders, calls.
--
-- Authoritative scope: Jawwid Chat PRD v0.1 (see docs/qa/authoritative-scope.md).
-- BR-1: Teacher <-> Parent direct communication is FORBIDDEN, messaging and
-- calling alike. Teachers and parents meet only inside a Student Group.
-- BR-1 is enforced three times over: in the API authorization service, by the
-- membership triggers below, and by the call trigger below. A UI restriction is
-- not an implementation of BR-1.
--
-- PHONE PRIVACY: no table in this migration has a phone, email or address
-- column. Actors are referenced by opaque uuid only, so a phone number cannot
-- travel through a conversation, message, call, notification or realtime event.
--
-- IDENTITY BOUNDARY (AI #1 owns identity):
--   Actors are (actor_kind, actor_id). actor_id references auth.users(id),
--   which is the authentication anchor every actor must have -- staff, teacher
--   and parent alike (PRD requires a Teacher app, so teachers authenticate).
--   This migration deliberately creates NO staff / teacher / family / learner
--   table. family_id and learner_id are therefore un-FK'd here; AI #1 adds the
--   constraints when chat.family and chat.learner land. The exact statements
--   are listed in docs/communication/ai1-dependencies.md.

-- ---------------------------------------------------------------------------
-- Domain vocabularies. Text + check constraint, matching chat.config style.
-- ---------------------------------------------------------------------------

create domain chat.actor_kind as text
  check (value in ('contact', 'staff', 'teacher', 'system'));

comment on domain chat.actor_kind is
  'Who is acting. "contact" is a family-side person (parent/guardian). '
  '"teacher" is an academic actor with a mobile app. "staff" is CS/admin.';

-- ---------------------------------------------------------------------------
-- Conversation
-- ---------------------------------------------------------------------------

create table chat.conversation (
  id            uuid primary key default gen_random_uuid(),

  -- PRD v0.1 requires several concurrent conversation kinds per family.
  type          text not null
                check (type in ('direct', 'student_group', 'class_group', 'official')),

  -- Customer relationship context. Null for staff<->staff conversations.
  family_id     uuid,
  -- Student group is scoped to exactly one learner.
  learner_id    uuid,

  title         text,

  -- Canonical identity of a 1:1 conversation: the two participant ids sorted
  -- and joined. Makes "get or create the direct conversation" idempotent and
  -- makes a duplicate 1:1 impossible. Null for group conversations.
  direct_key    text unique,

  -- Communication-level lifecycle. Case status is the ops domain and is not
  -- duplicated here.
  state         text not null default 'open'
                check (state in ('open', 'waiting_on_customer', 'waiting_on_jawwid', 'resolved')),

  -- Group message approval policy (PRD: approve / reject / rejection reason).
  teacher_requires_approval boolean not null default true,
  parent_requires_approval  boolean not null default true,

  -- Handler stickiness. Coverage never creates a second conversation; the
  -- relationship stays with the family when the handler changes.
  sticky_handler_id uuid,
  sticky_until      timestamptz,

  -- Server-assigned monotonic message counter. Ordering never depends on a
  -- device clock.
  last_seq          bigint not null default 0,

  last_customer_message_at timestamptz,
  last_staff_message_at    timestamptz,
  last_activity_at         timestamptz not null default now(),
  resolved_at              timestamptz,
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- A student group is the official group for exactly one learner.
  constraint conversation_group_has_learner
    check (type <> 'student_group' or learner_id is not null),
  -- A direct conversation is always keyed by its participant pair.
  constraint conversation_direct_has_key
    check (type <> 'direct' or direct_key is not null)
);

comment on table chat.conversation is
  'A conversation with an explicit participant set. BR-1 is enforced against '
  'chat.conversation_member, never against the UI.';

create unique index conversation_one_group_per_learner
  on chat.conversation (learner_id)
  where type = 'student_group' and archived_at is null;

create index conversation_family_activity
  on chat.conversation (family_id, last_activity_at desc);
create index conversation_activity on chat.conversation (last_activity_at desc);
create index conversation_state on chat.conversation (state) where archived_at is null;

create trigger conversation_set_updated_at
  before update on chat.conversation
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership -- the set BR-1 is enforced against
-- ---------------------------------------------------------------------------

create table chat.conversation_member (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,

  actor_kind      chat.actor_kind not null,
  actor_id        uuid not null references auth.users (id) on delete restrict,

  -- Why this actor is present. Drives approval policy and call permissions.
  member_role     text not null
                  check (member_role in ('parent', 'teacher', 'admin', 'observer')),

  -- Coverage admins may sit in a group without participating.
  is_silent       boolean not null default false,

  added_by        uuid,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz
);

comment on table chat.conversation_member is
  'Explicit participant set. Teachers and parents may share a student_group '
  'row set, and may never share a direct one (enforced below).';

-- One live membership per actor per conversation.
create unique index conversation_member_unique_live
  on chat.conversation_member (conversation_id, actor_id)
  where left_at is null;

create index conversation_member_actor
  on chat.conversation_member (actor_id) where left_at is null;
create index conversation_member_conversation
  on chat.conversation_member (conversation_id) where left_at is null;

-- --- BR-1, in the database -------------------------------------------------

create or replace function chat.enforce_direct_conversation_rules()
returns trigger
language plpgsql
as $$
declare
  v_type      text;
  v_kinds     text[];
  v_live      integer;
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

  -- BR-1: never a teacher and a parent alone together.
  if v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[] then
    raise exception
      'BR-1 violation: a direct conversation may never contain both a teacher and a family contact'
      using errcode = 'check_violation';
  end if;

  -- A 1:1 conversation has exactly two live participants.
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

create constraint trigger conversation_member_br1
  after insert or update on chat.conversation_member
  deferrable initially immediate
  for each row execute function chat.enforce_direct_conversation_rules();

-- ---------------------------------------------------------------------------
-- Message
-- ---------------------------------------------------------------------------

create table chat.message (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,

  -- Cases are the ops domain (AI #4). Nullable link, no FK taken here.
  case_id         uuid,

  author_kind     chat.actor_kind not null,
  author_id       uuid references auth.users (id) on delete restrict,

  -- Brief invariant carried forward: every staff message states the capacity it
  -- was sent in.
  on_behalf_mode  text
                  check (on_behalf_mode in ('owner', 'coverage', 'assist', 'escalation')),

  type            text not null default 'text'
                  check (type in ('text', 'image', 'video', 'voice', 'file', 'system')),
  body            text,

  -- Audience: internal notes are invisible to family contacts.
  visibility      text not null default 'customer'
                  check (visibility in ('customer', 'internal')),

  -- Moderation, orthogonal to visibility. Drives the approval queue.
  moderation      text not null default 'published'
                  check (moderation in ('published', 'pending', 'rejected')),

  origin          text not null default 'user'
                  check (origin in ('user', 'automation', 'broadcast')),

  -- Deterministic ordering, assigned server-side under a row lock.
  seq             bigint not null,

  reply_to_message_id uuid references chat.message (id) on delete set null,

  -- Idempotency key supplied by the client. Retrying a send is free.
  client_message_id   text,

  deleted_at      timestamptz,
  deleted_by      uuid,
  deleted_for_all boolean not null default false,
  redacted_reason text,

  created_at      timestamptz not null default now(),

  -- A system message has no author; every other message has one.
  constraint message_author_present
    check ((author_kind = 'system') = (author_id is null)),
  -- Only staff messages carry a capacity.
  constraint message_on_behalf_mode_staff_only
    check (on_behalf_mode is null or author_kind = 'staff'),
  -- A contact can never author an internal note.
  constraint message_internal_not_from_contact
    check (visibility = 'customer' or author_kind <> 'contact')
);

comment on column chat.message.seq is
  'Per-conversation monotonic sequence. Clients reconstruct order from this '
  'after reconnect, delayed delivery, retries or multi-device sends.';

create unique index message_conversation_seq
  on chat.message (conversation_id, seq);

-- THE idempotency guarantee. Postgres treats NULLs as distinct, so messages
-- without a client key are unaffected.
create unique index message_idempotency
  on chat.message (conversation_id, author_id, client_message_id)
  where client_message_id is not null;

create index message_conversation_seq_desc
  on chat.message (conversation_id, seq desc);
create index message_pending_approval
  on chat.message (conversation_id) where moderation = 'pending';
create index message_author on chat.message (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Attachments, reactions, receipts, per-user state
-- ---------------------------------------------------------------------------

create table chat.message_attachment (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references chat.message (id) on delete cascade,
  kind          text not null check (kind in ('image', 'video', 'voice', 'file')),
  -- Binary content lives in object storage. Postgres holds metadata only.
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

create index message_attachment_message on chat.message_attachment (message_id);

create table chat.message_reaction (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references chat.message (id) on delete cascade,
  actor_id   uuid not null references auth.users (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (message_id, actor_id)
);

create table chat.message_receipt (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references chat.message (id) on delete cascade,
  actor_id     uuid not null references auth.users (id) on delete cascade,
  state        text not null default 'sent'
               check (state in ('sent', 'delivered', 'read')),
  sent_at      timestamptz not null default now(),
  delivered_at timestamptz,
  read_at      timestamptz,
  unique (message_id, actor_id)
);

comment on table chat.message_receipt is
  'Per-recipient delivery state. Transitions are monotonic (sent < delivered < '
  'read) so replayed acknowledgements after a reconnect cannot downgrade state.';

create index message_receipt_actor on chat.message_receipt (actor_id, state);

-- "Delete for me". Never affects another participant's copy.
create table chat.message_hidden_for (
  message_id uuid not null references chat.message (id) on delete cascade,
  actor_id   uuid not null references auth.users (id) on delete cascade,
  hidden_at  timestamptz not null default now(),
  primary key (message_id, actor_id)
);

-- Archive / mute / pin are per-user preferences, never global conversation state.
create table chat.conversation_participant_state (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  actor_id        uuid not null references auth.users (id) on delete cascade,
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
-- Message approval (PRD MVP: approve / reject / rejection reason)
-- ---------------------------------------------------------------------------

create table chat.message_approval (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references chat.message (id) on delete cascade,
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  requested_by    uuid not null references auth.users (id) on delete restrict,
  approver_id     uuid references auth.users (id) on delete restrict,
  decision        text not null default 'pending'
                  check (decision in ('pending', 'approved', 'rejected')),
  -- An approver rejects with a reason; an approver never edits the message.
  rejection_reason text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,

  constraint approval_decision_consistent
    check ((decision = 'pending') = (decided_at is null)),
  constraint approval_rejection_has_reason
    check (decision <> 'rejected' or rejection_reason is not null)
);

comment on table chat.message_approval is
  'No expiry in MVP: a pending message stays pending until a human approves or '
  'rejects it.';

create index message_approval_queue
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
  'Written in the same transaction as the domain change. A committed message '
  'can never lose its realtime fan-out or its notification.';

create index outbox_event_due
  on chat.outbox_event (available_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Notification + reminder engine
-- ---------------------------------------------------------------------------

create table chat.device_token (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users (id) on delete cascade,
  token       text not null unique,
  platform    text not null check (platform in ('android', 'ios', 'web')),
  -- VoIP/CallKit tokens are a separate channel from ordinary push.
  is_voip     boolean not null default false,
  locale      text not null default 'ar' check (locale in ('ar', 'en')),
  is_active   boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table chat.device_token is
  'One actor may hold many tokens. Never assume one user = one device.';

create index device_token_actor on chat.device_token (actor_id) where is_active;

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
  'Reminder schedules are rows, never hardcoded branches. Class T-24h/T-30m, '
  'renewal D-14/7/1/0 and payment D-7/-3/0/+3/+7 are seeded, not compiled in.';

create table chat.notification (
  id           uuid primary key default gen_random_uuid(),

  -- THE deduplication guarantee. Same key can never be delivered twice, across
  -- retries, worker restarts, rule edits or duplicate source events.
  dedupe_key   text not null unique,

  rule_key     text,
  template_key text not null,
  event_type   text not null,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  locale       text not null default 'ar' check (locale in ('ar', 'en')),
  channel      text not null default 'push' check (channel in ('push', 'in_app')),
  priority     text not null default 'normal'
               check (priority in ('critical', 'high', 'normal', 'low')),

  family_id       uuid,
  conversation_id uuid references chat.conversation (id) on delete cascade,
  variables       jsonb not null default '{}'::jsonb,

  -- Platforms do not all report every state. Unknown stays unknown; delivery is
  -- never fabricated.
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

create index notification_due
  on chat.notification (scheduled_at) where status = 'scheduled';
create index notification_recipient
  on chat.notification (recipient_id, created_at desc);

create table chat.quiet_hours (
  actor_id     uuid primary key references auth.users (id) on delete cascade,
  timezone     text not null default 'Africa/Cairo',
  -- Minutes from local midnight. 1320 = 22:00, 480 = 08:00.
  start_minute integer not null default 1320 check (start_minute between 0 and 1439),
  end_minute   integer not null default 480 check (end_minute between 0 and 1439),
  enabled      boolean not null default true
);

comment on table chat.quiet_hours is
  'Incoming calls and critical reminders are exempt; the exemption list is '
  'chat.notification_rule.respect_quiet_hours, not code.';

-- ---------------------------------------------------------------------------
-- Calling (PRD MVP: voice, 1:1 and group. No recording.)
-- ---------------------------------------------------------------------------

create table chat.call (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  family_id       uuid,
  initiator_id    uuid not null references auth.users (id) on delete restrict,
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

create index call_family_started on chat.call (family_id, started_at desc);
create index call_conversation on chat.call (conversation_id, started_at desc);

create table chat.call_participant (
  id        uuid primary key default gen_random_uuid(),
  call_id   uuid not null references chat.call (id) on delete cascade,
  actor_id  uuid not null references auth.users (id) on delete restrict,
  -- Recorded so a call's authorization can be audited after the fact.
  actor_kind chat.actor_kind not null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at   timestamptz,
  unique (call_id, actor_id)
);

-- BR-1 for calling: the participant set of a direct call may never pair a
-- teacher with a family contact.
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

create constraint trigger call_participant_br1
  after insert or update on chat.call_participant
  deferrable initially immediate
  for each row execute function chat.enforce_call_participant_rules();

-- ---------------------------------------------------------------------------
-- Immutability: a sent message is a record, not a draft.
-- ---------------------------------------------------------------------------
-- chat.message allows UPDATE (moderation decisions, soft delete, receipts) but
-- its body and authorship must never be rewritten.

create or replace function chat.forbid_message_rewrite()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body and old.deleted_for_all = false
     and new.deleted_for_all = false then
    raise exception 'chat.message.body is immutable once sent'
      using errcode = 'restrict_violation';
  end if;
  if new.author_id is distinct from old.author_id
     or new.author_kind is distinct from old.author_kind
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
