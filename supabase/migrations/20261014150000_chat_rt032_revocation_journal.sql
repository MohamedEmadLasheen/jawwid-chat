-- Jawwid Chat -- RT-032: every deactivation passes the realtime completion barrier.
--
-- THE DEFECT. A realtime delivery is authorized under FOR SHARE row locks and
-- emitted after a final liveness check (RT-009). If that delivery's connection
-- is lost after the check, the locks are released and a deactivation can
-- commit while the already-made decision is still in hand. Revocations made
-- through the API close that window with a completion barrier
-- (RealtimeGateway.confirmRevoked): they report success only after every API
-- node has fenced its in-flight decisions. A deactivation written to the
-- database (chat.offboard_staff, an operator, a future ingestion) never ran
-- that barrier at all -- it returned at its own commit.
--
-- THE CONTROL. Deactivation is a two-step act for EVERY writer:
--
--   1. COMMIT. Whoever writes it, the transaction that takes an account,
--      contact, staff member or teacher out of service (or deletes a live one)
--      also writes a row to chat.principal_revocation -- in the same
--      transaction, by an ENABLE ALWAYS trigger, so the row exists iff the
--      deactivation committed.
--   2. CONFIRM. An API node (RevocationConfirmer) claims the row, runs the
--      completion barrier, and only then stamps confirmed_at. A deactivation is
--      COMPLETE when confirmed_at is set, and not before: no realtime event
--      decided before the commit can be emitted after that stamp.
--
-- WHO MAY WRITE. Only a server-side writer: a superuser, a member of the chat
-- table owner, or a member of service_role (chat.caller_is_server_side(),
-- decided from the INVOKING role -- SET ROLE or the session user -- which a
-- request connection cannot raise). A request role (anon, authenticated,
-- chat_app) that tries is refused: deactivation has no request-path writer in
-- this API, and the RLS grants that would have allowed one were never used.
-- There is no setting, flag or GUC that opens this; the journal is written for
-- every permitted writer and cannot be skipped by one.
--
-- WHAT IS NOT BOUND HERE (the trust root, documented): a superuser or the table
-- owner can DISABLE the trigger, TRUNCATE a table (row triggers do not fire),
-- or drop this file's objects. Those are schema-owner acts outside any runtime
-- path, exactly like dropping any other guard.
--
-- TRANSACTION MODEL. The trigger reads only catalogs and inserts one new row:
-- it takes no lock on any chat row a delivery locks, so it adds no deadlock
-- edge; concurrent deactivations of one row serialize on the row itself and
-- the second sees nothing to change (no second journal row); a rolled-back
-- deactivation rolls back its journal row. It is ENABLE ALWAYS, so
-- session_replication_role = replica does not silence it.
--
-- EXISTING ROWS. Nothing is read, moved or rewritten. Rows already inactive
-- are not journaled (they are not a transition); chat.deactivate_principal()
-- journals one on request, so a retry still gets a barrier.
--
-- REVERSIBLE: db/rollback/20261014150000_rt032.down.sql (drops the triggers and
-- functions this file adds; keeps the journal and its rows).

-- PRECONDITION: the four principal tables with the columns this file reads.
do $pre$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'chat' and table_name = 'account' and column_name = 'status')
     or not exists (select 1 from information_schema.columns where table_schema = 'chat' and table_name = 'teacher' and column_name = 'left_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'chat' and table_name = 'staff' and column_name = 'left_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'chat' and table_name = 'contact' and column_name = 'account_id')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'RT-032 precondition failed: principal tables / service_role missing';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Who is calling. These two functions are byte-identical to the ones the
--    staff-profile work defines (20261014110100_chat_staff_profile_app_runtime);
--    on a history that has them this replaces each with itself.
-- ---------------------------------------------------------------------------

create or replace function chat.invoking_role()
returns name
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case when current_setting('role') in ('none', '') then session_user
              else current_setting('role')::name end
$$;

create or replace function chat.caller_is_server_side()
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select r.rolsuper
      or pg_has_role(r.rolname, (select c.relowner from pg_class c where c.oid = 'chat.family'::regclass), 'MEMBER')
      or pg_has_role(r.rolname, 'service_role', 'MEMBER')
    from pg_roles r
   where r.rolname = chat.invoking_role()
$$;

