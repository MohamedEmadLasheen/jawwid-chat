/**
 * Staff profiles -- the authorization decisions, exercised directly.
 *
 * AuthorizationService.staffProfileAccess receives the target as a resolved
 * fact (role, tenant, activity, "reports to the actor") and decides. These
 * tests pin the matrix: who sees which profile, and which field groups each
 * relation may change. The service enforces every flag field by field, so a
 * hand-built request gains nothing the matrix below refuses.
 *
 * Pure: no database, no clock.
 */
import { CommErrorCode } from '@platform/errors';
import { StaffRole } from '@communication/contracts/vocab';
import type { Actor } from '@platform/types';
import {
  NO_PROFILE_ACCESS,
  ROLE_PROFILE_PERMISSIONS,
  StaffProfilePermission,
  type StaffProfileTarget,
} from '@platform/staff-profile-policy';
import { academicStaff, admin, authzWithOnDuty, financeStaff, manager, parent, teacher } from '../../support/fixtures';

const authz = authzWithOnDuty();
const superAdmin = (id = 'super-1') => admin(id, StaffRole.SUPER_ADMIN);

const target = (over: Partial<StaffProfileTarget> = {}): StaffProfileTarget => ({
  staffId: 'admin-9',
  role: StaffRole.ADMIN,
  organizationId: 'org-1',
  isActive: true,
  reportsToActor: false,
  ...over,
});
const self = (actor: Actor, over: Partial<StaffProfileTarget> = {}) =>
  target({ staffId: actor.actorId, role: actor.staffRole as string, ...over });

describe('the permission map is data, and grants nothing outside profiles', () => {
  it('only the super admin holds reporting_lines.manage and the org_* keys', () => {
    for (const [role, keys] of Object.entries(ROLE_PROFILE_PERMISSIONS)) {
      const orgWide = keys.filter((k) => k.startsWith('org_') || k === StaffProfilePermission.REPORTING_LINES_MANAGE);
      if (role === StaffRole.SUPER_ADMIN) expect(orgWide.length).toBeGreaterThan(0);
      else expect(orgWide).toEqual([]);
    }
  });

  it('every staff role may edit its own descriptive fields; only managers hold team keys', () => {
    for (const [role, keys] of Object.entries(ROLE_PROFILE_PERMISSIONS)) {
      expect(keys).toContain(StaffProfilePermission.SELF_EDIT);
      const team = keys.filter((k) => k.startsWith('team_'));
      if (role === StaffRole.MANAGER) expect(team.length).toBe(3);
      if (role !== StaffRole.MANAGER && role !== StaffRole.SUPER_ADMIN) expect(team).toEqual([]);
    }
  });

  it('no key names a role, a permission, a credential or an account status', () => {
    const all = Object.values(StaffProfilePermission).join(' ');
    expect(all).not.toMatch(/role|permission|credential|password|status|session/i);
  });
});

describe('an admin / supervisor', () => {
  const me = admin('admin-1');

  it('may view and edit their own professional fields and photo', () => {
    const a = authz.staffProfileAccess(me, self(me));
    expect(a).toMatchObject({ relation: 'self', canView: true, canEditProfessional: true, canEditPhoto: true });
  });

  it('may NOT rename themselves, assign themselves responsibilities, or choose their manager', () => {
    const a = authz.staffProfileAccess(me, self(me));
    expect(a.canEditDisplayName).toBe(false);
    expect(a.canManageResponsibilities).toBe(false);
    expect(a.canManageReportingLine).toBe(false);
    expect(a.canReadAudit).toBe(false);
  });

  it('cannot see another admin, a manager or the super admin', () => {
    for (const t of [target(), target({ staffId: 'm', role: 'manager' }), target({ staffId: 's', role: 'super_admin' })]) {
      expect(authz.staffProfileAccess(me, t)).toEqual(NO_PROFILE_ACCESS);
    }
  });

  it('a target that claims to report to an admin still grants nothing: only managers have teams', () => {
    expect(authz.staffProfileAccess(me, target({ reportsToActor: true }))).toEqual(NO_PROFILE_ACCESS);
  });

  it('departments get exactly the same self-service and nothing more', () => {
    for (const actor of [financeStaff(), academicStaff(), admin('cov-1', 'coverage')]) {
      const a = authz.staffProfileAccess(actor, self(actor));
      expect(a).toMatchObject({ canEditProfessional: true, canEditPhoto: true, canManageResponsibilities: false });
      expect(authz.staffProfileAccess(actor, target())).toEqual(NO_PROFILE_ACCESS);
    }
  });
});

