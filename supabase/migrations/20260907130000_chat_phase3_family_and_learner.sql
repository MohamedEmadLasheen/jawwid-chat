-- Jawwid Chat -- Phase 3: the family and student business model.
--
-- Canonical design: docs/recovery/PHASE-3-REPORT.md.
--
-- THE PRINCIPLE THIS MIGRATION EXISTS TO ENFORCE
--   Current relationships must be mutable without destroying historical truth.
--
-- Before this migration, chat.learner.teacher_id was a single mutable column.
-- Reassigning a student ERASED the fact that the previous teacher had ever
-- taught them -- and that fact is not decoration: it is how a supervisor
-- answers "who was teaching Ahmed in March", and how an access decision taken
-- last month is explained today.
--
-- The shape is deliberately IDENTICAL to chat.family_assignment
-- (20260907100200): an assignment row with a start, an optional end, a
-- mandatory reason, a partial unique index permitting exactly one live row, a
-- guard trigger, and a mirror trigger keeping the denormalised column in step.
-- One pattern applied twice, rather than two patterns that drift apart.
--
-- FAMILY LIFECYCLE. chat.family.state already IS the lifecycle. Phase 3 adds no
-- second column and no is_active flag: ACTIVE and INACTIVE are DERIVED from it
-- by chat.family_state_is_active(), so there is exactly one authoritative
-- source and it cannot disagree with itself.

