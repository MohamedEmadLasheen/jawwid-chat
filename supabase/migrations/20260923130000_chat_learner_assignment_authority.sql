-- Jawwid Chat -- chat.learner.teacher_id is the academy's fact, not Chat's.
--
-- WHY
-- ---
-- PD-6 (product-boundary §4) permits direct Teacher <-> Parent communication
-- while the teaching relationship is authorized, and closes OD-04 by naming the
-- academy's assignment system as the authoritative owner of that relationship:
-- Chat consumes the assignment, and `chat.learner.teacher_id` is Chat's read
-- model rather than the business source of truth.
--
-- Today nothing enforces that. `20260905091200_chat_rls.sql` grants UPDATE on
-- chat.learner to `authenticated` and `learner_edited_by_admins` is `for all`,
-- so an admin, coverage admin or manager can set teacher_id directly -- and an
-- INSERT can establish one outright. Harmless while the column is unread by any
-- authorization decision; the moment PD-6's predicate goes live the same edit
-- would grant a teacher the right to message and call a family privately. That
-- is Chat becoming the business authority through a side door, which is the one
-- thing OD-04 decided against.
--
-- WHAT THIS DOES
-- --------------
-- Closes the write path ahead of the switch, and nothing else. No Core feed, no
-- webhook, no ingestion function, no authorization change. teacher_id simply
-- stops being writable by ordinary Chat access, and the seam the future
-- ingestion will use is established now so that it has somewhere to land.
--
-- This is the shape `chat.guard_owner_change` already uses for the mirror-image
-- case: `family.owner_id` is authoritative in CHAT and a Core sync must never
-- write it, so the column is trigger-guarded and changes only inside
-- `chat.transfer_ownership()`, which opens the gate with a transaction-local
-- setting. Here the ownership runs the other way -- the academy owns the fact
-- and Chat's own admins must not write it -- but the mechanism is the same one,
-- deliberately, rather than a second way of saying "this column is guarded".
--
-- INSERT is guarded as well as UPDATE. A boundary that only covered UPDATE
-- would be bypassed by creating the learner with the assignment already set.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not a privilege control. The flag is a convention, greppable and auditable,
-- exactly as `chat.transferring_ownership` is; anyone able to run arbitrary SQL
-- can set it. It stops the application's own edit paths, which is what the
-- audit found open. The privilege half arrives with RLS (RLS-STRATEGY.md §7
-- item 1): once the API connects as `chat_app` rather than as the owner, a
-- column-level revoke of UPDATE(teacher_id) makes this structural as well.
-- Until then `AuthorizationService` and this trigger are the control.

create or replace function chat.guard_learner_assignment_change()
returns trigger
language plpgsql
as $$
declare
  v_open boolean := coalesce(current_setting('chat.syncing_assignment', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.teacher_id is not null and not v_open then
      raise exception
        'chat.learner.teacher_id is owned by the academy assignment system (PD-6/OD-04); '
        'a learner cannot be created with an assignment from inside Chat'
        using errcode = 'restrict_violation',
              hint = 'Insert the learner, then let assignment ingestion set teacher_id.';
    end if;
    return new;
  end if;

  if new.teacher_id is distinct from old.teacher_id and not v_open then
    raise exception
      'chat.learner.teacher_id is owned by the academy assignment system (PD-6/OD-04); '
      'it changes only through assignment ingestion, never a Chat-side edit'
      using errcode = 'restrict_violation',
            hint = 'Ingestion opens the gate with '
                   'set_config(''chat.syncing_assignment'', ''on'', true).';
  end if;

  return new;
end;
$$;

comment on function chat.guard_learner_assignment_change() is
  'PD-6/OD-04: the teacher <-> learner assignment is the academy''s fact. Chat '
  'mirrors it and must not author it, so teacher_id is writable only inside the '
  'ingestion path, which opens chat.syncing_assignment for its transaction. '
  'Same mechanism as chat.guard_owner_change for family.owner_id.';

-- `of teacher_id` on the UPDATE arm: the trigger costs nothing on the many
-- updates that never mention the column (name, level, next_class_at, the
-- attention counters).
drop trigger if exists learner_assignment_is_guarded on chat.learner;
create trigger learner_assignment_is_guarded
  before insert or update of teacher_id on chat.learner
  for each row execute function chat.guard_learner_assignment_change();
