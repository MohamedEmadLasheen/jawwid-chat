import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import { scopeCovers } from '../platform/teacher-scope';
import type { Actor } from '../platform/types';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind, CardKind, StaffRole } from '../communication/contracts/vocab';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { CardPoster } from '../supervision/card-poster';
import { LessonService } from './lesson.service';

const REASON_MAX = 500;
const FIELDS_MAX = 12;
const FIELD_RE = /^[a-z][a-z_]{1,40}$/;

/** The card a teacher receives: what is asked of them, about which lesson, and why. */
export const REPORT_CORRECTION_CARD = CardKind.REPORT_CORRECTION_REQUESTED;

const invalid = (why: string) => new CommError(CommErrorCode.VALIDATION, why, 400);
const notFound = () => new CommError(CommErrorCode.LESSON_NOT_FOUND, 'not found');

interface Row {
  id: string;
  lesson_id: string;
  teacher_id: string;
  kind: string;
  reason: string;
  fields: string[];
  requested_by: string;
  requested_at: Date;
  asked_version: number | null;
  resolved_at: Date | null;
  resolution: string | null;
  resolved_version: number | null;
  resolved_by_kind: string | null;
  learner_id: string;
  learner_name: string;
  teacher_name: string;
  starts_at: Date;
  requester_name: string;
}

/**
 * PD-35: "Request correction" on a lesson report (or "the report is missing").
 *
 *   ask       anyone who stands to the lesson as 'manager' or 'supervisor' (the
 *             teacher's supervisor under PD-35's scope, the child's PD-8
 *             supervisor, their managers, the super admin). One open request per
 *             lesson. A card in the teacher's supervision conversation tells
 *             the teacher what to do, and why.
 *   answer    the TEACHER answers with PD-15's recorded edit (or by filing the
 *             report); the database resolves the request in that transaction,
 *             with the version asked about and the version that answered it --
 *             the change is the PD-15 history between the two. A supervisor's
 *             own edit is recorded too, and shows as answered by staff.
 *   withdraw  the asker, or anyone who stands to the lesson as 'manager'.
 */
