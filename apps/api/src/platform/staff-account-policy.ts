import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { Actor } from './types';

/**
 * PD-40 PR-3 (owner decision 2026-10-28, plan §13): who may create and manage
 * which staff account.
 *
 *   act                              super admin                department manager                      anyone else
 *   create a specialist              any department, or none    of the department they run only        never
 *   create a supervisor / manager    yes (placed later, PD-8)   never (S1)                             never
 *   create a super admin             never (bootstrap CLI only, PD-5)
 *   manage an account (roles, code,  any staff but the super    the specialists of the department      never
 *   suspend, reactivate, sign out)   admin and themselves       they run
 *
 * "Department manager" is chat.department.manager_id = the actor, with staff
 * role manager, holding the staff_accounts.* key the act needs. The key is
 * necessary, never sufficient: the relation decides. Never oneself, never the
 * super admin, never another organization (S2).
 *
 * DB-free: the caller resolves the standing and the target from the database
 * (StaffAccountsService). The SQL twins -- chat.create_staff_account and
 * chat.may_administer_staff_account -- state the same rules, so the API never
 * offers what the database refuses.
 */
export type CreatableTier = 'specialist' | 'admin' | 'coverage' | 'manager';
export const CREATABLE_TIERS: readonly CreatableTier[] = ['specialist', 'admin', 'coverage', 'manager'];

export interface StaffAccountStanding {
  /** The department the actor runs (chat.department.manager_id), if any. */
  managedDepartmentId: string | null;
  /** The actor's effective permissions (chat.staff_access_profile). */
  permissions: ReadonlySet<string>;
}

export interface StaffAccountTarget {
  staffId: string;
  organizationId: string;
  role: string;
  /** chat.department_account.department_id: where a specialist belongs. */
  departmentId: string | null;
}

export type StaffAccountDecision = { allowed: true } | { allowed: false; reason: string };

const yes: StaffAccountDecision = { allowed: true };
const no = (reason: string): StaffAccountDecision => ({ allowed: false, reason });

const liveStaff = (actor: Actor) => actor.kind === ActorKind.STAFF && actor.isActive && !!actor.organizationId;

/** A department manager, by role and relation (a stale department row admits nobody). */
const departmentManager = (actor: Actor, standing: StaffAccountStanding) =>
  actor.staffRole === StaffRole.MANAGER && standing.managedDepartmentId !== null;

export function decideStaffAccountCreate(
  actor: Actor,
  standing: StaffAccountStanding,
  request: { tier: string; departmentId: string | null },
): StaffAccountDecision {
  if (!liveStaff(actor)) return no('only active staff of an organization create staff accounts');
  if (!(CREATABLE_TIERS as readonly string[]).includes(request.tier)) {
    return no('a staff account is a specialist, a supervisor or a manager; the super admin is never created here');
  }
  if (actor.staffRole === StaffRole.SUPER_ADMIN) {
    // Supervisors and managers take their department from the organization
    // structure (PD-8: department members and managers), never from here.
    if (request.tier !== 'specialist' && request.departmentId !== null) {
      return no("a supervisor's or manager's department is set in the organization structure");
    }
    return yes;
  }
  if (!departmentManager(actor, standing) || !standing.permissions.has('staff_accounts.create')) {
    return no('only the super admin and department managers create staff accounts');
  }
  if (request.tier !== 'specialist') return no('only the super admin creates supervisors and managers (PD-40 S1)');
  if (request.departmentId !== standing.managedDepartmentId) {
    return no('a manager creates accounts in the department they run only (PD-40 S1)');
  }
  return yes;
}

export function decideStaffAccountManage(actor: Actor, standing: StaffAccountStanding, target: StaffAccountTarget): StaffAccountDecision {
  if (!liveStaff(actor)) return no('only active staff of an organization manage staff accounts');
  if (target.organizationId !== actor.organizationId) return no('no such staff account');
  if (target.staffId === actor.actorId) return no('nobody manages their own account (PD-40 H8)');
  if (target.role === StaffRole.SUPER_ADMIN) return no("the super admin's account is never managed here (PD-40 H1)");
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return yes;
  if (!departmentManager(actor, standing) || !standing.permissions.has('staff_accounts.manage')) {
    return no('only the super admin and department managers manage staff accounts');
  }
  if (target.role !== 'specialist' || target.departmentId !== standing.managedDepartmentId) {
    return no('a manager manages the specialists of the department they run only (PD-40 S1)');
  }
  return yes;
}
