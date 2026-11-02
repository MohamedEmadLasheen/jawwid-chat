import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { decisionForStep, Decision } from '../discipline/ladder';
import type { AuditService } from '../platform/audit.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { PermissionService } from '../platform/permissions/permission.service';
import { PrismaService } from '../platform/prisma.service';
import { decideTeacherRecordsAccess, type TeacherRecordsAccess } from '../platform/teacher-records-policy';
import { pageRowVisible, scopeCovers, type PageScope } from '../platform/teacher-scope';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { Actor } from '../platform/types';
import { complaintAbout, familiesOfComplaints } from './complaint-family';
import { ParentFeedbackService } from './parent-feedback.service';
import { ENTRY_VOID, TeacherFileService, mapTimelineRefusal } from './teacher-file.service';

/**
 * PD-52: the two teacher-records pages (Attendance & Complaints, Grants &
 * Testimonials). They read the records the PD-26 page already reads; this
 * service adds what is new -- staff testimonials, the correction of a
 * complaint or testimonial entered by mistake, the parents' praise read in
 * place, and one teacher's summary strip. Lives under src/teacher-file: the
 * pages read supervision entries and parent feedback, which only this module
 * may read.
 *
 * Every row is narrowed exactly as on the PD-26 page: the teachers of the
 * caller's basis (TeacherScopeService.pageRowsOf), and of an Operations-only
 * teacher only the rows about the caller's own students and families.
 */
export const TESTIMONIAL = 'testimonial';
export const TESTIMONIAL_SOURCES = ['parent_message', 'parent_call', 'staff_observation', 'other'] as const;

const BODY_MAX = 2000;
const REASON_MAX = 500;
const LIST_LIMIT = 500;
const MONTH = /^\d{4}-\d{2}$/;

type Entry = Prisma.TeacherSupervisionEntryGetPayload<object>;

