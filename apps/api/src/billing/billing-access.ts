import type { PrismaService } from '../platform/prisma.service';
import type { Actor } from '../platform/types';
import {
  decideBillingAccess,
  type BillingAccess,
  type OperationsDepartmentRole,
  type SalesDepartmentRole,
} from '../platform/pd012-policy';

/**
 * Who may read and record a family's money, and open the Parent Profile
 * (PD-17): the super admin and the Operations Manager every family, an
 * Operations supervisor (or coverage) the families they reach
 * (chat.staff_reaches_family), the Sales department every family (to record
 * payments; it does not edit the contact record). Never a teacher, a parent or
 * the Teachers department. One rule for Instalment Payments and the Parent
 * Profile, so the two pages cannot disagree (decideBillingAccess).
 */
export async function billingAccessOf(prisma: PrismaService, actor: Actor): Promise<BillingAccess> {
  const rows = await prisma.$queryRaw<{ ops: OperationsDepartmentRole; sales: SalesDepartmentRole }[]>`
    SELECT chat.operations_department_role(${actor.actorId}::uuid) AS ops,
           chat.sales_department_role(${actor.actorId}::uuid) AS sales`;
  return decideBillingAccess(actor, rows[0]?.ops ?? null, rows[0]?.sales ?? null);
}

/** Does the staff member reach the family (PD-8)? null when they do not. */
export async function reachesFamily(prisma: PrismaService, actor: Actor, familyId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ reach: string | null }[]>`
    SELECT chat.staff_reaches_family(${actor.actorId}::uuid, ${familyId}::uuid) AS reach`;
  return rows[0]?.reach != null;
}
