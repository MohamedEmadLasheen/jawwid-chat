import type { PrismaService } from '../platform/prisma.service';
import type { Actor } from '../platform/types';
import {
  decideBillingAccess,
  type BillingAccess,
  type OperationsDepartmentRole,
  type SalesDepartmentRole,
  type SalesFamilyScope,
} from '../platform/pd012-policy';

/**
 * Who may read and record a family's money, and open the Parent Profile
 * (PD-17): the super admin and the Operations Manager every family, an
 * Operations supervisor (or coverage) the families they reach
 * (chat.staff_reaches_family), the Sales department every family (to record
 * payments) -- or, PD-42, while the Sales switch is 'own', a Sales member the
 * families they own; a Sales account edits the contact record of the families
 * it owns only. Never a teacher, a parent or
 * the Teachers department. One rule for Instalment Payments and the Parent
 * Profile, so the two pages cannot disagree (decideBillingAccess).
 */
export async function billingAccessOf(prisma: PrismaService, actor: Actor): Promise<BillingAccess> {
  const rows = await prisma.$queryRaw<{ ops: OperationsDepartmentRole; sales: SalesDepartmentRole; scope: SalesFamilyScope }[]>`
    SELECT chat.operations_department_role(${actor.actorId}::uuid) AS ops,
           chat.sales_department_role(${actor.actorId}::uuid) AS sales,
           chat.sales_family_scope() AS scope`;
  return decideBillingAccess(actor, rows[0]?.ops ?? null, rows[0]?.sales ?? null, rows[0]?.scope === 'own' ? 'own' : 'all');
}

/** PD-42: is the family the staff member's own (chat.staff_owns_family)? */
export async function ownsFamily(prisma: PrismaService, actor: Actor, familyId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ owns: boolean }[]>`
    SELECT chat.staff_owns_family(${actor.actorId}::uuid, ${familyId}::uuid) AS owns`;
  return rows[0]?.owns === true;
}

/**
 * PD-42: the contact records a Sales account edits (BillingAccess.editOwnedOnly):
 * a Sales member, the families they own; the Sales manager, every family that
 * has a Sales owner (read-only elsewhere, as PD-17 had it).
 */
export async function salesEditsFamily(prisma: PrismaService, actor: Actor, familyId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ edits: boolean }[]>`
    SELECT CASE WHEN chat.sales_department_role(${actor.actorId}::uuid) = 'manager'
                THEN EXISTS (SELECT 1 FROM chat.family_sales_owner o WHERE o.family_id = ${familyId}::uuid)
                ELSE chat.staff_owns_family(${actor.actorId}::uuid, ${familyId}::uuid) END AS edits`;
  return rows[0]?.edits === true;
}

/** Is the family inside `access.scope` for this actor (all, reach or owned)? */
export async function familyInScope(prisma: PrismaService, actor: Actor, access: BillingAccess, familyId: string): Promise<boolean> {
  if (access.scope === 'all') return true;
  if (access.scope === 'reach') return reachesFamily(prisma, actor, familyId);
  if (access.scope === 'owned') return ownsFamily(prisma, actor, familyId);
  return false;
}

/** Does the staff member reach the family (PD-8)? null when they do not. */
export async function reachesFamily(prisma: PrismaService, actor: Actor, familyId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ reach: string | null }[]>`
    SELECT chat.staff_reaches_family(${actor.actorId}::uuid, ${familyId}::uuid) AS reach`;
  return rows[0]?.reach != null;
}
