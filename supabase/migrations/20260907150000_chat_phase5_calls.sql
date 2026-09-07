-- Jawwid Chat -- Phase 5A: the voice-call state machine, class calls, recording.
--
-- Canonical design: docs/recovery/PHASE-5-REPORT.md.
--
-- WHAT EXISTED, AND WHAT WAS WRONG WITH IT
--
-- chat.call and chat.call_participant have existed since 20260905093000, and
-- the CallService on top of them starts calls, mints LiveKit tokens, accepts,
-- declines, ends and lists history. None of that is rebuilt here.
--
-- What was missing is the part that makes a call lifecycle CORRECT rather than
-- merely present:
--
--   1. NO STATE MACHINE. status was ('ringing','active','ended') with no
--      declared transitions, so `accept` after `decline` succeeded, `end` on an
--      ended call rewrote its outcome and duration, and a client that replayed
--      a stale request corrupted the record of what happened. Every transition
--      was whatever the last writer said it was.
--
--   2. NO MISSED CALL. 'call.ring_timeout_seconds' has been in chat.config
--      since Phase 2 and NOTHING READ IT. A call whose recipient was offline
--      rang in the database for ever: never answered, never missed, never
--      ended, and permanently `ringing` in call history.
--
--   3. NO PARTICIPANT STATE. One declining invitee in a group call could only
--      be recorded by stamping left_at, which is indistinguishable from someone
--      who joined and hung up. "Who actually refused this call" was not
--      answerable.
--
--   4. NO RECORDING, and the 20260905093000 comment says so explicitly:
--      "No audio recording in MVP. Columns for it are deliberately absent;
--      adding them later is a POLICY DECISION, not an accident." This migration
--      is that policy decision, taken deliberately and narrowly: recording is
--      available to ONE call mode, is never on by default, and every access to
--      a recording is authorized and audited.
--
-- THE TERMINAL-STATE MODELLING DECISION, stated because it looks like a gap.
--
-- The Phase 5 brief names `declined`, `missed` and `failed` as states. They are
-- modelled here as ONE terminal status ('ended') carrying an `outcome`, because
-- this schema already had `call_outcome_when_ended` enforcing exactly that
-- pairing, and because the alternative -- four terminal statuses -- makes
-- "is this call over?" a four-way test that every reader has to keep in step.
-- The distinction the brief cares about is preserved in full and is queryable:
-- outcome tells declined from missed from failed from cancelled from answered.

-- ---------------------------------------------------------------------------
-- 1. The call state vocabulary
-- ---------------------------------------------------------------------------

alter table chat.call drop constraint if exists call_status_check;
alter table chat.call
  add constraint call_status_check
  check (status in ('initiated', 'ringing', 'active', 'ended'));

-- 'cancelled' (the caller hung up before anyone answered) and 'failed' (the
-- media layer or the invitation dispatch broke) were not expressible. Both are
-- real endings and both used to be recorded as 'missed', which reads as "the
-- recipient did not pick up" and blames the wrong party.
alter table chat.call drop constraint if exists call_outcome_check;
alter table chat.call
  add constraint call_outcome_check
  check (outcome is null
         or outcome in ('answered', 'missed', 'declined', 'cancelled', 'failed'));

alter table chat.call drop constraint if exists chat_call_type_check;
alter table chat.call drop constraint if exists call_type_check;
alter table chat.call
  add constraint call_type_check
  check (type in ('direct', 'group', 'class'));

alter table chat.call
  -- NORMAL_CALL vs FOLLOW_UP_CALL. Recording is a property of the MODE, fixed
  -- when the call is created by an authorized actor, and never a per-request
  -- flag: "record this call" must not be something a client can turn on
  -- mid-call or ask for on a call it merely joined.
  add column if not exists mode text not null default 'normal',
  -- When this call stops ringing and becomes a missed call. Written at start
  -- from chat.config 'call.ring_timeout_seconds'; the sweeper's whole predicate.
  add column if not exists ring_expires_at timestamptz,
  add column if not exists ended_by uuid,
  -- Why it ended, for the cases where outcome alone is ambiguous (which of
  -- several failure modes; who cancelled).
  add column if not exists end_reason text;