-- ---------------------------------------------------------------------------
-- 0. The Phase 3 event vocabulary
-- ---------------------------------------------------------------------------
--
-- chat.event_log.type is a CLOSED check constraint, so an event type must be
-- admitted before anything can emit it.
--
-- DEPENDENCY ORDER, LEARNED THE HARD WAY. The whole Phase 3 vocabulary is
-- admitted HERE, in the first Phase 3 migration, rather than in the last one --
-- including the group and label types that migrations 130100 and 130200 will
-- emit. The alternative (each migration extending the constraint for itself)
-- means every later migration must restate the entire preceding list, and an
-- operator who applies 130000 and stops has a chat.assign_learner_teacher()
-- that raises a check violation on its own audit trail.
--
-- Every pre-existing value is preserved exactly; this only adds.
-- `family_state_changed` is NOT added: it already exists and is reused.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'event_log_type_check') then
    alter table chat.event_log drop constraint event_log_type_check;
    alter table chat.event_log add constraint event_log_type_check
      check (type in (
        -- AI #1's vocabulary, unchanged
        'message_received', 'message_sent', 'internal_note_added',
        'case_opened', 'case_status_changed', 'case_resolved', 'case_closed',
        'case_reopened', 'case_escalated', 'case_auto_resolved',
        'task_created', 'task_completed', 'task_cancelled',
        'handoff_created', 'handoff_acknowledged',
        'coverage_started', 'coverage_ended', 'sticky_started', 'sticky_expired',
        'absence_activated', 'absence_auto_detected', 'unattended_detected',
        'ownership_transferred', 'family_state_changed', 'family_flagged',
        'payment_failed', 'payment_succeeded', 'renewal_due',
        'subscription_synced', 'class_reminder_due', 'class_attended',
        'class_missed', 'attention_order_disputed', 'family_opened',
        'assist_requested',
        -- communication domain (AI #2), unchanged
        'conversation_created', 'conversation_archived',
        'student_group_created', 'student_group_membership_synced',
        'message_approved', 'message_rejected',
        'call_started', 'call_ended',
        -- PHASE 3: students and teaching relationships
        'learner_created', 'learner_activated', 'learner_deactivated',
        'teacher_assigned', 'teacher_transferred', 'teacher_unassigned',
        -- PHASE 3: groups
        'group_created', 'group_updated',
        'group_member_added', 'group_member_removed',
        'group_teacher_added', 'group_teacher_removed',
        'group_closed', 'group_archived', 'group_replaced',
        -- PHASE 3: labels
        'label_created', 'label_updated', 'label_deleted',
        'family_label_added', 'family_label_removed'
      ));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Family lifecycle -- derived, never duplicated
-- ---------------------------------------------------------------------------

create or replace function chat.family_state_is_active(p_state text)
returns boolean
language sql
immutable
as $$
  -- onboarding, active, at_risk and renewal_due are all states of a family the
  -- academy is currently serving; a family that is at risk is still a customer.
  -- `paused` and `churned` are the two ways a family stops being one.
  select p_state in ('onboarding', 'active', 'at_risk', 'renewal_due')
$$;

comment on function chat.family_state_is_active is
  'THE definition of an ACTIVE family (Phase 3). Derived from chat.family.state '
  'so the active/inactive concept cannot drift from the six-value lifecycle the '
  'schema already had. There is deliberately no chat.family.is_active column.';

create index if not exists family_active_state_idx
  on chat.family (state) where state in ('onboarding', 'active', 'at_risk', 'renewal_due');

-- WHY THERE IS NO set_family_state(any, any)
--
-- An unrestricted state mutation API is how `at_risk` and `renewal_due` -- both
-- owned by the FROZEN renewal machinery (product boundary section 3) -- get
-- manufactured by hand and quietly revive a deprecated subsystem. So Phase 3
-- exposes exactly two named business operations, and neither can target those
-- two states. They remain readable and are preserved untouched; there is simply
-- no operation whose target they can be.

create or replace function chat.deactivate_family(
  p_family_id uuid,
  p_state     text,
  p_reason    text,
  p_actor_id  uuid default null
) returns boolean
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_prev  text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'deactivating a family requires a reason' using errcode = 'check_violation';
  end if;
  -- The target is validated against a two-value allow-list, not against the
  -- whole CHECK constraint. That is what keeps the frozen states unreachable.
  if p_state is null or p_state not in ('paused', 'churned') then
    raise exception 'a family is deactivated to paused or churned, not to %',
      coalesce(p_state, 'null') using errcode = 'check_violation';
  end if;

  select state into v_prev from chat.family where id = p_family_id for update;
  if v_prev is null then
    raise exception 'no such family %', p_family_id using errcode = 'no_data_found';
  end if;
  -- Already inactive in the requested way: a no-op, and deliberately NOT an
  -- audit row. Recording a change that did not happen is how a history stops
  -- being evidence.
  if v_prev = p_state then
    return false;
  end if;

  update chat.family
     set state = p_state, state_reason = p_reason, state_changed_at = now()
   where id = p_family_id;

  perform chat.write_audit(
    v_actor, 'family.deactivated', 'family', p_family_id, p_reason,
    jsonb_build_object('state', v_prev), jsonb_build_object('state', p_state));

  perform chat.log_event(
    'family_state_changed', p_family_id, 'staff', v_actor,
    jsonb_build_object('from_state', v_prev, 'to_state', p_state, 'reason', p_reason));

  return true;
end;
$$;

comment on function chat.deactivate_family is
  'Phase 3 business operation. Targets `paused` or `churned` ONLY -- the frozen '
  'renewal states at_risk and renewal_due are unreachable from any Phase 3 '
  'operation by construction. Never deletes: every contact, learner, '
  'assignment and conversation survives untouched.';

create or replace function chat.activate_family(
  p_family_id uuid,
  p_reason    text,
  p_actor_id  uuid default null
) returns boolean
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_prev  text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'activating a family requires a reason' using errcode = 'check_violation';
  end if;

  select state into v_prev from chat.family where id = p_family_id for update;
  if v_prev is null then
    raise exception 'no such family %', p_family_id using errcode = 'no_data_found';
  end if;

  -- Reactivation is supported, and it is the ONLY transition into `active`
  -- this function performs. A family that is already being served is left
  -- exactly as it is -- in particular, this never rewrites `onboarding`,
  -- `at_risk` or `renewal_due` into `active`, which would destroy a state the
  -- Phase 3 operator is not entitled to change.
  if chat.family_state_is_active(v_prev) then
    return false;
  end if;

  update chat.family
     set state = 'active', state_reason = p_reason, state_changed_at = now()
   where id = p_family_id;

  perform chat.write_audit(
    v_actor, 'family.activated', 'family', p_family_id, p_reason,
    jsonb_build_object('state', v_prev), jsonb_build_object('state', 'active'));

  perform chat.log_event(
    'family_state_changed', p_family_id, 'staff', v_actor,
    jsonb_build_object('from_state', v_prev, 'to_state', 'active', 'reason', p_reason));

  return true;
end;
$$;

comment on function chat.activate_family is
  'Phase 3 business operation: reactivate a paused or churned family. A family '
  'already in an active state is left untouched, so this can never overwrite '
  'onboarding / at_risk / renewal_due.';

-- ---------------------------------------------------------------------------
-- 2. Student lifecycle
-- ---------------------------------------------------------------------------
--
-- A student who stops attending is deactivated, never deleted: the family
-- relationship, the teacher history, the group membership history and every
-- conversation they took part in all remain answerable afterwards.

alter table chat.learner add column if not exists is_active boolean not null default true;
alter table chat.learner add column if not exists deactivated_at timestamptz;
alter table chat.learner add column if not exists deactivated_reason text;

comment on column chat.learner.is_active is
  'Phase 3 lifecycle. A learner is NEVER deleted -- deactivation preserves the '
  'family relationship, the teacher history, group membership history and every '
  'conversation they were part of.';

alter table chat.learner drop constraint if exists learner_deactivation_is_stamped;
alter table chat.learner
  add constraint learner_deactivation_is_stamped
  check (is_active or deactivated_at is not null);

create index if not exists learner_family_active_idx
  on chat.learner (family_id) where is_active;

-- ---------------------------------------------------------------------------
-- 3. Teacher assignment, with history
-- ---------------------------------------------------------------------------

create table if not exists chat.learner_teacher_assignment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  learner_id      uuid not null references chat.learner (id) on delete cascade,
  teacher_id      uuid not null references chat.teacher (id) on delete restrict,
  started_at      timestamptz not null default clock_timestamp(),
  assigned_by     uuid references chat.staff (id) on delete set null,
  reason          text not null,
  ended_at        timestamptz,
  ended_by        uuid references chat.staff (id) on delete set null,
  ended_reason    text,
  -- TRUE for the rows written by this migration's backfill. Those rows carry a
  -- reconstructed `started_at`, not an observed one, and a report that treated
  -- them as known history would be asserting something the database never knew.
  is_backfilled   boolean not null default false,
  created_at      timestamptz not null default now(),

  constraint learner_teacher_assignment_reason_not_blank
    check (length(btrim(reason)) > 0),
  -- WHY clock_timestamp() AND NOT now() (verified by execution).
  -- now() is TRANSACTION-START time. Two concurrent transfers serialised by the
  -- learner lock can therefore stamp a window backwards: the second transaction
  -- began before the first committed, so its now() precedes the row it is
  -- ending, and this check fired --
  --   `violates check constraint learner_teacher_assignment_window_ordered`
  -- on a transfer that was entirely legitimate. clock_timestamp() is the actual
  -- statement time, so an end is always at or after the start it closes, and
  -- successive assignments order the way the events actually happened.
  constraint learner_teacher_assignment_window_ordered
    check (ended_at is null or ended_at >= started_at)
);

