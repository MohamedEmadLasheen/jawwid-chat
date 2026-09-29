-- ---------------------------------------------------------------------------
-- Core -> Chat ordering becomes ATOMIC.
--
-- THE DEFECT
--
-- All three Core-sync functions decided ordering in a NON-LOCKING SELECT and
-- then wrote unconditionally:
--
--     select * into v_existing ... ;                       -- no FOR UPDATE
--     if v_existing.core_synced_at > p_occurred_at then return 'stale'; end if;
--     insert ... on conflict do update set ...             -- no WHERE
--
-- Under READ COMMITTED (Prisma's default, and this project's) two concurrent
-- deliveries for one occurrence both read the same pre-image, neither sees the
-- other, and both proceed. `ON CONFLICT DO UPDATE` then waits for the winner,
-- re-reads the newly committed row, and applies its SET unconditionally -- so
-- an OLDER event silently overwrites a NEWER one. Serial delivery was always
-- safe, which is why every existing test passed.
--
-- Reproduced on a disposable PostgreSQL 16 before this migration was written:
-- with the pre-image at 09:00, a committed 10:01 write was overwritten by a
-- concurrent 10:00 event; with the predicate below, the 10:01 write survives.
--
-- THE FIX
--
-- The ordering decision moves INTO the writing statement. There is no longer a
-- window between deciding and writing for another transaction to occupy.
--
-- The pre-read guards are deliberately KEPT: they still short-circuit the
-- common serial case without attempting a write, and they keep the `stale`
-- response shape identical.
--
-- SUPPRESSED WRITES
--
-- When the predicate excludes the row, `RETURNING ... INTO` yields no row and
-- FOUND is false. Falling through would return outcome 'applied' with a NULL
-- id, and chat.outbox enqueues whatever payload it is handed -- so every
-- suppressed write is converted to `stale` explicitly.
--
-- NOT CHANGED: signatures, return types, every business rule, the
-- not_applicable paths, BR-5 (nothing is ever deleted), and equal-timestamp
-- semantics (`<=`, so an equal occurred_at still applies).
--
-- No table, index, constraint or data is touched by this migration.
-- ---------------------------------------------------------------------------

create or replace function chat.ingest_core_class_session(
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_core_session text := nullif(btrim(p_payload ->> 'core_class_session_id'), '');
  v_core_child   text := nullif(btrim(p_payload ->> 'core_child_id'), '');
  v_core_teacher text := nullif(btrim(p_payload ->> 'core_teacher_id'), '');
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
    select id into v_teacher_id from chat.teacher where core_teacher_id = v_core_teacher;
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
  -- THE ORDERING DECISION, INSIDE THE WRITE. Evaluated against the latest
  -- committed row version after conflict resolution, so a concurrent older
  -- event cannot overwrite a newer one. `<=`, not `<`: an equal occurred_at
  -- still applies, which is what lets a corrected redelivery land.
  where chat.class_session.core_synced_at <= excluded.core_synced_at
  returning * into v_row;

  if not found then
    -- The predicate suppressed the write: a newer occurred_at is already
    -- stored. Returning 'applied' here would hand the outbox a NULL
    -- class_session_id, so this must be `stale` -- same contract as the
    -- pre-read guard above.
    return jsonb_build_object('outcome', 'stale', 'class_session_id', v_existing.id);
  end if;

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

create or replace function chat.cancel_core_class_session(
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_core_session text := nullif(btrim(p_payload ->> 'core_class_session_id'), '');
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
   where id = v_existing.id
     -- Re-checked as part of the write. Under READ COMMITTED the predicate is
     -- re-evaluated against the concurrently-committed version, so a newer
     -- cancellation or upsert cannot be regressed by this older one.
     and core_synced_at <= p_occurred_at;

  if not found then
    -- Suppressed. Nothing is ever deleted (BR-5), so a miss can only mean the
    -- stored occurred_at is newer -- never that the row disappeared.
    return jsonb_build_object('outcome', 'stale', 'class_session_id', v_existing.id);
  end if;

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

create or replace function chat.ingest_core_attendance(
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
as $$
declare
  v_core_session text := nullif(btrim(p_payload ->> 'core_class_session_id'), '');
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
  -- Same ordering decision, inside the write. `<=` keeps equal-applies.
  where chat.class_attendance.core_synced_at <= excluded.core_synced_at
  returning * into v_row;

  if not found then
    -- Suppressed: a newer attendance outcome is already recorded. `stale`, so
    -- no CLASS_ATTENDANCE_RECORDED event is enqueued with a NULL id.
    return jsonb_build_object('outcome', 'stale', 'attendance_id', v_existing.id);
  end if;

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
