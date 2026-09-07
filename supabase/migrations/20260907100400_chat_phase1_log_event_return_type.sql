-- Jawwid Chat -- chat.log_event() returns the type its own table uses.
--
-- THE DEFECT
--   20260905094000 redefined chat.log_event() to `returns uuid` and assigns
--   `insert ... returning id into v_id` where v_id is declared uuid. But
--   chat.event_log.id is a BIGINT identity column (20260905090500). Every call
--   therefore failed at runtime with
--
--     invalid input syntax for type uuid: "2"
--
--   -- the sequence value, being coerced into a uuid.
--
-- WHY IT WAS INVISIBLE
--   Nothing in the application called it. The API writes chat.event_log through
--   Prisma, and the SQL functions that call log_event() (transfer_ownership,
--   offboard_staff, post_customer_message, assign_family_owner) had no test
--   that executed them end to end. Phase 1's chat.assign_family_supervisor()
--   is the first path exercised by an automated test that reaches it, which is
--   how it surfaced.
--
-- Every caller uses `perform`, so no caller reads the return value and the
-- change is safe. The function must be DROPPED first: PostgreSQL will not
-- replace a function with a different return type.

drop function if exists chat.log_event(text, uuid, text, uuid, jsonb);

create or replace function chat.log_event(
  p_type       text,
  p_family_id  uuid default null,
  p_actor_type text default 'system',
  p_actor_id   uuid default null,
  p_payload    jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_id bigint;
begin
  insert into chat.event_log (family_id, actor_type, actor_id, type, payload)
  values (p_family_id, p_actor_type, p_actor_id, p_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function chat.log_event is
  'Appends to chat.event_log and returns the row id. The id is a bigint '
  'identity, and this signature says so -- it previously claimed uuid, which '
  'made every call fail.';
