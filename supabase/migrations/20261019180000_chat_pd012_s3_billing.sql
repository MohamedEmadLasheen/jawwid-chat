-- PD-12 S3 (closed 2026-10-18) -- Instalment Payments: the family billing supervisor.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-12 §1, and
-- docs/admin/pd012-s3.md.
--
-- WHAT IS NEW
--
--   chat.family_billing_supervision   the ONE Operations supervisor responsible
--                                     for a family's FAMILY invoices (an invoice
--                                     that names no child). Set by the Operations
--                                     Manager or the super admin; never guessed.
--
-- WHAT IS NOT HERE: invoices. They are Jawwid Core's, read at request time and
-- never stored in Chat (PD-10). The chat.subscription mirror stays frozen.
--
-- THE BILLING SUPERVISOR REACHES THE FAMILY. They must supervise at least one of
-- the family's children (PD-8 chat.learner_supervision), because the invoice row
-- opens the family's conversation and the follow-up happens there: a responsible
-- supervisor who could not open it would be responsible for nothing. When a
-- change to the children's supervision leaves them supervising none of the
-- family's children, the assignment is cleared -- by the database, for every
-- writer, with an audit row -- and the family returns to the manager's
-- "No billing supervisor" list. The manager chooses again; nothing picks for them.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. Who is in the Operations department
-- ===========================================================================

-- 'manager' | 'member' | null -- the Operations twin of chat.teachers_department_role.
create or replace function chat.operations_department_role(p_staff uuid)
returns text
language sql
stable
as $$
  select case
    when exists (select 1 from chat.department d
                  where d.kind = 'operations' and d.manager_id = p_staff) then 'manager'
    when exists (select 1 from chat.department_member m
                   join chat.department d on d.id = m.department_id
                  where d.kind = 'operations' and m.staff_id = p_staff) then 'member'
  end;
$$;

revoke all on function chat.operations_department_role(uuid) from public;

-- ===========================================================================
-- 2. The family billing supervisor
-- ===========================================================================

create table chat.family_billing_supervision (
  family_id       uuid primary key references chat.family (id) on delete cascade,
  organization_id uuid not null,
  supervisor_id   uuid not null references chat.staff (id),
  assigned_by     uuid references chat.staff (id),
  assigned_at     timestamptz not null default now(),
  reason          text check (reason is null or length(btrim(reason)) between 1 and 500)
);

comment on table chat.family_billing_supervision is
  'PD-12: the Operations supervisor responsible for a family''s family-level invoices. Must supervise one of the family''s children; cleared (and audited) when they no longer do. Current state only; every change is in chat.audit_log.';

create index family_billing_supervision_supervisor_idx on chat.family_billing_supervision (supervisor_id);

-- Does p_staff supervise (PD-8 primary) at least one child of p_family?
create or replace function chat.supervises_a_child_of(p_staff uuid, p_family uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.learner_supervision ls
      join chat.learner l on l.id = ls.learner_id
     where l.family_id = p_family and ls.supervisor_id = p_staff);
$$;

revoke all on function chat.supervises_a_child_of(uuid, uuid) from public;

create or replace function chat.guard_family_billing_supervision()
returns trigger
language plpgsql
as $$
declare
  v_family_org uuid;
  v_staff      chat.staff%rowtype;
begin
  if tg_op = 'UPDATE' and new.family_id <> old.family_id then
    raise exception 'a billing supervision row stays with its family' using errcode = 'check_violation';
  end if;
  select organization_id into v_family_org from chat.family where id = new.family_id;
  select * into v_staff from chat.staff where id = new.supervisor_id;
  if v_family_org is null or v_staff.id is null then
    raise exception 'billing supervision references a row that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if v_staff.organization_id is distinct from v_family_org then
    raise exception 'a billing supervisor and the family belong to one organization'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_staff.is_active or v_staff.left_at is not null then
    raise exception 'an inactive staff member cannot be a billing supervisor'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from chat.department_member m
      join chat.department d on d.id = m.department_id
     where m.staff_id = new.supervisor_id and m.position = 'supervisor' and d.kind = 'operations'
  ) then
    raise exception 'a billing supervisor is a primary supervisor of the Operations department'
      using errcode = 'check_violation';
  end if;
  if not chat.supervises_a_child_of(new.supervisor_id, new.family_id) then
    raise exception 'a billing supervisor supervises one of the family''s children'
      using errcode = 'check_violation';
  end if;
  new.organization_id := v_family_org;
  return new;
end;
$$;

create trigger family_billing_supervision_is_coherent
  before insert or update on chat.family_billing_supervision
  for each row execute function chat.guard_family_billing_supervision();

-- ===========================================================================
-- 3. Clearing a billing supervisor who no longer reaches the family
-- ===========================================================================

-- Clear p_family's billing supervisor if they supervise none of its children
-- any more. System act: audited with no actor.
create or replace function chat.clear_stale_billing_supervisor(p_family uuid)
returns void
language plpgsql
as $$
declare
  v chat.family_billing_supervision%rowtype;
begin
  select * into v from chat.family_billing_supervision where family_id = p_family;
  if v.family_id is null or chat.supervises_a_child_of(v.supervisor_id, p_family) then
    return;
  end if;
  delete from chat.family_billing_supervision where family_id = p_family;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (null, 'family.billing_supervisor_cleared', 'family', p_family,
          jsonb_build_object('supervisorId', v.supervisor_id), null,
          'the billing supervisor no longer supervises a child of this family');
end;
$$;

revoke all on function chat.clear_stale_billing_supervisor(uuid) from public;

-- The two triggers below run as the owner (SECURITY DEFINER): clearing is a
-- system act, and a request role that may move a child must not fail on a
-- table it was never granted.
create or replace function chat.billing_follows_learner_supervision()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_family uuid;
begin
  -- On UPDATE the child stays in its family; on DELETE (including the cascade
  -- from a deleted learner, when the learner row may already be gone) the
  -- family is looked up best-effort and every family the old supervisor bills
  -- is re-checked otherwise.
  select family_id into v_family from chat.learner where id = old.learner_id;
  if v_family is not null then
    perform chat.clear_stale_billing_supervisor(v_family);
  else
    perform chat.clear_stale_billing_supervisor(b.family_id)
       from chat.family_billing_supervision b where b.supervisor_id = old.supervisor_id;
  end if;
  return null;
end;
$$;

create trigger learner_supervision_keeps_billing_coherent
  after update of supervisor_id or delete on chat.learner_supervision
  for each row execute function chat.billing_follows_learner_supervision();

create or replace function chat.billing_follows_learner_family()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  perform chat.clear_stale_billing_supervisor(old.family_id);
  return null;
end;
$$;

create trigger learner_family_keeps_billing_coherent
  after update of family_id on chat.learner
  for each row when (new.family_id is distinct from old.family_id)
  execute function chat.billing_follows_learner_family();

-- ===========================================================================
-- 4. Request roles: none
-- ===========================================================================

alter table chat.family_billing_supervision enable row level security;
revoke all on chat.family_billing_supervision from public, anon, authenticated, chat_app;

revoke all on function chat.guard_family_billing_supervision() from public;
revoke all on function chat.billing_follows_learner_supervision() from public;
revoke all on function chat.billing_follows_learner_family() from public;
