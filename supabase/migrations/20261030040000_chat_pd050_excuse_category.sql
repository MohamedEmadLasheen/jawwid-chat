-- =============================================================================
-- PD-50 · an excuse's reason category
--
-- The owner's decision of 2026-10-29: "Parents see a category." Whoever records
-- an excuse (the family, the supervisor, the teacher) picks one of a fixed list;
-- the family reads it on the card. The free-text reason stays where PD-15 put it
-- (chat.lesson.outcome_note, chat.lesson_ruling.reason): staff and the lesson's
-- teacher only.
--
--   chat.lesson.excuse_category          the excused lesson's category, written
--                                        with its outcome (never on its own).
--   chat.lesson_ruling.excuse_category   a family's late apology's category,
--                                        written when the ruling is opened; an
--                                        excusing decision copies it to the lesson.
--
-- Both are nullable: an excuse recorded before PD-50, or by a client that
-- predates it, has none. The list is apps/api/src/communication/contracts/vocab.ts
-- EXCUSE_CATEGORIES.
-- =============================================================================

alter table chat.lesson
  add column excuse_category text
    check (excuse_category in ('travel', 'illness', 'exams', 'emergency', 'other'));

comment on column chat.lesson.excuse_category is
  'PD-50: the excuse''s reason category, shown to the family. Written only together with the lesson''s outcome.';

alter table chat.lesson_ruling
  add column excuse_category text
    check (excuse_category in ('travel', 'illness', 'exams', 'emergency', 'other'));

comment on column chat.lesson_ruling.excuse_category is
  'PD-50: a late apology''s reason category, written when the ruling is opened; never changed.';

-- chat.guard_lesson writes an outcome once and lists the columns that go with
-- it. The category is one of them: it changes only in the update that changes
-- the outcome (an excuse, an excusing ruling, a recorded correction).
create function chat.guard_lesson_excuse_category()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.excuse_category is distinct from old.excuse_category
     and new.outcome is not distinct from old.outcome then
    raise exception 'an excuse''s category is written with its outcome' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger lesson_excuse_category_with_outcome
  before update of excuse_category on chat.lesson
  for each row execute function chat.guard_lesson_excuse_category();

-- chat.guard_lesson_ruling lets only the decision change; the category is
-- written when the ruling is opened, like its reason.
create function chat.guard_lesson_ruling_excuse_category()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if new.excuse_category is distinct from old.excuse_category then
    raise exception 'a ruling''s category is written when it is opened' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger lesson_ruling_excuse_category_is_kept
  before update of excuse_category on chat.lesson_ruling
  for each row execute function chat.guard_lesson_ruling_excuse_category();

revoke all on function chat.guard_lesson_excuse_category() from public;
revoke all on function chat.guard_lesson_ruling_excuse_category() from public;
