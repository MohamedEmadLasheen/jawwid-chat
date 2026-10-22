-- PD-21 (2026-10-22): an administrator sets an account inactive, and back.
--
-- "Inactive" is chat.account.status = 'suspended' -- the reversible state
-- IDENTITY-MODEL §3 already defines ("temporarily blocked, reason required,
-- audited"). 'deactivated' stays what it was: permanent offboarding, which this
-- does not reverse.
--
-- SUSPENDING already has its operation: chat.deactivate_principal('account',
-- id, reason, requested_by, 'suspended') writes the coupled columns and the
-- RT-032 journal row. The API also revokes every session in the same
-- transaction, because deactivate_principal does not: without that, a
-- reactivated account's old refresh tokens would come back to life.
--
-- REACTIVATING had no operation at all. chat.reactivate_account below is the
-- only path from 'suspended' back to 'active', and it refuses everything else:
-- a deactivated (offboarded) account, a provisioned one, an active one.

create or replace function chat.reactivate_account(
  p_account_id  uuid,
  p_reason      text
) returns boolean
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_changed integer;
begin
  if not chat.caller_is_server_side() then
    raise exception 'PD-21: only a server-side writer may reactivate an account (invoking role %)', chat.invoking_role()
      using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reactivation requires a reason' using errcode = 'check_violation';
  end if;

  update chat.account
     set status = 'active', is_active = true, deactivated_at = null, deactivated_by = null
   where id = p_account_id and status = 'suspended';
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

comment on function chat.reactivate_account(uuid, text) is
  'PD-21. Returns a SUSPENDED account to active (true), or changes nothing (false). Never reverses a '
  'deactivation. Revoked sessions stay revoked: the person signs in again. Server-side callers only.';

revoke execute on function chat.reactivate_account(uuid, text) from public, anon, authenticated, chat_app;
grant  execute on function chat.reactivate_account(uuid, text) to service_role;
