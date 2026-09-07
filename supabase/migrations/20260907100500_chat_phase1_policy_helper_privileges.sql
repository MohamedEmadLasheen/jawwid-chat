-- Jawwid Chat -- the policy helpers run as their owner, and stay that way.
--
-- WHY THIS EXISTS TWICE
--   20260905091300 elevated five helpers to SECURITY DEFINER so RLS policies do
--   not recurse through the tables the helpers read. Phase 1 redefined two of
--   them (chat.current_account_id, chat.staff_can_see_family) with CREATE OR
--   REPLACE -- which resets every attribute the new definition does not state.
--   The elevation was silently dropped, and the first symptom was
--
--     ERROR: permission denied for table account
--
--   on an ordinary SELECT, because a policy could no longer resolve who was
--   calling. That is a fail-closed direction, but it is still an outage, and
--   nothing would have caught it before deployment.
--
-- The remedy is this migration plus the assertion in
-- db/tests/schema_acceptance.sql: elevation is re-applied from ONE list, and
-- the acceptance gate fails if any helper on it loses the attribute again.
--
-- SAFETY. Every function here answers a boolean or a set of ids about THE
-- CALLER, derived from the caller's own session settings. None takes a
-- caller-supplied filter that could be widened, and none returns a row of
-- customer data. Elevating them exposes nothing the caller could not already
-- establish about themselves.

do $$
declare
  r record;
  helpers text[] := array[
    -- identity resolution (chat.account has no policy at all, by design)
    'current_account_id', 'current_actor_ids',
    -- staff role and reach
    'current_staff_id', 'current_staff_role', 'is_manager',
    'staff_is_family_facing', 'staff_is_organization_wide',
    -- scope
    'staff_family_ids', 'staff_in_scope', 'staff_can_see_family',
    'teacher_family_ids', 'current_family_ids', 'current_contact_family_ids',
    -- conversation visibility (recurses through chat.conversation's own policy)
    'is_live_member', 'can_read_conversation',
    -- permissions
    'account_role', 'account_has_permission', 'current_has_permission'
  ];
begin
  for r in
    select p.oid::regprocedure as signature, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'chat'
       and p.proname = any (helpers)
  loop
    execute format('alter function %s security definer', r.signature);
    execute format('alter function %s set search_path = chat, pg_temp', r.signature);
  end loop;
end;
$$;

comment on function chat.can_read_conversation(uuid) is
  'The database half of AuthorizationService.canRead, and the predicate every '
  'communication policy is written against. SECURITY DEFINER because it reads '
  'chat.conversation, whose own policy calls it.';
