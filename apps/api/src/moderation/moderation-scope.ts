import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import type { Actor } from '../platform/types';
import type { PermissionService } from '../platform/permissions/permission.service';
import { StaffRole } from '../communication/contracts/vocab';
import { staffDepartments } from './departments';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * PD-57 closure plan 2026-11-06 §3 (owner D-2, D-3, D-4): WHICH reports a
 * reviewer reaches. The ONE rule, used by the queue, the detail, take,
 * resolve and the evidence attachments (the link and every byte served):
 *
 *   the Super Admin                every report of the organization
 *   reason = child_safety          only the Super Admin and holders of
 *                                  moderation.child_safety (never a
 *                                  department queue)
 *   anyone else with the key       a report whose department_ids include a
 *                                  department they manage or belong to
 *   never                          a report about the reviewer themself
 *
 * Out of scope reads as not found (404 COMM.REPORT_NOT_FOUND), never 403.
 * The key (moderation.view / .act) is checked before this; this only narrows.
 * Expressed as a Prisma `where`, so the queue's order and limit apply to the
 * reports the reviewer may see, not to the organization's.
 */
export interface ModerationScope {
  organizationId: string;
  actorId: string;
  superAdmin: boolean;
  childSafety: boolean;
  departmentIds: readonly string[];
}

export async function moderationScope(db: Db, permissions: PermissionService, actor: Actor): Promise<ModerationScope> {
  const superAdmin = actor.staffRole === StaffRole.SUPER_ADMIN;
  const [childSafety, departmentIds] = await Promise.all([
    superAdmin ? true : permissions.has(actor, 'moderation.child_safety'),
    superAdmin ? [] : staffDepartments(db, [actor.actorId]),
  ]);
  return { organizationId: actor.organizationId as string, actorId: actor.actorId, superAdmin, childSafety, departmentIds };
}

export function scopeWhere(scope: ModerationScope): Prisma.ContentReportWhereInput {
  const notAboutMe: Prisma.ContentReportWhereInput = { NOT: { subjectKind: 'staff', subjectId: scope.actorId } };
  if (scope.superAdmin) return { AND: [{ organizationId: scope.organizationId }, notAboutMe] };
  const reach: Prisma.ContentReportWhereInput[] = [];
  if (scope.childSafety) reach.push({ reason: 'child_safety' });
  if (scope.departmentIds.length) {
    reach.push({ reason: { not: 'child_safety' }, departmentIds: { hasSome: [...scope.departmentIds] } });
  }
  // Nothing in reach: a condition no row meets (an empty OR would mean "any").
  if (!reach.length) return { id: { in: [] } };
  return { AND: [{ organizationId: scope.organizationId }, notAboutMe, { OR: reach }] };
}
