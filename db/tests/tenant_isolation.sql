-- Tenant isolation regression suite (PRD 2.3).
--
-- Proves that organization_id is a real boundary and not a decorative column:
-- reads, writes and cross-tenant references are all rejected for a caller in
-- another organization.
--
-- Runs as `authenticated`, which does NOT bypass RLS. Running these as postgres
-- would pass trivially and prove nothing -- superusers bypass every policy.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Two tenants, one family each
-- ---------------------------------------------------------------------------

insert into chat.organization (id, slug, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'org-a', 'Org A'),
  ('00000000-0000-0000-0000-0000000000b1', 'org-b', 'Org B')
on conflict (id) do nothing;

-- Phase 1: an account carries a lifecycle status, and only an `active` one
-- resolves. `provisioned` (the default) is deliberately not enough to see
-- anything, which is why these fixtures set it explicitly.
insert into chat.account (id, subject, kind, status, organization_id) values
  ('00000000-0000-0000-0000-0000000000a2', 'subject-a', 'staff', 'active', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', 'subject-b', 'staff', 'active', '00000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into chat.staff (id, account_id, name, role, organization_id) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', 'Admin A', 'admin', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', 'Admin B', 'admin', '00000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into chat.family (id, display_name, owner_id, organization_id) values
  ('00000000-0000-0000-0000-0000000000a4', 'Family A', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b4', 'Family B', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

grant usage on schema chat to authenticated;
grant select, insert, update, delete on chat.family, chat.contact, chat.organization to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function pg_temp.check(label text, ok boolean)
returns void language plpgsql as $$
begin
  if ok then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

-- Number of rows a statement actually touched. RLS silently filters UPDATE and
-- DELETE rather than raising, so "0 rows affected" is the denial signal.
create or replace function pg_temp.affected(stmt text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- True only when the statement was rejected FOR THE EXPECTED REASON.
--
-- A bare `exception when others then return true` would let an unrelated
-- failure (a missing NOT NULL column in a fixture, say) masquerade as tenant
-- isolation working. That very nearly happened while writing this suite, so the
-- expected message is asserted explicitly.
create or replace function pg_temp.denied_because(stmt text, needle text)
returns boolean language plpgsql as $$
declare msg text;
begin
  execute stmt;
  return false;                       -- succeeded: not denied at all
exception when others then
  get stacked diagnostics msg = message_text;
  if position(needle in msg) = 0 then
    raise exception 'rejected, but for the wrong reason: %', msg;
  end if;
  return true;
end;
$$;

-- Succeeded outright, with no exception of any kind.
create or replace function pg_temp.allowed(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception when others then
  return false;
end;
$$;

set local role authenticated;
set local chat.actor_subject = 'subject-a';

-- ---------------------------------------------------------------------------
-- A · Reads are scoped to the caller's organization
-- ---------------------------------------------------------------------------

select pg_temp.check(
  'A1 caller in org A sees org A''s family',
  (select count(*) from chat.family where id = '00000000-0000-0000-0000-0000000000a4') = 1
);

select pg_temp.check(
  'A2 caller in org A cannot see org B''s family',
  (select count(*) from chat.family where id = '00000000-0000-0000-0000-0000000000b4') = 0
);

select pg_temp.check(
  'A3 an unscoped SELECT returns only org A rows',
  (select count(*) from chat.family
    where organization_id <> '00000000-0000-0000-0000-0000000000a1') = 0
);

-- ---------------------------------------------------------------------------
-- B · Writes cannot target another organization
-- ---------------------------------------------------------------------------

select pg_temp.check(
  'B1 inserting a family into org B is refused (WITH CHECK)',
  pg_temp.denied_because($$
    insert into chat.family (display_name, owner_id, organization_id)
    values ('smuggled', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1')
  $$, 'row-level security')
);

select pg_temp.check(
  'B2 org B''s family cannot be updated from org A',
  pg_temp.affected($$
    update chat.family set display_name = 'hijacked'
     where id = '00000000-0000-0000-0000-0000000000b4'
  $$) = 0
);

select pg_temp.check(
  'B3 org B''s family cannot be deleted from org A',
  pg_temp.affected($$
    delete from chat.family where id = '00000000-0000-0000-0000-0000000000b4'
  $$) = 0
);

-- ---------------------------------------------------------------------------
-- C · Cross-organization references are refused
-- ---------------------------------------------------------------------------
-- The leak a NOT NULL column alone would not close: a row legitimately inside
-- org A pointing at a parent in org B.

reset role;
set local chat.actor_organization = '00000000-0000-0000-0000-0000000000a1';

select pg_temp.check(
  'C1 a contact in org A cannot point at a family in org B',
  pg_temp.denied_because($$
    insert into chat.contact (family_id, name, role_preset, organization_id)
    values ('00000000-0000-0000-0000-0000000000b4', 'cross tenant', 'authorized_contact',
            '00000000-0000-0000-0000-0000000000a1')
  $$, 'cross-organization reference')
);

select pg_temp.check(
  'C2 the same contact against its own organization''s family is allowed',
  pg_temp.allowed($$
    insert into chat.contact (family_id, name, role_preset, organization_id)
    values ('00000000-0000-0000-0000-0000000000a4', 'legitimate', 'authorized_contact',
            '00000000-0000-0000-0000-0000000000a1')
  $$)
);

-- ---------------------------------------------------------------------------
-- D · An unresolved tenant sees nothing (fail closed)
-- ---------------------------------------------------------------------------

reset role;
set local chat.actor_organization = '';
set local chat.actor_subject = 'nobody-at-all';
set local role authenticated;

select pg_temp.check(
  'D1 a caller with no resolvable organization sees no families',
  (select count(*) from chat.family) = 0
);

reset role;

rollback;