comment on table chat.learner_teacher_assignment is
  'Who teaches which student, WITH HISTORY. At most one live row per learner '
  '(learner_teacher_assignment_one_live). chat.learner.teacher_id is a '
  'denormalised mirror of the live row maintained by trigger, so every '
  'pre-Phase-3 reader -- including chat.guard_teacher_deactivation() and '
  'ConversationService.syncStudentGroup -- keeps working unchanged.';

comment on column chat.learner_teacher_assignment.is_backfilled is
  'This row was reconstructed from chat.learner.teacher_id at the Phase 3 '
  'cutover. Its started_at is a BACKFILLED BASELINE (the learner''s created_at), '
  'not a known historical start date.';

-- THE INVARIANT: a student has at most one current teacher. A second live row
-- is refused by the database, not by a service that remembered to check.
create unique index if not exists learner_teacher_assignment_one_live
  on chat.learner_teacher_assignment (learner_id) where ended_at is null;

-- Current-state lookup and history listing, each indexed for its own query.
create index if not exists learner_teacher_assignment_learner_idx
  on chat.learner_teacher_assignment (learner_id, started_at desc);
create index if not exists learner_teacher_assignment_teacher_live_idx
  on chat.learner_teacher_assignment (teacher_id) where ended_at is null;
create index if not exists learner_teacher_assignment_organization_idx
  on chat.learner_teacher_assignment (organization_id);

