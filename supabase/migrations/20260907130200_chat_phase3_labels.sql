-- Jawwid Chat -- Phase 3: labels.
--
-- Canonical design: docs/recovery/PHASE-3-REPORT.md.
--
-- Labels are reusable organizational metadata attached to families --
-- "Wednesday", "Installments", "Renewal", "VIP", "Course A". They are the
-- academy's own filing system, not a product concept the engine reasons about:
-- NOTHING in authorization, messaging or scope reads a label. That is
-- deliberate. A label that could grant access would be a role with no audit
-- trail and no reason column.
--
-- TWO MODELLING DECISIONS, STATED BECAUSE BOTH ARE EASY TO GET WRONG:
--
--   1. MANY-TO-MANY, RELATIONALLY. A comma-separated string or a jsonb array on
--      chat.family cannot be indexed for "all VIP families", cannot be
--      constrained against duplicates, cannot record WHO applied a label, and
--      turns "rename this label" into a table scan with a string replace.
--
--   2. SOFT DELETE. Deleting a label must never touch a family, a student, a
--      conversation or any unrelated history. A hard delete would either cascade
--      into chat.family_label (destroying the record that a family was ever
--      labelled) or be blocked by it. deleted_at makes the destructive shape
--      unrepresentable: the label stops being offered, and every association it
--      had remains on disk.

-- ---------------------------------------------------------------------------
-- 1. The label
-- ---------------------------------------------------------------------------

create table if not exists chat.label (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  name            text not null,
  -- Presentation only. The UI needs SOMETHING to distinguish a wall of chips,
  -- and a free-text colour is smaller than a second table nobody would curate.
  color           text,
  description     text,
  created_by      uuid references chat.staff (id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid references chat.staff (id) on delete set null,
  deleted_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint label_name_not_blank check (length(btrim(name)) > 0),
  constraint label_deletion_is_stamped check (deleted_at is null or deleted_reason is not null)
);

comment on table chat.label is
  'Reusable organizational metadata attached to families. Nothing in '
  'authorization, scope or messaging reads a label -- a label that granted '
  'access would be a role without an audit trail. Deletion is SOFT so that '
  'removing a label can never reach a family, a student or a conversation.';

-- Uniqueness is CASE-INSENSITIVE and applies only to live labels: "VIP" and
-- "vip" are the same filing decision, and re-using the name of a deleted label
-- is legitimate. Enforced by the database so two admins racing to create the
-- same label cannot both win.
create unique index if not exists label_name_unique_per_organization
  on chat.label (organization_id, lower(name)) where deleted_at is null;

create index if not exists label_organization_live_idx
  on chat.label (organization_id, name) where deleted_at is null;

drop trigger if exists label_set_updated_at on chat.label;
create trigger label_set_updated_at
  before update on chat.label
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The association
-- ---------------------------------------------------------------------------

create table if not exists chat.family_label (
  label_id   uuid not null references chat.label (id) on delete cascade,
  family_id  uuid not null references chat.family (id) on delete cascade,
  added_by   uuid references chat.staff (id) on delete set null,
  added_at   timestamptz not null default clock_timestamp(),

  -- IDEMPOTENCY BY CONSTRUCTION. "Add family to label" twice cannot create a
  -- second row, because the pair IS the key. No service-side check to forget.
  primary key (label_id, family_id)
);

comment on table chat.family_label is
  'Many-to-many: a family may carry several labels and a label may cover many '
  'families. The composite primary key makes repeated application idempotent '
  'without any application-level guard.';

-- Both directions are real query paths: "which labels does this family carry"
-- (the family detail panel) and "which families carry this label" (the filter).
-- The primary key already serves label -> family; this serves family -> label.
create index if not exists family_label_family_idx on chat.family_label (family_id);

-- ---------------------------------------------------------------------------
-- 3. Deletion is soft, and says so
-- ---------------------------------------------------------------------------

create or replace function chat.delete_label(
  p_label_id uuid, p_reason text, p_actor_id uuid default null
) returns boolean
language plpgsql
as $$
declare
  v_actor    uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_label    record;
  v_families integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'deleting a label requires a reason' using errcode = 'check_violation';
  end if;
  select * into v_label from chat.label where id = p_label_id for update;
  if v_label.id is null then
    raise exception 'no such label %', p_label_id using errcode = 'no_data_found';
  end if;
  if v_label.deleted_at is not null then
    return false;
  end if;

  select count(*) into v_families from chat.family_label where label_id = p_label_id;

  -- The associations are deliberately LEFT IN PLACE. They record that these
  -- families were once filed this way, and nothing outside this table reads
  -- them, so leaving them costs nothing and destroys nothing.
  update chat.label
     set deleted_at = clock_timestamp(), deleted_by = v_actor, deleted_reason = p_reason
   where id = p_label_id;

  perform chat.write_audit(v_actor, 'label.deleted', 'label', p_label_id, p_reason,
                           jsonb_build_object('name', v_label.name, 'families', v_families),
                           jsonb_build_object('deleted', true));
  perform chat.log_event('label_deleted', null, 'staff', v_actor,
                         jsonb_build_object('label_id', p_label_id, 'name', v_label.name,
                                            'families_affected', v_families,
                                            'reason', p_reason));
  return true;
end;
$$;

comment on function chat.delete_label is
  'SOFT deletion. The label stops being offered; every chat.family_label row it '
  'had stays on disk, and no family, student, conversation or unrelated history '
  'is touched.';

-- ---------------------------------------------------------------------------
-- 4. Tenancy and RLS
-- ---------------------------------------------------------------------------

alter table chat.label        enable row level security;
alter table chat.family_label enable row level security;

drop policy if exists label_organization_isolation on chat.label;
create policy label_organization_isolation on chat.label
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- The label VOCABULARY is staff-wide: an admin has to see every label to file a
-- family under one, and the vocabulary reveals nothing about any family.
-- Contacts and teachers get no policy at all, so a parent cannot enumerate how
-- the academy files its customers.
drop policy if exists label_visible_to_staff on chat.label;
create policy label_visible_to_staff on chat.label
  for select to authenticated
  using (chat.staff_is_family_facing(chat.current_staff_id()));

-- An ASSOCIATION is a fact about a family, so it follows family scope exactly.
-- Without this, "which families are VIP" would be a directory of families the
-- actor may not see.
drop policy if exists family_label_visible on chat.family_label;
create policy family_label_visible on chat.family_label
  for select to authenticated
  using (chat.staff_can_see_family(family_id));

grant select on chat.label, chat.family_label to authenticated;
grant select, insert, update, delete on chat.label, chat.family_label to service_role;
