-- Jawwid Chat -- ownership, owner-locking and offboarding (brief SS3, SS5, SS8).
--
-- Brief SS12 non-negotiables enforced here, in the database rather than in a
-- service layer any caller could bypass:
--   * "Owner changes only via transfer_ownership(); writes audit_log in the
--      same transaction."
--   * "Coverage cannot close owner_locked cases or change owners."
--   * Relationship case types are owner-locked automatically, from config.

-- Who is acting -------------------------------------------------------------
-- Resolved from the Supabase session first. Server-side jobs that legitimately
-- act without a session set chat.actor_staff_id explicitly, so an action is
-- never attributed to nobody by accident.

create or replace function chat.current_staff_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    (select s.id from chat.staff s where s.auth_user_id = auth.uid() and s.is_active),
    nullif(current_setting('chat.actor_staff_id', true), '')::uuid
  )
$$;

create or replace function chat.staff_role(p_staff_id uuid)
returns text
language sql
stable
as $$ select role from chat.staff where id = p_staff_id $$;

-- Ownership -----------------------------------------------------------------

create or replace function chat.guard_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and coalesce(current_setting('chat.transferring_ownership', true), '') <> 'on' then
    raise exception
      'family.owner_id changes only through chat.transfer_ownership() (brief SS12)'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger family_owner_is_guarded
  before update of owner_id on chat.family
  for each row execute function chat.guard_owner_change();

create or replace function chat.transfer_ownership(
  p_family_id   uuid,
  p_to_staff_id uuid,
  p_reason      text,
  p_actor_id    uuid default null
) returns void
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_from  uuid;
  v_name  text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'ownership transfer requires a reason'
      using errcode = 'check_violation';
  end if;

  -- Brief SS2: transferring ownership is a manager action.
  if chat.staff_role(v_actor) is distinct from 'manager' then
    raise exception 'only a manager may transfer ownership'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from chat.staff
                 where id = p_to_staff_id and is_active and role in ('admin', 'coverage')) then
    raise exception 'the new owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select owner_id, display_name into v_from, v_name
  from chat.family where id = p_family_id for update;

  if v_from is null then
    raise exception 'family % does not exist', p_family_id using errcode = 'no_data_found';
  end if;

  if v_from = p_to_staff_id then
    return;  -- already owned by the target; nothing to record
  end if;

  perform set_config('chat.transferring_ownership', 'on', true);
  update chat.family set owner_id = p_to_staff_id where id = p_family_id;
  perform set_config('chat.transferring_ownership', 'off', true);

  -- Same transaction as the change itself (brief SS3).
  perform chat.write_audit(
    v_actor, 'ownership_transferred', 'family', p_family_id, p_reason,
    jsonb_build_object('owner_id', v_from),
    jsonb_build_object('owner_id', p_to_staff_id));

  perform chat.log_event(
    'ownership_transferred', p_family_id, null, 'staff', v_actor,
    jsonb_build_object('from_staff_id', v_from, 'to_staff_id', p_to_staff_id,
                       'reason', p_reason, 'family_name', v_name));
end;
$$;

comment on function chat.transfer_ownership is
  'The only way family.owner_id changes. Coverage never reaches it: the actor '
  'must hold the manager role. The event row is what notifies the family '
  '(brief SS3); delivery itself belongs to the notification worker.';

-- Owner-locked cases --------------------------------------------------------

create or replace function chat.apply_owner_lock()
returns trigger
language plpgsql
as $$
begin
  new.owner_locked :=
    new.type in (select jsonb_array_elements_text(chat.config_json('cases.owner_locked_types')))
    or (new.type = 'complaint'
        and new.severity is not distinct from chat.config_text('cases.owner_locked_complaint_severity'));
  return new;
end;
$$;

comment on function chat.apply_owner_lock is
  'owner_locked is computed from chat.config, never supplied by the caller, so '
  'the relationship-case list can be changed by the manager without a deploy.';

create trigger support_case_owner_lock
  before insert or update of type, severity on chat.support_case
  for each row execute function chat.apply_owner_lock();

-- Brief SS5: "Coverage never ... closes relationship cases."
create or replace function chat.guard_owner_locked_case_closure()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := chat.current_staff_id();
  v_owner uuid;
