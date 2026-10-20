import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { AuthorizationService } from '../platform/authorization.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { LessonService, invalid, textField } from './lesson.service';
import { SchedulingService } from './scheduling.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PD-15: what a group's details page shows about each child -- name, age,
 * course, weekly lesson times and package -- and the records behind it: the
 * academy's course list and each child's enrolment details, entered by
 * Operations. Core still bills; nothing here is money.
 *
 * Who reads: whoever may read the conversation (its members, and staff whose
 * PD-8 scope reaches it). A date of birth is staff's; others see the age.
 * Who writes: a child's details, the child's supervisor (Operations), the
 * Teachers department or the super admin (LESSON_ACTS.manage_enrollment); the
 * course list, the super admin and the Operations manager.
 */
@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** Each child a student or family group is about, separately. */
  async groupLearners(actorId: string, conversationId: string) {
    const { conversation } = await this.conversations.readWithMembers(conversationId, actorId);
    const actor = await this.conversations.requireActor(actorId);
    const ids = await this.lessons.learnersOf(conversation);
    if (ids.length === 0) return { learners: [] };
    const staff = actor.kind === ActorKind.STAFF;
    const now = new Date();
    const [learners, enrollments, slots, teachersDepartment, supervised] = await Promise.all([
      this.prisma.learner.findMany({
        where: { id: { in: ids }, organizationId: conversation.organizationId },
        select: { id: true, name: true, familyId: true, teacherId: true, teacher: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.learnerEnrollment.findMany({
        where: { learnerId: { in: ids } },
        include: { course: { select: { id: true, name: true, isActive: true } } },
      }),
      this.prisma.learnerScheduleSlot.findMany({
        where: { learnerId: { in: ids }, validTo: null },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      staff ? this.lessons.isManager(actor) : Promise.resolve(false),
      staff ? this.lessons.supervisedLearnerIds(actor, now) : Promise.resolve([] as string[]),
    ]);
    const enrollmentOf = new Map(enrollments.map((e) => [e.learnerId, e]));
    const supervisedSet = new Set(supervised);
    return {
      learners: learners.map((l) => {
        const e = enrollmentOf.get(l.id);
        const standing = this.authz.lessonStanding(
          actor,
          { organizationId: conversation.organizationId, teacherId: l.teacherId ?? '', familyId: l.familyId },
          { teachersDepartment, supervisesLearner: supervisedSet.has(l.id) },
        );
        const staffView = standing === 'manager' || standing === 'supervisor';
        return {
          id: l.id,
          name: l.name,
          age: e?.birthDate ? ageOn(e.birthDate, now) : null,
          ...(staffView ? { birthDate: e?.birthDate ? e.birthDate.toISOString().slice(0, 10) : null } : {}),
          course: e?.course ? { id: e.course.id, name: e.course.name } : null,
          packageLessons: e?.packageLessons ?? null,
          teacher: l.teacher ? { id: l.teacher.id, name: l.teacher.name } : null,
          schedule: slots
            .filter((s) => s.learnerId === l.id)
            .map((s) => ({ weekday: s.weekday, start: hhmm(s.startMinute), durationMinutes: s.durationMinutes, timezone: s.timezone })),
          canEdit: this.authz.canRecordLessonAct(actor, standing, 'manage_enrollment').allowed,
        };
      }),
    };
  }

  /** A child's details, set by the child's supervisor. Each field present is written; null clears it. */
  async setEnrollment(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const { learner } = await this.scheduling.learnerFor(actor, learnerId, 'manage_enrollment');
    const current = await this.prisma.learnerEnrollment.findUnique({ where: { learnerId: learner.id } });
    const next = {
      birthDate: current?.birthDate ?? null,
      courseId: current?.courseId ?? null,
      packageLessons: current?.packageLessons ?? null,
    };
    if ('birthDate' in body) {
      const v = body.birthDate;
      if (v === null) next.birthDate = null;
      else if (typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        next.birthDate = new Date(`${v}T00:00:00Z`);
      } else throw invalid('birthDate: YYYY-MM-DD, or null');
    }
    if ('courseId' in body) {
      const v = body.courseId;
      if (v === null) next.courseId = null;
      else if (typeof v === 'string' && isUuid(v)) {
        const course = await this.prisma.course.findFirst({ where: { id: v, organizationId: learner.organizationId } });
        if (!course) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'course not found', 404);
        if (!course.isActive && course.id !== current?.courseId) throw invalid('courseId: this course is retired');
        next.courseId = v;
      } else throw invalid('courseId: a course id, or null');
    }
    if ('packageLessons' in body) {
      const v = body.packageLessons;
      if (v === null) next.packageLessons = null;
      else if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000) next.packageLessons = v;
      else throw invalid('packageLessons: an integer from 1 to 1000, or null');
    }

    await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.learnerEnrollment.upsert({
          where: { learnerId: learner.id },
          create: { learnerId: learner.id, organizationId: learner.organizationId, ...next, updatedBy: actor.actorId },
          update: { ...next, updatedBy: actor.actorId },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'learner.enrollment_set',
          entity: 'learner',
          entityId: learner.id,
          before: current
            ? { birthDate: day(current.birthDate), courseId: current.courseId, packageLessons: current.packageLessons }
            : undefined,
          after: { birthDate: day(next.birthDate), courseId: next.courseId, packageLessons: next.packageLessons },
          reason: 'enrolment details set',
        });
      }),
    );
    return { learnerId: learner.id, birthDate: day(next.birthDate), courseId: next.courseId, packageLessons: next.packageLessons };
  }

  /** The course list: any active staff member of the organization reads it (to choose from). */
  async courses(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    this.requireStaff(actor);
    const rows = await this.prisma.course.findMany({
      where: { organizationId: actor.organizationId as string },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return {
      canManage: await this.mayManageCourses(actor),
      courses: rows.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive })),
    };
  }

  async createCourse(actorId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireCourseManager(actor);
    const name = textField(body, 'name', 80, true) as string;
    const course = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.course.create({ data: { organizationId: actor.organizationId as string, name, createdBy: actor.actorId } });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'course.created', entity: 'course', entityId: created.id,
          after: { name }, reason: 'course added',
        });
        return created;
      }),
    );
    return { id: course.id, name: course.name, isActive: course.isActive };
  }

  /** Rename or retire / restore a course. A retired course stays on the children who have it. */
  async updateCourse(actorId: string, courseId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireCourseManager(actor);
    if (!isUuid(courseId)) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'course not found', 404);
    const course = await this.prisma.course.findFirst({ where: { id: courseId, organizationId: actor.organizationId as string } });
    if (!course) throw new CommError(CommErrorCode.LESSON_NOT_FOUND, 'course not found', 404);
    const name = 'name' in body ? (textField(body, 'name', 80, true) as string) : course.name;
    if ('isActive' in body && typeof body.isActive !== 'boolean') throw invalid('isActive: true or false');
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : course.isActive;
    const updated = await this.lessons.write(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.course.update({ where: { id: course.id }, data: { name, isActive } });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'course.updated', entity: 'course', entityId: course.id,
          before: { name: course.name, isActive: course.isActive }, after: { name, isActive },
          reason: isActive === course.isActive ? 'course renamed' : isActive ? 'course restored' : 'course retired',
        });
        return row;
      }),
    );
    return { id: updated.id, name: updated.name, isActive: updated.isActive };
  }

  // ------------------------------------------------------------------

  private requireStaff(actor: Actor) {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'the course list is staff\'s');
    }
  }

  /** The super admin, or the manager of the Operations department. */
  private async mayManageCourses(actor: Actor): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return false;
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return true;
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM chat.department d
                      WHERE d.organization_id = ${actor.organizationId}::uuid AND d.kind = 'operations'
                        AND d.manager_id = ${actor.actorId}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  private async requireCourseManager(actor: Actor) {
    this.requireStaff(actor);
    if (!(await this.mayManageCourses(actor))) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'courses are managed by the Operations manager or the super admin');
    }
  }
}

/** Whole years between a date of birth and `at` (UTC calendar dates). */
export function ageOn(birth: Date, at: Date): number {
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < birth.getUTCMonth()
    || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function day(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
