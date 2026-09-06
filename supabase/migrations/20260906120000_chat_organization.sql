-- Jawwid Chat -- organization_id on every root entity.
--
-- PRD v0.1 section 2.3:
--   "Not multi-tenant, but the data model carries an organization_id on every
--    root entity from day one so a future SaaS conversion is a migration, not a
--    rewrite."
--
-- ROOT ENTITY -- the reconciled definition used here:
--   A table with independent identity and lifecycle, corresponding to an entity
--   named in PRD section 6, or an operational entity owned directly by the
--   organization. A table whose every row is reached only through a parent row
--   (a join table, a per-recipient receipt, a derived cache, integration
--   plumbing, or the migration ledger) is NOT a root entity: it inherits tenancy
--   through its parent's FK. Carrying a second copy of organization_id there
--   would create a divergence risk rather than isolation.
--
-- Isolation is enforced with RESTRICTIVE policies. They AND with every existing
-- permissive policy, so the policies already shipped keep their exact meaning
-- and none of them is rewritten here.

-- ---------------------------------------------------------------------------
-- The tenant
-- ---------------------------------------------------------------------------

create table if not exists chat.organization (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  display_name  text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table chat.organization is
  'Tenant root. One row today (Jawwid); PRD 2.3 requires the column from day one so SaaS is a migration, not a rewrite.';

drop trigger if exists organization_set_updated_at on chat.organization;
create trigger organization_set_updated_at
  before update on chat.organization
  for each row execute function chat.set_updated_at();

-- Deterministic id so fixtures, tests and the backfill agree without a lookup.
insert into chat.organization (id, slug, display_name)
     values ('00000000-0000-0000-0000-000000000001', 'jawwid', 'Jawwid')
on conflict (id) do nothing;

create or replace function chat.default_organization_id()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Who the caller is, tenant-wise
-- ---------------------------------------------------------------------------
--
-- Resolution order:
--   1. an explicit session override (chat.actor_organization) -- used by the
--      migration/backfill path and by integration harnesses;
--   2. the organization of the current subject's account.
-- Returns NULL when neither is available, which the restrictive policies below
-- treat as "see nothing" rather than "see everything".

create or replace function chat.current_organization_id()
returns uuid language plpgsql stable security definer set search_path = chat, pg_temp as $$
declare
  v_override text := nullif(current_setting('chat.actor_organization', true), '');
  v_org uuid;
begin
  if v_override is not null then
    return v_override::uuid;
  end if;

  select a.organization_id into v_org
    from chat.account a
   where a.subject = chat.current_subject()
   limit 1;

  return v_org;
end;
$$;

comment on function chat.current_organization_id() is
  'Tenant of the current caller. NULL means no tenant could be resolved; restrictive policies then deny.';

-- ---------------------------------------------------------------------------
-- Add the column to every root entity
-- ---------------------------------------------------------------------------

do $mig$
declare
  -- PRD section 6 entities plus the operational entities the organization owns
  -- directly. Deliberately EXCLUDED (they inherit through a parent FK):
  --   conversation_member, conversation_participant_state, call_participant,
  --   message_attachment, message_reaction, message_receipt, message_hidden_for,
  --   family_state_cache, outbox_event, sync_state, core_event,
  --   core_parent_inbox, schema_migrations, organization.
  root_tables text[] := array[
    'account', 'staff', 'family', 'contact', 'learner', 'subscription',
    'family_note', 'thread', 'conversation', 'message', 'message_approval',
    'support_case', 'task', 'call', 'handoff', 'shift', 'coverage_rule',
    'absence', 'notification', 'notification_rule', 'notification_template',
    'device_token', 'quiet_hours'
  ];
  t text;
begin
  foreach t in array root_tables loop
    -- Skip tables a future branch may not have created yet, rather than failing
    -- the whole series on an ordering difference.
    if to_regclass('chat.' || quote_ident(t)) is null then
      raise notice 'organization_id: chat.% not present, skipped', t;
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'chat' and table_name = t and column_name = 'organization_id'
    ) then
      execute format('alter table chat.%I add column organization_id uuid', t);
    end if;

    -- Backfill before NOT NULL. An empty database backfills nothing; an
    -- existing single-tenant install lands entirely on the Jawwid row.
    execute format(
      'update chat.%I set organization_id = chat.default_organization_id() where organization_id is null', t);

    execute format(
      'alter table chat.%I alter column organization_id set default chat.default_organization_id()', t);
    execute format(
      'alter table chat.%I alter column organization_id set not null', t);

    if not exists (
      select 1 from pg_constraint
       where conname = t || '_organization_fk'
         and conrelid = ('chat.' || quote_ident(t))::regclass
    ) then
      execute format(
        'alter table chat.%I add constraint %I foreign key (organization_id) references chat.organization(id)',
        t, t || '_organization_fk');
    end if;

    execute format(
      'create index if not exists %I on chat.%I (organization_id)', t || '_organization_idx', t);

    -- Tenant isolation. RESTRICTIVE: ANDs with every existing permissive policy.
    execute format('drop policy if exists %I on chat.%I', t || '_organization_isolation', t);
    execute format($p$
      create policy %I on chat.%I
        as restrictive
        for all
        using (organization_id = chat.current_organization_id())
        with check (organization_id = chat.current_organization_id())
    $p$, t || '_organization_isolation', t);
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- Cross-tenant referential integrity
-- ---------------------------------------------------------------------------
--
-- A NOT NULL column alone would not stop a row in organization A pointing at a
-- parent in organization B -- which is the leak an org column is supposed to
-- close. This guard rejects that at write time for the family-scoped tables,
-- which are the ones carrying customer data.

create or replace function chat.enforce_same_organization()
returns trigger language plpgsql as $$
declare
  v_parent_table text := TG_ARGV[0];
  v_parent_col   text := TG_ARGV[1];
  v_parent_id    uuid;
  v_parent_org   uuid;
begin
  execute format('select ($1).%I', v_parent_col) into v_parent_id using new;
  if v_parent_id is null then
    return new;
  end if;

  execute format('select organization_id from chat.%I where id = $1', v_parent_table)
     into v_parent_org using v_parent_id;

  if v_parent_org is not null and v_parent_org <> new.organization_id then
    raise exception
      'cross-organization reference: chat.% row belongs to organization %, parent chat.% belongs to %',
      TG_TABLE_NAME, new.organization_id, v_parent_table, v_parent_org
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

do $guards$
declare
  g record;
begin
  for g in
    select * from (values
      ('contact',       'family',  'family_id'),
      ('learner',       'family',  'family_id'),
      ('subscription',  'family',  'family_id'),
      ('family_note',   'family',  'family_id'),
      ('support_case',  'family',  'family_id'),
      ('task',          'family',  'family_id'),
      ('handoff',       'thread',  'thread_id'),
      ('conversation',  'family',  'family_id'),
      ('message',       'conversation', 'conversation_id')
    ) as v(child, parent, col)
  loop
    if to_regclass('chat.' || quote_ident(g.child)) is null
       or to_regclass('chat.' || quote_ident(g.parent)) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema='chat' and table_name=g.child and column_name=g.col
    ) then
      continue;
    end if;

    execute format('drop trigger if exists %I on chat.%I', g.child || '_same_organization', g.child);
    execute format(
      'create trigger %I before insert or update on chat.%I
         for each row execute function chat.enforce_same_organization(%L, %L)',
      g.child || '_same_organization', g.child, g.parent, g.col);
  end loop;
end
$guards$;
