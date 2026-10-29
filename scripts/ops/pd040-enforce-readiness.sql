-- =============================================================================
-- PD-40 · enforce readiness: which staff would lose pages when PermissionGuard
-- moves from SHADOW to ENFORCE
--
-- READ-ONLY. Run by the operator against production (docs/admin/pd040-enforce-
-- readiness.md); no session connects to production. The transaction is read
-- only and ends in ROLLBACK; the query reads, never writes. It prints counts and
-- staff ids only -- never a name, an e-mail or any other personal field.
--
-- It reproduces how chat.staff_access_profile places an ACTIVE staff member
-- (is_active, no left_at): the department they run, else the one they belong
-- to; a placement that does not fit the tier counts as no department. Under
-- enforce only the legacy tiers change behaviour:
--
--   legacy_department  finance / technical / academic: an EMPTY bundle -- they
--                      keep only @SelfService routes
--   no placement       a manager or supervisor in no department: the small
--                      manager:none / supervisor:none bundle
--   does not fit       e.g. a manager listed as a member: also the :none bundle
--
-- The super admin (every key) and specialists (already enforced: their roles)
-- are listed as "not affected". The tier mapping is chat.staff_tier's; the
-- spec test/unit/ops/pd040-enforce-readiness.spec.ts keeps both in step with
-- legacy-bundles.ts and keeps this file SELECT-only.
--
--   section 'count'  one row per (organization, tier, department kind,
--                    position, verdict) with how many staff
--   section 'staff'  one row per at-risk staff member: their id, role and why
-- =============================================================================

begin transaction read only;

with active as (
  select s.id, s.organization_id, s.role,
         case s.role
           when 'super_admin' then 'super_admin'
           when 'manager'     then 'manager'
           when 'admin'       then 'supervisor'
           when 'coverage'    then 'supervisor'
           when 'finance'     then 'legacy_department'
           when 'technical'   then 'legacy_department'
           when 'academic'    then 'legacy_department'
           when 'specialist'  then 'specialist'
         end as tier
    from chat.staff s
   where s.is_active and s.left_at is null
),
placed as (
  select a.*,
         (select d.kind from chat.department d
           where d.manager_id = a.id and d.organization_id = a.organization_id
           limit 1) as runs_kind,
         (select d.kind from chat.department_member m
            join chat.department d on d.id = m.department_id
           where m.staff_id = a.id and d.organization_id = a.organization_id
           limit 1) as member_kind
    from active a
),
judged as (
  select p.id, p.organization_id, p.role, p.tier,
         coalesce(p.runs_kind, p.member_kind) as department_kind,
         case when p.runs_kind is not null then 'manager'
              when p.member_kind is not null then 'member' end as position,
         case
           when p.tier in ('super_admin', 'specialist') then 'not affected'
           when p.tier is null then 'unknown role: no bundle'
           when p.tier = 'legacy_department' then 'legacy_department: empty bundle'
           when p.runs_kind is null and p.member_kind is null then 'no placement: ' || p.tier || ':none bundle'
           when (p.tier = 'manager' and p.runs_kind is not null)
             or (p.tier = 'supervisor' and p.runs_kind is null and p.member_kind is not null) then 'fits'
           else 'placement does not fit the tier: ' || p.tier || ':none bundle'
         end as verdict
    from placed p
)
select 'count' as section, organization_id, tier, coalesce(department_kind, '-') as department_kind,
       coalesce(position, '-') as position, verdict, count(*)::int as staff, null::uuid as staff_id, null::text as role
  from judged
 group by organization_id, tier, department_kind, position, verdict
union all
select 'staff', organization_id, tier, coalesce(department_kind, '-'), coalesce(position, '-'), verdict, null, id, role
  from judged
 where verdict not in ('fits', 'not affected')
 order by section, organization_id, verdict, tier, department_kind, staff_id;

rollback;
