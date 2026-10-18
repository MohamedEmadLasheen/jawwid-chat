/**
 * PD-10: the whole Teacher File access matrix, every role against every
 * relation to the Teachers department. DB-free: the relation is an input.
 */
import { decideTeacherFileAccess, type TeachersDepartmentRole } from '@platform/teacher-file-policy';
import type { Actor } from '@platform/types';
import { StaffRole } from '@communication/contracts/vocab';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

const staff = (role: string, over: Partial<Actor> = {}): Actor => ({
  actorId: 'a', kind: 'staff', displayName: 'x', locale: 'ar', isActive: true,
  staffRole: role as Actor['staffRole'], organizationId: ORG, ...over,
});

const NONE = { canView: false, canEditPersonal: false, canWriteSupervision: false, canViewFinance: false };
const READ_WRITE = { canView: true, canEditPersonal: false, canWriteSupervision: true, canViewFinance: false };
const MANAGER = { canView: true, canEditPersonal: true, canWriteSupervision: true, canViewFinance: false };
const OWNER = { canView: true, canEditPersonal: true, canWriteSupervision: true, canViewFinance: true };

const decide = (actor: Actor, rel: TeachersDepartmentRole, org = ORG) =>
  decideTeacherFileAccess(actor, { organizationId: org, teachersDepartmentRole: rel });

describe('PD-10 Teacher File access', () => {
  it('the super admin has everything, finance included, whatever the relation', () => {
    for (const rel of ['manager', 'member', null] as const) {
      expect(decide(staff(StaffRole.SUPER_ADMIN), rel)).toEqual(OWNER);
    }
  });

  it('the Teachers manager reads, edits personal info and writes the timeline, but never sees finance', () => {
    expect(decide(staff(StaffRole.MANAGER), 'manager')).toEqual(MANAGER);
  });

  it.each([StaffRole.ADMIN, StaffRole.COVERAGE])('a Teachers-department %s member reads and writes the timeline only', (role) => {
    expect(decide(staff(role), 'member')).toEqual(READ_WRITE);
  });

  it('no relation to the Teachers department means nothing, for every non-owner role', () => {
    for (const role of Object.values(StaffRole).filter((r) => r !== StaffRole.SUPER_ADMIN)) {
      expect({ role, access: decide(staff(role), null) }).toEqual({ role, access: NONE });
    }
  });

  it('a relation never upgrades a role it does not fit (stale or forged rows are harmless)', () => {
    expect(decide(staff(StaffRole.ADMIN), 'manager')).toEqual(NONE);
    expect(decide(staff(StaffRole.MANAGER), 'member')).toEqual(NONE);
    for (const role of [StaffRole.FINANCE, StaffRole.TECHNICAL, StaffRole.ACADEMIC]) {
      expect(decide(staff(role), 'member')).toEqual(NONE);
      expect(decide(staff(role), 'manager')).toEqual(NONE);
    }
  });

  it('teachers and parents get nothing, even with a forged relation', () => {
    for (const kind of ['teacher', 'contact', 'system'] as const) {
      for (const rel of ['manager', 'member', null] as const) {
        expect(decide(staff(StaffRole.SUPER_ADMIN, { kind }), rel)).toEqual(NONE);
      }
    }
  });

  it('an inactive actor, an actor without an organization, or another tenant gets nothing', () => {
    expect(decide(staff(StaffRole.SUPER_ADMIN, { isActive: false }), null)).toEqual(NONE);
    expect(decide(staff(StaffRole.SUPER_ADMIN, { organizationId: undefined }), null)).toEqual(NONE);
    expect(decide(staff(StaffRole.SUPER_ADMIN), null, OTHER_ORG)).toEqual(NONE);
    expect(decide(staff(StaffRole.MANAGER), 'manager', OTHER_ORG)).toEqual(NONE);
  });
});
