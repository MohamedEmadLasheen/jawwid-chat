-- Jawwid Chat -- the class-session projection, and the attendance it carries.
--
-- AUTHORITY, settled and not re-litigated here.
-- docs/architecture/core-integration-contract.md is marked "Status:
-- authoritative", and its section 8 says: "Class session / schedule --
-- AUTHORITATIVE IN CORE, mirrored in chat.class_session". These two tables are
-- that mirror. Jawwid Chat does not own a class; it holds a projection of one
-- so that reminders, attendance and notifications have something stable to
-- point at.
--
-- WHY THIS EXISTS AT ALL. Until now the only class-shaped thing in this
-- product was chat.learner.next_class_at: a single, mutable scalar. It cannot
-- identify a class that already happened, so attendance had nothing to attach
-- to and a reminder had no occurrence to belong to. core_class_session_id is
-- that identity, and it comes from Core.
--
-- next_class_at IS DELIBERATELY LEFT ALONE. It is not deleted, not renamed and
-- not reinterpreted: the attention engine, the admin family panel and the
-- existing reschedule path all read it. A later, explicit migration decides its
-- future. Nothing here fabricates a class_session row from it -- there is no
-- Core identity to invent one with, and inventing one would put a made-up
-- core_class_session_id into a table whose whole purpose is to carry Core's.

-- ---------------------------------------------------------------------------
-- chat.class_session -- one occurrence, as Core describes it
-- ---------------------------------------------------------------------------
-- The columns are exactly the contract's class_session.upserted payload
-- (section 4), plus the bookkeeping every mirror needs. Nothing is added that
-- Core does not send: a column this boundary invents is a column that can
-- disagree with Core.

create table if not exists chat.class_session (
  organization_id       uuid not null default chat.default_organization_id(),
  id                    uuid primary key default gen_random_uuid(),

  -- THE STABLE OCCURRENCE IDENTITY. Unique, so a redelivered event updates in
  -- place; this is the entity-level half of the contract's two-layer duplicate
  -- handling (section 6).
  core_class_session_id uuid not null unique,

  learner_id            uuid not null references chat.learner (id) on delete cascade,
  -- Nullable in the payload, so nullable here. A session Core has not yet
  -- assigned a teacher to is a real state, not a malformed event.
  teacher_id            uuid references chat.teacher (id) on delete set null,

  starts_at             timestamptz not null,
  ends_at               timestamptz,
  -- Stored opaquely and rendered nowhere. PRD 15.2 open question 8 (link
  -- format, and whether links must be masked) is still open, and the
  -- integration contract says so explicitly.
  join_url              text,

  status                text not null default 'scheduled'
                        check (status in ('scheduled', 'done', 'cancelled', 'rescheduled')),

  -- ORDERING (contract section 5). The occurred_at of the event that last wrote
  -- this row. Webhook delivery is not ordered and Chat does not assume it is:
  -- an event older than this value is acknowledged and dropped, an equal one
  -- applies so a corrected redelivery still lands. Last-writer-wins by SOURCE
  -- time, decided in the database, so two boundary processes racing reach the
  -- same result.
  core_synced_at        timestamptz not null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint class_session_ends_after_start
    check (ends_at is null or ends_at > starts_at)
);

comment on table chat.class_session is
  'Projection of a Jawwid Core class session. Core is authoritative (integration '
  'contract section 8); Chat holds this so attendance, reminders and '
  'notifications have a stable occurrence identity to reference. Never written '
  'by a client -- see the grants below.';

comment on column chat.class_session.core_class_session_id is
  'The occurrence identity. Everything that refers to "this class" refers to '
  'this, never to chat.learner.next_class_at, which is a mutable scalar that '
  'cannot name a class that already happened.';

-- Reminders sweep forward over scheduled sessions; partial, because a done or
-- cancelled session is never a reminder candidate and there are eventually far
-- more of those than of live ones.
create index if not exists class_session_upcoming_idx
  on chat.class_session (starts_at)
  where status = 'scheduled';

create index if not exists class_session_learner_idx
  on chat.class_session (learner_id, starts_at desc);

drop trigger if exists class_session_set_updated_at on chat.class_session;
create trigger class_session_set_updated_at
  before update on chat.class_session
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat.class_attendance -- what happened at one occurrence
-- ---------------------------------------------------------------------------
-- BINARY, on purpose. chat.event_log's type constraint has carried
-- 'class_attended' and 'class_missed' since 20260905090500, and nothing in this
-- repository has ever used present/absent/late/excused. Inventing a richer
-- vocabulary here would mean inventing a product requirement, so the existing
-- one is used as-is. A Core value that maps to neither is refused, loudly,
-- rather than coerced into the nearest-looking one.

