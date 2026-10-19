-- The Core -> Chat boundary, for subscriptions (PD-11 T4 confirmation).
--
-- Record: docs/integration/core-subscription-confirmation.md, and
-- docs/architecture/core-integration-contract.md.
--
-- THREE THINGS.
--
-- 1. CORE IDENTITY IS OPAQUE TEXT, NOT A UUID.
--    Jawwid Core is a Node/Mongoose application on MongoDB; its ids are
--    ObjectIds (24 hex characters), which `::uuid` refuses. Every core_*_id
--    column was typed uuid on the old assumption that Core issued UUIDs, so no
--    Core id could ever have been stored -- and PD-12 S3 (instalments) matched
--    invoices against those columns. The rule from the unmerged Core consumer
--    branch (claude/admiring-feynman-v3l4xh, 20260924110000) is carried here,
--    scoped to the columns this line has:
--
--      Chat-owned identity           -> uuid  (unchanged)
--      Core-owned external identity  -> text  (opaque; Chat asserts no format,
--                                              never parses or re-cases it)
--
--    `uuid::text` is lossless, so existing values survive. A blank id is still
--    "missing": the ingest functions read ids through nullif(btrim(..), '')
--    and CHECK constraints back that up at the table.
--
-- 2. THE CORE INGEST FUNCTIONS ARE SERVER-SIDE ONLY.
--    chat.record_core_event, chat.mark_core_event_processed and the three
--    chat.ingest_core_* functions carried the default PUBLIC EXECUTE grant, so
--    a request role could write Core's ledger or ingest a family. Revoked
--    (the same finding as P1-follow-up on the consumer branch).
--
-- 3. A TRIAL SUBSCRIPTION IS CONFIRMED WITH ITS STUDENT.
--    chat.confirm_trial_subscription(lesson, core subscription, core child)
--    confirms Sales' "subscribed" and remembers Core's child id. If that child
--    is already a learner in the trial's organization, the prospect is linked
--    now; if the learner arrives later (with that core_child_id), a trigger
--    links it then. Until linked, New Students shows the subscription as
--    "confirmed, student not in Chat yet" -- never nowhere.
--
-- FAIL CLOSED. Nothing here is granted to a request role.

-- ===========================================================================
-- 1. Core identity is text
-- ===========================================================================

-- The one view that reads a converted column, and the view that reads it.
-- Both are recreated below exactly as 20260905090900 defined them.
drop view chat.sync_health;
drop view chat.unmapped_core_subscription_status;

alter table chat.family             alter column core_parent_id       type text using core_parent_id::text;
alter table chat.core_parent_inbox  alter column core_parent_id       type text using core_parent_id::text;
alter table chat.learner            alter column core_child_id        type text using core_child_id::text;
alter table chat.subscription       alter column core_subscription_id type text using core_subscription_id::text;
alter table chat.teacher            alter column core_teacher_id      type text using core_teacher_id::text;

alter table chat.family            add constraint family_core_parent_id_not_blank      check (core_parent_id is null or length(btrim(core_parent_id)) between 1 and 200);
alter table chat.core_parent_inbox add constraint core_parent_inbox_id_not_blank       check (length(btrim(core_parent_id)) between 1 and 200);
alter table chat.learner           add constraint learner_core_child_id_not_blank      check (core_child_id is null or length(btrim(core_child_id)) between 1 and 200);
alter table chat.subscription      add constraint subscription_core_id_not_blank       check (core_subscription_id is null or length(btrim(core_subscription_id)) between 1 and 200);
alter table chat.teacher           add constraint teacher_core_teacher_id_not_blank    check (core_teacher_id is null or length(btrim(core_teacher_id)) between 1 and 200);

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
           where e.source = s.source and e.processed_at is null) as unprocessed_events,
         (select count(*) from chat.core_parent_inbox) as parents_awaiting_owner,
         (select count(*) from chat.unmapped_core_subscription_status) as unmapped_statuses
  from chat.sync_state s;

-- The ingest functions, unchanged except that a Core id is text.
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

-- assign_family_owner names a waiting Core parent, so its first parameter is a
-- Core id. A parameter type is part of the signature: drop and recreate, with
-- the body and the (owner-only) grants unchanged.
drop function chat.assign_family_owner(uuid, uuid, text, uuid);

