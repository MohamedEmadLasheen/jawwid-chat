-- PD-29 amendment, materials quality P0-2: the ONE shared Quran dataset.
--
-- Record: docs/product/quran-dataset-contract.md (agreed with PD-39, which
-- consumes it) and docs/product/pd029-materials-quality-plan.md §C. The
-- owner's rule (2026-10-27): one centralized text for the lessons and the
-- whiteboard; checked against a fixed, trusted fingerprint every time it is
-- loaded; Tajweed shown only once verified and approved; no mismatch between
-- verses, audio and Tajweed.
--
--   chat.quran_dataset            one row per pinned source file (its SHA-256
--                                 and the digest of its 6,236 ayah hashes)
--   chat.quran_ayah               per (dataset, surah, ayah): the VERBATIM line
--                                 and its hash, and its split into the Basmala
--                                 prefix (ayah 1 of 112 surahs) and the verse.
--                                 Tajweed offsets, audio and range references
--                                 are all defined against `verse`.
--   chat.quran_ayah_audio         one file per ayah; its key is GENERATED from
--                                 (reciter, surah, ayah). Written only by the
--                                 server's ingest, which hashes the stored
--                                 object itself. Empty.
--   chat.quran_tajweed_mark       one rule over a code-point range of one verse:
--                                 pending -> approved | rejected, once.
--   chat.quran_tajweed_review     a sign-off of one surah for one source
--                                 version, naming the EXACT approved marks it
--                                 covers and their digest.
--   chat.quran_tajweed_withdrawal an approved mark pulled, with who and why.
--
-- The text only ever arrives through chat.load_quran_dataset, which checks the
-- counts against chat.quran_surah, the Basmala split and the digest, in one
-- transaction. Everything is append-only; nothing is granted to request roles.
--
-- The `chat.loading_quran` and `chat.ingesting_quran_audio` settings route
-- writes through their one function; they are NOT a security boundary (anyone
-- able to run SQL as the owner can set them). The boundary is the grants: no
-- request role can touch these tables at all.

-- --- Fixed values -----------------------------------------------------------

-- The accepted Basmala prefixes, by SHA-256 of their UTF-8 (never typed: the
-- same list is in apps/api/src/quran/quran-integrity.ts and the loader).
-- The plain spelling (1:1 itself, prefixed to 110 surahs) and the bi-shadda
-- spelling prefixed to 95 and 97, both read from the pinned Tanzil 1.1 file.
create or replace function chat.quran_basmala_sha256()
returns text[]
language sql
immutable
as $$
  select array[
    'ac1e6f8f64c2e83d0b5087625a5e1eb0067b99d4a8962d3ad30528709dcf3dd6',
    '5c88aa6a96b7e5db4565abcd6694de3a379dc4233bcd4abbe65952559c3d544a'
  ]::text[];
$$;

create or replace function chat.sha256_hex(p text)
returns text
language sql
immutable
strict
as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex'); $$;

-- text_search: the same folding as lib/shared/utils/search_text.dart
-- (SearchText.fold), derived here and never supplied by a caller. Characters
-- are written as chr(code point) so no Arabic is typed into this file. Held to
-- data/quran/search-normalisation.vectors.json by the integration spec.
create or replace function chat.quran_fold(p text)
returns text
language sql
immutable
strict
as $$
  select regexp_replace(regexp_replace(
    translate(
      -- tashkeel U+064B-U+065F, superscript alef U+0670, Quranic marks U+06D6-U+06ED, tatweel U+0640
      regexp_replace(p, '[' || chr(1611) || '-' || chr(1631) || chr(1648) || chr(1750) || '-' || chr(1773) || chr(1600) || ']', '', 'g'),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        || chr(1570) || chr(1571) || chr(1573) || chr(1649) || chr(1650) || chr(1651)   -- alefs  -> U+0627
        || chr(1609) || chr(1740) || chr(1746)                                          -- yaa forms -> U+064A
        || chr(1577)                                                                    -- taa marbuta -> U+0647
        || chr(1572) || chr(1574)                                                       -- seated hamza -> U+0621
        || chr(1705) || chr(1706)                                                       -- keh -> U+0643
        || chr(1632) || chr(1633) || chr(1634) || chr(1635) || chr(1636) || chr(1637) || chr(1638) || chr(1639) || chr(1640) || chr(1641)
        || chr(1776) || chr(1777) || chr(1778) || chr(1779) || chr(1780) || chr(1781) || chr(1782) || chr(1783) || chr(1784) || chr(1785),
      'abcdefghijklmnopqrstuvwxyz'
        || repeat(chr(1575), 6) || repeat(chr(1610), 3) || chr(1607) || repeat(chr(1569), 2) || repeat(chr(1603), 2)
        || '0123456789' || '0123456789'),
    '\s+', ' ', 'g'), '^ | $', '', 'g');
