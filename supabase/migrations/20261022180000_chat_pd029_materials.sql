-- PD-29 (2026-10-24) -- Materials: an open library of the academy's existing
-- Quran, Arabic and Islamic-studies materials, "practice this week" attached to
-- the lesson report, and each child's memorization progress map.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-29.
--
-- WHAT IS NEW
--
--   chat.quran_surah             the 114 surahs: names, ayah counts, the juz'
--                                each starts and ends in. Reference data,
--                                written here once and never again.
--   chat.material_upload         every object key the API issued an upload
--                                grant for, to which organization and staff
--                                member. An object key is a name, not a
--                                capability: an item or a recitation may point
--                                only at a key this table says was issued to
--                                its own organization.
--   chat.material_item           one library item. Nothing is authored here: an
--                                item PLAYS existing material -- an https link,
--                                one uploaded file (audio, video, PDF, image),
--                                or one uploaded HTML5 package (a zip, played
--                                sandboxed). Retired, never deleted, because
--                                reports point at items. `external_ref` is the
--                                stable key a bulk import updates by.
--   chat.material_package_entry  the validated index of a package's zip: each
--                                file's path and where its bytes are. The play
--                                route serves a file only if it is in here.
--   chat.recitation_source,      a recitation source (an https URL template for
--   chat.recitation_track        all 114 surahs) and per-surah overrides (a URL
--                                or an uploaded file). Plugging in the source
--                                the academy is authorized to use is data.
--   chat.lesson_report_practice  "practice this week": an ayah range or a
--                                library item attached to a lesson report.
--                                Written with the report, or withdrawn and
--                                replaced alongside a PD-15 report revision --
--                                never deleted, so a report's history keeps it.
--   chat.memorization_mark       the progress map's history. APPEND-ONLY: a
--                                surah's status for a child is its newest mark
--                                (chat.memorization_status). A teacher marks in
--                                the report; a correction names its reason.
--
-- FAIL CLOSED. RLS on, no grant to any request role: only the server reads or
-- writes these tables.

-- ===========================================================================
-- 1. The surahs
-- ===========================================================================

create table chat.quran_surah (
  number      smallint primary key check (number between 1 and 114),
  name_ar     text not null check (length(name_ar) between 1 and 40),
  name_en     text not null check (length(name_en) between 1 and 40),
  ayah_count  smallint not null check (ayah_count between 3 and 286),
  -- The juz' the surah's first ayah is in, and the one its last ayah is in.
  juz         smallint not null check (juz between 1 and 30),
  juz_end     smallint not null check (juz_end between 1 and 30),
  constraint quran_surah_juz_in_order check (juz_end >= juz)
);

comment on table chat.quran_surah is
  'PD-29: the 114 surahs (Hafs numbering): names, ayah counts, and the juz'' each starts and ends in. Reference data, fixed by its migration.';

