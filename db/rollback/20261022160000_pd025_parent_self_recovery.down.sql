-- Roll back 20261022160000_chat_pd025_parent_self_recovery (PD-25 parent self-recovery).
--
-- Self-service codes have no issuer, which the PD-21 table cannot hold, so they
-- are removed first (they are short-lived and hold no password; the audit_log
-- rows account.recovery_* stay). The guard forbids deletes, so it is lifted for
-- that one statement inside this transaction. Then the PD-21 guard is restored
-- verbatim.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022160000_pd025_parent_self_recovery.down.sql

alter table chat.password_reset_code disable trigger password_reset_code_is_coherent;
delete from chat.password_reset_code where channel <> 'admin';
alter table chat.password_reset_code enable trigger password_reset_code_is_coherent;

alter table chat.password_reset_code
  drop constraint password_reset_code_issuer_matches_channel,
  drop column verified_at,
  drop column channel,
  alter column issued_by set not null;

create or replace function chat.guard_password_reset_code()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_target_kind  text;
  v_target_org   uuid;
  v_target_role  text;
  v_issuer_role  text;
  v_issuer_acct  uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a password reset code is never deleted' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select a.kind, a.organization_id into v_target_kind, v_target_org
      from chat.account a where a.id = new.account_id;
    if v_target_org is distinct from new.organization_id then
      raise exception 'a password reset code is for an account of its own organization' using errcode = 'check_violation';
    end if;

    select s.role, s.account_id into v_issuer_role, v_issuer_acct
      from chat.staff s
     where s.id = new.issued_by and s.organization_id = new.organization_id
       and s.is_active and s.left_at is null;
    if v_issuer_role is null then
      raise exception 'a password reset code is issued by active staff of the same organization' using errcode = 'check_violation';
    end if;
    if v_issuer_acct = new.account_id then
      raise exception 'nobody resets their own password this way' using errcode = 'check_violation';
    end if;

    if v_target_kind = 'staff' then
      select s.role into v_target_role from chat.staff s where s.account_id = new.account_id;
      if v_target_role = 'super_admin' then
        raise exception 'the super admin''s password is never reset by an administrator' using errcode = 'check_violation';
      end if;
      if v_issuer_role <> 'super_admin' then
        raise exception 'only the super admin resets a staff member''s password' using errcode = 'check_violation';
      end if;
    end if;

    new.created_at := now();
    new.attempts := 0;
    new.used_at := null;
    new.superseded_at := null;
    if new.expires_at > now() + interval '1 day' then
      raise exception 'a password reset code lives at most a day' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.id, new.organization_id, new.account_id, new.issued_by, new.code_hash, new.reason, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.issued_by, old.code_hash, old.reason, old.created_at, old.expires_at) then
    raise exception 'a password reset code''s identity never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'a password reset code only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function chat.guard_password_reset_code() from public;

delete from chat.schema_migrations where version = '20261022160000_chat_pd025_parent_self_recovery';
