-- Jawwid Chat -- make ingestion organization-aware.
--
-- 095300 scoped every externally-supplied key to its organization. Two things
-- follow for the ingestion functions, and both are corrections, not choices:
--
--   1. ON CONFLICT must name the new composite constraint. `on conflict
--      (core_teacher_id)` no longer matches any unique index and fails outright.
--
--   2. Every lookup by a Core identifier must be scoped too. These functions run
--      with elevated rights during ingestion, so RLS is not there to catch an
--      unscoped read: `where core_child_id = $1` would happily return another
--      tenant's learner and the boundary would then write across organizations.
--
-- The bodies are otherwise unchanged from 090900 and 094100. Nothing about the
-- verified idempotency, ordering or retry behaviour is altered.

create or replace function chat.record_sync_result(
  p_source text, p_status text, p_error text default null, p_cursor text default null
) returns void
language sql
as $$
  insert into chat.sync_state (source, last_synced_at, last_status, last_error, last_cursor)
  values (p_source, now(), p_status, p_error, p_cursor)
  on conflict (organization_id, source) do update
    set last_synced_at = excluded.last_synced_at,
        last_status    = excluded.last_status,
        last_error     = excluded.last_error,
        last_cursor    = coalesce(excluded.last_cursor, chat.sync_state.last_cursor);
$$;

create or replace function chat.link_contact_account(p_contact_id uuid, p_subject text)
returns uuid
language plpgsql
as $$
declare
  v_account uuid;
begin
  insert into chat.account (subject, kind) values (p_subject, 'family')
  on conflict (organization_id, subject) do update set is_active = true
  returning id into v_account;

  update chat.contact set account_id = v_account where id = p_contact_id;
  return v_account;
end;
$$;

create or replace function chat.link_staff_account(p_staff_id uuid, p_subject text)
returns uuid
language plpgsql
as $$
declare
  v_account uuid;
begin
  insert into chat.account (subject, kind) values (p_subject, 'staff')
  on conflict (organization_id, subject) do update set is_active = true
  returning id into v_account;

  update chat.staff set account_id = v_account where id = p_staff_id;
  return v_account;
end;
$$;

