-- Core-owned identifiers are opaque external text, not UUIDs.
--
-- WHY THIS EXISTS
-- ---------------
-- Every `core_*_id` in this schema was typed `uuid` on the assumption that
-- Jawwid Core is a Supabase/PostgreSQL system issuing UUIDs. It is not.
-- Jawwid Core is a Node/Express/Mongoose application on MongoDB
-- (MohamedEmadLasheen/jawwid, server/), and its primary keys are MongoDB
-- ObjectIds: 12 bytes, 24 hexadecimal characters.
--
--   '507f1f77bcf86cd799439011'::uuid  ->  invalid input syntax for type uuid
--
-- That is not an edge case. It is the first event Core would ever send, and
-- every event after it. The failure is deterministic, and it sits underneath
-- the family, teacher, subscription, class-session and attendance ingests
-- alike -- so no producer could be written against the old types at all.
-- This is the concrete form of the long-standing RT-010 discrepancy.
--
-- THE RULE THIS ESTABLISHES
-- -------------------------
--   Chat-owned identity        -> uuid   (unchanged, and deliberately so)
--   Core-owned external identity -> text (opaque; Chat asserts no format)
--
-- Chat's own primary keys stay `uuid`. Nothing below touches them. The only
-- columns that change are the ones whose values are minted by another system,
-- which Chat stores to recognise a thing again and never to parse.
--
-- WHY IN-PLACE ALTER IS THE SMALLEST SAFE CHANGE
-- ----------------------------------------------
-- A parallel-column strategy would need dual writes, a backfill and a cutover
-- for a conversion that is already lossless: `uuid::text` renders the canonical
-- lowercase 36-character form, so no existing value can be damaged or become
-- ambiguous. PostgreSQL rebuilds each unique index and the one primary key in
-- place, so uniqueness is preserved without being dropped and restated.
-- Nothing is deleted and nothing is reinterpreted.
--
-- The earlier migrations are NOT edited. A database built from zero creates
-- these columns as `uuid` and arrives here; a database already in production
-- arrives here from where it is. Both converge on the same schema, which is
-- the property that makes the two verifications in JC-011 mean something.
--
-- ONE SEMANTIC DIFFERENCE, STATED PLAINLY
-- ---------------------------------------
-- `uuid` comparison is canonicalising: 'AB...' and 'ab...' were one value.
-- `text` comparison is exact, so they would now be two. Core emits ObjectIds
-- via ObjectId#toString(), which is always lowercase hex, so this cannot bite
-- in practice -- but it is a real change and it is recorded here rather than
-- discovered later. Chat does not normalise case, because normalising an
-- opaque external identifier is exactly the kind of reinterpretation this
-- migration exists to stop.
--
-- AND ONE FAIL-CLOSED BEHAVIOUR THAT HAD TO BE REBUILT
-- ----------------------------------------------------
-- `''::uuid` used to raise. `''::text` does not. Every ingest function below
-- therefore reads its Core id through `nullif(btrim(...), '')`, so a blank or
-- whitespace-only identifier is still "missing" and still refused, rather than
-- silently becoming a valid key. Matching check constraints back that up at
-- the table, where no existing row can violate them.

-- ---------------------------------------------------------------------------
-- 1. The dependent views. A view pins the types of the columns it selects, so
--    unmapped_core_subscription_status has to stand aside for the ALTER and be
--    restated afterwards -- and chat.sync_health counts rows in it, so it must
--    go first and come back last. sync_health does not read any Core id column
--    itself; it is dropped only because PostgreSQL will not drop a view that
--    another view still selects from. Both are plain views with no grants and
--    no comments, so restating them restores their full prior state.
-- ---------------------------------------------------------------------------

drop view if exists chat.sync_health;
drop view if exists chat.unmapped_core_subscription_status;

-- ---------------------------------------------------------------------------
-- 2. The six Core-owned identifier columns.
-- ---------------------------------------------------------------------------

alter table chat.family
  alter column core_parent_id type text using core_parent_id::text;

alter table chat.learner
  alter column core_child_id type text using core_child_id::text;

alter table chat.subscription
  alter column core_subscription_id type text using core_subscription_id::text;

alter table chat.core_parent_inbox
  alter column core_parent_id type text using core_parent_id::text;

alter table chat.teacher
  alter column core_teacher_id type text using core_teacher_id::text;

alter table chat.class_session
  alter column core_class_session_id type text using core_class_session_id::text;

-- The blank-string guard the uuid type used to give for free. These cannot
-- fail on existing data: every current value came from a uuid.
alter table chat.family
  add constraint family_core_parent_id_not_blank
  check (core_parent_id is null or btrim(core_parent_id) <> '');

