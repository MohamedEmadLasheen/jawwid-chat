-- Jawwid Chat -- Phase 1: real identity.
--
-- Phase 0 shipped a product whose identity was a header (`x-actor-id`) and whose
-- teachers did not exist: a teacher "was" any uuid that appeared in
-- chat.learner.teacher_id, with the literal display name 'Teacher' and a
-- hard-coded is_active. This migration replaces both.
--
-- Canonical design: docs/architecture/IDENTITY-MODEL.md.
--
-- What it adds
--   1. chat.teacher                 -- teacher is a real principal, not a foreign key
--   2. chat.account lifecycle       -- provisioned | active | suspended | deactivated
--   3. chat.account_credential      -- password material, one row per account
--   4. chat.device                  -- a registered device, per account
--   5. chat.session                 -- one login, bound to a device, revocable
--   6. chat.account_token           -- email verification and password reset, hashed
--
-- What it deliberately does NOT add: any contact channel. chat.account still has
-- no email, phone or handle column (BR-2), and the new tables carry none either.
-- Verification and reset therefore address an account by its opaque `subject`;
-- delivery of the token is the identity provider's job, not this schema's.

-- ---------------------------------------------------------------------------
-- 1. Teacher
-- ---------------------------------------------------------------------------

create table if not exists chat.teacher (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  account_id      uuid unique references chat.account (id) on delete restrict,
  name            text not null,
  -- Jawwid Core has no teacher entity today (open-contract-decisions.md). The
  -- column exists so the sync has somewhere to land when it does.
  core_teacher_id text,
  synced_at       timestamptz,
  is_active       boolean not null default true,
  left_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint teacher_left_at_matches_is_active
    check (is_active or left_at is not null)
);

comment on table chat.teacher is
  'Teacher identity. Before Phase 1 a teacher was synthesised from '
  'chat.learner.teacher_id; that synthesis is deleted. Teaching a learner is an '
  'application relationship (chat.learner.teacher_id, now a foreign key), never '
  'the identity itself.';

drop trigger if exists teacher_set_updated_at on chat.teacher;
create trigger teacher_set_updated_at
  before update on chat.teacher
  for each row execute function chat.set_updated_at();

create index if not exists teacher_active_idx on chat.teacher (is_active);
create index if not exists teacher_organization_idx on chat.teacher (organization_id);
create unique index if not exists teacher_core_id_key
  on chat.teacher (organization_id, core_teacher_id) where core_teacher_id is not null;

-- Tenant isolation, matching every other root entity (TENANCY-MODEL.md §2).
drop policy if exists teacher_organization_isolation on chat.teacher;
alter table chat.teacher enable row level security;
create policy teacher_organization_isolation on chat.teacher
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- Migration of existing data: one teacher row per distinct learner.teacher_id,
-- keeping the SAME id so no learner row and no conversation_member row moves.
-- This is why the backfill is safe: teacher membership is recorded as
-- (actor_kind='teacher', actor_id=<that uuid>) throughout the schema.
insert into chat.teacher (id, organization_id, name)
select distinct l.teacher_id, l.organization_id, 'Teacher'
  from chat.learner l
 where l.teacher_id is not null
   and not exists (select 1 from chat.teacher t where t.id = l.teacher_id)
on conflict (id) do nothing;

-- The relationship becomes referential. It was a bare uuid pointing at nothing.
alter table chat.learner drop constraint if exists learner_teacher_fk;
alter table chat.learner
  add constraint learner_teacher_fk
  foreign key (teacher_id) references chat.teacher (id) on delete restrict;

comment on column chat.learner.teacher_id is
  'The teacher who teaches this learner -- an application relationship, and a '
  'foreign key to chat.teacher since Phase 1. It is NOT an identity source: '
  'IdentityService resolves teachers from chat.teacher only.';

-- A teacher may not be deactivated while still teaching: the group would keep a
-- teacher member who can no longer act, which is exactly the C-4 hole.
create or replace function chat.guard_teacher_deactivation()
returns trigger
language plpgsql
as $$
declare
  v_learners integer;
begin
  if old.is_active and not new.is_active then
    select count(*) into v_learners from chat.learner where teacher_id = new.id;
    if v_learners > 0 then
      raise exception
        'cannot deactivate teacher %: still assigned to % learner(s); reassign them first',
        old.name, v_learners
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_deactivation_is_guarded on chat.teacher;
create trigger teacher_deactivation_is_guarded
  before update of is_active on chat.teacher
  for each row execute function chat.guard_teacher_deactivation();

