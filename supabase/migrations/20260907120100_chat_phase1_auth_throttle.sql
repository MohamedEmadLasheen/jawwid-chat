-- Jawwid Chat -- authentication abuse protection.
--
-- Phase 1 shipped a per-CREDENTIAL lockout: ten wrong passwords for one account
-- and that account locks. That stops a patient attacker guessing one person's
-- password, and stops nothing else. It does not stop
--
--   * password SPRAYING -- one common password against a thousand subjects, so
--     no single credential ever reaches its limit;
--   * SUBJECT ENUMERATION through the forgot-password endpoint, which is cheap
--     to hammer precisely because it is designed to answer identically;
--   * brute force against a RESET TOKEN, which is the one secret that lets
--     somebody take an account over without knowing anything about it.
--
-- WHY POSTGRES RATHER THAN REDIS
--   The same reason the credential lockout lives beside the credential: a limit
--   that disappears when a cache restarts is not a limit, and an attacker who
--   can cause a restart can clear it. Redis is already a dependency of this
--   system for presence and typing -- both of which are allowed to evaporate.
--   Authentication throttling is not.
--
-- WHAT THIS CANNOT DO
--   A distributed attack from many addresses defeats a per-address counter, and
--   no application-level counter fixes that. What it does do is make each
--   address expensive and keep the per-subject counter -- which no amount of
--   address rotation avoids -- so spraying is bounded per target as well as per
--   source. Edge-level protection remains the right answer for volume, and
--   docs/security/AUTH-THROTTLING.md says so rather than implying this is it.

create table if not exists chat.auth_throttle (
  -- '<scope>:<hashed subject or address>'. The raw value is never stored: an
  -- address is personal data and a subject is an account identifier, and a
  -- throttle table is not a place to accumulate either.
  bucket           text        primary key,
  scope            text        not null check (scope in
                     ('login_ip', 'login_subject', 'reset_request_ip',
                      'reset_request_subject', 'reset_redeem_ip')),
  attempts         integer     not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until    timestamptz,
  last_attempt_at  timestamptz not null default now()
);

comment on table chat.auth_throttle is
  'Attempt counters for the unauthenticated endpoints. Keys are hashed; no '
  'address and no subject is recoverable from this table.';

create index if not exists auth_throttle_expiry_idx
  on chat.auth_throttle (window_started_at);

