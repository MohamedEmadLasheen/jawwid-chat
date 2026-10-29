-- =============================================================================
-- PD-39 · the teacher whiteboard, PR-1: boards, pages, assets, the access log
--
-- Design: docs/product/pd039-whiteboard-design.md (§6 data model and authz,
-- §10 the owner's safeguards, §11 the fit check). Decided by the owner
-- 2026-10-28.
--
--   chat.whiteboard              a teacher's board. state 'active', 'trashed'
--                                (the teacher deleted it: restorable for 30
--                                days, then purged) or 'retained' (the teacher
--                                left: kept 12 months for the Teachers
--                                department, then purged). Owner and
--                                organization never change.
--   chat.whiteboard_page         one page: layout, background and the drawing
--                                (a JSON document of elements, at most 512 KB;
--                                a verse is a reference, never its text).
--   chat.whiteboard_asset        an image, PDF page or export in object
--                                storage. Its key is a NAME, never a
--                                capability: only the API signs it, after the
--                                board's read check (§6.3). Used from PR-4.
--   chat.whiteboard_access_log   who opened or acted on which board, when, and
--                                on what basis. Append-only, never truncated,
--                                kept after the board is purged (§10, 1c/4b).
--
-- The API writes every row (the owner connection); request roles get nothing.
-- Who may read or write is the API's decision: the owning teacher writes; the
-- teacher's assigned supervisor, active backup, the Teachers Manager and the
-- super admin read (chat.staff_supervised_teacher_ids, whatever the PD-35
-- switch says). A teacher leaving moves their boards to 'retained' in the same
-- transaction (a trigger on chat.teacher); a reactivation moves them back.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Boards
-- ---------------------------------------------------------------------------
create table chat.whiteboard (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references chat.organization (id),
  teacher_id             uuid not null references chat.teacher (id),
  -- Set when the board was opened from a lesson; the lesson's own teacher.
  lesson_id              uuid references chat.lesson (id) on delete set null,
  title                  text not null check (length(btrim(title)) between 1 and 120),
  -- Bumped by every change; a write names the revision it was made against.
  revision               integer not null default 1 check (revision >= 1),
  state                  text not null default 'active' check (state in ('active', 'trashed', 'retained')),
  trashed_at             timestamptz,
  purge_after            timestamptz,
  retained_until         timestamptz,
  retention_notified_at  timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint whiteboard_trash_dates check (
    (state = 'trashed') = (trashed_at is not null and purge_after is not null)),
  constraint whiteboard_retention_dates check (
    (state = 'retained') = (retained_until is not null))
);

create index whiteboard_teacher_idx on chat.whiteboard (teacher_id, state, updated_at desc);
create index whiteboard_purge_idx on chat.whiteboard (purge_after) where state = 'trashed';
create index whiteboard_retention_idx on chat.whiteboard (retained_until) where state = 'retained';

comment on table chat.whiteboard is
  'PD-39: a teacher''s board. active / trashed (restorable 30 days, then purged) / retained (the teacher left: kept 12 months for the Teachers department, then purged). Owner and organization never change. Written by the API only.';

-- The owner and the organization are the board's identity: never moved.
create function chat.guard_whiteboard_identity()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.teacher_id is distinct from old.teacher_id or new.organization_id is distinct from old.organization_id then
    raise exception 'a board never changes owner or organization' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger whiteboard_identity_is_fixed before update of teacher_id, organization_id on chat.whiteboard
  for each row execute function chat.guard_whiteboard_identity();

-- A board's organization is its teacher's, and a lesson named on it is that
-- teacher's own lesson in that organization.
create function chat.guard_whiteboard_owner()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if not exists (select 1 from chat.teacher t where t.id = new.teacher_id and t.organization_id = new.organization_id) then
    raise exception 'a board belongs to its teacher''s organization' using errcode = 'check_violation';
  end if;
  if new.lesson_id is not null and (tg_op = 'INSERT' or new.lesson_id is distinct from old.lesson_id) and not exists (
       select 1 from chat.lesson l
        where l.id = new.lesson_id and l.teacher_id = new.teacher_id and l.organization_id = new.organization_id) then
    raise exception 'a board''s lesson is its teacher''s own lesson' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger whiteboard_owner_fits before insert or update of lesson_id on chat.whiteboard
  for each row execute function chat.guard_whiteboard_owner();

-- ---------------------------------------------------------------------------
-- 2. Pages
-- ---------------------------------------------------------------------------
create table chat.whiteboard_page (
  id              uuid primary key default gen_random_uuid(),
  board_id        uuid not null references chat.whiteboard (id) on delete cascade,
  position        smallint not null check (position between 0 and 49),
  layout          text not null default 'plain'
                    check (layout in ('plain', 'ruled', 'narrow_ruled', 'grid', 'arabic_lines')),
  background      text not null default 'white'
                    check (background in ('white', 'cream', 'grey', 'green', 'dark')),
  document        jsonb not null default '{"v": 1, "elements": []}'::jsonb
                    check (jsonb_typeof(document) = 'object'),
  -- Kept by the trigger below, for the per-teacher quota. The API enforces the
  -- 512 KB page limit on compact JSON; jsonb's text form spaces its separators,
  -- so this backstop leaves room for that (640 KB).
  document_bytes  integer not null default 0 check (document_bytes between 0 and 655360),
  updated_at      timestamptz not null default now(),
  constraint whiteboard_page_position unique (board_id, position) deferrable initially immediate
);

comment on table chat.whiteboard_page is
  'PD-39: one page of a board. The document is the drawing (elements); a verse in it is a reference (surah, ayat, dataset, rangeSha256), never its text. At most 512 KB.';

create function chat.whiteboard_page_bytes()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  new.document_bytes := octet_length(new.document::text);
  return new;
end;
$$;

create trigger whiteboard_page_measures before insert or update of document on chat.whiteboard_page
  for each row execute function chat.whiteboard_page_bytes();

-- ---------------------------------------------------------------------------
-- 3. Assets (object storage; the routes arrive with PR-4)
-- ---------------------------------------------------------------------------
create table chat.whiteboard_asset (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references chat.whiteboard (id) on delete cascade,
  kind          text not null check (kind in ('image', 'pdf_page', 'export_page', 'export_pdf')),
  -- whiteboards/<organization>/<board>/<asset>: a NAME, never a capability.
  object_key    text not null unique,
  content_type  text not null,
  byte_size     bigint not null check (byte_size between 1 and 20971520),
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  width         integer check (width between 1 and 8000),
  height        integer check (height between 1 and 8000),
  state         text not null default 'pending' check (state in ('pending', 'ready')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  constraint whiteboard_asset_key_shape check (
    object_key = 'whiteboards/' || split_part(object_key, '/', 2) || '/' || board_id::text || '/' || id::text)
);

create index whiteboard_asset_board_idx on chat.whiteboard_asset (board_id);

comment on table chat.whiteboard_asset is
  'PD-39: a board''s image, PDF page or export in object storage. The key is a name: only the API signs it, after the board''s read check.';

-- ---------------------------------------------------------------------------
-- 4. The access log: append-only, never truncated, outlives the board
-- ---------------------------------------------------------------------------
create table chat.whiteboard_access_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  -- No foreign keys on purpose: the history outlives a purged board (§10, 4b).
  board_id         uuid not null,
  teacher_id       uuid not null,
  viewer_id        uuid,
  viewer_kind      text not null check (viewer_kind in ('teacher', 'staff', 'support_session', 'system')),
  basis            text not null check (basis in ('owner', 'supervisor', 'backup', 'teachers_manager', 'super_admin', 'support_session', 'system')),
  action           text not null check (action in ('open', 'export', 'trash', 'restore', 'copy', 'purge', 'retain', 'unretain')),
  detail           jsonb,
  at               timestamptz not null default now(),
  constraint whiteboard_access_log_viewer check ((viewer_kind = 'system') = (viewer_id is null))
);

create index whiteboard_access_log_board_idx on chat.whiteboard_access_log (board_id, at);

comment on table chat.whiteboard_access_log is
  'PD-39: every open and action on a board, with the viewer, basis and time. Append-only, never truncated, kept after the board is purged.';

create function chat.guard_whiteboard_access_log()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'the board access log is a record; it is never changed' using errcode = 'check_violation';
  end if;
  new.at := now();
  return new;
end;
$$;

create function chat.guard_whiteboard_access_log_truncate()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
    return null;
  end if;
  raise exception 'the board access log is never truncated' using errcode = 'check_violation';
end;
$$;

create trigger whiteboard_access_log_is_append_only before insert or update or delete on chat.whiteboard_access_log
  for each row execute function chat.guard_whiteboard_access_log();
create trigger whiteboard_access_log_no_truncate before truncate on chat.whiteboard_access_log
  for each statement execute function chat.guard_whiteboard_access_log_truncate();

-- ---------------------------------------------------------------------------
-- 5. A teacher leaving keeps their boards for the Teachers department
-- ---------------------------------------------------------------------------
-- Every deactivation path ends in an update of chat.teacher (PD-43 offboarding,
-- chat.deactivate_principal, the CLI), so the boards move in the same
-- transaction. A board in trash keeps its 30-day purge; the rest are retained
-- 12 months. A reactivation within the 12 months brings them back.
-- SECURITY DEFINER with a pinned search_path and PUBLIC revoked, as PD-43's
-- teacher_supervisor_left: the deactivating writer need not be able to write
-- the board tables. It does not swallow errors: an offboarding that cannot
-- keep the boards fails rather than lose them.
create function chat.whiteboards_follow_teacher()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  was_active boolean := old.is_active and old.left_at is null;
  is_active  boolean := new.is_active and new.left_at is null;
begin
  if was_active and not is_active then
    with moved as (
      update chat.whiteboard w
         set state = 'retained', retained_until = now() + interval '12 months',
             retention_notified_at = null, updated_at = now()
       where w.teacher_id = new.id and w.state = 'active'
      returning w.id, w.organization_id, w.teacher_id)
    insert into chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action)
    select m.organization_id, m.id, m.teacher_id, null, 'system', 'system', 'retain' from moved m;
  elsif is_active and not was_active then
    with back as (
      update chat.whiteboard w
         set state = 'active', retained_until = null, retention_notified_at = null, updated_at = now()
       where w.teacher_id = new.id and w.state = 'retained' and w.retained_until > now()
      returning w.id, w.organization_id, w.teacher_id)
    insert into chat.whiteboard_access_log (organization_id, board_id, teacher_id, viewer_id, viewer_kind, basis, action)
    select b.organization_id, b.id, b.teacher_id, null, 'system', 'system', 'unretain' from back b;
  end if;
  return new;