alter table chat.learner
  add constraint learner_core_child_id_not_blank
  check (core_child_id is null or btrim(core_child_id) <> '');

alter table chat.subscription
  add constraint subscription_core_subscription_id_not_blank
  check (core_subscription_id is null or btrim(core_subscription_id) <> '');

alter table chat.core_parent_inbox
  add constraint core_parent_inbox_core_parent_id_not_blank
  check (btrim(core_parent_id) <> '');

alter table chat.teacher
  add constraint teacher_core_teacher_id_not_blank
  check (core_teacher_id is null or btrim(core_teacher_id) <> '');

alter table chat.class_session
  add constraint class_session_core_id_not_blank
  check (btrim(core_class_session_id) <> '');

comment on column chat.class_session.core_class_session_id is
  'Jawwid Core''s own identifier for this occurrence, stored opaquely as text. '
  'Core issues MongoDB ObjectIds; Chat stores the string it was given and does '
  'not parse, normalise or generate it.';

-- ---------------------------------------------------------------------------
-- 3. The views, restated. Only the column type underneath has moved; both
--    definitions are character-for-character what they were.
-- ---------------------------------------------------------------------------

create view chat.unmapped_core_subscription_status as
  select s.core_subscription_id, s.family_id, s.updated_at
  from chat.subscription s
  where s.status = 'unknown';

comment on view chat.unmapped_core_subscription_status is
  'Subscriptions whose Core status had no entry in the translation map. A '
  'non-empty result means Core shipped a status Jawwid Chat has not been told '
  'about -- a config edit, not an outage.';

create view chat.sync_health as
  select s.source,
         s.last_synced_at,
         s.last_status,
         s.last_error,
         (select count(*) from chat.core_event e
           where e.source = s.source and e.processed_at is null)  as unprocessed_events,
         (select count(*) from chat.core_parent_inbox)            as parents_awaiting_owner,
         (select count(*) from chat.unmapped_core_subscription_status) as unmapped_statuses
  from chat.sync_state s;

-- ---------------------------------------------------------------------------
-- 4. Ingestion functions.
--
--    Five keep their signature, so `create or replace` is enough. Only the
--    declarations change: the `::uuid` cast becomes a blank-safe text read.
--    Bodies are otherwise identical to the definitions they supersede.
-- ---------------------------------------------------------------------------