revoke execute on function chat.invoking_role() from public, anon;
grant  execute on function chat.invoking_role() to authenticated;
-- The journal trigger runs as the writer, and service_role is a writer: without
-- this, a service_role deactivation fails on the trigger's own identity check.
grant  execute on function chat.invoking_role() to service_role;

-- ---------------------------------------------------------------------------
-- 2. The journal
-- ---------------------------------------------------------------------------

create table if not exists chat.principal_revocation (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  principal_kind  text not null check (principal_kind in ('account', 'contact', 'staff', 'teacher')),
  principal_id    uuid not null,
  -- The login whose sockets and sessions this ends, when the row names one.
  account_id      uuid,
  transition      text not null check (transition in ('deactivated', 'suspended', 'deleted', 'already_inactive')),
  -- The invoking role (unforgeable by a request connection) -- WHO wrote it.
  writer          name not null,
  -- Labels supplied by chat.deactivate_principal(); informational only.
  reason          text,
  requested_by    uuid,
  recorded_at     timestamptz not null default now(),
  -- Completion. Set only by a node that ran the barrier after the commit.
  confirmed_at    timestamptz,
  confirmed_by    text,
  attempts        integer not null default 0,
  claimed_until   timestamptz,
  claimed_by      text,
  last_error      text
);

comment on table chat.principal_revocation is
  'RT-032. One row per deactivation, written in the deactivating transaction by '
  'chat.journal_principal_revocation(). A deactivation is COMPLETE when confirmed_at is set: '
  'an API node ran the realtime completion barrier after the commit.';

create index if not exists principal_revocation_unconfirmed
  on chat.principal_revocation (recorded_at) where confirmed_at is null;
create index if not exists principal_revocation_principal
  on chat.principal_revocation (principal_kind, principal_id, recorded_at desc);

-- Request roles never see or touch it; server-side roles read and confirm it.
alter table chat.principal_revocation enable row level security;
revoke all on chat.principal_revocation from public, anon, authenticated, chat_app;
grant select, insert on chat.principal_revocation to service_role;
grant update (confirmed_at, confirmed_by, attempts, claimed_until, claimed_by, last_error)
  on chat.principal_revocation to service_role;

-- What happened is immutable; only the confirmation bookkeeping moves, and a
-- confirmation is never withdrawn.
create or replace function chat.guard_principal_revocation_update()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if (new.id, new.organization_id, new.principal_kind, new.principal_id, new.account_id,
      new.transition, new.writer, new.reason, new.requested_by, new.recorded_at)
     is distinct from
     (old.id, old.organization_id, old.principal_kind, old.principal_id, old.account_id,
      old.transition, old.writer, old.reason, old.requested_by, old.recorded_at) then
    raise exception 'RT-032: a revocation record is immutable; only its confirmation is written'
      using errcode = 'insufficient_privilege';
  end if;
  if old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at then
    raise exception 'RT-032: a confirmed revocation stays confirmed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists principal_revocation_is_append_only on chat.principal_revocation;
create trigger principal_revocation_is_append_only
  before update on chat.principal_revocation
  for each row execute function chat.guard_principal_revocation_update();

-- ---------------------------------------------------------------------------
-- 3. The gate and journal, on every principal table
-- ---------------------------------------------------------------------------

-- TG_ARGV[0]: 'account' | 'contact' | 'staff' | 'teacher'. Attached AFTER the
-- row change with a WHEN clause that admits only a LIVE row becoming not live
-- (or a live row deleted), so ordinary updates never reach it.
create or replace function chat.journal_principal_revocation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_kind       text := tg_argv[0];
  v_transition text;
  v_account    uuid;
  v_requested  text := nullif(current_setting('chat.revocation_requested_by', true), '');
begin
  if not chat.caller_is_server_side() then
    raise exception 'RT-032: % % can be taken out of service only by a server-side writer (invoking role %); use chat.deactivate_principal()',
      v_kind, old.id, chat.invoking_role()
      using errcode = 'insufficient_privilege';
  end if;

  -- Nested, not `kind = 'account' and new.status = ...`: a record field is
  -- resolved even behind a false AND, and only chat.account has `status`.
  v_transition := 'deactivated';
  if tg_op = 'DELETE' then
    v_transition := 'deleted';
  elsif v_kind = 'account' then
    if new.status = 'suspended' then
      v_transition := 'suspended';
    end if;
  end if;

  if v_kind = 'account' then
    v_account := old.id;
  else
    v_account := old.account_id;
  end if;

  insert into chat.principal_revocation
    (organization_id, principal_kind, principal_id, account_id, transition, writer, reason, requested_by)
  values
    (old.organization_id, v_kind, old.id, v_account, v_transition, chat.invoking_role(),
     nullif(current_setting('chat.revocation_reason', true), ''),
     case when v_requested ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then v_requested::uuid end);
  return null;
