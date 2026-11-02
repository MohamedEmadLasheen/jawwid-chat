-- PD-46 PR-2c (CHATSCHED-007): "Add lesson" honours an Idempotency-Key.
--
-- A client that timed out and retries the same POST /lessons was told 409
-- "the teacher already has a lesson" although its first request had succeeded.
-- The key the request carried is kept on the lesson it created, unique per
-- creator, so a retry finds that lesson and answers it (LessonService.schedule
-- serializes requests of one key with an advisory lock before looking).

set local lock_timeout = '5s';

alter table chat.lesson
  add column if not exists create_key text
    constraint lesson_create_key_shape check (create_key is null or char_length(create_key) between 1 and 200);

comment on column chat.lesson.create_key is
  'PD-46 (CHATSCHED-007): the Idempotency-Key of the POST /lessons that created this lesson, unique per created_by. Null for every other way a lesson is made.';

create unique index if not exists lesson_create_key_once
  on chat.lesson (created_by, create_key)
  where create_key is not null;
