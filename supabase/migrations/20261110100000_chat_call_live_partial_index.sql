-- Jawwid Chat -- the index the one-learner lesson sweep needs (OA-12).
--
-- WHAT THIS MIGRATION IS
-- ----------------------
-- ONE partial index. No column, no state, no constraint, no trigger.
--
-- WHY
-- ---
-- CallService.separateLessonLearners runs on every worker call-sweep pass
-- (CALL_SWEEP_INTERVAL_MS, 5 seconds by default) and asks:
--
--   which calls are not ended yet?            (status <> 'ended')
--
-- and then joins their participants by call id. chat.call's other indexes are
-- the unique room_name, (family_id, started_at), (conversation_id,
-- started_at), the ringing-call index (status = 'ringing') and the
-- interrupted-call index (status = 'active' and interrupted_at is not null).
-- None of them answers "every call still ringing or active", so without this
-- the sweep is a sequential scan of every call ever made, every few seconds,
-- growing with history.
--
-- PARTIAL, on purpose. A call that is not ended is transient: a handful of
-- rows at any instant out of the whole table. The index holds only those, so
-- it stays tiny however large chat.call grows, and a row leaves it the moment
-- the call ends. Keyed on `id` because the sweep joins chat.call_participant
-- on `call_id` (call_participant has its (call_id, actor_id) key).
--
-- The one-room path (LiveKit's participant_joined webhook) is a separate query
-- that filters on room_name and uses the existing unique room_name index.
--
-- IF NOT EXISTS, and no CONCURRENTLY: the migration runner wraps each file in
-- a transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. The
-- build reads chat.call once and holds writes to it until it finishes; the
-- index it writes holds only the live calls.
--
-- Rollback: drop index if exists chat.call_live_idx;

create index if not exists call_live_idx
  on chat.call (id)
  where status <> 'ended';

comment on index chat.call_live_idx is
  'Serves the OA-12 one-learner sweep (CallService.separateLessonLearners): '
  'the calls that are not ended. Partial because a live call is transient -- '
  'the index holds only calls ringing or active right now, so it stays small '
  'as chat.call grows.';
