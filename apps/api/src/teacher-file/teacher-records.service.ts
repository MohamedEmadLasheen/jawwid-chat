import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { SupervisionService } from '../lessons/supervision.service';
import { CardKind } from '../communication/contracts/vocab';

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
    // PD-52 (plan §11 c): sharing a parent's praise posts a card in the teacher's supervision chat.
    @Optional() private readonly supervision?: SupervisionService,
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
    const mayCorrect = access.grants.record ? await this.mayVoidTestimonials(actor, staffRows) : new Set<string | null>();
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
        // Review of #377: offer Correct only where chat.may_void_testimonial would allow it.
        canCorrect: !voids.has(r.id) && mayCorrect.has(r.createdBy),
        sharedAt: null as Date | null,
      }))
      .filter((t) => query.voided === 'include' || t.voided === null);
    const shared = await this.sharedAt(praise.map((f) => f.id));
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
      canCorrect: false,
      // PD-52 (plan §11 c): when staff shared it with the teacher, if they did.
      sharedAt: shared.get(f.id) ?? null,
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
    const { actor, access, page } = await this.ctx(actorId, (a) => a.grants.record);
    const teacher = await this.files.requireTeacherIn(actor, teacherId, page.teachers);
    const whole = scopeCovers(page.whole, teacher.id);
    const text = requireText('body', body.body, BODY_MAX);
    if (typeof body.source !== 'string' || !(TESTIMONIAL_SOURCES as readonly string[]).includes(body.source)) {
      throw invalid('source', `must be one of ${TESTIMONIAL_SOURCES.join(', ')}`);
    }
    const about = await this.files.aboutOf(actor, body, whole, page);
    // PD-52 PR-5: Sales records nothing about the teacher alone.
    if (access.basis === 'sales' && !about.learnerId && !about.trialProspectId) {
      throw invalid('learnerId', 'name the student or the trial family the testimonial is about');
    }
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

  /**
   * PD-52 (plan §11 c; owner: yes): share a parent's praise with the teacher --
   * a card in the teacher's supervision chat with the child's first name and
   * the parent's words, never the parent's name. Staff choose to; nothing is
   * shared by itself. Page B's record right, for praise the caller may see.
   * Once per piece of praise: a second share is refused (409), serialized on
   * the praise so two at once post one card.
   */
  async sharePraise(actorId: string, feedbackId: string) {
    const { actor, page } = await this.ctx(actorId, (a) => a.grants.record);
    if (!this.supervision) throw new Error('TeacherRecordsService.sharePraise needs SupervisionService');
    const notFound = new CommError(CommErrorCode.TEACHER_FILE_NOT_FOUND, 'praise not found');
    if (!isUuid(feedbackId)) throw notFound;
    const praise = await this.prisma.parentFeedback.findUnique({ where: { id: feedbackId } });
    if (!praise || praise.organizationId !== actor.organizationId || praise.category !== 'praise') throw notFound;
    if (!pageRowVisible(page, praise.teacherId, { learnerId: praise.learnerId })) throw notFound;
    const teacher = await this.files.requireTeacherIn(actor, praise.teacherId, page.teachers);
    const learner = await this.prisma.learner.findUnique({ where: { id: praise.learnerId }, select: { name: true } });
    const childFirstName = (learner?.name ?? '').trim().split(/\s+/)[0] ?? '';
    const supervision = this.supervision;

    const out = await this.write(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pd52_praise_share:' + praise.id}))`;
      if ((await this.sharedAtIn(tx, [praise.id])).size > 0) {
        throw new CommError(CommErrorCode.TEACHER_FILE_CONFLICT, 'this praise was already shared with the teacher', 409);
      }
      const posted = await supervision.sharePraiseInTx(tx, actor, teacher, { feedbackId: praise.id, childFirstName, body: praise.body });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'parent_feedback.shared_with_teacher',
        entity: 'parent_feedback',
        entityId: praise.id,
        after: { teacherId: teacher.id, messageId: posted.messageId },
        // The parent's words stay in the card, not the audit trail.
        reason: 'praise shared with the teacher',
      });
      return posted;
    });
    return { feedbackId: praise.id, conversationId: out.conversationId, messageId: out.messageId };
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
    // Owner decision on #374: a testimonial is corrected by the department that
    // recorded it, or by the Operations Manager or the super admin (the
    // database's chat.may_void_testimonial decides; this is its readable 403).
    if (target.kind === TESTIMONIAL) {
      const [{ ok }] = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT chat.may_void_testimonial(${actor.actorId}::uuid, ${target.createdBy}::uuid, ${target.organizationId}::uuid) AS ok`;
      if (!ok) throw new CommError(CommErrorCode.TEACHER_FILE_DENIED, 'a testimonial is corrected by the department that recorded it');
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
    const teacher = await this.files.requireTeacherIn(actor, teacherId, page.teachers);
    const org = teacher.organizationId;
    const [{ today }] = await this.prisma.$queryRaw<Array<{ today: string }>>`SELECT chat.academy_today()::text AS today`;
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);
    const yearRange = { from: new Date(`${year}-01-01T00:00:00Z`), to: new Date(`${Number(year) + 1}-01-01T00:00:00Z`) };
    // Review of #374: each section only for the key that covers it -- page A's
    // (away, the ladder, open complaints) for attendance.view, page B's
    // (grants, testimonials) for grants.view. A section not covered is null.
    const attendance = access.attendance.view;
    const grants = access.grants.view;
    // PD-52 PR-5: leave and the ladder are supervision matters -- never Sales'.
    const supervises = attendance && access.basis !== 'sales';

    const [away, ladder, openComplaints, grantCount, testimonialCount] = await Promise.all([
      supervises ? this.files.awayToday([teacher.id]).then((m) => m.get(teacher.id) ?? null) : null,
      supervises ? this.ladderOf(teacher.id, month) : null,
      attendance ? this.openComplaints(page, org, teacher.id) : null,
      grants ? this.grantCount(page, org, teacher.id, yearRange) : null,
      grants ? this.testimonialCount(actor, page, teacher.id, yearRange) : null,
    ]);
    return {
      teacher: { id: teacher.id, name: teacher.name, isActive: teacher.isActive && teacher.leftAt === null },
      away,
      ladder,
      openComplaints,
      year,
      grants: grantCount,
      testimonials: testimonialCount,
      opensFile: access.opensFile,
    };
  }

  /** The teacher's month on the ladder, whole (it sets the next step), as GET /teachers/:id/discipline counts it. */
  private async ladderOf(teacherId: string, month: string) {
    const violations = await this.prisma.teacherViolation.findMany({
      where: { teacherId, month: new Date(`${month}-01T00:00:00Z`) },
      select: { lessonId: true, kind: true, decision: true },
    });
    const counted = (await this.standing(violations)).filter((v) => v.decision !== Decision.EXCUSED).length;
    return { month, counted, nextStep: decisionForStep(counted + 1) };
  }

  /**
   * Complaints neither resolved nor voided. Counted in the database when the
   * caller sees the teacher whole; otherwise every one of the teacher's
   * complaints is read (no cap) and narrowed to the caller's rows.
   */
  private async openComplaints(page: PageScope, org: string, teacherId: string): Promise<number> {
    if (scopeCovers(page.whole, teacherId)) {
      const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM chat.teacher_supervision_entry e
         WHERE e.organization_id = ${org}::uuid AND e.teacher_id = ${teacherId}::uuid AND e.kind = 'complaint'
           AND NOT EXISTS (SELECT 1 FROM chat.teacher_supervision_entry r
                            WHERE r.refers_to = e.id AND r.kind IN ('complaint_resolution', 'entry_void'))`;
      return n;
    }
    const complaints = await this.prisma.teacherSupervisionEntry.findMany({ where: { organizationId: org, teacherId, kind: 'complaint' } });
    const familyOf = await familiesOfComplaints(this.prisma, complaints);
    const shown = complaints.filter((c) => pageRowVisible(page, c.teacherId, complaintAbout(c, familyOf)));
    if (shown.length === 0) return 0;
    const closed = await this.prisma.teacherSupervisionEntry.findMany({
      where: { refersTo: { in: shown.map((c) => c.id) }, kind: { in: ['complaint_resolution', ENTRY_VOID] } },
      select: { refersTo: true },
    });
    const closedIds = new Set(closed.map((c) => c.refersTo));
    return shown.filter((c) => !closedIds.has(c.id)).length;
  }

  private async grantCount(page: PageScope, org: string, teacherId: string, range: { from: Date; to: Date }): Promise<number> {
    const bonuses = await this.prisma.teacherSupervisionEntry.findMany({
      where: { organizationId: org, teacherId, kind: 'bonus', createdAt: { gte: range.from, lt: range.to } },
      select: { teacherId: true, learnerId: true, familyId: true, trialProspectId: true },
    });
    return bonuses.filter((b) => pageRowVisible(page, b.teacherId, aboutOf(b))).length;
  }

  private async testimonialCount(actor: Actor, page: PageScope, teacherId: string, range: { from: Date; to: Date }): Promise<number> {
    const [testimonials, praise] = await Promise.all([
      this.visibleTestimonials(actor, page, { teacherId, ...range }),
      this.feedback.praise(actor, page, { teacherId, ...range }),
    ]);
    const voided = await this.voidsOf(testimonials.map((t) => t.id));
    return testimonials.filter((t) => !voided.has(t.id)).length + praise.length;
  }

  /**
   * The students a record about this teacher may name: those the teacher
   * teaches or taught in the PD-26 window (chat.teaches_or_taught, the
   * database's own rule), and of an Operations-only teacher only the caller's
   * own; and (PD-52 PR-5) the trial families the teacher taught in the window,
   * for Sales only those it reads. For the record dialogs' picker.
   */
  async students(actorId: string, teacherId: string) {
    const { actor, page } = await this.ctx(actorId, (a) => a.attendance.record || a.grants.record);
    const teacher = await this.files.requireTeacherIn(actor, teacherId, page.teachers);
    const whole = scopeCovers(page.whole, teacher.id);
    // Of an Operations-only teacher, the caller's own learners -- filtered in the
    // query, before the cap, so none of them is ever cut off (review of #377).
    const own = whole ? null : [...page.learnerIds];
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; family_id: string }>>`
      SELECT l.id::text AS id, l.name, l.family_id::text AS family_id
        FROM chat.learner l
       WHERE l.organization_id = ${teacher.organizationId}::uuid
         AND l.id IN (SELECT x.id FROM chat.learner x WHERE x.teacher_id = ${teacher.id}::uuid
                      UNION SELECT le.learner_id FROM chat.lesson le WHERE le.teacher_id = ${teacher.id}::uuid AND le.learner_id IS NOT NULL)
         AND (${own === null}::boolean OR l.id = ANY(${own ?? []}::uuid[]))
         AND chat.teaches_or_taught(${teacher.id}::uuid, l.id)
       ORDER BY l.name, l.id
       LIMIT ${LIST_LIMIT}`;
    // PD-52 PR-5: and the trial families this teacher taught in the window (Sales: those it reads).
    const trials = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT DISTINCT p.id::text AS id, p.display_name AS name
        FROM chat.lesson le
        JOIN chat.trial_prospect p ON p.id = le.prospect_id
       WHERE le.teacher_id = ${teacher.id}::uuid
         AND le.starts_at >= now() - chat.operations_lesson_window()
         AND le.starts_at <= now()
         -- Sales: the trials it reads, filtered before the cap (review of #377).
         AND (${whole}::boolean OR p.id = ANY(${[...(page.prospectIds ?? [])]}::uuid[]))
       ORDER BY name, id
       LIMIT ${LIST_LIMIT}`;
    return {
      students: rows.map((r) => ({ id: r.id, name: r.name, familyId: r.family_id })),
      trials,
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
    // PD-52 PR-5: the PD-26 page's rows for its bases, Sales' for Sales.
    return { actor, access, page: await this.files.teacherScope.recordsRowsOf(actor) };
  }

  /** A `teacher` filter: a teacher outside the caller's scope is not found (PD-35). */
  private async teacherFilter(actor: Actor, page: PageScope, raw: string | undefined): Promise<string | undefined> {
    if (raw === undefined || raw === '') return undefined;
    return (await this.files.requireTeacherIn(actor, raw, (await this.files.teacherScope.recordsRowsOf(actor)).teachers)).id;
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

  /**
   * The authors whose testimonials the caller may correct: the database's own
   * chat.may_void_testimonial (the recording department, the Operations
   * Manager, the super admin), asked once per distinct author.
   */
  private async mayVoidTestimonials(actor: Actor, rows: Array<{ createdBy: string | null }>): Promise<Set<string | null>> {
    const authors = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => x !== null))];
    if (authors.length === 0 || !actor.organizationId) return new Set();
    const ok = await this.prisma.$queryRaw<Array<{ author: string }>>`
      SELECT a::text AS author FROM unnest(${authors}::uuid[]) a
       WHERE chat.may_void_testimonial(${actor.actorId}::uuid, a, ${actor.organizationId}::uuid)`;
    return new Set(ok.map((r) => r.author));
  }

  /** When each piece of praise was shared with its teacher (PD-52 §11 c): the card's time. */
  private async sharedAt(feedbackIds: string[]): Promise<Map<string, Date>> {
    return this.sharedAtIn(this.prisma, feedbackIds);
  }

  private async sharedAtIn(db: Prisma.TransactionClient | PrismaService, feedbackIds: string[]): Promise<Map<string, Date>> {
    if (feedbackIds.length === 0) return new Map();
    const rows = await db.$queryRaw<Array<{ id: string; at: Date }>>`
      SELECT c.payload->>'feedbackId' AS id, min(m.created_at) AS at
        FROM chat.message_card c JOIN chat.message m ON m.id = c.message_id
       WHERE c.kind = ${CardKind.TEACHER_PRAISE_SHARED} AND c.payload->>'feedbackId' = ANY(${feedbackIds}::text[])
       GROUP BY 1`;
    return new Map(rows.map((r) => [r.id, r.at]));
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
  if (row.trialProspectId) return { learnerId: null, prospectId: row.trialProspectId };
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