describe('a manager', () => {
  const me = manager('manager-1');

  it('sees a direct report and may edit their professional info and responsibilities', () => {
    const a = authz.staffProfileAccess(me, target({ reportsToActor: true }));
    expect(a).toMatchObject({
      relation: 'team',
      canView: true,
      canEditProfessional: true,
      canManageResponsibilities: true,
      canReadAudit: true,
    });
  });

  it('may NOT change a report\'s photo, name or reporting line', () => {
    const a = authz.staffProfileAccess(me, target({ reportsToActor: true }));
    expect(a.canEditPhoto).toBe(false);
    expect(a.canEditDisplayName).toBe(false);
    expect(a.canManageReportingLine).toBe(false);
  });

  it('cannot see staff outside their team -- another manager\'s report included', () => {
    expect(authz.staffProfileAccess(me, target({ reportsToActor: false }))).toEqual(NO_PROFILE_ACCESS);
  });

  it('cannot reach another manager or the super admin, even if a line claims they report to them', () => {
    for (const role of [StaffRole.MANAGER, StaffRole.SUPER_ADMIN]) {
      expect(authz.staffProfileAccess(me, target({ role, reportsToActor: true }))).toEqual(NO_PROFILE_ACCESS);
    }
  });

  it('cannot assign responsibilities to themselves or edit their own reporting line', () => {
    const a = authz.staffProfileAccess(me, self(me));
    expect(a.relation).toBe('self');
    expect(a.canManageResponsibilities).toBe(false);
    expect(a.canManageReportingLine).toBe(false);
    expect(a.canEditDisplayName).toBe(false);
  });

  it('may view but not edit an inactive report', () => {
    const a = authz.staffProfileAccess(me, target({ reportsToActor: true, isActive: false }));
    expect(a.canView).toBe(true);
    expect(a.canEditProfessional).toBe(false);
    expect(a.canManageResponsibilities).toBe(false);
  });

  it('a report in another organization is invisible', () => {
    expect(authz.staffProfileAccess(me, target({ reportsToActor: true, organizationId: 'org-2' }))).toEqual(NO_PROFILE_ACCESS);
  });
});

describe('the super admin', () => {
  const me = superAdmin();

  it('sees every profile in the organization and may manage it, reporting line included', () => {
    for (const role of [StaffRole.ADMIN, StaffRole.MANAGER, StaffRole.COVERAGE, StaffRole.FINANCE]) {
      const a = authz.staffProfileAccess(me, target({ role }));
      expect(a).toMatchObject({
        relation: 'organization',
        canView: true,
        canEditProfessional: true,
        canEditPhoto: true,
        canEditDisplayName: true,
        canManageResponsibilities: true,
        canManageReportingLine: true,
        canReadAudit: true,
      });
    }
  });

  it('has no reporting line of their own to change', () => {
    expect(authz.staffProfileAccess(me, self(me)).canManageReportingLine).toBe(false);
  });

  it('cannot reach another organization', () => {
    expect(authz.staffProfileAccess(me, target({ organizationId: 'org-2' }))).toEqual(NO_PROFILE_ACCESS);
  });

  it('may view an inactive account but not edit it', () => {
    const a = authz.staffProfileAccess(me, target({ isActive: false }));
    expect(a.canView).toBe(true);
    expect(a.canEditProfessional || a.canEditPhoto || a.canManageResponsibilities || a.canManageReportingLine).toBe(false);
  });

  it('is the only one allowed the organization overview', () => {
    expect(authz.canViewOrganizationProfiles(me).allowed).toBe(true);
    for (const actor of [admin(), manager(), financeStaff(), parent(), teacher()]) {
      const d = authz.canViewOrganizationProfiles(actor);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.STAFF_DIRECTORY_DENIED);
    }
  });
});

describe('inactive, unscoped and non-staff actors', () => {
  it('a deactivated actor gets nothing, even on their own profile', () => {
    for (const actor of [{ ...admin(), isActive: false }, { ...manager(), isActive: false }, { ...superAdmin(), isActive: false }]) {
      expect(authz.staffProfileAccess(actor, self(actor))).toEqual(NO_PROFILE_ACCESS);
    }
    const d = authz.canViewOrganizationProfiles({ ...superAdmin(), isActive: false });
    expect(d.allowed).toBe(false);
  });

  it('an actor without an organization cannot be scoped and gets nothing', () => {
    const actor = { ...superAdmin(), organizationId: undefined };
    expect(authz.staffProfileAccess(actor, target())).toEqual(NO_PROFILE_ACCESS);
    expect(authz.canViewOrganizationProfiles(actor).allowed).toBe(false);
  });

  it('a parent and a teacher get nothing', () => {
    for (const actor of [parent(), teacher()]) {
      expect(authz.staffProfileAccess(actor, target())).toEqual(NO_PROFILE_ACCESS);
    }
  });
});
