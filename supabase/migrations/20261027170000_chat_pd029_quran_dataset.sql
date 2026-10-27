-- PD-29 amendment, materials quality P0-2: the ONE shared Quran dataset.
--
-- Record: docs/product/quran-dataset-contract.md (agreed with PD-39, which
-- consumes it) and docs/product/pd029-materials-quality-plan.md §C. The
-- owner's rule (2026-10-27): one centralized text for the lessons and the
-- whiteboard; checked against a fixed, trusted fingerprint every time it is
-- loaded; Tajweed shown only once verified and approved; no mismatch between
-- verses, audio and Tajweed.
--
--   chat.quran_dataset          one row per pinned source file (its SHA-256
--                               and the digest of its 6,236 ayah hashes)
--   chat.quran_ayah             the verbatim text, per (dataset, surah, ayah)
--   chat.quran_ayah_audio       one file per ayah; its key is GENERATED from
--                               (reciter, surah, ayah), so it can never name
--                               another ayah. Empty until the owner confirms
--                               the reciter and the right to self-host.
--   chat.quran_tajweed_review   a teacher's sign-off of one surah, per source
--                               version
--   chat.quran_tajweed_mark     one rule over a code-point range of one ayah:
--                               pending -> approved | rejected, nothing else.
--                               None are shipped.
--
-- Rows of the text only ever arrive through chat.load_quran_dataset, which
-- checks the counts against chat.quran_surah and the digest, in one
-- transaction. Everything is append-only; nothing is granted to request roles.

create table chat.quran_dataset (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9.-]{2,63}$'),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  ayahs_digest  text not null check (ayahs_digest ~ '^[0-9a-f]{64}$'),
  attribution   text not null check (length(attribution) between 1 and 200),
  source_url    text not null check (source_url ~ '^https://'),
  loaded_at     timestamptz not null default now()
);

comment on table chat.quran_dataset is
  'PD-29 materials quality: one pinned Quran source file. sha256 = the file; ayahs_digest = SHA-256 of the per-ayah SHA-256s joined by newline in canonical order. The API serves a dataset only when both equal the values pinned in code.';

create table chat.quran_ayah (
  dataset_id    text not null references chat.quran_dataset (id),
  surah         smallint not null references chat.quran_surah (number),
  ayah          smallint not null check (ayah >= 1),
  text_uthmani  text not null check (length(text_uthmani) > 0),
  text_search   text not null,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  primary key (dataset_id, surah, ayah)
);

comment on table chat.quran_ayah is
  'PD-29 materials quality: the Quran text, VERBATIM from the dataset''s file (never normalised); text_search is derived for search and never shown; sha256 = SHA-256 of text_uthmani in UTF-8.';

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
  if new.sha256 <> encode(sha256(convert_to(new.text_uthmani, 'UTF8')), 'hex') then
    raise exception 'ayah %:% does not match its hash', new.surah, new.ayah using errcode = 'check_violation';
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
-- migrations) has already checked the FILE against its pinned SHA-256. It
-- stages the parsed rows in a temp table `quran_load (surah, ayah,
-- text_uthmani, text_search)` and calls this, which checks again what the
-- database can see and writes all of it or nothing.
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

  select encode(sha256(convert_to(string_agg(encode(sha256(convert_to(text_uthmani, 'UTF8')), 'hex'), E'\n' order by surah, ayah), 'UTF8')), 'hex')
    into v_digest from pg_temp.quran_load;
  if v_digest <> p_ayahs_digest then
    raise exception 'the dataset''s digest % is not the expected %', v_digest, p_ayahs_digest using errcode = 'check_violation';
  end if;

  perform set_config('chat.loading_quran', 'on', true);
  insert into chat.quran_dataset (id, sha256, ayahs_digest, attribution, source_url)
    values (p_id, p_sha256, p_ayahs_digest, p_attribution, p_source_url);
  insert into chat.quran_ayah (dataset_id, surah, ayah, text_uthmani, text_search, sha256)
    select p_id, surah, ayah, text_uthmani, coalesce(text_search, ''), encode(sha256(convert_to(text_uthmani, 'UTF8')), 'hex')
      from pg_temp.quran_load;
  perform set_config('chat.loading_quran', 'off', true);
  return 'loaded';
end;
$$;

-- --- Audio: one file per ayah --------------------------------------------

