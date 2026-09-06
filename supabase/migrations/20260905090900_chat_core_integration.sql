-- Jawwid Chat -- the Jawwid Core integration boundary.
--
-- Jawwid Core is a separate product in a separate database. Jawwid Chat never
-- queries it. Core-sourced facts arrive as payloads over the integration
-- boundary (API or webhook, owned by AI #2) and are materialised into
-- Chat-owned tables here.
--
-- Core stays the source of truth. What lives in chat.family, chat.learner and
-- chat.subscription is a replica Jawwid Chat does not author, keyed by the
-- core_*_id the payload carries. That key is what makes every function below
-- idempotent: re-delivering a payload, or replaying a webhook, converges on the
-- same row rather than creating a second one.
--
-- The payload shapes are the contract. They are documented in
-- docs/architecture/backend-contract.md §9 and are deliberately flat: this
-- boundary must not grow knowledge of Core's internal schema (ADR-014).

-- Parents Jawwid Chat has heard about but cannot yet act on -----------------
-- Brief SS1: "No shared queue. No automatic routing/distribution." A parent
-- arriving from Core therefore does NOT become a family with a guessed owner.
-- It waits here until a manager assigns one, which is a deliberate manual step.

create table chat.core_parent_inbox (
  core_parent_id uuid primary key,
  display_name   text,
  language       text,
  payload        jsonb not null default '{}'::jsonb,
  received_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger core_parent_inbox_set_updated_at
  before update on chat.core_parent_inbox
  for each row execute function chat.set_updated_at();

-- Sync bookkeeping ----------------------------------------------------------

create table chat.sync_state (
  source          text primary key,
  last_synced_at  timestamptz,
  last_cursor     text,
  last_status     text not null default 'idle'
                    check (last_status in ('idle', 'running', 'ok', 'failed')),
  last_error      text,
  updated_at      timestamptz not null default now()
);

create trigger sync_state_set_updated_at
  before update on chat.sync_state
  for each row execute function chat.set_updated_at();

-- Inbound change events. The unique key is what makes replay safe: the second
-- delivery of the same event is recorded and ignored.
create table chat.core_event (
  id                bigint generated always as identity primary key,
  source            text not null default 'jawwid_core',
  external_event_id text not null,
  event_type        text,
  payload           jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  error             text,

  constraint core_event_is_unique unique (source, external_event_id)
);

create index core_event_unprocessed_idx on chat.core_event (received_at)
  where processed_at is null;

-- Returns true only the first time an event id is seen. A webhook handler that
-- ignores a false return is idempotent by construction.
create or replace function chat.record_core_event(
  p_external_event_id text,
  p_event_type        text default null,
  p_payload           jsonb default '{}'::jsonb,
  p_source            text default 'jawwid_core'
) returns boolean
language plpgsql
as $$
begin
  insert into chat.core_event (source, external_event_id, event_type, payload)
  values (p_source, p_external_event_id, p_event_type, coalesce(p_payload, '{}'::jsonb));
  return true;
exception when unique_violation then
  return false;
end;
$$;

create or replace function chat.mark_core_event_processed(
  p_external_event_id text, p_error text default null, p_source text default 'jawwid_core'
) returns void
language sql
as $$
  update chat.core_event
     set processed_at = now(), error = p_error
   where source = p_source and external_event_id = p_external_event_id;
$$;

-- Vocabulary translation ----------------------------------------------------
-- Jawwid Chat does not adopt Core's subscription vocabulary. The map lives in
-- config so a new Core status is a config edit, not a migration, and an
-- unmapped value degrades to 'unknown' instead of failing the ingestion.

create or replace function chat.map_core_subscription_status(p_core_status text)
returns text
language sql
stable
as $$
  select coalesce(
    chat.config_json('integration.subscription_status_map') ->> p_core_status,
    'unknown')
$$;

create or replace view chat.unmapped_core_subscription_status as
  select s.core_subscription_id, s.family_id, s.updated_at
  from chat.subscription s
  where s.status = 'unknown';

comment on view chat.unmapped_core_subscription_status is
  'Subscriptions whose Core status had no entry in the translation map. A '
  'non-empty result means Core shipped a status Jawwid Chat has not been told '
  'about -- a config edit, not an outage.';

-- Ingestion -----------------------------------------------------------------

create or replace function chat.ingest_core_parent(p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_core_id   uuid := (p_payload ->> 'core_parent_id')::uuid;
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

-- The manager's deliberate step: give a waiting parent an owner.
create or replace function chat.assign_family_owner(
  p_core_parent_id uuid,
  p_owner_id       uuid,
  p_reason         text,
  p_actor_id       uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor     uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_inbox     chat.core_parent_inbox%rowtype;
  v_family_id uuid;
  v_contact   uuid;
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

  insert into chat.thread (family_id) values (v_family_id);

  -- The account holder is the Primary Guardian. account_id stays null until
  -- they first sign in and chat.link_contact_account() is called.
  insert into chat.contact (family_id, name, relationship, role_preset,
                            can_message, can_view_progress, can_manage_schedule,
                            can_manage_billing, can_manage_contacts, can_cancel)
  values (v_family_id, coalesce(v_inbox.display_name, 'Parent'), 'parent',
          'primary_guardian', true, true, true, true, true, true)
  returning id into v_contact;

  update chat.family set primary_contact_id = v_contact where id = v_family_id;
  delete from chat.core_parent_inbox where core_parent_id = p_core_parent_id;

  perform chat.write_audit(v_actor, 'family_owner_assigned', 'family', v_family_id, p_reason,
                           null, jsonb_build_object('owner_id', p_owner_id));
  perform chat.log_event('subscription_synced', v_family_id, null, 'staff', v_actor,
                         jsonb_build_object('created', true, 'core_parent_id', p_core_parent_id));
  return v_family_id;
end;
$$;

create or replace function chat.ingest_core_learner(p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_core_child  uuid := (p_payload ->> 'core_child_id')::uuid;
  v_core_parent uuid := (p_payload ->> 'core_parent_id')::uuid;
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
  v_core_sub    uuid := (p_payload ->> 'core_subscription_id')::uuid;
  v_core_parent uuid := (p_payload ->> 'core_parent_id')::uuid;
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

-- Accounts ------------------------------------------------------------------
-- Called when someone signs in for the first time and the identity provider's
-- subject must be attached to an existing staff member or contact.

create or replace function chat.link_contact_account(p_contact_id uuid, p_subject text)
returns uuid
language plpgsql
as $$
declare
  v_account uuid;
begin
  insert into chat.account (subject, kind) values (p_subject, 'family')
  on conflict (subject) do update set is_active = true
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
  on conflict (subject) do update set is_active = true
  returning id into v_account;

  update chat.staff set account_id = v_account where id = p_staff_id;
  return v_account;
end;
$$;

-- Health --------------------------------------------------------------------

create or replace function chat.record_sync_result(
  p_source text, p_status text, p_error text default null, p_cursor text default null
) returns void
language sql
as $$
  insert into chat.sync_state (source, last_synced_at, last_status, last_error, last_cursor)
  values (p_source, now(), p_status, p_error, p_cursor)
  on conflict (source) do update
    set last_synced_at = excluded.last_synced_at,
        last_status    = excluded.last_status,
        last_error     = excluded.last_error,
        last_cursor    = coalesce(excluded.last_cursor, chat.sync_state.last_cursor);
$$;

create or replace view chat.sync_health as
  select s.source,
         s.last_synced_at,
         s.last_status,
         s.last_error,
         (select count(*) from chat.core_event e
           where e.source = s.source and e.processed_at is null)  as unprocessed_events,
         (select count(*) from chat.core_parent_inbox)            as parents_awaiting_owner,
         (select count(*) from chat.unmapped_core_subscription_status) as unmapped_statuses
  from chat.sync_state s;
