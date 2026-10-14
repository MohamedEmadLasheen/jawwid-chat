-- Jawwid Chat -- PD-7: restore BR-1 for direct teacher<->parent channels.
--
-- WHAT CHANGES
-- ------------
-- PD-7 (product owner, 2026-10-14) supersedes PD-6. The rule goes back to:
-- "a direct conversation or call may NEVER pair a teacher with a family
-- contact", whatever their relationship. Teacher <-> Parent communication
-- happens only inside the official Student Group, where a live Jawwid admin
-- must be present (C-4).
--
-- Exactly the four functions 20260923140000 repointed onto
-- chat.teacher_parent_authorized() are restated here with the relationship
-- clause replaced by an unconditional refusal, plus ONE new guard:
-- chat.enforce_br1_direct_message, which refuses a teacher's or a parent's
-- message into a direct teacher<->parent conversation that already exists.
--
-- WHAT DOES NOT CHANGE, re-stated in every function so an edit cannot drop it:
--   * required Jawwid admin/staff presence in a teacher+contact GROUP (C-4,
--     RT-025) -- every group type, not only student_group;
--   * the two-participant ceiling on direct conversations and direct calls;
--   * `type` immutability (RT-024) -- those triggers are not touched;
--   * chat.teacher_parent_authorized() itself -- kept, unchanged and still
--     granted: it is the academy's relationship predicate and has its own
--     suite (db/tests/relationship_predicate.sql). It no longer opens a channel.
--
-- EXISTING ROWS
-- -------------
-- Additive and non-destructive. No row is deleted, moved or rewritten. A direct
-- teacher<->parent conversation created under PD-6 stays in place and readable
-- as history; the refusals fire only on writes that CREATE or REVIVE the
-- pairing (an INSERT, or a member's left_at going back to NULL), and on new
-- teacher/parent messages into it. Every other write to those rows -- the
-- conversation touch on activity, a member leaving, a call ending -- succeeds,
-- for exactly the reasons 20260923140000 documents: a backstop that fires on
-- lifecycle UPDATEs would strand calls ACTIVE and make history unwritable.
--
-- REVERSIBLE: db/rollback/20261014120000_pd007.down.sql drops the message guard
-- and re-runs 20260923140000 verbatim (it is idempotent), restoring the exact
-- PD-6 bodies. No data migration in either direction. Procedure, preconditions
-- and what a rollback does NOT undo: docs/db/rollback-20261014.md.

-- PRECONDITION. This file replaces the bodies 20260923140000 installed, with the
-- same two-argument signatures its triggers call. On a database without them the
-- `create or replace` statements below would create orphan functions no trigger
-- uses and silently enforce nothing, so refuse instead.
do $pre$
begin
  if to_regprocedure('chat.assert_conversation_br1(uuid, boolean)') is null
     or to_regprocedure('chat.assert_call_br1(uuid, boolean)') is null
     or to_regprocedure('chat.tg_conversation_br1()') is null
     or to_regprocedure('chat.tg_call_br1()') is null then
    raise exception 'PD-7 precondition failed: 20260923140000_chat_pd006_authorization_switch must be applied first';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create or replace function chat.assert_conversation_br1(
  p_conversation_id uuid,
  -- False when the triggering write could not have created or revived the
  -- pairing. The structural rules below always run.
  p_check_relationship boolean default true
)
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
    if v_type = 'direct' then
      -- PD-7 / BR-1. Never, on any write that creates or revives the pairing.
      if p_check_relationship then
        raise exception
          'BR-1 violation: conversation % is a direct channel pairing a teacher with a family contact',
          p_conversation_id
          using errcode = 'check_violation',
                hint = 'PD-7: a teacher and a parent communicate only inside the Student Group, with a live Jawwid admin present.';
      end if;
    else
      -- C-4 / RT-025, UNCHANGED. A teacher+contact GROUP must retain a live
      -- Jawwid admin member.
      if v_admins = 0 then
        raise exception
          'BR-1 violation: conversation % pairs a teacher with a family contact and must retain a live Jawwid admin member',
          p_conversation_id
          using errcode = 'check_violation',
                hint = 'Add a staff member with member_role=admin, or remove the teacher or the contact.';
      end if;
    end if;
  end if;

  -- UNCHANGED.
  if v_type = 'direct' and v_live > 2 then
    raise exception
      'a direct conversation may not have more than two live participants (conversation %)',
      p_conversation_id
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function chat.assert_conversation_br1(uuid, boolean) is
  'BR-1 for conversations, restored by PD-7 (2026-10-14): a direct channel may '
  'never pair a teacher with a family contact; a teacher/parent GROUP requires '
  'a live Jawwid admin (C-4, RT-025). Called by deferred constraint triggers on '
  'BOTH chat.conversation and chat.conversation_member. p_check_relationship '
  'is false for writes that cannot create or revive a pairing, so a PD-6-era '
  'conversation stays readable and its lifecycle writes still succeed.';

create or replace function chat.enforce_direct_conversation_rules()
returns trigger
language plpgsql
as $$
declare
  v_type    text;
  v_kinds   text[];
  v_live    integer;
  v_creates boolean;
begin
  select type into v_type from chat.conversation where id = new.conversation_id;
  if v_type is distinct from 'direct' then
    return new;
  end if;

  select array_agg(distinct actor_kind), count(*)
    into v_kinds, v_live
    from chat.conversation_member
   where conversation_id = new.conversation_id
     and left_at is null;

  if v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[] then
    v_creates :=
      TG_OP = 'INSERT'
      or (TG_OP = 'UPDATE' and old.left_at is not null and new.left_at is null);
    if v_creates then
      raise exception
        'BR-1 violation: a direct conversation may never pair a teacher with a family contact'
        using errcode = 'check_violation';
    end if;
  end if;

  if v_live > 2 then
    raise exception 'a direct conversation may not have more than two participants'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function chat.enforce_direct_conversation_rules() is
  'BR-1 backstop (PD-7), immediate. Even a compromised API or a manual SQL '
  'session cannot create or revive a teacher<->parent 1:1 channel.';

-- ---------------------------------------------------------------------------
-- Messages into a PD-6-era direct teacher<->parent conversation
-- ---------------------------------------------------------------------------

create or replace function chat.enforce_br1_direct_message()
returns trigger
language plpgsql
as $$
declare
  v_type  text;
  v_kinds text[];
begin
  -- Only teacher and parent authors are the prohibited interaction. SYSTEM
  -- messages (and legacy thread rows with no conversation) are not.
  if new.conversation_id is null or new.author_type not in ('teacher', 'contact') then
    return new;
  end if;

  select type into v_type from chat.conversation where id = new.conversation_id;
  if v_type is distinct from 'direct' then
    return new;
  end if;

  select array_agg(distinct actor_kind) into v_kinds
    from chat.conversation_member
   where conversation_id = new.conversation_id
     and left_at is null;

  if v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[] then
    raise exception
      'BR-1 violation: conversation % is a direct teacher/parent channel and accepts no new messages',
      new.conversation_id
      using errcode = 'check_violation',
            hint = 'PD-7: a teacher and a parent communicate only inside the Student Group.';
  end if;

  return new;
end;
$$;

comment on function chat.enforce_br1_direct_message() is
  'BR-1 backstop (PD-7) for messages: a teacher or parent may not post into a '
  'direct conversation pairing a teacher with a family contact. Such a '
  'conversation can exist only from the PD-6 window; it is read-only history.';

drop trigger if exists message_br1_direct_guard on chat.message;
create trigger message_br1_direct_guard
  before insert on chat.message
  for each row execute function chat.enforce_br1_direct_message();

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------

create or replace function chat.assert_call_br1(
  p_call_id uuid,
  p_check_relationship boolean default true
)
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

  -- left_at is deliberately NOT filtered: this is about who was paired on the
  -- call, not who is connected now.
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
      -- PD-7 / BR-1. Checked when the pairing is created, never on a later
      -- lifecycle UPDATE, so ending a PD-6-era call always succeeds.
      if p_check_relationship then
        raise exception
          'BR-1 violation: call % is a direct call pairing a teacher with a family contact',
          p_call_id
          using errcode = 'check_violation',
                hint = 'PD-7: a teacher and a parent may share only a Student Group call, with Jawwid staff present.';
      end if;
    else
      -- C-4, UNCHANGED.
      if not v_has_staff then
        raise exception
          'BR-1 violation: call % pairs a teacher with a family contact and requires a Jawwid staff participant',
          p_call_id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- UNCHANGED.
  if v_type = 'direct' and v_total > 2 then
    raise exception 'a direct call may not have more than two participants (call %)', p_call_id
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function chat.assert_call_br1(uuid, boolean) is
  'BR-1 for calls, restored by PD-7 (2026-10-14). Calling is never more '
  'permissive than messaging: a direct call may never pair a teacher with a '
  'family contact, and a teacher/parent GROUP call still requires a Jawwid '
  'staff participant (C-4). Checked when the pairing is created, never on a '
  'later UPDATE, so no call can be stranded ACTIVE.';

create or replace function chat.enforce_call_participant_rules()
returns trigger
language plpgsql
as $$
declare
  v_type  text;
  v_kinds text[];
begin
  select type into v_type from chat.call where id = new.call_id;
  select array_agg(distinct actor_kind) into v_kinds
    from chat.call_participant where call_id = new.call_id;

  if v_type = 'direct'
     and v_kinds @> array['teacher']::text[]
     and v_kinds @> array['contact']::text[]
     and TG_OP = 'INSERT' then
    raise exception
      'BR-1 violation: a direct call may never pair a teacher with a family contact'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