@Injectable()
export class TeacherRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly files: TeacherFileService,
    private readonly feedback: ParentFeedbackService,
    private readonly permissions: PermissionService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** Which pages and which actions, per basis and key. Advisory: every route decides again. */
  async access(actorId: string): Promise<TeacherRecordsAccess> {
    const actor = await this.conversations.requireActor(actorId);
    return this.accessOf(actor);
  }

  // ------------------------------------------------------------------
  // Testimonials (page B)
  // ------------------------------------------------------------------

  /**
   * The parents' praise (chat.parent_feedback, read in place) and the staff's
   * testimonials, newest first. `teacher` narrows to one teacher, `month`
   * (YYYY-MM) to one month; a voided testimonial shows only with
   * `voided=include`.
   */
  async testimonials(actorId: string, query: { teacher?: string; month?: string; voided?: string }) {
    const { actor, access, page } = await this.ctx(actorId, (a) => a.grants.view);
    const teacherId = await this.teacherFilter(actor, page, query.teacher);
    const range = monthRange(query.month);
    if (query.voided !== undefined && query.voided !== 'include') throw invalid('voided', 'must be include');

    const staffRows = await this.visibleTestimonials(actor, page, { teacherId, ...range });
    const voids = await this.voidsOf(staffRows.map((r) => r.id));
    const praise = await this.feedback.praise(actor, page, { teacherId, ...range });

    const names = await this.names(staffRows, [...voids.values()]);
    const staff = staffRows
      .map((r) => ({
        id: r.id,
        origin: 'staff' as const,
        teacher: { id: r.teacherId, name: names.teacher.get(r.teacherId) ?? '' },
        body: r.body,
        createdAt: r.createdAt,
        source: r.testimonialSource,
        child: r.learnerId ? { id: r.learnerId, name: names.learner.get(r.learnerId) ?? '' } : null,
        familyId: r.familyId,
        prospect: r.trialProspectId ? { id: r.trialProspectId, name: names.prospect.get(r.trialProspectId) ?? '' } : null,
        author: r.createdBy ? { id: r.createdBy, name: names.staff.get(r.createdBy) ?? '' } : null,
        parent: null,
        status: null,
        response: null,
        voided: voids.has(r.id) ? brief(voids.get(r.id) as Entry, names.staff) : null,
      }))
      .filter((t) => query.voided === 'include' || t.voided === null);
    const parents = praise.map((f) => ({
      id: f.id,
      origin: 'parent' as const,
      teacher: f.teacher,
      body: f.body,
      createdAt: f.createdAt,
      source: 'parent_app' as const,
      child: f.child,
      familyId: f.familyId,
      prospect: null,
      author: null,
      parent: f.parent,
      status: f.status,
      response: f.response,
      voided: null,
    }));
    const testimonials = [...staff, ...parents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
    return { canRecord: access.grants.record, testimonials };
  }

  /** A staff-recorded testimonial: how it reached the academy, and who it is about (optional). */
  async recordTestimonial(
    actorId: string,
    teacherId: string,
    body: { body?: unknown; source?: unknown; learnerId?: unknown; familyId?: unknown; prospectId?: unknown; conversationId?: unknown },
  ) {
    const { actor, page } = await this.ctx(actorId, (a) => a.grants.record);
    const teacher = await this.files.requireTeacher(actor, teacherId, 'page');
    const whole = scopeCovers(page.whole, teacher.id);
    const text = requireText('body', body.body, BODY_MAX);
    if (typeof body.source !== 'string' || !(TESTIMONIAL_SOURCES as readonly string[]).includes(body.source)) {
      throw invalid('source', `must be one of ${TESTIMONIAL_SOURCES.join(', ')}`);
    }
    const about = await this.files.aboutOf(actor, body, whole, page);
    const conversationId =
      body.conversationId === undefined || body.conversationId === null ? undefined : await this.files.readableSource(actor, body.conversationId);
    const row = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const created = await tx.teacherSupervisionEntry.create({
        data: {
          organizationId: teacher.organizationId,
          teacherId: teacher.id,
          kind: TESTIMONIAL,
          body: text,
          testimonialSource: body.source as string,
          conversationId,
          createdBy: actor.actorId,
          ...about,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.entry_added',
        entity: 'teacher',
        entityId: teacher.id,
        after: { entryId: created.id, kind: TESTIMONIAL, source: body.source, learnerId: about.learnerId ?? null, familyId: about.familyId ?? null },
        // The text stays in the record: the audit trail is read more widely.
        reason: 'supervision entry: testimonial',
      });
      return created;
    });
    return { id: row.id, kind: row.kind, createdAt: row.createdAt };
  }

  // ------------------------------------------------------------------
  // Corrections (both pages)
  // ------------------------------------------------------------------

  /**
   * A complaint or testimonial entered by mistake: an `entry_void` row with
   * the reason. Once per record; the record is hidden by default and never
   * deleted. A complaint needs the decide right (page A), a testimonial the
   * record right (page B). A parent's own complaint is answered, never voided,
   * and a complaint already resolved or upheld keeps its history (the
   * database refuses both too).
   */
  async voidEntry(actorId: string, entryId: string, body: { reason?: unknown }) {
    const { actor, access, page } = await this.ctx(actorId, (a) => a.attendance.decide || a.grants.record);
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'record not found');
    if (!isUuid(entryId)) throw notFound;
    const target = await this.prisma.teacherSupervisionEntry.findUnique({ where: { id: entryId } });
    if (!target || target.organizationId !== actor.organizationId || (target.kind !== 'complaint' && target.kind !== TESTIMONIAL)) throw notFound;
    if (!(await this.rowVisible(page, target))) throw notFound;
    if (target.kind === 'complaint' ? !access.attendance.decide : !access.grants.record) {
      throw new CommError(CommErrorCode.TEACHER_FILE_DENIED, 'correcting this record is not yours to do');
    }
    if (target.parentFeedbackId) {
      throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, "a parent's own complaint is answered, never voided", 409);
    }
    const reason = requireText('reason', body.reason, REASON_MAX);
    const row = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const created = await tx.teacherSupervisionEntry.create({
        data: {
          organizationId: target.organizationId,
          teacherId: target.teacherId,
          kind: ENTRY_VOID,
          body: reason,
          refersTo: target.id,
          createdBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'teacher_file.entry_voided',
        entity: 'teacher',
        entityId: target.teacherId,
        after: { entryId: created.id, voids: target.id, kind: target.kind },
        reason,
      });
      return created;
    });
    return { id: row.id, voids: target.id, createdAt: row.createdAt };
  }

  // ------------------------------------------------------------------
  // One teacher (both pages)
  // ------------------------------------------------------------------

  /**
   * The strip above either page when one teacher is chosen. Computed on read
   * from the same records, never stored. Counts cover only the rows the caller
   * can see, except the ladder count, which is the teacher's (it sets the next
   * step, as GET /teachers/:id/discipline counts it).
   */
  async summary(actorId: string, teacherId: string) {
    const { actor, access, page } = await this.ctx(actorId, (a) => a.attendance.view || a.grants.view);
    const teacher = await this.files.requireTeacher(actor, teacherId, 'page');
    const [{ today }] = await this.prisma.$queryRaw<Array<{ today: string }>>`SELECT chat.academy_today()::text AS today`;
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);
    const yearRange = { from: new Date(`${year}-01-01T00:00:00Z`), to: new Date(`${Number(year) + 1}-01-01T00:00:00Z`) };

    const [away, violations, complaints, bonuses, testimonials, praise] = await Promise.all([
      this.files.awayToday([teacher.id]),
      this.prisma.teacherViolation.findMany({
        where: { teacherId: teacher.id, month: new Date(`${month}-01T00:00:00Z`) },
        select: { lessonId: true, kind: true, decision: true },
      }),
      this.prisma.teacherSupervisionEntry.findMany({ where: { teacherId: teacher.id, kind: 'complaint' }, take: LIST_LIMIT }),
      this.prisma.teacherSupervisionEntry.findMany({
        where: { teacherId: teacher.id, kind: 'bonus', createdAt: { gte: yearRange.from, lt: yearRange.to } },
        take: LIST_LIMIT,
      }),
      this.visibleTestimonials(actor, page, { teacherId: teacher.id, ...yearRange }),
      this.feedback.praise(actor, page, { teacherId: teacher.id, ...yearRange }),
    ]);

    const counted = (await this.standing(violations)).filter((v) => v.decision !== Decision.EXCUSED).length;
    const familyOf = await familiesOfComplaints(this.prisma, complaints);
    const shownComplaints = complaints.filter((c) => pageRowVisible(page, c.teacherId, complaintAbout(c, familyOf)));
    const closed = await this.prisma.teacherSupervisionEntry.findMany({
      where: { refersTo: { in: shownComplaints.map((c) => c.id) }, kind: { in: ['complaint_resolution', ENTRY_VOID] } },
      select: { refersTo: true },
    });
    const closedIds = new Set(closed.map((c) => c.refersTo));
    const voidedTestimonials = await this.voidsOf(testimonials.map((t) => t.id));
    const shownBonuses = bonuses.filter((b) => pageRowVisible(page, b.teacherId, aboutOf(b)));

    return {
      teacher: { id: teacher.id, name: teacher.name, isActive: teacher.isActive && teacher.leftAt === null },
      away: away.get(teacher.id) ?? null,
      ladder: { month, counted, nextStep: decisionForStep(counted + 1) },
      openComplaints: shownComplaints.filter((c) => !closedIds.has(c.id)).length,
      year,
      grants: shownBonuses.length,
      testimonials: testimonials.filter((t) => !voidedTestimonials.has(t.id)).length + praise.length,
      opensFile: access.opensFile,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async accessOf(actor: Actor): Promise<TeacherRecordsAccess> {
    const [inputs, profile] = await Promise.all([this.files.recordsInputs(actor), this.permissions.profileOf(actor)]);
    return decideTeacherRecordsAccess({ ...inputs, keys: profile.permissions });
  }

  private async ctx(actorId: string, needs: (a: TeacherRecordsAccess) => boolean): Promise<{ actor: Actor; access: TeacherRecordsAccess; page: PageScope }> {
    const actor = await this.conversations.requireActor(actorId);
    const access = await this.accessOf(actor);
    if (!needs(access)) {
      throw new CommError(
        CommErrorCode.TEACHER_FILE_DENIED,
        access.basis === null ? 'the teacher-records pages are for the Teachers department and Operations' : 'this is not yours to do on the teacher-records pages',
      );
    }
    return { actor, access, page: await this.files.teacherScope.pageRowsOf(actor) };
  }

  /** A `teacher` filter: a teacher outside the caller's scope is not found (PD-35). */
  private async teacherFilter(actor: Actor, page: PageScope, raw: string | undefined): Promise<string | undefined> {
    if (raw === undefined || raw === '') return undefined;
    return (await this.files.requireTeacher(actor, raw, 'page')).id;
  }

  /** Staff testimonials the caller may see, newest first. */
  private async visibleTestimonials(actor: Actor, page: PageScope, q: { teacherId?: string; from?: Date; to?: Date }): Promise<Entry[]> {
    const scope = page.teachers;
    const rows = await this.prisma.teacherSupervisionEntry.findMany({
      where: {
        organizationId: actor.organizationId as string,
        kind: TESTIMONIAL,
        ...(q.teacherId ? { teacherId: q.teacherId } : scope.all ? {} : { teacherId: { in: [...scope.teacherIds] } }),
        ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: LIST_LIMIT,
    });
    return rows.filter((r) => pageRowVisible(page, r.teacherId, aboutOf(r)));
  }

  private async rowVisible(page: PageScope, row: Entry): Promise<boolean> {
    if (row.kind === 'complaint') {
      return pageRowVisible(page, row.teacherId, complaintAbout(row, await familiesOfComplaints(this.prisma, [row])));
    }
    return pageRowVisible(page, row.teacherId, aboutOf(row));
  }

  private async voidsOf(ids: string[]): Promise<Map<string, Entry>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.teacherSupervisionEntry.findMany({ where: { refersTo: { in: ids }, kind: ENTRY_VOID } });
    return new Map(rows.map((r) => [r.refersTo as string, r]));
  }

  /** A violation stands unless its lesson was corrected since (DisciplineService.standing). */
  private async standing<T extends { lessonId: string | null; kind: string; decision: string | null }>(rows: T[]): Promise<T[]> {
    const open = rows.filter((r) => r.decision === null && r.lessonId !== null);
    if (open.length === 0) return rows;
    const lessons = await this.prisma.lesson.findMany({
      where: { id: { in: [...new Set(open.map((r) => r.lessonId as string))] } },
      select: { id: true, outcome: true },
    });
    const outcomeOf = new Map(lessons.map((l) => [l.id, l.outcome]));
    return rows.filter((r) => r.decision !== null || r.lessonId === null || outcomeOf.get(r.lessonId) === (r.kind === 'late' ? 'held' : r.kind));
  }

  private async names(rows: Entry[], voids: Entry[]) {
    const ids = (pick: (e: Entry) => string | null) => [...new Set(rows.map(pick).filter((x): x is string => !!x))];
    const staffIds = [...new Set([...rows, ...voids].map((e) => e.createdBy).filter((x): x is string => !!x))];
    const [teachers, learners, prospects, staff] = await Promise.all([
      this.prisma.teacher.findMany({ where: { id: { in: ids((e) => e.teacherId) } }, select: { id: true, name: true } }),
      this.prisma.learner.findMany({ where: { id: { in: ids((e) => e.learnerId) } }, select: { id: true, name: true } }),
      this.prisma.trialProspect.findMany({ where: { id: { in: ids((e) => e.trialProspectId) } }, select: { id: true, displayName: true } }),
      this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }),
    ]);
    return {
      teacher: new Map(teachers.map((t) => [t.id, t.name])),
      learner: new Map(learners.map((l) => [l.id, l.name])),
      prospect: new Map(prospects.map((p) => [p.id, p.displayName])),
      staff: new Map(staff.map((s) => [s.id, s.name])),
    };
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw mapTimelineRefusal(e);
    }
  }
}