$$;

-- Who may approve, sign off or withdraw Tajweed: an active member or the
-- manager of an organization's Teachers department (PD-8/PD-12) -- the
-- academy's teaching staff. A proposal for the owner (PR #176).
create or replace function chat.can_review_tajweed(p_staff uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from chat.staff s
     where s.id = p_staff and s.is_active and s.left_at is null
       and (exists (select 1 from chat.department d where d.organization_id = s.organization_id and d.kind = 'teachers' and d.manager_id = s.id)
            or exists (select 1 from chat.department_member m join chat.department d on d.id = m.department_id
                        where d.organization_id = s.organization_id and d.kind = 'teachers' and m.staff_id = s.id)));
$$;

-- --- The text -----------------------------------------------------------------

create table chat.quran_dataset (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9.-]{2,63}$'),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  ayahs_digest  text not null check (ayahs_digest ~ '^[0-9a-f]{64}$'),
  attribution   text not null check (length(attribution) between 1 and 200),
  source_url    text not null check (source_url ~ '^https://'),
  loaded_at     timestamptz not null default now()
);

comment on table chat.quran_dataset is
  'PD-29 materials quality: one pinned Quran source file. sha256 = the file; ayahs_digest = SHA-256 of the per-ayah SHA-256s of the VERBATIM lines, joined by newline in canonical order. The API serves a dataset only when both equal the values pinned in code.';

create table chat.quran_ayah (
  dataset_id    text not null references chat.quran_dataset (id),
  surah         smallint not null references chat.quran_surah (number),
  ayah          smallint not null check (ayah >= 1),
  text_uthmani  text not null check (length(text_uthmani) > 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  basmala       text,
  verse         text not null check (length(verse) > 0),
  verse_sha256  text not null check (verse_sha256 ~ '^[0-9a-f]{64}$'),
  text_search   text not null,
  primary key (dataset_id, surah, ayah)
);

comment on table chat.quran_ayah is
  'PD-29 materials quality: text_uthmani is VERBATIM from the file (sha256 its hash). basmala is the accepted Basmala prefix of ayah 1 (every surah but 1 and 9), else null; verse is the ayah without it (verse_sha256 its hash): Tajweed offsets, audio and range references are against verse. text_search = chat.quran_fold(verse), for search only, never shown.';

-- One guard function per table (a shared one cannot read NEW fields the other
-- table lacks, even behind a TG_TABLE_NAME branch).
create or replace function chat.guard_quran_dataset()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'the Quran text is loaded once and never changed or removed' using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('chat.loading_quran', true), '') <> 'on' then
    raise exception 'the Quran text is loaded only by chat.load_quran_dataset' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function chat.guard_quran_ayah()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'the Quran text is loaded once and never changed or removed' using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('chat.loading_quran', true), '') <> 'on' then
    raise exception 'the Quran text is loaded only by chat.load_quran_dataset' using errcode = 'insufficient_privilege';
  end if;
  if new.ayah > (select s.ayah_count from chat.quran_surah s where s.number = new.surah) then
    raise exception 'surah % has no ayah %', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  if new.sha256 <> chat.sha256_hex(new.text_uthmani) or new.verse_sha256 <> chat.sha256_hex(new.verse) then
    raise exception 'ayah %:% does not match its hash', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  if new.text_uthmani <> coalesce(new.basmala || ' ', '') || new.verse then
    raise exception 'ayah %:% is not its Basmala and verse', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  if (new.ayah = 1 and new.surah not in (1, 9)) <> (new.basmala is not null)
     or (new.basmala is not null and not chat.sha256_hex(new.basmala) = any (chat.quran_basmala_sha256())) then
    raise exception 'ayah %:% does not carry the Basmala the rule requires', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  if new.text_search <> chat.quran_fold(new.verse) then
    raise exception 'ayah %:% text_search is not derived from its verse', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger quran_dataset_is_append_only before insert or update or delete on chat.quran_dataset
  for each row execute function chat.guard_quran_dataset();
create trigger quran_ayah_is_append_only before insert or update or delete on chat.quran_ayah
  for each row execute function chat.guard_quran_ayah();
