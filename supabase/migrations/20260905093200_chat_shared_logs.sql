-- Jawwid Chat -- append-only logs.
--
-- OWNERSHIP: these two tables belong to AI #1 (backend core). They are created
-- here with `if not exists` only because the communication engine cannot write
-- an auditable record without them, and they did not exist when the
-- communication domain landed. AI #1's definitive migration may add columns,
-- policies and indexes freely; this file will simply become a no-op.

create table if not exists chat.event_log (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid,
  case_id    uuid,
  actor_kind text,
  actor_id   uuid,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);

create index if not exists event_log_family_at on chat.event_log (family_id, at desc);
create index if not exists event_log_type_at on chat.event_log (type, at desc);

create table if not exists chat.audit_log (
  id        uuid primary key default gen_random_uuid(),
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id uuid not null,
  before    jsonb,
  after     jsonb,
  -- NOT NULL by design: a sensitive action without a stated reason is a bug.
  reason    text not null,
  at        timestamptz not null default now()
);

create index if not exists audit_log_entity on chat.audit_log (entity, entity_id, at desc);

-- Append-only. chat.forbid_mutation() is defined in the foundation migration.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'event_log_append_only') then
    create trigger event_log_append_only
      before update or delete on chat.event_log
      for each row execute function chat.forbid_mutation();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_append_only') then
    create trigger audit_log_append_only
      before update or delete on chat.audit_log
      for each row execute function chat.forbid_mutation();
  end if;
end $$;
