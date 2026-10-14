-- =============================================================================
-- chat.staff: the request role may no longer write role, status or identity
-- =============================================================================
--
-- THE DEFECT (pre-existing since 20260905091200_chat_rls.sql)
--   `grant update on chat.staff to authenticated` is a TABLE-level grant: every
--   column. Policy `staff_managed_by_manager` is a ROW filter only:
--       using / with check (chat.is_manager() or id = chat.current_staff_id())
--   Together they let any staff member, connected as chat_app (a member of
--   authenticated), run
--       update chat.staff set role = 'manager' where id = chat.current_staff_id();
--   and then, as a "manager", change any other staff member's role, status or
--   login binding. Reproduced 2026-10-13 on an isolated database (rolled back):
--   admin -> manager succeeded and manager-only audit-log reads opened at once.
--   The escalation is DURABLE: IdentityService re-reads chat.staff.role on every
--   authenticated request, so the application would honour it afterwards.
--   (super_admin was already refused by chat.guard_super_admin_grant.)
--
-- WHY IT WAS NOT REACHABLE THROUGH THE APPLICATION
--   The API connects as the table owner (RLS-STRATEGY §7 has not been engaged)
--   and no HTTP route writes chat.staff.role. That is why this is a
--   database-layer fix and not an API change: it must hold BEFORE the API moves
--   to chat_app, and for anyone else who can run SQL as that role.
--
-- THE RULE APPLIED
--   AUTHORIZATION-MODEL §3: role, status and account changes are user
--   management (`users.manage`), which only the super admin holds -- and the
--   super admin acts through server-side paths (the API's owner connection, the
--   bootstrap CLI), never as `authenticated`. So the request role keeps exactly
--   the operational self-state it can legitimately touch, and nothing else:
--       presence, last_activity_at
--   Every other column -- role, is_active, left_at, account_id,
--   organization_id, name, capacity_override, avatar_object_key, timestamps --
--   is no longer updatable by authenticated or chat_app.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   * No policy is edited or dropped. `staff_managed_by_manager` still decides
--     WHICH ROWS may be updated; this decides WHICH COLUMNS. Both now apply.
--   * The owner, service_role and chat_service privileges are untouched; the API
--     (owner) and the bootstrap CLI keep working exactly as before.
--   * chat.offboard_staff() and chat.link_staff_account() are SECURITY INVOKER
--     and write is_active / left_at / account_id as the caller. Called as
--     chat_app they are now refused at that UPDATE -- intentionally: both trust
--     a caller-supplied actor or target and must run on a server-side path.
--     No code in apps/ calls either today.
--
-- COMPATIBILITY
--   Forward-only, privilege-only: no DDL on the table, no data touched. Safe on
--   any history that contains 20260905091200 (where the grant was made);
--   independent of 20261013120000 and 20261013150000, and of feat/account-avatar
--   (which grants chat_app SELECT only on chat.staff).
--
-- ROLLBACK
--   Do NOT restore `grant update on chat.staff to authenticated`: that restores
--   the escalation. If a request-path write is ever needed, grant that ONE
--   column, and add a policy narrow enough for it (e.g. avatar_object_key for
--   id = chat.current_staff_id() only).
-- =============================================================================

-- 1. Remove the table-level grant (this alone does not remove column grants).
revoke update on chat.staff from authenticated;
revoke update on chat.staff from chat_app;
revoke update on chat.staff from public;

-- 2. Remove any column-level UPDATE grant on every current column, whatever
--    history produced it, for the three request-side grantees.
do $revoke$
declare
  v_col text;
begin
  for v_col in
    select attname from pg_attribute
     where attrelid = 'chat.staff'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke update (%I) on chat.staff from authenticated, chat_app, public', v_col);
  end loop;
end
$revoke$;

-- 3. Grant back only the operational self-state.
grant update (presence, last_activity_at) on chat.staff to authenticated;

-- 4. Prove it, inside the migration: if any membership chain or stray grant
--    still lets the request role write a protected column, the migration fails
--    and is not recorded as applied.
do $assert$
declare
  v_role text;
  v_col  text;
begin
  foreach v_role in array array['authenticated', 'chat_app'] loop
    for v_col in
      select attname from pg_attribute
       where attrelid = 'chat.staff'::regclass and attnum > 0 and not attisdropped
         and attname not in ('presence', 'last_activity_at')
    loop
      if has_column_privilege(v_role, 'chat.staff', v_col, 'UPDATE') then
        raise exception '% can still update chat.staff.%', v_role, v_col;
      end if;
    end loop;
    if not has_column_privilege(v_role, 'chat.staff', 'presence', 'UPDATE') then
      raise exception '% lost update on chat.staff.presence', v_role;
    end if;
  end loop;
end
$assert$;

