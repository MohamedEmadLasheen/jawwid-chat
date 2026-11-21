import type { PrismaService } from '../platform/prisma.service';
import type { Actor } from '../platform/types';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import type { LessonService } from './lesson.service';

/**
 * PD-59 / F7: a Sales REPRESENTATIVE -- a Sales-department member who is not its manager, not the
 * super admin, and not also on the trial desk through Operations or the Teachers department.
 *
 * Returns the representative's own staff id (the owner their reads are scoped to), or null for everyone
 * else: the Sales manager, the super admin, Operations, the Teachers department, teachers and anyone not
 * in Sales keep exactly the access they had. One rule, used by every trial read and write and by the New
 * Students page, so the two can never drift apart.
 */
export async function salesRepScope(
  prisma: Pick<PrismaService, '$queryRaw'>,
  lessons: Pick<LessonService, 'inDepartment' | 'isManager'>,
  actor: Actor,
): Promise<string | null> {
  if (actor.kind !== ActorKind.STAFF || actor.staffRole === StaffRole.SUPER_ADMIN || !actor.organizationId) return null;
  const [r] = await prisma.$queryRaw<Array<{ role: string | null }>>`SELECT chat.sales_department_role(${actor.actorId}::uuid) AS role`;
  if (r?.role !== 'member') return null;
  if ((await lessons.inDepartment(actor, 'operations')) || (await lessons.isManager(actor))) return null;
  return actor.actorId;
}

/** `salesRepScope` without a LessonService: the message read path has none. */
export async function salesRepScopeOf(prisma: Pick<PrismaService, '$queryRaw'>, actor: Actor): Promise<string | null> {
  if (actor.kind !== ActorKind.STAFF || actor.staffRole === StaffRole.SUPER_ADMIN || !actor.organizationId) return null;
  return (await salesRepsAmong(prisma, actor.organizationId, [actor.actorId])).has(actor.actorId) ? actor.actorId : null;
}

/**
 * Of `staffIds` (staff of `organizationId`), the Sales representatives, by the one rule above: a member
 * of the organization's Sales department who is not the super admin and is not also in the Operations or
 * Teachers department (as manager or member). `staffIds` null means every staff member of the organization. Set-based, for the message path (which has no LessonService) and the fan-out; it states the same rule as
 * `salesRepScope` above, and both are exercised by the PD-59 integration specs.
 */
export async function salesRepsAmong(
  prisma: Pick<PrismaService, '$queryRaw'>,
  organizationId: string,
  staffIds: readonly string[] | null,
): Promise<Set<string>> {
  if (staffIds && staffIds.length === 0) return new Set();
  const only = staffIds ? [...staffIds] : null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT s.id::text AS id
      FROM chat.staff s
     WHERE (${only}::uuid[] IS NULL OR s.id = ANY(${only}::uuid[]))
       AND s.organization_id = ${organizationId}::uuid
       AND s.role <> 'super_admin'
       AND chat.sales_department_role(s.id) = 'member'
       AND NOT EXISTS (
             SELECT 1 FROM chat.department d
              WHERE d.organization_id = s.organization_id
                AND d.kind IN ('operations', 'teachers')
                AND (d.manager_id = s.id
                     OR EXISTS (SELECT 1 FROM chat.department_member m WHERE m.department_id = d.id AND m.staff_id = s.id)))`;
  return new Set(rows.map((r) => r.id));
}
