-- Jawwid Chat -- the index the ring-timeout sweep needs.
--
-- WHAT THIS MIGRATION IS, AND IS NOT
-- ----------------------------------
-- It adds ONE partial index. It adds no column, no state, no constraint and no
-- trigger, because the lifecycle an unanswered call needs is already
-- representable:
--
--   status  = 'ended'    (chat.call status check: ringing | active | ended)
--   outcome = 'missed'   (chat.call outcome check: answered | missed | declined)
--
-- and `call_outcome_when_ended` already forces an outcome onto any ended call.
-- A separate `expired` state would say nothing `missed` does not already say,
-- and every reader -- history, the client, the notification rules keyed on
-- `call_missed` -- would then have to learn two words for one fact.
--
-- THE DEADLINE IS NOT STORED EITHER
-- ---------------------------------
-- A ringing call's deadline is `started_at + call.ring_timeout_seconds`, and
-- both halves already exist: the timestamp on the row, the duration in
-- chat.config. Materialising a `ring_deadline_at` column would duplicate a
-- value derivable from two others, and would then need backfilling and keeping
-- in step with the configuration. The trade is deliberate and has one visible
-- consequence, stated here rather than discovered later: changing
-- `call.ring_timeout_seconds` retroactively moves the deadline of calls that
-- are ringing at that moment. For a 45-second timeout changed by an
-- administrator, that is the correct behaviour -- the current policy applies --
-- rather than a surprise.
--
-- WHY THE INDEX
-- -------------
-- The sweep asks one question, repeatedly, forever:
--
--   which calls are still ringing and started before now - timeout?
--
-- chat.call has indexes on (conversation_id, started_at), (family_id,
-- started_at) and organization_id -- none of which answers it. Without this the
-- sweep is a sequential scan of every call ever made, run every few seconds,
-- growing with history.
--
-- PARTIAL, on purpose. `status = 'ringing'` is a transient state: a handful of
-- rows at any instant out of the whole table. The index therefore stays tiny
-- however large chat.call grows, and a row leaves the index as soon as the call
-- is answered or ended -- which is also what makes the sweep cheap when there
-- is nothing to do, the normal case.
--
-- IF NOT EXISTS, and no CONCURRENTLY: the migration runner wraps each file in a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. On a table
-- whose ringing rows number in the dozens the lock is momentary.

create index if not exists call_ringing_started_idx
  on chat.call (started_at)
  where status = 'ringing';

comment on index chat.call_ringing_started_idx is
  'Serves the ring-timeout sweep: the ringing calls whose deadline has passed. '
  'Partial because ringing is transient -- the index holds only calls that are '
  'ringing right now, so it stays small as chat.call grows.';