end;
$$;

-- "Live" is what IdentityService and AuthService treat as live:
--   account: is_active and status = 'active'
--   contact: is_active
--   staff / teacher: is_active and left_at is null
drop trigger if exists account_revocation_journal on chat.account;
create trigger account_revocation_journal
  after update of is_active, status on chat.account for each row
  when ((old.is_active and old.status = 'active') and not (new.is_active and new.status = 'active'))
  execute function chat.journal_principal_revocation('account');
drop trigger if exists account_deletion_journal on chat.account;
create trigger account_deletion_journal
  after delete on chat.account for each row
  when (old.is_active and old.status = 'active')
  execute function chat.journal_principal_revocation('account');

drop trigger if exists contact_revocation_journal on chat.contact;
create trigger contact_revocation_journal
  after update of is_active on chat.contact for each row
  when (old.is_active and not new.is_active)
  execute function chat.journal_principal_revocation('contact');
drop trigger if exists contact_deletion_journal on chat.contact;
create trigger contact_deletion_journal
  after delete on chat.contact for each row
  when (old.is_active)
  execute function chat.journal_principal_revocation('contact');

drop trigger if exists staff_revocation_journal on chat.staff;
create trigger staff_revocation_journal
  after update of is_active, left_at on chat.staff for each row
  when ((old.is_active and old.left_at is null) and not (new.is_active and new.left_at is null))
  execute function chat.journal_principal_revocation('staff');
drop trigger if exists staff_deletion_journal on chat.staff;
create trigger staff_deletion_journal
  after delete on chat.staff for each row
  when (old.is_active and old.left_at is null)
  execute function chat.journal_principal_revocation('staff');

drop trigger if exists teacher_revocation_journal on chat.teacher;
create trigger teacher_revocation_journal
  after update of is_active, left_at on chat.teacher for each row
  when ((old.is_active and old.left_at is null) and not (new.is_active and new.left_at is null))
  execute function chat.journal_principal_revocation('teacher');
drop trigger if exists teacher_deletion_journal on chat.teacher;
create trigger teacher_deletion_journal
  after delete on chat.teacher for each row
  when (old.is_active and old.left_at is null)
  execute function chat.journal_principal_revocation('teacher');

-- Fire whatever session_replication_role says.
alter table chat.account enable always trigger account_revocation_journal;
alter table chat.account enable always trigger account_deletion_journal;
alter table chat.contact enable always trigger contact_revocation_journal;
alter table chat.contact enable always trigger contact_deletion_journal;
alter table chat.staff   enable always trigger staff_revocation_journal;
alter table chat.staff   enable always trigger staff_deletion_journal;
alter table chat.teacher enable always trigger teacher_revocation_journal;
alter table chat.teacher enable always trigger teacher_deletion_journal;

-- ---------------------------------------------------------------------------
-- 4. The operation: one call that writes the coupled columns correctly,
--    labels the journal row, and is safe to repeat.
-- ---------------------------------------------------------------------------

