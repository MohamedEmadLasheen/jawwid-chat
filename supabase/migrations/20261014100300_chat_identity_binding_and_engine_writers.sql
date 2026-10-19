-- =============================================================================
-- Principal bindings and engine writers are server-side only
-- =============================================================================
--
-- Depends on 20261014100000 (chat.narrow_column_grant). Forward-only;
-- privileges only.
--
-- 1. chat.contact.account_id -- which login a family contact IS.
--    authenticated held INSERT and UPDATE on every contact column and policy
--    contact_edited_by_admins admits any family-facing staff. Verified
--    2026-10-14 as chat_app (rolled back): an admin re-bound a contact of
--    another supervisor's family to a different login -- that login would then
--    resolve to this contact and read this family. chat.staff.account_id was
--    closed by 20261013160000; this is the same binding for contacts. The only
--    writers are provisioning / ingestion (chat.link_contact_account), server
--    side; no API code writes it. Every other contact column keeps its access.
--
-- 2. Writers that take a staff or principal id from the caller:
--      chat.extend_stickiness(p_conversation_id, p_staff_id)
--        -- sets a conversation's sticky handler to the given staff member
--           (coverage engine, frozen; would be live under chat_app the moment
--           the request role gets UPDATE on chat.conversation)
--      chat.link_staff_account(p_staff_id, p_subject)
--      chat.link_contact_account(p_contact_id, p_subject)
--        -- bind a principal to a login (provisioning / ingestion)
--    All SECURITY INVOKER and PUBLIC-executable. No code in apps/ calls them.
--    Execution is revoked from PUBLIC, anon, authenticated and chat_app; the
--    owner / service path is unchanged.
-- =============================================================================

do $contact$
declare
  v_keep text[];
begin
  select array_agg(attname::text) into v_keep from pg_attribute
   where attrelid = 'chat.contact'::regclass and attnum > 0 and not attisdropped and attname <> 'account_id';
  if has_table_privilege('authenticated', 'chat.contact', 'UPDATE') then
    perform chat.narrow_column_grant('chat.contact', 'update', 'authenticated', v_keep);
  end if;
  if has_table_privilege('authenticated', 'chat.contact', 'INSERT') then
    perform chat.narrow_column_grant('chat.contact', 'insert', 'authenticated', v_keep);
  end if;
  revoke update (account_id), insert (account_id) on chat.contact from authenticated, chat_app, public;
end
$contact$;

revoke execute on function chat.extend_stickiness(uuid, uuid)   from public, anon, authenticated, chat_app;
revoke execute on function chat.link_staff_account(uuid, text)  from public, anon, authenticated, chat_app;
revoke execute on function chat.link_contact_account(uuid, text) from public, anon, authenticated, chat_app;

do $assert$
declare
  v_role text;
  v_fn   record;
begin
  foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
    if has_column_privilege(v_role, 'chat.contact', 'account_id', 'UPDATE')
       or has_column_privilege(v_role, 'chat.contact', 'account_id', 'INSERT') then
      raise exception '% can still write chat.contact.account_id', v_role;
    end if;
    -- No function a request role can execute both WRITES and takes a staff,
    -- actor or principal id from the caller.
    for v_fn in
      select p.oid, p.proname from pg_proc p
       where p.pronamespace = 'chat'::regnamespace
         and pg_get_function_identity_arguments(p.oid) ~ '(p_actor_id|p_staff_id|p_contact_id)'
         and p.prosrc ~* '(insert\s+into|update\s+chat\.|delete\s+from)'
    loop
      if has_function_privilege(v_role, v_fn.oid, 'EXECUTE') then
        raise exception '% can execute chat.%, which writes on behalf of a caller-named principal', v_role, v_fn.proname;
      end if;
    end loop;
  end loop;
end
$assert$;
