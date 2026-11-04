-- PD-46 PR-2b (TEACHER-026, CHATSCHED-009): a weekly lesson already used up is
-- never created again, whichever weekly slot would create it.
--
-- chat.skip_moved_occurrence (PD-31) stopped the materializer re-creating an
-- occurrence that was MOVED -- but matched it by schedule_slot_id. A change of
-- teacher ends the learner's weekly slots and opens new ones (a slot is ended,
-- never edited), so on the new slot the moved occurrence looked new, and so did
-- one closed by an apology or an absence: the family got the lesson back next
-- to its make-up or its new time (TEACHER-026).
--
-- Now a system-created weekly lesson is skipped when the LEARNER already has a
-- lesson at exactly that start that holds the occurrence:
--   * one still open (the transfer moved it; it is the same lesson), or
--   * one closed by what happened to it (held, an apology, an absence, a
--     cancellation, a ruling -- any outcome but `suspended` / `rescheduled`), or
--   * one `rescheduled` because it was moved (a lesson names it in moved_from).
-- Still re-created, as before: a `suspended` occurrence (study resumed) and one
-- `rescheduled` because the weekly times changed (no lesson continues it).

create or replace function chat.skip_moved_occurrence()
returns trigger
language plpgsql
as $$
begin
  if new.created_by_kind = 'system' and new.schedule_slot_id is not null and new.learner_id is not null and exists (
    select 1 from chat.lesson x
     where x.learner_id = new.learner_id
       and x.starts_at = new.starts_at
       and (x.outcome is null
            or x.outcome not in ('suspended', 'rescheduled')
            or (x.outcome = 'rescheduled' and exists (select 1 from chat.lesson y where y.moved_from = x.id)))) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function chat.skip_moved_occurrence() from public;
