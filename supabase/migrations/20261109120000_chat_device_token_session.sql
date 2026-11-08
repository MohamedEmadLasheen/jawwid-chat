-- =============================================================================
-- LR-46 · a push token belongs to the session that registered it
--
--   chat.device_token.session_id  the chat.session that last registered the
--                                 token (POST /notifications/devices). NULL on
--                                 every row from before this migration, and
--                                 for a registration with no session (internal
--                                 callers).
--
-- Two problems this closes:
--
--   (a) Ending a session on the server did not stop its pushes. A remote
--       sign-out of a lost phone, or the refresh-reuse "revoke everything",
--       left the phone receiving notifications, because a token had no link
--       to any session. Now: when a chat.session row is revoked, its tokens
--       are deactivated (is_active = false, exactly what the app's own
--       sign-out does through DELETE /notifications/devices/:token). Done by a
--       trigger, so EVERY revocation path is covered -- sign-out, "sign out
--       the others", a password change, refresh reuse, an administrator, a
--       suspension, tooling -- without each having to remember.
--
--       Two revocations are NOT the end of a sign-in and are skipped: a
--       refresh rotation ('rotated') and the password change's renewal of the
--       current session ('password changed: session renewed'). The API moves
--       the tokens to the successor session right after it is issued
--       (src/platform/auth/auth.service.ts). These strings are the API's
--       constants; the LR-46 integration spec fails if they drift.
--
--   (b) A token moved to any account that registered it. The API now refuses
--       (409) to take a token from another account while the session that
--       registered it is live; a token whose session has ended (the shared
--       phone after sign-out) is rebound as before.
--
-- Rows with session_id NULL (all existing rows) keep today's behaviour: no
-- revocation reaches them and any account may rebind them. They gain a
-- session the next time the app registers them (every sign-in and launch).
--
-- An ended session is never deleted by the API; an erased account's sessions
-- are (cascade), and its tokens are deleted by the erasure itself. ON DELETE
-- SET NULL keeps any other deletion from failing on a token.
--
-- No grants change: chat.device_token has no row-level security and is
-- written only by the API. Idempotent (G-19).
-- =============================================================================

alter table chat.device_token
  add column if not exists session_id uuid references chat.session (id) on delete set null;

comment on column chat.device_token.session_id is
  'LR-46: the session that last registered this token. Revoking that session deactivates the token. NULL = registered before LR-46 (or with no session): never deactivated by a revocation, and rebindable by any account.';

create index if not exists device_token_session_idx
  on chat.device_token (session_id) where session_id is not null;

-- One trigger function for chat.session's revocation (the PL/pgSQL rule).
create or replace function chat.retire_device_tokens_of_revoked_session()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  update chat.device_token
     set is_active = false
   where session_id = new.id
     and is_active;
  return null;
end;
$$;

revoke all on function chat.retire_device_tokens_of_revoked_session() from public;

drop trigger if exists session_revoked_retires_device_tokens on chat.session;
create trigger session_revoked_retires_device_tokens after update of revoked_at on chat.session
  for each row
  when (old.revoked_at is null and new.revoked_at is not null
        and new.revoked_reason is distinct from 'rotated'
        and new.revoked_reason is distinct from 'password changed: session renewed')
  execute function chat.retire_device_tokens_of_revoked_session();