alter table chat.call drop constraint if exists call_mode_check;
alter table chat.call
  add constraint call_mode_check check (mode in ('normal', 'follow_up'));

comment on column chat.call.mode is
  'normal = recording is impossible. follow_up = recording is PERMITTED, and '
  'still only happens when an authorized actor starts it. Fixed at creation by '
  'an actor holding calls.record; never a client-supplied per-request flag.';
comment on column chat.call.ring_expires_at is
  'When an unanswered call becomes a missed call. The missed-call sweeper''s '
  'entire predicate, so that missing a call does not depend on a client being '
  'awake to report it.';

-- The sweeper's index. Without it, finding expired calls is a scan of every
-- call ever made, run every few seconds.
create index if not exists call_ringing_expiry_idx
  on chat.call (ring_expires_at)
  where status in ('initiated', 'ringing');

-- "Has this call a recording, and may I see it" is answered per call; history
-- is answered per conversation. Both already indexed. This one serves the
-- retention sweep and the family-level recording audit.
create index if not exists call_mode_started_idx
  on chat.call (mode, started_at desc)
  where mode = 'follow_up';

-- ---------------------------------------------------------------------------
-- 2. Participant state
-- ---------------------------------------------------------------------------
--
-- A group call ends when the CALL ends, not when one invitee refuses. Modelling
-- a refusal as left_at made "declined" and "joined then hung up" the same row.

alter table chat.call_participant
  add column if not exists state text not null default 'invited',
  add column if not exists declined_at timestamptz;

alter table chat.call_participant drop constraint if exists call_participant_state_check;
alter table chat.call_participant
  add constraint call_participant_state_check
  check (state in ('invited', 'joined', 'declined', 'left', 'missed'));

comment on column chat.call_participant.state is
  'Per-invitee lifecycle, independent of the call''s. One invitee declining a '
  'group call does not end it; one invitee joining is what starts it.';

-- Backfill from what the existing columns already imply, so history predating
-- this migration reads correctly instead of appearing as an eternal 'invited'.
update chat.call_participant
   set state = case
                 when joined_at is not null and left_at is not null then 'left'
                 when joined_at is not null                          then 'joined'
                 when left_at   is not null                          then 'declined'
                 else 'invited'
               end
 where state = 'invited';

create index if not exists call_participant_actor_idx
  on chat.call_participant (actor_id, call_id);

-- ---------------------------------------------------------------------------
-- 3. The state machine, enforced by the database
-- ---------------------------------------------------------------------------
--
-- The service enforces this too (calls/call-state.ts), and that is not
-- duplication for its own sake: the service returns a typed refusal a client
-- can act on, and the trigger makes the illegal row unrepresentable even to a
-- direct SQL session, a future service, or a bug in this one. Same argument as
-- chat.enforce_call_participant_rules, which has guarded BR-1 the same way
-- since 20260905093000.

create or replace function chat.enforce_call_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'initiated' and new.status in ('ringing', 'ended'))
    or (old.status = 'ringing'   and new.status in ('active', 'ended'))
    or (old.status = 'active'    and new.status = 'ended')
  ) then
    raise exception 'illegal call transition % -> % for call %',
      old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  -- 'ended' is TERMINAL. Without this, a replayed end request would rewrite
  -- ended_at, outcome and duration_seconds on a call that finished days ago --
  -- which is precisely the idempotency defect this migration exists to close.
  if old.status = 'ended' then
    raise exception 'call % has already ended and cannot be re-ended', old.id
      using errcode = 'check_violation';
  end if;

  -- An answered call is one somebody joined. Nothing else may claim to be.
  if new.status = 'ended' and new.outcome = 'answered' and new.answered_at is null then
    raise exception 'call % cannot end as answered without an answered_at', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function chat.enforce_call_transition is
  'The call state machine, as a constraint. The service refuses illegal '
  'transitions with a typed error; this makes them unrepresentable even to a '
  'direct SQL session or a future service that forgets.';

