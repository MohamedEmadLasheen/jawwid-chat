-- PD-25 (2026-10-22): a parent recovers their own account, without the academy.
--
-- Two self-service ways in, both ending at the PD-21 completion
-- (POST /auth/password-reset: login + code + a password of their own):
--
--   * forgot password -- the parent types their sign-in e-mail; a one-time code
--     is E-MAILED to that address (the account's subject).
--   * forgot e-mail   -- the parent types their phone; a one-time code is sent
--     by WHATSAPP to the phone in the administration's parent file (PD-17), the
--     contact method the academy already holds. Once the code checks out the
--     parent is told the sign-in e-mail and may set a new password with it.
--
-- Owner decisions (PD-25): e-mail for the password, WhatsApp for the e-mail;
-- the parent-file phone is trusted as the parent's verified phone.
--
-- One code table for both worlds: an administrator's code (channel 'admin',
-- issued_by the staff member) and a self-service one (channel 'email' or
-- 'whatsapp', no issuer). One live code per account still holds -- the newest
-- request wins -- so the completion path stays the single place a password is
-- set by code.
--
-- verified_at: the forgot-e-mail flow checks the code BEFORE the parent decides
-- whether to set a new password. The check stamps verified_at and leaves the
-- code live, so the same code then completes a reset; wrong guesses at either
-- step spend the same five tries.

alter table chat.password_reset_code
  add column channel text not null default 'admin'
    constraint password_reset_code_channel check (channel in ('admin', 'email', 'whatsapp')),
  add column verified_at timestamptz,
  alter column issued_by drop not null,
  add constraint password_reset_code_issuer_matches_channel check ((channel = 'admin') = (issued_by is not null));

comment on column chat.password_reset_code.channel is
  'PD-25: admin = issued by staff (PD-21) and handed over by hand; email / whatsapp = asked for by the parent and sent to the contact method on file.';
comment on column chat.password_reset_code.verified_at is
  'PD-25: when the forgot-e-mail flow confirmed the code. The code stays live for a reset until used, superseded or expired.';

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

    if new.channel = 'admin' then
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
    elsif v_target_kind is distinct from 'family' then
      -- PD-25 is the parents' recovery: staff and teachers go through an administrator.
      raise exception 'only a parent account recovers itself' using errcode = 'check_violation';
    end if;

    new.created_at := now();
    new.attempts := 0;
    new.used_at := null;
    new.superseded_at := null;
    new.verified_at := null;
    if new.expires_at > now() + interval '1 day' then
      raise exception 'a password reset code lives at most a day' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.id, new.organization_id, new.account_id, new.issued_by, new.channel, new.code_hash, new.reason, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.issued_by, old.channel, old.code_hash, old.reason, old.created_at, old.expires_at) then
    raise exception 'a password reset code''s identity never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.verified_at is not null and new.verified_at is distinct from old.verified_at) then
    raise exception 'a password reset code only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function chat.guard_password_reset_code() from public;
