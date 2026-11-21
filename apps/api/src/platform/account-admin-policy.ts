import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { OperationsDepartmentRole, SalesDepartmentRole, TeachersDepartmentRole } from './pd012-policy';
import type { Actor } from './types';

/**
 * PD-21 as narrowed by PD-40 (2026-10-27): WHICH department administers WHICH
 * kind of account. PD-21 had given every staff role every act on every parent
 * and teacher account of the organization, so a staff member with no family
 * or teacher work -- and, under PD-40, a Designer -- could open any parent's
 * account. The departments that do that work keep it; nobody else has it.
 *
 *   act on a ...           super admin   Operations          Sales                 Teachers dept       anyone else
 *   parent (family)        every act     every act           -- (PD-59)            --                  never
 *   teacher                every act     --                  --                    every act           never
 *   staff                  every act¹    --                  --                    --                  never
 *
 *   ¹ never impersonated, never the super admin's own or one's own account
 *     (AuthorizationService.canAdministerAccount keeps those rules).
 *
 * "Operations" / "Teachers dept" are the department's manager (staff role
 * manager) or one of its members (admin / coverage): the same shape as
 * decidePd012StaffAccess and decideBillingAccess, the role re-checked so a
 * stale department row is harmless. PD-59 (owner 2026-11-21): Sales -- a representative
 * or the manager -- administers no family account at all. It enrols the family
 * (PD-16) and enters the new parent's first sign-in e-mail through the intake
 * (new_students.manage); a reset, the devices and the sessions are Operations'.
 * Owning the lead, or the family it became, confers nothing here.
 *
 * DB-free: the caller resolves the department roles (accountAdminStandingOf),
 * so the matrix is unit-testable whole.
 */
export type AccountAdminAct = 'reset_password' | 'suspend' | 'reactivate' | 'impersonate' | 'sign_out';
export type AccountAdminKind = 'family' | 'teacher' | 'staff';

export const ACCOUNT_ADMIN_ACTS: readonly AccountAdminAct[] = Object.freeze([
  'reset_password',
  'suspend',
  'reactivate',
  'impersonate',
  'sign_out',
]);

/** The actor's department roles, as the database says they are. */
export interface AccountAdminStanding {
  operations: OperationsDepartmentRole;
  teachers: TeachersDepartmentRole;
  sales: SalesDepartmentRole;
}

export const NO_ACCOUNT_ADMIN_STANDING: AccountAdminStanding = Object.freeze({ operations: null, teachers: null, sales: null });

const EVERY_ACT: ReadonlySet<AccountAdminAct> = new Set(ACCOUNT_ADMIN_ACTS);
const NO_ACTS: ReadonlySet<AccountAdminAct> = new Set();

/** A department's manager or member, the staff role re-checked. */
function inDepartment(actor: Actor, role: 'manager' | 'member' | null): boolean {
  if (role === 'manager') return actor.staffRole === StaffRole.MANAGER;
  if (role === 'member') return actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE;
  return false;
}

/**
 * The acts this actor may take on accounts of `kind`, before the per-account
 * rules (same organization, never one's own, never the super admin's, never a
 * staff account impersonated). Empty for anyone who is not live staff.
 */
export function accountAdminActs(actor: Actor, standing: AccountAdminStanding, kind: string): ReadonlySet<AccountAdminAct> {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return NO_ACTS;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return EVERY_ACT;
  if (kind === 'family') {
    if (inDepartment(actor, standing.operations)) return EVERY_ACT;
    return NO_ACTS;
  }
  if (kind === 'teacher') return inDepartment(actor, standing.teachers) ? EVERY_ACT : NO_ACTS;
  return NO_ACTS;
}

/** The account kinds this actor administers at all: what the Accounts list shows them. */
export function accountKindsAdministered(actor: Actor, standing: AccountAdminStanding): AccountAdminKind[] {
  if (actor.kind === ActorKind.STAFF && actor.isActive && actor.organizationId && actor.staffRole === StaffRole.SUPER_ADMIN) {
    return ['family', 'teacher', 'staff'];
  }
  return (['family', 'teacher'] as const).filter((kind) => accountAdminActs(actor, standing, kind).size > 0);
}