-- ---------------------------------------------------------------------------
-- 2. Account lifecycle
-- ---------------------------------------------------------------------------

alter table chat.account drop constraint if exists account_kind_check;
alter table chat.account
  add constraint account_kind_check check (kind in ('staff', 'family', 'teacher'));

alter table chat.account add column if not exists status text;
alter table chat.account add column if not exists email_verified_at timestamptz;
alter table chat.account add column if not exists deactivated_at timestamptz;
alter table chat.account add column if not exists deactivated_by uuid;
alter table chat.account add column if not exists deactivated_reason text;
alter table chat.account add column if not exists last_login_at timestamptz;

-- Backfill before the constraint: an existing row is active iff it was active.
update chat.account
   set status = case when is_active then 'active' else 'deactivated' end
 where status is null;

alter table chat.account alter column status set default 'provisioned';
alter table chat.account alter column status set not null;

alter table chat.account drop constraint if exists account_status_check;
alter table chat.account
  add constraint account_status_check
  check (status in ('provisioned', 'active', 'suspended', 'deactivated'));

comment on column chat.account.status is
  'The single account lifecycle state (IDENTITY-MODEL.md §3). is_active is a '
  'derived mirror maintained by trigger so every pre-Phase-1 reader keeps '
  'working; status is authoritative and nothing else may set is_active.';

-- is_active is now DERIVED. Writing it directly is meaningless, so the trigger
-- recomputes it on every write rather than trusting whatever was supplied.
create or replace function chat.sync_account_is_active()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.status = 'active');
  if new.status = 'deactivated' and new.deactivated_at is null then
    new.deactivated_at := now();
  end if;
  if new.status <> 'deactivated' then
    new.deactivated_at := null;
    new.deactivated_by := null;
    new.deactivated_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists account_is_active_is_derived on chat.account;
create trigger account_is_active_is_derived
  before insert or update on chat.account
  for each row execute function chat.sync_account_is_active();

-- Tenancy: a subject is unique WITHIN an organization, not globally
-- (TENANCY-MODEL.md M-2). Two academies may each have a `fatima` without one
-- of them being unable to create the account.
alter table chat.account drop constraint if exists account_subject_key;
drop index if exists chat.account_subject_key;
create unique index if not exists account_subject_per_organization_key
  on chat.account (organization_id, subject);

-- chat.current_account_id() resolves the caller. It must now also refuse a
-- non-active account, and must not match a subject from another tenant.
create or replace function chat.current_account_id()
returns uuid
language sql
stable
as $$
  select a.id
    from chat.account a
   where a.subject = chat.current_subject()
     and a.status = 'active'
     and (chat.current_organization_id() is null
          or a.organization_id = chat.current_organization_id())
$$;

-- ---------------------------------------------------------------------------
-- 3. Credentials
-- ---------------------------------------------------------------------------

create table if not exists chat.account_credential (
  account_id           uuid primary key references chat.account (id) on delete cascade,
  -- scrypt$N$r$p$salt$hash. The parameters travel with the hash so the cost can
  -- be raised later without invalidating every existing password.
  password_hash        text        not null,
  password_changed_at  timestamptz not null default now(),
  must_change_password boolean     not null default false,
  -- Throttling state lives beside the credential, not in Redis: a lockout that
  -- disappears when the cache restarts is not a lockout.
  failed_attempts      integer     not null default 0,
  locked_until         timestamptz,
  updated_at           timestamptz not null default now()
);

comment on table chat.account_credential is
  'Password material. Absence of a row means the account cannot log in with a '
  'password. Selected by exactly one code path (the login/change-password '
  'service) and readable by no application role.';

drop trigger if exists account_credential_set_updated_at on chat.account_credential;
create trigger account_credential_set_updated_at
  before update on chat.account_credential
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Devices
-- ---------------------------------------------------------------------------

create table if not exists chat.device (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references chat.account (id) on delete cascade,
  -- Client-supplied stable identifier for the installation. Scoped to the
  -- account, so naming another account's device id reaches nothing.
  client_key    text not null,
  platform      text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  app_version   text,
  display_name  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  constraint device_client_key_not_blank check (length(btrim(client_key)) > 0)
);

create unique index if not exists device_account_client_key
  on chat.device (account_id, client_key);
create index if not exists device_account_idx on chat.device (account_id);

comment on table chat.device is
  'One row per installation per account. A session binds to a device, so the '
  'device limit and "log this device out" are answerable without guessing from '
  'user agents.';

-- The push-token table gains the binding, so revoking a device also stops its
-- notifications. Nullable: a token registered before Phase 1 has no device.
alter table chat.device_token add column if not exists device_id uuid
  references chat.device (id) on delete set null;
