-- Jawwid Chat -- Phase 5 closure: the recording job id, and the honest default.
--
-- WHAT THIS CLOSES
--
-- 20260907150000 created chat.call_recording with an object_key and a status,
-- and the service that wrote it minted an upload authorization for "the media
-- pipeline (the LiveKit egress worker, or whatever writes the file)".
--
-- No such worker existed. Nothing in the repository ever moved a recording from
-- `pending` to `available`, so every recording row was metadata for audio that
-- was never captured. The Phase 5 report said so; this migration is half of
-- fixing it (the other half is LiveKitEgressRecorder and the egress webhook).
--
-- Recording is now REQUESTED from LiveKit Egress, which joins the room, mixes
-- the audio and writes the file to the private bucket itself. Egress identifies
-- that job by an id, and this column is where it lives -- it is how a recording
-- is stopped, and how a completion webhook is matched back to the row it
-- belongs to.

alter table chat.call_recording
  add column if not exists egress_id text;

comment on column chat.call_recording.egress_id is
  'The LiveKit Egress job that is producing this recording. Null until the '
  'recorder accepts the request, and the key a completion webhook is matched '
  'on. Not a secret and not an authorization input.';

-- The webhook lookup. Egress delivers by job id, and without this every
-- delivery is a sequential scan of every recording ever made.
create unique index if not exists call_recording_egress_id_idx
  on chat.call_recording (egress_id)
  where egress_id is not null;

-- ---------------------------------------------------------------------------
-- The pending-recording backstop
-- ---------------------------------------------------------------------------
--
-- A `pending` recording reads as "recording in progress" on every surface that
-- shows one. A recorder that never started, or that died, would therefore look
-- exactly like one that is working -- indefinitely.
--
-- The service marks a failed start as `failed` rather than leaving it pending,
-- and this index is what lets an operator (and the retention sweep) find rows
-- that are pending far longer than any call could last.

create index if not exists call_recording_pending_idx
  on chat.call_recording (started_at)
  where status = 'pending';
