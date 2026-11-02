-- PD-55 Phase 1 (1b; revision 2, decided by the department head 2026-11-02):
-- a page is wide (1920 x 1080 page units, the board's page until now) or tall
-- (1080 x 1920) -- what gives a phone held upright a real writing area.
--
--   * every existing page is wide (the default), and so is any page a client
--     adds without saying;
--   * the shape is chosen when the page is created and NEVER changes: no
--     conversion, so no drawing is ever squeezed, cropped or moved;
--   * a copy (duplicate page, duplicate board, copy to a teacher) keeps it.
--
-- An app built before this column draws a tall page as if it were wide, and
-- would save its edits in the wrong frame. The API refuses an autosave of a
-- tall page unless the client says it knows the page is tall (savePage's
-- `shape`), so such an app can show the page but not change it.
--
-- PD-54's student boards reuse chat.whiteboard_page, and with it this column.
--
-- Additive and idempotent (G-19). Rollback:
-- db/rollback/20261102230000_pd055_page_shape.down.sql

alter table chat.whiteboard_page
  add column if not exists shape text not null default 'wide';
alter table chat.whiteboard_page drop constraint if exists whiteboard_page_shape_check;
alter table chat.whiteboard_page add constraint whiteboard_page_shape_check check (shape in ('wide', 'tall'));

comment on column chat.whiteboard_page.shape is
  'PD-55: wide (1920 x 1080 page units) or tall (1080 x 1920). Chosen when the page is created; never changes.';

create or replace function chat.guard_whiteboard_page_shape()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.shape is distinct from old.shape then
    raise exception 'a page keeps the shape it was created with' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function chat.guard_whiteboard_page_shape() from public;

drop trigger if exists whiteboard_page_shape_is_fixed on chat.whiteboard_page;
create trigger whiteboard_page_shape_is_fixed before update of shape on chat.whiteboard_page
  for each row execute function chat.guard_whiteboard_page_shape();