create trigger quran_dataset_no_truncate before truncate on chat.quran_dataset
  for each statement execute function chat.guard_quran_dataset();
create trigger quran_ayah_no_truncate before truncate on chat.quran_ayah
  for each statement execute function chat.guard_quran_dataset();

-- The loader (scripts/db/load-quran.py, run from the repo checkout after the
-- migrations) has already checked the FILE against its pinned SHA-256 and done
-- every check below once. It stages the VERBATIM rows in a temp table
-- `quran_load (surah, ayah, text_uthmani)` and calls this, which checks again
-- what the database can see -- counts, numbering, the Basmala split, the digest
-- -- derives everything else itself, and writes all of it or nothing.
create or replace function chat.load_quran_dataset(
  p_id text, p_sha256 text, p_ayahs_digest text, p_attribution text, p_source_url text
)
returns text
language plpgsql
as $$
declare
  v_existing chat.quran_dataset%rowtype;
  v_total integer;
  v_bad text;
  v_digest text;
begin
  select * into v_existing from chat.quran_dataset where id = p_id;
  if found then
    if v_existing.sha256 = p_sha256 and v_existing.ayahs_digest = p_ayahs_digest then
      return 'already loaded';
    end if;
    raise exception 'dataset % is already loaded with a different fingerprint', p_id using errcode = 'check_violation';
  end if;

  select count(*) into v_total from pg_temp.quran_load;
  if v_total <> (select sum(ayah_count) from chat.quran_surah) then
    raise exception 'the dataset has % ayat, expected %', v_total, (select sum(ayah_count) from chat.quran_surah)
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from pg_temp.quran_load l where not exists (select 1 from chat.quran_surah s where s.number = l.surah)) then
    raise exception 'the dataset names a surah outside 1..114' using errcode = 'check_violation';
  end if;
  select string_agg(format('%s (%s of %s)', x.number, x.n, x.ayah_count), ', ' order by x.number) into v_bad
    from (select s.number, s.ayah_count, count(l.ayah) as n, count(distinct l.ayah) as d, min(l.ayah) as lo, max(l.ayah) as hi
            from chat.quran_surah s left join pg_temp.quran_load l on l.surah = s.number
           group by s.number, s.ayah_count) x
   where x.n <> x.ayah_count or x.d <> x.ayah_count or x.lo <> 1 or x.hi <> x.ayah_count;
  if v_bad is not null then
    raise exception 'surahs whose ayat do not match chat.quran_surah: %', v_bad using errcode = 'check_violation';
  end if;
  if exists (select 1 from pg_temp.quran_load where length(coalesce(text_uthmani, '')) = 0) then
    raise exception 'the dataset has an empty ayah' using errcode = 'check_violation';
  end if;

  select encode(sha256(convert_to(string_agg(chat.sha256_hex(text_uthmani), E'\n' order by surah, ayah), 'UTF8')), 'hex')
    into v_digest from pg_temp.quran_load;
  if v_digest <> p_ayahs_digest then
    raise exception 'the dataset''s digest % is not the expected %', v_digest, p_ayahs_digest using errcode = 'check_violation';
  end if;

  -- The Basmala: ayah 1 of every surah but 1 and 9 is "<four words> <verse>",
  -- the four words an accepted Basmala; 9:1 must not start with one.
  create temp table quran_split on commit drop as
    select l.surah, l.ayah, l.text_uthmani,
           regexp_match(l.text_uthmani, '^([^ ]+ [^ ]+ [^ ]+ [^ ]+) ([^ ].*)$') as m
      from pg_temp.quran_load l;
  select string_agg(format('%s:%s', surah, ayah), ', ' order by surah) into v_bad
    from pg_temp.quran_split
   where (ayah = 1 and surah not in (1, 9) and (m is null or not chat.sha256_hex(m[1]) = any (chat.quran_basmala_sha256())))
      or (ayah = 1 and surah = 9 and m is not null and chat.sha256_hex(m[1]) = any (chat.quran_basmala_sha256()));
  if v_bad is not null then
    raise exception 'ayat whose Basmala is not an accepted one (or 9:1 with one): %', v_bad using errcode = 'check_violation';
  end if;

  perform set_config('chat.loading_quran', 'on', true);
  insert into chat.quran_dataset (id, sha256, ayahs_digest, attribution, source_url)
    values (p_id, p_sha256, p_ayahs_digest, p_attribution, p_source_url);
  insert into chat.quran_ayah (dataset_id, surah, ayah, text_uthmani, sha256, basmala, verse, verse_sha256, text_search)
    select p_id, x.surah, x.ayah, x.text_uthmani, chat.sha256_hex(x.text_uthmani), x.basmala, x.verse, chat.sha256_hex(x.verse), chat.quran_fold(x.verse)
      from (select surah, ayah, text_uthmani,
                   case when ayah = 1 and surah not in (1, 9) then m[1] end as basmala,
                   case when ayah = 1 and surah not in (1, 9) then m[2] else text_uthmani end as verse
              from pg_temp.quran_split) x;
  perform set_config('chat.loading_quran', 'off', true);
  drop table pg_temp.quran_split;
  return 'loaded';
