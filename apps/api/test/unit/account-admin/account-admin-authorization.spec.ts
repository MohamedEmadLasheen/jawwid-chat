/**
 * PD-21 -- who may reset, suspend, reactivate, sign out or impersonate which
 * account, exercised directly on AuthorizationService.canAdministerAccount.
 *
 * Owner decision 2026-10-22, narrowed by PD-40 (2026-10-27): a PARENT account
 * by the super admin and the Operations department (Sales: reset and sign out
 * only); a TEACHER account by the super admin and the Teachers department; a
 * staff account only by the super admin; never the super admin's account;
 * never one's own; never a staff account impersonated. And nobody who is not
 * staff, whatever they send.
 *
 * Pure: no database, no clock.
 */
import { CommErrorCode } from '@platform/errors';
import { StaffRole } from '@communication/contracts/vocab';
import type { AccountAdminAct, AccountAdminStanding, AccountAdminTarget } from '@platform/authorization.service';
import { NO_ACCOUNT_ADMIN_STANDING, accountKindsAdministered } from '@platform/account-admin-policy';
import type { Actor } from '@platform/types';
import { academicStaff, admin, authzWithOnDuty, financeStaff, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const ORG = parent().organizationId!;
const ACTS: AccountAdminAct[] = ['reset_password', 'suspend', 'reactivate', 'impersonate', 'sign_out'];
const superAdmin = (id = 'super-1') => admin(id, StaffRole.SUPER_ADMIN);
const none = NO_ACCOUNT_ADMIN_STANDING;
const standing = (over: Partial<AccountAdminStanding>): AccountAdminStanding => ({ ...none, ...over });

type Who = { label: string; actor: Actor; standing: AccountAdminStanding };
const OPS_MANAGER: Who = { label: 'Operations manager', actor: manager('ops-mgr'), standing: standing({ operations: 'manager' }) };
const OPS_SUPERVISOR: Who = { label: 'Operations supervisor', actor: admin('ops-sup'), standing: standing({ operations: 'member' }) };
const OPS_COVERAGE: Who = { label: 'Operations coverage', actor: admin('ops-cov', 'coverage'), standing: standing({ operations: 'member' }) };
const TEACHERS_MANAGER: Who = { label: 'Teachers manager', actor: manager('tch-mgr'), standing: standing({ teachers: 'manager' }) };
const TEACHERS_SUPERVISOR: Who = { label: 'Teachers supervisor', actor: admin('tch-sup'), standing: standing({ teachers: 'member' }) };
const SALES_MANAGER: Who = { label: 'Sales manager', actor: manager('sales-mgr'), standing: standing({ sales: 'manager' }) };
const SALES_MEMBER: Who = { label: 'Sales member', actor: admin('sales-1'), standing: standing({ sales: 'member' }) };
const SUPER: Who = { label: 'super admin', actor: superAdmin(), standing: none };
/** Staff with no department that administers anyone: none of them administers a parent or a teacher. */
const OUTSIDERS: Who[] = [
  { label: 'admin, no department', actor: admin(), standing: none },
  { label: 'coverage, no department', actor: admin('cov-1', 'coverage'), standing: none },
  { label: 'manager, no department', actor: manager(), standing: none },
  { label: 'finance', actor: financeStaff(), standing: none },
  { label: 'technical', actor: admin('tech-1', 'technical'), standing: none },
  { label: 'academic', actor: academicStaff(), standing: none },
  // A stale department row never admits a role the department could not hold.
  { label: 'finance on a stale Operations row', actor: financeStaff('fin-2'), standing: standing({ operations: 'member' }) },
  { label: 'admin on a stale Operations manager row', actor: admin('adm-2'), standing: standing({ operations: 'manager' }) },
  { label: 'manager on a stale Teachers member row', actor: manager('mgr-2'), standing: standing({ teachers: 'member' }) },
];
const EVERYONE: Who[] = [SUPER, OPS_MANAGER, OPS_SUPERVISOR, OPS_COVERAGE, TEACHERS_MANAGER, TEACHERS_SUPERVISOR, SALES_MANAGER, SALES_MEMBER, ...OUTSIDERS];

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

/** What each caller may do, act by act: the whole PD-40 matrix in one table. */
function matrix(target: AccountAdminTarget) {
  return Object.fromEntries(
    EVERYONE.map((w) => [w.label, ACTS.filter((act) => authz.canAdministerAccount(w.actor, target, act, w.standing).allowed)]),
  );
}

describe('PD-21 / PD-40: parent and teacher accounts', () => {
  it('a parent account: the super admin and Operations do everything, Sales resets and signs out, nobody else anything', () => {
    const every = [...ACTS];
    expect(matrix(familyAccount())).toEqual({
      'super admin': every,
      'Operations manager': every,
      'Operations supervisor': every,
      'Operations coverage': every,
      'Teachers manager': [],
      'Teachers supervisor': [],
      'Sales manager': ['reset_password', 'sign_out'],
      'Sales member': ['reset_password', 'sign_out'],
      ...Object.fromEntries(OUTSIDERS.map((w) => [w.label, []])),
    });
  });

  it('a teacher account: the super admin and the Teachers department do everything, nobody else anything', () => {
    const every = [...ACTS];
    expect(matrix(teacherAccount())).toEqual({
      'super admin': every,
      'Operations manager': [],
      'Operations supervisor': [],
      'Operations coverage': [],
      'Teachers manager': every,
      'Teachers supervisor': every,
      'Sales manager': [],
      'Sales member': [],
      ...Object.fromEntries(OUTSIDERS.map((w) => [w.label, []])),
    });
  });

  it('a refusal for the wrong department says which department administers the account', () => {
    const d = authz.canAdministerAccount(TEACHERS_SUPERVISOR.actor, familyAccount(), 'impersonate', TEACHERS_SUPERVISOR.standing);
    refused(d, CommErrorCode.ACCOUNT_ADMIN_DENIED);
    if (!d.allowed) expect(d.reason).toMatch(/Operations department/);
    const t = authz.canAdministerAccount(OPS_MANAGER.actor, teacherAccount(), 'reset_password', OPS_MANAGER.standing);
    refused(t, CommErrorCode.ACCOUNT_ADMIN_DENIED);
    if (!t.allowed) expect(t.reason).toMatch(/Teachers department/);
  });

  it('the Accounts list shows each caller only the kinds it administers', () => {
    const kinds = (w: Who) => accountKindsAdministered(w.actor, w.standing);
    expect(kinds(SUPER)).toEqual(['family', 'teacher', 'staff']);
    expect(kinds(OPS_SUPERVISOR)).toEqual(['family']);
    expect(kinds(SALES_MEMBER)).toEqual(['family']);
    expect(kinds(TEACHERS_SUPERVISOR)).toEqual(['teacher']);
    expect(kinds({ ...OPS_MANAGER, standing: standing({ operations: 'manager', teachers: 'member' }) })).toEqual(['family']);
    for (const w of OUTSIDERS) expect({ who: w.label, kinds: kinds(w) }).toEqual({ who: w.label, kinds: [] });
    expect(kinds({ label: 'parent', actor: parent(), standing: standing({ operations: 'member' }) })).toEqual([]);
    expect(kinds({ ...SUPER, actor: { ...superAdmin(), isActive: false } })).toEqual([]);
  });

  it('another organization\'s account is NOT FOUND, never forbidden -- for every caller, the super admin included', () => {
    for (const w of EVERYONE) {
      for (const act of ACTS) {
        refused(authz.canAdministerAccount(w.actor, familyAccount({ organizationId: 'org-elsewhere' }), act, w.standing), CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      }
    }
  });

  it('a parent and a teacher may administer nobody -- not even another parent, whatever standing is claimed for them', () => {
    for (const actor of [parent(), teacher()]) {
      for (const act of ACTS) {
        const claimed = standing({ operations: 'manager', teachers: 'manager', sales: 'manager' });
        refused(authz.canAdministerAccount(actor, familyAccount({ accountId: 'acct-other' }), act, claimed), CommErrorCode.ACCOUNT_ADMIN_DENIED);
        refused(authz.canAdministerAccount(actor, teacherAccount(), act, claimed), CommErrorCode.ACCOUNT_ADMIN_DENIED);
      }
    }
  });

  it('an inactive staff member may do nothing', () => {
    for (const act of ACTS) {
      refused(authz.canAdministerAccount({ ...superAdmin(), isActive: false }, familyAccount(), act, none), CommErrorCode.ACTOR_INACTIVE);
      refused(authz.canAdministerAccount({ ...OPS_MANAGER.actor, isActive: false }, familyAccount(), act, OPS_MANAGER.standing), CommErrorCode.ACTOR_INACTIVE);
    }
  });

  it('staff without an organization cannot be scoped, so may do nothing', () => {
    for (const act of ACTS) {
      refused(authz.canAdministerAccount({ ...admin(), organizationId: undefined }, familyAccount(), act, OPS_SUPERVISOR.standing), CommErrorCode.ACCOUNT_ADMIN_DENIED);
    }
  });
});

describe('PD-21: staff accounts', () => {
  it('only the super admin resets, suspends, reactivates or signs out another staff member -- department standing changes nothing', () => {
    for (const act of ['reset_password', 'suspend', 'reactivate', 'sign_out'] as const) {
      expect(authz.canAdministerAccount(superAdmin(), staffAccount(), act, none).allowed).toBe(true);
      expect(authz.canAdministerAccount(superAdmin(), staffAccount({ staffRole: 'manager' }), act, none).allowed).toBe(true);
      for (const w of EVERYONE.filter((x) => x !== SUPER)) {
        refused(authz.canAdministerAccount(w.actor, staffAccount(), act, w.standing), CommErrorCode.ACCOUNT_ADMIN_DENIED);
      }
    }
  });

  it('nobody acts on the super admin\'s account', () => {
    for (const w of EVERYONE) {
      for (const act of ACTS) {
        refused(
          authz.canAdministerAccount(w.actor, staffAccount({ staffId: 'super-other', staffRole: StaffRole.SUPER_ADMIN }), act, w.standing),
          CommErrorCode.ACCOUNT_ADMIN_DENIED,
        );
      }
    }
  });

  it('nobody acts on their own account -- the super admin included', () => {
    for (const w of EVERYONE) {
      for (const act of ACTS) {
        refused(
          authz.canAdministerAccount(w.actor, staffAccount({ staffId: w.actor.actorId, staffRole: w.actor.staffRole }), act, w.standing),
          CommErrorCode.ACCOUNT_ADMIN_DENIED,
        );
      }
    }
  });

  it('a staff account is never impersonated, not even by the super admin', () => {
    refused(authz.canAdministerAccount(superAdmin(), staffAccount(), 'impersonate', none), CommErrorCode.ACCOUNT_ADMIN_DENIED);
  });

  it('an unknown account kind is refused', () => {
    for (const act of ACTS) {
      refused(authz.canAdministerAccount(superAdmin(), familyAccount({ kind: 'learner' }), act, none), CommErrorCode.ACCOUNT_ADMIN_DENIED);
    }
  });
});
