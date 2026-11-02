-- Roll back 20261102120000_chat_pd055_board_dotted_layout (PD-55 PR-3).
--
-- A dotted page becomes a blank one -- its drawing is untouched; only the
-- dots under it go -- and the CHECK narrows again. Roll back the API and the
-- clients with it: they offer 'dotted'.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102120000_pd055_board_dotted_layout.down.sql

update chat.whiteboard_page set layout = 'plain' where layout = 'dotted';
-- A precaution (whiteboard_page has no deferred triggers today): should one be
-- added, its events run before the ALTER instead of failing it with "pending
-- trigger events" inside this one transaction -- the fault #367's migration had.
set constraints all immediate;
alter table chat.whiteboard_page drop constraint if exists whiteboard_page_layout_check;
alter table chat.whiteboard_page add constraint whiteboard_page_layout_check
  check (layout in ('plain', 'ruled', 'narrow_ruled', 'grid', 'arabic_lines'));

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102120000_chat_pd055_board_dotted_layout';