-- Surah 19's Arabic name is a Unicode-escape literal: its letters are also a
-- name the G-20 guard protects (scripts/qa/guards.sh). The stored value is the
-- surah's name, unchanged.
insert into chat.quran_surah (number, name_ar, name_en, ayah_count, juz, juz_end) values
  (1, 'الفاتحة', 'Al-Fatihah', 7, 1, 1),
  (2, 'البقرة', 'Al-Baqarah', 286, 1, 3),
  (3, 'آل عمران', 'Al Imran', 200, 3, 4),
  (4, 'النساء', 'An-Nisa', 176, 4, 6),
  (5, 'المائدة', 'Al-Ma''idah', 120, 6, 7),
  (6, 'الأنعام', 'Al-An''am', 165, 7, 8),
  (7, 'الأعراف', 'Al-A''raf', 206, 8, 9),
  (8, 'الأنفال', 'Al-Anfal', 75, 9, 10),
  (9, 'التوبة', 'At-Tawbah', 129, 10, 11),
  (10, 'يونس', 'Yunus', 109, 11, 11),
  (11, 'هود', 'Hud', 123, 11, 12),
  (12, 'يوسف', 'Yusuf', 111, 12, 13),
  (13, 'الرعد', 'Ar-Ra''d', 43, 13, 13),
  (14, 'إبراهيم', 'Ibrahim', 52, 13, 13),
  (15, 'الحجر', 'Al-Hijr', 99, 14, 14),
  (16, 'النحل', 'An-Nahl', 128, 14, 14),
  (17, 'الإسراء', 'Al-Isra', 111, 15, 15),
  (18, 'الكهف', 'Al-Kahf', 110, 15, 16),
  (19, U&'\0645\0631\064A\0645', 'Maryam', 98, 16, 16),
  (20, 'طه', 'Ta-Ha', 135, 16, 16),
  (21, 'الأنبياء', 'Al-Anbiya', 112, 17, 17),
  (22, 'الحج', 'Al-Hajj', 78, 17, 17),
  (23, 'المؤمنون', 'Al-Mu''minun', 118, 18, 18),
  (24, 'النور', 'An-Nur', 64, 18, 18),
  (25, 'الفرقان', 'Al-Furqan', 77, 18, 19),
  (26, 'الشعراء', 'Ash-Shu''ara', 227, 19, 19),
  (27, 'النمل', 'An-Naml', 93, 19, 20),
  (28, 'القصص', 'Al-Qasas', 88, 20, 20),
  (29, 'العنكبوت', 'Al-Ankabut', 69, 20, 21),
  (30, 'الروم', 'Ar-Rum', 60, 21, 21),
  (31, 'لقمان', 'Luqman', 34, 21, 21),
  (32, 'السجدة', 'As-Sajdah', 30, 21, 21),
  (33, 'الأحزاب', 'Al-Ahzab', 73, 21, 22),
  (34, 'سبأ', 'Saba', 54, 22, 22),
  (35, 'فاطر', 'Fatir', 45, 22, 22),
  (36, 'يس', 'Ya-Sin', 83, 22, 23),
  (37, 'الصافات', 'As-Saffat', 182, 23, 23),
  (38, 'ص', 'Sad', 88, 23, 23),
  (39, 'الزمر', 'Az-Zumar', 75, 23, 24),
  (40, 'غافر', 'Ghafir', 85, 24, 24),
  (41, 'فصلت', 'Fussilat', 54, 24, 25),
  (42, 'الشورى', 'Ash-Shura', 53, 25, 25),
  (43, 'الزخرف', 'Az-Zukhruf', 89, 25, 25),
  (44, 'الدخان', 'Ad-Dukhan', 59, 25, 25),
  (45, 'الجاثية', 'Al-Jathiyah', 37, 25, 25),
  (46, 'الأحقاف', 'Al-Ahqaf', 35, 26, 26),
  (47, 'محمد', 'Muhammad', 38, 26, 26),
  (48, 'الفتح', 'Al-Fath', 29, 26, 26),
  (49, 'الحجرات', 'Al-Hujurat', 18, 26, 26),
  (50, 'ق', 'Qaf', 45, 26, 26),
  (51, 'الذاريات', 'Adh-Dhariyat', 60, 26, 27),
  (52, 'الطور', 'At-Tur', 49, 27, 27),
  (53, 'النجم', 'An-Najm', 62, 27, 27),
  (54, 'القمر', 'Al-Qamar', 55, 27, 27),
  (55, 'الرحمن', 'Ar-Rahman', 78, 27, 27),
  (56, 'الواقعة', 'Al-Waqi''ah', 96, 27, 27),
  (57, 'الحديد', 'Al-Hadid', 29, 27, 27),
  (58, 'المجادلة', 'Al-Mujadilah', 22, 28, 28),
  (59, 'الحشر', 'Al-Hashr', 24, 28, 28),
  (60, 'الممتحنة', 'Al-Mumtahanah', 13, 28, 28),
  (61, 'الصف', 'As-Saff', 14, 28, 28),
  (62, 'الجمعة', 'Al-Jumu''ah', 11, 28, 28),
  (63, 'المنافقون', 'Al-Munafiqun', 11, 28, 28),
  (64, 'التغابن', 'At-Taghabun', 18, 28, 28),
  (65, 'الطلاق', 'At-Talaq', 12, 28, 28),
  (66, 'التحريم', 'At-Tahrim', 12, 28, 28),
  (67, 'الملك', 'Al-Mulk', 30, 29, 29),
  (68, 'القلم', 'Al-Qalam', 52, 29, 29),
  (69, 'الحاقة', 'Al-Haqqah', 52, 29, 29),
  (70, 'المعارج', 'Al-Ma''arij', 44, 29, 29),
  (71, 'نوح', 'Nuh', 28, 29, 29),
  (72, 'الجن', 'Al-Jinn', 28, 29, 29),
  (73, 'المزمل', 'Al-Muzzammil', 20, 29, 29),
  (74, 'المدثر', 'Al-Muddaththir', 56, 29, 29),
  (75, 'القيامة', 'Al-Qiyamah', 40, 29, 29),
  (76, 'الإنسان', 'Al-Insan', 31, 29, 29),
  (77, 'المرسلات', 'Al-Mursalat', 50, 29, 29),
  (78, 'النبأ', 'An-Naba', 40, 30, 30),
  (79, 'النازعات', 'An-Nazi''at', 46, 30, 30),
  (80, 'عبس', 'Abasa', 42, 30, 30),
  (81, 'التكوير', 'At-Takwir', 29, 30, 30),
  (82, 'الانفطار', 'Al-Infitar', 19, 30, 30),
  (83, 'المطففين', 'Al-Mutaffifin', 36, 30, 30),
  (84, 'الانشقاق', 'Al-Inshiqaq', 25, 30, 30),
  (85, 'البروج', 'Al-Buruj', 22, 30, 30),
  (86, 'الطارق', 'At-Tariq', 17, 30, 30),
  (87, 'الأعلى', 'Al-A''la', 19, 30, 30),
  (88, 'الغاشية', 'Al-Ghashiyah', 26, 30, 30),
  (89, 'الفجر', 'Al-Fajr', 30, 30, 30),
  (90, 'البلد', 'Al-Balad', 20, 30, 30),
  (91, 'الشمس', 'Ash-Shams', 15, 30, 30),
  (92, 'الليل', 'Al-Layl', 21, 30, 30),
  (93, 'الضحى', 'Ad-Duha', 11, 30, 30),
  (94, 'الشرح', 'Ash-Sharh', 8, 30, 30),
  (95, 'التين', 'At-Tin', 8, 30, 30),
  (96, 'العلق', 'Al-Alaq', 19, 30, 30),
  (97, 'القدر', 'Al-Qadr', 5, 30, 30),
  (98, 'البينة', 'Al-Bayyinah', 8, 30, 30),
  (99, 'الزلزلة', 'Az-Zalzalah', 8, 30, 30),
  (100, 'العاديات', 'Al-Adiyat', 11, 30, 30),
  (101, 'القارعة', 'Al-Qari''ah', 11, 30, 30),
  (102, 'التكاثر', 'At-Takathur', 8, 30, 30),
  (103, 'العصر', 'Al-Asr', 3, 30, 30),
  (104, 'الهمزة', 'Al-Humazah', 9, 30, 30),
  (105, 'الفيل', 'Al-Fil', 5, 30, 30),
  (106, 'قريش', 'Quraysh', 4, 30, 30),
  (107, 'الماعون', 'Al-Ma''un', 7, 30, 30),
  (108, 'الكوثر', 'Al-Kawthar', 3, 30, 30),
  (109, 'الكافرون', 'Al-Kafirun', 6, 30, 30),
  (110, 'النصر', 'An-Nasr', 3, 30, 30),
  (111, 'المسد', 'Al-Masad', 5, 30, 30),
  (112, 'الإخلاص', 'Al-Ikhlas', 4, 30, 30),
  (113, 'الفلق', 'Al-Falaq', 5, 30, 30),
  (114, 'الناس', 'An-Nas', 6, 30, 30);

