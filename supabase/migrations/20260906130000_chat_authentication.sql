-- Jawwid Chat -- authentication (D-6).
--
-- Until now identity was a seam: HTTP read `x-actor-id` and the socket read
-- `handshake.auth.actorId`. Authorization was genuinely enforced -- every
-- service re-resolves the actor and runs the matrix -- but anyone could claim
-- to be anyone, so the product could not be exposed to a real network.
--
-- This adds the storage authentication needs. It does NOT introduce a second
-- identity system: chat.account remains the single account record, and staff,
-- contact and teacher continue to be the actors resolved from it.
--
-- PRD scope: username + password, no public registration, no OTP reset.

-- ---------------------------------------------------------------------------
-- 1. Teacher accounts
-- ---------------------------------------------------------------------------
-- A teacher must be able to log in, or BR-1 cannot be tested end to end and the
-- Teacher app has no way in. chat.teacher does not exist yet (QA correction
-- C-1, owned by AI #1); until it does, a teacher actor is the uuid that
-- chat.learner.teacher_id points at, so the account records that id.
--
-- STOPGAP, deliberately narrow: when AI #1 lands chat.teacher, teacher_id
-- becomes a foreign key and this comment should be deleted with it.
alter table chat.account drop constraint if exists account_kind_check;
alter table chat.account
  add constraint account_kind_check check (kind in ('staff', 'family', 'teacher'));

alter table chat.account add column if not exists teacher_id uuid;

alter table chat.account drop constraint if exists account_teacher_id_matches_kind;
alter table chat.account
  add constraint account_teacher_id_matches_kind
  check ((kind = 'teacher') = (teacher_id is not null));

create unique index if not exists account_teacher_id_key
  on chat.account (teacher_id) where teacher_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Credentials
-- ---------------------------------------------------------------------------
create table if not exists chat.account_credential (
  account_id          uuid primary key references chat.account(id) on delete cascade,
  -- scrypt, encoded as scrypt$N$r$p$salt$hash. The algorithm and parameters
  -- travel with the hash so they can be raised later without invalidating
  -- every existing password.
  password_hash       text        not null,
  password_changed_at timestamptz not null default now(),
  -- Throttling state. Kept next to the credential rather than in Redis: a
  -- lockout that disappears when the cache restarts is not a lockout.
  failed_attempts     int         not null default 0,
  locked_until        timestamptz,
  updated_at          timestamptz not null default now()
);

comment on table chat.account_credential is
  'Password material. One row per account; absence means the account cannot '
  'log in with a password. Never selected by any application query except the '
  'login path.';

create trigger account_credential_set_updated_at
  before update on chat.account_credential
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Sessions
-- ---------------------------------------------------------------------------
create table if not exists chat.session (
  id                 uuid        primary key default gen_random_uuid(),
  account_id         uuid        not null references chat.account(id) on delete cascade,
  -- The refresh token is stored HASHED. A database read must not yield a
  -- credential that can be replayed.
  refresh_token_hash text        not null unique,
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  revoked_reason     text,
  last_used_at       timestamptz,
  user_agent         text,
  constraint session_expiry_after_issue check (expires_at > issued_at)
);

comment on table chat.session is
  'One row per login. The access token carries this row id as `sid`, so '
  'revoking the row ends the session immediately rather than at token expiry.';

create index if not exists session_account_active_idx
  on chat.session (account_id) where revoked_at is null;
create index if not exists session_expiry_idx
  on chat.session (expires_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- Neither table is readable by the customer-facing role. `authenticated` is the
-- role a logged-in caller adopts, and nothing it can do should ever include
-- reading password material or another person's sessions.
revoke all on chat.account_credential from public;
revoke all on chat.session            from public;
grant select, insert, update, delete on chat.account_credential to service_role;
grant select, insert, update, delete on chat.session            to service_role;
