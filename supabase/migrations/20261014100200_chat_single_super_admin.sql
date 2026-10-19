-- =============================================================================
-- At most one super_admin per organization, at the database
-- =============================================================================
--
-- Depends on 20261013120000 (the super_admin role). If that migration is absent
-- there is no super_admin to constrain and this is a no-op.
--
-- THE RULE, from existing evidence (not a new decision):
--   * AUTHORIZATION-MODEL §2: super_admin is "Organization owner" -- one owner.
--   * The bootstrap procedure (apps/api/src/cli/super-admin-bootstrap.ts)
--     refuses with ANOTHER_SUPER_ADMIN whenever ANY other staff row in the
--     organization holds super_admin -- active or not -- and "never hands the
--     role to a second account".
--   The application enforced it; nothing at the database did. This index says
--   exactly what the CLI already says: at most one super_admin row per
--   organization. It does NOT require one (an organization is never locked out
--   by this index), and it changes nothing about who may grant the role
--   (chat.guard_super_admin_grant still does that).
--
-- PRECONDITION: an organization that already has two super_admin rows is a
-- state the CLI cannot produce; the migration refuses rather than choose which
-- row to keep, and names the organization.
-- =============================================================================

do $one$
declare
  v_org uuid;
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'chat.staff'::regclass and conname = 'staff_role_check'
       and pg_get_constraintdef(oid) like '%super_admin%'
  ) then
    return;
  end if;

  select organization_id into v_org
    from chat.staff where role = 'super_admin'
   group by organization_id having count(*) > 1
   limit 1;
  if v_org is not null then
    raise exception 'organization % has more than one super_admin row; resolve it by hand before this migration', v_org
      using errcode = 'unique_violation';
  end if;

  execute 'create unique index if not exists staff_one_super_admin_per_organization
             on chat.staff (organization_id) where role = ''super_admin''';
end
$one$;
