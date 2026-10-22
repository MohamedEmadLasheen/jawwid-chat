-- PD-23 (2026-10-22): session lifetimes per role, and a session list people can read.
--
-- Before this, every POST /auth/refresh minted a fresh row with a fresh 30-day
-- expiry, so a session that was used at least once a month never ended. The
-- policy now has two limits:
--
--   idle      -- unused for this long, the session ends (the old 30 days);
--   absolute  -- this long after the PASSWORD was entered, it ends regardless.
--
-- An absolute limit needs to know when the password was entered, and rotation
-- replaces the row, so authenticated_at is COPIED from each row to its
-- successor. created_at keeps meaning "this row"; authenticated_at means "this
-- login". AuthService computes expires_at = least(now + idle, authenticated_at
-- + absolute) at every login and refresh; the limits per role are in
-- apps/api/src/platform/auth/session-policy.ts.
--
-- client and remembered are recorded so a refresh re-applies the same policy
-- without trusting the client to restate it, and so the Devices & sessions
-- lists can say what each session is.

alter table chat.session
  add column authenticated_at timestamptz,
  add column client           text,
  add column remembered       boolean not null default false;

-- Existing rows: the best available answer is the row itself. A chain that
-- began before this migration therefore gets its absolute limit counted from
-- its current row -- generous, never shorter than the truth.
update chat.session set authenticated_at = created_at where authenticated_at is null;

alter table chat.session
  alter column authenticated_at set default now(),
  alter column authenticated_at set not null,
  add constraint session_client_known check (client is null or client in ('app', 'web')),
  -- Only a browser can be "kept signed in"; an app session is persistent by nature.
  add constraint session_remembered_only_on_web check (not remembered or client = 'web'),
  -- A successor never claims a later login than the row it rotated from, and
  -- never one after its own creation.
  add constraint session_authenticated_before_created check (authenticated_at <= created_at);

comment on column chat.session.authenticated_at is
  'PD-23: when the password for this login chain was entered. Copied on rotation; the absolute session limit counts from it.';
comment on column chat.session.client is
  'PD-23: app | web, from the login''s device platform. Decides the session policy with the role.';
comment on column chat.session.remembered is
  'PD-23: Admin Web "keep me signed in on this device" was granted. Never true for the super admin.';
