-- Roll back 20261102230000_chat_pd055_page_shape (PD-55 Phase 1, 1b).
--
-- Every page becomes wide again. A tall page's drawing is kept but sits in a
-- 1920 x 1080 frame: whatever lies below y = 1080 or right of x = 1080 is out
-- of view until the column comes back (nothing is deleted). Roll back the API
-- and the clients with it: they send and read `shape`.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102230000_pd055_page_shape.down.sql

-- whiteboard_page has no deferred triggers today; should one be added, its
-- events run before the ALTER instead of failing it ("pending trigger events").
set constraints all immediate;
drop trigger if exists whiteboard_page_shape_is_fixed on chat.whiteboard_page;
drop function if exists chat.guard_whiteboard_page_shape();
alter table chat.whiteboard_page drop constraint if exists whiteboard_page_shape_check;
alter table chat.whiteboard_page drop column if exists shape;

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102230000_chat_pd055_page_shape';
