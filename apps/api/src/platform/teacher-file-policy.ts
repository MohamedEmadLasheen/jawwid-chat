import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from './types';

/**
 * PD-10 (closed 2026-10-18): who may see and change a Teacher File.
 *
 *   section                                    Teachers-dept staff   super admin   anyone else
 *   personal info, assigned students           read                  read          never
 *   personal info: edit                        manager only          yes           never
 *   supervision timeline                       read + write          read + write  never
 *   financial summary                          --                    read          never
 *
 * "Teachers-dept staff" is the manager of the organization's Teachers
 * department and that department's members (PD-8 §1). Operations supervisors
 * are deliberately NOT included: that was a default adopted at closing, and
 * widening it is a new decision. Parents and teachers never reach a Teacher
 * File; a teacher's own schedule and workload arrive with PD-9 through their
 * own routes, never through this one.
 *
 * Decided from the actor and a relation the caller resolves from the database
 * (DB-free here, like PD-6's predicate), so the matrix is unit-testable whole.
 */
export type TeachersDepartmentRole = 'manager' | 'member' | null;

export interface TeacherFileAccess {
  canView: boolean;
  canEditPersonal: boolean;
  canWriteSupervision: boolean;
  /** PD-10 step 3: salary, bonuses, deductions. Core's data, shown read-only. */
  canViewFinance: boolean;
}

export const NO_TEACHER_FILE_ACCESS: TeacherFileAccess = Object.freeze({
  canView: false,
  canEditPersonal: false,
  canWriteSupervision: false,
  canViewFinance: false,
});

export function decideTeacherFileAccess(
  actor: Actor,
  target: { organizationId: string; teachersDepartmentRole: TeachersDepartmentRole },
): TeacherFileAccess {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return NO_TEACHER_FILE_ACCESS;
  if (actor.organizationId !== target.organizationId) return NO_TEACHER_FILE_ACCESS;

  if (actor.staffRole === StaffRole.SUPER_ADMIN) {
    return { canView: true, canEditPersonal: true, canWriteSupervision: true, canViewFinance: true };
  }
  // The role is re-checked, not inferred from the relation: the department
  // tables' triggers guarantee it today, and this keeps a stale row harmless.
  if (target.teachersDepartmentRole === 'manager' && actor.staffRole === StaffRole.MANAGER) {
    return { canView: true, canEditPersonal: true, canWriteSupervision: true, canViewFinance: false };
  }
  if (
    target.teachersDepartmentRole === 'member' &&
    (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)
  ) {
    return { canView: true, canEditPersonal: false, canWriteSupervision: true, canViewFinance: false };
  }
  return NO_TEACHER_FILE_ACCESS;
}
