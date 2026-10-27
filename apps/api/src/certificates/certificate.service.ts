import { Inject, Injectable } from '@nestjs/common';
import { Conversation, LearnerCertificate, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { canRequestCertificate, isLiveTeacher } from '../platform/pd012-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { conversationPrefix, objectKeyBelongsToConversation } from '../communication/attachments/object-key';
import { CardKind, CertificateState, ConversationType } from '../communication/contracts/vocab';
import { CardPoster } from '../supervision/card-poster';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { renderPd012CardBody, type CardLanguage } from '../supervision/pd012-cards';
import { sniffCertificateFile, CERTIFICATE_MIME_TYPES, MAX_CERTIFICATE_BYTES, type CertificateMime } from './certificate-file';

type Tx = Prisma.TransactionClient;

type CertificateRow = LearnerCertificate & {
  learner: { id: string; name: string; familyId: string; teacherId: string | null };
  teacher: { id: string; name: string };
};

const MAX_TITLE = 120;
const MAX_TEXT = 1000;
const MAX_GRADE = 60;
const MAX_FILE_NAME = 200;

/**
 * PD-12 S1: student certificates.
 *
 *   1. The learner's teacher files a Certificate ticket. The request and its card
 *      (in the teacher's private supervision conversation, never the group) commit
 *      together.
 *   2. The Teachers department sees it on the Admin Portal's Certificates page,
 *      uploads the finished file into the learner's group's storage namespace,
 *      and issues it -- or declines it with a reason.
 *   3. Issuing posts ONE card into the learner's group with the file attached.
 *      The teacher and the parent are both members, so it is in both accounts at
 *      once, and the existing media route serves the file to that group's readers
 *      and to nobody else.
 *
 * Who may act is decided by pd012-policy; whether the record allows it, and the
 * delivery group, are re-checked by chat.guard_learner_certificate.
 */
@Injectable()
export class CertificateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly supervision: SupervisionConversationService,
    private readonly cards: CardPoster,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // The teacher's ticket
  // ------------------------------------------------------------------

  async request(actorId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const learnerId = body.learnerId;
    if (typeof learnerId !== 'string' || !isUuid(learnerId)) throw invalid('learnerId: must be a uuid');
    const title = text(body, 'title', MAX_TITLE, true) as string;
    const achievement = text(body, 'achievement', MAX_TEXT, true) as string;
    const achievedOn = calendarDate(body, 'achievedOn');
    const grade = text(body, 'grade', MAX_GRADE, false);
    const printedName = text(body, 'printedName', MAX_TITLE, true) as string;
    const note = text(body, 'note', MAX_TEXT, false);

    const learner = await this.prisma.learner.findFirst({
      where: { id: learnerId, organizationId: actor.organizationId ?? '' },
      select: { id: true, name: true, organizationId: true, teacherId: true },
    });
    if (!canRequestCertificate(actor, learner)) {
      // An unknown learner and one the teacher does not teach read the same.
      throw new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'learner not found');
    }

    const created = await this.write(() =>
      this.prisma.$transaction(async (t) => {
        const cert = await t.learnerCertificate.create({
          data: {
            organizationId: actor.organizationId as string,
            learnerId,
            requestedBy: actor.actorId,
            title,
            achievement,
            achievedOn,
            grade,
            printedName,
            note,
          },
        });
        const conv = await this.supervision.ensureInTx(t, actor.actorId, actor.organizationId as string, null);
        const payload = {
          certificateId: cert.id,
          learnerId,
          learnerName: learner!.name,
          title,
          achievement,
          achievedOn: isoDate(achievedOn),
          grade,
          printedName,
          note,
        };
        const messageId = await this.cards.post(t, conv, actor, {
          kind: CardKind.CERTIFICATE_REQUESTED,
          payload,
          body: renderPd012CardBody(CardKind.CERTIFICATE_REQUESTED, payload, langOf(actor)),
        });
        const withCard = await t.learnerCertificate.update({ where: { id: cert.id }, data: { requestMessageId: messageId } });
        await this.audit.audit(t, {
          actorId: null,
          action: 'learner_certificate.requested',
          entity: 'learner_certificate',
          entityId: cert.id,
          after: { learnerId, teacherId: actor.actorId, title },
          reason: 'certificate requested by the teacher',
        });
        return { cert: withCard, conversationId: conv.id };
      }),
    );
    return { certificate: await this.dtoById(created.cert.id), conversationId: created.conversationId };
  }

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /**
   * The Teachers department: every certificate of the organization, optionally
   * by state (the page opens on `requested`). A teacher: their own requests.
   * Anyone else: refused.
   */
  async list(actorId: string, query: { state?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    if (query.state !== undefined && !Object.values(CertificateState).includes(query.state as never)) {
      throw invalid('state: requested | issued | declined');
    }
    const where: Prisma.LearnerCertificateWhereInput = {
      organizationId: actor.organizationId ?? '',
      ...(query.state ? { state: query.state } : {}),
    };
    if (isLiveTeacher(actor)) {
      where.requestedBy = actor.actorId;
    } else if (!(await this.supervision.staffAccess(actor)).canSupervise) {
      throw new CommError(CommErrorCode.CERTIFICATE_DENIED, 'only the Teachers department reviews certificates');
    } else {
      // PD-35: the requests of the teachers in the caller's scope.
      const scope = await this.supervision.teacherScope.scopeOf(actor);
      if (!scope.all) where.requestedBy = { in: [...scope.teacherIds] };
    }
    const rows = await this.prisma.learnerCertificate.findMany({
      where,
      orderBy: { requestedAt: query.state === CertificateState.REQUESTED ? 'asc' : 'desc' },
      take: 500,
    });
    const dtos = await this.dtos(rows);
    return { certificates: dtos };
  }

  // ------------------------------------------------------------------
  // The Teachers department's decisions
  // ------------------------------------------------------------------

  /**
   * Authorize uploading the finished file. The key is minted inside the
   * learner's group's namespace -- the server picks the group, never the
   * client -- so issuing can only ever attach a file that group may read.
   */
  async authorizeUpload(actorId: string, certificateId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const cert = await this.requireOpen(actor, certificateId);
    const mimeType = mimeField(body);
    const byteSize = sizeField(body);
    const group = await this.deliveryGroupFor(this.prisma, cert);
    if (!group) throw noGroup();
    const upload = await this.storage.authorizeUpload({ prefix: conversationPrefix(group.id), mimeType, byteSize });
    return { upload, conversationId: group.id };
  }

  async issue(actorId: string, certificateId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const cert = await this.requireOpen(actor, certificateId);
    const objectKey = body.objectKey;
    if (typeof objectKey !== 'string' || objectKey.length === 0) throw invalid('objectKey: required');
    const mimeType = mimeField(body);
    const byteSize = sizeField(body);
    const fileName = text(body, 'fileName', MAX_FILE_NAME, true) as string;

    const group = await this.deliveryGroupFor(this.prisma, cert);
    if (!group) throw noGroup();
    if (!objectKeyBelongsToConversation(group.id, objectKey)) {
      throw new CommError(CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION, "the file was not uploaded for this learner's group");
    }
    // What was ACTUALLY uploaded, not what the client says it uploaded.
    const head = await this.storage.readHead(objectKey, 16);
    if (!head) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'the file has not been uploaded', 409);
    if (head.byteSize !== byteSize || sniffCertificateFile(head.head) !== mimeType) {
      throw new CommError(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED, 'the uploaded file is not the PDF or image it claims to be', 400);
    }

    const teacher = await this.conversations.requireActor(cert.requestedBy);
    const familyLang = await this.familyLanguage(cert.learner.familyId);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        // Re-read under the transaction: the group must still be the one the
        // file was uploaded into (the trigger checks it is a live group of the learner).
        const live = await this.deliveryGroupFor(tx, cert);
        if (!live || live.id !== group.id) throw noGroup();
        await tx.learnerCertificate.update({
          where: { id: cert.id },
          data: {
            state: CertificateState.ISSUED,
            decidedBy: actor.actorId,
            conversationId: group.id,
            objectKey,
            mimeType,
            byteSize,
            fileName,
          },
        });
        const payload = {
          certificateId: cert.id,
          learnerId: cert.learnerId,
          learnerName: cert.learner.name,
          title: cert.title,
          achievement: cert.achievement,
          achievedOn: isoDate(cert.achievedOn),
          grade: cert.grade,
          printedName: cert.printedName,
        };
        const delivered = await this.cards.post(
          tx,
          group,
          null,
          { kind: CardKind.CERTIFICATE_ISSUED, payload, body: renderPd012CardBody(CardKind.CERTIFICATE_ISSUED, payload, familyLang) },
          { kind: mimeType === 'application/pdf' ? 'file' : 'image', objectKey, mimeType, byteSize, originalName: fileName },
        );
        await tx.learnerCertificate.update({ where: { id: cert.id }, data: { issuedMessageId: delivered } });
        // The teacher's request is answered where it was asked.
        const conv = await this.supervision.ensureInTx(tx, cert.requestedBy, cert.organizationId, actor.actorId).catch(() => null);
        if (conv) {
          await this.cards.post(tx, conv, actor, {
            kind: CardKind.CERTIFICATE_ISSUED,
            payload: { ...payload, deliveredTo: group.id },
            body: renderPd012CardBody(CardKind.CERTIFICATE_ISSUED, payload, langOf(teacher)),
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'learner_certificate.issued',
          entity: 'learner_certificate',
          entityId: cert.id,
          after: { conversationId: group.id, messageId: delivered, mimeType, byteSize },
          reason: 'certificate issued',
        });
      }),
    );
    return { certificate: await this.dtoById(cert.id) };
  }

  async decline(actorId: string, certificateId: string, body: Record<string, unknown>) {
    const actor = await this.requireSupervisor(actorId);
    const cert = await this.requireOpen(actor, certificateId);
    const reason = text(body, 'reason', MAX_TEXT, true) as string;
    const teacher = await this.conversations.requireActor(cert.requestedBy);
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.learnerCertificate.update({
          where: { id: cert.id },
          data: { state: CertificateState.DECLINED, decidedBy: actor.actorId, declineReason: reason },
        });
        const conv = await this.supervision.ensureInTx(tx, cert.requestedBy, cert.organizationId, actor.actorId).catch(() => null);
        if (conv) {
          const payload = { certificateId: cert.id, learnerId: cert.learnerId, learnerName: cert.learner.name, title: cert.title, reason };
          await this.cards.post(tx, conv, actor, {
            kind: CardKind.CERTIFICATE_DECLINED,
            payload,
            body: renderPd012CardBody(CardKind.CERTIFICATE_DECLINED, payload, langOf(teacher)),
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId,
          action: 'learner_certificate.declined',
          entity: 'learner_certificate',
          entityId: cert.id,
          after: { reason },
          reason: 'certificate declined',
        });
      }),
    );
    return { certificate: await this.dtoById(cert.id) };
  }

  // ------------------------------------------------------------------

  /**
   * Where a certificate is delivered: the learner's live student group, or else
   * a live PD-8 family group about the learner that the learner's teacher is in
   * -- the same rule as a lesson's card, so a certificate lands where the
   * lessons do.
   */
  private async deliveryGroupFor(db: Tx | PrismaService, cert: CertificateRow): Promise<Conversation | null> {
    const own = await db.conversation.findFirst({
      where: { type: ConversationType.STUDENT_GROUP, learnerId: cert.learnerId, archivedAt: null, organizationId: cert.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    if (own) return own;
    if (!cert.learner.teacherId) return null;
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id
        FROM chat.conversation c
        JOIN chat.conversation_learner cl ON cl.conversation_id = c.id
       WHERE cl.learner_id = ${cert.learnerId}::uuid
         AND c.type = 'family_group'
         AND c.archived_at IS NULL
         AND c.organization_id = ${cert.organizationId}::uuid
         AND EXISTS (SELECT 1 FROM chat.conversation_member m
                      WHERE m.conversation_id = c.id AND m.actor_id = ${cert.learner.teacherId}::uuid AND m.left_at IS NULL)
       ORDER BY c.created_at DESC
       LIMIT 1`;
    return rows.length ? db.conversation.findUnique({ where: { id: rows[0].id } }) : null;
  }

  private async requireSupervisor(actorId: string): Promise<Actor> {
    const actor = await this.conversations.requireActor(actorId);
    if (!(await this.supervision.staffAccess(actor)).canSupervise) {
      throw new CommError(CommErrorCode.CERTIFICATE_DENIED, 'only the Teachers department issues certificates');
    }
    return actor;
  }

  private async requireOpen(actor: Actor, certificateId: string): Promise<CertificateRow> {
    const cert = await this.load(actor, certificateId);
    await this.supervision.requireTeacherInScope(actor, cert.requestedBy, CommErrorCode.CERTIFICATE_NOT_FOUND);
    if (cert.state !== CertificateState.REQUESTED) {
      throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'this certificate has already been decided', 409);
    }
    return cert;
  }

  private async load(actor: Actor, certificateId: string): Promise<CertificateRow> {
    if (!isUuid(certificateId)) throw new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'certificate not found');
    const cert = await this.prisma.learnerCertificate.findFirst({
      where: { id: certificateId, organizationId: actor.organizationId ?? '' },
    });
    if (!cert) throw new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'certificate not found');
    const [withRelations] = await this.withRelations([cert]);
    return withRelations;
  }

  private async withRelations(rows: LearnerCertificate[]): Promise<CertificateRow[]> {
    const learners = await this.prisma.learner.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.learnerId))] } },
      select: { id: true, name: true, familyId: true, teacherId: true },
    });
    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.requestedBy))] } },
      select: { id: true, name: true },
    });
    const l = new Map(learners.map((x) => [x.id, x]));
    const t = new Map(teachers.map((x) => [x.id, x]));
    return rows.map((r) => ({ ...r, learner: l.get(r.learnerId)!, teacher: t.get(r.requestedBy)! }));
  }

  private async dtoById(id: string) {
    const row = await this.prisma.learnerCertificate.findUniqueOrThrow({ where: { id } });
    return (await this.dtos([row]))[0];
  }

  private async dtos(rows: LearnerCertificate[]) {
    const full = await this.withRelations(rows);
    const out = [];
    for (const c of full) {
      const group = c.state === CertificateState.REQUESTED ? await this.deliveryGroupFor(this.prisma, c) : null;
      out.push({
        id: c.id,
        state: c.state,
        learner: { id: c.learner.id, name: c.learner.name },
        teacher: { id: c.teacher.id, name: c.teacher.name },
        title: c.title,
        achievement: c.achievement,
        achievedOn: isoDate(c.achievedOn),
        grade: c.grade,
        printedName: c.printedName,
        note: c.note,
        requestedAt: c.requestedAt.toISOString(),
        decidedAt: c.decidedAt?.toISOString() ?? null,
        declineReason: c.declineReason,
        fileName: c.fileName,
        deliveredTo: c.conversationId,
        // Advisory for the page: a request with no live group cannot be issued yet.
        canDeliver: c.state === CertificateState.REQUESTED ? group !== null : null,
      });
    }
    return out;
  }

  private async familyLanguage(familyId: string): Promise<CardLanguage> {
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { language: true } });
    return family?.language === 'en' ? 'en' : 'ar';
  }

  /** Map the database's refusal to a stable code: the triggers have the last word. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      if (/23514|check_violation|42501|insufficient_privilege/.test(message)) {
        const reason = /message: "([^"]+)"/.exec(message)?.[1] ?? 'the certificate does not allow this';
        throw new CommError(CommErrorCode.CERTIFICATE_STATE, reason, 409);
      }
      throw e;
    }
  }
}

// ----------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function noGroup() {
  return new CommError(
    CommErrorCode.CERTIFICATE_STATE,
    'the learner has no live group to deliver the certificate into; open their Student Group first',
    409,
  );
}

function text(body: Record<string, unknown>, field: string, max: number, required: boolean): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (required) throw invalid(`${field}: required`);
    return null;
  }
  if (typeof raw !== 'string') throw invalid(`${field}: must be text`);
  const value = raw.trim().replace(/[ \t]+/g, ' ');
  if (value.length > max) throw invalid(`${field}: at most ${max} characters`);
  return value;
}

function calendarDate(body: Record<string, unknown>, field: string): Date {
  const raw = body[field];
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw invalid(`${field}: a date, YYYY-MM-DD`);
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || isoDate(d) !== raw) throw invalid(`${field}: not a real date`);
  return d;
}

function mimeField(body: Record<string, unknown>): CertificateMime {
  const raw = body.mimeType;
  if (typeof raw !== 'string' || !(CERTIFICATE_MIME_TYPES as readonly string[]).includes(raw)) {
    throw new CommError(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED, 'a certificate is a PDF, JPEG, PNG or WebP file', 400);
  }
  return raw as CertificateMime;
}

function sizeField(body: Record<string, unknown>): number {
  const raw = body.byteSize;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0 || raw > MAX_CERTIFICATE_BYTES) {
    throw new CommError(CommErrorCode.ATTACHMENT_TOO_LARGE, `a certificate file is at most ${MAX_CERTIFICATE_BYTES} bytes`, 400);
  }
  return raw;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function langOf(actor: Actor): CardLanguage {
  return actor.locale === 'en' ? 'en' : 'ar';
}
