-- Jawwid Chat -- Phase 5C: broadcast.
--
-- Canonical design: docs/recovery/PHASE-5-REPORT.md.
--
-- Broadcast was deferred at MVP (PRD §13, "Broadcast ... Phase 2") and the only
-- trace of it in the repository was a permission key, 'broadcasts.send', that
-- nothing checked because nothing implemented the feature.
--
-- THE SHAPE THIS EXISTS TO MAKE IMPOSSIBLE
--
--     for (const family of families) await sendMessage(family)
--
-- inside the request that created the broadcast. It is the obvious
-- implementation and every part of it is wrong at the size this feature is for:
-- the manager's HTTP request is held open for the duration; one unreachable
-- recipient fails the whole thing; a retry re-sends to everyone who already
-- received it; a deploy mid-loop loses the remainder with no record of where it
-- stopped; and nothing anywhere can answer "did Rania get it?".
--
-- So a broadcast here is a DURABLE JOB with a per-recipient ledger:
--
--     broadcast (state)             one row: what was asked for, and how it went
--       -> broadcast_audience       the intent, as authored
--       -> broadcast_recipient      one row per person: the unit of work,
--                                   the unit of retry, and the unit of truth
--                                   about delivery
--
-- The request that creates a broadcast resolves the audience and returns. A
-- worker drains chat.broadcast_recipient under the same LEASE discipline Phase
-- 4 established for the outbox, for the same reason: a claim that writes a
-- terminal state loses work when the worker dies, and a claim that writes
-- nothing duplicates it unboundedly.

-- ---------------------------------------------------------------------------
-- 1. The broadcast
-- ---------------------------------------------------------------------------

create table if not exists chat.broadcast (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  title           text,
  body            text not null,
  created_by      uuid not null,
  state           text not null default 'draft',

  -- CLIENT-SUPPLIED IDEMPOTENCY. A manager whose phone retries a timed-out
  -- POST must not send the announcement twice to four hundred families. The
  -- second request with the same key returns the first broadcast instead of
  -- creating one, and the guarantee is a UNIQUE INDEX rather than a check in a
  -- service, because two concurrent retries can both pass a check.
  idempotency_key text,

  -- The ledger's summary. Denormalised deliberately: the status surface is
  -- polled while a large fan-out is in flight, and counting a quarter of a
  -- million recipient rows on every poll to render one progress bar is a cost
  -- with no purpose. Recomputable from chat.broadcast_recipient at any time.
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  delivered_count integer not null default 0,
  failed_count    integer not null default 0,

  queued_at    timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint broadcast_state_check
    check (state in ('draft', 'queued', 'processing',
                     'completed', 'partial_failure', 'failed', 'cancelled')),
  constraint broadcast_body_not_blank check (length(btrim(body)) > 0),
  constraint broadcast_cancel_is_stamped
    check (state <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null))
);

comment on table chat.broadcast is
  'A durable fan-out job. The creating request resolves the audience and '
  'returns; a leased worker delivers. partial_failure is a first-class terminal '
  'state -- successful deliveries are never rolled back because some recipients '
  'failed.';

