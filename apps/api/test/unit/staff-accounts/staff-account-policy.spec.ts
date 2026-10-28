/**
 * PD-40 PR-3: who may create and manage which staff account -- the owner's
 * safeguards S1 and S2 (plan §13), DB-free. The SQL twins
 * (chat.create_staff_account, chat.may_administer_staff_account) are exercised
 * against the database in test/integration/pd040-staff-accounts.spec.ts.
 *
 *   S1  a department manager creates and manages only `specialist` accounts,
 *       only in the department they run; only the super admin creates
 *       supervisors and managers;
 *   S2  nobody acts on themselves or on the super admin; another
 *       organization's account is never in reach;
 *   H5  a manager manages a specialist only while the specialist holds
 *       nothing the manager may not grant (review of #212, P1: managing
 *       includes a reset code, so it is as good as holding the account).
 */
import { StaffRole } from '@communication/contracts/vocab';
import {
  decideStaffAccountCreate,
  decideStaffAccountManage,
  type StaffAccountStanding,
  type StaffAccountTarget,
} from '@platform/staff-account-policy';
import type { Actor } from '@platform/types';
import { admin, parent, teacher } from '../../support/fixtures';

const ORG = parent().organizationId!;
const OPS = 'dept-operations';
const TEACHERS = 'dept-teachers';

const staff = (id: string, role: string): Actor => admin(id, role);
const holds = (...keys: string[]): ReadonlySet<string> => new Set(keys);
const ALL_STAFF_KEYS = holds('staff_accounts.view', 'staff_accounts.create', 'staff_accounts.manage');

const SUPER = { actor: staff('super-1', StaffRole.SUPER_ADMIN), standing: { managedDepartmentId: null, permissions: ALL_STAFF_KEYS } };
const OPS_MANAGER = {
  actor: staff('ops-mgr', StaffRole.MANAGER),
  standing: { managedDepartmentId: OPS, permissions: holds(...ALL_STAFF_KEYS, 'billing.view', 'subscriptions.view', 'billing.verify', 'accounts.administer') },
};
const OPS_MANAGER_WITHOUT_KEYS = { actor: staff('ops-mgr-2', StaffRole.MANAGER), standing: { managedDepartmentId: OPS, permissions: holds() } };
const MANAGER_NO_DEPT = { actor: staff('mgr-x', StaffRole.MANAGER), standing: { managedDepartmentId: null, permissions: ALL_STAFF_KEYS } };
const SUPERVISOR = { actor: staff('sup-1', StaffRole.ADMIN), standing: { managedDepartmentId: null, permissions: ALL_STAFF_KEYS } };
const DESIGNER = { actor: staff('designer-1', 'specialist'), standing: { managedDepartmentId: null, permissions: ALL_STAFF_KEYS } };

const target = (over: Partial<StaffAccountTarget> = {}): StaffAccountTarget => ({
  staffId: 'spec-1',
  organizationId: ORG,
  role: 'specialist',
  departmentId: OPS,
  permissions: holds(),
  ...over,
});

const create = (who: { actor: Actor; standing: StaffAccountStanding }, tier: string, departmentId: string | null) =>
  decideStaffAccountCreate(who.actor, who.standing, { tier, departmentId }).allowed;
const manage = (who: { actor: Actor; standing: StaffAccountStanding }, t: StaffAccountTarget) =>
  decideStaffAccountManage(who.actor, who.standing, t).allowed;

