-- Profile photos for a parent and for their children.
--
-- Two nullable columns and nothing else. Both hold an OBJECT KEY into the same private
-- bucket stories already use -- never a URL, and never a capability: a read is a
-- short-lived signed URL minted per request, so possessing the key grants nothing.
--
-- WHY A COLUMN AND NOT A MEDIA TABLE
--
-- A person has at most one current photo and no history requirement, so a join table would
-- add a lifecycle (which row is current?) to answer a question a single column answers.
-- `chat.story` already demonstrates the pattern this follows: key + purge stamp on the row.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD
--
-- No phone, no email, no address. `chat.contact` has never had a contact file and this does
-- not give it one: a profile that cannot render a phone number is one that cannot leak one
-- (see `lib/features/profile/domain/profile_view.dart`, and the privacy guard in
-- `test/design/directionality_guard_test.dart`). Adding a photo must not become the moment
-- that boundary quietly moves.
--
-- COMPATIBILITY: additive and nullable. Every existing row reads as "no photo", which is
-- what they are. No data is rewritten and nothing is backfilled.
--
-- ROLLBACK:
--   alter table chat.contact drop column avatar_object_key;
--   alter table chat.learner drop column avatar_object_key;

alter table chat.contact add column if not exists avatar_object_key text;
alter table chat.learner add column if not exists avatar_object_key text;

comment on column chat.contact.avatar_object_key is
  'Private object-storage key for this contact''s profile photo. Read through a signed URL only; never served as a public URL.';
comment on column chat.learner.avatar_object_key is
  'Private object-storage key for this learner''s photo, managed by an authorized contact in the same family.';
