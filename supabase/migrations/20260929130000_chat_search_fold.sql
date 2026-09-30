-- Text folding for search, in the database.
--
-- WHY
-- ---
-- Conversation search moved from the client to the server, because filtering a
-- page the client happens to hold is not search and fixing it client-side would
-- have made client code the thing separating one family from another's
-- conversations.
--
-- But the client's matcher was not a naive `toLowerCase().contains()` -- see
-- `lib/shared/utils/search_text.dart`. It folds Arabic, and it has to: this is
-- an Arabic-first product, a parent who types `احمد` must find `أحمد`, and a
-- name stored with tashkeel (`جَوِّد`) must be found by someone typing `جود`.
-- Moving the query to the server without bringing the folding with it would
-- have made search materially WORSE for the audience it exists for, while
-- looking like an improvement.
--
-- So the same folding is expressed here, and both sides of every comparison go
-- through it. `search_text.dart` remains the specification; this is its SQL
-- twin, and `parent-identity-contract.spec.ts` asserts the pairs that matter.
--
-- IMMUTABLE and STRICT, so it can be indexed later. It is deliberately NOT
-- indexed now: the corpus is one academy's conversations, a sequential scan
-- over a few thousand rows is cheaper than an index nobody has measured, and a
-- functional index is a tuning decision to take with real numbers.
--
-- BACKWARD COMPATIBLE: a new function, used by one new query path. Nothing
-- existing reads it.

create or replace function chat.search_fold(input text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select btrim(
    regexp_replace(
      translate(
        translate(
          lower(input),
          -- DELETED: tashkeel (fatha..sukun), the maddah/hamza combining marks,
          -- superscript alef, and tatweel -- the decorative kashida stretch.
          -- `translate` drops any character in `from` with no counterpart in
          -- `to`, so a shorter `to` is how a deletion set is expressed.
          'ًٌٍَُِّْٰـ',
          ''
        ),
        -- FOLDED, in the same pairs the client folds:
        --   آأإٱ  -> ا    every hamza-bearing alef, and the bare one
        --   ىیۓ   -> ي    alef maqsura and the farsi/urdu yeh
        --   ة     -> ه    taa marbuta; the dots get dropped constantly
        --   ؤئ    -> ء    seated hamza meets standalone hamza
        --   کڪ    -> ك    farsi/urdu keh standing in for arabic kaf
        --   ٠..٩  -> 0..9 so "٢٠٢٦" and "2026" are one search
        'آأإٱىیۓةؤئکڪ٠١٢٣٤٥٦٧٨٩',
        'اااايييهءءكك0123456789'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

comment on function chat.search_fold(text) is
  'Fold text for search: Arabic diacritics and tatweel removed, hamza/alef/yeh/'
  'taa-marbuta variants and Arabic-Indic digits unified, lowercased, whitespace '
  'collapsed. Mirrors lib/shared/utils/search_text.dart; apply to BOTH sides of '
  'a comparison.';

grant execute on function chat.search_fold(text) to chat_app, authenticated, service_role;
