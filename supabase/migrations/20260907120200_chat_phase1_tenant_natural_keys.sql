-- Jawwid Chat -- tenancy M-2: natural keys become per organization.
--
-- THE GAP, AND WHY IT IS A BOUNDARY GAP RATHER THAN A TIDINESS ONE
--
-- Three columns were globally UNIQUE while the rows they identify belong to a
-- tenant: chat.device_token.token, chat.call.room_name and
-- chat.notification.dedupe_key. For a single tenant that is merely wrong; the
-- push token is worse than wrong.
--
--   POSSIBLE TODAY. NotificationService.registerDevice() upserts on the token
--   and, on conflict, MOVES the row to the caller ("a token can move between
--   accounts when a device is handed over"). A push token is not a secret --
--   it is handed to a push provider, it appears in client logs, it is
--   recoverable from a device. Anyone who learns one and can authenticate as
--   ANY account can register it and take delivery of that device's
--   notifications. Across a tenant boundary that is a cross-tenant hijack;
--   within one it is still one account capturing another's notifications.
--
-- The uniqueness is therefore scoped to the organization, AND the hand-over is
-- constrained to stay inside one -- because uniqueness alone would still let
-- two accounts in the same tenant pass a token between them silently.

-- ---------------------------------------------------------------------------
-- 1. Push tokens
-- ---------------------------------------------------------------------------

alter table chat.device_token drop constraint if exists device_token_token_key;
drop index if exists chat.device_token_token_key;

create unique index if not exists device_token_token_per_organization_key
  on chat.device_token (organization_id, token);

comment on index chat.device_token_token_per_organization_key is
  'A push token identifies a device within ONE organization. Globally unique '
  'would let a registration in one tenant collide with -- and capture -- a '
  'device in another.';

-- A token may move between accounts of the same organization (a real device
-- handed over, or a re-install onto a re-used token), and never between
-- organizations. Enforced here rather than in the service so the rule holds for
-- a direct SQL session too.
create or replace function chat.guard_device_token_handover()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.organization_id is distinct from old.organization_id then
    raise exception
      'a push token may not move between organizations (token belongs to %)',
      old.organization_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists device_token_handover_is_guarded on chat.device_token;
create trigger device_token_handover_is_guarded
  before update on chat.device_token
  for each row execute function chat.guard_device_token_handover();

-- ---------------------------------------------------------------------------
-- 2. Call rooms and notification dedupe keys
-- ---------------------------------------------------------------------------
-- Neither is exploitable the way a push token is -- a room name is server-minted
-- with a uuid in it, and a dedupe key is derived from ids that already carry a
-- tenant -- but both are natural keys on tenant-owned rows, and a second
-- academy must not be able to collide with the first's.

alter table chat.call drop constraint if exists call_room_name_key;
drop index if exists chat.call_room_name_key;
create unique index if not exists call_room_name_per_organization_key
  on chat.call (organization_id, room_name);

alter table chat.notification drop constraint if exists notification_dedupe_key_key;
drop index if exists chat.notification_dedupe_key_key;
create unique index if not exists notification_dedupe_key_per_organization_key
  on chat.notification (organization_id, dedupe_key);

-- ---------------------------------------------------------------------------
-- 3. What M-2 still leaves open, on purpose
-- ---------------------------------------------------------------------------
-- chat.family.core_parent_id and the other core_* identifiers stay globally
-- unique. They are identifiers ISSUED BY Jawwid Core, and Core is one system:
-- two academies sharing it would share its id space, so per-organization
-- uniqueness there would be a lie about where the number comes from. If a
-- second Core is ever introduced, that is the migration -- and it is a Core
-- integration decision, not a chat one.

-- ---------------------------------------------------------------------------
-- 4. A supervisor from another organization
-- ---------------------------------------------------------------------------
--
-- FOUND BY THE PHASE 1 CLOSURE AUDIT, and it is the sharper half of M-2.
--
-- chat.guard_family_assignment() checked that the assignment row's
-- organization matched the FAMILY's, and that the staff member was an active,
-- non-departmental supervisor. It never compared the STAFF member's
-- organization to anything. Since the row takes the family's organization, a
-- manager could assign one of their families to a supervisor belonging to a
-- DIFFERENT academy -- who then held full scope over it, entirely legitimately,
-- through every check downstream.
--
-- It is the one cross-tenant path that the restrictive RLS policies could not
-- catch, because every row involved was correctly stamped with its own tenant.
-- Only the RELATIONSHIP between them crossed the boundary.

create or replace function chat.guard_family_assignment()
returns trigger
language plpgsql
as $$
declare
  v_family_org uuid;
  v_staff_org  uuid;
  v_role       text;
begin
  select f.organization_id into v_family_org from chat.family f where f.id = new.family_id;
  select s.organization_id, s.role into v_staff_org, v_role
    from chat.staff s
   where s.id = new.staff_id and s.is_active and s.department is null;

  if v_role is null or v_role not in ('admin', 'coverage_admin') then
    raise exception
      'a family may only be assigned to an active admin or coverage admin (not %)',
      coalesce((select role from chat.staff where id = new.staff_id), 'unknown')
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from v_family_org then
    raise exception 'cross-organization assignment refused' using errcode = 'check_violation';
  end if;

  -- The check that was missing.
  if v_staff_org is distinct from v_family_org then
    raise exception
      'cross-organization assignment refused: supervisor belongs to organization %, family to %',
      v_staff_org, v_family_org
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