create or replace function chat.ingest_core_parent(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id   uuid := (p_payload ->> 'core_parent_id')::uuid;
  v_name      text := p_payload ->> 'display_name';
  v_language  text := coalesce(p_payload ->> 'language', 'ar');
  v_family    chat.family%rowtype;
begin
  if v_core_id is null then
    raise exception 'core_parent_id is required' using errcode = 'check_violation';
  end if;

  select * into v_family from chat.family where core_parent_id = v_core_id
     and organization_id = chat.current_organization_id();

  if not found then
    insert into chat.core_parent_inbox (core_parent_id, display_name, language, payload)
    values (v_core_id, v_name, v_language, p_payload)
    on conflict (organization_id, core_parent_id) do update
      set display_name = excluded.display_name,
          language     = excluded.language,
          payload      = excluded.payload;
    return null;  -- still awaiting an owner
  end if;

  if chat.core_event_is_stale(v_family.core_synced_at, p_occurred_at) then
    return v_family.id;
  end if;

  -- Core-owned fields only. owner_id, tier and state belong to Chat and are
  -- never touched by a sync (PRD SS12.4: conflicts resolve in favour of Core
  -- FOR ITS OWN FIELDS).
  update chat.family
     set display_name   = coalesce(v_name, display_name),
         language       = coalesce(v_language, language),
         core_synced_at = coalesce(p_occurred_at, now())
   where id = v_family.id;

  return v_family.id;
end;
$$;

create or replace function chat.ingest_core_learner(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_child  uuid := (p_payload ->> 'core_child_id')::uuid;
  v_core_parent uuid := (p_payload ->> 'core_parent_id')::uuid;
  v_family_id   uuid;
  v_learner     chat.learner%rowtype;
  v_id          uuid;
begin
  if v_core_child is null then
    raise exception 'core_child_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family
   where core_parent_id = v_core_parent
     and organization_id = chat.current_organization_id();
  if v_family_id is null then
    return null;  -- the family has no owner yet; the learner arrives with it later
  end if;

  select * into v_learner from chat.learner
   where core_child_id = v_core_child
     and organization_id = chat.current_organization_id();
  if found and chat.core_event_is_stale(v_learner.core_synced_at, p_occurred_at) then
    return v_learner.id;
  end if;

  insert into chat.learner (family_id, name, level, schedule_ref, next_class_at,
                            last_attended_at, consecutive_absences, core_child_id,
                            core_synced_at)
  values (v_family_id,
          coalesce(p_payload ->> 'name', 'Learner'),
          p_payload ->> 'level',
          p_payload ->> 'schedule_ref',
          (p_payload ->> 'next_class_at')::timestamptz,
          (p_payload ->> 'last_attended_at')::timestamptz,
          coalesce((p_payload ->> 'consecutive_absences')::integer, 0),
          v_core_child,
          coalesce(p_occurred_at, now()))
  on conflict (organization_id, core_child_id) do update
    set name                 = excluded.name,
        level                = coalesce(excluded.level, chat.learner.level),
        schedule_ref         = coalesce(excluded.schedule_ref, chat.learner.schedule_ref),
        next_class_at        = excluded.next_class_at,
        last_attended_at     = excluded.last_attended_at,
        consecutive_absences = excluded.consecutive_absences,
        core_synced_at       = excluded.core_synced_at
  returning id into v_id;

  perform chat.sync_student_group_membership(v_id);
  return v_id;
end;
$$;

create or replace function chat.ingest_core_subscription(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_sub    uuid := (p_payload ->> 'core_subscription_id')::uuid;
  v_core_parent uuid := (p_payload ->> 'core_parent_id')::uuid;
  v_family_id   uuid;
  v_existing    chat.subscription%rowtype;
  v_id          uuid;
begin
  if v_core_sub is null then
    raise exception 'core_subscription_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family
   where core_parent_id = v_core_parent
     and organization_id = chat.current_organization_id();
  if v_family_id is null then
    return null;
  end if;

  select * into v_existing from chat.subscription
   where core_subscription_id = v_core_sub
     and organization_id = chat.current_organization_id();
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.subscription (family_id, plan, status, ends_at, renewal_due_at,
                                 last_payment_status, last_payment_at,
                                 core_subscription_id, core_synced_at)
  values (v_family_id,
          p_payload ->> 'plan',
          chat.map_core_subscription_status(p_payload ->> 'status'),
          (p_payload ->> 'ends_at')::timestamptz,
          (p_payload ->> 'renewal_due_at')::timestamptz,
          p_payload ->> 'last_payment_status',
          (p_payload ->> 'last_payment_at')::timestamptz,
          v_core_sub,
          coalesce(p_occurred_at, now()))
  on conflict (organization_id, core_subscription_id) do update
    set plan                = coalesce(excluded.plan, chat.subscription.plan),
        status              = excluded.status,
        ends_at             = excluded.ends_at,
        renewal_due_at      = excluded.renewal_due_at,
        last_payment_status = excluded.last_payment_status,
        last_payment_at     = excluded.last_payment_at,
        core_synced_at      = excluded.core_synced_at
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function chat.ingest_core_teacher(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id  uuid := (p_payload ->> 'core_teacher_id')::uuid;
  v_existing chat.teacher%rowtype;
  v_id       uuid;
begin
  if v_core_id is null then
    raise exception 'core_teacher_id is required' using errcode = 'check_violation';
  end if;

  select * into v_existing from chat.teacher
   where core_teacher_id = v_core_id
     and organization_id = chat.current_organization_id();
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.teacher (core_teacher_id, display_name, core_synced_at)
  values (v_core_id, coalesce(p_payload ->> 'display_name', 'Teacher'),
          coalesce(p_occurred_at, now()))
  on conflict (organization_id, core_teacher_id) do update
    set display_name   = excluded.display_name,
        core_synced_at = excluded.core_synced_at
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function chat.ingest_core_enrollment(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id    uuid := (p_payload ->> 'core_enrollment_id')::uuid;
  v_learner_id uuid;
  v_teacher_id uuid;
  v_existing   chat.enrollment%rowtype;
  v_id         uuid;
begin
  if v_core_id is null then
    raise exception 'core_enrollment_id is required' using errcode = 'check_violation';
  end if;

  select id into v_learner_id from chat.learner
   where core_child_id = (p_payload ->> 'core_child_id')::uuid
     and organization_id = chat.current_organization_id();
  select id into v_teacher_id from chat.teacher
   where core_teacher_id = (p_payload ->> 'core_teacher_id')::uuid
     and organization_id = chat.current_organization_id();

  -- Either side may not have arrived yet. Acknowledge and wait; the enrolment
  -- is redelivered, or the backfill picks it up.
  if v_learner_id is null or v_teacher_id is null then
    return null;
  end if;

  select * into v_existing from chat.enrollment
   where core_enrollment_id = v_core_id
     and organization_id = chat.current_organization_id();
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.enrollment (core_enrollment_id, learner_id, teacher_id, subject,
                               status, started_at, ended_at, core_synced_at)
  values (v_core_id, v_learner_id, v_teacher_id,
          p_payload ->> 'subject',
          coalesce(p_payload ->> 'status', 'active'),
          (p_payload ->> 'started_at')::timestamptz,
          (p_payload ->> 'ended_at')::timestamptz,
          coalesce(p_occurred_at, now()))
  on conflict (organization_id, core_enrollment_id) do update
    set learner_id     = excluded.learner_id,
        teacher_id     = excluded.teacher_id,
        subject        = coalesce(excluded.subject, chat.enrollment.subject),
        status         = excluded.status,
        started_at     = coalesce(excluded.started_at, chat.enrollment.started_at),
        ended_at       = excluded.ended_at,
        core_synced_at = excluded.core_synced_at
  returning id into v_id;

  -- PRD SS7.3: membership follows the data.
  perform chat.sync_student_group_membership(v_learner_id);
  return v_id;
end;
$$;

create or replace function chat.ingest_core_class_session(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id    uuid := (p_payload ->> 'core_class_session_id')::uuid;
  v_learner_id uuid;
  v_teacher_id uuid;
  v_existing   chat.class_session%rowtype;
  v_id         uuid;
begin
  if v_core_id is null then
    raise exception 'core_class_session_id is required' using errcode = 'check_violation';
  end if;

  select id into v_learner_id from chat.learner
   where core_child_id = (p_payload ->> 'core_child_id')::uuid
     and organization_id = chat.current_organization_id();
  if v_learner_id is null then
    return null;
  end if;

  select id into v_teacher_id from chat.teacher
   where core_teacher_id = (p_payload ->> 'core_teacher_id')::uuid
     and organization_id = chat.current_organization_id();

  select * into v_existing from chat.class_session
   where core_class_session_id = v_core_id
     and organization_id = chat.current_organization_id();
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.class_session (core_class_session_id, learner_id, teacher_id,
                                  starts_at, ends_at, join_url, status, core_synced_at)
  values (v_core_id, v_learner_id, v_teacher_id,
          (p_payload ->> 'starts_at')::timestamptz,
          (p_payload ->> 'ends_at')::timestamptz,
          p_payload ->> 'join_url',
          coalesce(p_payload ->> 'status', 'scheduled'),
          coalesce(p_occurred_at, now()))
  on conflict (organization_id, core_class_session_id) do update
    set teacher_id     = excluded.teacher_id,
        starts_at      = excluded.starts_at,
        ends_at        = excluded.ends_at,
        join_url       = excluded.join_url,
        status         = excluded.status,
        core_synced_at = excluded.core_synced_at
  returning id into v_id;

  -- The attention engine reads learner.next_class_at (PRD SS5.4).
  update chat.learner l
     set next_class_at = (select min(cs.starts_at) from chat.class_session cs
                           where cs.learner_id = l.id and cs.status = 'scheduled'
                             and cs.starts_at > now())
   where l.id = v_learner_id;

  return v_id;
end;
$$;

create or replace function chat.ingest_core_payment(
  p_payload jsonb, p_occurred_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  v_core_id   uuid := (p_payload ->> 'core_payment_id')::uuid;
  v_family_id uuid;
  v_sub_id    uuid;
  v_existing  chat.payment%rowtype;
  v_id        uuid;
begin
  if v_core_id is null then
    raise exception 'core_payment_id is required' using errcode = 'check_violation';
  end if;

  select id into v_family_id from chat.family
   where core_parent_id = (p_payload ->> 'core_parent_id')::uuid
     and organization_id = chat.current_organization_id();
  if v_family_id is null then
    return null;
  end if;

  select id into v_sub_id from chat.subscription
   where core_subscription_id = (p_payload ->> 'core_subscription_id')::uuid
     and organization_id = chat.current_organization_id();

  select * into v_existing from chat.payment
   where core_payment_id = v_core_id
     and organization_id = chat.current_organization_id();
  if found and chat.core_event_is_stale(v_existing.core_synced_at, p_occurred_at) then
    return v_existing.id;
  end if;

  insert into chat.payment (core_payment_id, family_id, subscription_id, amount,
                            currency, status, due_at, paid_at, core_synced_at)
  values (v_core_id, v_family_id, v_sub_id,
          (p_payload ->> 'amount')::numeric,
          p_payload ->> 'currency',
          coalesce(p_payload ->> 'status', 'unknown'),
          (p_payload ->> 'due_at')::timestamptz,
          (p_payload ->> 'paid_at')::timestamptz,
          coalesce(p_occurred_at, now()))
  on conflict (organization_id, core_payment_id) do update
    set subscription_id = coalesce(excluded.subscription_id, chat.payment.subscription_id),
        amount          = excluded.amount,
        currency        = excluded.currency,
        status          = excluded.status,
        due_at          = excluded.due_at,
        paid_at         = excluded.paid_at,
        core_synced_at  = excluded.core_synced_at
  returning id into v_id;

  return v_id;
end;
$$;

