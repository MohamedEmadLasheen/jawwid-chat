import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import type { SubjectKind } from './dto';

type Db = PrismaService | Prisma.TransactionClient;

export interface Party {
  kind: SubjectKind;
  id: string;
}

/**
 * PD-57 closure plan 2026-11-06 §3 (D-3): a report's departments, worked out
 * when it is filed and stored once in chat.content_report.department_ids. The
 * managers and moderators of these departments see the report; nobody else
 * but the Super Admin (and, for child_safety, holders of
 * moderation.child_safety, which ignores departments).
 *
 *   staff     the departments they manage (department.manager_id) or belong
 *             to (department_member)
 *   teacher   the departments of the teacher's PD-35 supervisor
 *             (chat.teacher_supervisor_assignment), else the organization's
 *             `teachers` department
 *   contact   the departments of the PD-8 supervisors of the family's
 *             children (chat.learner_supervision), else the `operations`
 *             department
 *
 * `alsoFor` adds the other side's departments (ENG-03: a block's case adds the
 * blocker's side, so the managers told of the block can open it). Deduplicated
 * and sorted. Empty when nothing applies (no department at all): the Super
 * Admin only.
 */
export async function reportDepartments(db: Db, subject: Party, opts: { alsoFor?: Party } = {}): Promise<string[]> {
  const ids = new Set(await departmentsFor(db, subject));
  if (opts.alsoFor) for (const id of await departmentsFor(db, opts.alsoFor)) ids.add(id);
  return [...ids].sort();
}

async function departmentsFor(db: Db, party: Party): Promise<string[]> {
  switch (party.kind) {
    case 'staff':
      return staffDepartments(db, [party.id]);
    case 'teacher': {
      const teacher = await db.teacher.findUnique({ where: { id: party.id }, select: { organizationId: true } });
      if (!teacher) return [];
      const rows = await db.$queryRaw<Array<{ supervisor_id: string }>>`
        SELECT supervisor_id::text AS supervisor_id FROM chat.teacher_supervisor_assignment
         WHERE teacher_id = ${party.id}::uuid AND organization_id = ${teacher.organizationId}::uuid`;
      const found = await staffDepartments(db, rows.map((r) => r.supervisor_id));
      return found.length ? found : departmentOfKind(db, teacher.organizationId, 'teachers');
    }
    case 'contact': {
      const contact = await db.contact.findUnique({ where: { id: party.id }, select: { organizationId: true, familyId: true } });
      if (!contact) return [];
      const rows = await db.$queryRaw<Array<{ supervisor_id: string }>>`
        SELECT DISTINCT ls.supervisor_id::text AS supervisor_id
          FROM chat.learner l
          JOIN chat.learner_supervision ls ON ls.learner_id = l.id
         WHERE l.family_id = ${contact.familyId}::uuid AND l.organization_id = ${contact.organizationId}::uuid`;
      const found = await staffDepartments(db, rows.map((r) => r.supervisor_id));
      return found.length ? found : departmentOfKind(db, contact.organizationId, 'operations');
    }
  }
}

/**
 * The departments some staff manage or belong to. Exported: it is also the
 * moderation scope's question about the reviewer (moderation-scope.ts).
 */
export async function staffDepartments(db: Db, staffIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(staffIds)];
  if (!ids.length) return [];
  const [managed, member] = await Promise.all([
    db.department.findMany({ where: { managerId: { in: ids } }, select: { id: true } }),
    db.departmentMember.findMany({ where: { staffId: { in: ids } }, select: { departmentId: true } }),
  ]);
  return [...new Set([...managed.map((d) => d.id), ...member.map((m) => m.departmentId)])];
}

async function departmentOfKind(db: Db, organizationId: string, kind: 'teachers' | 'operations'): Promise<string[]> {
  const d = await db.department.findUnique({ where: { organizationId_kind: { organizationId, kind } }, select: { id: true } });
  return d ? [d.id] : [];
}