-- ---------------------------------------------------------------------------
-- 4. Backfill -- BEFORE the guard trigger exists
-- ---------------------------------------------------------------------------
--
-- Ordering is deliberate. The guard below requires an ACTIVE teacher, and the
-- backfill must be able to record history exactly as it stands rather than
-- being refused by a rule written for new assignments.
--
-- In practice no row can violate it: chat.guard_teacher_deactivation()
-- (20260907100000) refuses to deactivate a teacher who still holds any learner,
-- so "learner -> inactive teacher" is unreachable. The ordering is defence
-- against that guard being relaxed later, not against today's data.
--
-- DETERMINISM. One row per learner that currently names a teacher, and none for
-- a learner that does not. started_at = the learner's created_at -- the earliest
-- trustworthy timestamp the schema actually holds (learner.created_at is NOT
-- NULL). It is a reconstructed baseline, and is_backfilled = true says so
-- rather than letting a report imply the academy knows when teaching began.
--
-- The effective current teacher is UNCHANGED by this migration: the mirror
-- trigger is created afterwards, and it only ever writes the value that is
-- already in learner.teacher_id.

insert into chat.learner_teacher_assignment
  (organization_id, learner_id, teacher_id, started_at, assigned_by, reason, is_backfilled)
select l.organization_id, l.id, l.teacher_id, l.created_at, null,
       'Phase 3 cutover: reconstructed from learner.teacher_id', true
  from chat.learner l
 where l.teacher_id is not null
   and not exists (select 1 from chat.learner_teacher_assignment a
                    where a.learner_id = l.id and a.ended_at is null);

-- ---------------------------------------------------------------------------
-- 5. Guards and the mirror
-- ---------------------------------------------------------------------------

-- Only an active teacher may hold a student, and never across organizations.
create or replace function chat.guard_learner_teacher_assignment()
returns trigger
language plpgsql
as $$
begin
  -- Checked on insert, and on an update that changes the teacher. Ending an
  -- assignment must stay possible after the teacher has gone inactive, or an
  -- offboarding could not close its own assignments.
  if tg_op = 'INSERT' or new.teacher_id is distinct from old.teacher_id then
    if not exists (select 1 from chat.teacher t
                   where t.id = new.teacher_id and t.is_active and t.left_at is null) then
      raise exception 'a student may only be assigned to an active teacher'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.organization_id is distinct from
     (select l.organization_id from chat.learner l where l.id = new.learner_id) then
    raise exception 'cross-organization teacher assignment refused'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists learner_teacher_assignment_is_guarded on chat.learner_teacher_assignment;
create trigger learner_teacher_assignment_is_guarded
  before insert or update on chat.learner_teacher_assignment
  for each row execute function chat.guard_learner_teacher_assignment();