@Injectable()
export class ReportCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly supervisionChats: SupervisionConversationService,
    private readonly cards: CardPoster,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** { reason, kind?: 'missing' | 'correction', fields?: string[] } */
  async request(actorId: string, lessonId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF) throw new CommError(CommErrorCode.LESSON_DENIED, 'corrections are requested by staff');
    const { lesson, standing } = await this.lessons.load(actor, lessonId);
    if (standing !== 'manager' && standing !== 'supervisor') {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'corrections are requested by the teacher\'s and the child\'s supervisors');
    }
    const reason = textField(body.reason, 'reason', REASON_MAX);
    const fields = fieldsOf(body.fields);
    const live = await this.prisma.lessonReport.findUnique({ where: { lessonId: lesson.id }, select: { deletedAt: true } });
    const kind = body.kind === undefined ? (live && !live.deletedAt ? 'correction' : 'missing') : body.kind;
    if (kind !== 'missing' && kind !== 'correction') throw invalid('kind: missing or correction');

    const id = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ id: string; asked_version: number | null }>>`
          INSERT INTO chat.report_correction_request (organization_id, lesson_id, teacher_id, kind, reason, fields, requested_by)
          VALUES (${lesson.organizationId}::uuid, ${lesson.id}::uuid, ${lesson.teacherId}::uuid, ${kind}, ${reason},
                  ${fields}::text[], ${actor.actorId}::uuid)
          RETURNING id::text, asked_version`;
        const teacher = await this.conversations.requireActor(lesson.teacherId);
        const lang = teacher.locale === 'en' ? 'en' : 'ar';
        const payload = {
          requestId: row.id,
          lessonId: lesson.id,
          learnerName: lesson.learner.name,
          startsAt: lesson.startsAt.toISOString(),
          kind,
          reason,
          fields,
          askedVersion: row.asked_version,
        };
        const conv = await this.supervisionChats.ensureInTx(tx, lesson.teacherId, lesson.organizationId, actor.actorId);
        await this.cards.post(tx, conv, actor, { kind: REPORT_CORRECTION_CARD, payload, body: renderCorrectionCard(payload, lang) });
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'report_correction.requested',
          entity: 'lesson',
          entityId: lesson.id,
          after: { requestId: row.id, kind, fields },
          reason,
        });
        return row.id;
      }),
    );
    return this.one(actor, id);
  }

  async withdraw(actorId: string, requestId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const row = await this.load(requestId);
    const { standing } = await this.lessons.load(actor, row.lesson_id);
    if (row.requested_by !== actor.actorId && standing !== 'manager') {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'a request is withdrawn by whoever asked, or a manager');
    }
    if (row.resolved_at) throw new CommError(CommErrorCode.LESSON_STATE, 'this request is already resolved', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE chat.report_correction_request
           SET resolved_at = now(), resolution = 'withdrawn', resolved_by_kind = 'staff', resolved_by = ${actor.actorId}::uuid
         WHERE id = ${row.id}::uuid AND resolved_at IS NULL`;
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'report_correction.withdrawn',
        entity: 'lesson',
        entityId: row.lesson_id,
        after: { requestId: row.id },
        reason: 'correction request withdrawn',
      });
    });
    return this.one(actor, row.id);
  }

  /**
   * ?status=open|resolved|all &teacherId= -- the requests about lessons the
   * caller stands to: the teachers in their PD-35 scope (Teachers department),
   * the children they supervise (Operations), every one for the super admin.
   */
  async list(actorId: string, query: { status?: string; teacherId?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'staff only');
    }
    const status = query.status ?? 'open';
    if (!['open', 'resolved', 'all'].includes(status)) throw invalid('status: open | resolved | all');
    if (query.teacherId !== undefined && !isUuid(query.teacherId)) throw invalid('teacherId: a uuid');
    const rows = await this.rows(actor.organizationId, { status, teacherId: query.teacherId ?? null });
    const visible = await this.visibleFilter(actor);
    return { requests: rows.filter(visible).map(dto) };
  }

  /** The teacher's own: what is asked of them now, and lately. */
  async mine(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.TEACHER || !actor.isActive || !actor.organizationId) {
      throw new CommError(CommErrorCode.LESSON_DENIED, 'a teacher\'s own requests');
    }
    const rows = await this.rows(actor.organizationId, { status: 'all', teacherId: actor.actorId });
    return { requests: rows.slice(0, 100).map(dto) };
  }

  // ---------------------------------------------------------------------------

  private async one(actor: Actor, id: string) {
    const [row] = await this.rows(actor.organizationId as string, { status: 'all', teacherId: null, id });
    if (!row) throw notFound();
    return dto(row);
  }

  private async load(id: string): Promise<Row> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.prisma.$queryRaw<Row[]>`
      SELECT q.id::text, q.lesson_id::text, q.requested_by::text, q.resolved_at
        FROM chat.report_correction_request q WHERE q.id = ${id}::uuid`;
    if (!row) throw notFound();
    return row;
  }

  private rows(organizationId: string, f: { status: string; teacherId: string | null; id?: string }) {
    return this.prisma.$queryRaw<Row[]>`
      SELECT q.id::text, q.lesson_id::text, q.teacher_id::text, q.kind, q.reason, q.fields,
             q.requested_by::text, q.requested_at, q.asked_version, q.resolved_at, q.resolution,
             q.resolved_version, q.resolved_by_kind,
             l.learner_id::text, x.name AS learner_name, t.name AS teacher_name, l.starts_at,
             s.name AS requester_name
        FROM chat.report_correction_request q
        JOIN chat.lesson l ON l.id = q.lesson_id
        JOIN chat.learner x ON x.id = l.learner_id
        JOIN chat.teacher t ON t.id = q.teacher_id
        JOIN chat.staff s ON s.id = q.requested_by
       WHERE q.organization_id = ${organizationId}::uuid
         AND (${f.id ?? null}::uuid IS NULL OR q.id = ${f.id ?? null}::uuid)
         AND (${f.teacherId}::uuid IS NULL OR q.teacher_id = ${f.teacherId}::uuid)
         AND (${f.status} = 'all' OR (${f.status} = 'open') = (q.resolved_at IS NULL))
       ORDER BY q.resolved_at IS NOT NULL, q.requested_at DESC
       LIMIT 500`;
  }

  /** Which rows the caller stands to, decided as LessonService.load decides one. */
  private async visibleFilter(actor: Actor): Promise<(r: Row) => boolean> {
    if (actor.staffRole === StaffRole.SUPER_ADMIN) return () => true;
    const teachers = await this.lessons.teachersFacts(actor);
    const supervised = new Set(await this.lessons.supervisedLearnerIds(actor, new Date()));
    return (r) => (teachers.department && scopeCovers(teachers.scope, r.teacher_id)) || supervised.has(r.learner_id);
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // The one-open-per-lesson index; Postgres names the key, not always the index.
      if (/report_correction_one_open|Key \(lesson_id\)=\([^)]*\) already exists/.test(msg)) throw new CommError(CommErrorCode.LESSON_STATE, 'a correction is already requested for this lesson', 409);
      const known = /(there is no report to correct|the report is not missing|a report is owed only once the lesson has started|this lesson owes no report)/.exec(msg);
      if (known) throw new CommError(CommErrorCode.LESSON_STATE, known[1], 409);
      throw e;
    }
  }
}

function dto(r: Row) {
  return {
    id: r.id,
    lessonId: r.lesson_id,
    learner: { id: r.learner_id, name: r.learner_name },
    teacher: { id: r.teacher_id, name: r.teacher_name },
    lessonStartsAt: r.starts_at.toISOString(),
    kind: r.kind,
    reason: r.reason,
    fields: r.fields,
    requestedBy: { id: r.requested_by, name: r.requester_name },
    requestedAt: r.requested_at.toISOString(),
    status: r.resolution ?? 'open',
    // The change is the lesson's PD-15 history between these two versions.
    askedVersion: r.asked_version,
    resolvedVersion: r.resolved_version,
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    resolvedByKind: r.resolved_by_kind,
  };
}

function textField(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw invalid(`${name}: required`);
  const t = v.trim();
  if (t.length > max) throw invalid(`${name}: at most ${max} characters`);
  return t;
}

function fieldsOf(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > FIELDS_MAX || v.some((x) => typeof x !== 'string' || !FIELD_RE.test(x))) {
    throw invalid(`fields: at most ${FIELDS_MAX} report field names`);
  }
  return [...new Set(v as string[])];
}

/** The card's plain-text body, in the teacher's language. */
export function renderCorrectionCard(
  p: { learnerName: string; startsAt: string; kind: string; reason: string },
  lang: 'ar' | 'en',
): string {
  const day = p.startsAt.slice(0, 10);
  if (lang === 'ar') {
    return [
      p.kind === 'missing' ? `📝 مطلوب تقرير الحصة — ${p.learnerName}` : `📝 مطلوب تصحيح تقرير الحصة — ${p.learnerName}`,
      `الحصة: ${day}`,
      `السبب: ${p.reason}`,
      p.kind === 'missing' ? 'افتح الحصة واكتب التقرير.' : 'افتح الحصة وعدّل التقرير.',
    ].join('\n');
  }
  return [
    p.kind === 'missing' ? `📝 Lesson report needed — ${p.learnerName}` : `📝 Lesson report correction needed — ${p.learnerName}`,
    `Lesson: ${day}`,
    `Reason: ${p.reason}`,
    p.kind === 'missing' ? 'Open the lesson and write its report.' : 'Open the lesson and edit its report.',
  ].join('\n');
}
