-- PD-53 / CHATSCHED-013 (owner-approved 2026-10-31): a call that drops is given 60 s
-- to come back, then ends as `connection_lost`; its duration is connected time.
--
-- Owner's requirements, and where each lives:
--   1, 3  wait 60 s, then end      call.interrupted_at + the worker's sweep
--                                  (CallService.endInterruptedCalls), the
--                                  grace in chat.config call.reconnect_grace_seconds
--   2     rejoin within the grace  a media join that brings the call back to
--                                  two connected clears interrupted_at
--   4     tell the other side      call.ended carries end_reason; 1:1 calls
--                                  also get the `call_connection_lost` push
--   5     connected time only      call.connected_since / connected_seconds,
--                                  moved by media presence; duration_seconds
--                                  is their sum at the end
--   6     a drop is not a hang-up  call.end_reason
--
-- Additive. The backfill only labels rows that are already ended, from their
-- own outcome; nothing about a call's history changes. Rollback:
-- db/rollback/20261031160000_pd053_call_connection_grace.down.sql
--
-- Idempotent (G-19).

alter table chat.call
  add column if not exists end_reason        text,
  add column if not exists interrupted_at    timestamptz,
  add column if not exists connected_since   timestamptz,
  add column if not exists connected_seconds integer not null default 0,
  add column if not exists was_connected     boolean not null default false;

-- A departure older than the participant's latest join is history, not a drop:
-- LiveKit's webhooks can arrive out of order, and a stale `left` must not
-- interrupt a call the participant has already rejoined.
alter table chat.call_participant
  add column if not exists media_last_joined_at timestamptz;

alter table chat.call drop constraint if exists call_end_reason_valid;
alter table chat.call add constraint call_end_reason_valid
  check (end_reason is null or end_reason in ('hung_up', 'declined', 'ring_timeout', 'connection_lost'));

alter table chat.call drop constraint if exists call_connected_seconds_nonnegative;
alter table chat.call add constraint call_connected_seconds_nonnegative
  check (connected_seconds >= 0);

comment on column chat.call.end_reason is
  'Why the call ended: hung_up (a participant ended it), declined, ring_timeout '
  '(nobody answered), connection_lost (dropped and not back within the grace). '
  'NULL only while the call is live.';
comment on column chat.call.interrupted_at is
  'When an ACTIVE call fell below two connected participants by an unexpected '
  'media departure. The sweep ends it once this is older than the grace; a '
  'rejoin clears it.';
comment on column chat.call.connected_since is
  'Start of the current span with two or more participants in the media room.';
comment on column chat.call.connected_seconds is
  'Connected time of the closed spans. duration_seconds at the end is this plus '
  'any open span: a disconnection is not counted.';
comment on column chat.call.was_connected is
  'The call ever had two or more participants in the media room. Its duration is '
  'then connected time, even when that rounds to 0 s.';
comment on column chat.call_participant.media_last_joined_at is
  'The LATEST media join reported for this participant. A media departure older '
  'than it is ignored: they already came back.';

-- Ended calls get the reason their outcome already implies.
update chat.call
   set end_reason = case outcome
                      when 'declined' then 'declined'
                      when 'missed'   then 'ring_timeout'
                      else 'hung_up'
                    end
 where status = 'ended' and end_reason is null;

-- The backfill fires chat.call's deferred triggers; run them now, inside this
-- migration's transaction (scripts/db/apply.sh wraps each file in one), or the
-- index below fails with "pending trigger events" on any database that already
-- holds ended calls -- production -- while a fresh one passes.
set constraints all immediate;

-- The sweep's lookup: few rows, only live interrupted calls.
create index if not exists call_interrupted_idx
  on chat.call (interrupted_at)
  where status = 'active' and interrupted_at is not null;

insert into chat.config (key, value, scope, description) values
  ('call.reconnect_grace_seconds', '60'::jsonb, 'communication',
   'CHATSCHED-013: how long a dropped call waits for a participant to come back before it ends as connection_lost.')
on conflict (key) do nothing;

-- Requirement 4 on a phone in the background (1:1 calls). No name: push
-- privacy (2026-10-14) keeps every call push generic.
insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('call_connection_lost', 'en', 'Call ended', 'Your call ended because the connection was lost.'),
    ('call_connection_lost', 'ar', 'انتهت المكالمة', 'انتهت مكالمتك بسبب انقطاع الاتصال.'),
    ('inbox.call_connection_lost', 'en', 'Call ended', 'A call ended because the connection was lost.'),
    ('inbox.call_connection_lost', 'ar', 'انتهت المكالمة', 'انتهت مكالمة بسبب انقطاع الاتصال.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);

-- `recipient_role = 'participant'`: both people are told (OutboxWorker
-- .notifyConnectionLost schedules one per participant through scheduleByRule,
-- which does not read the role), and 'participant' says so. offset 0: not a
-- reminder schedule.
insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, channel, priority, respect_quiet_hours) values
  ('call_connection_lost', 'call_connection_lost', 0, 'call_connection_lost', 'participant', 'push', 'high', true)
on conflict (key) do nothing;
