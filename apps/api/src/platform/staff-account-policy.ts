import type { Actor } from './types';

/**
 * PD-40 PR-3 (owner decision 2026-10-28, plan §13): who may create and manage
 * which staff account. Stub: refuses everything until the rules land.
 */
export type CreatableTier = 'specialist' | 'admin' | 'coverage' | 'manager';

export interface StaffAccountStanding {
  managedDepartmentId: string | null;
  permissions: ReadonlySet<string>;
}

export interface StaffAccountTarget {
  staffId: string;
  organizationId: string;
  role: string;
  departmentId: string | null;
}

export type StaffAccountDecision = { allowed: true } | { allowed: false; reason: string };

export function decideStaffAccountCreate(
  _actor: Actor,
  _standing: StaffAccountStanding,
  _request: { tier: string; departmentId: string | null },
): StaffAccountDecision {
  return { allowed: false, reason: 'not built' };
}

export function decideStaffAccountManage(_actor: Actor, _standing: StaffAccountStanding, _target: StaffAccountTarget): StaffAccountDecision {
  return { allowed: false, reason: 'not built' };
}
