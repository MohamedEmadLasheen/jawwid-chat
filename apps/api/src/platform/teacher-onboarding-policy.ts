import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { TeachersDepartmentRole } from './teacher-file-policy';
import type { Actor } from './types';

/**
 * PD-43 (plan merged as #180): who adds a teacher, which supervisor they may
 * name, and who offboards one.
 *
 *   act                          super admin   Teachers manager   teacher supervisor        anyone else
 *   add a teacher                yes           yes                yes (owner Q1)            never
 *   name the supervisor          any or none   any or none        themselves or none (N1)   --
 *   offboard a teacher           yes           yes (Q6)           never                     never
 *   reactivate a former teacher  yes           never              never                     never
 *
 * "Teacher supervisor" is a member of the Teachers department (admin /
 * coverage), the role re-checked as in decideTeacherFileAccess so a stale
 * department row is harmless. Only a PRIMARY supervisor may hold teachers, so
 * the database (chat.create_teacher) refuses a member who is not one; this
 * DB-free matrix is what PD-40's bundles are checked against
 * (pd040-legacy-bundles.spec.ts: teachers.create, teachers.offboard).
 */
export type SupervisorChoice = 'any' | 'self_or_none';

export interface TeacherOnboardingAccess {
  canCreate: boolean;
  /** Which supervisor the adder may name for the new teacher; null when they add none. */
  supervisorChoice: SupervisorChoice | null;
  canOffboard: boolean;
  canReactivate: boolean;
}

export const NO_TEACHER_ONBOARDING: TeacherOnboardingAccess = Object.freeze({
  canCreate: false,
  supervisorChoice: null,
  canOffboard: false,
  canReactivate: false,
});

export function decideTeacherOnboarding(actor: Actor, teachersDepartmentRole: TeachersDepartmentRole): TeacherOnboardingAccess {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return NO_TEACHER_ONBOARDING;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) {
    return { canCreate: true, supervisorChoice: 'any', canOffboard: true, canReactivate: true };
  }
  if (teachersDepartmentRole === 'manager' && actor.staffRole === StaffRole.MANAGER) {
    return { canCreate: true, supervisorChoice: 'any', canOffboard: true, canReactivate: false };
  }
  if (teachersDepartmentRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)) {
    return { canCreate: true, supervisorChoice: 'self_or_none', canOffboard: false, canReactivate: false };
  }
  return NO_TEACHER_ONBOARDING;
}
