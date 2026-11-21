import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { LessonService, invalid } from './lesson.service';

/** PD-60: the page size is bounded on the server, whatever the client asks. */
export const STUDENTS_DEFAULT_LIMIT = 25;
export const STUDENTS_MAX_LIMIT = 100;
export const STUDENTS_MAX_PAGE = 10_000;
export const STUDENTS_MAX_SEARCH = 100;
/** The accessible set read to build the filter choices (the Schedules roster reads 5000; this has room). */
const FACET_SCAN = 20_000;

export type StudentStatus = 'active' | 'paused' | 'stopped';

export interface StudentsQuery {
  q: string | null;
  /** A teacher id, or 'none' for students with no teacher. */
  teacher: string | null;
  supervisor: string | null;
  status: StudentStatus | null;
  page: number;
  limit: number;
}

const one = (v: unknown): string | undefined => (Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : undefined) : typeof v === 'string' ? v : undefined);

function intField(raw: string | undefined, key: string, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,9}$/.test(raw)) throw invalid(`${key}: a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw invalid(`${key}: between ${min} and ${max}`);
  return n;
}

/** Reads the query string; anything malformed is refused (400), never guessed. */
export function parseStudentsQuery(raw: Record<string, unknown>): StudentsQuery {
  const q = (one(raw.q) ?? '').trim();
  if (q.length > STUDENTS_MAX_SEARCH) throw invalid(`q: at most ${STUDENTS_MAX_SEARCH} characters`);
  const teacher = one(raw.teacher) ?? '';
  if (teacher !== '' && teacher !== 'none' && !isUuid(teacher)) throw invalid('teacher: an id, or none');
  const supervisor = one(raw.supervisor) ?? '';
  if (supervisor !== '' && !isUuid(supervisor)) throw invalid('supervisor: an id');
  const status = one(raw.status) ?? '';
  if (status !== '' && status !== 'active' && status !== 'paused' && status !== 'stopped') throw invalid('status: active, paused or stopped');
  return {
    q: q === '' ? null : q,
    teacher: teacher === '' ? null : teacher,
    supervisor: supervisor === '' ? null : supervisor,
    status: status === '' ? null : status,
    page: intField(one(raw.page), 'page', 1, 1, STUDENTS_MAX_PAGE),
    limit: intField(one(raw.limit), 'limit', STUDENTS_DEFAULT_LIMIT, 1, STUDENTS_MAX_LIMIT),
  };
}

/**
 * PD-60: the Students page's list. It adds no new rule: a row is a student
 * whose profile (GET /learners/:id/profile) the caller may already open --
 * the super admin and the Teachers department for the teachers in its scope
 * (PD-35), and a supervisor for the children they supervise. A teacher, a
 * parent, or staff who supervise nobody and are not the Teachers department
 * are refused. Essential facts only: no contact, birth date or money.
 */
@Injectable()
export class StudentDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
  ) {}

  async list(actorId: string, raw: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const deny = () => new CommError(CommErrorCode.LESSON_DENIED, 'the student list is for the administration');
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) throw deny();
    const query = parseStudentsQuery(raw);
    const org = actor.organizationId;

    const superAdmin = actor.staffRole === StaffRole.SUPER_ADMIN;
    const department = superAdmin || (await this.lessons.isManager(actor));
    const supervised = await this.lessons.supervisedLearnerIds(actor, new Date());
    if (!department && supervised.length === 0) throw deny();

    // The accessible set: exactly the learnerFor 'manager' | 'supervisor' standings.
    const access: Prisma.LearnerWhereInput[] = [];
    if (department) {
      const scope = superAdmin ? { all: true, teacherIds: new Set<string>() } : await this.lessons.teacherScope.scopeOf(actor);
      access.push(scope.all ? {} : { teacherId: { in: [...scope.teacherIds] } });
    }
    if (supervised.length > 0) access.push({ id: { in: supervised } });
    const accessible: Prisma.LearnerWhereInput = { organizationId: org, OR: access };

    const and: Prisma.LearnerWhereInput[] = [accessible];
    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { family: { displayName: { contains: query.q, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.teacher === 'none') and.push({ teacherId: null });
    else if (query.teacher) and.push({ teacherId: query.teacher });
    if (query.supervisor) {
      const rows = await this.prisma.learnerSupervision.findMany({ where: { organizationId: org, supervisorId: query.supervisor }, select: { learnerId: true } });
      and.push({ id: { in: rows.map((r) => r.learnerId) } });
    }
    if (query.status) {
      const kind = query.status === 'paused' ? 'temporary' : 'permanent';
      const susp = query.status === 'active' ? { organizationId: org, status: 'active' } : { organizationId: org, status: 'active', kind };
      const ids = (await this.prisma.learnerSuspension.findMany({ where: susp, select: { learnerId: true } })).map((r) => r.learnerId);
      and.push(query.status === 'active' ? { id: { notIn: ids } } : { id: { in: ids } });
    }
    const where: Prisma.LearnerWhereInput = { AND: and };

    const [total, rows, scan] = await Promise.all([
      this.prisma.learner.count({ where }),
      this.prisma.learner.findMany({
        where,
        select: {
          id: true,
          name: true,
          teacherId: true,
          family: { select: { id: true, displayName: true } },
          teacher: { select: { id: true, name: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.learner.findMany({ where: accessible, select: { id: true, teacherId: true }, take: FACET_SCAN }),
    ]);

    const ids = rows.map((r) => r.id);
    const [suspensions, slots, supervision] = await Promise.all([
      this.prisma.learnerSuspension.findMany({ where: { organizationId: org, status: 'active', learnerId: { in: ids } }, select: { learnerId: true, kind: true, returnOn: true } }),
      this.prisma.learnerScheduleSlot.groupBy({ by: ['learnerId'], where: { organizationId: org, validTo: null, learnerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.learnerSupervision.findMany({ where: { organizationId: org, learnerId: { in: ids } }, select: { learnerId: true, supervisorId: true } }),
    ]);
    const scanIds = scan.map((r) => r.id);
    const teacherIds = [...new Set(scan.map((r) => r.teacherId).filter((t): t is string => t !== null))];
    const [facetTeachers, facetSupervision] = await Promise.all([
      teacherIds.length ? this.prisma.teacher.findMany({ where: { organizationId: org, id: { in: teacherIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
      scanIds.length ? this.prisma.learnerSupervision.findMany({ where: { organizationId: org, learnerId: { in: scanIds } }, select: { supervisorId: true } }) : Promise.resolve([]),
    ]);
    const supervisorIds = [...new Set([...facetSupervision.map((r) => r.supervisorId), ...supervision.map((r) => r.supervisorId)])];
    const staff = supervisorIds.length ? await this.prisma.staff.findMany({ where: { organizationId: org, id: { in: supervisorIds } }, select: { id: true, name: true } }) : [];
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    const suspensionOf = new Map(suspensions.map((s) => [s.learnerId, s]));
    const slotCount = new Map(slots.map((s) => [s.learnerId, s._count._all]));
    const supervisorOf = new Map(supervision.map((s) => [s.learnerId, s.supervisorId]));

    return {
      page: query.page,
      limit: query.limit,
      total,
      students: rows.map((l) => {
        const s = suspensionOf.get(l.id);
        const sup = supervisorOf.get(l.id);
        return {
          id: l.id,
          name: l.name,
          family: { id: l.family.id, displayName: l.family.displayName },
          teacher: l.teacher ? { id: l.teacher.id, name: l.teacher.name } : null,
          supervisor: sup && staffName.has(sup) ? { id: sup, name: staffName.get(sup) as string } : null,
          status: (s ? (s.kind === 'permanent' ? 'stopped' : 'paused') : 'active') as StudentStatus,
          returnOn: s?.returnOn ? s.returnOn.toISOString().slice(0, 10) : null,
          weeklySlots: slotCount.get(l.id) ?? 0,
        };
      }),
      filters: {
        teachers: facetTeachers.map((t) => ({ id: t.id, name: t.name })),
        supervisors: supervisorIds
          .filter((id) => staffName.has(id))
          .map((id) => ({ id, name: staffName.get(id) as string }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  }
}