create or replace function chat.forbid_quran_surah_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the surah table is reference data, fixed by its migration' using errcode = 'check_violation';
end;
$$;

create trigger quran_surah_is_fixed before insert or update or delete on chat.quran_surah
  for each statement execute function chat.forbid_quran_surah_change();

-- ===========================================================================
-- 2. Upload grants
-- ===========================================================================

create table chat.material_upload (
  object_key       text primary key check (length(object_key) between 1 and 512),
  organization_id  uuid not null references chat.organization (id),
  issued_to        uuid not null references chat.staff (id),
  purpose          text not null check (purpose in ('item', 'recitation')),
  file_name        text check (file_name is null or length(file_name) between 1 and 255),
  mime_type        text not null check (length(mime_type) between 3 and 120),
  byte_size        bigint not null check (byte_size between 1 and 524288000),
  issued_at        timestamptz not null default now()
);

comment on table chat.material_upload is
  'PD-29: each object key an upload grant was issued for -- organization, staff member, declared type and size. The only keys an item or recitation may name.';

create or replace function chat.guard_material_upload()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'an upload grant is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.staff s where s.id = new.issued_to and s.organization_id = new.organization_id
                   and s.is_active and s.left_at is null) then
    raise exception 'an upload is granted to an active staff member of its organization' using errcode = 'insufficient_privilege';
  end if;
  new.issued_at := now();
  return new;
