-- Jawwid Chat -- a Student Group must contain the family's Primary Owner.
--
-- RT-025. A student_group could be created holding only a teacher and a parent,
-- and the admin could be removed from a compliant group, leaving zero admins.
-- That defeats the premise BR-1 rests on: PRD v0.1 section 5 permits Teacher <->
-- Parent communication ONLY "inside the Student Group; admin present."
--
-- The rule enforced here is quoted from PRD v0.1 section 7.3:
--
--   "One official Student Group per student, created automatically from Jawwid
--    Core relationships: the parent, every assigned teacher, and the family's
--    primary owner."
--
-- SCOPE -- deliberately narrow, and nothing here is invented:
--
--   * ENFORCED: the family's primary owner (chat.family.owner_id) is a live
--     member of every live student_group. This is the admin-presence condition
--     BR-1 depends on.
--
--   * NOT ENFORCED: "the parent" and "every assigned teacher". Those are
--     sync-completeness properties, not BR-1 safety properties, and enforcing
--     them in the database would reject legitimate intermediate states during a
--     Jawwid Core sync. Teacher assignment also has no authoritative source yet
--     (CF-08 / OD-04).
--
--   * NOT DECIDED: whether coverage admins are permanent silent members of every
--     Student Group or join only during their coverage window. That is PRD v0.1
--     section 15.2 open question 4 and it remains open. This trigger neither
--     requires nor forbids a coverage admin's membership; it constrains the
--     primary owner only, so either answer can be implemented later without
--     touching it.
--
-- The triggers are CONSTRAINT TRIGGERS, DEFERRABLE INITIALLY DEFERRED: a group
-- and its members are built inside one transaction, so the invariant is checked
-- once at COMMIT rather than after each row. Building a group in the wrong order
-- is allowed; committing one without its owner is not.

create or replace function chat.assert_student_group_has_owner()
returns trigger
language plpgsql
as $$
declare
  v_conversation_id uuid;
  v_type            text;
  v_archived_at     timestamptz;
  v_owner_id        uuid;
begin
  -- OLD is unassigned on INSERT and NEW on DELETE, so each case is taken
  -- explicitly rather than inside one expression.
  if tg_table_name = 'conversation' then
    if tg_op = 'DELETE' then
      v_conversation_id := old.id;
    else
      v_conversation_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      v_conversation_id := old.conversation_id;
    else
      v_conversation_id := new.conversation_id;
    end if;
  end if;

  if v_conversation_id is null then
    return null;
  end if;

  select c.type, c.archived_at, f.owner_id
    into v_type, v_archived_at, v_owner_id
    from chat.conversation c
    join chat.family f on f.id = c.family_id
   where c.id = v_conversation_id;

  -- Conversation gone (cascade), not a group, or archived: nothing to assert.
  -- An archived group is history; PRD section 7.3 archives a group when a
  -- student leaves, and history must stay readable.
  if v_type is distinct from 'student_group' or v_archived_at is not null then
    return null;
  end if;

  if not exists (
    select 1
      from chat.conversation_member m
     where m.conversation_id = v_conversation_id
       and m.actor_kind = 'staff'
       and m.actor_id   = v_owner_id
       and m.left_at is null
  ) then
    raise exception
      'Student Group % must contain the family''s primary owner (%) as a live member (PRD v0.1 §7.3)',
      v_conversation_id, v_owner_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function chat.assert_student_group_has_owner() is
  'PRD v0.1 §7.3: every live Student Group contains the family''s primary '
  'owner. Deferred to COMMIT so a group and its members can be created in one '
  'transaction in any order. Says nothing about coverage admins -- PRD §15.2 '
  'open question 4 is unresolved.';

-- Membership mutation: insert, update (including left_at) and delete.
create constraint trigger conversation_member_owner_presence
  after insert or update or delete on chat.conversation_member
  deferrable initially deferred
  for each row execute function chat.assert_student_group_has_owner();

-- Conversation mutation: creation, and any update that could turn a
-- conversation into a group or un-archive one.
create constraint trigger conversation_owner_presence
  after insert or update on chat.conversation
  deferrable initially deferred
  for each row execute function chat.assert_student_group_has_owner();
