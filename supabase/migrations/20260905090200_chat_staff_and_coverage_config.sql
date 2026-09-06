-- Jawwid Chat -- staff, shifts, coverage rules and absences (brief SS3).
--
-- These four tables are the ONLY input to on_duty(family, now). Brief SS1:
-- "Nothing else decides who sees a message." There is deliberately no queue
-- table, no routing table and no assignment table anywhere in this schema.
--
-- Day-of-week convention throughout: 0 = Sunday .. 6 = Saturday, matching
-- Postgres extract(dow). Friday is 5.
--
-- Role and status vocabularies use CHECK constraints rather than Postgres
-- ENUM types so that later phases can widen them with a plain ALTER without a
-- type rewrite (docs/architecture/decisions.md ADR-003).

create table chat.staff (
  id                uuid primary key default gen_random_uuid(),
  -- Every actor resolves through chat.account, which this database owns.
  account_id        uuid unique references chat.account (id) on delete restrict,
  name              text not null,
  role              text not null check (role in
                      ('admin', 'coverage', 'manager', 'finance', 'technical', 'academic')),
  presence          text not null default 'offline'
                      check (presence in ('online', 'away', 'offline')),
  last_activity_at  timestamptz,
  -- Manager override for the workload level thresholds; null = use config.
  capacity_override numeric(6, 2),
  is_active         boolean not null default true,
  left_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint staff_left_at_matches_is_active
    check (is_active or left_at is not null)
);

comment on column chat.staff.role is
  'admin and coverage have identical permissions; coverage is a label that '
  'routes covered families into a separate inbox section (brief SS2). '
  'finance/technical/academic see only their own tasks and never message families.';

create trigger staff_set_updated_at
  before update on chat.staff
  for each row execute function chat.set_updated_at();

create index staff_active_role_idx on chat.staff (role) where is_active;

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

create table chat.shift (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references chat.staff (id) on delete cascade,
  days        smallint[] not null,
  starts      time not null,
  ends        time not null,
  valid_from  date not null default current_date,
  valid_to    date,
  created_at  timestamptz not null default now(),

  constraint shift_days_not_empty check (cardinality(days) > 0),
  constraint shift_days_in_range check (days <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint shift_validity_ordered check (valid_to is null or valid_to >= valid_from)
);

comment on column chat.shift.ends is
  'A shift with ends <= starts wraps past midnight and is evaluated as such by '
  'chat.in_shift(). The shift is anchored to the day its start falls on.';

create index shift_staff_idx on chat.shift (staff_id);

-- ---------------------------------------------------------------------------
-- Coverage rules
-- ---------------------------------------------------------------------------

create table chat.coverage_rule (
  id          uuid primary key default gen_random_uuid(),
  covering_id uuid not null references chat.staff (id) on delete cascade,
  -- NULL means "covers ALL owners" (brief SS3).
  covered_id  uuid references chat.staff (id) on delete cascade,
  days        smallint[] not null,
  window_mode text not null check (window_mode in ('outside_owner_shift', 'all_day', 'custom')),
  custom_from time,
  custom_to   time,
  priority    integer not null default 1,
  valid_from  date not null default current_date,
  valid_to    date,
  created_at  timestamptz not null default now(),

  constraint coverage_rule_days_not_empty check (cardinality(days) > 0),
  constraint coverage_rule_days_in_range check (days <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint coverage_rule_custom_window_complete
    check (window_mode <> 'custom' or (custom_from is not null and custom_to is not null)),
  constraint coverage_rule_not_self check (covered_id is null or covered_id <> covering_id),
  constraint coverage_rule_validity_ordered check (valid_to is null or valid_to >= valid_from)
);

comment on table chat.coverage_rule is
  'Maps covering staff -> covered owner (or ALL) -> days -> window. Ordered by '
  'priority ascending when building the on_duty chain. The manager''s catch-all '
  'rule is expected to sit at a high priority number so it resolves last and '
  'surfaces as Unattended (brief SS4).';

comment on column chat.coverage_rule.window_mode is
  'Called `window` in the brief; renamed because WINDOW is a reserved word in '
  'PostgreSQL.';

create index coverage_rule_covered_idx on chat.coverage_rule (covered_id, priority);

-- ---------------------------------------------------------------------------
-- Absences
-- ---------------------------------------------------------------------------

create table chat.absence (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references chat.staff (id) on delete cascade,
  -- `from`/`to` in the brief; renamed because both are reserved words in SQL.
  from_at      timestamptz not null,
  to_at        timestamptz not null,
  backup_id    uuid references chat.staff (id) on delete set null,
  type         text not null check (type in ('planned', 'sick', 'auto_detected')),
  activated_by uuid references chat.staff (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint absence_range_ordered check (to_at > from_at),
  constraint absence_backup_not_self check (backup_id is null or backup_id <> staff_id)
);

comment on table chat.absence is
  'Brief SS4: auto_detected absences are suggestions for the manager. Nothing '
  'in this schema activates a backup automatically; activated_by records the '
  'manager who did.';

create index absence_staff_range_idx on chat.absence (staff_id, from_at, to_at);
