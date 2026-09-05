-- Jawwid Chat -- the Jawwid Core integration boundary.
--
-- Jawwid Core owns accounts, children, subscriptions and payments. Jawwid Chat
-- owns the conversation and the operational workflow. The two share a database
-- but not a namespace: chat code MUST read Core only through the chat.core_*
-- views below, and MUST NOT reference public.* anywhere else. That keeps the
-- surface small enough to re-point at an HTTP client or a separate database
-- later without touching the domain (ADR-004).
--
-- Everything here is idempotent. Re-running a sync, replaying a webhook, or
-- processing the same change twice must not create a second row.

create or replace view chat.core_parent as
  select p.id            as core_parent_id,
         p.full_name,
         p.preferred_language,
         p.created_at
  from public.profiles p
  where p.role = 'parent';

create or replace view chat.core_child as
  select c.id        as core_child_id,
         c.parent_id as core_parent_id,
         c.name,
         c.age_band,
         c.created_at
  from public.children c;

create or replace view chat.core_subscription as
  select s.id        as core_subscription_id,
         s.parent_id as core_parent_id,
         s.status,
         s.current_period_end,
         s.renewal_date,
         s.is_current,
         (select pay.status from public.payments pay
           where pay.subscription_id = s.id
           order by pay.created_at desc limit 1) as last_payment_status,
         (select pay.created_at from public.payments pay
           where pay.subscription_id = s.id
           order by pay.created_at desc limit 1) as last_payment_at
  from public.subscriptions s;

comment on view chat.core_subscription is
  'The only place Jawwid Chat reads billing. If Core changes its subscription '
  'or payment shape, this view is the single thing that must change.';

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

-- Inbound change events (webhook or polled). The unique key is what makes
-- replay safe: the second delivery of the same event is recorded and ignored.
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

-- Families awaiting an owner ------------------------------------------------
-- Brief SS1: "No shared queue. No automatic routing/distribution." A new Core
-- parent therefore does NOT get a family row with a guessed owner. It appears
-- here until a manager assigns one, which is a deliberate manual step.

create or replace view chat.core_parent_awaiting_owner as
  select cp.*
  from chat.core_parent cp
  where not exists (select 1 from chat.family f where f.core_parent_id = cp.core_parent_id);

-- Sync ----------------------------------------------------------------------

create or replace function chat.sync_family_from_core(
  p_core_parent_id uuid,
  p_owner_id       uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_core      record;
  v_family_id uuid;
  v_contact   uuid;
begin
  select * into v_core from chat.core_parent where core_parent_id = p_core_parent_id;
  if not found then
    raise exception 'no Jawwid Core parent with id %', p_core_parent_id
      using errcode = 'no_data_found';
  end if;

  select id into v_family_id from chat.family where core_parent_id = p_core_parent_id;

  if v_family_id is null then
    if p_owner_id is null then
      raise exception
        'a new family needs an explicit primary owner; Jawwid Chat never assigns one '
        'automatically (brief SS1). See chat.core_parent_awaiting_owner.'
        using errcode = 'check_violation';
    end if;
    insert into chat.family (display_name, owner_id, language, core_parent_id)
    values (coalesce(v_core.full_name, 'Family'), p_owner_id,
            coalesce(v_core.preferred_language, 'ar'), p_core_parent_id)
    returning id into v_family_id;

    insert into chat.thread (family_id) values (v_family_id);
    perform chat.log_event('subscription_synced', v_family_id, null, 'system', null,
                           jsonb_build_object('created', true, 'core_parent_id', p_core_parent_id));
  else
    update chat.family
       set display_name = coalesce(v_core.full_name, display_name),
           language = coalesce(v_core.preferred_language, language)
     where id = v_family_id;
  end if;

  -- The account holder is a contact with the Primary Guardian preset.
  insert into chat.contact (family_id, app_user_id, name, relationship, role_preset,
                            can_message, can_view_progress, can_manage_schedule,
                            can_manage_billing, can_manage_contacts, can_cancel)
  values (v_family_id, p_core_parent_id, coalesce(v_core.full_name, 'Parent'), 'parent',
          'primary_guardian', true, true, true, true, true, true)
  on conflict (family_id, app_user_id) where app_user_id is not null
  do update set name = excluded.name, is_active = true
  returning id into v_contact;

  update chat.family set primary_contact_id = coalesce(primary_contact_id, v_contact)
   where id = v_family_id;

  return v_family_id;
end;
$$;

create or replace function chat.sync_learners_from_core(p_core_parent_id uuid)
returns integer
language plpgsql
as $$
declare
  v_family_id uuid;
  v_count     integer := 0;
begin
  select id into v_family_id from chat.family where core_parent_id = p_core_parent_id;
  if v_family_id is null then
    return 0;
  end if;

  insert into chat.learner (family_id, name, core_child_id)
  select v_family_id, cc.name, cc.core_child_id
  from chat.core_child cc
  where cc.core_parent_id = p_core_parent_id
  on conflict (core_child_id) do update set name = excluded.name;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function chat.sync_subscriptions_from_core(p_core_parent_id uuid)
returns integer
language plpgsql
as $$
declare
  v_family_id uuid;
  v_count     integer := 0;
begin
  select id into v_family_id from chat.family where core_parent_id = p_core_parent_id;
  if v_family_id is null then
    return 0;
  end if;

  insert into chat.subscription (family_id, status, ends_at, renewal_due_at,
                                 last_payment_status, last_payment_at, core_subscription_id)
  select v_family_id, cs.status, cs.current_period_end, cs.renewal_date,
         cs.last_payment_status, cs.last_payment_at, cs.core_subscription_id
  from chat.core_subscription cs
  where cs.core_parent_id = p_core_parent_id
  on conflict (core_subscription_id) do update
    set status              = excluded.status,
        ends_at             = excluded.ends_at,
        renewal_due_at      = excluded.renewal_due_at,
        last_payment_status = excluded.last_payment_status,
        last_payment_at     = excluded.last_payment_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- One family, end to end. Safe to call repeatedly.
create or replace function chat.sync_from_core(
  p_core_parent_id uuid, p_owner_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_family_id uuid;
begin
  v_family_id := chat.sync_family_from_core(p_core_parent_id, p_owner_id);
  perform chat.sync_learners_from_core(p_core_parent_id);
  perform chat.sync_subscriptions_from_core(p_core_parent_id);

  insert into chat.sync_state (source, last_synced_at, last_status)
  values ('jawwid_core', now(), 'ok')
  on conflict (source) do update
    set last_synced_at = excluded.last_synced_at, last_status = 'ok', last_error = null;

  return v_family_id;
end;
$$;

-- Every family already linked to Core, refreshed. New Core parents are not
-- pulled in here: they need an owner, which is a manager decision.
create or replace function chat.sync_all_known_families_from_core()
returns integer
language plpgsql
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in select core_parent_id from chat.family where core_parent_id is not null loop
    perform chat.sync_from_core(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace view chat.sync_health as
  select s.source,
         s.last_synced_at,
         s.last_status,
         s.last_error,
         (select count(*) from chat.core_event e
           where e.source = s.source and e.processed_at is null) as unprocessed_events,
         (select count(*) from chat.core_parent_awaiting_owner)  as parents_awaiting_owner
  from chat.sync_state s;