describe('PD-40 S1: creating a staff account', () => {
  it('the super admin creates a specialist (in a department or none), a supervisor and a manager -- never a super admin', () => {
    expect(create(SUPER, 'specialist', OPS)).toBe(true);
    expect(create(SUPER, 'specialist', null)).toBe(true);
    for (const tier of ['admin', 'coverage', 'manager']) expect({ tier, ok: create(SUPER, tier, null) }).toEqual({ tier, ok: true });
    expect(create(SUPER, StaffRole.SUPER_ADMIN, null)).toBe(false);
    expect(create(SUPER, 'finance', null)).toBe(false);
  });

  it('a supervisor or manager is never placed by this route: their department comes from the organization structure (PD-8)', () => {
    for (const tier of ['admin', 'coverage', 'manager']) expect({ tier, ok: create(SUPER, tier, OPS) }).toEqual({ tier, ok: false });
  });

  it('a department manager creates a specialist in the department they run, and nothing else', () => {
    expect(create(OPS_MANAGER, 'specialist', OPS)).toBe(true);
    expect(create(OPS_MANAGER, 'specialist', TEACHERS)).toBe(false);
    expect(create(OPS_MANAGER, 'specialist', null)).toBe(false);
    for (const tier of ['admin', 'coverage', 'manager', StaffRole.SUPER_ADMIN]) {
      expect({ tier, ok: create(OPS_MANAGER, tier, OPS) }).toEqual({ tier, ok: false });
    }
  });

  it('the key is necessary: a manager without staff_accounts.create creates nobody', () => {
    expect(create(OPS_MANAGER_WITHOUT_KEYS, 'specialist', OPS)).toBe(false);
  });

  it('a manager with no department, a supervisor and a specialist create nobody -- whatever keys a stale row claims', () => {
    for (const who of [MANAGER_NO_DEPT, SUPERVISOR, DESIGNER]) expect(create(who, 'specialist', OPS)).toBe(false);
  });

  it('nobody who is not live staff of an organization creates anyone', () => {
    for (const actor of [parent(), teacher(), { ...SUPER.actor, isActive: false }, { ...SUPER.actor, organizationId: undefined }]) {
      expect(decideStaffAccountCreate(actor, SUPER.standing, { tier: 'specialist', departmentId: null }).allowed).toBe(false);
    }
  });
});

describe('PD-40 S1/S2: managing a staff account', () => {
  it('the super admin manages any staff account of the organization but their own', () => {
    for (const role of ['specialist', 'admin', 'coverage', 'manager', 'finance']) {
      expect({ role, ok: manage(SUPER, target({ role })) }).toEqual({ role, ok: true });
    }
    expect(manage(SUPER, target({ staffId: SUPER.actor.actorId, role: StaffRole.SUPER_ADMIN }))).toBe(false);
  });

  it('a department manager manages the specialists of the department they run -- never a supervisor, manager or another department', () => {
    expect(manage(OPS_MANAGER, target())).toBe(true);
    expect(manage(OPS_MANAGER, target({ departmentId: TEACHERS }))).toBe(false);
    expect(manage(OPS_MANAGER, target({ departmentId: null }))).toBe(false);
    for (const role of ['admin', 'coverage', 'manager', 'finance']) {
      expect({ role, ok: manage(OPS_MANAGER, target({ role })) }).toEqual({ role, ok: false });
    }
    expect(manage(OPS_MANAGER_WITHOUT_KEYS, target())).toBe(false);
  });

  it('nobody manages the super admin, themselves, or another organization', () => {
    for (const who of [SUPER, OPS_MANAGER]) {
      expect(manage(who, target({ role: StaffRole.SUPER_ADMIN, departmentId: null }))).toBe(false);
      expect(manage(who, target({ organizationId: 'org-elsewhere' }))).toBe(false);
    }
    expect(manage(OPS_MANAGER, target({ staffId: OPS_MANAGER.actor.actorId }))).toBe(false);
  });

  it('a manager manages their specialist only while every key the specialist holds is one they hold and may delegate (H5)', () => {
    expect(manage(OPS_MANAGER, target({ permissions: holds('billing.view', 'subscriptions.view') }))).toBe(true);
    for (const [why, key] of [
      ['held, not delegable', 'billing.verify'],
      ['delegable, not held', 'certificates.view'],
      ['never in a role', 'accounts.administer'],
    ] as const) {
      const t = target({ permissions: holds('billing.view', key) });
      expect({ why, ok: manage(OPS_MANAGER, t) }).toEqual({ why, ok: false });
      expect(decideStaffAccountManage(OPS_MANAGER.actor, OPS_MANAGER.standing, t)).toEqual({ allowed: false, reason: expect.stringContaining(key) });
      // Such an account is the super admin's.
      expect({ why, ok: manage(SUPER, t) }).toEqual({ why, ok: true });
    }
  });

  it('a supervisor, a specialist and a manager with no department manage nobody', () => {
    for (const who of [SUPERVISOR, DESIGNER, MANAGER_NO_DEPT]) expect(manage(who, target())).toBe(false);
  });
});
