-- Jawwid Chat -- authoritative media presence on a call participant.
--
-- WHY A COLUMN IS NEEDED AT ALL
-- -----------------------------
-- `chat.call_participant` already has `joined_at` and `left_at`, and neither is
-- free: both are written by the APPLICATION lifecycle.
--
--   joined_at  <- POST /calls/:id/accept   (call.service.ts, accept())
--   left_at    <- POST /calls/:id/decline, and end() for every open participant
--
-- So `joined_at` means "this actor answered over HTTP". It does NOT mean their
-- device reached the media room: an accept is an application act, and the server
-- has never had any evidence of the other thing. That is precisely the gap this
-- migration closes, and it cannot be closed by reusing those columns without
-- destroying the distinction that makes the reconciliation worth having.
--
--   ACCEPTED   != IN THE MEDIA ROOM   != PUBLISHING A MICROPHONE
--
-- Two columns, both nullable, both additive. No existing column changes meaning,
-- no row is rewritten, and every existing reader sees exactly what it saw
-- before.
--
-- WHAT THEY HOLD: LIVEKIT'S CLOCK, NOT OURS
-- -----------------------------------------
-- Both store the timestamp from the webhook event, never the moment the request
-- arrived. Webhook delivery is at-least-once and can be reordered, so arrival
-- order is not evidence of what happened first. Holding the event's own time
-- makes the reconciliation order-independent:
--
--   JOIN(t)   media_joined_at = least(coalesce(media_joined_at, t), t)
--             and media_left_at cleared when it is OLDER than t (a rejoin)
--   LEAVE(t)  media_left_at   = greatest(coalesce(media_left_at, t), t)
--
-- Replaying any event gives the same row, and `LEAVE(10)` arriving before
-- `JOIN(5)` still ends as joined=5, left=10.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
-- * No track state. A published microphone is a third fact again, and
--   representing it needs more than a timestamp; W5 stops at presence.
-- * No webhook event log. Idempotency comes from the two columns plus a
--   conditional UPDATE that reports whether it changed anything, which is the
--   same shape the ring-timeout sweep uses. A table of delivered event ids
--   would be a second source of truth for something the row already answers.
-- * No change to `joined_at`, `left_at`, `answered_at`, `status` or `outcome`.
--   The application lifecycle is untouched; a call still ends explicitly or by
--   the sweep, and an empty media room is not an ending.
-- * Nothing outside the `chat` schema. No Jawwid Core table, no learner, no
--   teacher assignment, no contact, no authorization predicate.

alter table chat.call_participant
  add column if not exists media_joined_at timestamptz,
  add column if not exists media_left_at   timestamptz;

comment on column chat.call_participant.media_joined_at is
  'First time LiveKit reported this participant in the room, from the webhook '
  'event''s own timestamp. NOT the HTTP accept -- that is joined_at. Null means '
  'no media presence has ever been observed.';

comment on column chat.call_participant.media_left_at is
  'Latest time LiveKit reported this participant leaving the room, from the '
  'webhook event''s own timestamp. Cleared by a later rejoin. Null with a '
  'non-null media_joined_at means present.';

-- The reconciliation looks a participant up by (room -> call, actor), and
-- `call_participant` already has a unique index on (call_id, actor_id) that
-- serves it exactly. `chat.call.room_name` is already UNIQUE, which is the
-- room -> call mapping. So no index is added here: both lookups the webhook
-- performs are already covered, and an index that duplicates an existing unique
-- constraint costs writes and buys nothing.