end;
$$;

-- --- Audio: one file per ayah ------------------------------------------------

create table chat.quran_ayah_audio (
  reciter_code  text not null check (reciter_code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  surah         smallint not null references chat.quran_surah (number),
  ayah          smallint not null check (ayah >= 1),
  -- The same formula as apps/api/src/quran/audio-key.ts: derived, never typed.
  object_key    text generated always as (
                  'quran/audio/' || reciter_code || '/' || lpad(surah::text, 3, '0') || lpad(ayah::text, 3, '0') || '.mp3'
                ) stored,
  -- Computed by the server from the stored object at ingest, never supplied by a person.
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size     integer not null check (byte_size between 1 and 50000000),
  duration_ms   integer check (duration_ms is null or duration_ms between 1 and 3600000),
  added_at      timestamptz not null default now(),
  primary key (reciter_code, surah, ayah)
);

comment on table chat.quran_ayah_audio is
  'PD-29 materials quality: one recitation file per ayah (of its verse, without the Basmala); object_key is generated from (reciter, surah, ayah); sha256 is computed by the server''s ingest from the stored object. Empty until the owner confirms the reciter and self-hosting. Append-only.';

create or replace function chat.guard_quran_ayah_audio()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'an ayah''s audio is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('chat.ingesting_quran_audio', true), '') <> 'on' then
    raise exception 'an ayah''s audio is written only by the server''s ingest' using errcode = 'insufficient_privilege';
  end if;
  if new.ayah > (select s.ayah_count from chat.quran_surah s where s.number = new.surah) then
    raise exception 'surah % has no ayah %', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  new.added_at := now();
  return new;
end;
$$;

create trigger quran_ayah_audio_is_append_only before insert or update or delete on chat.quran_ayah_audio
  for each row execute function chat.guard_quran_ayah_audio();
create trigger quran_ayah_audio_no_truncate before truncate on chat.quran_ayah_audio
  for each statement execute function chat.guard_quran_ayah_audio();

-- --- Tajweed ------------------------------------------------------------------

create table chat.quran_tajweed_mark (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      text not null,
  surah           smallint not null,
  ayah            smallint not null,
  -- Unicode CODE POINT offsets into the ayah's VERSE (no Basmala), end exclusive.
  start_cp        integer not null check (start_cp >= 0),
  end_cp          integer not null,
  rule            text not null check (rule in (
                    'izhar', 'idgham_ghunnah', 'idgham_no_ghunnah', 'iqlab', 'ikhfa',
                    'izhar_shafawi', 'idgham_shafawi', 'ikhfa_shafawi', 'ghunnah', 'qalqalah',
                    'madd_tabii', 'madd_muttasil', 'madd_munfasil', 'madd_lazim', 'madd_arid',
                    'madd_lin', 'madd_badal', 'madd_iwad', 'madd_silah',
                    'lam_shamsiyyah', 'lam_qamariyyah', 'hamzat_wasl', 'silent', 'tafkhim', 'tarqiq')),
  source          text not null check (length(source) between 1 and 80),
  source_version  text not null check (length(source_version) between 1 and 80),
  state           text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  reviewed_by     uuid references chat.staff (id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint quran_tajweed_mark_range check (end_cp > start_cp),
  constraint quran_tajweed_mark_reviewed check ((state = 'pending') = (reviewed_by is null and reviewed_at is null)),
  foreign key (dataset_id, surah, ayah) references chat.quran_ayah (dataset_id, surah, ayah)
);

create index quran_tajweed_mark_ayah_idx on chat.quran_tajweed_mark (dataset_id, surah, ayah);

comment on table chat.quran_tajweed_mark is
  'PD-29 materials quality: one Tajweed rule over a code-point range of one VERSE (no Basmala), from a published annotation. pending -> approved | rejected once, by a Tajweed reviewer (chat.can_review_tajweed). Served only when named by the latest sign-off of its surah and not withdrawn.';

create or replace function chat.guard_quran_tajweed_mark()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a Tajweed mark is a record; reject or withdraw it instead of removing it' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'a Tajweed mark starts pending: only a reviewer approves it' using errcode = 'check_violation';
    end if;
    if new.end_cp > (select char_length(a.verse) from chat.quran_ayah a
                      where a.dataset_id = new.dataset_id and a.surah = new.surah and a.ayah = new.ayah) then
      raise exception 'the mark runs past the end of verse %:%', new.surah, new.ayah using errcode = 'check_violation';
    end if;
    new.created_at := now();
    return new;
  end if;
  -- UPDATE: one review, once: pending -> approved | rejected, by a reviewer; nothing else moves.
  if old.state <> 'pending' or new.state not in ('approved', 'rejected') or new.reviewed_by is null
     or (new.dataset_id, new.surah, new.ayah, new.start_cp, new.end_cp, new.rule, new.source, new.source_version, new.created_at)
        is distinct from (old.dataset_id, old.surah, old.ayah, old.start_cp, old.end_cp, old.rule, old.source, old.source_version, old.created_at) then
    raise exception 'a Tajweed mark is reviewed once (pending -> approved or rejected) and otherwise never changed'
      using errcode = 'check_violation';
  end if;
  if not chat.can_review_tajweed(new.reviewed_by) then
    raise exception 'only a Tajweed reviewer (the Teachers department) reviews a mark' using errcode = 'insufficient_privilege';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

create trigger quran_tajweed_mark_is_reviewed_once before insert or update or delete on chat.quran_tajweed_mark
  for each row execute function chat.guard_quran_tajweed_mark();
-- No TRUNCATE guard on the three Tajweed tables: they reference chat.staff, and
-- the integration harness truncates chat.staff ... CASCADE before every suite,
-- which reaches them. Row-level DELETE/UPDATE stay refused; TRUNCATE needs the
-- owner role, which the grants already keep from every request role.

create table chat.quran_tajweed_review (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      text not null references chat.quran_dataset (id),
  surah           smallint not null references chat.quran_surah (number),
  source          text not null check (length(source) between 1 and 80),
  source_version  text not null check (length(source_version) between 1 and 80),
  -- The EXACT marks this sign-off approved, and their digest (chat.quran_tajweed_marks_digest).
  mark_ids        uuid[] not null check (cardinality(mark_ids) between 1 and 20000),
  marks_digest    text not null check (marks_digest ~ '^[0-9a-f]{64}$'),
  reviewed_by     uuid not null references chat.staff (id),
  reviewed_at     timestamptz not null default now(),
  notes           text check (notes is null or length(notes) <= 2000)
);

create index quran_tajweed_review_surah_idx on chat.quran_tajweed_review (dataset_id, surah, source, source_version, reviewed_at desc);

comment on table chat.quran_tajweed_review is
  'PD-29 materials quality: a Tajweed reviewer signed off one surah for one source version, naming the exact approved marks (mark_ids) and their digest. Only the latest sign-off of a surah and source version counts; a mark it does not name is not served. Append-only.';

-- One line per mark, `ayah|start|end|rule`, sorted (rule in C order), joined by
-- newline, SHA-256 hex: the same as marksDigest() in apps/api/src/quran/tajweed.ts.
create or replace function chat.quran_tajweed_marks_digest(p_ids uuid[])
returns text
language sql
stable
as $$
  select chat.sha256_hex(coalesce(string_agg(format('%s|%s|%s|%s', m.ayah, m.start_cp, m.end_cp, m.rule), E'\n'
                                             order by m.ayah, m.start_cp, m.end_cp, m.rule collate "C"), ''))
    from chat.quran_tajweed_mark m where m.id = any (p_ids);
$$;

create or replace function chat.guard_quran_tajweed_review()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a sign-off is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if not chat.can_review_tajweed(new.reviewed_by) then
    raise exception 'only a Tajweed reviewer (the Teachers department) signs off a surah' using errcode = 'insufficient_privilege';
  end if;
  if cardinality(new.mark_ids) <> (select count(distinct x) from unnest(new.mark_ids) x)
     or cardinality(new.mark_ids) <> (
       select count(*) from chat.quran_tajweed_mark m
        where m.id = any (new.mark_ids) and m.dataset_id = new.dataset_id and m.surah = new.surah
          and m.source = new.source and m.source_version = new.source_version and m.state = 'approved'
          and not exists (select 1 from chat.quran_tajweed_withdrawal w where w.mark_id = m.id)) then
    raise exception 'a sign-off names only approved, unwithdrawn marks of its own surah, source and version, each once'
      using errcode = 'check_violation';
  end if;
  if new.marks_digest <> chat.quran_tajweed_marks_digest(new.mark_ids) then
    raise exception 'the sign-off''s digest is not the digest of the marks it names' using errcode = 'check_violation';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

create table chat.quran_tajweed_withdrawal (
  id            uuid primary key default gen_random_uuid(),
  mark_id       uuid not null unique references chat.quran_tajweed_mark (id),
  withdrawn_by  uuid not null references chat.staff (id),
  reason        text not null check (length(reason) between 1 and 500),
  withdrawn_at  timestamptz not null default now()
);

comment on table chat.quran_tajweed_withdrawal is
  'PD-29 materials quality: an approved Tajweed mark pulled from service, by a Tajweed reviewer, with a reason. The mark and its history stay. Append-only.';

create or replace function chat.guard_quran_tajweed_withdrawal()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a withdrawal is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if not chat.can_review_tajweed(new.withdrawn_by) then
    raise exception 'only a Tajweed reviewer (the Teachers department) withdraws a mark' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from chat.quran_tajweed_mark m where m.id = new.mark_id and m.state = 'approved') then
    raise exception 'only an approved mark is withdrawn' using errcode = 'check_violation';
  end if;
  new.withdrawn_at := now();
  return new;
end;
$$;

create trigger quran_tajweed_review_is_append_only before insert or update or delete on chat.quran_tajweed_review
  for each row execute function chat.guard_quran_tajweed_review();
create trigger quran_tajweed_withdrawal_is_append_only before insert or update or delete on chat.quran_tajweed_withdrawal
  for each row execute function chat.guard_quran_tajweed_withdrawal();

-- --- Access: read only through the API's service -------------------------------

alter table chat.quran_dataset enable row level security;
alter table chat.quran_ayah enable row level security;
alter table chat.quran_ayah_audio enable row level security;
alter table chat.quran_tajweed_mark enable row level security;
alter table chat.quran_tajweed_review enable row level security;
alter table chat.quran_tajweed_withdrawal enable row level security;
revoke all on chat.quran_dataset, chat.quran_ayah, chat.quran_ayah_audio,
              chat.quran_tajweed_mark, chat.quran_tajweed_review, chat.quran_tajweed_withdrawal
  from public, anon, authenticated, chat_app;
revoke all on function chat.quran_basmala_sha256() from public;
revoke all on function chat.sha256_hex(text) from public;
revoke all on function chat.quran_fold(text) from public;
revoke all on function chat.can_review_tajweed(uuid) from public;
revoke all on function chat.guard_quran_dataset() from public;
revoke all on function chat.guard_quran_ayah() from public;
revoke all on function chat.load_quran_dataset(text, text, text, text, text) from public;
revoke all on function chat.guard_quran_ayah_audio() from public;
revoke all on function chat.guard_quran_tajweed_mark() from public;
revoke all on function chat.quran_tajweed_marks_digest(uuid[]) from public;
revoke all on function chat.guard_quran_tajweed_review() from public;
revoke all on function chat.guard_quran_tajweed_withdrawal() from public;

-- The dataset to serve. The deploy job loads it right after the migrations
-- (scripts/db/load-quran.sh); until then, and whenever it does not verify
-- against the fingerprints pinned in code, every Quran route answers 503.
-- quran.audio is deliberately NOT seeded: no audio until the owner confirms the
-- reciter and the right to self-host.
insert into chat.config (key, value, scope, description) values
('quran.dataset', '"tanzil-uthmani-1.1"'::jsonb, 'quran',
 'PD-29 materials quality: the Quran dataset the API serves (chat.quran_dataset id), verified against apps/api/src/quran/pinned.ts. Changing it is a reviewed change, together with its pins.')
on conflict (key) do nothing;

-- GET /quran/ayahs and /quran/tajweed answer up to 50 ayat a question; bound
-- how often one actor may ask (docs/security/ABUSE-LIMITS.md).
insert into chat.config (key, value, scope, description) values
('abuse.throttle.quran_read_actor', '120'::jsonb, 'abuse',
 '[hypothesis] PD-29 materials quality: Quran text reads (GET /quran/ayahs, /quran/tajweed) one actor may make per window. A lesson or the whiteboard reads a surah in one or two questions.')
on conflict (key) do nothing;
