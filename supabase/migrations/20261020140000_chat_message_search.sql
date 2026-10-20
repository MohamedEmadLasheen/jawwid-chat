-- =============================================================================
-- Message search (Chat UI group B, owner decision 2026-10-20: search inside a
-- chat AND across all of one's chats)
-- =============================================================================
--
-- Search never decides WHO may see a message. The API first narrows to the
-- conversations the caller may read, matches text here, and then filters every
-- candidate through the same per-message visibility rule the message list uses
-- (internal notes, held/rejected messages, "deleted for me").
--
-- chat.search_fold is the one definition of "the same text" for search:
--   * case-insensitive (lower)
--   * Arabic diacritics (harakat U+064B-U+065F, superscript alef U+0670) and
--     tatweel (U+0640) are ignored, so a vowelled word matches an unvowelled one
--   * hamza/madda alef forms (U+0623 U+0625 U+0622 U+0671) read as bare alef
--     (U+0627), alef maqsura (U+0649) as yeh (U+064A), teh marbuta (U+0629) as
--     heh (U+0647) -- the spelling variants people type interchangeably
-- Characters are built with chr() so this file carries no invisible marks.

create extension if not exists pg_trgm;

create or replace function chat.search_fold(t text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select translate(
    regexp_replace(
      lower(t),
      '[' || chr(1611) || '-' || chr(1631) || chr(1648) || chr(1600) || ']',
      '',
      'g'
    ),
    chr(1571) || chr(1573) || chr(1570) || chr(1649) || chr(1609) || chr(1577),
    chr(1575) || chr(1575) || chr(1575) || chr(1575) || chr(1610) || chr(1607)
  )
$$;

comment on function chat.search_fold(text) is
  'Search normal form: lower case, Arabic diacritics and tatweel removed, alef/yeh/heh spelling variants unified. Used by message search; the API applies visibility afterwards.';

-- Substring match on the folded body: a trigram index serves LIKE '%q%' for
-- queries of three or more characters. Deleted and body-less rows are never
-- searched, so they are not indexed either.
create index if not exists message_search_fold_trgm
  on chat.message using gin (chat.search_fold(body) gin_trgm_ops)
  where deleted_for_all = false and body is not null;

grant execute on function chat.search_fold(text) to service_role;