create table if not exists chat.class_attendance (
  organization_id  uuid not null default chat.default_organization_id(),
  id               uuid primary key default gen_random_uuid(),

  -- Attendance BELONGS TO AN OCCURRENCE. Not to a learner and a date, and not
  -- to next_class_at: those cannot say which class, and a class that moved
  -- would silently relabel history.
  class_session_id uuid not null references chat.class_session (id) on delete cascade,
  learner_id       uuid not null references chat.learner (id) on delete cascade,

  outcome          text not null check (outcome in ('class_attended', 'class_missed')),

  -- When the outcome was determined, as Core reports it. Distinct from
  -- core_synced_at, which is when the EVENT describing it was emitted.
  recorded_at      timestamptz,
  core_synced_at   timestamptz not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One outcome per learner per occurrence. A corrected redelivery updates this
  -- row; it never adds a second, contradictory one.
  constraint class_attendance_one_per_occurrence unique (class_session_id, learner_id)
);

comment on table chat.class_attendance is
  'Projection of a Core attendance outcome for one class occurrence. Core is '
  'authoritative: nothing in Jawwid Chat records attendance, and no client may '
  'write this table. The vocabulary is chat.event_log''s existing '
  'class_attended / class_missed.';

create index if not exists class_attendance_learner_idx
  on chat.class_attendance (learner_id, created_at desc);

drop trigger if exists class_attendance_set_updated_at on chat.class_attendance;
create trigger class_attendance_set_updated_at
  before update on chat.class_attendance
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ingestion -- the entity layer, following chat.ingest_core_learner
-- ---------------------------------------------------------------------------
-- Same shape as the ingest functions that already exist: a flat jsonb payload
-- in, an upsert on the Core id, a missing dependency returned rather than
-- raised. Two departures, both deliberate:
--
--   * they take p_occurred_at, because the contract's ordering rule (section 5)
--     needs the envelope's time and the payload does not carry it;
--   * they return jsonb rather than uuid, because the caller has to distinguish
--     "applied" from "stale" from "not applicable" in order to decide whether a
--     domain event is owed. A uuid cannot say which of the three happened.
--
-- The caller enqueues the outbox event in the SAME transaction as the call, so
-- the projection and the event it justifies commit together or not at all.