end;
$$;

create trigger material_upload_is_recorded before insert or update or delete on chat.material_upload
  for each row execute function chat.guard_material_upload();

-- ===========================================================================
-- 3. Library items
-- ===========================================================================

create table chat.material_item (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  external_ref     text check (external_ref is null or length(btrim(external_ref)) between 1 and 200),
  subject          text not null check (subject in ('quran', 'arabic', 'islamic_studies')),
  strand           text check (strand in ('memorization', 'recitation', 'word_meanings', 'tafsir')),
  title_ar         text check (title_ar is null or length(btrim(title_ar)) between 1 and 200),
  title_en         text check (title_en is null or length(btrim(title_en)) between 1 and 200),
  description      text check (description is null or length(description) <= 2000),
  kind             text not null check (kind in ('activity_package', 'activity_link', 'audio', 'video', 'pdf', 'image')),
  source           text not null check (source in ('url', 'file', 'package')),
  url              text check (url is null or (url ~ '^https://[^\s/]+' and length(url) <= 2000)),
  object_key       text references chat.material_upload (object_key),
  mime_type        text check (mime_type is null or length(mime_type) between 3 and 120),
  byte_size        bigint check (byte_size is null or byte_size > 0),
  -- A package's start page, inside its zip (normally index.html).
  package_entry    text check (package_entry is null or length(package_entry) between 1 and 512),
  age_groups       text[] not null default '{}'
                     check (age_groups <@ array['4-6', '7-9', '10-12', '13-17', '18+']::text[]),
  surah            smallint references chat.quran_surah (number),
  status           text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by       uuid not null references chat.staff (id),
  updated_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint material_item_has_a_title check (title_ar is not null or title_en is not null),
  constraint material_item_strand_is_quran check (strand is null or subject = 'quran'),
  constraint material_item_source_shape check (
       (source = 'url' and url is not null and object_key is null and package_entry is null
          and kind <> 'activity_package')
    or (source = 'file' and object_key is not null and url is null and package_entry is null
          and kind in ('audio', 'video', 'pdf', 'image') and mime_type is not null and byte_size is not null)
    or (source = 'package' and object_key is not null and url is null and package_entry is not null
          and kind = 'activity_package' and byte_size is not null)),
  constraint material_item_link_is_a_url check (kind <> 'activity_link' or source = 'url')
);

comment on table chat.material_item is
  'PD-29: one library item -- existing material played as an https link, an uploaded file or a sandboxed HTML5 package. Retired, never deleted.';

create unique index material_item_external_ref on chat.material_item (organization_id, external_ref)
  where external_ref is not null;
create index material_item_library_idx on chat.material_item (organization_id, subject, status);

create trigger material_item_updated_at before update on chat.material_item
  for each row execute function chat.set_updated_at();

-- The super admin, or the manager of the organization's Teachers department.
create or replace function chat.can_manage_materials(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null
       and (s.role = 'super_admin'
            or exists (select 1 from chat.department d
                        where d.organization_id = p_org and d.kind = 'teachers' and d.manager_id = s.id)));
$$;

create or replace function chat.guard_material_item()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a library item is never deleted; retire it' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.organization_id, new.created_by, new.created_at)
                          is distinct from (old.id, old.organization_id, old.created_by, old.created_at) then
    raise exception 'a library item''s identity never changes' using errcode = 'check_violation';
  end if;
  if not chat.can_manage_materials(new.updated_by, new.organization_id) then
    raise exception 'the library is managed by the super admin or the Teachers manager' using errcode = 'insufficient_privilege';
  end if;
  if new.object_key is not null
     and (tg_op = 'INSERT' or new.object_key is distinct from old.object_key)
     and not exists (select 1 from chat.material_upload u
                      where u.object_key = new.object_key and u.organization_id = new.organization_id
                        and u.purpose = 'item') then
    raise exception 'an item names only a file uploaded for its own organization''s library' using errcode = 'insufficient_privilege';
  end if;
  if new.source = 'package'
     and not exists (select 1 from chat.material_package_entry e
                      where e.object_key = new.object_key and e.path = new.package_entry) then
    raise exception 'a package starts at a file of its validated index' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 4. Package index
