import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { NO_ACCOUNT_ADMIN_STANDING, type AccountAdminStanding } from './account-admin-policy';
import type { OperationsDepartmentRole, SalesDepartmentRole, TeachersDepartmentRole } from './pd012-policy';
import type { PrismaService } from './prisma.service';
import type { Actor } from './types';

type Queryable = Pick<PrismaService, '$queryRaw'>;

/**
 * The department roles accountAdminActs() decides on, read in one query. The
 * super admin needs none; anyone who is not staff has none.
 */
export async function accountAdminStandingOf(prisma: Queryable, actor: Actor): Promise<AccountAdminStanding> {
  if (actor.kind !== ActorKind.STAFF || actor.staffRole === StaffRole.SUPER_ADMIN) return NO_ACCOUNT_ADMIN_STANDING;
  const rows = await prisma.$queryRaw<
    { ops: OperationsDepartmentRole; teachers: TeachersDepartmentRole; sales: SalesDepartmentRole }[]
  >`
    SELECT chat.operations_department_role(${actor.actorId}::uuid) AS ops,
           chat.teachers_department_role(${actor.actorId}::uuid) AS teachers,
           chat.sales_department_role(${actor.actorId}::uuid) AS sales`;
  const row = rows[0];
  return { operations: row?.ops ?? null, teachers: row?.teachers ?? null, sales: row?.sales ?? null };
}