-- chat.learner.teacher_id mirrors the live assignment, exactly as
-- chat.family.owner_id mirrors the live primary family assignment.
--
-- NO RECURSION IS POSSIBLE, and this was verified rather than assumed:
-- chat.learner carries only set_updated_at and enforce_same_organization, and
-- neither writes back to this table. Note the contrast with the family mirror,
-- which must suppress chat.family's owner_id guard with set_config() -- there is
-- no equivalent guard on learner.teacher_id, so nothing has to be disabled here.
-- A mirror that had to switch a control off to do its job would be a mirror to
-- distrust.
create or replace function chat.mirror_learner_teacher_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.ended_at is null then
    update chat.learner set teacher_id = new.teacher_id
     where id = new.learner_id and teacher_id is distinct from new.teacher_id;
  elsif not exists (select 1 from chat.learner_teacher_assignment a
                     where a.learner_id = new.learner_id and a.ended_at is null) then
    -- The last live assignment ended: "no current teacher" is representable,
    -- and clearing the mirror is what lets a teacher be deactivated afterwards.
    update chat.learner set teacher_id = null
     where id = new.learner_id and teacher_id is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists learner_teacher_assignment_mirrors_learner
  on chat.learner_teacher_assignment;
create trigger learner_teacher_assignment_mirrors_learner
  after insert or update on chat.learner_teacher_assignment
  for each row execute function chat.mirror_learner_teacher_assignment();

-- ---------------------------------------------------------------------------
-- 6. Assignment and transfer
-- ---------------------------------------------------------------------------

