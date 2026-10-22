/**
 * PD-20 -- who may reset, suspend, reactivate or impersonate which account,
 * exercised directly on AuthorizationService.canAdministerAccount.
 *
 * Owner decision 2026-10-22: EVERY staff role, org-wide, for parent and
 * teacher accounts; a staff account only by the super admin; never the super
 * admin's account; never one's own; never a staff account impersonated. And
 * nobody who is not staff, whatever they send.
 *
 * Pure: no database, no clock.
 */
import { CommErrorCode } from '@platform/errors';
import { StaffRole } from '@communication/contracts/vocab';
import type { AccountAdminAct, AccountAdminTarget } from '@platform/authorization.service';
import { academicStaff, admin, authzWithOnDuty, financeStaff, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = parent().organizationId!;
const ACTS: AccountAdminAct[] = ['reset_password', 'suspend', 'reactivate', 'impersonate'];
const superAdmin = (id = 'super-1') => admin(id, StaffRole.SUPER_ADMIN);
const everyStaffRole = () => [
  admin(),
  admin('cov-1', 'coverage'),
  manager(),
  financeStaff(),
  admin('tech-1', 'technical'),
  academicStaff(),
  superAdmin(),
];

const familyAccount = (over: Partial<AccountAdminTarget> = {}): AccountAdminTarget => ({
  accountId: 'acct-family-1', organizationId: ORG, kind: 'family', ...over,
});
const teacherAccount = (over: Partial<AccountAdminTarget> = {}): AccountAdminTarget => ({
  accountId: 'acct-teacher-1', organizationId: ORG, kind: 'teacher', ...over,
});
const staffAccount = (over: Partial<AccountAdminTarget> = {}): AccountAdminTarget => ({
  accountId: 'acct-staff-1', organizationId: ORG, kind: 'staff', staffId: 'staff-9', staffRole: 'admin', ...over,
});

function refused(d: ReturnType<typeof authz.canAdministerAccount>, code: CommErrorCode) {
  expect(d.allowed).toBe(false);
  if (!d.allowed) expect(d.code).toBe(code);
}

describe('PD-20: parent and teacher accounts', () => {
  it('every staff role may do everything to a parent and a teacher account of its organization', () => {
    for (const actor of everyStaffRole()) {
      for (const target of [familyAccount(), teacherAccount()]) {
        for (const act of ACTS) {
          expect({ role: actor.staffRole, kind: target.kind, act, allowed: authz.canAdministerAccount(actor, target, act).allowed })
            .toEqual({ role: actor.staffRole, kind: target.kind, act, allowed: true });
        }
      }
    }
  });

  it('another organization\'s account is NOT FOUND, never forbidden -- for every role, the super admin included', () => {
    for (const actor of everyStaffRole()) {
      for (const act of ACTS) {
        refused(authz.canAdministerAccount(actor, familyAccount({ organizationId: 'org-elsewhere' }), act), CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      }
    }
  });

  it('a parent and a teacher may administer nobody -- not even another parent', () => {
    for (const actor of [parent(), teacher()]) {
      for (const act of ACTS) {
        refused(authz.canAdministerAccount(actor, familyAccount({ accountId: 'acct-other' }), act), CommErrorCode.ACCOUNT_ADMIN_DENIED);
        refused(authz.canAdministerAccount(actor, teacherAccount(), act), CommErrorCode.ACCOUNT_ADMIN_DENIED);
      }
    }
  });

  it('an inactive staff member may do nothing', () => {
    for (const act of ACTS) {
      refused(authz.canAdministerAccount({ ...superAdmin(), isActive: false }, familyAccount(), act), CommErrorCode.ACTOR_INACTIVE);
    }
  });

  it('staff without an organization cannot be scoped, so may do nothing', () => {
    for (const act of ACTS) {
      refused(authz.canAdministerAccount({ ...admin(), organizationId: undefined }, familyAccount(), act), CommErrorCode.ACCOUNT_ADMIN_DENIED);
    }
  });
});

describe('PD-20: staff accounts', () => {
  it('only the super admin resets, suspends or reactivates another staff member', () => {
    for (const act of ['reset_password', 'suspend', 'reactivate'] as const) {
      expect(authz.canAdministerAccount(superAdmin(), staffAccount(), act).allowed).toBe(true);
      expect(authz.canAdministerAccount(superAdmin(), staffAccount({ staffRole: 'manager' }), act).allowed).toBe(true);
      for (const actor of everyStaffRole().filter((a) => a.staffRole !== StaffRole.SUPER_ADMIN)) {
        refused(authz.canAdministerAccount(actor, staffAccount(), act), CommErrorCode.ACCOUNT_ADMIN_DENIED);
      }
    }
  });

  it('nobody acts on the super admin\'s account', () => {
    for (const actor of everyStaffRole()) {
      for (const act of ACTS) {
        refused(
          authz.canAdministerAccount(actor, staffAccount({ staffId: 'super-other', staffRole: StaffRole.SUPER_ADMIN }), act),
          CommErrorCode.ACCOUNT_ADMIN_DENIED,
        );
      }
    }
  });

  it('nobody acts on their own account -- the super admin included', () => {
    for (const actor of everyStaffRole()) {
      for (const act of ACTS) {
        refused(
          authz.canAdministerAccount(actor, staffAccount({ staffId: actor.actorId, staffRole: actor.staffRole }), act),
          CommErrorCode.ACCOUNT_ADMIN_DENIED,
        );
      }
    }
  });

  it('a staff account is never impersonated, not even by the super admin', () => {
    refused(authz.canAdministerAccount(superAdmin(), staffAccount(), 'impersonate'), CommErrorCode.ACCOUNT_ADMIN_DENIED);
  });

  it('an unknown account kind is refused', () => {
    for (const act of ACTS) {
      refused(authz.canAdministerAccount(superAdmin(), familyAccount({ kind: 'learner' }), act), CommErrorCode.ACCOUNT_ADMIN_DENIED);
    }
  });
});
