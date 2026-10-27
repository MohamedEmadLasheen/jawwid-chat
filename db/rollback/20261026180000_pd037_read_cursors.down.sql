-- Roll back 20261026180000_chat_pd037_read_cursors (PD-37 read and delivery cursors).
--
-- Safe with rows present: the two columns are derived bookkeeping. Receipts
-- (chat.message_receipt) and last_read_seq are untouched, so unread counts and
-- Message info keep working; the API before PD-37 P1a never reads these.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261026180000_pd037_read_cursors.down.sql

delete from chat.config where key in ('abuse.throttle.receipt_cursor_actor', 'realtime.receipts_announce');

alter table chat.conversation_participant_state drop column if exists last_read_at;
alter table chat.conversation_participant_state drop column if exists last_delivered_seq;

delete from chat.schema_migrations where version = '20261026180000_chat_pd037_read_cursors';