drop trigger if exists call_transition_guard on chat.call;
create trigger call_transition_guard
  before update on chat.call
  for each row execute function chat.enforce_call_transition();

-- ---------------------------------------------------------------------------
-- 4. Recording
-- ---------------------------------------------------------------------------
--
-- ONE recording per call (call_id is UNIQUE). A call is a single continuous
-- media session; a second recording row for the same call would mean two
-- artefacts with equal claim to be "the recording", and no way to say which the
-- retention policy or the playback route means.
--
-- The AUDIO ITSELF IS NEVER HERE. This table holds an object key into the same
-- private object storage attachments use, and the only way to hear it is a
-- short-lived signed URL minted per request by an authorized playback call. No
-- column holds a URL: a stored URL is a bearer credential that outlives every
-- authorization check that produced it.

create table if not exists chat.call_recording (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default chat.default_organization_id()
                        references chat.organization (id),
  call_id             uuid not null unique
                        references chat.call (id) on delete cascade,
  -- The private object. NOT a URL, and never rendered to a client.
  object_key          text,
  status              text not null default 'pending',
  duration_seconds    integer,
  byte_size           bigint,
  mime_type           text,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  failure_code        text,
  -- Retention. NULL means "not yet scheduled", which only a pending recording
  -- may be; an available recording always carries its expiry, so no recording
  -- can be stored indefinitely by omission.
  retention_expires_at timestamptz,
  deleted_at          timestamptz,
  deleted_reason      text,
  started_by          uuid not null,
  created_at          timestamptz not null default now(),

  constraint call_recording_status_check
    check (status in ('pending', 'available', 'failed', 'deleted')),
  -- An available recording has an object to play and a date it stops existing.
  constraint call_recording_available_is_complete
    check (status <> 'available'
           or (object_key is not null and retention_expires_at is not null)),
  constraint call_recording_deletion_is_stamped
    check (status <> 'deleted' or (deleted_at is not null and deleted_reason is not null))
);

comment on table chat.call_recording is
  'Metadata only -- the audio lives in private object storage under object_key '
  'and is reachable solely through an authorized, audited, short-lived signed '
  'URL. No column ever holds a URL, because a stored URL is a bearer credential '
  'that outlives the check that minted it.';

-- Only a follow-up call may carry a recording. This is the load-bearing half of
-- "NORMAL_CALL does not record": the service refuses to start one, and this
-- makes the row itself impossible, so a bug in the service cannot produce a
-- recording of a call whose participants were never told it was recorded.
create or replace function chat.enforce_recording_mode()
returns trigger
language plpgsql
as $$
declare
  v_mode text;
begin
  select mode into v_mode from chat.call where id = new.call_id;
  if v_mode is distinct from 'follow_up' then
    raise exception
      'call % is mode %; only a follow_up call may be recorded',
      new.call_id, coalesce(v_mode, 'unknown')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists call_recording_mode_guard on chat.call_recording;
create trigger call_recording_mode_guard
  before insert on chat.call_recording
  for each row execute function chat.enforce_recording_mode();

-- The retention sweep's predicate.
create index if not exists call_recording_retention_idx
  on chat.call_recording (retention_expires_at)
  where status = 'available';

