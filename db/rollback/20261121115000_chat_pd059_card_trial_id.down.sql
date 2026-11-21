-- Roll back 20261121115000_chat_pd059_card_trial_id (PD-59 / F7).
--
-- Drops the derived chat.message_card.trial_id column. Roll back the API with it: the message read path
-- filters trial cards through it. No data is lost (the column is derived from payload.trialId).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121115000_chat_pd059_card_trial_id.down.sql
--
-- Then delete the ledger row: delete from chat.schema_migrations where version =
-- '20261121115000_chat_pd059_card_trial_id';

alter table chat.message_card drop column if exists trial_id;
