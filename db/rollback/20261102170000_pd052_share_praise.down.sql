-- Roll back 20261102170000_chat_pd052_share_praise (PD-52 PR-8, share praise with the teacher).
--
-- The kind can go only when no card uses it: cards already posted are
-- messages in the teacher's chat and are never deleted, so the rollback
-- stops (FK message_card_kind_known) rather than erase them. Roll back the
-- API release with it: TeacherRecordsService.sharePraise posts this kind.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102170000_pd052_share_praise.down.sql

delete from chat.message_card_kind where kind = 'teacher_praise_shared';
