-- Jawwid Chat -- a call's type is immutable, closing the RT-024 calling bypass.
--
-- RT-024 was fixed for conversations by chat.enforce_conversation_type_immutable(),
-- but the identical bypass survived on chat.call:
--
--   chat.enforce_call_participant_rules() fires on chat.call_participant and
--   correctly refuses a DIRECT call that pairs a teacher with a family contact.
--   Nothing fired on chat.call itself, so a legitimate GROUP call inside a
--   Student Group -- which PRD v0.1 section 9 makes the official Teacher <->
--   Parent call channel -- could be promoted with:
--
--       UPDATE chat.call SET type = 'direct' WHERE id = ...;
--
--   leaving a direct teacher<->parent call: the exact state BR-1 forbids.
--
-- Verified before the fix: the promotion succeeded. Verified after: it is
-- refused. A group call and a 1:1 call authorise different people, so converting
-- between them after participants have joined can only ever launder a
-- prohibited pairing.

create or replace function chat.enforce_call_type_immutable()
returns trigger
language plpgsql
as $$
declare
  v_kinds text[];
begin
  if new.type is not distinct from old.type then
    return new;
  end if;

  if new.type = 'direct' then
    select array_agg(distinct actor_kind) into v_kinds
      from chat.call_participant
     where call_id = new.id;

    if v_kinds @> array['teacher']::text[] and v_kinds @> array['contact']::text[] then
      raise exception
        'BR-1 violation: a call joining a teacher and a family contact may not become a direct call'
        using errcode = 'check_violation';
    end if;
  end if;

  raise exception
    'chat.call.type is immutable: converting between a group call and a 1:1 call would rewrite who may speak'
    using errcode = 'restrict_violation';
end;
$$;

comment on function chat.enforce_call_type_immutable() is
  'BR-1 backstop for calling, mirroring chat.enforce_conversation_type_immutable(). '
  'Even a compromised API or a manual SQL session cannot launder a group call '
  'into a direct teacher<->parent call.';

create trigger call_type_immutable
  before update on chat.call
  for each row execute function chat.enforce_call_type_immutable();
