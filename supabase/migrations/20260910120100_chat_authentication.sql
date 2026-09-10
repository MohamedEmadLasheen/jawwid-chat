-- Jawwid Chat -- the storage authentication needs: credentials, devices and
-- sessions. PR-A of the authentication rollout
-- (`docs/architecture/IDENTITY-MODEL.md` §2 and §6, CANONICAL).
--
-- Adapted from the archived D-6 baseline (16857af). What was reused, and what
-- was not, is recorded in the PR description; the substantive changes are:
--
--   * no `chat.account.teacher_id` -- superseded by chat.teacher (see 120000);
--   * sessions gain organization_id, device_id, revoked_by and ip_hash, and use
--     the field names IDENTITY-MODEL §6 specifies (created_at / last_seen_at);
--   * chat.device is new -- D-6 had no device record, and PRD §7.1 binds a
--     session to one;
--   * the password hash comment names Argon2id (IDENTITY-MODEL §2, PRD §7.1)
--     rather than D-6's scrypt.
--
-- This migration adds NO runtime behaviour. Nothing issues a token, nothing
-- reads these tables, and `x-actor-id` is still the identity seam. PR-B wires
-- them up.
--
-- There is deliberately no username column anywhere: the login identifier is
-- chat.account.subject (`authentication-decision-gate.md` §5, API-CONTRACT
-- §3.1 -- the wire field is named `username` and resolves to the subject).

-- ---------------------------------------------------------------------------
-- 1. Credentials
-- ---------------------------------------------------------------------------
create table if not exists chat.account_credential (
  -- One credential per account. Absence means the account cannot log in with a
  -- password, which is exactly the 'provisioned' lifecycle state.
  account_id          uuid primary key references chat.account (id) on delete cascade,

  -- Argon2id, encoded with its parameters so they can be raised later without
  -- invalidating every existing password. Never selected by any query except
  -- the login path.
  password_hash       text        not null,
  password_changed_at timestamptz not null default now(),

  -- Throttling state lives beside the credential, not in Redis: a lockout that
  -- disappears when the cache restarts is not a lockout.
  failed_attempts     integer     not null default 0 check (failed_attempts >= 0),
  locked_until        timestamptz,
  updated_at          timestamptz not null default now()
);

comment on table chat.account_credential is
  'Password material. No organization_id: it inherits through account, the same '
  'way 20260906120000 excludes tables that reach the organization by a parent '
  'foreign key.';

drop trigger if exists account_credential_set_updated_at on chat.account_credential;
create trigger account_credential_set_updated_at
  before update on chat.account_credential
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Devices
-- ---------------------------------------------------------------------------
create table if not exists chat.device (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  account_id      uuid not null references chat.account (id) on delete cascade,

  platform        text not null check (platform in ('ios', 'android', 'web')),
  app_version     text,
  name            text,

  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.device is
  'One record per device an account signs in on (PRD §7.1; API-CONTRACT §3.1 '
  'sends {platform, name?} at login). No unique key beyond id: whether a '
  'returning device reuses its row is the API''s decision in PR-B, and a '
  'constraint guessed now would prejudge it.';

comment on column chat.device.name is
  'A human label such as "iPhone". Never a phone number, and never derived '
  'from one (BR-2).';

create index if not exists device_account_idx      on chat.device (account_id);
create index if not exists device_organization_idx on chat.device (organization_id);

drop trigger if exists device_set_updated_at on chat.device;
create trigger device_set_updated_at
  before update on chat.device
  for each row execute function chat.set_updated_at();

-- chat.device_token (the push table) gains its device_id link in the push PR,
-- not here: PR-A is the identity foundation and push is out of scope.

-- ---------------------------------------------------------------------------
-- 3. Sessions
-- ---------------------------------------------------------------------------
create table if not exists chat.session (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default chat.default_organization_id()
                       references chat.organization (id),
  account_id         uuid not null references chat.account (id) on delete cascade,
  device_id          uuid references chat.device (id) on delete set null,

  -- HASHED. A database read must not yield a credential that can be replayed,
  -- so the refresh token itself is never stored. UNIQUE is what makes rotation
  -- reuse detectable: a replayed token cannot be inserted twice.
  refresh_token_hash text        not null unique,

  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  last_seen_at       timestamptz,

  revoked_at         timestamptz,
  revoked_by         uuid references chat.account (id) on delete set null,
  revoked_reason     text,

  -- Hashed, never the raw address (IDENTITY-MODEL §6).
  ip_hash            text,
  user_agent         text,

  constraint session_expiry_after_creation check (expires_at > created_at),
  constraint session_revocation_is_complete
    check ((revoked_at is null) = (revoked_reason is null))
);

comment on table chat.session is
  'One row per login. The access token carries this row''s id as `sid`, so '
  'revoking the row ends the session on the next request rather than at token '
  'expiry.';

create index if not exists session_account_active_idx
  on chat.session (account_id) where revoked_at is null;
create index if not exists session_expiry_idx
  on chat.session (expires_at) where revoked_at is null;
create index if not exists session_device_idx
  on chat.session (device_id) where device_id is not null;
create index if not exists session_organization_idx
  on chat.session (organization_id);

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------
-- RLS-STRATEGY.md §4: account, session, device and account_credential get "no
-- policies for `authenticated` -- reachable only through `chat_service` or
-- SECURITY DEFINER helpers", which "keeps credentials unreadable by
-- construction". Enabling RLS with no permissive policy is precisely that.
--
-- This is safe to do now, and is NOT the RLS activation deferred to a later PR:
-- these tables are new, nothing queries them, and no existing query can start
-- failing. The messaging tables from 20260905093000 are deliberately untouched
-- -- they have neither grants nor per-actor policies yet, so enabling RLS there
-- would deny everything.
alter table chat.account_credential enable row level security;
alter table chat.device             enable row level security;
alter table chat.session            enable row level security;

-- The tenant boundary every root table carries. account_credential has no
-- organization_id (it inherits through account), so it carries no policy at
-- all, which denies `authenticated` outright.
drop policy if exists device_organization_isolation on chat.device;
create policy device_organization_isolation on chat.device
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists session_organization_isolation on chat.session;
create policy session_organization_isolation on chat.session
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- `authenticated` is the role a logged-in caller adopts. Nothing it may do
-- includes reading password material, another person's sessions, or another
-- person's devices, so it is granted nothing here at all.
revoke all on chat.account_credential from public;
revoke all on chat.device             from public;
revoke all on chat.session            from public;
revoke all on chat.teacher            from public;

grant select, insert, update, delete on chat.account_credential to service_role;
grant select, insert, update, delete on chat.device             to service_role;
grant select, insert, update, delete on chat.session            to service_role;
grant select, insert, update, delete on chat.teacher            to service_role;

-- A teacher's name and active flag are ordinary directory data that the
-- application must be able to read to render a group member list; the
-- restrictive organization policy still applies.
grant select on chat.teacher to authenticated;
