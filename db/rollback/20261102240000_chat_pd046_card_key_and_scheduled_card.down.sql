-- Roll back 20261102240000_chat_pd046_card_key_and_scheduled_card (PD-46 PR-2).
--
-- Drops the card idempotency key. The 'lesson_scheduled' kind stays while any
-- card uses it (a card is written once and never deleted), so it is removed
-- only when none does. Roll back the API release with it: LessonService posts
-- keyed cards and the 'lesson_scheduled' card.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102240000_chat_pd046_card_key_and_scheduled_card.down.sql

-- message_card is written by every lesson ticket: the index build and the column
-- take locks every card insert waits on. Fail fast rather than queue behind live
-- traffic; re-run at a quiet moment if it times out.
set local lock_timeout = '5s';

drop index if exists chat.message_card_idempotency_key;
alter table chat.message_card drop column if exists idempotency_key;
delete from chat.message_card_kind k
 where k.kind = 'lesson_scheduled'
   and not exists (select 1 from chat.message_card c where c.kind = k.kind);

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102240000_chat_pd046_card_key_and_scheduled_card';
