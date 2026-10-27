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

describe('PD-40: no "any manager" family-assignment rule is left in the API', () => {
  it('the uncalled canAssignFamilies / canTransferStaffFamilies are gone (canAssignSupervision decides)', () => {
    const surface = authz as unknown as Record<string, unknown>;
    expect(surface.canAssignFamilies).toBeUndefined();
    expect(surface.canTransferStaffFamilies).toBeUndefined();
    expect(typeof surface.canAssignSupervision).toBe('function');
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
