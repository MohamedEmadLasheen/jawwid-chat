/**
 * PD-40: the legacy bundles agree with the service rules they write down.
 *
 * For every key with a DB-free policy behind it, and for every kind of
 * existing staff account -- each role, in each department or in none, and
 * stale department rows -- the bundle holds the key EXACTLY when the policy
 * admits that account. Both directions matter:
 *   - a key the policy admits but the bundle lacks would refuse a legitimate
 *     request once PermissionGuard enforces;
 *   - a key the bundle holds but the policy refuses would let a manager
 *     delegate a right they do not have (PD-40 H5).
 * Keys with no such policy are WIDE (legacy-bundles.ts) and not delegable;
 * this spec pins that too, so a key cannot become delegable unverified.
 *
 * Pure: no database.
 */
import { StaffRole } from '@communication/contracts/vocab';
import { decideBillingAccess, decidePd012PageAccess, decidePd012StaffAccess, type OperationsDepartmentRole } from '@platform/pd012-policy';
import { decideTeacherFileAccess, teacherFilePageAccess } from '@platform/teacher-file-policy';
import { decidePageBasis } from '@platform/teacher-scope';
import { canGrantSubscriptionException } from '@platform/subscription-policy';
import { accountAdminActs } from '@platform/account-admin-policy';
import { StaffProfilePermission, profilePermissionsFor } from '@platform/staff-profile-policy';
import { PERMISSIONS, PERMISSION_KEYS } from '@platform/permissions/catalogue';
import {
  NO_PLACEMENT,
  legacyBundle,
  legacyTierOf,
  permissionsOf,
  type StaffPlacement,
} from '@platform/permissions/legacy-bundles';
import type { Actor } from '@platform/types';
import { admin, authzWithOnDuty, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();

interface Account {
  label: string;
  actor: Actor;
  placement: StaffPlacement;
}

const at = (kind: StaffPlacement['kind'], position: StaffPlacement['position']): StaffPlacement => ({ kind, position });
const staff = (role: string) => admin(`${role}-1`, role);

const ACCOUNTS: Account[] = [
  { label: 'super admin', actor: staff(StaffRole.SUPER_ADMIN), placement: NO_PLACEMENT },
  { label: 'Operations manager', actor: staff(StaffRole.MANAGER), placement: at('operations', 'manager') },
  { label: 'Teachers manager', actor: staff(StaffRole.MANAGER), placement: at('teachers', 'manager') },
  { label: 'Sales manager', actor: staff(StaffRole.MANAGER), placement: at('sales', 'manager') },
  { label: 'manager, no department', actor: staff(StaffRole.MANAGER), placement: NO_PLACEMENT },
  ...[StaffRole.ADMIN, StaffRole.COVERAGE].flatMap((role) => [
    { label: `${role} in Operations`, actor: staff(role), placement: at('operations', 'member') },
    { label: `${role} in Teachers`, actor: staff(role), placement: at('teachers', 'member') },
    { label: `${role} in Sales`, actor: staff(role), placement: at('sales', 'member') },
    { label: `${role}, no department`, actor: staff(role), placement: NO_PLACEMENT },
  ]),
  ...[StaffRole.FINANCE, StaffRole.TECHNICAL, StaffRole.ACADEMIC].map((role) => ({ label: role, actor: staff(role), placement: NO_PLACEMENT })),
  // Stale rows: the department tables' triggers forbid them, the bundle must not care.
  { label: 'manager listed as an Operations member', actor: staff(StaffRole.MANAGER), placement: at('operations', 'member') },
  { label: 'admin listed as the Teachers manager', actor: staff(StaffRole.ADMIN), placement: at('teachers', 'manager') },
];

type Rule = (a: Account) => boolean;

function rules(): Record<string, Rule> {
  const role = (a: Account, kind: string): OperationsDepartmentRole => (a.placement.kind === kind ? a.placement.position : null);
  const billing = (a: Account) => decideBillingAccess(a.actor, role(a, 'operations'), role(a, 'sales'));
  const pd012 = (a: Account) => decidePd012StaffAccess(a.actor, role(a, 'teachers'));
  const file = (a: Account) =>
    decideTeacherFileAccess(a.actor, { organizationId: a.actor.organizationId!, teachersDepartmentRole: role(a, 'teachers') });
  const standing = (a: Account) => ({ operations: role(a, 'operations'), teachers: role(a, 'teachers'), sales: role(a, 'sales') });
  const acts = (a: Account) => [
    ...accountAdminActs(a.actor, standing(a), 'family'),
    ...accountAdminActs(a.actor, standing(a), 'teacher'),
  ];
  const profile = (a: Account) => profilePermissionsFor(a.actor.staffRole);
  const supervises: Rule = (a) => pd012(a).canSupervise;
  const writesSupervision: Rule = (a) => file(a).canWriteSupervision;
  const readsMoney: Rule = (a) => billing(a).scope !== null;
  // PD-26 amendment: the Teacher Supervision page, Teachers department or Operations.
  const basis = (a: Account) => decidePageBasis(a.actor, role(a, 'teachers'), role(a, 'operations'));
  const onPage: Rule = (a) => decidePd012PageAccess(pd012(a), basis(a)).canSupervise;
  const recordsOnPage: Rule = (a) =>
    decidePd012PageAccess(pd012(a), basis(a)).canSupervise && teacherFilePageAccess(file(a), basis(a)).canWriteSupervision;
  return {
    'billing.view': readsMoney,
    'parents.view': readsMoney,
    'subscriptions.view': readsMoney,
    'billing.record': (a) => billing(a).canRecord,
    'billing.assign': (a) => billing(a).canAssign,
    'billing.verify': (a) => billing(a).canVerify,
    'parents.edit': (a) => billing(a).canEditParent,
    'subscriptions.manage': (a) => canGrantSubscriptionException(a.actor, role(a, 'operations'), role(a, 'sales')),
    'certificates.view': supervises,
    'certificates.design': supervises,
    'certificates.deliver': supervises,
    'teacher_supervision.view': onPage,
    'teacher_supervision.record': recordsOnPage,
    'supervision.chats': supervises,
    'leave.allowance': (a) => pd012(a).canSetAllowance,
    'teacher_files.view': (a) => file(a).canView,
    'teacher_files.edit': (a) => file(a).canEditPersonal,
    'teacher_files.supervise': writesSupervision,
    'teacher_files.evaluate': writesSupervision,
    'teacher_files.finance': (a) => file(a).canViewFinance,
    'accounts.administer': (a) => acts(a).length > 0,
    'accounts.support_session': (a) => acts(a).includes('impersonate'),
    'admin.inspect': (a) => authz.canInspectOrganization(a.actor).allowed,
    'chat.export': (a) => a.actor.staffRole === StaffRole.SUPER_ADMIN,
    'org.departments': (a) => authz.canManageDepartments(a.actor, { organizationId: a.actor.organizationId! }).allowed,
    'org.view': (a) => authz.canViewOrgStructure(a.actor).allowed,
    'staff_profiles.team': (a) => profile(a).has(StaffProfilePermission.TEAM_VIEW),
    'staff_profiles.organization': (a) => profile(a).has(StaffProfilePermission.ORG_VIEW),
    'staff_profiles.manage': (a) =>
      profile(a).has(StaffProfilePermission.TEAM_RESPONSIBILITIES_MANAGE) || profile(a).has(StaffProfilePermission.ORG_RESPONSIBILITIES_MANAGE),
    'staff_profiles.reporting_lines': (a) => profile(a).has(StaffProfilePermission.REPORTING_LINES_MANAGE),
  };
}

const RULES = rules();

describe('PD-40: legacy bundles agree with the service rules', () => {
  it('every verified key is a catalogue key', () => {
    expect(Object.keys(RULES).filter((k) => !PERMISSION_KEYS.has(k))).toEqual([]);
  });

  it.each(Object.keys(RULES))('%s: held exactly by the accounts its policy admits', (key) => {
    const rule = RULES[key]!;
    const got = ACCOUNTS.map((a) => ({ who: a.label, holds: legacyBundle(legacyTierOf(a.actor.staffRole), a.placement).has(key) }));
    const want = ACCOUNTS.map((a) => ({ who: a.label, holds: rule(a) }));
    expect(got).toEqual(want);
  });

  it('the super admin holds every key; finance, technical and academic hold none', () => {
    expect(legacyBundle('super_admin', NO_PLACEMENT)).toEqual(PERMISSION_KEYS);
    for (const role of [StaffRole.FINANCE, StaffRole.TECHNICAL, StaffRole.ACADEMIC]) {
      expect([...legacyBundle(legacyTierOf(role), NO_PLACEMENT)]).toEqual([]);
    }
  });

  it('a stale department row widens nothing', () => {
    expect(legacyBundle('manager', at('operations', 'member'))).toEqual(legacyBundle('manager', NO_PLACEMENT));
    expect(legacyBundle('supervisor', at('teachers', 'manager'))).toEqual(legacyBundle('supervisor', NO_PLACEMENT));
  });

  it('an unknown role holds nothing, and neither does anyone who is not live staff', () => {
    expect([...legacyBundle(legacyTierOf('specialist'), at('operations', 'member'))]).toEqual([]);
    for (const actor of [parent(), teacher(), { ...staff(StaffRole.SUPER_ADMIN), isActive: false }, { ...staff(StaffRole.MANAGER), organizationId: undefined }]) {
      expect([...permissionsOf(actor, at('operations', 'manager'))]).toEqual([]);
    }
  });

  it('no key is delegable yet: delegation (PD-40 PR-3) waits for every bundle to be verified', () => {
    expect(PERMISSIONS.filter((p) => p.delegable).map((p) => p.key)).toEqual([]);
  });
});
