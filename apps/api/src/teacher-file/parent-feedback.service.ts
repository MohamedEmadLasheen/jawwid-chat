import { Inject, Injectable } from '@nestjs/common';
import type { ParentFeedback, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { scopeCovers } from '../platform/teacher-scope';
import { currentImpersonationId } from '../platform/request-context';
import { ActorKind, StaffRole } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { TeacherFileService, mapTimelineRefusal } from './teacher-file.service';

export const FEEDBACK_CATEGORIES = ['praise', 'suggestion', 'complaint'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = 'received' | 'in_review' | 'resolved';

/** chat.parent_feedback's CHECKs; checked here first for a readable 400. */
const BODY_MAX = 2000;
const DAY_MS = 24 * 3_600_000;
/** Compiled defaults for chat.config's `feedback.limit.*` (20261026120000 seeds the same). */
const LIMIT_DEFAULTS = { 'feedback.limit.per_child_day': 3, 'feedback.limit.per_family_day': 10 } as const;

/**
 * PD-32 (amends PD-26): a parent's feedback about their child's teacher.
 *
 *   the parent           files praise, a suggestion or a complaint about one
 *                        child of their family (and so that child's teacher),
 *                        and reads back each one's status and the ONE reply
 *                        staff wrote for them. Never internal notes, the
 *                        handler, or what was decided.
 *   Teachers department  reads every one, takes it ("in review"), replies to
 *   + super admin        the parent, and resolves praise and suggestions. A
 *                        COMPLAINT is also a PD-26 complaint (source
 *                        parent_app): follow-ups, resolution and "uphold ->
 *                        monthly ladder" are PD-26's, and its status follows.
 *   child's supervisor   reads their own children's feedback, on the family's
 *                        Parent File.
 *   the teacher          nothing. No route returns it to a teacher; the table
 *                        has no request-role grant.
 *
 * Rate-limited in the database's own clock: per child and per family per
 * rolling 24 hours (`feedback.limit.*`, operations-tunable).
 */
@Injectable()
export class ParentFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly files: TeacherFileService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // The parent
  // ------------------------------------------------------------------

  /** The family's children (with their teacher) and the family's feedback, newest first. */
  async mine(actorId: string) {
    const { contact } = await this.requireParent(actorId);
    const [learners, rows] = await Promise.all([
      this.prisma.learner.findMany({
        where: { familyId: contact.familyId, organizationId: contact.organizationId },
        select: { id: true, name: true, teacher: { select: { name: true } } },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.parentFeedback.findMany({
        where: { familyId: contact.familyId, organizationId: contact.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 200,
      }),
    ]);
    const names = await this.names(rows);
    return {
      children: learners.map((l) => ({ learnerId: l.id, name: l.name, teacherName: l.teacher?.name ?? null })),
      feedback: rows.map((r) => forParent(r, names)),
    };
  }

  /** { learnerId, category, body } */
  async file(actorId: string, body: Record<string, unknown>) {
    const { contact } = await this.requireParent(actorId);
    if (typeof body.learnerId !== 'string' || !isUuid(body.learnerId)) throw invalid('learnerId: must be a uuid');
    if (typeof body.category !== 'string' || !(FEEDBACK_CATEGORIES as readonly string[]).includes(body.category)) {
      throw invalid('category: must be praise, suggestion or complaint');
    }
    const category = body.category as FeedbackCategory;
    if (typeof body.body !== 'string' || body.body.trim().length === 0) throw invalid('body: is required');
    const text = body.body.trim();
    if (text.length > BODY_MAX) throw invalid(`body: must be at most ${BODY_MAX} characters`);

    const learner = await this.prisma.learner.findFirst({
      where: { id: body.learnerId.toLowerCase(), familyId: contact.familyId, organizationId: contact.organizationId },
      select: { id: true, teacherId: true },
    });
    if (!learner || !learner.teacherId) {
      throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'no such child with a teacher in your family');
    }
    const teacherId = learner.teacherId;

    const [perChild, perFamily] = await Promise.all([
      this.limit('feedback.limit.per_child_day'),
      this.limit('feedback.limit.per_family_day'),
    ]);

    const row = await this.prisma.$transaction(
      async (tx) => {
        // Counted inside the transaction (serializable), so two quick submissions
        // cannot both pass the last free slot.
        // The child's teacher, read again under a row lock: a transfer between the
        // read above and this insert must not file the parent's words against a
        // teacher they did not name. Changed -> the parent retries and sees who.
        const [now] = await tx.$queryRaw<Array<{ teacher_id: string | null }>>`
          SELECT teacher_id::text AS teacher_id FROM chat.learner WHERE id = ${learner.id}::uuid FOR SHARE`;
        if (!now || now.teacher_id !== teacherId) throw teacherChanged();
        const since = new Date(Date.now() - DAY_MS);
        const [childCount, familyCount] = await Promise.all([
          tx.parentFeedback.count({ where: { learnerId: learner.id, createdAt: { gte: since } } }),
          tx.parentFeedback.count({ where: { familyId: contact.familyId, createdAt: { gte: since } } }),
        ]);
        if (childCount >= perChild || familyCount >= perFamily) {
          throw new CommError(CommErrorCode.FEEDBACK_LIMIT, 'that is as much feedback as a day allows; please try again tomorrow', 429);
        }
        const created = await tx.parentFeedback.create({
          data: {
            organizationId: contact.organizationId,
            familyId: contact.familyId,
            contactId: contact.id,
            learnerId: learner.id,
            teacherId,
            category,
            body: text,
          },
        });
        if (category === 'complaint') {
          // PD-26's queue: a complaint with no staff author and no handler yet.
          await tx.teacherSupervisionEntry.create({
            data: {
              organizationId: contact.organizationId,
              teacherId,
              kind: 'complaint',
              body: text,
              complaintSource: 'parent_app',
              parentFeedbackId: created.id,
            },
          });
        }
        // The parent is not staff (audit_log.actor_id names staff). The text stays
        // out of the audit trail, which is read more widely than this table.
        await this.audit.audit(tx, {
          actorId: null,
          action: 'parent_feedback.filed',
          entity: 'parent_feedback',
          entityId: created.id,
          after: { familyId: contact.familyId, contactId: contact.id, learnerId: learner.id, teacherId, category },
          reason: `parent feedback: ${category}`,
        });
        return created;
      },
      { isolationLevel: 'Serializable' },
    ).catch((e: unknown) => {
      throw e instanceof CommError ? e : serializationAsLimit(e);
    });
    return forParent(row, await this.names([row]));
  }

  // ------------------------------------------------------------------
  // The Teachers department and the super admin
  // ------------------------------------------------------------------

  /** ?status=received|in_review|resolved &category=praise|suggestion|complaint -- newest first. */
  async list(actorId: string, query: { status?: string; category?: string }) {
    // PD-26 amendment: the page's feedback section, for Operations too.
    const { actor, access } = await this.files.pageGate(actorId, (a) => a.onPage);
    if (query.status !== undefined && !['received', 'in_review', 'resolved'].includes(query.status)) {
      throw invalid('status: must be received, in_review or resolved');
    }
    if (query.category !== undefined && !(FEEDBACK_CATEGORIES as readonly string[]).includes(query.category)) {
      throw invalid('category: must be praise, suggestion or complaint');
    }
    // PD-35: the feedback about the teachers in the caller's scope.
    const scope = await this.files.teacherScope.pageScopeOf(actor);
    const rows = await this.prisma.parentFeedback.findMany({
      where: {
        organizationId: actor.organizationId as string,
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(scope.all ? {} : { teacherId: { in: [...scope.teacherIds] } }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 500,
    });
    return { canWrite: access.canWriteSupervision, feedback: await this.forStaff(rows) };
  }

  /**
   * "I'm on it": received -> in review. On a complaint, the taker becomes its
   * PD-26 handler (set once; a complaint already taken keeps its handler).
   */
  async take(actorId: string, id: string) {
    const { actor } = await this.files.pageGate(actorId, (a) => a.canWriteSupervision);
    const row = await this.requireFeedback(actor, id);
    await this.write(async (tx) => {
      if (row.category === 'complaint') {
        await tx.teacherSupervisionEntry.updateMany({
          where: { parentFeedbackId: row.id, handledBy: null },
          data: { handledBy: actor.actorId },
        });
      }
      await tx.parentFeedback.updateMany({ where: { id: row.id, status: 'received' }, data: { status: 'in_review' } });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'parent_feedback.taken',
        entity: 'parent_feedback',
        entityId: row.id,
        after: { status: 'in_review' },
        reason: 'parent feedback taken for review',
      });
    });
    return this.one(actor, row.id);
  }

  /**
   * { response, resolve? } -- what the parent reads back (replacing an earlier
   * reply). `resolve` closes praise or a suggestion; a complaint is resolved
   * only by its PD-26 resolution, so the record and the parent agree.
   */
  async reply(actorId: string, id: string, body: Record<string, unknown>) {
    const { actor } = await this.files.pageGate(actorId, (a) => a.canWriteSupervision);
    const row = await this.requireFeedback(actor, id);
    if (typeof body.response !== 'string' || body.response.trim().length === 0) throw invalid('response: is required');
    const response = body.response.trim();
    if (response.length > BODY_MAX) throw invalid(`response: must be at most ${BODY_MAX} characters`);
    const resolve = body.resolve === true;
    if (resolve && row.category === 'complaint') {
      throw new CommError(CommErrorCode.FEEDBACK_STATE, 'a complaint is resolved by its resolution on the Teacher File', 409);
    }
    await this.write(async (tx) => {
      await tx.parentFeedback.update({
        where: { id: row.id },
        data: {
          parentResponse: response,
          respondedBy: actor.actorId,
          respondedAt: new Date(),
          ...(resolve ? { status: 'resolved' } : row.status === 'received' ? { status: 'in_review' } : {}),
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'parent_feedback.replied',
        entity: 'parent_feedback',
        entityId: row.id,
        after: { resolved: resolve },
        reason: 'reply to a parent about their feedback',
      });
    });
    return this.one(actor, row.id);
  }

  /**
   * PD-35 B5: who one piece of feedback is about -- its teacher and child, never
   * its content -- for an escalation case to check its subject against the
   * caller's scope. Null when there is none in the organization.
   */
  async subjectOf(organizationId: string, id: string): Promise<{ teacherId: string; learnerId: string } | null> {
    if (!isUuid(id)) return null;
    return this.prisma.parentFeedback.findFirst({
      where: { id: id.toLowerCase(), organizationId },
      select: { teacherId: true, learnerId: true },
    });
  }

  // ------------------------------------------------------------------
  // A family's Parent File (PD-17): the children's supervisor reads too
  // ------------------------------------------------------------------

  async forFamily(actorId: string, familyId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.FEEDBACK_DENIED, 'parent feedback is read by the administration');
    }
    if (!isUuid(familyId)) throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'family not found');
    const family = await this.prisma.family.findFirst({
      where: { id: familyId.toLowerCase(), organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!family) throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'family not found');

    const department = await this.files.gate(actorId, (a) => a.canView).then(
      () => true,
      () => false,
    );
    let learnerFilter: Prisma.ParentFeedbackWhereInput = {};
    const scope = department ? await this.files.teacherScope.scopeOf(actor) : null;
    if (scope && !scope.all) {
      // PD-35: a narrowed teacher supervisor reads what concerns their own teachers.
      const ours = (await this.familyLearners(family.id)).filter((l) => scopeCovers(scope, l.teacherId));
      if (!ours.length) throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'family not found');
      learnerFilter = { teacherId: { in: [...scope.teacherIds] } };
    } else if (!department && actor.staffRole !== StaffRole.SUPER_ADMIN) {
      const mine = await this.prisma.learnerSupervision.findMany({
        where: { supervisorId: actor.actorId, learnerId: { in: (await this.familyLearners(family.id)).map((l) => l.id) } },
        select: { learnerId: true },
      });
      // The same answer as an unknown family: a refusal must not confirm the family exists.
      if (!mine.length) throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'family not found');
      learnerFilter = { learnerId: { in: mine.map((m) => m.learnerId) } };
    }
    const rows = await this.prisma.parentFeedback.findMany({
      where: { familyId: family.id, organizationId: actor.organizationId, ...learnerFilter },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    return { feedback: await this.forStaff(rows) };
  }

  // ------------------------------------------------------------------

  private async one(actor: Actor, id: string) {
    const row = await this.requireFeedback(actor, id);
    return (await this.forStaff([row]))[0];
  }

  private async requireFeedback(actor: Actor, id: string): Promise<ParentFeedback> {
    if (!isUuid(id)) throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'feedback not found');
    const row = await this.prisma.parentFeedback.findFirst({
      where: { id: id.toLowerCase(), organizationId: actor.organizationId ?? '' },
    });
    if (!row) throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'feedback not found');
    // PD-35: feedback about a teacher outside the caller's scope reads as unknown.
    if (!(await this.files.teacherScope.pageCovers(actor, row.teacherId))) {
      throw new CommError(CommErrorCode.FEEDBACK_NOT_FOUND, 'feedback not found');
    }
    return row;
  }

  /** The signed-in parent, in their own session -- never staff acting as them (PD-21). */
  private async requireParent(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const denied = () => new CommError(CommErrorCode.FEEDBACK_DENIED, 'feedback about a teacher is filed by the child\'s parent');
    if (actor.kind !== ActorKind.CONTACT || !actor.isActive || !actor.familyId) throw denied();
    if (currentImpersonationId()) throw denied();
    const contact = await this.prisma.contact.findUnique({
      where: { id: actor.actorId },
      select: { id: true, familyId: true, organizationId: true, isActive: true },
    });
    if (!contact || !contact.isActive || contact.familyId !== actor.familyId) throw denied();
    return { actor, contact };
  }

  private familyLearners(familyId: string) {
    return this.prisma.learner.findMany({ where: { familyId }, select: { id: true, teacherId: true } });
  }

  private async limit(key: keyof typeof LIMIT_DEFAULTS): Promise<number> {
    const row = await this.prisma.config.findUnique({ where: { key } });
    const n = row?.value;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : LIMIT_DEFAULTS[key];
  }

  private async names(rows: ParentFeedback[]) {
    const [learners, teachers] = await Promise.all([
      this.prisma.learner.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.learnerId))] } }, select: { id: true, name: true } }),
      this.prisma.teacher.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.teacherId))] } }, select: { id: true, name: true } }),
    ]);
    return { learner: new Map(learners.map((l) => [l.id, l.name])), teacher: new Map(teachers.map((t) => [t.id, t.name])) };
  }

  private async forStaff(rows: ParentFeedback[]) {
    if (!rows.length) return [];
    const [names, contacts, entries, staff] = await Promise.all([
      this.names(rows),
      this.prisma.contact.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.contactId))] } }, select: { id: true, name: true } }),
      this.prisma.teacherSupervisionEntry.findMany({
        where: { parentFeedbackId: { in: rows.map((r) => r.id) } },
        select: { id: true, parentFeedbackId: true, handledBy: true },
      }),
      this.prisma.staff.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => (r.respondedBy ? [r.respondedBy] : [])))] } },
        select: { id: true, name: true },
      }),
    ]);
    const handlers = await this.prisma.staff.findMany({
      where: { id: { in: [...new Set(entries.flatMap((e) => (e.handledBy ? [e.handledBy] : [])))] } },
      select: { id: true, name: true },
    });
    const contactName = new Map(contacts.map((c) => [c.id, c.name]));
    const staffName = new Map([...staff, ...handlers].map((s) => [s.id, s.name]));
    const entryOf = new Map(entries.map((e) => [e.parentFeedbackId as string, e]));
    return rows.map((r) => {
      const entry = entryOf.get(r.id);
      return {
        id: r.id,
        familyId: r.familyId,
        parent: { id: r.contactId, name: contactName.get(r.contactId) ?? '' },
        child: { id: r.learnerId, name: names.learner.get(r.learnerId) ?? '' },
        teacher: { id: r.teacherId, name: names.teacher.get(r.teacherId) ?? '' },
        category: r.category as FeedbackCategory,
        body: r.body,
        status: r.status as FeedbackStatus,
        response: r.parentResponse,
        respondedBy: r.respondedBy ? { id: r.respondedBy, name: staffName.get(r.respondedBy) ?? '' } : null,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
        // A complaint is a PD-26 complaint: its id on the Teacher File, and who handles it.
        complaint: entry
          ? { entryId: entry.id, handledBy: entry.handledBy ? { id: entry.handledBy, name: staffName.get(entry.handledBy) ?? '' } : null }
          : null,
      };
    });
  }

  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (e) {
      throw mapTimelineRefusal(e);
    }
  }
}

