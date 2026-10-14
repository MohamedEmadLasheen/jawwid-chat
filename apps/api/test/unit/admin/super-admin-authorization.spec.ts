/**
 * super_admin — the authorization decisions, exercised directly (PD-5).
 *
 * Two halves, and both matter:
 *
 *   1. canInspectOrganization admits the super admin and NOBODY else -- not a
 *      manager, not a department, not a parent or teacher, not a deactivated
 *      super admin, not one without an organization.
 *   2. super_admin is NOT (yet) a family-facing role. The SQL helpers still
 *      admit only ('admin', 'coverage', 'manager'), so the API must refuse the
 *      same writes the database would, rather than allow one and 500 at commit.
 *      When Phase 1 normalizes the roles, these assertions are the ones that
 *      should change -- deliberately, in the same commit as the SQL.
 *
 * Pure: no database, no clock.
 */
import { CommErrorCode } from '@platform/errors';
import { StaffRole } from '@communication/contracts/vocab';
import {
  academicStaff,
  admin,
  authzWithOnDuty,
  conversation,
  financeStaff,
  manager,
  parent,
  teacher,
} from '../../support/fixtures';

const authz = authzWithOnDuty();
const superAdmin = (id = 'super-1') => admin(id, StaffRole.SUPER_ADMIN);

describe('who may inspect the organization (/admin)', () => {
  it('the super admin may', () => {
    expect(authz.canInspectOrganization(superAdmin()).allowed).toBe(true);
  });

  it('every other staff role is refused -- a manager included', () => {
    for (const actor of [admin(), admin('cov-1', 'coverage'), manager(), financeStaff(), academicStaff()]) {
      const d = authz.canInspectOrganization(actor);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.ADMIN_INSPECTION_DENIED);
    }
  });

  it('a parent and a teacher are refused', () => {
    for (const actor of [parent(), teacher()]) {
      const d = authz.canInspectOrganization(actor);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.ADMIN_INSPECTION_DENIED);
    }
  });

  it('a contact or teacher carrying staffRole super_admin is still refused: kind decides first', () => {
    for (const actor of [
      { ...parent(), staffRole: StaffRole.SUPER_ADMIN },
      { ...teacher(), staffRole: StaffRole.SUPER_ADMIN },
    ]) {
      expect(authz.canInspectOrganization(actor).allowed).toBe(false);
    }
  });

  it('a DEACTIVATED super admin is refused, before the role is even read', () => {
    const d = authz.canInspectOrganization({ ...superAdmin(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('a super admin with no organization is refused: every query behind it filters on one', () => {
    const d = authz.canInspectOrganization({ ...superAdmin(), organizationId: undefined });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ADMIN_INSPECTION_DENIED);
  });
});

describe('super_admin is not a family-facing role in this milestone', () => {
  it('may not read a family conversation through the communication engine', () => {
    expect(authz.canRead(superAdmin(), conversation(), null).allowed).toBe(false);
  });

  it('may not publish a story, approve a message, or manage membership', () => {
    expect(authz.canPublishStory(superAdmin()).allowed).toBe(false);
    expect(authz.canApprove(superAdmin(), null).allowed).toBe(false);
    expect(authz.canManageMembership(superAdmin()).allowed).toBe(false);
  });

  it('may not open a direct conversation with a parent', () => {
    expect(authz.canOpenDirect(superAdmin(), parent()).allowed).toBe(false);
  });
});
