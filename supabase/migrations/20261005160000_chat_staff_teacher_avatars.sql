-- Profile photos for the other two principal kinds: staff and teachers.
--
-- `chat.contact` and `chat.learner` got theirs in 20261005140000. This completes the set,
-- so every actor who can appear as a NAME in a conversation can also appear as a FACE.
-- Same shape, same bucket, same rule: an object KEY, never a URL, never a capability --
-- a read is a short-lived signed URL minted per request, so holding the key grants nothing.
--
-- WHY THIS IS NEEDED
--
-- Group chat shows the sender's name but not their picture. The two senders a parent
-- actually sees in a student group are the teacher and the admin, and neither table could
-- hold a photo -- so adding avatars to the message contract alone would have changed
-- nothing on screen. This is the missing half.
--
-- OWNERSHIP: `chat.teacher` IS A PROJECTION, THIS COLUMN IS NOT
--
-- `chat.teacher` carries `core_teacher_id` and `synced_at`: the row stands in for a teacher
-- that Jawwid Core owns. `avatar_object_key` is NOT part of that projection. It is
-- CHAT-OWNED PROFILE STATE, set by the teacher themselves through this application, and
-- Core neither knows nor supplies it.
--
-- At the time of writing no code in this repository writes `chat.teacher` at all -- every
-- reference is a read (`findUnique`/`findFirst`/`findMany`), the only insert is the seed in
-- 20260910120000, and the rest are test fixtures. So nothing can clobber this column today.
--
-- WHEN CORE INGESTION IS EVENTUALLY BUILT, it MUST enumerate the academic columns it owns
-- (`name`, `core_teacher_id`, `synced_at`, `is_active`, ...) and MUST NOT write
-- `avatar_object_key`. A blanket upsert that spreads a Core payload over the row would
-- silently delete every teacher's photo on the next sync. The invariant is:
--
--     Core-owned projection data  +  Chat-owned avatar_object_key
--       = one chat.teacher row, two owners, no collision
--
-- `apps/api/test/integration/staff-teacher-avatars.spec.ts` guards this.
--
-- `chat.staff` is not a projection -- it is Chat's own -- so it carries no such caveat.
--
-- COMPATIBILITY: additive and nullable. Every existing row reads as "no photo", which is
-- what they are. Nothing is backfilled, no existing data is rewritten, no index and no
-- constraint is added (the column is never queried by value, only read by row id).
--
-- JAWWID CORE IS NOT TOUCHED. Core is a separate system and not in this repository.
--
-- ROLLBACK:
--   alter table chat.teacher drop column avatar_object_key;
--   alter table chat.staff   drop column avatar_object_key;

alter table chat.teacher add column if not exists avatar_object_key text;
alter table chat.staff   add column if not exists avatar_object_key text;

comment on column chat.teacher.avatar_object_key is
  'Private object-storage key for this teacher''s profile photo. CHAT-OWNED state, set by the teacher themselves -- NOT part of the Jawwid Core projection and must never be written by Core synchronisation. Read through a signed URL only.';
comment on column chat.staff.avatar_object_key is
  'Private object-storage key for this staff member''s profile photo, set by that staff member. Read through a signed URL only; never served as a public URL.';