create function chat.assign_family_owner(
  p_core_parent_id text, p_owner_id uuid, p_reason text, p_actor_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor           uuid := chat.trusted_staff_actor(p_actor_id);
  v_inbox           chat.core_parent_inbox%rowtype;
  v_family_id       uuid;
  v_contact         uuid;
  v_conversation_id uuid;
  v_org             uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'assigning an owner requires a reason' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.staff where id = p_owner_id;
  perform chat.require_family_assigner(v_actor, v_org, 'assign a family owner');
  if not exists (select 1 from chat.staff
                 where id = p_owner_id and is_active and left_at is null and role in ('admin', 'coverage')) then
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

revoke all on function chat.assign_family_owner(text, uuid, text, uuid) from public, anon, authenticated, chat_app;

-- ===========================================================================
-- 2. The Core ingest functions are server-side only
-- ===========================================================================

revoke all on function chat.record_core_event(text, text, jsonb, text)        from public, anon, authenticated, chat_app;
revoke all on function chat.mark_core_event_processed(text, text, text)       from public, anon, authenticated, chat_app;
revoke all on function chat.ingest_core_parent(jsonb)                          from public, anon, authenticated, chat_app;
revoke all on function chat.ingest_core_learner(jsonb)                         from public, anon, authenticated, chat_app;
revoke all on function chat.ingest_core_subscription(jsonb)                    from public, anon, authenticated, chat_app;

-- ===========================================================================
-- 3. A trial subscription is confirmed with its student
-- ===========================================================================

alter table chat.trial_outcome
  add column core_child_ref text check (core_child_ref is null or length(btrim(core_child_ref)) between 1 and 200);

comment on column chat.trial_outcome.core_child_ref is
  'Core''s id for the child this subscription is for (opaque text), set by the confirmation. Links the prospect to the learner with that core_child_id, now or when the learner arrives.';

create index trial_outcome_awaiting_student_idx on chat.trial_outcome (core_child_ref)
  where confirmed_at is not null and core_child_ref is not null;

-- Confirm a trial's subscription from Core's subscription.created. Server-side
-- only; idempotent ('duplicate' on a redelivery). Raises when Chat has no
-- matching "subscribed" decision: a boundary disagreement stays visible in the
-- ledger, and Core's retry applies it once Sales has recorded the decision.
-- Returns 'confirmed' (student linked) or 'confirmed_awaiting_student'.
create or replace function chat.confirm_trial_subscription(
  p_lesson_id uuid, p_core_subscription_ref text, p_core_child_ref text
) returns text
language plpgsql
as $$
declare
  v_outcome  chat.trial_outcome%rowtype;
  v_sub      text := nullif(btrim(p_core_subscription_ref), '');
  v_child    text := nullif(btrim(p_core_child_ref), '');
  v_learner  uuid;
  v_prospect uuid;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server confirms a subscription' using errcode = 'insufficient_privilege';
  end if;
  if v_sub is null then
    raise exception 'core_subscription_id is required' using errcode = 'check_violation';
  end if;
  select * into v_outcome from chat.trial_outcome where lesson_id = p_lesson_id for update;
  if v_outcome.lesson_id is null then
    raise exception 'no decision is recorded for this trial yet' using errcode = 'check_violation';
  end if;
  if v_outcome.result <> 'subscribed' then
    raise exception 'Sales recorded this trial as not subscribed' using errcode = 'check_violation';
  end if;
  if v_outcome.confirmed_at is not null then
    if v_outcome.core_subscription_ref is distinct from v_sub then
      raise exception 'this trial is already confirmed by another Core subscription' using errcode = 'check_violation';
    end if;
    return 'duplicate';
  end if;

  if v_child is not null then
    select l.id into v_learner from chat.learner l
     where l.core_child_id = v_child and l.organization_id = v_outcome.organization_id;
  end if;

  perform set_config('chat.confirming_trial', 'on', true);
  update chat.trial_outcome
     set confirmed_at = now(), core_subscription_ref = v_sub, core_child_ref = v_child
   where lesson_id = p_lesson_id;
  if v_learner is not null then
    select prospect_id into v_prospect from chat.lesson where id = p_lesson_id;
    update chat.trial_prospect set learner_id = v_learner where id = v_prospect and learner_id is null;
  end if;
  perform set_config('chat.confirming_trial', 'off', true);

  return case when v_learner is not null then 'confirmed' else 'confirmed_awaiting_student' end;
end;
$$;

revoke all on function chat.confirm_trial_subscription(uuid, text, text) from public, anon, authenticated, chat_app;

-- A learner arriving (or gaining its Core id) after the confirmation links the
-- prospects confirmed for that Core child in its organization. Only on the
-- server side: the prospect's guard refuses the link to anyone else, and a
-- request-role write to a learner must not fail because of it.
create or replace function chat.link_confirmed_trials_to_learner()
returns trigger
language plpgsql
as $$
begin
  if new.core_child_id is null or not chat.caller_is_server_side() then
    return null;
  end if;
  perform set_config('chat.confirming_trial', 'on', true);
  update chat.trial_prospect p
     set learner_id = new.id
    from chat.lesson les
    join chat.trial_outcome o on o.lesson_id = les.id
   where les.prospect_id = p.id
     and p.learner_id is null
     and p.organization_id = new.organization_id
     and o.confirmed_at is not null
     and o.core_child_ref = new.core_child_id;
  perform set_config('chat.confirming_trial', 'off', true);
  return null;
end;
$$;

create trigger learner_links_confirmed_trials
  after insert or update of core_child_id on chat.learner
  for each row execute function chat.link_confirmed_trials_to_learner();

revoke all on function chat.link_confirmed_trials_to_learner() from public;
