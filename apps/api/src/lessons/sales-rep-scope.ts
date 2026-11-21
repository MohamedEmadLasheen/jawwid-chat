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
