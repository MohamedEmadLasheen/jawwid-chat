-- PD-55 (PR-3; owner's request 2026-11-02, decided by the department head):
-- a dotted page -- a dot every 32 units -- beside blank (plain), lined
-- (arabic_lines), grid, ruled and narrow ruled. The layout is drawn by the
-- client from this value (the portal's painter, Admin Web's renderer); the
-- server only admits it.
--
-- Additive: the CHECK only widens. Idempotent (G-19). Rollback:
-- db/rollback/20261102120000_pd055_board_dotted_layout.down.sql

alter table chat.whiteboard_page drop constraint if exists whiteboard_page_layout_check;
alter table chat.whiteboard_page add constraint whiteboard_page_layout_check
  check (layout in ('plain', 'ruled', 'narrow_ruled', 'grid', 'arabic_lines', 'dotted'));
