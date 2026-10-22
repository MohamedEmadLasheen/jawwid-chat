-- Roll back 20261022163000_chat_pd022_clock_shift_warning (PD-22 daylight-saving warning).
--
-- Safe with rows present: warnings still scheduled are cancelled (their rule and
-- template go), warnings already sent stay as history with rule_key set to null.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261022163000_pd022_clock_shift.down.sql

update chat.notification set status = 'cancelled'
 where event_type = 'lesson_clock_shift' and status = 'scheduled';

delete from chat.notification_rule where key = 'lesson_clock_shift_parent';
delete from chat.notification_template where key = 'lesson_clock_shift';

delete from chat.schema_migrations where version = '20261022163000_chat_pd022_clock_shift_warning';