end;
$$;

create trigger teacher_leaving_retains_whiteboards after update of is_active, left_at on chat.teacher
  for each row
  when ((old.is_active and old.left_at is null) is distinct from (new.is_active and new.left_at is null))
  execute function chat.whiteboards_follow_teacher();

-- ---------------------------------------------------------------------------
-- 6. The retention notice (PD-34): texts. The worker writes the rows.
-- ---------------------------------------------------------------------------
-- Sent once per teacher, 30 days before their boards' retention ends, to the
-- Teachers Manager and the super admin (§10, 4c). A name and a count only.
insert into chat.notification_template (key, locale, title, body) values
  ('whiteboard_retention_expiring', 'ar', 'جَوِّد',
   'ستُحذف {boards} من سبورات {teacher} في {date}. انسخ ما تريد الاحتفاظ به.'),
  ('whiteboard_retention_expiring', 'en', 'Jawwid',
   '{boards} board(s) of {teacher} will be deleted on {date}. Copy any you want to keep.'),
  ('inbox.whiteboard_retention_expiring', 'ar', 'سبورات ستُحذف قريبًا',
   'ستُحذف {boards} من سبورات {teacher} في {date}. انسخ ما تريد الاحتفاظ به.'),
  ('inbox.whiteboard_retention_expiring', 'en', 'Boards to be deleted soon',
   '{boards} board(s) of {teacher} will be deleted on {date}. Copy any you want to keep.')