create table chat.quran_ayah_audio (
  reciter_code  text not null check (reciter_code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  surah         smallint not null references chat.quran_surah (number),
  ayah          smallint not null check (ayah >= 1),
  -- The same formula as apps/api/src/quran/audio-key.ts: derived, never typed.
  object_key    text generated always as (
                  'quran/audio/' || reciter_code || '/' || lpad(surah::text, 3, '0') || lpad(ayah::text, 3, '0') || '.mp3'
                ) stored,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_ms   integer check (duration_ms is null or duration_ms between 1 and 3600000),
  added_at      timestamptz not null default now(),
  primary key (reciter_code, surah, ayah)
);

comment on table chat.quran_ayah_audio is
  'PD-29 materials quality: one recitation file per ayah; object_key is generated from (reciter, surah, ayah). Empty until the owner confirms the reciter and self-hosting. Append-only.';

create or replace function chat.guard_quran_ayah_audio()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'an ayah''s audio is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if new.ayah > (select s.ayah_count from chat.quran_surah s where s.number = new.surah) then
    raise exception 'surah % has no ayah %', new.surah, new.ayah using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger quran_ayah_audio_is_append_only before insert or update or delete on chat.quran_ayah_audio
  for each row execute function chat.guard_quran_ayah_audio();

-- --- Tajweed: approved marks of signed-off surahs only ---------------------

create table chat.quran_tajweed_review (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      text not null references chat.quran_dataset (id),
  surah           smallint not null references chat.quran_surah (number),
  source          text not null check (length(source) between 1 and 80),
  source_version  text not null check (length(source_version) between 1 and 80),
  reviewed_by     uuid not null,
  reviewed_at     timestamptz not null default now(),
  notes           text check (notes is null or length(notes) <= 2000),
  unique (dataset_id, surah, source, source_version)
);

comment on table chat.quran_tajweed_review is
  'PD-29 materials quality: an academy Quran teacher signed off the Tajweed of one surah, for one source version. A mark is served only with a matching sign-off. Append-only.';

create or replace function chat.guard_quran_tajweed_review()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a sign-off is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

create trigger quran_tajweed_review_is_append_only before insert or update or delete on chat.quran_tajweed_review
  for each row execute function chat.guard_quran_tajweed_review();

create table chat.quran_tajweed_mark (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      text not null,
  surah           smallint not null,
  ayah            smallint not null,
  -- Unicode CODE POINT offsets into text_uthmani, end exclusive.
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
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint quran_tajweed_mark_range check (end_cp > start_cp),
  constraint quran_tajweed_mark_reviewed check ((state = 'pending') = (reviewed_by is null and reviewed_at is null)),
  foreign key (dataset_id, surah, ayah) references chat.quran_ayah (dataset_id, surah, ayah)
);

create index quran_tajweed_mark_ayah_idx on chat.quran_tajweed_mark (dataset_id, surah, ayah);

comment on table chat.quran_tajweed_mark is
  'PD-29 materials quality: one Tajweed rule over a code-point range of one ayah, from a published annotation. pending -> approved | rejected by a teacher; served only when approved AND the surah has a sign-off for the same source version.';

create or replace function chat.guard_quran_tajweed_mark()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a Tajweed mark is a record; reject it instead of removing it' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'a Tajweed mark starts pending: only a teacher''s review approves it' using errcode = 'check_violation';
    end if;
    if new.end_cp > (select char_length(a.text_uthmani) from chat.quran_ayah a
                      where a.dataset_id = new.dataset_id and a.surah = new.surah and a.ayah = new.ayah) then
      raise exception 'the mark runs past the end of ayah %:%', new.surah, new.ayah using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- UPDATE: one review, once: pending -> approved | rejected, with who; nothing else moves.
  if old.state <> 'pending' or new.state not in ('approved', 'rejected') or new.reviewed_by is null
     or (new.dataset_id, new.surah, new.ayah, new.start_cp, new.end_cp, new.rule, new.source, new.source_version, new.created_at)
        is distinct from (old.dataset_id, old.surah, old.ayah, old.start_cp, old.end_cp, old.rule, old.source, old.source_version, old.created_at) then
    raise exception 'a Tajweed mark is reviewed once (pending -> approved or rejected) and otherwise never changed'
      using errcode = 'check_violation';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

create trigger quran_tajweed_mark_is_reviewed_once before insert or update or delete on chat.quran_tajweed_mark
  for each row execute function chat.guard_quran_tajweed_mark();

-- --- Access: read only through the API's service -------------------------

alter table chat.quran_dataset enable row level security;
alter table chat.quran_ayah enable row level security;
alter table chat.quran_ayah_audio enable row level security;
alter table chat.quran_tajweed_review enable row level security;
alter table chat.quran_tajweed_mark enable row level security;
revoke all on chat.quran_dataset, chat.quran_ayah, chat.quran_ayah_audio, chat.quran_tajweed_review, chat.quran_tajweed_mark
  from public, anon, authenticated, chat_app;
revoke all on function chat.guard_quran_dataset() from public;
revoke all on function chat.guard_quran_ayah() from public;
revoke all on function chat.load_quran_dataset(text, text, text, text, text) from public;
revoke all on function chat.guard_quran_ayah_audio() from public;
revoke all on function chat.guard_quran_tajweed_review() from public;
revoke all on function chat.guard_quran_tajweed_mark() from public;

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
