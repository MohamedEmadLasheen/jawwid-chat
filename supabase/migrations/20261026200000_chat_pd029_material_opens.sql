-- PD-29 amendment (2026-10-26) -- the owner's changes to the Library.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-29, "Amendment
-- 2026-10-26".
--
--   chat.material_item.sort_order  the order materials were provided in (the
--                                  bulk manifest's row order; editable by the
--                                  library's managers). Quran items are ordered
--                                  by surah instead (Al-Fatihah first, then
--                                  114 down), by the API, not by this column.
--   chat.material_open             one row per successful open of an item FOR A
--                                  CHILD (learner, item, who opened it, when).
--                                  Feeds the child page's "Opened this week".
--                                  Append-only.
--
-- The memorization map leaves the product's screens, but its data stays:
-- chat.memorization_mark is untouched (append-only, nothing dropped).

alter table chat.material_item
  add column sort_order integer check (sort_order is null or sort_order between 1 and 1000000);

comment on column chat.material_item.sort_order is
  'PD-29 amendment: the order the materials were provided in (manifest row order); Quran items order by surah instead.';

-- The 83 seeded lessons take their manifest order (docs/product/pd029-seed).
-- A data backfill, not an edit by anyone: the item guard (which requires the
-- editor to manage the library NOW) is set aside for this one statement.
alter table chat.material_item disable trigger material_item_is_coherent;
update chat.material_item i
   set sort_order = s.ord
  from (values
    ('/lessons/quran/surah-1', 1),
    ('/lessons/quran/surah-78', 2),
    ('/lessons/quran/surah-79', 3),
    ('/lessons/quran/surah-80', 4),
    ('/lessons/quran/surah-81', 5),
    ('/lessons/quran/surah-82', 6),
    ('/lessons/quran/surah-83', 7),
    ('/lessons/quran/surah-84', 8),
    ('/lessons/quran/surah-85', 9),
    ('/lessons/quran/surah-86', 10),
    ('/lessons/quran/surah-87', 11),
    ('/lessons/quran/surah-88', 12),
    ('/lessons/quran/surah-89', 13),
    ('/lessons/quran/surah-90', 14),
    ('/lessons/quran/surah-91', 15),
    ('/lessons/quran/surah-92', 16),
    ('/lessons/quran/surah-93', 17),
    ('/lessons/quran/surah-94', 18),
    ('/lessons/quran/surah-95', 19),
    ('/lessons/quran/surah-96', 20),
    ('/lessons/quran/surah-97', 21),
    ('/lessons/quran/surah-98', 22),
    ('/lessons/quran/surah-99', 23),
    ('/lessons/quran/surah-100', 24),
    ('/lessons/quran/surah-101', 25),
    ('/lessons/quran/surah-102', 26),
    ('/lessons/quran/surah-103', 27),
    ('/lessons/quran/surah-104', 28),
    ('/lessons/quran/surah-105', 29),
    ('/lessons/quran/surah-106', 30),
    ('/lessons/quran/surah-107', 31),
    ('/lessons/quran/surah-108', 32),
    ('/lessons/quran/surah-109', 33),
    ('/lessons/quran/surah-110', 34),
    ('/lessons/quran/surah-111', 35),
    ('/lessons/quran/surah-112', 36),
    ('/lessons/quran/surah-113', 37),
    ('/lessons/quran/surah-114', 38),
    ('/lessons/arabic/lesson-1', 39),
    ('/lessons/arabic/lesson-2', 40),
    ('/lessons/arabic/lesson-3', 41),
    ('/lessons/arabic/lesson-4', 42),
    ('/lessons/arabic/lesson-5', 43),
    ('/lessons/arabic/lesson-6', 44),
    ('/lessons/arabic/lesson-7', 45),
    ('/lessons/arabic/lesson-8', 46),
    ('/lessons/arabic/lesson-9', 47),
    ('/lessons/arabic/lesson-10', 48),
    ('/lessons/islamic/lesson-1', 49),
    ('/lessons/islamic/lesson-2', 50),
    ('/lessons/islamic/lesson-3', 51),
    ('/lessons/islamic/lesson-4', 52),
    ('/lessons/islamic/lesson-5', 53),
    ('/lessons/islamic/lesson-6', 54),
    ('/lessons/islamic/lesson-7', 55),
    ('/lessons/islamic/lesson-8', 56),
    ('/lessons/islamic/lesson-9', 57),
    ('/lessons/islamic/lesson-10', 58),
    ('/lessons/islamic/lesson-11', 59),
    ('/lessons/islamic/lesson-12', 60),
    ('/lessons/islamic/lesson-13', 61),
    ('/lessons/islamic/lesson-14', 62),
    ('/lessons/islamic/lesson-15', 63),
    ('/lessons/islamic/lesson-16', 64),
    ('/lessons/islamic/lesson-17', 65),
    ('/lessons/islamic/lesson-18', 66),
    ('/lessons/islamic/lesson-19', 67),
    ('/lessons/islamic/lesson-20', 68),
    ('/lessons/islamic/lesson-21', 69),
    ('/lessons/islamic/lesson-22', 70),
    ('/lessons/islamic/lesson-23', 71),
    ('/lessons/islamic/lesson-24', 72),
    ('/lessons/islamic/lesson-25', 73),
    ('/lessons/islamic/lesson-26', 74),
    ('/lessons/islamic/lesson-27', 75),
    ('/lessons/islamic/lesson-28', 76),
    ('/lessons/islamic/lesson-29', 77),
    ('/lessons/islamic/lesson-30', 78),
    ('/lessons/islamic/lesson-31', 79),
    ('/lessons/islamic/lesson-32', 80),
    ('/lessons/islamic/lesson-33', 81),
    ('/lessons/islamic/lesson-34', 82),
    ('/lessons/islamic/lesson-35', 83)
  ) as s(ref, ord)
 where i.external_ref = s.ref and i.sort_order is null;
alter table chat.material_item enable trigger material_item_is_coherent;

create table chat.material_open (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id),
  item_id          uuid not null references chat.material_item (id),
  opened_by        uuid not null,
  opened_by_kind   text not null check (opened_by_kind in ('contact', 'teacher', 'staff')),
  opened_at        timestamptz not null default now()
);

comment on table chat.material_open is
  'PD-29 amendment: each time an item was opened for a child -- the child, the item, who opened it, when. Append-only.';

create index material_open_learner_idx on chat.material_open (learner_id, opened_at desc);

create or replace function chat.guard_material_open()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'an opening is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.learner l where l.id = new.learner_id and l.organization_id = new.organization_id)
     or not exists (select 1 from chat.material_item i where i.id = new.item_id and i.organization_id = new.organization_id) then
    raise exception 'an opening, its child and its item share one organization' using errcode = 'insufficient_privilege';
  end if;
  new.opened_at := now();
  return new;
end;
$$;

create trigger material_open_is_append_only before insert or update or delete on chat.material_open
  for each row execute function chat.guard_material_open();

alter table chat.material_open enable row level security;
revoke all on chat.material_open from public, anon, authenticated, chat_app;
revoke all on function chat.guard_material_open() from public;