create or replace function chat.deactivate_principal(
  p_kind         text,
  p_principal_id uuid,
  p_reason       text,
  p_requested_by uuid default null,
  p_status       text default 'deactivated'
) returns uuid
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_changed integer;
  v_id      uuid;
  v_org     uuid;
  v_account uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'deactivation requires a reason' using errcode = 'check_violation';
  end if;
  if p_kind is null or p_kind not in ('account', 'contact', 'staff', 'teacher') then
    raise exception 'unknown principal kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if p_status is null or p_status not in ('deactivated', 'suspended')
     or (p_status = 'suspended' and p_kind <> 'account') then
    raise exception 'unsupported target status % for %', p_status, p_kind using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('chat.revocation_reason', p_reason, true);
  perform set_config('chat.revocation_requested_by', coalesce(p_requested_by::text, ''), true);

  if p_kind = 'account' then
    update chat.account
       set status = p_status, is_active = false, deactivated_at = coalesce(deactivated_at, now())
     where id = p_principal_id and is_active and status = 'active';
  elsif p_kind = 'contact' then
    update chat.contact set is_active = false
     where id = p_principal_id and is_active;
  elsif p_kind = 'staff' then
    -- chat.guard_staff_deactivation still refuses while the person owns a family.
    update chat.staff set is_active = false, left_at = coalesce(left_at, now()), presence = 'offline'
     where id = p_principal_id and is_active and left_at is null;
  else
    update chat.teacher set is_active = false, left_at = coalesce(left_at, now())
     where id = p_principal_id and is_active and left_at is null;
  end if;
  get diagnostics v_changed = row_count;

  perform set_config('chat.revocation_reason', '', true);
  perform set_config('chat.revocation_requested_by', '', true);

  if v_changed = 1 then
    -- The row the trigger wrote in this transaction.
    select id into v_id from chat.principal_revocation
     where principal_kind = p_kind and principal_id = p_principal_id and recorded_at = now()
     order by id desc limit 1;
    return v_id;
  end if;

  -- Nothing to change. Unknown id: say so. Already out of service: hand back
  -- the latest revocation (the caller waits for its confirmation), or journal
  -- one now if none was ever written -- a retry is never answered by a commit
  -- alone.
  execute format('select organization_id, %s from chat.%I where id = $1',
                 case when p_kind = 'account' then 'id' else 'account_id' end, p_kind)
     into v_org, v_account using p_principal_id;
  if v_org is null then
    raise exception '% % does not exist', p_kind, p_principal_id using errcode = 'no_data_found';
  end if;

  select id into v_id from chat.principal_revocation
   where principal_kind = p_kind and principal_id = p_principal_id
   order by recorded_at desc, id desc limit 1;
  if v_id is null then
    if not chat.caller_is_server_side() then
      raise exception 'RT-032: only a server-side writer may journal a revocation'
        using errcode = 'insufficient_privilege';
    end if;
    insert into chat.principal_revocation
      (organization_id, principal_kind, principal_id, account_id, transition, writer, reason, requested_by)
    values (v_org, p_kind, p_principal_id, v_account, 'already_inactive', chat.invoking_role(), p_reason, p_requested_by)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

comment on function chat.deactivate_principal(text, uuid, text, uuid, text) is
  'RT-032. Takes an account / contact / staff member / teacher out of service and returns its '
  'chat.principal_revocation id. The deactivation is COMPLETE when that row''s confirmed_at is set. '
  'Idempotent: a repeat returns the latest revocation. Server-side callers only.';

revoke execute on function chat.deactivate_principal(text, uuid, text, uuid, text) from public, anon, authenticated, chat_app;
grant  execute on function chat.deactivate_principal(text, uuid, text, uuid, text) to service_role;
revoke execute on function chat.journal_principal_revocation() from public, anon, authenticated, chat_app;
revoke execute on function chat.guard_principal_revocation_update() from public, anon, authenticated, chat_app;

-- ---------------------------------------------------------------------------
-- 5. Prove it inside the migration
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_trigger text;
begin
  foreach v_trigger in array array[
    'account_revocation_journal', 'account_deletion_journal', 'contact_revocation_journal',
    'contact_deletion_journal', 'staff_revocation_journal', 'staff_deletion_journal',
    'teacher_revocation_journal', 'teacher_deletion_journal'] loop
    if not exists (select 1 from pg_trigger where tgname = v_trigger and tgenabled = 'A') then
      raise exception 'RT-032: trigger % is missing or not ENABLE ALWAYS', v_trigger;
    end if;
  end loop;
  if has_function_privilege('chat_app', 'chat.deactivate_principal(text, uuid, text, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'chat.deactivate_principal(text, uuid, text, uuid, text)', 'EXECUTE')
     or has_table_privilege('chat_app', 'chat.principal_revocation', 'SELECT')
     or has_table_privilege('chat_app', 'chat.principal_revocation', 'INSERT')
     or has_table_privilege('chat_app', 'chat.principal_revocation', 'UPDATE') then
    raise exception 'RT-032: a request role can reach the revocation journal or the deactivation operation';
  end if;
end
$assert$;