/**
 * What a testimonial or grant is about, for pageRowVisible: its student, else
 * its family; a trial family is not one of anybody's PD-8 families
 * (`{ learnerId: null }`); none of them -- teacher-level (null).
 */
export function aboutOf(row: { learnerId: string | null; familyId: string | null; trialProspectId: string | null }) {
  if (row.learnerId) return { learnerId: row.learnerId, familyId: row.familyId };
  if (row.familyId) return { familyId: row.familyId };
  if (row.trialProspectId) return { learnerId: null };
  return null;
}

/** `month` (YYYY-MM) as a [from, to) range; none for no month. */
export function monthRange(month: string | undefined): { from?: Date; to?: Date } {
  if (month === undefined || month === '') return {};
  if (!MONTH.test(month)) throw invalid('month', 'must be YYYY-MM');
  const [y, m] = month.split('-').map(Number) as [number, number];
  if (m < 1 || m > 12) throw invalid('month', 'must be YYYY-MM');
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

function brief(e: Entry, staff: ReadonlyMap<string, string>) {
  return { id: e.id, body: e.body, createdAt: e.createdAt, author: e.createdBy ? { id: e.createdBy, name: staff.get(e.createdBy) ?? '' } : null };
}

function requireText(field: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(field, 'is required');
  if (value.trim().length > max) throw invalid(field, `must be at most ${max} characters`);
  return value.trim();
}

const invalid = (field: string, why: string) => new CommError(CommErrorCode.VALIDATION, `${field}: ${why}`, 400);
