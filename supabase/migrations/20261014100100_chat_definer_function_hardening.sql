-- =============================================================================
-- SECURITY DEFINER hardening, and the last six-argument log_event call
-- =============================================================================
--
-- Depends on 20261014090000 (trusted_staff_actor) and 20261014090100
-- (log_event returns bigint, five arguments). Forward-only.
--
-- 1. chat.recompute_family_state(p_family_id, p_at) -- SECURITY DEFINER with no
--    fixed search_path, executable by PUBLIC, with a caller-chosen p_at: any
--    role could rewrite chat.family_state_cache for any family as of any time.
--    chat.recompute_all_family_states (invoker) loops it over every family.
--    Frozen attention machinery (BOUNDARY §3); no code in apps/ calls either.
--    Now: search_path pinned, execution server-side only.
--
-- 2. chat.dispute_attention_order(p_family_id, p_staff_id, p_expected_rank,
--    p_note) -- invoker, PUBLIC-executable, logged the event as p_staff_id (a
--    caller-supplied actor) and called log_event with the pre-OD-01 six-argument
--    form, so it failed on every path. Same signature and return type (bigint,
--    the event id); now: the actor is chat.trusted_staff_actor(p_staff_id), it
--    must be active staff of the family's organization, the call uses the
--    five-argument form, and execution is server-side only.
--
-- 3. A catalog self-check over EVERY SECURITY DEFINER function in schema chat:
--    a pinned search_path, and request-role EXECUTE only for the allowlisted
--    session-identity and policy helpers (they answer "who am I / may I see
--    this" for RLS policies and must be callable by the policies' roles) and
--    post_customer_message (a contact's own post, identity from the session
--    account). A new definer function that is not allowlisted fails this
--    migration's successors' checks too: see
--    apps/api/test/integration/definer-function-audit.spec.ts.
-- =============================================================================

alter function chat.recompute_family_state(uuid, timestamptz) set search_path = chat, pg_temp;
revoke execute on function chat.recompute_family_state(uuid, timestamptz) from public, anon, authenticated, chat_app;
revoke execute on function chat.recompute_all_family_states(timestamptz)  from public, anon, authenticated, chat_app;

create or replace function chat.dispute_attention_order(
  p_family_id     uuid,
  p_staff_id      uuid,
  p_expected_rank integer,
  p_note          text default null
) returns bigint
language plpgsql
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_staff_id);
  v_org   uuid;
begin
  select organization_id into v_org from chat.family where id = p_family_id;
  if v_org is null then
    raise exception 'family % does not exist', p_family_id using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from chat.staff s
                  where s.id = v_actor and s.is_active and s.left_at is null
                    and s.organization_id = v_org) then
    raise exception 'only active staff of this organization may dispute the order'
      using errcode = 'insufficient_privilege';
  end if;

  return chat.log_event(
    'attention_order_disputed', p_family_id, 'staff', v_actor,
    jsonb_build_object(
      'expected_rank', p_expected_rank,
      'note', p_note,
      'scored', chat.attention_score(p_family_id, now(), v_actor),
      'bucket', chat.attention_bucket(p_family_id, now(), v_actor),
      'top_reason', chat.attention_top_reason(p_family_id, now(), v_actor),
      'signals', (select jsonb_agg(jsonb_build_object('signal', s.signal, 'points', s.points))
                  from chat.attention_signals(p_family_id, now(), v_actor) s)));
end;
$$;
revoke execute on function chat.dispute_attention_order(uuid, uuid, integer, text) from public, anon, authenticated, chat_app;

do $assert$
declare
  v_fn record;
  v_role text;
  v_allowed text[] := array[
    -- session identity / RLS policy helpers: read-only, about the caller
    'current_account_id', 'current_actor_ids', 'current_can_publish_story',
    'current_contact_family_ids', 'current_organization_id', 'current_staff_id',
    'current_staff_manages', 'current_staff_role', 'staff_can_see_family',
    'story_organization_id', 'teacher_parent_authorized',
    -- a contact posting as themselves (identity from the session account)
    'post_customer_message',
    -- trigger function: invoked by the table write, never called directly
    'enforce_story_view_audience'];
begin
  for v_fn in
    select p.oid, p.proname, p.proconfig
      from pg_proc p
     where p.pronamespace = 'chat'::regnamespace and p.prosecdef
  loop
    if not exists (select 1 from unnest(coalesce(v_fn.proconfig, '{}')) c where c like 'search_path=%') then
      raise exception 'SECURITY DEFINER chat.% has no fixed search_path', v_fn.proname;
    end if;
    if not (v_fn.proname = any (v_allowed)) then
      foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
        if has_function_privilege(v_role, v_fn.oid, 'EXECUTE') then
          raise exception 'SECURITY DEFINER chat.% is executable by %', v_fn.proname, v_role;
        end if;
      end loop;
    end if;
  end loop;
end
$assert$;