-- THE counter. One statement, so two concurrent attempts cannot both read a
-- count of nine and both decide they are the tenth.
--
-- Returns the state AFTER recording this attempt: `blocked` says whether the
-- caller should be refused, and `retry_after_seconds` how long it will last.
create or replace function chat.record_auth_attempt(
  p_bucket        text,
  p_scope         text,
  p_limit         integer,
  p_window_seconds integer,
  p_block_seconds integer,
  p_at            timestamptz default now()
) returns table (blocked boolean, attempts integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_row chat.auth_throttle%rowtype;
begin
  insert into chat.auth_throttle (bucket, scope, attempts, window_started_at, last_attempt_at)
  values (p_bucket, p_scope, 1, p_at, p_at)
  on conflict (bucket) do update
     set attempts = case
           -- A block outlives its window: the counter is not reset by waiting
           -- out the window while still blocked.
           when chat.auth_throttle.blocked_until is not null
                and chat.auth_throttle.blocked_until > p_at
             then chat.auth_throttle.attempts + 1
           when chat.auth_throttle.window_started_at < p_at - make_interval(secs => p_window_seconds)
             then 1
           else chat.auth_throttle.attempts + 1
         end,
         window_started_at = case
           when (chat.auth_throttle.blocked_until is null
                 or chat.auth_throttle.blocked_until <= p_at)
                and chat.auth_throttle.window_started_at
                    < p_at - make_interval(secs => p_window_seconds)
             then p_at
           else chat.auth_throttle.window_started_at
         end,
         last_attempt_at = p_at
  returning * into v_row;

  -- p_limit is the number of attempts ALLOWED in the window; the one after it
  -- trips the block. Stated this way round because "limit 10" reading as "nine
  -- attempts" is the kind of off-by-one that gets discovered in an incident.
  if v_row.attempts > p_limit
     and (v_row.blocked_until is null or v_row.blocked_until <= p_at) then
    update chat.auth_throttle
       set blocked_until = p_at + make_interval(secs => p_block_seconds)
     where bucket = p_bucket
    returning * into v_row;
  end if;

  blocked := v_row.blocked_until is not null and v_row.blocked_until > p_at;
  attempts := v_row.attempts;
  retry_after_seconds := case
    when blocked then greatest(1, ceil(extract(epoch from (v_row.blocked_until - p_at)))::integer)
    else 0
  end;
  return next;
end;
$$;

comment on function chat.record_auth_attempt is
  'Records one attempt and says whether the caller is now blocked. A single '
  'statement does the counting, so a race cannot let two attempts share a slot.';

-- Cleared on success, so a person who mistypes twice and then signs in is not
-- carrying a counter around.
create or replace function chat.clear_auth_attempts(p_buckets text[])
returns integer
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare v_count integer;
begin
  delete from chat.auth_throttle where bucket = any (p_buckets);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Housekeeping. Nothing depends on it running: an expired row is already inert
-- because every decision compares against the window and the block.
create or replace function chat.prune_auth_throttle(p_older_than interval default interval '7 days')
returns integer
language plpgsql
as $$
declare v_count integer;
begin
  delete from chat.auth_throttle
   where last_attempt_at < now() - p_older_than
     and (blocked_until is null or blocked_until < now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Reachable only by the application role, and never through a policy: the
-- functions are SECURITY DEFINER because they must work for an ANONYMOUS
-- caller -- there is no actor context on a login attempt, which is the whole
-- point of throttling it.
alter table chat.auth_throttle enable row level security;
revoke all on chat.auth_throttle from public;
grant select, insert, update, delete on chat.auth_throttle to chat_app, chat_service;
grant execute on function chat.record_auth_attempt(text, text, integer, integer, integer, timestamptz)
  to chat_app, chat_service, authenticated;
grant execute on function chat.clear_auth_attempts(text[]) to chat_app, chat_service, authenticated;

drop policy if exists auth_throttle_runtime on chat.auth_throttle;
create policy auth_throttle_runtime on chat.auth_throttle
  for all to chat_app using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Policy, as configuration
-- ---------------------------------------------------------------------------
insert into chat.config (key, value, scope, description) values
('auth.throttle.window_seconds', '900', 'auth',
 'INITIAL HYPOTHESIS - the rolling window every counter below is measured over.'),
('auth.throttle.block_seconds', '900', 'auth',
 'INITIAL HYPOTHESIS - how long a bucket stays blocked once it trips.'),
('auth.throttle.login_per_ip', '30', 'auth',
 'INITIAL HYPOTHESIS - failed logins from one address before it is blocked. '
 'Sized to allow a shared office NAT a bad morning, and to make spraying slow.'),
('auth.throttle.login_per_subject', '10', 'auth',
 'INITIAL HYPOTHESIS - failed logins against one subject from any address. '
 'This is the counter address rotation cannot avoid.'),
('auth.throttle.reset_request_per_ip', '10', 'auth',
 'INITIAL HYPOTHESIS - forgot-password requests from one address.'),
('auth.throttle.reset_request_per_subject', '5', 'auth',
 'INITIAL HYPOTHESIS - forgot-password requests naming one subject.'),
('auth.throttle.reset_redeem_per_ip', '10', 'auth',
 'INITIAL HYPOTHESIS - reset-token redemptions from one address. A reset token '
 'is the one secret that takes an account over, so guessing it is bounded hard.')
on conflict (key) do nothing;
