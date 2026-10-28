/**
 * PD-43: who may add a teacher, which supervisor they may name, and who may
 * offboard one -- every role against every relation to the Teachers
 * department. DB-free: the relation is an input. The database repeats the
 * same rule in chat.create_teacher (pd043-teacher-onboarding.spec.ts).
 *
 *   Q1 (owner 2026-10-27): "Also teacher supervisors" add teachers.
 *   N1: "They may leave it empty" -- a supervisor names themselves or nobody.
 *   Q6: "Manager or super admin, after students move" -- offboarding.
 */
import { decideTeacherOnboarding, NO_TEACHER_ONBOARDING } from '@platform/teacher-onboarding-policy';
import type { TeachersDepartmentRole } from '@platform/teacher-file-policy';
import type { Actor } from '@platform/types';
import { StaffRole } from '@communication/contracts/vocab';

const ORG = '11111111-1111-4111-8111-111111111111';

const staff = (role: string, over: Partial<Actor> = {}): Actor => ({
  actorId: 'a', kind: 'staff', displayName: 'x', locale: 'ar', isActive: true,
  staffRole: role as Actor['staffRole'], organizationId: ORG, ...over,
});

const OWNER = { canCreate: true, supervisorChoice: 'any', canOffboard: true, canReactivate: true };
const MANAGER = { canCreate: true, supervisorChoice: 'any', canOffboard: true, canReactivate: false };
const SUPERVISOR = { canCreate: true, supervisorChoice: 'self_or_none', canOffboard: false, canReactivate: false };

const RELATIONS: TeachersDepartmentRole[] = ['manager', 'member', null];

describe('PD-43 adding and offboarding teachers', () => {
  it('the super admin does everything, whatever the relation, and alone reactivates a former teacher', () => {
    for (const rel of RELATIONS) expect(decideTeacherOnboarding(staff(StaffRole.SUPER_ADMIN), rel)).toEqual(OWNER);
  });

  it('the Teachers manager adds with any supervisor or none, and offboards', () => {
    expect(decideTeacherOnboarding(staff(StaffRole.MANAGER), 'manager')).toEqual(MANAGER);
  });

  it.each([StaffRole.ADMIN, StaffRole.COVERAGE])('a Teachers-department %s adds a teacher for themselves or with no supervisor, and never offboards', (role) => {
    expect(decideTeacherOnboarding(staff(role), 'member')).toEqual(SUPERVISOR);
  });

  it('no relation to the Teachers department means nothing, for every role but the super admin', () => {
    for (const role of [StaffRole.MANAGER, StaffRole.ADMIN, StaffRole.COVERAGE, StaffRole.FINANCE, StaffRole.TECHNICAL, StaffRole.ACADEMIC, 'specialist']) {
      expect(decideTeacherOnboarding(staff(role), null)).toEqual(NO_TEACHER_ONBOARDING);
    }
  });

  it('a stale relation widens nothing: the role is re-checked', () => {
    expect(decideTeacherOnboarding(staff(StaffRole.MANAGER), 'member')).toEqual(NO_TEACHER_ONBOARDING);
    expect(decideTeacherOnboarding(staff(StaffRole.ADMIN), 'manager')).toEqual(NO_TEACHER_ONBOARDING);
    expect(decideTeacherOnboarding(staff(StaffRole.FINANCE), 'member')).toEqual(NO_TEACHER_ONBOARDING);
  });

  it('nobody who is not live staff of an organization', () => {
    const teacher: Actor = { actorId: 't', kind: 'teacher', displayName: 'x', locale: 'ar', isActive: true, organizationId: ORG };
    expect(decideTeacherOnboarding(teacher, 'manager')).toEqual(NO_TEACHER_ONBOARDING);
    expect(decideTeacherOnboarding(staff(StaffRole.SUPER_ADMIN, { isActive: false }), null)).toEqual(NO_TEACHER_ONBOARDING);
    expect(decideTeacherOnboarding(staff(StaffRole.MANAGER, { organizationId: undefined }), 'manager')).toEqual(NO_TEACHER_ONBOARDING);
  });
});
