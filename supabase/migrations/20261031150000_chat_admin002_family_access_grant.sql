-- ADMIN-002 (owner decision 2026-10-31) -- exceptional, time-boxed access to
-- ONE family's parent accounts.
--
-- Owner: "Protect family privacy and prevent unrestricted access to families
-- outside a supervisor's assigned scope. Exceptional access should only be
-- granted through a clear authorization process. It must be temporary,
-- purpose-specific, and properly logged. Once the authorized period ends,
-- access must automatically be revoked." And: no notification to the parent
-- when authorized staff access their account for support.
--
-- WHAT A GRANT OPENS: account administration of that family's parent accounts
-- (list, reset, suspend, reactivate, sign-out, sessions, a support session) --
-- nothing else. PD-8's chat.staff_reaches_family is untouched: a grant opens
-- no chat, billing or profile. The API reads it in AccountAdminScope.
--
-- EXPIRY NEEDS NO JOB to take effect: a grant is active only while
-- revoked_at IS NULL and starts_at <= now() < ends_at, checked on every read
-- (chat.family_access_grant_active). The worker's sweep only writes the
-- 'family_access.expired' audit row near the moment, once (expiry_audited_at).
--
-- WHO: the organization's Operations Manager or the super admin grants, to a
-- live Operations staff member of the same organization, never to
-- themselves. At most 7 days. Nothing is deleted; a row changes only by one
-- revocation and one expiry-audit stamp.

create table chat.family_access_grant (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references chat.organization (id),
  family_id          uuid not null references chat.family (id),
  grantee_id         uuid not null references chat.staff (id),
  granted_by         uuid not null references chat.staff (id),
  purpose            text not null check (length(btrim(purpose)) between 1 and 500),
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz not null,
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  revoked_by         uuid references chat.staff (id),
  revoke_reason      text check (revoke_reason is null or length(btrim(revoke_reason)) between 1 and 500),
  -- The sweep's 'family_access.expired' audit row was written (once).
  expiry_audited_at  timestamptz,
  constraint family_access_grant_not_self check (grantee_id <> granted_by),
  constraint family_access_grant_window check (ends_at > starts_at and ends_at <= starts_at + interval '7 days'),
  constraint family_access_grant_revoke_is_whole
    check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null))
);

comment on table chat.family_access_grant is
  'ADMIN-002: a time-boxed, purpose-bound grant of account administration over ONE family''s parent accounts to one Operations staff member. Active while not revoked and starts_at <= now() < ends_at.';

create index family_access_grant_live on chat.family_access_grant (grantee_id, family_id) where revoked_at is null;
create index family_access_grant_to_audit on chat.family_access_grant (ends_at)
  where revoked_at is null and expiry_audited_at is null;

-- Is this grant active at p_at? The one rule every reader uses.
create function chat.family_access_grant_active(p_grantee uuid, p_family uuid, p_at timestamptz default now())
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select g.id from chat.family_access_grant g
   where g.grantee_id = p_grantee and g.family_id = p_family
     and g.revoked_at is null and g.starts_at <= p_at and p_at < g.ends_at
   order by g.ends_at desc
   limit 1;
$$;

create function chat.guard_family_access_grant()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_grantor record;
  v_grantee record;
  v_family_org uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a family access grant is never deleted' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- Only one revocation and one expiry-audit stamp; everything else is the record.
    if new.id <> old.id or new.organization_id <> old.organization_id or new.family_id <> old.family_id
       or new.grantee_id <> old.grantee_id or new.granted_by <> old.granted_by or new.purpose <> old.purpose
       or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at or new.created_at <> old.created_at then
      raise exception 'a family access grant is a record: only its revocation and expiry stamp change'
        using errcode = 'check_violation';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'a family access grant is revoked once' using errcode = 'check_violation';
    end if;
    if old.expiry_audited_at is not null and new.expiry_audited_at is distinct from old.expiry_audited_at then
      raise exception 'a grant''s expiry is audited once' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select id, role, organization_id, (is_active and left_at is null) as live into v_grantor
    from chat.staff where id = new.granted_by;
  select id, role, organization_id, (is_active and left_at is null) as live into v_grantee
    from chat.staff where id = new.grantee_id;
  select organization_id into v_family_org from chat.family where id = new.family_id;

  if v_grantor.id is null or not v_grantor.live
     or not (v_grantor.role = 'super_admin'
             or (v_grantor.role = 'manager' and exists (
                   select 1 from chat.department d
                    where d.kind = 'operations' and d.manager_id = v_grantor.id
                      and d.organization_id = new.organization_id))) then
    raise exception 'only the Operations Manager or the super admin grants family access'
      using errcode = 'insufficient_privilege';
  end if;
  if v_grantee.id is null or not v_grantee.live
     or not exists (
       select 1 from chat.department_member m join chat.department d on d.id = m.department_id
        where m.staff_id = v_grantee.id and d.kind = 'operations' and d.organization_id = new.organization_id) then
    raise exception 'family access is granted to a live Operations staff member' using errcode = 'check_violation';
  end if;
  if v_grantor.organization_id <> new.organization_id or v_grantee.organization_id <> new.organization_id
     or v_family_org is distinct from new.organization_id then
    raise exception 'a family access grant cannot cross organizations' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger family_access_grant_guard
  before insert or update or delete on chat.family_access_grant
  for each row execute function chat.guard_family_access_grant();

-- Fail closed: the API's server connection reads and writes it; no request role does.
revoke all on function chat.family_access_grant_active(uuid, uuid, timestamptz) from public;
revoke all on function chat.guard_family_access_grant() from public;
alter table chat.family_access_grant enable row level security;
revoke all on chat.family_access_grant from public, anon, authenticated, chat_app;
