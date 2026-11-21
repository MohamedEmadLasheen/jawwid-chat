-- Roll back 20261121100000_chat_pd059_sales_pipeline (PD-59, the Sales pipeline).
--
-- Drops the confined lead contact table (the contact details Sales stored for leads that are not
-- yet converted are LOST: export them first if they are needed) and the pipeline columns on
-- chat.trial_prospect. Roll back the API with it: the Sales pipeline endpoints read these.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261121100000_chat_pd059_sales_pipeline.down.sql
--
-- Then delete the ledger row: delete from chat.schema_migrations where version =
-- '20261121100000_chat_pd059_sales_pipeline';

drop trigger if exists sales_lead_contact_is_coherent on chat.sales_lead_contact;
-- The guard refuses a delete of an unconverted lead's contact; this table is being removed whole.
drop table if exists chat.sales_lead_contact;
drop function if exists chat.guard_sales_lead_contact();

drop index if exists chat.trial_prospect_follow_up_idx;
alter table chat.trial_prospect
  drop constraint if exists trial_prospect_conversion_coherent,
  drop constraint if exists trial_prospect_follow_up_note_length,
  drop constraint if exists trial_prospect_lost_reason_coherent,
  drop constraint if exists trial_prospect_pipeline_stage_known,
  drop column if exists converted_family_id,
  drop column if exists converted_at,
  drop column if exists follow_up_note,
  drop column if exists next_follow_up_on,
  drop column if exists last_contacted_at,
  drop column if exists lost_reason,
  drop column if exists pipeline_stage;
