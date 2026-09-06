-- Jawwid Chat -- BR-1 hardening (closes RT-024 and RT-025).
--
-- The original backstops guarded the participant set of a DIRECT conversation.
-- Two bypasses survived, both confirmed by executable probes:
--
--   RT-024  A group CALL containing a teacher and a parent could be promoted to
--           type='direct' with one UPDATE. The conversation half of this was
--           closed by conversation_type_immutable; chat.call was not covered.
--
--   RT-025  BR-1 is "teacher and parent communicate only through the official
--           Student Group, WITH the required admin presence". Only the first
--           clause was enforced, so:
--             a) a class_group with {teacher, parent} was permitted, because the
--                trigger tested type = 'direct' only;
--             b) the last admin could be removed from a group, leaving a teacher
--                and a parent alone in what is then a private channel wearing a
--                group's name.
--
-- The rule enforced from here on, for every conversation type and every call:
--
--   If the live participants include BOTH a teacher and a family contact, then
--     * a direct conversation/call is refused outright, and
--     * any other kind must retain at least one live Jawwid admin.
--
-- Enforced on INSERT, UPDATE and DELETE, so departure is covered as well as
-- arrival: a control that only checks arrival is not a control.

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create or replace function chat.assert_conversation_br1(p_conversation_id uuid)
returns void
language plpgsql
as $$
declare
  v_type   text;
  v_kinds  text[];
  v_admins integer;
begin
  select type into v_type from chat.conversation where id = p_conversation_id;
  if v_type is null then
    return; -- conversation gone; cascade delete is in progress
  end if;

  select array_agg(distinct actor_kind),
         count(*) filter (where member_role = 'admin' and actor_kind = 'staff')
    into v_kinds, v_admins
    from chat.conversation_member
   where conversation_id = p_conversation_id
     and left_at is null;

  if v_kinds is null then
    return;
  end if;

  -- Not a mixed teacher/parent room: BR-1 has nothing to say.
  if not (v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[]) then
    return;
  end if;

  if v_type = 'direct' then
    raise exception
      'BR-1 violation: a direct conversation may never contain both a teacher and a family contact'
      using errcode = 'check_violation';
  end if;

  if v_admins = 0 then
    raise exception
      'BR-1 violation: a conversation containing a teacher and a family contact requires at least one Jawwid admin present'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function chat.enforce_conversation_member_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_conversation_br1(coalesce(new.conversation_id, old.conversation_id));

  -- A direct conversation is still limited to two live participants.
  if tg_op <> 'DELETE' then
    if (select type from chat.conversation where id = new.conversation_id) = 'direct'
       and (select count(*) from chat.conversation_member
             where conversation_id = new.conversation_id and left_at is null) > 2 then
      raise exception 'a direct conversation may not have more than two participants'
        using errcode = 'check_violation';
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists conversation_member_br1 on chat.conversation_member;
create trigger conversation_member_br1
  after insert or update or delete on chat.conversation_member
  for each row execute function chat.enforce_conversation_member_br1();

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------

create or replace function chat.assert_call_br1(p_call_id uuid)
returns void
language plpgsql
as $$
declare
  v_type  text;
  v_kinds text[];
  v_staff integer;
begin
  select type into v_type from chat.call where id = p_call_id;
  if v_type is null then
    return;
  end if;

  select array_agg(distinct actor_kind), count(*) filter (where actor_kind = 'staff')
    into v_kinds, v_staff
    from chat.call_participant
   where call_id = p_call_id
     and left_at is null;

  if v_kinds is null then
    return;
  end if;

  if not (v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[]) then
    return;
  end if;

  if v_type = 'direct' then
    raise exception
      'BR-1 violation: a direct call may never pair a teacher with a family contact'
      using errcode = 'check_violation';
  end if;

  if v_staff = 0 then
    raise exception
      'BR-1 violation: a call containing a teacher and a family contact requires Jawwid staff present'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function chat.enforce_call_participant_br1()
returns trigger
language plpgsql
as $$
begin
  perform chat.assert_call_br1(coalesce(new.call_id, old.call_id));
  return null;
end;
$$;

drop trigger if exists call_participant_br1 on chat.call_participant;
create trigger call_participant_br1
  after insert or update or delete on chat.call_participant
  for each row execute function chat.enforce_call_participant_br1();

-- RT-024. chat.call.type is fixed at creation, exactly as chat.conversation.type
-- is: promoting a group call to a 1:1 rewrites who is permitted to be in it.
create or replace function chat.enforce_call_type_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.type is distinct from old.type then
    raise exception
      'BR-1 violation: chat.call.type is immutable; a group call may not be promoted to a direct call'
      using errcode = 'check_violation';
  end if;
  if new.conversation_id is distinct from old.conversation_id then
    raise exception 'chat.call.conversation_id is immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists call_type_immutable on chat.call;
create trigger call_type_immutable
  before update on chat.call
  for each row execute function chat.enforce_call_type_immutable();