create or replace function chat.ingest_core_class_session(
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_core_session uuid := (p_payload ->> 'core_class_session_id')::uuid;
  v_core_child   uuid := (p_payload ->> 'core_child_id')::uuid;
  v_core_teacher uuid := (p_payload ->> 'core_teacher_id')::uuid;
  v_starts_at    timestamptz := (p_payload ->> 'starts_at')::timestamptz;
  v_ends_at      timestamptz := (p_payload ->> 'ends_at')::timestamptz;
  v_status       text := coalesce(p_payload ->> 'status', 'scheduled');
  v_learner_id   uuid;
  v_teacher_id   uuid;
  v_existing     chat.class_session;
  v_row          chat.class_session;
begin
  -- Malformed. Retrying cannot help, so this is a 400 at the boundary, not a
  -- 500 (contract section 6).
  if v_core_session is null then
    raise exception 'core_class_session_id is required' using errcode = 'check_violation';
  end if;
  if v_starts_at is null then
    raise exception 'starts_at is required' using errcode = 'check_violation';
  end if;
  if v_status not in ('scheduled', 'done', 'cancelled', 'rescheduled') then
    raise exception 'unknown class session status: %', v_status using errcode = 'check_violation';
  end if;
  if p_occurred_at is null then
    raise exception 'occurred_at is required for ordering' using errcode = 'check_violation';
  end if;

  select id into v_learner_id from chat.learner where core_child_id = v_core_child;
  if v_learner_id is null then
    -- not_applicable, exactly as the learner ingest does for a family with no
    -- owner yet: the session arrives with its student, or on the next backfill.
    return jsonb_build_object('outcome', 'not_applicable', 'reason', 'unknown_learner');
  end if;

  if v_core_teacher is not null then
    select id into v_teacher_id from chat.teacher where id = v_core_teacher;
    -- A teacher Chat has not mirrored yet is not a reason to drop the class.
    -- The session is real and the parent still needs the reminder.
  end if;

  select * into v_existing from chat.class_session
   where core_class_session_id = v_core_session;

  if found and v_existing.core_synced_at > p_occurred_at then
    -- Out of order. Acknowledged and dropped: a newer write already won, and
    -- replaying an older one would regress the row.
    return jsonb_build_object('outcome', 'stale', 'class_session_id', v_existing.id);
  end if;

  insert into chat.class_session (core_class_session_id, learner_id, teacher_id,
                                  starts_at, ends_at, join_url, status, core_synced_at)
  values (v_core_session, v_learner_id, v_teacher_id, v_starts_at, v_ends_at,
          p_payload ->> 'join_url', v_status, p_occurred_at)
  on conflict (core_class_session_id) do update
    set learner_id     = excluded.learner_id,
        teacher_id     = excluded.teacher_id,
        starts_at      = excluded.starts_at,
        ends_at        = excluded.ends_at,
        join_url       = coalesce(excluded.join_url, chat.class_session.join_url),
        status         = excluded.status,
        core_synced_at = excluded.core_synced_at
  returning * into v_row;

  return jsonb_build_object(
    'outcome',           'applied',
    'class_session_id',  v_row.id,
    'learner_id',        v_row.learner_id,
    'status',            v_row.status,
    'starts_at',         v_row.starts_at,
    -- The caller compares these to decide whether the time actually moved.
    'previous_status',   case when v_existing.id is null then null else v_existing.status end,
    'previous_starts_at',case when v_existing.id is null then null else v_existing.starts_at end
  );
end;
$$;

comment on function chat.ingest_core_class_session(jsonb, timestamptz) is
  'Applies class_session.upserted. Idempotent on core_class_session_id, ordered '
  'by the envelope''s occurred_at, and not_applicable when the learner has not '
  'been mirrored yet.';

-- ---------------------------------------------------------------------------

create or replace function chat.cancel_core_class_session(
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_core_session uuid := (p_payload ->> 'core_class_session_id')::uuid;
  v_existing     chat.class_session;
begin
  if v_core_session is null then
    raise exception 'core_class_session_id is required' using errcode = 'check_violation';
  end if;
  if p_occurred_at is null then
    raise exception 'occurred_at is required for ordering' using errcode = 'check_violation';
  end if;

  select * into v_existing from chat.class_session
   where core_class_session_id = v_core_session;

  if not found then
    -- "A deactivation that matches nothing returns not_applicable. Core may be
    -- describing an entity Chat never mirrored, which is not an error."
    return jsonb_build_object('outcome', 'not_applicable', 'reason', 'unknown_class_session');
  end if;

  if v_existing.core_synced_at > p_occurred_at then
    return jsonb_build_object('outcome', 'stale', 'class_session_id', v_existing.id);
  end if;

  -- NOTHING IS EVER DELETED (BR-5, contract section 12): the row is retained
  -- with status = 'cancelled' so history stays addressable and any attendance
  -- already recorded against it keeps its occurrence.
  update chat.class_session
     set status = 'cancelled', core_synced_at = p_occurred_at
   where id = v_existing.id;

  return jsonb_build_object(
    'outcome',          'applied',
    'class_session_id', v_existing.id,
    'learner_id',       v_existing.learner_id,
    'status',           'cancelled',
    'starts_at',        v_existing.starts_at,
    'previous_status',  v_existing.status
  );
end;
$$;

-- ---------------------------------------------------------------------------

create or replace function chat.ingest_core_attendance(
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_core_session uuid := (p_payload ->> 'core_class_session_id')::uuid;
  v_outcome      text := p_payload ->> 'outcome';
  v_session      chat.class_session;
  v_existing     chat.class_attendance;
  v_row          chat.class_attendance;
begin
  if v_core_session is null then
    raise exception 'core_class_session_id is required' using errcode = 'check_violation';
  end if;
  if p_occurred_at is null then
    raise exception 'occurred_at is required for ordering' using errcode = 'check_violation';
  end if;

  -- REFUSED, NOT COERCED. The repository's vocabulary is binary. A Core value
  -- that is neither is a boundary disagreement that a human has to resolve;
  -- guessing which of the two it "probably" means would write a fact nobody
  -- asserted.
  if v_outcome is null or v_outcome not in ('class_attended', 'class_missed') then
    raise exception 'unmappable attendance outcome: %', coalesce(v_outcome, 'null')
      using errcode = 'check_violation';
  end if;

  select * into v_session from chat.class_session
   where core_class_session_id = v_core_session;

  if not found then
    -- NO ORPHANS. Attendance for an occurrence Chat has not mirrored is held
    -- back rather than invented: the contract's not_applicable, which Core
    -- stops retrying on and the next backfill resolves.
    return jsonb_build_object('outcome', 'not_applicable', 'reason', 'unknown_class_session');
  end if;

  select * into v_existing from chat.class_attendance
   where class_session_id = v_session.id and learner_id = v_session.learner_id;

  if found and v_existing.core_synced_at > p_occurred_at then
    return jsonb_build_object('outcome', 'stale', 'attendance_id', v_existing.id);
  end if;

  insert into chat.class_attendance (class_session_id, learner_id, outcome,
                                     recorded_at, core_synced_at)
  values (v_session.id, v_session.learner_id, v_outcome,
          (p_payload ->> 'recorded_at')::timestamptz, p_occurred_at)
  on conflict (class_session_id, learner_id) do update
    set outcome        = excluded.outcome,
        recorded_at    = coalesce(excluded.recorded_at, chat.class_attendance.recorded_at),
        core_synced_at = excluded.core_synced_at
  returning * into v_row;

  return jsonb_build_object(
    'outcome',           'applied',
    'attendance_id',     v_row.id,
    'class_session_id',  v_session.id,
    'learner_id',        v_row.learner_id,
    'attendance',        v_row.outcome,
    'starts_at',         v_session.starts_at,
    -- Null on a first delivery. The caller uses it to avoid re-notifying when a
    -- redelivery says exactly what the row already said.
    'previous_attendance', case when v_existing.id is null then null else v_existing.outcome end
  );
end;
$$;

comment on function chat.ingest_core_attendance(jsonb, timestamptz) is
  'Applies an attendance outcome against an already-mirrored class session. '
  'Refuses a value outside chat.event_log''s class_attended / class_missed '
  'rather than coercing it, and never creates an orphan.';

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------
-- The model is 20260905091200's, unchanged: staff reach rows narrowed by
-- policy, a family contact reaches only their own family's, and service_role is
-- NOLOGIN BYPASSRLS so the boundary and the worker act for the system.
--
-- THE GRANT IS THE SECURITY BOUNDARY HERE, more than the policies are. Both
-- tables hold Core-authoritative facts, so `authenticated` gets SELECT and
-- nothing else: there is no insert, update or delete for a client to reach,
-- which means no client can fabricate a class that never existed or an
-- attendance nobody recorded. Ingestion runs as service_role through the
-- functions above. No bypass shortcut was added to make that work.

alter table chat.class_session    enable row level security;
alter table chat.class_attendance enable row level security;

-- ---------------------------------------------------------------------------
-- Who may see a learner's classes
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, for the same reason chat.current_actor_id() is: the answer
-- depends on chat.learner and chat.contact, and both carry staff-only policies.
-- A policy that read them as the CALLER would evaluate to false for every
-- parent -- which is not "secure", it is broken, and the kind of broken that
-- looks like working security until someone checks that the right people can
-- still see their own data.
--
-- It answers one question and exposes nothing else: may this actor see this
-- learner. The three arms are the three kinds of actor the product has.

create or replace function chat.actor_may_see_learner(p_learner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.learner l
     where l.id = p_learner_id
       and (
         -- Staff, narrowed by the same visibility rule chat.learner itself uses.
         chat.staff_can_see_family(l.family_id)
         -- A contact of the learner's FAMILY. Holding the learner id is not
         -- enough; the family has to match.
         or exists (
           select 1 from chat.contact c
            where c.id = chat.current_actor_id()
              and c.family_id = l.family_id
              and c.is_active
         )
         -- The learner's own teacher, and no other.
         or l.teacher_id = chat.current_actor_id()
       )
  )
$$;

comment on function chat.actor_may_see_learner(uuid) is
  'May the current actor see this learner: their family''s contacts, their own '
  'teacher, or staff the family is visible to. SECURITY DEFINER because the '
  'tables it reads carry staff-only policies of their own.';

revoke all on function chat.actor_may_see_learner(uuid) from public;
grant execute on function chat.actor_may_see_learner(uuid) to authenticated, service_role;

drop policy if exists class_session_visible_to_staff on chat.class_session;
drop policy if exists class_session_visible_to_family on chat.class_session;
drop policy if exists class_attendance_visible_to_staff on chat.class_attendance;
drop policy if exists class_attendance_visible_to_family on chat.class_attendance;

create policy class_session_readable on chat.class_session
  for select to authenticated
  using (chat.actor_may_see_learner(learner_id));

create policy class_attendance_readable on chat.class_attendance
  for select to authenticated
  using (chat.actor_may_see_learner(learner_id));

-- SELECT and nothing else. Both tables hold Core-authoritative facts, so there
-- is no insert, update or delete for any client -- parent or staff -- to reach:
-- nobody with a session can fabricate a class that never existed or an
-- attendance nobody recorded. Ingestion runs as service_role through the
-- functions above, which is the established trusted path, not a bypass added
-- to make this work.
grant select on chat.class_session, chat.class_attendance to authenticated;

-- The ingest functions are the boundary's, not a client's.
revoke all on function chat.ingest_core_class_session(jsonb, timestamptz) from public;
revoke all on function chat.cancel_core_class_session(jsonb, timestamptz) from public;
revoke all on function chat.ingest_core_attendance(jsonb, timestamptz) from public;
grant execute on function chat.ingest_core_class_session(jsonb, timestamptz) to service_role;
grant execute on function chat.cancel_core_class_session(jsonb, timestamptz) to service_role;
grant execute on function chat.ingest_core_attendance(jsonb, timestamptz) to service_role;