create index if not exists device_token_device_idx on chat.device_token (device_id);

-- ---------------------------------------------------------------------------
-- 5. Sessions
-- ---------------------------------------------------------------------------

create table if not exists chat.session (
  id                 uuid        primary key default gen_random_uuid(),
  account_id         uuid        not null references chat.account (id) on delete cascade,
  device_id          uuid        references chat.device (id) on delete set null,
  -- Stored HASHED. A database read must not yield a credential that can be
  -- replayed against the API.
  refresh_token_hash text        not null unique,
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  last_seen_at       timestamptz,
  revoked_at         timestamptz,
  revoked_reason     text,
  revoked_by         uuid,
  user_agent         text,
  -- Hash, never the address itself: enough to spot a session moving, not enough
  -- to become a second contact channel.
  ip_hash            text,

  constraint session_expiry_after_issue check (expires_at > issued_at)
);

comment on table chat.session is
  'One row per login. The access token carries this row id as `sid` and the row '
  'is checked on every request, so revocation is immediate rather than at token '
  'expiry.';

create index if not exists session_account_active_idx
  on chat.session (account_id) where revoked_at is null;
create index if not exists session_expiry_idx
  on chat.session (expires_at) where revoked_at is null;
create index if not exists session_device_idx on chat.session (device_id);

-- ---------------------------------------------------------------------------
-- 6. One-time tokens (email verification, password reset)
-- ---------------------------------------------------------------------------

create table if not exists chat.account_token (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references chat.account (id) on delete cascade,
  purpose    text not null check (purpose in ('email_verification', 'password_reset')),
  -- HMAC of the token. The plaintext exists only in the response that mints it.
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

comment on table chat.account_token is
  'Single-use, hashed, expiring tokens. One live token per (account, purpose): '
  'minting a new one supersedes the previous, so a leaked older token is dead.';

create index if not exists account_token_account_purpose_idx
  on chat.account_token (account_id, purpose) where consumed_at is null;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- Credentials, sessions, devices and tokens are reachable ONLY by the trusted
-- backend role. `authenticated` -- the role a logged-in caller adopts -- is
-- granted nothing on them, so no policy mistake can expose password material or
-- another person's sessions: there is no grant for a policy to widen.

alter table chat.account_credential enable row level security;
alter table chat.session            enable row level security;
alter table chat.device             enable row level security;
alter table chat.account_token      enable row level security;

revoke all on chat.account_credential from public;
revoke all on chat.session            from public;
revoke all on chat.device             from public;
revoke all on chat.account_token      from public;

grant select, insert, update, delete on chat.account_credential to service_role;
grant select, insert, update, delete on chat.session            to service_role;
grant select, insert, update, delete on chat.device             to service_role;
grant select, insert, update, delete on chat.account_token      to service_role;
grant select, insert, update, delete on chat.teacher            to service_role;
grant select on chat.teacher to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Session policy configuration
-- ---------------------------------------------------------------------------
-- ONE source of truth for the device limit and the token lifetimes. Nothing in
-- the application may hardcode these numbers (brief SS12).

insert into chat.config (key, value, scope, description) values
('auth.max_active_devices', '5', 'auth',
 'INITIAL HYPOTHESIS - maximum concurrent active sessions (devices) per account.'),
('auth.device_limit_policy', '"revoke_oldest"', 'auth',
 'What happens at the limit: revoke_oldest (a person is never locked out of '
 'their newest device) or reject_new. Changing this is a product decision.'),
('auth.access_token_ttl_seconds', '900', 'auth',
 'INITIAL HYPOTHESIS - access token lifetime.'),
('auth.refresh_token_ttl_seconds', '2592000', 'auth',
 'INITIAL HYPOTHESIS - refresh token lifetime (30 days).'),
('auth.reset_token_ttl_seconds', '3600', 'auth',
 'INITIAL HYPOTHESIS - password reset token lifetime.'),
('auth.verification_token_ttl_seconds', '86400', 'auth',
 'INITIAL HYPOTHESIS - email verification token lifetime.'),
('auth.max_failed_attempts', '10', 'auth',
 'INITIAL HYPOTHESIS - failed logins before the credential locks.'),
('auth.lockout_seconds', '900', 'auth',
 'INITIAL HYPOTHESIS - how long a locked credential stays locked.'),
('auth.min_password_length', '12', 'auth',
 'INITIAL HYPOTHESIS - minimum password length accepted on set/change/reset.')
on conflict (key) do nothing;
