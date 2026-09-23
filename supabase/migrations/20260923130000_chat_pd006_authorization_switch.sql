-- Jawwid Chat -- PD-6: redirect the BR-1 database backstops onto the
-- relationship predicate.
--
-- WHAT CHANGES
-- ------------
-- Exactly one rule: "a direct conversation or call may never pair a teacher
-- with a family contact" becomes "...may pair them only where
-- chat.teacher_parent_authorized() says the relationship exists".
--
-- WHAT DOES NOT CHANGE, and is deliberately re-stated in every function below
-- so a future edit cannot drop it by accident:
--   * required Jawwid admin/staff presence in a teacher+contact GROUP (C-4,
--     red-team RT-025) -- every group type, not only student_group;
--   * the two-participant ceiling on direct conversations and direct calls;
--   * `type` immutability on chat.conversation and chat.call (RT-024) -- those
--     triggers are not touched by this migration at all;
--   * tenant isolation, which the predicate itself carries;
--   * every unrelated rule: contact/contact, teacher/teacher, staff/staff,
--     archived conversations, approvals, handler routing, PD-2. None of them
--     lives here and none of them is read or written by this file.
--
-- THE BACKSTOP IS NOT REMOVED. It is repointed. An unauthorized teacher/parent
-- direct channel is still refused by the database with the application
-- bypassed entirely, which is the property red-team findings RT-024 and RT-025
-- bought and which PD-6 explicitly preserves.
--
-- WHY THE RELATIONSHIP IS CHECKED ON CREATION, NOT ON EVERY WRITE
-- ---------------------------------------------------------------
-- This is the subtle part, and getting it wrong breaks the product in two
-- opposite ways.
--
-- These are AFTER ... FOR EACH ROW constraint triggers on the conversation, its
-- members, the call and its participants. chat.conversation is UPDATEd on every
-- single message (touch_conversation_from_message keeps last_activity_at), and
-- chat.call is UPDATEd when a call ends. If the relationship were re-asserted
-- on those updates, then the moment a learner was reassigned:
--
--   * every existing message in that conversation would fail to save, because
--     touching the conversation row would raise; and
--   * an in-progress call could never be ended, because writing ended_at would
--     raise -- leaving the call permanently ACTIVE, which is precisely the
--     "stuck call" failure the calling work exists to prevent.
--
-- Revoking a relationship must stop NEW communication. It must not corrupt the
-- record of old communication, and PD-6 says so: "Do not delete historical data
-- when authorization is revoked."
--
-- So the database enforces the relationship where a pairing is CREATED or
-- REVIVED -- an inserted member or participant, an inserted conversation or
-- call, or a member resurrected by clearing left_at. Continuous enforcement is
-- the application's job and is done where it belongs: canSend re-resolves the
-- relationship on every message, and CallService re-resolves it on every media
-- token, so a revoked relationship refuses the next send and the next token
-- even mid-call.
--
-- Both halves are required. Neither replaces the other.

-- ---------------------------------------------------------------------------
-- 1. Conversations
-- ---------------------------------------------------------------------------

drop function if exists chat.assert_conversation_br1(uuid);

