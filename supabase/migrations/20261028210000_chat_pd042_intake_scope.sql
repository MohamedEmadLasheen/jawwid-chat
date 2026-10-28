-- PD-42 PR-2 (2026-10-28) -- the Sales scope at the database (owner safeguard
-- S3), and a Sales owner's right to edit their families' contact record.
--
-- Record: docs/product/pd042-direct-enrolment-plan.md §4.3, §15 S3.
--
-- THE SWITCH. chat.sales_family_scope() (PR-1) reads chat.config
-- 'sales.family_scope', written by the API at boot from SALES_FAMILY_SCOPE.
-- Absent or anything but 'own' = 'all': every Sales member reaches every
-- family, exactly as before PD-42. The owner turns it to 'own' only after the
-- intake is complete and verified (D2); the Sales manager keeps every family.
--
-- WHAT IS NEW
--
--   chat.sales_scope_refuses(staff, family)
--       true only while the switch is 'own', for a Sales MEMBER (not the
--       manager) who does not own the family (chat.staff_owns_family).
--   a write guard on every family-scoped table a Sales member writes:
--       parent_file, family_billing, family_instalment, payment_request,
--       payment, learner_subscription. Each refuses the write its actor column
--       names when sales_scope_refuses says so. One function per table (a
--       shared trigger cannot read a column only one table has). Reads are
--       server-side only (no request-role grants): the API's scope is their gate.
--   parents.edit for the Sales bundles (manager:sales, supervisor:sales): the
--       service limits a Sales member to the families they own
--       (BillingAccess.editOwnedOnly), whatever the switch says.
--
-- Nothing changes while the switch is 'all'.
--
-- Down: drop the six zz_pd042_sales_scope triggers and their functions, and
-- chat.sales_scope_refuses; delete the parents.edit bundle rows (under
-- chat.pd040_catalogue_change).

create or replace function chat.sales_scope_refuses(p_staff uuid, p_family uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select p_staff is not null
     and p_family is not null
     and chat.sales_family_scope() = 'own'
     and chat.sales_department_role(p_staff) = 'member'
     and not chat.staff_owns_family(p_staff, p_family);
$$;

comment on function chat.sales_scope_refuses(uuid, uuid) is
  'PD-42 S3: while sales.family_scope is ''own'', a Sales member handles only the families they own. Always false while it is ''all''.';

-- ---------------------------------------------------------------------------
-- The write guards. They run after each table's own BEFORE triggers (zz_),
-- which fill organization and family columns.
-- ---------------------------------------------------------------------------

create or replace function chat.pd042_sales_scope_parent_file()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if chat.sales_scope_refuses(new.updated_by, (select c.family_id from chat.contact c where c.id = new.contact_id)) then
    raise exception 'a Sales supervisor handles only their own families' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger zz_pd042_sales_scope
  before insert or update on chat.parent_file
  for each row execute function chat.pd042_sales_scope_parent_file();

create or replace function chat.pd042_sales_scope_family_billing()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if chat.sales_scope_refuses(new.updated_by, new.family_id) then
    raise exception 'a Sales supervisor handles only their own families' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger zz_pd042_sales_scope
  before insert or update on chat.family_billing
  for each row execute function chat.pd042_sales_scope_family_billing();

create or replace function chat.pd042_sales_scope_family_instalment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_actor := new.created_by;
  elsif new.voided_by is distinct from old.voided_by then
    v_actor := new.voided_by;
  else
    v_actor := new.paid_recorded_by;
  end if;
  if chat.sales_scope_refuses(v_actor, new.family_id) then
    raise exception 'a Sales supervisor handles only their own families' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger zz_pd042_sales_scope
  before insert or update on chat.family_instalment
  for each row execute function chat.pd042_sales_scope_family_instalment();

create or replace function chat.pd042_sales_scope_payment_request()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid;
begin
  -- A trial's request has no family yet: trials stay every Sales member's.
  v_actor := case when tg_op = 'INSERT' then new.created_by else new.cancelled_by end;
  if tg_op = 'UPDATE' and new.cancelled_by is not distinct from old.cancelled_by then
    return new;
  end if;
  if chat.sales_scope_refuses(v_actor, new.family_id) then
    raise exception 'a Sales supervisor handles only their own families' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger zz_pd042_sales_scope
  before insert or update on chat.payment_request
  for each row execute function chat.pd042_sales_scope_payment_request();

create or replace function chat.pd042_sales_scope_payment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_actor := new.recorded_by;
  elsif new.voided_by is distinct from old.voided_by then
    v_actor := new.voided_by;
  else
    return new;
  end if;
  if chat.sales_scope_refuses(v_actor, new.family_id) then
    raise exception 'a Sales supervisor handles only their own families' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger zz_pd042_sales_scope
  before insert or update on chat.payment
  for each row execute function chat.pd042_sales_scope_payment();

create or replace function chat.pd042_sales_scope_learner_subscription()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_actor := new.created_by;
  elsif new.voided_by is distinct from old.voided_by then
    v_actor := new.voided_by;
  else
    return new;
  end if;
  if chat.sales_scope_refuses(v_actor, new.family_id) then
    raise exception 'a Sales supervisor handles only their own families' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger zz_pd042_sales_scope
  before insert or update on chat.learner_subscription
  for each row execute function chat.pd042_sales_scope_learner_subscription();

-- ---------------------------------------------------------------------------
-- The permission rows (PD-40's catalogue changes only by migration)
-- ---------------------------------------------------------------------------

select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd042b catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'sales', 'parents.edit'),
  ('supervisor', 'sales', 'parents.edit');
-- END GENERATED pd042b catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);

-- ---------------------------------------------------------------------------
-- Fail closed
-- ---------------------------------------------------------------------------

revoke all on function chat.sales_scope_refuses(uuid, uuid) from public;
revoke all on function chat.pd042_sales_scope_parent_file() from public;
revoke all on function chat.pd042_sales_scope_family_billing() from public;
revoke all on function chat.pd042_sales_scope_family_instalment() from public;
revoke all on function chat.pd042_sales_scope_payment_request() from public;
revoke all on function chat.pd042_sales_scope_payment() from public;
revoke all on function chat.pd042_sales_scope_learner_subscription() from public;
