/**
 * The approved ownership / offboarding policy as the API states it
 * (AuthorizationService), mirroring the SQL enforcement in 20261014110000
 * (exercised against the database in ownership-functions-authorization.spec.ts).
 * Pure: no database.
 */
import { StaffRole } from '@communication/contracts/vocab';
import { academicStaff, admin, authzWithOnDuty, financeStaff, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = { organizationId: 'org-1' };
const superAdmin = () => admin('super-1', StaffRole.SUPER_ADMIN);
const coverage = () => admin('cov-1', StaffRole.COVERAGE);

describe('families.assign', () => {
  it('manager and super admin, same organization only', () => {
    expect(authz.canAssignFamilies(manager(), ORG).allowed).toBe(true);
    expect(authz.canAssignFamilies(superAdmin(), ORG).allowed).toBe(true);
    expect(authz.canAssignFamilies(manager(), { organizationId: 'org-2' }).allowed).toBe(false);
    for (const a of [admin(), coverage(), financeStaff(), academicStaff(), parent(), teacher(), { ...manager(), isActive: false }]) {
      expect(authz.canAssignFamilies(a, ORG).allowed).toBe(false);
    }
  });
});

describe('moving a staff member\'s families (offboarding, part 1)', () => {
  it('a manager moves an admin\'s families but not another manager\'s or the super admin\'s; the super admin moves anyone\'s', () => {
    expect(authz.canTransferStaffFamilies(manager(), { ...ORG, role: 'admin' }).allowed).toBe(true);
    expect(authz.canTransferStaffFamilies(manager(), { ...ORG, role: 'manager' }).allowed).toBe(false);
    expect(authz.canTransferStaffFamilies(manager(), { ...ORG, role: 'super_admin' }).allowed).toBe(false);
    expect(authz.canTransferStaffFamilies(superAdmin(), { ...ORG, role: 'manager' }).allowed).toBe(true);
    expect(authz.canTransferStaffFamilies(admin(), { ...ORG, role: 'admin' }).allowed).toBe(false);
  });
});

describe('deactivating a staff account', () => {
  it('only the super admin, never the super admin or themselves, never another tenant', () => {
    expect(authz.canDeactivateStaff(superAdmin(), { ...ORG, staffId: 'manager-1', role: 'manager' }).allowed).toBe(true);
    expect(authz.canDeactivateStaff(superAdmin(), { ...ORG, staffId: 'admin-1', role: 'admin' }).allowed).toBe(true);
    expect(authz.canDeactivateStaff(superAdmin(), { ...ORG, staffId: 'super-1', role: 'super_admin' }).allowed).toBe(false);
    expect(authz.canDeactivateStaff(superAdmin(), { organizationId: 'org-2', staffId: 'x', role: 'admin' }).allowed).toBe(false);
    for (const a of [manager(), admin(), coverage(), financeStaff(), academicStaff(), parent(), teacher()]) {
      expect(authz.canDeactivateStaff(a, { ...ORG, staffId: 'admin-9', role: 'admin' }).allowed).toBe(false);
    }
  });
});