create or replace function chat.assert_conversation_br1(
  p_conversation_id uuid,
  -- False when the triggering write could not have created or revived the
  -- pairing. The structural rules below always run; only the relationship
  -- check is conditional. See the header for why.
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
  v_teachers    integer;
  v_contacts    integer;
  v_teacher_id  uuid;
  v_contact_id  uuid;
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
    count(*),
    count(*) filter (where actor_kind = 'teacher'),
    count(*) filter (where actor_kind = 'contact')
  into v_has_teacher, v_has_contact, v_admins, v_live, v_teachers, v_contacts
  from chat.conversation_member
  where conversation_id = p_conversation_id
    and left_at is null;

  if v_has_teacher and v_has_contact then
    if v_type = 'direct' then
      -- PD-6. The pairing is permitted for an authorized relationship and for
      -- nothing else.
      if p_check_relationship then
        -- A direct conversation holds at most two live members (enforced
        -- below), so anything other than exactly one of each is malformed and
        -- is refused rather than guessed at.
        if v_teachers <> 1 or v_contacts <> 1 then
          raise exception
            'conversation % is a direct teacher/parent channel with % teacher(s) and % contact(s); exactly one of each is required',
            p_conversation_id, v_teachers, v_contacts
            using errcode = 'check_violation';
        end if;

        select actor_id into v_teacher_id
          from chat.conversation_member
         where conversation_id = p_conversation_id and left_at is null
           and actor_kind = 'teacher';
        select actor_id into v_contact_id
          from chat.conversation_member
         where conversation_id = p_conversation_id and left_at is null
           and actor_kind = 'contact';

        if not chat.teacher_parent_authorized(v_teacher_id, v_contact_id) then
          raise exception
            'PD-6 violation: conversation % pairs teacher % with contact % and no authorized relationship exists between them',
            p_conversation_id, v_teacher_id, v_contact_id
            using errcode = 'check_violation',
                  hint = 'A teacher and a parent may hold a direct conversation only when a learner in that family is assigned to that teacher, both are active, and both belong to the same organization.';
        end if;
      end if;
    else
      -- C-4 / RT-025, UNCHANGED. A teacher+contact GROUP -- of any type --
      -- must retain a live Jawwid admin member. PD-6 did not touch this: the
      -- group is still a supervised channel, and a group without an admin is
      -- still a private teacher<->parent channel wearing a group's name.
      --
      -- Note this is now an ELSE branch rather than an unconditional check.
      -- It has exactly the same effect: the old code reached it only when the
      -- `direct` branch had not already raised.
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
  'BR-1 for conversations, as re-versioned by PD-6: a direct teacher/parent '
  'channel requires an authorized relationship; a teacher/parent GROUP still '
  'requires a live Jawwid admin (C-4, RT-025). Called by deferred constraint '
  'triggers on BOTH chat.conversation and chat.conversation_member, so the '
  'invariant cannot be reached from either side. Closes RT-024 and RT-025. '
  'p_check_relationship is false for writes that cannot create or revive a '
  'pairing, so revoking a relationship stops new communication without making '
  'the existing record unwritable.';

-- Member-side trigger. An INSERT creates a pairing; clearing left_at revives
-- one. A DELETE or a left_at being SET can only dissolve a pairing, so neither
-- needs the relationship check -- and running it there would make removing a
-- member from a revoked channel impossible.
create or replace function chat.tg_conversation_br1()
returns trigger
language plpgsql
as $$
declare
  v_creates boolean;
begin
  v_creates :=
    TG_OP = 'INSERT'
    or (TG_OP = 'UPDATE' and old.left_at is not null and new.left_at is null);

  perform chat.assert_conversation_br1(
    coalesce(new.conversation_id, old.conversation_id),
    v_creates
  );
  return null;
end;
$$;

-- Conversation-row trigger. Only an INSERT can create a pairing here: `type` is
-- immutable (RT-024), so an existing conversation cannot become a direct
-- teacher/parent channel by UPDATE.
create or replace function chat.tg_conversation_row_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_conversation_br1(new.id, TG_OP = 'INSERT');
  return null;
end;
$$;

-- The fast immediate check, which fails the creation case before commit with a
-- clearer error. Same rule, same creation-scoping.
create or replace function chat.enforce_direct_conversation_rules()
returns trigger
language plpgsql
as $$
declare
  v_type       text;
  v_kinds      text[];
  v_live       integer;
  v_teacher_id uuid;
  v_contact_id uuid;
  v_creates    boolean;
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
      select actor_id into v_teacher_id
        from chat.conversation_member
       where conversation_id = new.conversation_id and left_at is null
         and actor_kind = 'teacher'
       limit 1;
      select actor_id into v_contact_id
        from chat.conversation_member
       where conversation_id = new.conversation_id and left_at is null
         and actor_kind = 'contact'
       limit 1;

      if not chat.teacher_parent_authorized(v_teacher_id, v_contact_id) then
        raise exception
          'PD-6 violation: a direct conversation may pair a teacher with a family contact only when an authorized relationship exists'
          using errcode = 'check_violation';
      end if;
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
  'PD-6 backstop, immediate. Even a compromised API or a manual SQL session '
  'cannot create an UNAUTHORIZED teacher<->parent 1:1 channel.';

-- ---------------------------------------------------------------------------
-- 2. Calls
-- ---------------------------------------------------------------------------

drop function if exists chat.assert_call_br1(uuid);

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
  v_teachers    integer;
  v_contacts    integer;
  v_teacher_id  uuid;
  v_contact_id  uuid;
begin
  select type into v_type from chat.call where id = p_call_id;
  if not found then
    return;
  end if;

  -- left_at is deliberately NOT filtered, exactly as before. A participant who
  -- joined and left was still paired on that call; this is about who was
  -- connected, not who is connected now. It also means an admin whose
  -- connection drops mid-call cannot retroactively invalidate a call that was
  -- authorized when it began.
  select
    count(*) filter (where actor_kind = 'teacher') > 0,
    count(*) filter (where actor_kind = 'contact') > 0,
    count(*) filter (where actor_kind = 'staff') > 0,
    count(*),
    count(*) filter (where actor_kind = 'teacher'),
    count(*) filter (where actor_kind = 'contact')
  into v_has_teacher, v_has_contact, v_has_staff, v_total, v_teachers, v_contacts
  from chat.call_participant
  where call_id = p_call_id;

  if v_has_teacher and v_has_contact then
    if v_type = 'direct' then
      -- PD-6.
      if p_check_relationship then
        if v_teachers <> 1 or v_contacts <> 1 then
          raise exception
            'call % is a direct teacher/parent call with % teacher(s) and % contact(s); exactly one of each is required',
            p_call_id, v_teachers, v_contacts
            using errcode = 'check_violation';
        end if;

        select actor_id into v_teacher_id
          from chat.call_participant where call_id = p_call_id and actor_kind = 'teacher';
        select actor_id into v_contact_id
          from chat.call_participant where call_id = p_call_id and actor_kind = 'contact';

        if not chat.teacher_parent_authorized(v_teacher_id, v_contact_id) then
          raise exception
            'PD-6 violation: call % pairs teacher % with contact % and no authorized relationship exists between them',
            p_call_id, v_teacher_id, v_contact_id
            using errcode = 'check_violation',
                  hint = 'A teacher and a parent may share a direct call only when a learner in that family is assigned to that teacher, both are active, and both belong to the same organization.';
        end if;
      end if;
    else
      -- C-4, UNCHANGED. A teacher+contact GROUP call still requires a Jawwid
      -- staff participant. Calling is never more permissive than messaging.
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
  'BR-1 for calls, as re-versioned by PD-6. Calling is never more permissive '
  'than messaging: a direct teacher/parent call requires an authorized '
  'relationship, and a teacher/parent GROUP call still requires a Jawwid staff '
  'participant (C-4). Called by deferred constraint triggers on BOTH chat.call '
  'and chat.call_participant. The relationship is checked when the pairing is '
  'created, never on a later UPDATE -- so ending a call always succeeds and no '
  'call can be stranded ACTIVE by a relationship that changed mid-call.';

create or replace function chat.tg_call_br1()
returns trigger
language plpgsql
as $$
begin
  -- A participant row is inserted once. Its later updates record join/leave
  -- times and cannot create a pairing that did not already exist.
  perform chat.assert_call_br1(
    coalesce(new.call_id, old.call_id),
    TG_OP = 'INSERT'
  );
  return null;
end;
$$;

create or replace function chat.tg_call_row_br1()
returns trigger
language plpgsql
as $$
begin
  -- `type` is immutable (RT-024), so only an INSERT can create a direct
  -- teacher/parent call. UPDATEs here are status, answered_at, ended_at,
  -- duration -- the lifecycle -- and must never be blocked by a relationship
  -- that changed while the call was ringing.
  perform chat.assert_call_br1(new.id, TG_OP = 'INSERT');
  return null;
end;
$$;

create or replace function chat.enforce_call_participant_rules()
returns trigger
language plpgsql
as $$
declare
  v_type       text;
  v_kinds      text[];
  v_teacher_id uuid;
  v_contact_id uuid;
begin
  select type into v_type from chat.call where id = new.call_id;

  select array_agg(distinct actor_kind) into v_kinds
    from chat.call_participant where call_id = new.call_id;

  if v_type = 'direct'
     and v_kinds @> array['teacher']::text[]
     and v_kinds @> array['contact']::text[]
     and TG_OP = 'INSERT' then
    select actor_id into v_teacher_id
      from chat.call_participant where call_id = new.call_id and actor_kind = 'teacher' limit 1;
    select actor_id into v_contact_id
      from chat.call_participant where call_id = new.call_id and actor_kind = 'contact' limit 1;

    if not chat.teacher_parent_authorized(v_teacher_id, v_contact_id) then
      raise exception
        'PD-6 violation: a direct call may pair a teacher with a family contact only when an authorized relationship exists'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The triggers themselves are NOT recreated
-- ---------------------------------------------------------------------------
--
-- All six keep their names, their tables, their timing and their DEFERRABLE
-- INITIALLY DEFERRED status:
--
--   conversation_member_br1            conversation_member  (immediate)
--   conversation_member_br1_deferred   conversation_member  (deferred)
--   conversation_br1_row               conversation         (deferred)
--   call_participant_br1               call_participant     (immediate)
--   call_participant_br1_deferred      call_participant     (deferred)
--   call_br1_row                       call                 (deferred)
--
-- plus conversation_type_immutable and call_type_immutable, which this
-- migration does not mention because RT-024 is not affected by PD-6.
--
-- Only the function bodies changed, so db/tests/schema_acceptance.sql's
-- want_trigger() assertions continue to hold unchanged -- which is the point:
-- a migration that had to relax an acceptance test to land would be a
-- migration that removed a control.
