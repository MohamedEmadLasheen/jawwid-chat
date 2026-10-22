-- PD-21 (2026-10-22): an administrator resets another account's password.
--
-- THE ADMINISTRATOR NEVER KNOWS A PASSWORD. The admin issues a one-time code
-- (6 digits, 10 minutes, 5 tries), is shown it ONCE, and passes it to the
-- person (by hand, over WhatsApp). The person types their login, the code and
-- a password of their own choosing. Only the code's sha-256 is stored -- unlike
-- the PD-16 sign-up code there is no relay copy: the issuing admin already holds
-- the code, and nobody else needs to read it back.
--
-- WHO MAY ISSUE ONE (owner decision, PD-21): any active staff member, for any
-- parent or teacher account in their organization; a staff account only by the
-- super admin; the super admin's own account never (the bootstrap CLI is its
-- only credential writer); one's own account never. AuthorizationService is the
-- runtime boundary (the API connects as the owner, RLS-STRATEGY §7); the
-- trigger below states the same rule so a direct writer cannot skip it.
--
-- Completing a reset sets the password, clears the lockout, and revokes every
-- session of the account in the same transaction (AuthService).

create table chat.password_reset_code (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  account_id       uuid not null references chat.account (id),
  issued_by        uuid not null references chat.staff (id),
  code_hash        text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  reason           text not null check (length(btrim(reason)) > 0),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  attempts         integer not null default 0 check (attempts between 0 and 5),
  used_at          timestamptz,
  superseded_at    timestamptz,
  constraint password_reset_code_expires_after_creation check (expires_at > created_at)
);

comment on table chat.password_reset_code is
  'PD-21: a one-time code an administrator issues so a person can set a new password. Hash only; short-lived; at most five tries; never deleted.';

create unique index password_reset_code_one_live on chat.password_reset_code (account_id)
  where used_at is null and superseded_at is null;
create index password_reset_code_account_created on chat.password_reset_code (account_id, created_at desc);

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

create trigger password_reset_code_is_coherent
  before insert or update or delete on chat.password_reset_code
  for each row execute function chat.guard_password_reset_code();

-- Request roles: none. Only the API (owner / service_role) reads or writes.
alter table chat.password_reset_code enable row level security;
revoke all on chat.password_reset_code from public, anon, authenticated, chat_app;
revoke all on function chat.guard_password_reset_code() from public;