-- ===========================================================================

create table chat.material_package_entry (
  object_key       text not null references chat.material_upload (object_key),
  path             text not null check (length(path) between 1 and 512 and path !~ '(^/|\\|(^|/)\.\.(/|$))'),
  -- Where the entry's (compressed) bytes start in the zip, and how they are stored.
  data_offset      bigint not null check (data_offset >= 0),
  compressed_size  bigint not null check (compressed_size >= 0),
  size             bigint not null check (size >= 0),
  method           smallint not null check (method in (0, 8)),
  crc32            bigint not null check (crc32 between 0 and 4294967295),
  primary key (object_key, path)
);

comment on table chat.material_package_entry is
  'PD-29: the validated index of an HTML5 package (a zip): each file it may serve and where its bytes are. Written once, by the validation.';

create or replace function chat.guard_material_package_entry()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a package index is written once' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.material_upload u where u.object_key = new.object_key and u.purpose = 'item') then
    raise exception 'a package is a file uploaded for the library' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger material_package_entry_is_written_once before insert or update or delete on chat.material_package_entry
  for each row execute function chat.guard_material_package_entry();

create trigger material_item_is_coherent before insert or update or delete on chat.material_item
  for each row execute function chat.guard_material_item();

-- ===========================================================================
-- 5. Recitations
-- ===========================================================================

create table chat.recitation_source (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  name             text not null check (length(btrim(name)) between 1 and 120),
  -- An https URL with {surah} (1..114) or {surah3} (001..114) in it.
  url_template     text check (url_template is null
                               or (url_template ~ '^https://[^\s/]+' and length(url_template) <= 2000
                                   and url_template ~ '\{surah3?\}')),
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  created_by       uuid not null references chat.staff (id),
  updated_by       uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint recitation_source_default_is_active check (not is_default or is_active)
);

comment on table chat.recitation_source is
  'PD-29: a recitation source the academy is authorized to use: a URL template for all 114 surahs, overridden per surah by chat.recitation_track.';

create unique index recitation_source_one_default on chat.recitation_source (organization_id) where is_default;

create trigger recitation_source_updated_at before update on chat.recitation_source
  for each row execute function chat.set_updated_at();

create table chat.recitation_track (
  source_id        uuid not null references chat.recitation_source (id),
  surah            smallint not null references chat.quran_surah (number),
  organization_id  uuid not null references chat.organization (id),
  url              text check (url is null or (url ~ '^https://[^\s/]+' and length(url) <= 2000)),
  object_key       text references chat.material_upload (object_key),
  updated_by       uuid not null references chat.staff (id),
  updated_at       timestamptz not null default now(),
  primary key (source_id, surah),
  constraint recitation_track_one_source check ((url is null) <> (object_key is null))
);

comment on table chat.recitation_track is
  'PD-29: one surah''s recitation in a source -- an https URL or an uploaded audio file -- overriding the source''s template.';

create or replace function chat.guard_recitation()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'recitation_source' and tg_op = 'DELETE' then
    raise exception 'a recitation source is retired, never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    if not chat.can_manage_materials(nullif(current_setting('chat.materials_actor', true), '')::uuid, old.organization_id) then
      raise exception 'recitations are managed by the super admin or the Teachers manager' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if not chat.can_manage_materials(new.updated_by, new.organization_id) then
    raise exception 'recitations are managed by the super admin or the Teachers manager' using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'recitation_track' then
    select organization_id into v_org from chat.recitation_source where id = new.source_id;
    if v_org is distinct from new.organization_id then
      raise exception 'a track belongs to its source''s organization' using errcode = 'insufficient_privilege';
    end if;
    if new.object_key is not null
       and not exists (select 1 from chat.material_upload u
                        where u.object_key = new.object_key and u.organization_id = new.organization_id
                          and u.purpose = 'recitation') then
      raise exception 'a track names only a recitation uploaded for its own organization' using errcode = 'insufficient_privilege';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger recitation_source_is_coherent before insert or update or delete on chat.recitation_source
  for each row execute function chat.guard_recitation();