create or replace function chat.assign_learner_teacher(
  p_learner_id uuid,
  p_teacher_id uuid,
  p_reason     text,
  p_actor_id   uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_prev  record;
  v_id    uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a teacher assignment requires a reason' using errcode = 'check_violation';
  end if;

  -- THE LOCK IS WHAT MAKES THE TRANSFER ATOMIC, AND IT IS TAKEN ON THE LEARNER,
  -- NOT ON THE ASSIGNMENT.
  --
  -- Locking the live assignment row looks equivalent and is not. That row is a
  -- MOVING TARGET: under READ COMMITTED a second transaction blocks on it, and
  -- when the first commits, the row it was waiting for no longer satisfies
  -- `ended_at is null`. The recheck therefore returns NO row, the second
  -- transaction concludes that no assignment exists, skips the end-previous
  -- step, and inserts -- colliding with the winner's new row. Verified by
  -- execution: two concurrent transfers produced
  -- `duplicate key value violates unique constraint
  --  learner_teacher_assignment_one_live`. The invariant held, but a legitimate
  -- concurrent transfer failed with an opaque constraint error instead of being
  -- applied after the first.
  --
  -- chat.learner always exists and never moves, so locking it serialises every
  -- transfer of THIS student and nothing else. The partial unique index remains
  -- the backstop for any path that bypasses this function.
  perform 1 from chat.learner where id = p_learner_id for update;

  select * into v_prev from chat.learner_teacher_assignment
   where learner_id = p_learner_id and ended_at is null
     for update;

  -- Assigning the teacher who already holds the student is a NO-OP, not a
  -- second row. Without this an idempotent client retry would manufacture a
  -- fake transfer in the history.
  if v_prev.teacher_id = p_teacher_id then
    return v_prev.id;
  end if;

  if v_prev.id is not null then
    update chat.learner_teacher_assignment
       set ended_at = clock_timestamp(), ended_by = v_actor, ended_reason = p_reason
     where id = v_prev.id;
  end if;

  insert into chat.learner_teacher_assignment
    (organization_id, learner_id, teacher_id, assigned_by, reason)
  values
    ((select organization_id from chat.learner where id = p_learner_id),
     p_learner_id, p_teacher_id, v_actor, p_reason)
  returning id into v_id;

  perform chat.write_audit(
    v_actor,
    case when v_prev.id is null then 'learner.teacher_assigned'
         else 'learner.teacher_transferred' end,
    'learner', p_learner_id, p_reason,
    jsonb_build_object('teacher_id', v_prev.teacher_id),
    jsonb_build_object('teacher_id', p_teacher_id));

  perform chat.log_event(
    case when v_prev.id is null then 'teacher_assigned' else 'teacher_transferred' end,
    (select family_id from chat.learner where id = p_learner_id),
    'staff', v_actor,
    jsonb_build_object('learner_id', p_learner_id,
                       'from_teacher_id', v_prev.teacher_id,
                       'to_teacher_id', p_teacher_id,
                       'reason', p_reason));

  return v_id;
end;
$$;

comment on function chat.assign_learner_teacher is
  'The only way a student changes teacher. Ends the previous assignment and '
  'opens the new one in ONE transaction under a row lock, so the database is '
  'never in a state where two teachers are current, and never in one where none '
  'is by accident.';

create or replace function chat.end_learner_teacher_assignment(
  p_learner_id uuid, p_reason text, p_actor_id uuid default null
) returns boolean
language plpgsql
as $$
declare
  v_actor uuid := coalesce(p_actor_id, chat.current_staff_id());
  v_prev  record;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'ending a teacher assignment requires a reason'
      using errcode = 'check_violation';
  end if;

  perform 1 from chat.learner where id = p_learner_id for update;

  select * into v_prev from chat.learner_teacher_assignment
   where learner_id = p_learner_id and ended_at is null
     for update;
  if v_prev.id is null then
    return false;
  end if;

  update chat.learner_teacher_assignment
     set ended_at = clock_timestamp(), ended_by = v_actor, ended_reason = p_reason
   where id = v_prev.id;

  perform chat.write_audit(
    v_actor, 'learner.teacher_unassigned', 'learner', p_learner_id, p_reason,
    jsonb_build_object('teacher_id', v_prev.teacher_id),
    jsonb_build_object('teacher_id', null));

  return true;
end;
$$;

-- Offboarding a teacher must release their students first. The mirror then
-- clears chat.learner.teacher_id, which is precisely what allows
-- chat.guard_teacher_deactivation() to permit the deactivation afterwards.
create or replace function chat.end_teacher_assignments(p_teacher_id uuid, p_reason text)
returns integer
language plpgsql
as $$
declare v_count integer;
begin
  update chat.learner_teacher_assignment
     set ended_at = clock_timestamp(), ended_reason = p_reason
   where teacher_id = p_teacher_id and ended_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reads
-- ---------------------------------------------------------------------------

create or replace function chat.learner_current_teacher(p_learner_id uuid)
returns uuid
language sql
stable
as $$
  select teacher_id from chat.learner_teacher_assignment
   where learner_id = p_learner_id and ended_at is null
$$;

comment on function chat.learner_current_teacher is
  'The CURRENT teacher, from the assignment table rather than the mirror. '
  'Historical rows are never consulted: a past assignment must never be able to '
  'answer a current-state question.';

-- ---------------------------------------------------------------------------
-- 8. Tenancy and RLS
-- ---------------------------------------------------------------------------

alter table chat.learner_teacher_assignment enable row level security;

drop policy if exists learner_teacher_assignment_organization_isolation
  on chat.learner_teacher_assignment;
create policy learner_teacher_assignment_organization_isolation
  on chat.learner_teacher_assignment
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- Visible to whoever may already see the student. The predicate is the EXISTING
-- scope function, so a new table cannot invent a second answer to "which
-- families does this actor reach".
drop policy if exists learner_teacher_assignment_visible on chat.learner_teacher_assignment;
create policy learner_teacher_assignment_visible on chat.learner_teacher_assignment
  for select to authenticated
  using (exists (select 1 from chat.learner l
                  where l.id = learner_id
                    and (chat.staff_can_see_family(l.family_id)
                         or l.family_id in (select chat.current_family_ids()))));

grant select on chat.learner_teacher_assignment to authenticated;
grant select, insert, update, delete on chat.learner_teacher_assignment to service_role;
