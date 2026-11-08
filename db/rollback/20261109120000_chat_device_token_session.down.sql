-- Roll back 20261109120000_chat_device_token_session (LR-46).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109120000_chat_device_token_session.down.sql
--
-- The API code of this release must be rolled back FIRST (it writes and reads
-- chat.device_token.session_id).
--
-- What is lost: which session registered each push token. Nothing else: the
-- tokens and their is_active flags stay as they are. After the rollback a
-- revoked session no longer deactivates its tokens, and a token can again be
-- rebound by any account that registers it (the behaviour before LR-46).

set local lock_timeout = '5s';

drop trigger if exists session_revoked_retires_device_tokens on chat.session;
drop function if exists chat.retire_device_tokens_of_revoked_session();
drop index if exists chat.device_token_session_idx;
alter table chat.device_token drop column if exists session_id;
