-- Jawwid Chat -- crash-safe notification dispatch.
--
-- THE DEFECT. dispatchDue() claimed a notification by setting status = 'sent'
-- BEFORE delivering it, so that two workers could not both send it. That works
-- for the race it was written for and fails for the one that matters: a worker
-- that dies between the claim and the send leaves a notification permanently
-- marked sent with nothing delivered anywhere. No sweep looks at it again,
-- because 'sent' is a terminal-looking state. The parent is never told.
--
-- "The in-app notification still exists, so nothing is lost" was the defence,
-- and it is not good enough. The requirement is that the parent finds out --
-- which for a backgrounded or closed app means the push, and the push is
-- exactly what that crash swallows.
--
-- THE FIX. Claiming takes a LEASE rather than declaring success:
--
--   scheduled --claim--> processing (lease_expires_at = now + lease)
--   processing --deliver--> sent | failed
--   processing --worker dies, lease expires--> eligible again
--
-- Re-delivery after a recovery cannot double-send, because delivery identity is
-- already deterministic: chat.notification_delivery is unique per
-- (notification, channel, device), and a row that is already sent, delivered,
-- failed or skipped is not re-attempted. The recovered notification therefore
-- completes only the channels the crash left undone.

alter table chat.notification
  -- NULL except while a worker holds the row. Its presence and its expiry are
  -- the whole recovery mechanism: an abandoned claim is one whose lease ran out.
  add column if not exists lease_expires_at timestamptz,
  -- Which worker holds it. Diagnostics only -- recovery is driven by the clock,
  -- never by asking whether a process is still alive, because the answer to
  -- that question is exactly what is unavailable after a crash.
  add column if not exists claimed_by text;

comment on column chat.notification.lease_expires_at is
  'Held while a worker is delivering. Past its expiry the claim is abandoned '
  'and the notification becomes eligible again. Re-delivery is safe because '
  'chat.notification_delivery is unique per (notification, channel, device).';

alter table chat.notification drop constraint if exists notification_status_check;
alter table chat.notification
  add constraint notification_status_check check (status in (
    'scheduled', 'processing', 'sent', 'delivered', 'opened',
    'failed', 'suppressed', 'cancelled'));

-- A held lease must have an expiry and an expiry must belong to a held lease.
-- Without this, a row could sit in 'processing' with a NULL expiry and never be
-- recovered by anything -- the same invisible-stuck state, one column along.
alter table chat.notification drop constraint if exists notification_lease_check;
alter table chat.notification
  add constraint notification_lease_check check (
    (status = 'processing') = (lease_expires_at is not null));

-- The dispatch sweep reads two things: what is due, and what was abandoned. One
-- partial index covers both, because both are "not yet delivered" rows and
-- neither should be searched for among the millions that already are.
drop index if exists chat.notification_due_idx;
create index if not exists notification_dispatchable_idx
  on chat.notification (scheduled_at)
  where status in ('scheduled', 'processing');

comment on index chat.notification_dispatchable_idx is
  'Partial on the two live states. Replaces notification_due_idx, which covered '
  'only ''scheduled'' and so could not find an abandoned claim at all.';

insert into chat.config (key, value, scope, description) values
  ('notification.dispatch_lease_seconds', '120'::jsonb, 'communication',
   'How long a worker may hold a notification before the claim is treated as '
   'abandoned. Long enough that a slow push to several devices finishes; short '
   'enough that a crashed worker''s backlog is picked up within minutes.')
on conflict (key) do nothing;

-- Existing rows are untouched: they are in 'scheduled', 'sent' or a terminal
-- state, all of which remain valid. Nothing is migrated INTO 'processing',
-- because a claim is a live fact about a running worker and there are none.