on conflict (key, locale, version) do nothing;

-- ---------------------------------------------------------------------------
-- 7. PD-40: two keys. Reading boards, and managing a departed teacher's boards
-- ---------------------------------------------------------------------------
select set_config('chat.pd040_catalogue_change', 'on', true);
-- BEGIN GENERATED pd039 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('whiteboards.view', 'whiteboards', 'view', 'View teachers'' boards (read-only)', 'عرض سبورات المعلمين (للقراءة فقط)', 'pii', false, 'PD-39'),
  ('whiteboards.retention', 'whiteboards', 'retention', 'Manage departed teachers'' boards and read board access history', 'إدارة سبورات المعلمين المغادرين والاطلاع على سجل الوصول', 'pii', false, 'PD-39');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'teachers', 'whiteboards.retention'),
  ('manager', 'teachers', 'whiteboards.view'),
  ('supervisor', 'teachers', 'whiteboards.view');
-- END GENERATED pd039 catalogue rows
select set_config('chat.pd040_catalogue_change', 'off', true);

-- Board writes are rate limited (docs/security/ABUSE-LIMITS.md).
insert into chat.config (key, value, scope, description) values
('abuse.throttle.whiteboard_write_actor', '240'::jsonb, 'abuse',
 '[hypothesis] PD-39: board writes (POST /whiteboards...) one actor may make per window. An autosave every ~2 s while drawing, plus page actions.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Grants: the API (owner) only. No request role reads or writes.
-- ---------------------------------------------------------------------------
alter table chat.whiteboard enable row level security;
alter table chat.whiteboard_page enable row level security;
alter table chat.whiteboard_asset enable row level security;
alter table chat.whiteboard_access_log enable row level security;
revoke all on chat.whiteboard, chat.whiteboard_page, chat.whiteboard_asset, chat.whiteboard_access_log
  from public, anon, authenticated, chat_app;

revoke all on function chat.guard_whiteboard_identity() from public;
revoke all on function chat.guard_whiteboard_owner() from public;
revoke all on function chat.whiteboard_page_bytes() from public;
revoke all on function chat.guard_whiteboard_access_log() from public;
revoke all on function chat.guard_whiteboard_access_log_truncate() from public;
revoke all on function chat.whiteboards_follow_teacher() from public;