/** What a parent reads back: their own words, the status and the reply. Nothing internal. */
function forParent(r: ParentFeedback, names: { learner: Map<string, string>; teacher: Map<string, string> }) {
  return {
    id: r.id,
    learnerId: r.learnerId,
    childName: names.learner.get(r.learnerId) ?? '',
    teacherName: names.teacher.get(r.teacherId) ?? '',
    category: r.category as FeedbackCategory,
    body: r.body,
    status: r.status as FeedbackStatus,
    response: r.parentResponse,
    respondedAt: r.respondedAt,
    createdAt: r.createdAt,
  };
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function teacherChanged() {
  return new CommError(CommErrorCode.FEEDBACK_STATE, "the child's teacher has just changed; please check and send again", 409);
}

/** Two submissions racing for the last slot: the loser is told what the winner was not. */
function serializationAsLimit(e: unknown): unknown {
  const code = (e as { code?: string })?.code ?? '';
  const text = e instanceof Error ? e.message : String(e);
  // The database's own guard saw a teacher other than the child's (a transfer won the race).
  if (/feedback is about a child of the parent's own family and that child's teacher/.test(text)) return teacherChanged();
  if (code === 'P2034' || /40001|could not serialize/.test(text)) {
    return new CommError(CommErrorCode.FEEDBACK_LIMIT, 'please try again in a moment', 429);
  }
  return mapTimelineRefusal(e);
}
