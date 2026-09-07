-- Jawwid Chat -- Phase 4A/4B: crash-safe outbox and notification dispatch.
--
-- Canonical design: docs/recovery/PHASE-4-REPORT.md §4.
--
-- THE DEFECT THIS MIGRATION EXISTS TO CLOSE
--
-- Both drains claimed a row by moving it to its TERMINAL state and only then
-- did the work:
--
--     OutboxWorker.drain()        update ... set status = 'published'  -- claim
--                                 await this.publish(...)              -- work
--
--     NotificationService.dispatchDue()
--                                 update ... set status = 'sent'       -- claim
--                                 await this.deliver(...)              -- work
--
-- The conditional update is a correct MUTUAL EXCLUSION -- two workers never
-- both get the row -- and it was written for that. It is not a correct claim,
-- because the state it writes says the work is FINISHED. A worker that is
-- SIGKILLed, OOM-killed, evicted, or loses its database connection between the
-- two statements leaves a row that says "published" and was published to
-- nobody. Nothing scans for it, because nothing has any reason to: its status
-- is terminal and its published_at is stamped. The event is not delayed. It is
-- gone, silently, forever.
--
-- Reordering the two statements does not fix it; it only moves the crash window
-- and adds an unbounded-duplicate window in its place (publish, crash, re-read
-- as pending, publish again, forever if the crash is deterministic).
--
-- THE FIX: A LEASE (visibility timeout).
--
-- Claiming moves the row to a NON-terminal in-flight state and pushes
-- available_at into the future by the lease duration:
--
--     pending ---------claim--------> processing   (available_at = now + lease)
--     processing ------published----> published    (terminal, work confirmed)
--     processing ------error--------> pending      (backoff) | failed (exhausted)
--     processing ------CRASH--------> (nothing written)
--                                        |
--                                        +-- lease expires; the row is due again
--                                            and the next claim picks it up.
--
-- A worker crash at ANY point is therefore either "already published" or "will
-- be reclaimed when the lease expires". There is no window in which a row is
-- both unpublished and unreachable. That is at-least-once, honestly: the
-- crash-after-publish-before-confirm case republishes, which is why both
-- consumers are idempotent (realtime fan-out is naturally so; notifications
-- dedupe on the unique dedupe_key).
--
-- WHAT CANNOT BE REPAIRED. Rows lost by the old code are unrecoverable and this
-- migration does not pretend otherwise. The old claim wrote status='published'
-- AND published_at=now() in one statement, so a crashed row is byte-identical
-- to a genuinely delivered one. There is no predicate that separates them, and
-- a backfill that guessed would REPLAY real events -- redelivering messages and
-- re-notifying people about conversations that moved on days ago. Nothing is
-- backfilled. The fix is forward-only.

-- ---------------------------------------------------------------------------
-- 1. The outbox lease
-- ---------------------------------------------------------------------------

alter table chat.outbox_event
  drop constraint if exists outbox_event_status_check;

alter table chat.outbox_event
  add constraint outbox_event_status_check
  check (status in ('pending', 'processing', 'published', 'failed'));

alter table chat.outbox_event
  add column if not exists claimed_at timestamptz,
  -- Which worker holds the lease. Diagnostics only -- the lease is enforced by
  -- available_at, never by comparing this string -- but "which pod wedged this
  -- row" is the first question asked when one does, and without it the answer
  -- is unavailable.
  add column if not exists claimed_by text;

comment on column chat.outbox_event.claimed_at is
  'When the current lease was taken. Null unless status = ''processing''.';
comment on column chat.outbox_event.claimed_by is
  'Diagnostic label of the worker holding the lease. Never an authorization input.';

-- The due index must cover PROCESSING as well, or an expired lease would never
-- be found and the whole recovery path would be a comment describing something
-- that does not run. This is the load-bearing half of the migration.
drop index if exists chat.outbox_event_due_idx;
create index outbox_event_due_idx
  on chat.outbox_event (available_at)
  where status in ('pending', 'processing');

-- Operational visibility (§35): "which events are stuck, and since when".
create index if not exists outbox_event_stuck_idx
  on chat.outbox_event (status, created_at)
  where status in ('processing', 'failed');

comment on table chat.outbox_event is
  'Written in the same transaction as the domain change, drained by a worker '
  'under a LEASE: claiming moves a row to ''processing'' with available_at '
  'pushed forward, so a worker that dies mid-publish releases the row when the '
  'lease expires instead of losing the event. At-least-once; consumers are '
  'idempotent.';

-- ---------------------------------------------------------------------------
-- 2. The notification dispatch lease
-- ---------------------------------------------------------------------------
--
-- The same shape, expressed in the columns this table already has. A separate
-- 'sending' status would have to be added to a CHECK that four services and two
-- clients read as the delivery-state vocabulary, and 'sending' is not a
-- delivery state a product surface should ever have to render. scheduled_at IS
-- the due time, so pushing it forward is exactly a visibility timeout, and the
-- row stays 'scheduled' -- which is true: it is scheduled, and an attempt is in
-- flight.

alter table chat.notification
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text;

comment on column chat.notification.claimed_at is
  'When the current dispatch lease was taken; scheduled_at holds its expiry.';

-- notification_due_idx already covers (scheduled_at) where status='scheduled',
-- which is the claim predicate unchanged -- an expired lease is simply a row
-- that has become due again. Nothing to re-index.

create index if not exists notification_stuck_idx
  on chat.notification (status, scheduled_at)
  where status in ('scheduled', 'failed');

-- ---------------------------------------------------------------------------
-- 3. Configuration
-- ---------------------------------------------------------------------------
--
-- The lease is a duration, and every duration in this system is a row (§36 of
-- the Phase 2 report: "no number is compiled into a service").
--
-- HOW TO CHOOSE IT. The lease must exceed the longest a single publish can
-- legitimately take, or a slow-but-alive worker has its row stolen and the
-- event is published twice for no reason. It must not exceed how long an
-- operator will tolerate one event being stuck after a crash. 60s sits well
-- clear of a publish (a Redis PUBLISH and a handful of indexed queries) and
-- well inside a human's patience.

insert into chat.config (key, value, scope, description) values
  ('outbox.lease_seconds', '60'::jsonb, 'communication',
   'How long a claimed outbox row stays invisible before another worker may reclaim it. Must exceed the slowest legitimate publish.'),
  ('outbox.max_attempts', '5'::jsonb, 'communication',
   'Attempts before an outbox row is parked as failed for an operator.'),
  ('notification.lease_seconds', '120'::jsonb, 'communication',
   'How long a claimed notification stays invisible before redispatch. Longer than the outbox lease: a push provider round trip is a network call to a third party.')
on conflict (key) do nothing;
