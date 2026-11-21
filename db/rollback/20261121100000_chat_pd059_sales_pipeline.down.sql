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

-- Restore chat.guard_trial_prospect to 20261019120000's body (without the PD-59 family-organization rule).
create or replace function chat.guard_trial_prospect()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from chat.staff s where s.id = new.created_by and s.organization_id = new.organization_id) then
      raise exception 'a prospect is recorded by staff of its organization' using errcode = 'insufficient_privilege';
    end if;
    if new.learner_id is not null then
      raise exception 'a prospect is linked to a learner only when Core confirms it' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.organization_id, new.display_name, new.level, new.note, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.display_name, old.level, old.note, old.created_by, old.created_at) then
    raise exception 'a prospect is not rewritten' using errcode = 'check_violation';
  end if;
  if new.learner_id is distinct from old.learner_id then
    if old.learner_id is not null or not chat.caller_is_server_side()
       or coalesce(current_setting('chat.confirming_trial', true), '') <> 'on' then
      raise exception 'a prospect is linked to its learner only by the confirmation' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from chat.learner l where l.id = new.learner_id and l.organization_id = new.organization_id) then
      raise exception 'a prospect is linked to a learner of its organization' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

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
