-- Jawwid Chat -- BR-1 structural backstop, closing red-team findings RT-024 and RT-025.
--
-- THE INVARIANT
-- -------------
--   A conversation whose live membership contains BOTH a teacher AND a family
--   contact is the official Student Group. It may never be a direct 1:1, and it
--   must carry a live Jawwid admin.
--
-- 20260905093000 enforced half of this with chat.enforce_direct_conversation_rules(),
-- attached to chat.conversation_member. Its own comment claimed:
--
--   'BR-1 backstop. Even a compromised API or a manual SQL session cannot
--    create a teacher<->parent 1:1 channel.'
--
-- The red team proved otherwise, by execution, on Supabase Postgres 17.6:
--
--   RT-024  The invariant spans two tables and was enforced on one. Building a
--           legal student_group and then running
--             update chat.conversation set type = 'direct', direct_key = '...'
--           produced a `direct` conversation whose live members were a teacher
--           and a parent. chat.call had the identical bypass via call.type.
--
--   RT-025  'Required admin presence' was never enforced at all: a
--           student_group -- or a class_group, which the old trigger did not
--           examine, because it tested type = 'direct' only -- containing
--           exactly one teacher and one parent and NO admin was permitted.
--           That is a private teacher<->parent channel wearing a group's name.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
--   1. `type` is immutable on chat.conversation and chat.call. Neither has ever
--      been updated by application code; freezing it removes the RT-024 attack
--      outright rather than re-validating after the fact.
--   2. One validation function per domain, evaluated by DEFERRED CONSTRAINT
--      TRIGGERS on BOTH tables the invariant spans, so it holds however the
--      state is reached -- insert, update, member removal, or a direct SQL
--      session with the application bypassed entirely.
--   3. The admin who satisfies 'required admin presence' must be actor_kind
--      = 'staff'. Without that, a teacher could satisfy the rule by carrying
--      member_role = 'admin' on their own row; no constraint ties the two
--      columns together.
--
-- WHY DEFERRED, AND WHY THAT MATTERS
-- ----------------------------------
-- A Student Group is built one member at a time, and the admin may legitimately
-- be added after the teacher and the parent. An immediate trigger would reject
-- the intermediate state and make the legal group unbuildable. DEFERRABLE
-- INITIALLY DEFERRED evaluates the COMMITTED state, so a transaction is free to
-- pass through an invalid intermediate state and is judged only on where it
-- lands. This is what lets the backstop be strict without breaking the workflow
-- it exists to protect.
--
-- 093000's immediate trigger is deliberately left in place: it still fails the
-- direct-creation case fast, with a clearer error, before commit.
--
-- WHAT REMAINS LEGAL -- asserted by db/tests/br1_invariants.sql
--   * Teacher <-> Admin direct        (teacher + staff, no contact)
--   * Parent  <-> Admin direct        (contact + staff, no teacher)
--   * Student Group                   (teacher + parent + live staff admin)
--   * Group voice call in that group

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create or replace function chat.assert_conversation_br1(p_conversation_id uuid)
returns void
language plpgsql
as $$
declare
  v_type        text;
  v_has_teacher boolean;
  v_has_contact boolean;
  v_admins      integer;
  v_live        integer;
begin
  select type into v_type from chat.conversation where id = p_conversation_id;
  -- Cascade-deleted inside this transaction: nothing left to constrain.
  if not found then
    return;
  end if;

  select
    count(*) filter (where actor_kind = 'teacher') > 0,
    count(*) filter (where actor_kind = 'contact') > 0,
    count(*) filter (where actor_kind = 'staff' and member_role = 'admin'),
    count(*)
  into v_has_teacher, v_has_contact, v_admins, v_live
  from chat.conversation_member
  where conversation_id = p_conversation_id
    and left_at is null;

  if v_has_teacher and v_has_contact then
    -- BR-1: the forbidden channel. Reached by creation OR by mutation.
    if v_type = 'direct' then
      raise exception
        'BR-1 violation: conversation % pairs a teacher with a family contact and may never be type=direct',
        p_conversation_id
        using errcode = 'check_violation',
              hint = 'Teacher and parent communicate only inside the official Student Group.';
    end if;

    -- BR-1: required admin presence. Applies to EVERY group type, not just
    -- student_group -- class_group was outside the old trigger's scope (RT-025).
    if v_admins = 0 then
      raise exception
        'BR-1 violation: conversation % pairs a teacher with a family contact and must retain a live Jawwid admin member',
        p_conversation_id
        using errcode = 'check_violation',
              hint = 'Add a staff member with member_role=admin, or remove the teacher or the contact.';
    end if;
  end if;

  if v_type = 'direct' and v_live > 2 then
    raise exception
      'a direct conversation may not have more than two live participants (conversation %)',
      p_conversation_id
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function chat.assert_conversation_br1(uuid) is
  'BR-1 for conversations. Called by deferred constraint triggers on BOTH '
  'chat.conversation and chat.conversation_member, so the invariant cannot be '
  'reached from either side. Closes RT-024 and RT-025.';

