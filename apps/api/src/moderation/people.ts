import type { PrismaService } from '../platform/prisma.service';
import type { Prisma } from '@prisma/client';
import { StaffRole } from '../communication/contracts/vocab';
import type { SubjectKind } from './dto';

type Db = PrismaService | Prisma.TransactionClient;

export interface Person {
  kind: SubjectKind;
  id: string;
  name: string;
  organizationId: string;
  accountId: string | null;
  isActive: boolean;
  /** Staff only. */
  role: string | null;
}

/** One principal of the given kind, or null. Reads the principal row only. */
export async function personOf(db: Db, kind: SubjectKind, id: string): Promise<Person | null> {
  switch (kind) {
    case 'contact': {
      const c = await db.contact.findUnique({ where: { id }, select: { id: true, name: true, organizationId: true, accountId: true, isActive: true } });
      return c && { kind, id: c.id, name: c.name, organizationId: c.organizationId, accountId: c.accountId, isActive: c.isActive, role: null };
    }
    case 'teacher': {
      const t = await db.teacher.findUnique({ where: { id }, select: { id: true, name: true, organizationId: true, accountId: true, isActive: true } });
      return t && { kind, id: t.id, name: t.name, organizationId: t.organizationId, accountId: t.accountId, isActive: t.isActive, role: null };
    }
    case 'staff': {
      const s = await db.staff.findUnique({ where: { id }, select: { id: true, name: true, organizationId: true, accountId: true, isActive: true, role: true } });
      return s && { kind, id: s.id, name: s.name, organizationId: s.organizationId, accountId: s.accountId, isActive: s.isActive, role: s.role };
    }
  }
}

/**
 * The administrative channel (roadmap §6.1 rule 6, applied to reports by the
 * ENG-02 brief): a manager and the Super Admin are never a report's subject.
 * The academy's official account is the system actor, which is no person
 * kind at all and is refused before this is asked.
 */
export function isProtectedSubject(p: Pick<Person, 'kind' | 'role'>): boolean {
  return p.kind === 'staff' && (p.role === StaffRole.MANAGER || p.role === StaffRole.SUPER_ADMIN);
}

/** The live names of the people some reports are about, keyed `${kind}:${id}` (dto.subjectKey). */
export async function subjectNames(
  db: Db,
  rows: ReadonlyArray<{ subjectKind: string; subjectId: string }>,
): Promise<Map<string, string>> {
  const ids = (kind: SubjectKind) => [...new Set(rows.filter((r) => r.subjectKind === kind).map((r) => r.subjectId))];
  const [contacts, teachers, staff] = await Promise.all([
    ids('contact').length ? db.contact.findMany({ where: { id: { in: ids('contact') } }, select: { id: true, name: true } }) : [],
    ids('teacher').length ? db.teacher.findMany({ where: { id: { in: ids('teacher') } }, select: { id: true, name: true } }) : [],
    ids('staff').length ? db.staff.findMany({ where: { id: { in: ids('staff') } }, select: { id: true, name: true } }) : [],
  ]);
  return new Map([
    ...contacts.map((c) => [`contact:${c.id}`, c.name] as [string, string]),
    ...teachers.map((t) => [`teacher:${t.id}`, t.name] as [string, string]),
    ...staff.map((s) => [`staff:${s.id}`, s.name] as [string, string]),
  ]);
}

/** Display names of staff ids, for the reviewer columns of the staff responses. */
export async function staffNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.staff.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}
