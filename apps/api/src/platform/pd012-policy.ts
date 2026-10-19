import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from './types';

/**
 * PD-12 S1 (closed 2026-10-18): who may do what with student certificates,
 * teacher leave and the teacher supervision conversation.
 *
 *   act                                   teacher            Teachers dept       super admin   anyone else
 *   request a certificate                 own learner only   --                  --            never
 *   see / issue / decline certificates    --                 manager + members   yes           never
 *   request / withdraw leave, see own     self only          --                  --            never
 *   decide / cancel leave, see all        --                 manager + members   yes           never
 *   set a leave allowance                 --                 manager only        yes           never
 *   open a teacher's supervision chat     own only           manager + members   yes           never
 *
 * "Teachers dept" is chat.teachers_department_role(): the department's manager
 * or one of its members (PD-8 §1). It matches PD-10's Teacher File policy:
 * members write the supervision timeline, only the manager edits the record,
 * and Operations supervisors are not included.
 *
 * DB-free: the caller resolves the department role, so the matrix is
 * unit-testable whole.
 */
export type TeachersDepartmentRole = 'manager' | 'member' | null;

export interface Pd012Access {
  /** The Teachers department's side: certificates, leave decisions, supervision chats. */
  canSupervise: boolean;
  /** Typing in a teacher's leave allowance. */
  canSetAllowance: boolean;
}

export const NO_PD012_ACCESS: Pd012Access = Object.freeze({ canSupervise: false, canSetAllowance: false });

export function decidePd012StaffAccess(actor: Actor, teachersDepartmentRole: TeachersDepartmentRole): Pd012Access {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return NO_PD012_ACCESS;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return { canSupervise: true, canSetAllowance: true };
  // The role is re-checked, not inferred from the relation: the department
  // tables' triggers guarantee it today, and this keeps a stale row harmless.
  if (teachersDepartmentRole === 'manager' && actor.staffRole === StaffRole.MANAGER) {
    return { canSupervise: true, canSetAllowance: true };
  }
  if (
    teachersDepartmentRole === 'member' &&
    (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)
  ) {
    return { canSupervise: true, canSetAllowance: false };
  }
  return NO_PD012_ACCESS;
}

/** A live teacher acting for themselves. Every teacher-side PD-12 act starts here. */
export function isLiveTeacher(actor: Actor): boolean {
  return actor.kind === ActorKind.TEACHER && actor.isActive && !!actor.organizationId;
}

/**
 * May this teacher request a certificate for this learner? Only for a learner
 * they are assigned to now (chat.learner.teacher_id); the database re-checks it.
 */
export function canRequestCertificate(
  actor: Actor,
  learner: { organizationId: string; teacherId: string | null } | null,
): boolean {
  return (
    isLiveTeacher(actor) &&
    learner !== null &&
    learner.organizationId === actor.organizationId &&
    learner.teacherId === actor.actorId
  );
}
