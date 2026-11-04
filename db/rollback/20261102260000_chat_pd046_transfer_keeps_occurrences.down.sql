-- Roll back 20261102260000_chat_pd046_transfer_keeps_occurrences (PD-46 PR-2b): chat.skip_moved_occurrence as PD-31 wrote it
-- (20261026110000), matching a moved occurrence by its weekly slot only.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102260000_chat_pd046_transfer_keeps_occurrences.down.sql

create or replace function chat.skip_moved_occurrence()
returns trigger
language plpgsql
as $$
begin
  if new.created_by_kind = 'system' and new.schedule_slot_id is not null and exists (
    select 1 from chat.lesson x
     where x.schedule_slot_id = new.schedule_slot_id
       and x.starts_at = new.starts_at
       and x.outcome = 'rescheduled'
       and exists (select 1 from chat.lesson y where y.moved_from = x.id)) then
    return null;
  end if;
  return new;
end;
$$;

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102260000_chat_pd046_transfer_keeps_occurrences';