create or replace function chat.ingest_core_parent(p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_core_id   text := nullif(btrim(p_payload ->> 'core_parent_id'), '');
  v_name      text := p_payload ->> 'display_name';
  v_language  text := coalesce(p_payload ->> 'language', 'ar');
  v_family_id uuid;
begin
  if v_core_id is null then
    raise exception 'core_parent_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family where core_parent_id = v_core_id;

  if v_family_id is null then
    insert into chat.core_parent_inbox (core_parent_id, display_name, language, payload)
    values (v_core_id, v_name, v_language, p_payload)
    on conflict (core_parent_id) do update
      set display_name = excluded.display_name,
          language     = excluded.language,
          payload      = excluded.payload;
    return null;  -- still awaiting an owner
  end if;

  update chat.family
     set display_name = coalesce(v_name, display_name),
         language     = coalesce(v_language, language)
   where id = v_family_id;

  return v_family_id;
end;
$$;

comment on function chat.ingest_core_parent is
  'Returns the family id, or NULL when the parent is still waiting for a '
  'manager to name an owner. A NULL return is a normal outcome, not a failure.';

create or replace function chat.ingest_core_learner(p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_core_child  text := nullif(btrim(p_payload ->> 'core_child_id'), '');
  v_core_parent text := nullif(btrim(p_payload ->> 'core_parent_id'), '');
  v_family_id   uuid;
  v_learner_id  uuid;
begin
  if v_core_child is null then
    raise exception 'core_child_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family where core_parent_id = v_core_parent;
  if v_family_id is null then
    return null;  -- the family has no owner yet; the learner arrives with it later
  end if;

  insert into chat.learner (family_id, name, level, schedule_ref, next_class_at,
                            last_attended_at, consecutive_absences, core_child_id)
  values (v_family_id,
          coalesce(p_payload ->> 'name', 'Learner'),
          p_payload ->> 'level',
          p_payload ->> 'schedule_ref',
          (p_payload ->> 'next_class_at')::timestamptz,
          (p_payload ->> 'last_attended_at')::timestamptz,
          coalesce((p_payload ->> 'consecutive_absences')::integer, 0),
          v_core_child)
  on conflict (core_child_id) do update
    set name                 = excluded.name,
        level                = coalesce(excluded.level, chat.learner.level),
        schedule_ref         = coalesce(excluded.schedule_ref, chat.learner.schedule_ref),
        next_class_at        = excluded.next_class_at,
        last_attended_at     = excluded.last_attended_at,
        consecutive_absences = excluded.consecutive_absences
  returning id into v_learner_id;

  return v_learner_id;
end;
$$;

create or replace function chat.ingest_core_subscription(p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_core_sub    text := nullif(btrim(p_payload ->> 'core_subscription_id'), '');
  v_core_parent text := nullif(btrim(p_payload ->> 'core_parent_id'), '');
  v_family_id   uuid;
  v_id          uuid;
begin
  if v_core_sub is null then
    raise exception 'core_subscription_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family where core_parent_id = v_core_parent;
  if v_family_id is null then
    return null;
  end if;

  insert into chat.subscription (family_id, plan, status, ends_at, renewal_due_at,
                                 last_payment_status, last_payment_at, core_subscription_id)
  values (v_family_id,
          p_payload ->> 'plan',
          chat.map_core_subscription_status(p_payload ->> 'status'),
          (p_payload ->> 'ends_at')::timestamptz,
          (p_payload ->> 'renewal_due_at')::timestamptz,
          p_payload ->> 'last_payment_status',
          (p_payload ->> 'last_payment_at')::timestamptz,
          v_core_sub)
  on conflict (core_subscription_id) do update
    set plan                = coalesce(excluded.plan, chat.subscription.plan),
        status              = excluded.status,
        ends_at             = excluded.ends_at,
        renewal_due_at      = excluded.renewal_due_at,
        last_payment_status = excluded.last_payment_status,
        last_payment_at     = excluded.last_payment_at
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Class session and attendance.
--
--    One correctness fix travels with the type change, because the type change
--    is what exposed it: ingest_core_class_session resolved the teacher with
--    `where id = v_core_teacher`, comparing Chat's own primary key against an
--    identifier minted by Core. Under `uuid` that silently matched nothing
--    (two unrelated UUID spaces); under `text` it is a type error that cannot
--    be ignored. The correct column is core_teacher_id, which is what the
--    payload field has always meant.
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
-- 6. assign_family_owner is the one signature that changes, so it cannot be
--    replaced in place -- a differing parameter type would create an overload
--    and leave the uuid version callable. The old signature is dropped
--    explicitly and the body below is the current one (from 20260905094000,
--    which supersedes the definition in 20260905090900): it creates the
--    family's persistent direct conversation rather than a thread.
-- ---------------------------------------------------------------------------

drop function if exists chat.assign_family_owner(uuid, uuid, text, uuid);

create function chat.assign_family_owner(
  p_core_parent_id text,
  p_owner_id       uuid,
  p_reason         text,
  p_actor_id       uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor           uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_inbox           chat.core_parent_inbox%rowtype;
  v_family_id       uuid;
  v_contact         uuid;
  v_conversation_id uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'assigning an owner requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) is distinct from 'manager' then
    raise exception 'only a manager may assign a family owner'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from chat.staff
                 where id = p_owner_id and is_active and role in ('admin', 'coverage')) then
    raise exception 'the owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select * into v_inbox from chat.core_parent_inbox where core_parent_id = p_core_parent_id;
  if not found then
    raise exception 'no waiting Jawwid Core parent with id %', p_core_parent_id
      using errcode = 'no_data_found';
  end if;

  insert into chat.family (display_name, owner_id, language, core_parent_id)
  values (coalesce(v_inbox.display_name, 'Family'), p_owner_id,
          coalesce(v_inbox.language, 'ar'), p_core_parent_id)
  returning id into v_family_id;

  insert into chat.contact (family_id, name, relationship, role_preset,
                            can_message, can_view_progress, can_manage_schedule,
                            can_manage_billing, can_manage_contacts, can_cancel)
  values (v_family_id, coalesce(v_inbox.display_name, 'Parent'), 'parent',
          'primary_guardian', true, true, true, true, true, true)
  returning id into v_contact;

  update chat.family set primary_contact_id = v_contact where id = v_family_id;

  -- The family's one persistent "Jawwid" conversation. Coverage changes who
  -- answers in it; it is never replaced (PRD section 5.2).
  insert into chat.conversation (type, family_id, direct_key, title)
  values ('direct', v_family_id, 'family:' || v_family_id::text, 'Jawwid')
  returning id into v_conversation_id;

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'contact', v_contact, 'parent');

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'staff', p_owner_id, 'admin');

  delete from chat.core_parent_inbox where core_parent_id = p_core_parent_id;

  perform chat.write_audit(v_actor, 'family_owner_assigned', 'family', v_family_id, p_reason,
                           null, jsonb_build_object('owner_id', p_owner_id));
  perform chat.log_event('subscription_synced', v_family_id, 'staff', v_actor,
                         jsonb_build_object('created', true, 'core_parent_id', p_core_parent_id));
  return v_family_id;
end;
$$;