create or replace function chat.tg_conversation_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_conversation_br1(
    coalesce(new.conversation_id, old.conversation_id)
  );
  return null;
end;
$$;

create or replace function chat.tg_conversation_row_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_conversation_br1(new.id);
  return null;
end;
$$;

-- `type` is what RT-024 mutated. Freeze it.
create or replace function chat.forbid_conversation_type_change()
returns trigger
language plpgsql
as $$
begin
  if new.type is distinct from old.type then
    raise exception
      'chat.conversation.type is immutable (attempted % -> % on conversation %)',
      old.type, new.type, old.id
      using errcode = 'restrict_violation',
            hint = 'Archive the conversation and open a new one of the required type.';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_type_immutable on chat.conversation;
create trigger conversation_type_immutable
  before update on chat.conversation
  for each row execute function chat.forbid_conversation_type_change();

drop trigger if exists conversation_br1_row on chat.conversation;
create constraint trigger conversation_br1_row
  after insert or update on chat.conversation
  deferrable initially deferred
  for each row execute function chat.tg_conversation_row_br1();

drop trigger if exists conversation_member_br1_deferred on chat.conversation_member;
create constraint trigger conversation_member_br1_deferred
  after insert or update or delete on chat.conversation_member
  deferrable initially deferred
  for each row execute function chat.tg_conversation_br1();

-- ---------------------------------------------------------------------------
-- Calls -- the same invariant, because calling must never be more permissive
-- than messaging.
-- ---------------------------------------------------------------------------

create or replace function chat.assert_call_br1(p_call_id uuid)
returns void
language plpgsql
as $$
declare
  v_type        text;
  v_has_teacher boolean;
  v_has_contact boolean;
  v_has_staff   boolean;
  v_total       integer;
begin
  select type into v_type from chat.call where id = p_call_id;
  if not found then
    return;
  end if;

  -- left_at is deliberately NOT filtered. A participant who joined and left was
  -- still paired on that call; BR-1 is about who was connected, not who is
  -- connected now. It also means an admin whose connection drops mid-call
  -- cannot retroactively invalidate a call that was authorized when it began.
  select
    count(*) filter (where actor_kind = 'teacher') > 0,
    count(*) filter (where actor_kind = 'contact') > 0,
    count(*) filter (where actor_kind = 'staff') > 0,
    count(*)
  into v_has_teacher, v_has_contact, v_has_staff, v_total
  from chat.call_participant
  where call_id = p_call_id;

  if v_has_teacher and v_has_contact then
    if v_type = 'direct' then
      raise exception
        'BR-1 violation: call % pairs a teacher with a family contact and may never be type=direct',
        p_call_id
        using errcode = 'check_violation',
              hint = 'Teacher and parent speak only in the official Student Group call.';
    end if;

    if not v_has_staff then
      raise exception
        'BR-1 violation: call % pairs a teacher with a family contact and requires a Jawwid staff participant',
        p_call_id
        using errcode = 'check_violation';
    end if;
  end if;

  if v_type = 'direct' and v_total > 2 then
    raise exception 'a direct call may not have more than two participants (call %)', p_call_id
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function chat.assert_call_br1(uuid) is
  'BR-1 for calls. Calling is never more permissive than messaging. Called by '
  'deferred constraint triggers on BOTH chat.call and chat.call_participant.';

create or replace function chat.tg_call_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_call_br1(coalesce(new.call_id, old.call_id));
  return null;
end;
$$;

create or replace function chat.tg_call_row_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_call_br1(new.id);
  return null;
end;
$$;

create or replace function chat.forbid_call_type_change()
returns trigger
language plpgsql
as $$
begin
  if new.type is distinct from old.type then
    raise exception
      'chat.call.type is immutable (attempted % -> % on call %)',
      old.type, new.type, old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists call_type_immutable on chat.call;
create trigger call_type_immutable
  before update on chat.call
  for each row execute function chat.forbid_call_type_change();

drop trigger if exists call_br1_row on chat.call;
create constraint trigger call_br1_row
  after insert or update on chat.call
  deferrable initially deferred
  for each row execute function chat.tg_call_row_br1();

drop trigger if exists call_participant_br1_deferred on chat.call_participant;
create constraint trigger call_participant_br1_deferred
  after insert or update or delete on chat.call_participant
  deferrable initially deferred
  for each row execute function chat.tg_call_br1();