create trigger recitation_track_is_coherent before insert or update or delete on chat.recitation_track
  for each row execute function chat.guard_recitation();

-- ===========================================================================
-- 6. Practice this week
-- ===========================================================================

create table chat.lesson_report_practice (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  lesson_id        uuid not null references chat.lesson_report (lesson_id),
  position         smallint not null check (position between 1 and 10),
  kind             text not null check (kind in ('ayah_range', 'item')),
  surah            smallint references chat.quran_surah (number),
  ayah_from        smallint check (ayah_from is null or ayah_from >= 1),
  ayah_to          smallint check (ayah_to is null or ayah_to >= 1),
  item_id          uuid references chat.material_item (id),
  added_at         timestamptz not null default now(),
  withdrawn_at     timestamptz,
  constraint lesson_report_practice_shape check (
       (kind = 'ayah_range' and surah is not null and ayah_from is not null and ayah_to is not null
          and ayah_from <= ayah_to and item_id is null)
    or (kind = 'item' and item_id is not null and surah is null and ayah_from is null and ayah_to is null))
);

comment on table chat.lesson_report_practice is
  'PD-29: practice attached to a lesson report (an ayah range or a library item). Withdrawn and replaced only beside a PD-15 report revision; never deleted.';

create index lesson_report_practice_live_idx on chat.lesson_report_practice (lesson_id) where withdrawn_at is null;

create or replace function chat.guard_lesson_report_practice()
returns trigger
language plpgsql
as $$
declare
  v_report chat.lesson_report%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'practice is withdrawn, never deleted' using errcode = 'check_violation';
  end if;
  select * into v_report from chat.lesson_report where lesson_id = coalesce(new.lesson_id, old.lesson_id);
  if tg_op = 'UPDATE' then
    if (new.id, new.organization_id, new.lesson_id, new.position, new.kind, new.surah, new.ayah_from, new.ayah_to,
        new.item_id, new.added_at)
       is distinct from
       (old.id, old.organization_id, old.lesson_id, old.position, old.kind, old.surah, old.ayah_from, old.ayah_to,
        old.item_id, old.added_at)
       or old.withdrawn_at is not null or new.withdrawn_at is null then
      raise exception 'practice is only ever withdrawn' using errcode = 'check_violation';
    end if;
    if not chat.report_revised_now(old.lesson_id) then
      raise exception 'practice changes only with a recorded report revision' using errcode = 'check_violation';
    end if;
    new.withdrawn_at := now();
    return new;
  end if;
  if v_report.organization_id is distinct from new.organization_id then
    raise exception 'practice belongs to its report''s organization' using errcode = 'insufficient_privilege';
  end if;
  -- Born with its report (submitted_at is the creating transaction's now()) or
  -- beside a revision of it.
  if v_report.submitted_at is distinct from now() and not chat.report_revised_now(new.lesson_id) then
    raise exception 'practice is attached with the report or with a recorded report revision' using errcode = 'check_violation';
  end if;
  if new.kind = 'ayah_range'
     and not exists (select 1 from chat.quran_surah q where q.number = new.surah and new.ayah_to <= q.ayah_count) then
    raise exception 'an ayah range lies inside its surah' using errcode = 'check_violation';
  end if;
  if new.kind = 'item'
     and not exists (select 1 from chat.material_item i
                      where i.id = new.item_id and i.organization_id = new.organization_id and i.status = 'published') then
    raise exception 'practice names a published item of the organization''s library' using errcode = 'check_violation';
  end if;
  new.added_at := now();
  new.withdrawn_at := null;
  return new;
end;
$$;

create trigger lesson_report_practice_is_coherent before insert or update or delete on chat.lesson_report_practice
  for each row execute function chat.guard_lesson_report_practice();

-- ===========================================================================
-- 7. The memorization progress map
-- ===========================================================================

create table chat.memorization_mark (
  id               uuid primary key default gen_random_uuid(),
  -- The order marks were written in; the newest per (learner, surah) is the status.
  seq              bigint generated always as identity,
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id),
  surah            smallint not null references chat.quran_surah (number),
  status           text not null check (status in ('not_started', 'in_progress', 'memorized', 'needs_revision')),
  source           text not null check (source in ('report', 'report_edit', 'correction')),
  lesson_id        uuid references chat.lesson (id),
  reason           text check (reason is null or length(btrim(reason)) between 1 and 1000),
  by_kind          text not null check (by_kind in ('teacher', 'staff')),
  by_id            uuid not null,
  at               timestamptz not null default now(),
  constraint memorization_mark_correction_says_why check ((source = 'correction') = (reason is not null)),
  constraint memorization_mark_report_names_lesson check ((source in ('report', 'report_edit')) = (lesson_id is not null)),
  constraint memorization_mark_staff_correct check (by_kind = 'teacher' or source = 'correction')
);