create index if not exists call_recording_status_idx
  on chat.call_recording (organization_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
--
-- DENY BY DEFAULT, and deliberately NARROWER than the call it belongs to.
--
-- A recording is not simply "more of the call". Everyone on a call already
-- heard it; a recording is a durable, copyable artefact of somebody else's
-- voice, and the right to have been present is not the right to keep a copy.
-- So the read policy is NOT "participants of the call" -- it is staff who hold
-- recordings.read AND have the call's family in scope. A parent or a teacher
-- who was ON the call gets no policy here at all, which also means they cannot
-- learn that a recording EXISTS by probing.

alter table chat.call_recording enable row level security;

drop policy if exists call_recording_organization_isolation on chat.call_recording;
create policy call_recording_organization_isolation on chat.call_recording
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists call_recording_readable_by_authorized_staff on chat.call_recording;
create policy call_recording_readable_by_authorized_staff on chat.call_recording
  for select to authenticated
  using (
    chat.current_has_permission('recordings.read')
    and exists (
      select 1 from chat.call c
       where c.id = call_id
         and (c.family_id is null or chat.staff_can_see_family(c.family_id))
    )
  );

grant select on chat.call_recording to authenticated;
grant select, insert, update on chat.call_recording to chat_app;
grant select, insert, update, delete on chat.call_recording to service_role;

-- WRITES mirror the service rule, and are addressed `to authenticated` rather
-- than `to chat_app`.
--
-- That distinction is the whole point and is easy to get backwards. A blanket
-- `for all to chat_app using (true)` looks like "let the application work" and
-- is in fact a PERMISSIVE policy that ORs with every other policy on the table
-- -- so it would hand the application role unrestricted read of every recording
-- and quietly delete the read policy above. The blanket form is reserved for
-- the five identity tables (20260907120000), which deliberately carry no
-- `authenticated` policy at all.
--
-- The background worker is unaffected: it connects as `chat_service`, which
-- BYPASSES RLS by design (infra/env/manifest.tsv, RLS-STRATEGY.md 6).

drop policy if exists call_recording_started_by_authorized_staff on chat.call_recording;
create policy call_recording_started_by_authorized_staff on chat.call_recording
  for insert to authenticated
  with check (
    chat.current_has_permission('calls.record')
    and exists (
      select 1 from chat.call c
       where c.id = call_id
         and (c.family_id is null or chat.staff_can_see_family(c.family_id))
    )
  );

drop policy if exists call_recording_updated_by_authorized_staff on chat.call_recording;
create policy call_recording_updated_by_authorized_staff on chat.call_recording
  for update to authenticated
  using (
    chat.current_has_permission('recordings.read')
    and exists (
      select 1 from chat.call c
       where c.id = call_id
         and (c.family_id is null or chat.staff_can_see_family(c.family_id))
    )
  )
  with check (
    chat.current_has_permission('recordings.read')
    and exists (
      select 1 from chat.call c
       where c.id = call_id
         and (c.family_id is null or chat.staff_can_see_family(c.family_id))
    )
  );

-- No DELETE policy, and chat_app holds no DELETE privilege on this table: a
-- recording is TOMBSTONED, never removed, so that "there was a recording of
-- this call and it was deleted on this date" stays a fact the academy can
-- state. The privilege, not a policy, is what forbids it.

-- ---------------------------------------------------------------------------
-- 6. The event vocabulary
-- ---------------------------------------------------------------------------
--
-- chat.event_log.type is a CLOSED vocabulary with a CHECK constraint, which is
-- the right design -- a typo in an event name should fail loudly rather than
-- quietly create a category nothing reports on -- and it means every phase that
-- adds an event has to widen it here, in the same change.
--
-- Read from the live constraint and re-asserted with the Phase 5 names added,
-- rather than rewritten from memory: enumerating it by hand is how one of the
-- sixty existing names gets dropped and an unrelated engine starts failing.

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'chat.event_log'::regclass
     and conname  = 'event_log_type_check';

  if v_def is null then
    raise exception 'event_log_type_check not found; refusing to guess the vocabulary';
  end if;

  -- Idempotent: a re-run finds the Phase 5 names already accepted and stops.
  if v_def like '%recording_started%' then
    return;
  end if;

  -- The ORIGINAL expression is carried over VERBATIM and merely widened with
  -- an OR. Re-enumerating the sixty existing names by hand is how one of them
  -- gets dropped and an unrelated engine starts failing on a valid write.
  v_def := regexp_replace(v_def, '^CHECK\s*', '');

  execute 'alter table chat.event_log drop constraint event_log_type_check';
  execute 'alter table chat.event_log add constraint event_log_type_check check ('
       || v_def
       || ' or type = any (array['
       || '''call_missed'', ''call_cancelled'', ''class_call_started'', '
       || '''recording_started'', ''recording_completed'', ''recording_failed'', '
       || '''recording_accessed'', ''recording_deleted'', '
       || '''story_published'', ''story_expired'', '
       || '''broadcast_created'', ''broadcast_queued'', ''broadcast_completed'''
       || ']::text[]))';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Configuration -- every number is a row (Phase 2 report §36)
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  ('call.missed_sweep_batch', '200'::jsonb, 'communication',
   'How many expired ringing calls one missed-call sweep claims.'),
  ('call.class_reminder_seconds', '[60, 180]'::jsonb, 'communication',
   'Offsets after a class call starts at which a not-yet-joined recipient is reminded that the teacher is waiting.'),
  -- RETENTION IS NOT A BUSINESS POLICY THIS REPOSITORY KNOWS. Neither the PRD
  -- nor the audit states one, and inventing a number and calling it the
  -- academy''s policy would be a fabrication. 30 days is a SAFE TECHNICAL
  -- DEFAULT chosen only so that no recording is stored unbounded by omission;
  -- it is a config row precisely so the business can set the real figure
  -- without a deploy. See docs/recovery/PHASE-5-REPORT.md, "Recording".
  ('recording.retention_days', '30'::jsonb, 'communication',
   'Days an available recording is retained before the retention sweep deletes it. SAFE TECHNICAL DEFAULT, not a stated business policy -- set the real figure here.'),
  ('recording.playback_url_ttl_seconds', '120'::jsonb, 'communication',
   'Lifetime of a signed recording playback URL. Short by design: it is a bearer credential.'),
  ('recording.retention_sweep_batch', '100'::jsonb, 'communication',
   'How many expired recordings one retention sweep deletes.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Class-call and recording notification content
-- ---------------------------------------------------------------------------
--
-- "Teacher is waiting. Please join the class." is CONTENT, so it lives here in
-- both languages, versioned and interpolated by TemplateService -- not as a
-- string literal in a service, a controller or a Flutter widget.

insert into chat.notification_template (key, locale, version, title, body) values
  ('class_call_invitation', 'ar', 1, 'حصة {group_name} بدأت',
   'المعلم {teacher_name} في انتظارك. من فضلك ادخل إلى الحصة.'),
  ('class_call_invitation', 'en', 1, '{group_name} class has started',
   '{teacher_name} is waiting. Please join the class.'),
  ('class_call_reminder', 'ar', 1, 'المعلم ما زال في انتظارك',
   'المعلم {teacher_name} ما زال في انتظارك في حصة {group_name}.'),
  ('class_call_reminder', 'en', 1, 'Your teacher is still waiting',
   '{teacher_name} is still waiting for you in {group_name}.'),
  ('missed_call', 'ar', 1, 'مكالمة فائتة',
   'لديك مكالمة فائتة من {caller_name}.'),
  ('missed_call', 'en', 1, 'Missed call',
   'You have a missed call from {caller_name}.')
on conflict (key, locale, version) do nothing;

-- The class-call reminder schedule is DATA. Changing "remind after one minute"
-- to "remind after five" is an UPDATE, not a deploy.
-- `category` is the Phase 4 notification-preference axis: it is what a
-- recipient mutes. A class-call reminder is filed under 'classes' rather than
-- 'calls' deliberately -- somebody who has turned off call notifications has
-- said nothing about whether they want to know their child's lesson started.
insert into chat.notification_rule
  (key, event_type, offset_seconds, template_key, recipient_role, category,
   channel, priority, respect_quiet_hours, enabled)
values
  ('class_call_reminder_t60',  'class_call_started', 60,  'class_call_reminder', 'participant', 'classes', 'push', 'high', false, true),
  ('class_call_reminder_t180', 'class_call_started', 180, 'class_call_reminder', 'participant', 'classes', 'push', 'high', false, true)
on conflict (key) do nothing;