create unique index if not exists broadcast_idempotency_key_per_organization
  on chat.broadcast (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists broadcast_state_idx
  on chat.broadcast (organization_id, state, created_at desc);

drop trigger if exists broadcast_set_updated_at on chat.broadcast;
create trigger broadcast_set_updated_at
  before update on chat.broadcast
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The audience, as authored
-- ---------------------------------------------------------------------------
--
-- Identical vocabulary to chat.story_audience, and that is the point: ONE
-- audience language, resolved by ONE resolver. Two vocabularies would mean
-- "the Thursday group" could come to mean different sets of people depending on
-- which feature asked.

create table if not exists chat.broadcast_audience (
  id           uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references chat.broadcast (id) on delete cascade,
  kind         text not null,
  ref_id       uuid,
  created_at   timestamptz not null default now(),

  constraint broadcast_audience_kind_check
    check (kind in ('all_families', 'all_teachers', 'assigned_families',
                    'family', 'group', 'label', 'teacher', 'user')),
  constraint broadcast_audience_ref_matches_kind
    check ((kind in ('all_families', 'all_teachers', 'assigned_families') and ref_id is null)
        or (kind not in ('all_families', 'all_teachers', 'assigned_families') and ref_id is not null))
);

create unique index if not exists broadcast_audience_unique
  on chat.broadcast_audience (broadcast_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- 3. The recipient ledger
-- ---------------------------------------------------------------------------

create table if not exists chat.broadcast_recipient (
  id           uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references chat.broadcast (id) on delete cascade,
  actor_id     uuid not null,
  matched_kind text not null,

  -- Where the message lands. Resolved with the audience, not at delivery time:
  -- a recipient with nowhere to deliver is a resolution failure that should be
  -- visible before the fan-out starts, not a null dereference inside it.
  conversation_id uuid references chat.conversation (id) on delete set null,

  status       text not null default 'pending',
  -- The message actually created for this recipient, once it exists. This is
  -- also the IDEMPOTENCY ANCHOR: a redelivered lease finds the message already
  -- written and completes instead of writing a second one.
  message_id      uuid references chat.message (id) on delete set null,
  notification_id uuid,

  attempts     integer not null default 0,
  -- The lease. Same discipline as chat.outbox_event: claiming pushes this
  -- forward, and a worker that dies simply lets it lapse.
  available_at timestamptz not null default now(),
  claimed_at   timestamptz,
  claimed_by   text,

  last_error   text,
  failure_code text,
  sent_at      timestamptz,
  delivered_at timestamptz,
  failed_at    timestamptz,
  created_at   timestamptz not null default now(),

  constraint broadcast_recipient_status_check
    check (status in ('pending', 'queued', 'sent', 'delivered', 'failed'))
);

comment on table chat.broadcast_recipient is
  'One row per person: the unit of work, of retry, and of truth about delivery. '
  'DELIVERY STATES ARE NOT INFERRED -- ''sent'' means a message row was written '
  'and a notification scheduled; ''delivered'' is set only by a real client or '
  'provider acknowledgement, never by a successful insert.';

-- DEDUPLICATION ACROSS OVERLAPPING AUDIENCES, as a constraint rather than as a
-- code path. A family matching the label, the group and an explicit mention is
-- one recipient because a second row cannot exist.
create unique index if not exists broadcast_recipient_unique
  on chat.broadcast_recipient (broadcast_id, actor_id);

-- The fan-out claim predicate. Covers 'queued' (never attempted) and 'pending'
-- (backed off, or a lapsed lease) in one index, or an expired lease would never
-- be found and the recovery path would be a comment.
create index if not exists broadcast_recipient_due_idx
  on chat.broadcast_recipient (available_at)
  where status in ('pending', 'queued');

create index if not exists broadcast_recipient_status_idx
  on chat.broadcast_recipient (broadcast_id, status);

-- "Which broadcasts reached this person", for the delivery-report surface.
create index if not exists broadcast_recipient_actor_idx
  on chat.broadcast_recipient (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS -- deny by default
-- ---------------------------------------------------------------------------
--
-- A broadcast is an OPERATOR object. A parent never reads chat.broadcast; they
-- read the ordinary message that the fan-out delivered into their conversation,
-- through the message policies that have governed every other message since
-- Phase 1. That is why there is no reader policy here at all: the recipient
-- ledger names every family in the audience, and one row of it read by the
-- wrong person is a directory of the academy's customers.

alter table chat.broadcast           enable row level security;
alter table chat.broadcast_audience  enable row level security;
alter table chat.broadcast_recipient enable row level security;

drop policy if exists broadcast_organization_isolation on chat.broadcast;
create policy broadcast_organization_isolation on chat.broadcast
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists broadcast_visible_to_senders on chat.broadcast;
create policy broadcast_visible_to_senders on chat.broadcast
  for select to authenticated
  using (chat.current_has_permission('broadcasts.send'));

drop policy if exists broadcast_audience_visible_to_senders on chat.broadcast_audience;
create policy broadcast_audience_visible_to_senders on chat.broadcast_audience
  for select to authenticated
  using (chat.current_has_permission('broadcasts.send'));

drop policy if exists broadcast_recipient_visible_to_senders on chat.broadcast_recipient;
create policy broadcast_recipient_visible_to_senders on chat.broadcast_recipient
  for select to authenticated
  using (chat.current_has_permission('broadcasts.send'));

grant select on chat.broadcast, chat.broadcast_audience, chat.broadcast_recipient
  to authenticated;
grant select, insert, update on
  chat.broadcast, chat.broadcast_audience, chat.broadcast_recipient to chat_app;
grant select, insert, update, delete on
  chat.broadcast, chat.broadcast_audience, chat.broadcast_recipient to service_role;

-- WRITES are gated on the same permission the reads are, addressed
-- `to authenticated`.
--
-- NOT `for all to chat_app using (true)`: that is a PERMISSIVE policy which
-- ORs with the read policies above, and would hand every authenticated session
-- the recipient ledger -- a directory of the academy's customers. The blanket
-- form is reserved for the five identity tables (20260907120000).
--
-- The fan-out worker is unaffected: it connects as `chat_service`, which
-- bypasses RLS by design (infra/env/manifest.tsv, RLS-STRATEGY.md 6). That is
-- also why there is no policy here trying to describe a worker's identity --
-- the worker has no actor, and a policy that had to accommodate one would be a
-- hole shaped exactly like the worker.

drop policy if exists broadcast_written_by_sender on chat.broadcast;
create policy broadcast_written_by_sender on chat.broadcast
  for insert to authenticated
  with check (chat.current_has_permission('broadcasts.send'));

drop policy if exists broadcast_updated_by_sender on chat.broadcast;
create policy broadcast_updated_by_sender on chat.broadcast
  for update to authenticated
  using (chat.current_has_permission('broadcasts.send'))
  with check (chat.current_has_permission('broadcasts.send'));

drop policy if exists broadcast_audience_written_by_sender on chat.broadcast_audience;
create policy broadcast_audience_written_by_sender on chat.broadcast_audience
  for insert to authenticated
  with check (chat.current_has_permission('broadcasts.send'));

drop policy if exists broadcast_recipient_written_by_sender on chat.broadcast_recipient;
create policy broadcast_recipient_written_by_sender on chat.broadcast_recipient
  for insert to authenticated
  with check (chat.current_has_permission('broadcasts.send'));

drop policy if exists broadcast_recipient_updated_by_sender on chat.broadcast_recipient;
create policy broadcast_recipient_updated_by_sender on chat.broadcast_recipient
  for update to authenticated
  using (chat.current_has_permission('broadcasts.send'))
  with check (chat.current_has_permission('broadcasts.send'));

-- ---------------------------------------------------------------------------
-- 5. Configuration
-- ---------------------------------------------------------------------------
--
-- HOW THE CONCURRENCY NUMBERS WERE CHOSEN. Not from a benchmark -- from the
-- constraint that fan-out must never be the reason the interactive product gets
-- slow. Every delivery is a small transaction plus a scheduled notification, on
-- the same database and the same push provider that serve live chat. A batch of
-- 100 with 8 in flight is a few hundred queries a second at most: fast enough
-- that a thousand families clear in well under a minute, small enough that it
-- cannot saturate a connection pool sized for a chat workload.

insert into chat.config (key, value, scope, description) values
  ('broadcast.fanout_batch_size', '100'::jsonb, 'communication',
   'Recipients one fan-out claim leases.'),
  ('broadcast.fanout_concurrency', '8'::jsonb, 'communication',
   'Deliveries in flight at once within a batch. Bounded so fan-out can never starve interactive chat of database or provider capacity.'),
  ('broadcast.lease_seconds', '60'::jsonb, 'communication',
   'How long a claimed recipient stays invisible before another worker may reclaim it.'),
  ('broadcast.max_attempts', '5'::jsonb, 'communication',
   'Delivery attempts per recipient before that recipient is parked as failed. The broadcast continues.'),
  ('broadcast.max_recipients', '5000'::jsonb, 'communication',
   'Largest audience one broadcast may resolve to. A guard against an audience clause that accidentally means everyone.')
on conflict (key) do nothing;

insert into chat.notification_template (key, locale, version, title, body) values
  ('broadcast_message', 'ar', 1, '{organization_name}', '{preview}'),
  ('broadcast_message', 'en', 1, '{organization_name}', '{preview}')
on conflict (key, locale, version) do nothing;
