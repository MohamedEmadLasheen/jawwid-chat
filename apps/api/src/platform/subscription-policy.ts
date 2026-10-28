import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { OperationsDepartmentRole, SalesDepartmentRole } from './pd012-policy';
import type { Actor } from './types';

/**
 * PD-30 (owner, 2026-10-26): only the Super Admin, the Operations Manager and
 * the Sales Manager may let a child go on past the lock -- grant or revoke an
 * exception. Pure, so the rule is unit-testable whole. Everyone else who
 * reads a family's money (billingAccessOf) sees the exceptions; nobody else
 * changes them.
 *
 * The Operations Manager is the Operations department's manager with the
 * manager staff role (decideBillingAccess's rule); the Sales Manager is the
 * Sales department's manager (chat.sales_department_role = 'manager').
 */
export function canGrantSubscriptionException(
  actor: Actor,
  operationsRole: OperationsDepartmentRole,
  salesRole: SalesDepartmentRole,
): boolean {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return false;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return true;
  if (operationsRole === 'manager' && actor.staffRole === StaffRole.MANAGER) return true;
  return salesRole === 'manager';
}

/**
 * PD-42 (PD-30-amendment-carried-over): who may hold `subscriptions.carry_over`
 * -- the Operations and Sales supervisors who enter families, and their
 * managers. Holding it is necessary, never sufficient: the database admits a
 * supervisor's carried-over package only for a child they entered, within 14
 * days, for their own family, with no other package (guard_learner_subscription).
 */
export function canCarryOverPackage(
  actor: Actor,
  operationsRole: OperationsDepartmentRole,
  salesRole: SalesDepartmentRole,
): boolean {
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return false;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return true;
  if (operationsRole === 'manager' && actor.staffRole === StaffRole.MANAGER) return true;
  if (operationsRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE)) return true;
  return salesRole !== null;
}