comment on table chat.memorization_mark is
  'PD-29: the memorization progress map''s history -- each surah status a teacher marked in a report, or corrected with a reason. Append-only.';

create unique index memorization_mark_seq on chat.memorization_mark (seq);
create index memorization_mark_learner_idx on chat.memorization_mark (learner_id, surah, seq desc);

create or replace function chat.guard_memorization_mark()
returns trigger
language plpgsql
as $$
declare
  v_learner chat.learner%rowtype;
  v_lesson  chat.lesson%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'the progress map is append-only: a mark is never changed or removed' using errcode = 'check_violation';
  end if;
  select * into v_learner from chat.learner where id = new.learner_id;
  if v_learner.organization_id is distinct from new.organization_id then
    raise exception 'a mark belongs to its child''s organization' using errcode = 'insufficient_privilege';
  end if;
  if new.by_kind = 'teacher' then
    if v_learner.teacher_id is distinct from new.by_id
       or not exists (select 1 from chat.teacher t where t.id = new.by_id and t.is_active and t.left_at is null) then
      raise exception 'a teacher marks only their own students' using errcode = 'insufficient_privilege';
    end if;
  else
    if not (chat.can_correct_lessons(new.by_id, new.organization_id)
            or chat.staff_reaches_family(new.by_id, v_learner.family_id) is not null) then
      raise exception 'a child''s map is corrected by their teacher, their supervisor or the Teachers department'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.lesson_id is not null then
    select * into v_lesson from chat.lesson where id = new.lesson_id;
    if v_lesson.learner_id is distinct from new.learner_id or v_lesson.teacher_id is distinct from new.by_id
       or not exists (select 1 from chat.lesson_report r where r.lesson_id = new.lesson_id and r.deleted_at is null) then
      raise exception 'a report''s mark is the reported lesson''s child, by its teacher' using errcode = 'check_violation';
    end if;
  end if;
  new.at := now();
  return new;
end;
$$;

create trigger memorization_mark_is_append_only before insert or update or delete on chat.memorization_mark
  for each row execute function chat.guard_memorization_mark();

create view chat.memorization_status as
  select distinct on (m.learner_id, m.surah)
         m.learner_id, m.surah, m.status, m.source, m.at, m.by_kind, m.by_id, m.seq
    from chat.memorization_mark m
   order by m.learner_id, m.surah, m.seq desc;

comment on view chat.memorization_status is
  'PD-29: each child''s current status per surah -- the newest chat.memorization_mark.';

-- ===========================================================================
-- 8. Fail closed
-- ===========================================================================

alter table chat.quran_surah             enable row level security;
alter table chat.material_upload         enable row level security;
alter table chat.material_item           enable row level security;
alter table chat.material_package_entry  enable row level security;
alter table chat.recitation_source       enable row level security;
alter table chat.recitation_track        enable row level security;
alter table chat.lesson_report_practice  enable row level security;
alter table chat.memorization_mark       enable row level security;

revoke all on chat.quran_surah, chat.material_upload, chat.material_item, chat.material_package_entry,
  chat.recitation_source, chat.recitation_track, chat.lesson_report_practice, chat.memorization_mark,
  chat.memorization_status
  from public, anon, authenticated, chat_app;

revoke all on function chat.forbid_quran_surah_change() from public;
revoke all on function chat.guard_material_upload() from public;
revoke all on function chat.can_manage_materials(uuid, uuid) from public;
revoke all on function chat.guard_material_item() from public;
revoke all on function chat.guard_material_package_entry() from public;
revoke all on function chat.guard_recitation() from public;
revoke all on function chat.guard_lesson_report_practice() from public;
revoke all on function chat.guard_memorization_mark() from public;