begin
  if not old.owner_locked then
    return new;
  end if;
  if new.status not in ('resolved', 'closed') or old.status in ('resolved', 'closed') then
    return new;
  end if;

  select owner_id into v_owner from chat.family where id = new.family_id;

  if v_actor is null then
    raise exception 'closing an owner-locked case requires an identified actor'
      using errcode = 'insufficient_privilege';
  end if;

  if v_actor <> v_owner and chat.staff_role(v_actor) is distinct from 'manager' then
    raise exception
      'only the family owner or a manager may resolve an owner-locked % case (brief SS5)', old.type
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger support_case_owner_locked_closure
  before update of status on chat.support_case
  for each row execute function chat.guard_owner_locked_case_closure();

-- Deactivation safety -------------------------------------------------------
-- Brief SS8 offboarding is one manager action. Until families are reassigned,
-- deactivating their owner would leave them without an active owner, so the
-- database refuses it outright.

create or replace function chat.guard_staff_deactivation()
returns trigger
language plpgsql
as $$
declare
  v_owned integer;
begin
  if old.is_active and not new.is_active then
    select count(*) into v_owned from chat.family where owner_id = new.id;
    if v_owned > 0 then
      raise exception
        'cannot deactivate %: still the primary owner of % family/families. '
        'Use chat.offboard_staff() to reassign them first.', old.name, v_owned
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_deactivation_is_guarded
  before update of is_active on chat.staff
  for each row execute function chat.guard_staff_deactivation();

-- Offboarding ---------------------------------------------------------------

create or replace function chat.offboard_staff(
  p_staff_id    uuid,
  p_reason      text,
  p_to_staff_id uuid default null,
  p_actor_id    uuid default null
) returns table (family_id uuid, new_owner_id uuid)
language plpgsql
as $$
declare
  v_actor      uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_targets    uuid[];
  v_family     record;
  v_index      integer := 0;
  v_new_owner  uuid;
  v_orphaned   integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;
  if chat.staff_role(v_actor) is distinct from 'manager' then
    raise exception 'only a manager may offboard staff' using errcode = 'insufficient_privilege';
  end if;

  if p_to_staff_id is not null then
    v_targets := array[p_to_staff_id];
  else
    -- Brief SS8: "transfer families evenly or to a named admin". This is a
    -- one-off manager action on a fixed set of families, NOT the runtime
    -- routing that brief SS12 forbids -- no message and no live family is ever
    -- assigned this way.
    select array_agg(s.id order by owned.n, s.name)
      into v_targets
      from chat.staff s
      left join lateral (
        select count(*) as n from chat.family f where f.owner_id = s.id
      ) owned on true
     where s.is_active and s.role in ('admin', 'coverage') and s.id <> p_staff_id;
  end if;

  if v_targets is null or cardinality(v_targets) = 0 then
    raise exception 'no active admin is available to take over these families'
      using errcode = 'restrict_violation';
  end if;

  for v_family in
    select id from chat.family where owner_id = p_staff_id order by display_name
  loop
    v_new_owner := v_targets[(v_index % cardinality(v_targets)) + 1];
    perform chat.transfer_ownership(
      v_family.id, v_new_owner,
      format('offboarding: %s', p_reason), v_actor);
    v_index := v_index + 1;
    family_id := v_family.id;
    new_owner_id := v_new_owner;
    return next;
  end loop;

  update chat.staff
     set is_active = false, left_at = coalesce(left_at, now()), presence = 'offline'
   where id = p_staff_id;

  -- Coverage rules pointing at, or covering, someone who has left are not
  -- deleted: the manager is shown them and decides (brief SS8).
  select count(*) into v_orphaned
    from chat.coverage_rule r
   where r.covering_id = p_staff_id or r.covered_id = p_staff_id;

  perform chat.write_audit(
    v_actor, 'staff_offboarded', 'staff', p_staff_id, p_reason,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));

  perform chat.log_event(
    'ownership_transferred', null, null, 'staff', v_actor,
    jsonb_build_object('offboarded_staff_id', p_staff_id,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));
end;
$$;

-- Families whose owner is gone, and coverage rules referencing departed staff.
-- Brief SS8: the manager is alerted rather than the system guessing.
create or replace view chat.orphaned_coverage_rule as
  select r.*,
         covering.name as covering_name,
         covering.is_active as covering_is_active,
         covered.name as covered_name,
         covered.is_active as covered_is_active
  from chat.coverage_rule r
  join chat.staff covering on covering.id = r.covering_id
  left join chat.staff covered on covered.id = r.covered_id
  where not covering.is_active or (covered.id is not null and not covered.is_active);
