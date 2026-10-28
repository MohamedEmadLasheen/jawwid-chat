import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type AppreciationCertificate, type AppreciationCertificateFile, type Conversation } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { canRequestCertificate, isLiveTeacher } from '../platform/pd012-policy';
import {
  CertificateAct,
  allowedActs,
  certificateAccessFrom,
  fullViewOf,
  isCertificateCategory,
  NO_CERTIFICATE_ACCESS,
  type CertificateAccess,
  type CertificateRelation,
} from '../platform/pd041-policy';
import { PermissionService } from '../platform/permissions/permission.service';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { buildObjectKey, conversationPrefix } from '../communication/attachments/object-key';
import { NotificationService } from '../communication/notifications/notification.service';
import { StoryService } from '../communication/stories/story.service';
import { ActorKind, CardKind, CertificateCategory, CertificateState, ConversationType } from '../communication/contracts/vocab';
import { CardPoster } from '../supervision/card-poster';
import { SupervisionConversationService } from '../supervision/supervision-conversation.service';
import { renderPd012CardBody, type CardLanguage } from '../supervision/pd012-cards';
import { inspectCertificateFile, sniffCertificateFile, CERTIFICATE_MIME_TYPES, MAX_CERTIFICATE_BYTES, type CertificateMime } from './certificate-file';
import { STATES_OF_GROUP, toDesignDto, toFullDto, type CertificateView } from './certificate-dto';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const MAX_TITLE = 120;
const MAX_TEXT = 1000;
const MAX_GRADE = 60;
const MAX_FILE_NAME = 200;
const MIN_REASON = 10;
const PAGE = 100;
const UPLOAD_TTL_MS = 15 * 60_000;
const READ_TTL_SECONDS = 300;
const SUSPECTED_DUPLICATE_DAYS = 30;

/** Which states an act applies to; outside them the answer is 409, not 403. */
const ACT_STATES: Readonly<Record<CertificateAct, readonly string[]>> = {
  edit: [CertificateState.REQUESTED, CertificateState.CHANGES_REQUESTED],
  resubmit: [CertificateState.CHANGES_REQUESTED],
  cancel: [CertificateState.PROPOSED, CertificateState.REQUESTED, CertificateState.IN_DESIGN, CertificateState.CHANGES_REQUESTED, CertificateState.UPLOADED, CertificateState.APPROVED],
  accept: [CertificateState.PROPOSED],
  decline: [CertificateState.PROPOSED],
  start: [CertificateState.REQUESTED],
  return: [CertificateState.REQUESTED, CertificateState.IN_DESIGN],
  release: [CertificateState.IN_DESIGN],
  upload: [CertificateState.IN_DESIGN, CertificateState.UPLOADED],
  approve: [CertificateState.UPLOADED],
  redesign: [CertificateState.UPLOADED],
  withdraw_approval: [CertificateState.APPROVED],
  send: [CertificateState.APPROVED],
  consent: [CertificateState.REQUESTED, CertificateState.IN_DESIGN, CertificateState.CHANGES_REQUESTED, CertificateState.UPLOADED, CertificateState.APPROVED, CertificateState.SENT],
  story: [CertificateState.APPROVED, CertificateState.SENT],
};

interface Ctx {
  actor: Actor;
  access: CertificateAccess;
}

interface Loaded extends Ctx {
  row: AppreciationCertificate;
  relation: CertificateRelation;
  acts: CertificateAct[];
  full: boolean;
}

/**
 * PD-41: appreciation certificates -- the Certificates page.
 *
 *   request (Ops supervisor: a student; Teacher Supervision: a teacher)
 *     -> the Designer takes it, uploads a design (or returns it, with a message)
 *     -> the requester reviews and APPROVES that exact revision
 *     -> the requester sends it into the recipient's group (the server picks it)
 *     -> optionally, a Story: after approval, only if the request opted in, and
 *        for a student only with the family's recorded consent.
 *   A teacher's PD-12 ticket arrives as a suggestion the learner's Operations
 *   supervisor accepts or declines.
 *
 * Three layers decide every act: PermissionGuard (the route's key), this
 * service (pd041-policy's allowedActs on the locked row), and the database's
 * chat.guard_appreciation_certificate, which also writes the act into the
 * append-only history. Design: docs/product/pd041-certificates-design.md.
 */
@Injectable()
export class CertificateService {
  private readonly log = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly supervision: SupervisionConversationService,
    private readonly cards: CardPoster,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationService,
    private readonly stories: StoryService,
  ) {}

  // ==================================================================
  // The teacher's suggestion (PD-12's ticket, unchanged for the app)
  // ==================================================================

  async suggest(actorId: string, body: Record<string, unknown>) {
    const actor = await this.conversations.requireActor(actorId);
    const learnerId = body.learnerId;
    if (typeof learnerId !== 'string' || !isUuid(learnerId)) throw invalid('learnerId: must be a uuid');
    const title = text(body, 'title', MAX_TITLE, true) as string;
    const achievement = text(body, 'achievement', MAX_TEXT, true) as string;
    const achievedOn = calendarDate(body, 'achievedOn', true) as Date;
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
        // The card first, so the suggestion is born with it: no write outside an act.
        const id = randomUUID();
        const conv = await this.supervision.ensureInTx(t, actor.actorId, actor.organizationId as string, null);
        const payload = { certificateId: id, learnerId, learnerName: learner!.name, title, achievement, achievedOn: isoDate(achievedOn), grade, printedName, note };
        const messageId = await this.cards.post(t, conv, actor, {
          kind: CardKind.CERTIFICATE_REQUESTED,
          payload,
          body: renderPd012CardBody(CardKind.CERTIFICATE_REQUESTED, payload, langOf(actor)),
        });
        const cert = await t.appreciationCertificate.create({
          data: {
            id,
            organizationId: actor.organizationId as string,
            category: CertificateCategory.STUDENT,
            learnerId,
            signatoryTeacherId: actor.actorId,
            suggestedByTeacher: actor.actorId,
            title,
            achievement,
            achievedOn,
            grade,
            printedName,
            internalNote: note,
            requestMessageId: messageId,
            state: CertificateState.PROPOSED,
            lastAction: 'proposed',
            lastActorTeacher: actor.actorId,
          },
        });
        await this.audit.audit(t, {
          actorId: null,
          action: 'appreciation_certificate.proposed',
          entity: 'appreciation_certificate',
          entityId: cert.id,
          after: { learnerId, teacherId: actor.actorId, title },
          reason: 'certificate suggested by the teacher',
        });
        return { cert, conversationId: conv.id };
      }),
    );
    return { certificate: this.teacherDto(created.cert), conversationId: created.conversationId };
  }

  /** A teacher's own suggestions and what became of them. */
  async listOwnSuggestions(actorId: string, query: { state?: string }) {
    const actor = await this.conversations.requireActor(actorId);
    if (!isLiveTeacher(actor)) throw new CommError(CommErrorCode.CERTIFICATE_DENIED, 'a teacher reads their own certificate suggestions here');
    if (query.state !== undefined && !Object.values(CertificateState).includes(query.state as never)) throw invalid('state: not a certificate state');
    const rows = await this.prisma.appreciationCertificate.findMany({
      where: { organizationId: actor.organizationId ?? '', suggestedByTeacher: actor.actorId, ...(query.state ? { state: query.state } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    return { certificates: rows.map((r) => this.teacherDto(r)) };
  }

  // ==================================================================
  // Reading
  // ==================================================================

  /** What the caller may do on the page: the nav, the form, the tabs. */
  async access(actorId: string) {
    const { access } = await this.ctx(actorId);
    return { ...access, canOpen: access.view };
  }

  /**
   * The page's lists. Scoped IN THE QUERY (review of #216): the categories one
   * oversees, the learners one reaches (PD-8) or the teachers in one's PD-35
   * scope, suggestions for an overseer, and -- for a designer -- every request
   * past suggestion. Keyset-paged on (requestedAt, id).
   */
  async list(actorId: string, query: { category?: string; status?: string; q?: string; cursor?: string }) {
    const ctx = await this.ctx(actorId);
    if (!ctx.access.view) throw denied();
    const and: Prisma.AppreciationCertificateWhereInput[] = [{ organizationId: ctx.actor.organizationId ?? '' }];
    if (query.category !== undefined) {
      if (!isCertificateCategory(query.category)) throw invalid('category: student | teacher');
      and.push({ category: query.category });
    }
    if (query.status !== undefined) {
      const states = STATES_OF_GROUP[query.status] ?? (Object.values(CertificateState).includes(query.status as never) ? [query.status] : null);
      if (!states) throw invalid('status: suggested | pending | in_progress | completed | sent | closed, or a state');
      and.push({ state: { in: [...states] } });
    }
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
    if (q) and.push({ OR: [{ printedName: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }] });
    and.push({ OR: await this.scopePredicate(ctx) });

    // Oldest first while waiting (a queue), newest first once done.
    const queue = query.status === 'pending' || query.status === 'suggested' || query.status === 'in_progress';
    const dir = queue ? 'asc' : 'desc';
    if (query.cursor) {
      const [at, id] = String(query.cursor).split('|');
      const d = new Date(at ?? '');
      if (Number.isNaN(d.getTime()) || !id || !isUuid(id)) throw invalid('cursor: the nextCursor of the previous page');
      const after = queue ? 'gt' : 'lt';
      and.push({ OR: [{ requestedAt: { [after]: d } }, { requestedAt: d, id: { [after]: id } }] });
    }
    const rows = await this.prisma.appreciationCertificate.findMany({
      where: { AND: and },
      orderBy: [{ requestedAt: dir }, { id: dir }],
      take: PAGE + 1,
    });
    const page = rows.slice(0, PAGE);
    const views = await this.views(this.prisma, ctx, page, false);
    const last = page[page.length - 1];
    return {
      certificates: views.map((v) => (v.full ? toFullDto(v.view) : toDesignDto(v.view))),
      nextCursor: rows.length > PAGE && last ? `${last.requestedAt.toISOString()}|${last.id}` : null,
    };
  }

  /** The rows this caller may see at all, as a query (views() then decides full or design). */
  private async scopePredicate(ctx: Ctx): Promise<Prisma.AppreciationCertificateWhereInput[]> {
    const { student, teacher } = ctx.access.categories;
    const or: Prisma.AppreciationCertificateWhereInput[] = [];
    if (student.oversee) or.push({ category: CertificateCategory.STUDENT });
    else if (student.request) or.push({ category: CertificateCategory.STUDENT, learnerId: { in: [...(await this.reachedLearners(ctx.actor))] } });
    if (teacher.oversee) {
      or.push({ category: CertificateCategory.TEACHER });
      // An undecided suggestion an overseer may cancel (review of #216: no orphans).
      or.push({ state: CertificateState.PROPOSED });
    } else if (teacher.request) {
      const scope = await this.supervision.teacherScope.scopeOf(ctx.actor);
      or.push(scope.all ? { category: CertificateCategory.TEACHER } : { category: CertificateCategory.TEACHER, recipientTeacherId: { in: [...scope.teacherIds] } });
    }
    if (ctx.access.design) or.push({ state: { notIn: [CertificateState.PROPOSED, CertificateState.DECLINED] } });
    return or.length ? or : [{ id: { in: [] } }];
  }

  async get(actorId: string, id: string) {
    const ctx = await this.ctx(actorId);
    if (!ctx.access.view) throw denied();
    const row = await this.findRow(this.prisma, ctx.actor, id);
    const [v] = await this.views(this.prisma, ctx, [row], true);
    if (!v) throw notFound();
    return { certificate: v.full ? toFullDto(v.view) : toDesignDto(v.view) };
  }

  /** The people a request may be for: the caller's learners (student) or teachers (teacher). */
  async recipients(actorId: string, query: { category?: string; q?: string }) {
    const ctx = await this.ctx(actorId);
    const category = query.category;
    if (!isCertificateCategory(category)) throw invalid('category: student | teacher');
    if (!ctx.access.categories[category].request) throw denied();
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
    const org = ctx.actor.organizationId ?? '';
    if (category === CertificateCategory.STUDENT) {
      const reached = await this.reachedLearners(ctx.actor);
      const learners = await this.prisma.learner.findMany({
        where: { organizationId: org, id: { in: [...reached] }, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
        select: { id: true, name: true, teacherId: true },
        orderBy: { name: 'asc' },
        take: 50,
      });
      const teachers = await this.namesOf(learners.map((l) => l.teacherId).filter((x): x is string => !!x));
      return { recipients: learners.map((l) => ({ id: l.id, name: l.name, teacher: l.teacherId ? { id: l.teacherId, name: teachers.get(l.teacherId) ?? '' } : null })) };
    }
    const scope = await this.supervision.teacherScope.scopeOf(ctx.actor);
    const teachers = await this.prisma.teacher.findMany({
      where: { organizationId: org, isActive: true, leftAt: null, ...(scope.all ? {} : { id: { in: [...scope.teacherIds] } }), ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return { recipients: teachers.map((t) => ({ id: t.id, name: t.name })) };
  }

  /** A short-lived signed link to one revision, for whoever may see the certificate. */
  async fileUrl(actorId: string, id: string, fileId: string) {
    const ctx = await this.ctx(actorId);
    if (!ctx.access.view) throw denied();
    const row = await this.findRow(this.prisma, ctx.actor, id);
    const [v] = await this.views(this.prisma, ctx, [row], false);
    if (!v || !isUuid(fileId)) throw notFound();
    const file = await this.prisma.appreciationCertificateFile.findFirst({ where: { id: fileId, certificateId: row.id } });
    if (!file) throw notFound();
    return { url: await this.storage.signedReadUrl(file.objectKey, READ_TTL_SECONDS), expiresInSeconds: READ_TTL_SECONDS };
  }

  // ==================================================================
  // The requester's side
  // ==================================================================

  async create(actorId: string, body: Record<string, unknown>) {
    const ctx = await this.ctx(actorId);
    const category = body.category;
    if (!isCertificateCategory(category)) throw invalid('category: student | teacher');
    if (!ctx.access.categories[category].request) throw denied();
    const requestKey = body.requestKey;
    if (typeof requestKey !== 'string' || !isUuid(requestKey)) throw invalid('requestKey: a uuid the form makes once');
    const org = ctx.actor.organizationId as string;

    // A double submit returns the first request (design §8).
    const replay = await this.prisma.appreciationCertificate.findFirst({ where: { organizationId: org, requestKey } });
    if (replay) {
      if (replay.requestedByStaff !== ctx.actor.actorId) throw invalid('requestKey: already used');
      return { certificate: await this.dtoOf(ctx, replay.id), replayed: true };
    }

    const fields = await this.requestFields(org, category, body, true);
    let learnerId: string | null = null;
    let teacherId: string | null = null;
    let signatory: string | null = null;
    if (category === CertificateCategory.STUDENT) {
      const id = body.learnerId;
      if (typeof id !== 'string' || !isUuid(id)) throw invalid('learnerId: must be a uuid');
      const learner = await this.prisma.learner.findFirst({ where: { id, organizationId: org }, select: { id: true, teacherId: true } });
      if (!learner || !(await this.reachedLearners(ctx.actor)).has(learner.id)) throw new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'learner not found');
      learnerId = learner.id;
      signatory = learner.teacherId;
    } else {
      const id = body.teacherId;
      if (typeof id !== 'string' || !isUuid(id)) throw invalid('teacherId: must be a uuid');
      const teacher = await this.prisma.teacher.findFirst({ where: { id, organizationId: org, isActive: true, leftAt: null }, select: { id: true } });
      if (!teacher || !(await this.supervision.teacherScope.covers(ctx.actor, teacher.id))) throw new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'teacher not found');
      teacherId = teacher.id;
    }

    await this.refuseDuplicate(org, category, learnerId ?? teacherId!, fields, body.confirmDuplicate === true);

    const cert = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.appreciationCertificate.create({
          data: {
            organizationId: org,
            category,
            learnerId,
            recipientTeacherId: teacherId,
            signatoryTeacherId: signatory,
            requestedByStaff: ctx.actor.actorId,
            requestKey,
            ...fields,
            state: CertificateState.REQUESTED,
            lastAction: 'requested',
            lastActorStaff: ctx.actor.actorId,
          },
        });
        await this.audit.audit(tx, {
          actorId: ctx.actor.actorId,
          action: 'appreciation_certificate.requested',
          entity: 'appreciation_certificate',
          entityId: created.id,
          after: { category, typeId: fields.typeId, learnerId, teacherId, publishStory: fields.publishStory },
          reason: 'certificate requested',
        });
        return created;
      }),
    );
    await this.notifyDesigners(cert);
    return { certificate: await this.dtoOf(ctx, cert.id), replayed: false };
  }

  async edit(actorId: string, id: string, body: Record<string, unknown>) {
    return this.act(actorId, id, CertificateAct.EDIT, async (tx, l) => {
      const fields = await this.requestFields(l.row.organizationId, l.row.category as CertificateCategory, body, false, l.row);
      await tx.appreciationCertificate.update({ where: { id: l.row.id }, data: { ...fields, ...stamp(l, 'edited', null) } });
      await this.auditAct(tx, l, 'edited', { fields: Object.keys(fields) });
    });
  }

  async resubmit(actorId: string, id: string) {
    const out = await this.act(actorId, id, CertificateAct.RESUBMIT, async (tx, l) => {
      await tx.appreciationCertificate.update({ where: { id: l.row.id }, data: { state: CertificateState.REQUESTED, ...stamp(l, 'resubmitted', null) } });
      await this.auditAct(tx, l, 'resubmitted', {});
    });
    await this.notifyDesigners(await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } }));
    return out;
  }

  async cancel(actorId: string, id: string, body: Record<string, unknown>) {
    await this.authorize(actorId, id, CertificateAct.CANCEL);
    const reason = reasonOf(body, 'reason');
    return this.act(actorId, id, CertificateAct.CANCEL, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.CANCELLED, cancelledBy: l.actor.actorId, cancelledAt: new Date(), cancelReason: reason, ...stamp(l, 'cancelled', reason) },
      });
      await this.auditAct(tx, l, 'cancelled', {}, reason);
    });
  }

  /** Owner safeguard 1: the requester approves THIS revision; the uploader never does. */
  async approve(actorId: string, id: string, body: Record<string, unknown>) {
    const fileId = typeof body.fileId === 'string' ? body.fileId : null;
    return this.act(
      actorId,
      id,
      CertificateAct.APPROVE,
      async (tx, l) => {
        if (!fileId || !isUuid(fileId)) throw invalid('fileId: the revision you reviewed');
        await tx.appreciationCertificate.update({
          where: { id: l.row.id },
          data: { state: CertificateState.APPROVED, approvedFileId: fileId, approvedBy: l.actor.actorId, approvedAt: new Date(), ...stamp(l, 'approved', null) },
        });
        await this.auditAct(tx, l, 'approved', { fileId });
      },
      (l) => {
        if (l.row.state === CertificateState.APPROVED && l.row.approvedFileId === fileId) return 'done';
        if (l.row.state === CertificateState.UPLOADED && l.row.currentFileId !== fileId) {
          throw new CommError(CommErrorCode.CERTIFICATE_REVISION_CHANGED, 'the design changed since you looked at it; review the current revision', 409, { currentFileId: l.row.currentFileId });
        }
        if (l.row.state === CertificateState.UPLOADED && l.relation.actsAsRequester && l.relation.uploadedCurrent) {
          throw new CommError(CommErrorCode.CERTIFICATE_SELF_APPROVAL, 'the person who uploaded a design does not approve it');
        }
        return null;
      },
    );
  }

  async redesign(actorId: string, id: string, body: Record<string, unknown>) {
    await this.authorize(actorId, id, CertificateAct.REDESIGN);
    const message = reasonOf(body, 'message');
    const out = await this.act(actorId, id, CertificateAct.REDESIGN, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.IN_DESIGN, returnMessage: message, ...stamp(l, 'redesign_requested', message) },
      });
      await this.auditAct(tx, l, 'redesign_requested', {}, message);
    });
    return out;
  }

  async withdrawApproval(actorId: string, id: string, body: Record<string, unknown>) {
    await this.authorize(actorId, id, CertificateAct.WITHDRAW_APPROVAL);
    const message = reasonOf(body, 'message');
    return this.act(actorId, id, CertificateAct.WITHDRAW_APPROVAL, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.IN_DESIGN, approvedFileId: null, approvedBy: null, approvedAt: null, returnMessage: message, ...stamp(l, 'approval_withdrawn', message) },
      });
      await this.auditAct(tx, l, 'approval_withdrawn', {}, message);
    });
  }

  // ------------------------------------------------------------------
  // A teacher's suggestion: the learner's assigned supervisor decides (safeguard 5)
  // ------------------------------------------------------------------

  async accept(actorId: string, id: string, body: Record<string, unknown>) {
    let teacherToTell: string | null = null;
    const out = await this.act(actorId, id, CertificateAct.ACCEPT, async (tx, l) => {
      const fields = await this.requestFields(l.row.organizationId, CertificateCategory.STUDENT, body, false, l.row);
      if (!fields.typeId && !l.row.typeId) throw invalid('typeId: pick the certificate type');
      const now = new Date();
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { ...fields, state: CertificateState.REQUESTED, requestedByStaff: l.actor.actorId, decidedBy: l.actor.actorId, decidedAt: now, ...stamp(l, 'accepted', null) },
      });
      await this.answerTeacher(tx, l, CardKind.CERTIFICATE_ACCEPTED, {});
      await this.auditAct(tx, l, 'accepted', {});
      teacherToTell = l.row.suggestedByTeacher;
    });
    const row = await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } });
    await this.notifySuggestionDecided(row, teacherToTell);
    await this.notifyDesigners(row);
    return out;
  }

  async decline(actorId: string, id: string, body: Record<string, unknown>) {
    await this.authorize(actorId, id, CertificateAct.DECLINE);
    const reason = reasonOf(body, 'reason');
    let teacherToTell: string | null = null;
    const out = await this.act(actorId, id, CertificateAct.DECLINE, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.DECLINED, decidedBy: l.actor.actorId, decidedAt: new Date(), declineReason: reason, ...stamp(l, 'declined', reason) },
      });
      await this.answerTeacher(tx, l, CardKind.CERTIFICATE_DECLINED, { reason });
      await this.auditAct(tx, l, 'declined', {}, reason);
      teacherToTell = l.row.suggestedByTeacher;
    });
    await this.notifySuggestionDecided(await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } }), teacherToTell);
    return out;
  }

  // ==================================================================
  // The Designer's side
  // ==================================================================

  async start(actorId: string, id: string) {
    return this.act(actorId, id, CertificateAct.START, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.IN_DESIGN, assignedDesignerId: l.actor.actorId, designStartedAt: new Date(), ...stamp(l, 'started', null) },
      });
      await this.auditAct(tx, l, 'started', {});
    });
  }

  /** Owner safeguard 2: a return always says what to change. */
  async returnForChanges(actorId: string, id: string, body: Record<string, unknown>) {
    await this.authorize(actorId, id, CertificateAct.RETURN);
    const message = reasonOf(body, 'message');
    const out = await this.act(actorId, id, CertificateAct.RETURN, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.CHANGES_REQUESTED, returnMessage: message, ...stamp(l, 'returned', message) },
      });
      await this.auditAct(tx, l, 'returned', {}, message);
    });
    await this.notifyRequester(await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } }), 'certificate_returned');
    return out;
  }

  async release(actorId: string, id: string) {
    return this.act(actorId, id, CertificateAct.RELEASE, async (tx, l) => {
      await tx.appreciationCertificate.update({
        where: { id: l.row.id },
        data: { state: CertificateState.REQUESTED, assignedDesignerId: null, designStartedAt: null, ...stamp(l, 'released', null) },
      });
      await this.auditAct(tx, l, 'released', {});
    });
  }

  /**
   * A signed PUT for the design. The key is minted in a staging namespace of
   * this certificate and recorded as issued to this Designer; it is never
   * served -- confirming copies the bytes to a pinned key (design §7).
   */
  async authorizeUpload(actorId: string, id: string, body: Record<string, unknown>) {
    const issued: { grant?: Awaited<ReturnType<ObjectStorage['authorizeUpload']>> } = {};
    await this.act(actorId, id, CertificateAct.UPLOAD, async (tx, l) => {
      const mimeType = mimeField(body);
      const byteSize = sizeField(body);
      const grant = await this.storage.authorizeUpload({ prefix: `certificate-uploads/${l.row.organizationId}/${l.row.id}`, mimeType, byteSize });
      await tx.certificateUpload.create({
        data: { objectKey: grant.objectKey, certificateId: l.row.id, mimeType, byteSize, issuedTo: l.actor.actorId, expiresAt: new Date(Date.now() + UPLOAD_TTL_MS) },
      });
      issued.grant = grant;
    }, undefined, false);
    return { upload: issued.grant! };
  }

  async confirmUpload(actorId: string, id: string, body: Record<string, unknown>) {
    const objectKey = body.objectKey;
    if (typeof objectKey !== 'string' || objectKey.length === 0) throw invalid('objectKey: required');
    const fileName = text(body, 'fileName', MAX_FILE_NAME, true) as string;
    const upload = await this.prisma.certificateUpload.findUnique({ where: { objectKey } });
    if (!upload || upload.certificateId !== id) throw new CommError(CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION, 'this upload was not issued for this certificate', 403);
    if (upload.consumedAt) return { certificate: await this.dtoOf(await this.ctx(actorId), id), replayed: true };
    if (upload.expiresAt.getTime() < Date.now()) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'the upload expired; upload the file again', 409);

    // What was ACTUALLY uploaded, not what the client says it uploaded.
    const head = await this.storage.readHead(objectKey, 16);
    if (!head) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'the file has not been uploaded', 409);
    if (head.byteSize !== upload.byteSize || sniffCertificateFile(head.head) !== upload.mimeType) {
      throw new CommError(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED, 'the uploaded file is not the PDF or image it claims to be', 400);
    }
    if (!this.storage.copy) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'this storage cannot pin an upload; the file is not accepted', 409);
    // A key no upload grant can name: the bytes reviewed are the bytes kept.
    const pinned = `certificates/${await this.orgOf(id)}/${id}/v/${randomUUID()}`;
    if (!(await this.storage.copy(objectKey, pinned))) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'the file has not been uploaded', 409);

    try {
      // The WHOLE pinned copy -- the bytes that will be sent -- not just its head.
      const bytes = await this.readAll(pinned);
      const refused = bytes ? (bytes.length === upload.byteSize ? inspectCertificateFile(bytes, upload.mimeType as CertificateMime) : 'the file changed size') : 'the file has not been uploaded';
      if (refused) throw new CommError(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED, refused, 400);
      const out = await this.act(actorId, id, CertificateAct.UPLOAD, async (tx, l) => {
        if (upload.issuedTo !== l.actor.actorId) throw new CommError(CommErrorCode.CERTIFICATE_DENIED, 'this upload was issued to another designer');
        const last = await tx.appreciationCertificateFile.findFirst({ where: { certificateId: l.row.id }, orderBy: { revision: 'desc' }, select: { revision: true } });
        const file = await tx.appreciationCertificateFile.create({
          data: { certificateId: l.row.id, revision: (last?.revision ?? 0) + 1, objectKey: pinned, mimeType: upload.mimeType, byteSize: upload.byteSize, fileName, uploadedBy: l.actor.actorId },
        });
        await tx.certificateUpload.update({ where: { objectKey }, data: { consumedAt: new Date(), fileId: file.id } });
        await tx.appreciationCertificate.update({
          where: { id: l.row.id },
          data: { state: CertificateState.UPLOADED, currentFileId: file.id, ...stamp(l, 'file_uploaded', null) },
        });
        await this.auditAct(tx, l, 'file_uploaded', { fileId: file.id, revision: file.revision, mimeType: file.mimeType, byteSize: file.byteSize });
      });
      await this.storage.delete(objectKey).catch(() => undefined);
      await this.notifyRequester(await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } }), 'certificate_uploaded');
      return out;
    } catch (e) {
      await this.storage.delete(pinned).catch(() => undefined);
      throw e;
    }
  }

  // ==================================================================
  // Delivery: send, consent, Story
  // ==================================================================

  /**
   * Where the certificate would go now; send must echo it (design §5). A read:
   * it creates nothing -- a teacher with no supervision conversation yet gets
   * `conversationId: null`, and the send opens it.
   */
  async deliveryTarget(actorId: string, id: string) {
    const ctx = await this.ctx(actorId);
    const row = await this.findRow(this.prisma, ctx.actor, id);
    const [v] = await this.views(this.prisma, ctx, [row], false);
    if (!v || !v.full || !ctx.access.categories[row.category as CertificateCategory].deliver) throw notFound();
    const target = await this.targetOf(this.prisma, row, false);
    if (!target) {
      if (row.category !== CertificateCategory.TEACHER) return { target: null };
      const teacher = await this.prisma.teacher.findUnique({ where: { id: row.recipientTeacherId! }, select: { name: true } });
      return { target: { conversationId: null, type: ConversationType.TEACHER_SUPERVISION, title: teacher?.name ?? null, members: null } };
    }
    const members = await this.prisma.conversationMember.count({ where: { conversationId: target.id, leftAt: null } });
    return { target: { conversationId: target.id, type: target.type, title: target.title, members } };
  }

  async send(actorId: string, id: string, body: Record<string, unknown>) {
    const ctx = await this.ctx(actorId);
    const before = await this.requireRequesterSide(ctx, id, 'deliver');
    const conversationId = body.conversationId ?? null;
    if (conversationId !== null && (typeof conversationId !== 'string' || !isUuid(conversationId))) throw invalid('conversationId: the group you were shown');
    if (before.state === CertificateState.SENT) {
      if (before.conversationId === conversationId && before.sentBy) return { certificate: await this.dtoOf(ctx, id), replayed: true };
      throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'this certificate was already sent', 409);
    }
    const file = before.approvedFileId ? await this.prisma.appreciationCertificateFile.findUnique({ where: { id: before.approvedFileId } }) : null;
    if (!file) throw notApproved();
    if (!this.storage.copy) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'this storage cannot deliver a pinned file', 409);
    let delivered: string | null = null;
    try {
      return await this.act(actorId, id, CertificateAct.SEND, async (tx, l) => {
        const existing = await this.targetOf(tx, l.row, false);
        // A teacher's supervision conversation that did not exist when it was shown is opened now.
        const target = existing ?? (conversationId === null ? await this.targetOf(tx, l.row, true) : null);
        if (!target) throw noGroup(l.row.category);
        if ((existing?.id ?? null) !== conversationId) {
          throw new CommError(CommErrorCode.CERTIFICATE_TARGET_CHANGED, 'the group changed since it was shown; check it and send again', 409, { conversationId: existing?.id ?? null });
        }
        if (l.row.approvedFileId !== file.id) throw notApproved();
        delivered = buildObjectKey(conversationPrefix(target.id));
        if (!(await this.storage.copy!(file.objectKey, delivered))) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'the approved file is missing', 409);
        const type = l.row.typeId ? await tx.certificateType.findUnique({ where: { id: l.row.typeId } }) : null;
        const messageId = await this.postDelivery(tx, l, target, file, delivered);
        await tx.appreciationCertificateFile.update({ where: { id: file.id }, data: { deliveredObjectKey: delivered } });
        await tx.appreciationCertificate.update({
          where: { id: l.row.id },
          data: {
            state: CertificateState.SENT,
            sentAt: new Date(),
            sentBy: l.actor.actorId,
            conversationId: target.id,
            sentMessageId: messageId,
            // The type as it read when sent: a later relabel never rewrites a delivered certificate.
            typeLabelEn: type?.labelEn ?? null,
            typeLabelAr: type?.labelAr ?? null,
            ...stamp(l, 'sent', null),
          },
        });
        await this.auditAct(tx, l, 'sent', { conversationId: target.id, messageId, fileId: file.id });
      });
    } catch (e) {
      if (delivered) await this.storage.delete(delivered).catch(() => undefined);
      throw e;
    }
  }

  /**
   * Owner safeguard 4: a student Story needs the family's explicit, documented
   * consent -- WHICH parent, HOW, and the evidence. Recording it is its own act,
   * never part of publishing. A withdrawal takes a published Story down IN THE
   * SAME TRANSACTION, by whoever answers for the certificate now (a PD-33
   * backup included): both commit, or neither does.
   */
  async recordConsent(actorId: string, id: string, body: Record<string, unknown>) {
    await this.authorize(actorId, id, CertificateAct.CONSENT);
    const kind = body.kind;
    if (kind !== 'granted' && kind !== 'withdrawn') throw invalid('kind: granted | withdrawn');
    const note = text(body, 'note', MAX_TEXT, false);
    let contactId: string | null = null;
    let method: string | null = null;
    let evidence: string | null = null;
    if (kind === 'granted') {
      if (typeof body.contactId !== 'string' || !isUuid(body.contactId)) throw invalid('contactId: the parent who agreed');
      contactId = body.contactId;
      if (!['in_chat', 'phone', 'in_person', 'written'].includes(String(body.method))) throw invalid('method: in_chat | phone | in_person | written');
      method = String(body.method);
      if (body.evidenceMessageId !== undefined && body.evidenceMessageId !== null) {
        if (typeof body.evidenceMessageId !== 'string' || !isUuid(body.evidenceMessageId)) throw invalid('evidenceMessageId: must be a uuid');
        evidence = body.evidenceMessageId;
      }
      if (method !== 'in_chat' && (note?.length ?? 0) < MIN_REASON) {
        throw invalid(method === 'written' ? 'note: where the signed document is kept (at least 10 characters)' : 'note: say when and how the parent agreed (at least 10 characters)');
      }
      if (method === 'in_chat' && !evidence && (note?.length ?? 0) < MIN_REASON) throw invalid('evidenceMessageId: link the parent\'s message, or describe it in the note');
    } else if ((note?.length ?? 0) < MIN_REASON) {
      throw invalid('note: why consent is withdrawn (at least 10 characters)');
    }

    return this.act(actorId, id, CertificateAct.CONSENT, async (tx, l) => {
      const seq = l.row.actionSeq + 1;
      await tx.certificateStoryConsent.create({
        data: { certificateId: l.row.id, kind, givenByContactId: contactId, method, evidenceMessageId: evidence, note, recordedBy: l.actor.actorId, actionSeq: seq },
      });
      await tx.appreciationCertificate.update({ where: { id: l.row.id }, data: stamp(l, kind === 'granted' ? 'consent_granted' : 'consent_withdrawn', kind === 'withdrawn' ? note : null) });
      await this.auditAct(tx, l, kind === 'granted' ? 'consent_granted' : 'consent_withdrawn', { contactId, method, evidenceMessageId: evidence }, note ?? undefined);
      if (kind === 'withdrawn' && l.row.storyId && !l.row.storyWithdrawnAt) {
        await this.stories.retireForCertificate(tx, l.row.storyId, l.actor.actorId, 'family consent withdrawn');
        await tx.appreciationCertificate.update({
          where: { id: l.row.id },
          data: { storyWithdrawnAt: new Date(), actionSeq: seq + 1, lastAction: 'story_withdrawn', lastNote: 'family consent withdrawn', lastActorStaff: l.actor.actorId, lastActorTeacher: null },
        });
        await this.auditAct(tx, l, 'story_withdrawn', { storyId: l.row.storyId });
      }
    });
  }

  /**
   * Owner safeguards 3 and 4: explicit, once, after approval, opted in,
   * consented. In two phases, so no crash leaves a live Story the certificate
   * does not know: the Story is created HIDDEN (a draft reaches nobody), linked
   * under the certificate's lock -- where consent is decided again -- and only
   * then published. A retry finishes a linked draft.
   */
  async publishStory(actorId: string, id: string) {
    const ctx = await this.ctx(actorId);
    const row = await this.requireRequesterSide(ctx, id, 'story');
    if (row.storyId) {
      const story = await this.prisma.story.findUnique({ where: { id: row.storyId }, select: { state: true } });
      if (story?.state === 'draft' && !row.storyWithdrawnAt) await this.stories.publish(row.storyId, actorId);
      return { certificate: await this.dtoOf(ctx, id), replayed: true };
    }
    if (!row.publishStory) throw new CommError(CommErrorCode.CERTIFICATE_STORY_NOT_OPTED_IN, 'this request did not opt in to a Story', 409);
    if (row.state !== CertificateState.APPROVED && row.state !== CertificateState.SENT) throw notApproved();
    const category = await this.prisma.certificateCategory.findUniqueOrThrow({ where: { key: row.category } });
    if (category.storyNeedsConsent && !(await this.consentGranted(this.prisma, row.id))) throw consentMissing();
    const file = row.approvedFileId ? await this.prisma.appreciationCertificateFile.findUnique({ where: { id: row.approvedFileId } }) : null;
    if (!file) throw notApproved();
    if (!file.mimeType.startsWith('image/')) throw new CommError(CommErrorCode.CERTIFICATE_STORY_NEEDS_IMAGE, 'a Story shows an image; this certificate is a PDF', 409);
    if (!this.storage.copy) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'this storage cannot copy the certificate into Stories', 409);
    // A server-minted key, recorded as Stories' own grant to this publisher (design R7).
    const mediaKey = buildObjectKey('stories');
    if (!(await this.storage.copy(file.objectKey, mediaKey))) throw new CommError(CommErrorCode.CERTIFICATE_STATE, 'the approved file is missing', 409);
    let draftId: string | null = null;
    try {
      await this.stories.grantCertificateMedia(actorId, mediaKey, file.mimeType, file.byteSize);
      const draft = await this.stories.create(actorId, {
        internalName: `Certificate · ${row.printedName}`.slice(0, 120),
        mediaObjectKey: mediaKey,
        mediaKind: 'image',
        mediaMime: file.mimeType,
        audiences: [{ kind: category.storyAudience }],
      });
      draftId = draft.id;
      await this.act(actorId, id, CertificateAct.STORY, async (tx, l) => {
        if (category.storyNeedsConsent && !(await this.consentGranted(tx, l.row.id))) throw consentMissing();
        await tx.appreciationCertificate.update({
          where: { id: l.row.id },
          data: { storyId: draft.id, storyPublishedAt: new Date(), storyPublishedBy: l.actor.actorId, ...stamp(l, 'story_published', null) },
        });
        await this.auditAct(tx, l, 'story_published', { storyId: draft.id, audience: category.storyAudience });
      }, undefined, false);
    } catch (e) {
      if (draftId) await this.stories.remove(draftId, actorId, 'the certificate refused its Story').catch(() => undefined);
      else await this.storage.delete(mediaKey).catch(() => undefined);
      throw e;
    }
    // Linked: now it may go live. A failure here leaves a linked draft, which a retry publishes.
    await this.stories.publish(draftId, actorId);
    return { certificate: await this.dtoOf(ctx, id), replayed: false };
  }

  // ==================================================================
  // The one path every act takes
  // ==================================================================

  /**
   * Lock the row, decide the act on what is there NOW, run it. `pre` may
   * answer an idempotent repeat ('done') or a more precise refusal before the
   * generic one. The database re-decides the write and records it.
   */
  private async act(
    actorId: string,
    id: string,
    act: CertificateAct,
    run: (tx: Tx, l: Loaded) => Promise<void>,
    pre?: (l: Loaded) => 'done' | null,
    answer = true,
  ): Promise<{ certificate: unknown; replayed: boolean }> {
    const ctx = await this.ctx(actorId);
    let replayed = false;
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        if (!isUuid(id) || !ctx.actor.organizationId) throw notFound();
        await tx.$queryRaw`SELECT id FROM chat.appreciation_certificate WHERE id = ${id}::uuid AND organization_id = ${ctx.actor.organizationId}::uuid FOR UPDATE`;
        const row = await this.findRow(tx, ctx.actor, id);
        const [v] = await this.views(tx, ctx, [row], false);
        if (!v) throw notFound();
        const l: Loaded = { ...ctx, row, relation: v.relation, acts: v.view.acts as CertificateAct[], full: v.full };
        if (pre?.(l) === 'done') {
          replayed = true;
          return;
        }
        if (!l.acts.includes(act)) throw refusal(act, l);
        await run(tx, l);
      }),
    );
    return { certificate: answer ? await this.dtoOf(ctx, id) : null, replayed };
  }

  /**
   * Before any state is read out to the caller: they see the row on the
   * requester side, hold the act's key for its category, and act as its
   * requester of record. Everything after this may name the state.
   */
  private async requireRequesterSide(ctx: Ctx, id: string, need: 'deliver' | 'story'): Promise<AppreciationCertificate> {
    const row = await this.findRow(this.prisma, ctx.actor, id);
    const [v] = await this.views(this.prisma, ctx, [row], false);
    if (!v) throw notFound();
    if (!v.full || !ctx.access.categories[row.category as CertificateCategory][need] || !v.relation.actsAsRequester) throw denied();
    return row;
  }

  /**
   * Is this act open to this caller on this certificate NOW? Run before the
   * request body is read, so a refusal never depends on -- or reveals -- what
   * shape the body had (review of #216: authorization first).
   */
  private async authorize(actorId: string, id: string, act: CertificateAct): Promise<void> {
    await this.act(actorId, id, act, async () => undefined, undefined, false);
  }

  private async ctx(actorId: string): Promise<Ctx> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF) return { actor, access: NO_CERTIFICATE_ACCESS };
    const profile = await this.permissions.profileOf(actor);
    return { actor, access: certificateAccessFrom(profile.permissions) };
  }

  private async findRow(db: Db, actor: Actor, id: string): Promise<AppreciationCertificate> {
    if (!isUuid(id)) throw notFound();
    const row = await db.appreciationCertificate.findFirst({ where: { id, organizationId: actor.organizationId ?? '' } });
    if (!row) throw notFound();
    return row;
  }

  private async dtoOf(ctx: Ctx, id: string) {
    const row = await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id } });
    const [v] = await this.views(this.prisma, ctx, [row], true);
    if (!v) return null;
    return v.full ? toFullDto(v.view) : toDesignDto(v.view);
  }

  /**
   * Who sees each row, and how (design §6.4): the FULL record for the
   * requester side of its category -- an overseer, the requester of record or
   * their cover, staff who reach the recipient -- and the DESIGN projection for
   * a designer (never a suggestion). Rows the caller may not see are dropped.
   */
  private async views(db: Db, ctx: Ctx, rows: AppreciationCertificate[], withHistory: boolean) {
    if (rows.length === 0 || ctx.actor.kind !== ActorKind.STAFF) return [];
    const staffId = ctx.actor.actorId;
    const student = ctx.access.categories.student;
    const teacher = ctx.access.categories.teacher;
    const reached = student.request && !student.oversee && rows.some((r) => r.category === 'student') ? await this.reachedLearners(ctx.actor, db) : new Set<string>();
    const scope = teacher.request && !teacher.oversee && rows.some((r) => r.category === 'teacher') ? await this.supervision.teacherScope.scopeOf(ctx.actor) : null;
    const proposed = rows.filter((r) => r.state === CertificateState.PROPOSED && r.learnerId);
    const supervisors = await this.supervisorsOf(db, proposed.map((r) => r.learnerId!));
    const actsAs = await this.actsAs(db, staffId, [...supervisors.values()]);
    // Who answers for each certificate NOW -- the database's own rule (chat.certificate_responsible).
    const responsible = await this.responsibleFor(db, staffId, rows.filter((r) => r.requestedByStaff).map((r) => r.id));
    const anyOversee = student.oversee || teacher.oversee;
    const fileIds = rows.map((r) => r.currentFileId).filter((x): x is string => !!x);
    const currentFiles = new Map((await db.appreciationCertificateFile.findMany({ where: { id: { in: fileIds } } })).map((f) => [f.id, f]));

    const out: Array<{ view: CertificateView; full: boolean; relation: CertificateRelation }> = [];
    for (const row of rows) {
      const category = row.category as CertificateCategory;
      const c = ctx.access.categories[category];
      const asRequester = responsible.get(row.id) === true;
      const supervisor = row.learnerId ? supervisors.get(row.learnerId) : undefined;
      // A learner nobody supervises: the Operations manager decides (review of #216).
      const decides =
        row.state === CertificateState.PROPOSED && (supervisor ? actsAs.get(supervisor) === true : student.oversee);
      const reaches =
        category === CertificateCategory.STUDENT
          ? !!row.learnerId && reached.has(row.learnerId)
          : !!scope && !!row.recipientTeacherId && (scope.all || scope.teacherIds.has(row.recipientTeacherId));
      const full =
        (fullViewOf(ctx.access, category) && (c.oversee || asRequester || decides || reaches)) ||
        // An undecided suggestion is in reach of every overseer, who may cancel it.
        (row.state === CertificateState.PROPOSED && anyOversee);
      const design = ctx.access.design && row.state !== CertificateState.PROPOSED && row.state !== CertificateState.DECLINED;
      if (!full && !design) continue;
      const current = row.currentFileId ? (currentFiles.get(row.currentFileId) ?? null) : null;
      const relation: CertificateRelation = {
        category,
        state: row.state as CertificateState,
        actsAsRequester: asRequester,
        decidesSuggestion: decides,
        isAssignedDesigner: row.assignedDesignerId === staffId,
        uploadedCurrent: current?.uploadedBy === staffId,
        publishStory: row.publishStory,
        storyPublished: !!row.storyId,
        storyWithdrawn: !!row.storyWithdrawnAt,
      };
      // Without the requester side, only the design acts are offered.
      const scoped: CertificateAccess = full ? ctx.access : { ...ctx.access, categories: NO_CERTIFICATE_ACCESS.categories };
      relation.anyOversee = full && anyOversee;
      out.push({ view: await this.viewOf(db, row, current, allowedActs(scoped, relation), withHistory, full), full, relation });
    }
    return out;
  }

  private async viewOf(
    db: Db,
    row: AppreciationCertificate,
    current: AppreciationCertificateFile | null,
    acts: CertificateAct[],
    withHistory: boolean,
    full: boolean,
  ): Promise<CertificateView> {
    const [type, learner, files, consent, history] = await Promise.all([
      row.typeId ? db.certificateType.findUnique({ where: { id: row.typeId } }) : null,
      row.learnerId ? db.learner.findUnique({ where: { id: row.learnerId }, select: { id: true, name: true } }) : null,
      withHistory ? db.appreciationCertificateFile.findMany({ where: { certificateId: row.id }, orderBy: { revision: 'asc' } }) : Promise.resolve(current ? [current] : []),
      full && row.category === CertificateCategory.STUDENT ? db.certificateStoryConsent.findFirst({ where: { certificateId: row.id }, orderBy: { actionSeq: 'desc' } }) : null,
      withHistory ? db.appreciationCertificateEvent.findMany({ where: { certificateId: row.id }, orderBy: { seq: 'asc' } }) : null,
    ]);
    const ids = [
      row.requestedByStaff,
      row.suggestedByTeacher,
      row.assignedDesignerId,
      row.approvedBy,
      row.sentBy,
      row.decidedBy,
      row.cancelledBy,
      row.signatoryTeacherId,
      row.recipientTeacherId,
      consent?.recordedBy ?? null,
      ...files.map((f) => f.uploadedBy),
      ...(history ?? []).flatMap((e) => [e.actorStaffId, e.actorTeacherId]),
    ].filter((x): x is string => !!x);
    const names = await this.namesOf(ids, db);
    return {
      row,
      type,
      learner,
      recipientTeacher: row.recipientTeacherId ? { id: row.recipientTeacherId, name: names.get(row.recipientTeacherId) ?? '' } : null,
      signatory: row.signatoryTeacherId ? { id: row.signatoryTeacherId, name: names.get(row.signatoryTeacherId) ?? '' } : null,
      names,
      currentFile: current,
      files,
      latestConsent: consent,
      history,
      acts,
    };
  }

  // ------------------------------------------------------------------

  /** The learners whose supervisor the caller acts for (self, backup or manager). */
  private async reachedLearners(actor: Actor, db: Db = this.prisma): Promise<Set<string>> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT ls.learner_id::text AS id
        FROM chat.learner_supervision ls
        JOIN chat.learner l ON l.id = ls.learner_id
       WHERE l.organization_id = ${actor.organizationId ?? ''}::uuid
         AND chat.staff_acts_for(${actor.actorId}::uuid, ls.supervisor_id, now()) IS NOT NULL`;
    return new Set(rows.map((r) => r.id));
  }

  private async supervisorsOf(db: Db, learnerIds: string[]): Promise<Map<string, string>> {
    if (learnerIds.length === 0) return new Map();
    const rows = await db.learnerSupervision.findMany({ where: { learnerId: { in: learnerIds } }, select: { learnerId: true, supervisorId: true } });
    return new Map(rows.map((r) => [r.learnerId, r.supervisorId]));
  }

  private async responsibleFor(db: Db, staffId: string, ids: string[]): Promise<Map<string, boolean>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<Array<{ id: string; ok: boolean }>>`
      SELECT c::text AS id, chat.certificate_responsible(${staffId}::uuid, c) AS ok FROM unnest(${ids}::uuid[]) AS c`;
    return new Map(rows.map((r) => [r.id, r.ok]));
  }

  /** chat.certificate_acts_as for each principal: themself or their active cover. */
  private async actsAs(db: Db, staffId: string, principals: Array<string | null>): Promise<Map<string, boolean>> {
    const ids = [...new Set(principals.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<Array<{ id: string; ok: boolean }>>`
      SELECT p::text AS id, chat.certificate_acts_as(${staffId}::uuid, p) AS ok FROM unnest(${ids}::uuid[]) AS p`;
    return new Map(rows.map((r) => [r.id, r.ok]));
  }

  /** The database's own answer: the latest consent recorded BY ITS ACT is a grant. */
  private async consentGranted(db: Db, id: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.certificate_consent_granted(${id}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  private async namesOf(ids: string[], db: Db = this.prisma): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const [staff, teachers] = await Promise.all([
      db.staff.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
      db.teacher.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }),
    ]);
    return new Map([...staff, ...teachers].map((p) => [p.id, p.name]));
  }

  private async readAll(objectKey: string): Promise<Buffer | null> {
    const got = await this.storage.read(objectKey);
    if (!got || got === 'unsatisfiable') return null;
    if (Buffer.isBuffer(got.body)) return got.body;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of got.body) {
      total += chunk.length;
      if (total > MAX_CERTIFICATE_BYTES) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async orgOf(id: string): Promise<string> {
    const row = await this.prisma.appreciationCertificate.findUniqueOrThrow({ where: { id }, select: { organizationId: true } });
    return row.organizationId;
  }

  /**
   * The request's words, validated against its type. `creating` requires what
   * a new request must carry; otherwise only the fields present change.
   */
  private async requestFields(org: string, category: CertificateCategory, body: Record<string, unknown>, creating: boolean, current?: AppreciationCertificate) {
    const out: Prisma.AppreciationCertificateUncheckedUpdateInput & Record<string, unknown> = {};
    let type = current?.typeId ? await this.prisma.certificateType.findUnique({ where: { id: current.typeId } }) : null;
    if (creating || body.typeId !== undefined) {
      const typeId = body.typeId;
      if (typeof typeId !== 'string' || !isUuid(typeId)) throw invalid('typeId: pick the certificate type');
      type = await this.prisma.certificateType.findFirst({ where: { id: typeId, organizationId: org, category } });
      if (!type) throw invalid('typeId: not a certificate type of this category');
      if (!type.isActive) throw new CommError(CommErrorCode.CERTIFICATE_TYPE_DISABLED, 'this certificate type is disabled; pick an active one', 409);
      out.typeId = type.id;
    }
    const has = (k: string) => creating || body[k] !== undefined;
    if (has('title')) out.title = text(body, 'title', MAX_TITLE, false) ?? (current?.title && !creating ? current.title : type!.labelAr);
    if (has('achievement')) out.achievement = text(body, 'achievement', MAX_TEXT, false) ?? (out.title as string | undefined) ?? current?.achievement ?? type!.labelAr;
    if (has('printedName')) {
      const v = text(body, 'printedName', MAX_TITLE, creating);
      if (v !== null) out.printedName = v;
    }
    if (has('achievedOn')) out.achievedOn = calendarDate(body, 'achievedOn', false);
    if (has('grade')) out.grade = text(body, 'grade', MAX_GRADE, false);
    if (has('designerNote')) out.designerNote = text(body, 'designerNote', MAX_TEXT, false);
    if (has('internalNote')) out.internalNote = text(body, 'internalNote', MAX_TEXT, false);
    if (has('publishStory')) {
      if (body.publishStory !== undefined && typeof body.publishStory !== 'boolean') throw invalid('publishStory: true | false');
      out.publishStory = body.publishStory === true;
    }
    if (has('juz')) {
      const juz = body.juz;
      if (juz === undefined || juz === null) out.juz = null;
      else if (typeof juz !== 'number' || !Number.isInteger(juz) || juz < 1 || juz > 30) throw invalid('juz: 1 to 30');
      else out.juz = juz;
    }
    if (has('periodStart')) out.periodStart = calendarDate(body, 'periodStart', false);
    if (has('periodEnd')) out.periodEnd = calendarDate(body, 'periodEnd', false);
    if (type?.needsJuz && (out.juz ?? (out.juz === undefined ? current?.juz : null)) == null) throw invalid('juz: this certificate type needs the Juz\'');
    if (type?.needsPeriod && (out.periodStart ?? (out.periodStart === undefined ? current?.periodStart : null)) == null) throw invalid('periodStart: this certificate type needs its period');
    const ps = (out.periodStart as Date | null | undefined) ?? current?.periodStart ?? null;
    const pe = (out.periodEnd as Date | null | undefined) ?? current?.periodEnd ?? null;
    if (pe && (!ps || pe < ps)) throw invalid('periodEnd: on or after periodStart');
    return out as {
      typeId?: string;
      title?: string;
      achievement?: string;
      printedName?: string;
      achievedOn?: Date | null;
      grade?: string | null;
      designerNote?: string | null;
      internalNote?: string | null;
      publishStory?: boolean;
      juz?: number | null;
      periodStart?: Date | null;
      periodEnd?: Date | null;
    } & { title: string; achievement: string; printedName: string };
  }

  /** Design §8: the same certificate twice is refused; a near-duplicate needs confirming. */
  private async refuseDuplicate(org: string, category: CertificateCategory, recipient: string, f: { typeId?: string; juz?: number | null; periodStart?: Date | null }, confirmed: boolean) {
    const recipientWhere = category === CertificateCategory.STUDENT ? { learnerId: recipient } : { recipientTeacherId: recipient };
    const open = { notIn: [CertificateState.CANCELLED, CertificateState.DECLINED] as string[] };
    if (f.juz != null || f.periodStart) {
      const same = await this.prisma.appreciationCertificate.findFirst({
        where: { organizationId: org, category, ...recipientWhere, typeId: f.typeId, juz: f.juz ?? null, periodStart: f.periodStart ?? null, state: open },
        select: { id: true, state: true },
      });
      if (same) throw new CommError(CommErrorCode.CERTIFICATE_DUPLICATE, 'this certificate is already requested', 409, { certificateId: same.id, state: same.state });
      return;
    }
    if (confirmed) return;
    const since = new Date(Date.now() - SUSPECTED_DUPLICATE_DAYS * 86_400_000);
    const similar = await this.prisma.appreciationCertificate.findFirst({
      where: { organizationId: org, category, ...recipientWhere, typeId: f.typeId, state: open, requestedAt: { gte: since } },
      select: { id: true, state: true },
    });
    if (similar) {
      throw new CommError(CommErrorCode.CERTIFICATE_DUPLICATE_SUSPECTED, 'a similar certificate was requested in the last 30 days; confirm to request another', 409, {
        certificateId: similar.id,
        state: similar.state,
      });
    }
  }

  /**
   * Where a certificate goes. Student: the learner's live student group, else a
   * live family group about them that their teacher is in (PD-12's rule).
   * Teacher: their own supervision conversation -- no teachers' group exists
   * (design §5, owner Q3).
   */
  private async targetOf(tx: Db, row: AppreciationCertificate, open: boolean): Promise<Conversation | null> {
    if (row.category === CertificateCategory.TEACHER) {
      const existing = await tx.conversation.findFirst({
        where: { type: ConversationType.TEACHER_SUPERVISION, supervisedTeacherId: row.recipientTeacherId, archivedAt: null, organizationId: row.organizationId },
      });
      if (existing || !open) return existing;
      return this.supervision.ensureInTx(tx as Tx, row.recipientTeacherId!, row.organizationId, null).catch(() => null);
    }
    const own = await tx.conversation.findFirst({
      where: { type: ConversationType.STUDENT_GROUP, learnerId: row.learnerId, archivedAt: null, organizationId: row.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    if (own) return own;
    const learner = await tx.learner.findUnique({ where: { id: row.learnerId! }, select: { teacherId: true } });
    if (!learner?.teacherId) return null;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id
        FROM chat.conversation c
        JOIN chat.conversation_learner cl ON cl.conversation_id = c.id
       WHERE cl.learner_id = ${row.learnerId}::uuid
         AND c.type = 'family_group'
         AND c.archived_at IS NULL
         AND c.organization_id = ${row.organizationId}::uuid
         AND EXISTS (SELECT 1 FROM chat.conversation_member m
                      WHERE m.conversation_id = c.id AND m.actor_id = ${learner.teacherId}::uuid AND m.left_at IS NULL)
       ORDER BY c.created_at DESC
       LIMIT 1`;
    return rows.length ? tx.conversation.findUnique({ where: { id: rows[0]!.id } }) : null;
  }

  private async postDelivery(tx: Tx, l: Loaded, target: Conversation, file: AppreciationCertificateFile, delivered: string): Promise<string> {
    const r = l.row;
    const type = r.typeId ? await tx.certificateType.findUnique({ where: { id: r.typeId } }) : null;
    const attachment = { kind: file.mimeType === 'application/pdf' ? ('file' as const) : ('image' as const), objectKey: delivered, mimeType: file.mimeType, byteSize: file.byteSize, originalName: file.fileName };
    if (r.category === CertificateCategory.TEACHER) {
      const teacher = await this.conversations.requireActor(r.recipientTeacherId!);
      const lang = langOf(teacher);
      const payload = { certificateId: r.id, teacherId: r.recipientTeacherId, title: r.title, type: type ? (lang === 'en' ? type.labelEn : type.labelAr) : null, printedName: r.printedName, periodStart: r.periodStart ? isoDate(r.periodStart) : null, periodEnd: r.periodEnd ? isoDate(r.periodEnd) : null };
      return this.cards.post(tx, target, l.actor, { kind: CardKind.CERTIFICATE_AWARDED, payload, body: renderPd012CardBody(CardKind.CERTIFICATE_AWARDED, payload, lang) }, attachment);
    }
    const learner = await tx.learner.findUnique({ where: { id: r.learnerId! }, select: { name: true, familyId: true } });
    const family = learner ? await tx.family.findUnique({ where: { id: learner.familyId }, select: { language: true } }) : null;
    const lang: CardLanguage = family?.language === 'en' ? 'en' : 'ar';
    const payload = { certificateId: r.id, learnerId: r.learnerId, learnerName: learner?.name ?? r.printedName, title: r.title, achievement: r.achievement, achievedOn: r.achievedOn ? isoDate(r.achievedOn) : null, grade: r.grade, printedName: r.printedName, juz: r.juz };
    // Into the family's group as the academy, never as the person who pressed send.
    const messageId = await this.cards.post(tx, target, null, { kind: CardKind.CERTIFICATE_ISSUED, payload, body: renderPd012CardBody(CardKind.CERTIFICATE_ISSUED, payload, lang) }, attachment);
    // A teacher's suggestion is answered where it was asked (PD-12).
    if (r.suggestedByTeacher) {
      const conv = await this.supervision.ensureInTx(tx, r.suggestedByTeacher, r.organizationId, l.actor.actorId).catch(() => null);
      if (conv) {
        const teacher = await this.conversations.requireActor(r.suggestedByTeacher);
        await this.cards.post(tx, conv, l.actor, { kind: CardKind.CERTIFICATE_ISSUED, payload: { ...payload, deliveredTo: target.id }, body: renderPd012CardBody(CardKind.CERTIFICATE_ISSUED, payload, langOf(teacher)) });
      }
    }
    return messageId;
  }

  /** The suggesting teacher hears the decision in their supervision conversation (safeguard 5). */
  private async answerTeacher(tx: Tx, l: Loaded, kind: string, extra: Record<string, unknown>) {
    const teacherId = l.row.suggestedByTeacher;
    if (!teacherId) return;
    const conv = await this.supervision.ensureInTx(tx, teacherId, l.row.organizationId, l.actor.actorId).catch(() => null);
    if (!conv) return;
    const learner = l.row.learnerId ? await tx.learner.findUnique({ where: { id: l.row.learnerId }, select: { name: true } }) : null;
    const teacher = await this.conversations.requireActor(teacherId);
    const payload = { certificateId: l.row.id, learnerId: l.row.learnerId, learnerName: learner?.name ?? l.row.printedName, title: l.row.title, ...extra };
    await this.cards.post(tx, conv, l.actor, { kind, payload, body: renderPd012CardBody(kind, payload, langOf(teacher)) });
  }

  private async auditAct(tx: Tx, l: Loaded, act: string, after: Record<string, unknown>, reason?: string) {
    await this.audit.audit(tx, {
      actorId: l.actor.actorId,
      action: `appreciation_certificate.${act}`,
      entity: 'appreciation_certificate',
      entityId: l.row.id,
      after: { category: l.row.category, from: l.row.state, ...after },
      reason: reason ?? `certificate ${act.replace(/_/g, ' ')}`,
    });
  }

  // ------------------------------------------------------------------
  // Notifications (PD-34): after commit, deduplicated, never undoing the act
  // ------------------------------------------------------------------

  private async variables(row: AppreciationCertificate) {
    const type = row.typeId ? await this.prisma.certificateType.findUnique({ where: { id: row.typeId }, select: { labelAr: true } }) : null;
    return { type: type?.labelAr ?? row.title, printed_name: row.printedName };
  }

  private async notifyDesigners(row: AppreciationCertificate) {
    try {
      const designers = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT s.id::text AS id FROM chat.staff s
         WHERE s.organization_id = ${row.organizationId}::uuid AND s.is_active AND s.left_at IS NULL
           AND chat.staff_has_permission(s.id, 'certificates.design')`;
      const variables = await this.variables(row);
      for (const d of designers) {
        if (d.id === row.requestedByStaff) continue;
        await this.notifications.schedule({
          dedupeKey: `certificate_requested:${row.id}:${row.actionSeq}:${d.id}`,
          templateKey: 'certificate_requested',
          eventType: 'certificate_requested',
          recipientId: d.id,
          locale: 'ar',
          variables,
          scheduledAt: new Date(),
          respectQuietHours: false,
        });
      }
    } catch (e) {
      this.log.warn(`certificate ${row.id}: designer notifications failed: ${(e as Error).message}`);
    }
  }

  private async notifyRequester(row: AppreciationCertificate, template: 'certificate_returned' | 'certificate_uploaded') {
    if (!row.requestedByStaff) return;
    try {
      await this.notifications.schedule({
        dedupeKey: `${template}:${row.id}:${row.actionSeq}:${row.requestedByStaff}`,
        templateKey: template,
        eventType: template,
        recipientId: row.requestedByStaff,
        locale: 'ar',
        variables: await this.variables(row),
        scheduledAt: new Date(),
        respectQuietHours: false,
      });
    } catch (e) {
      this.log.warn(`certificate ${row.id}: requester notification failed: ${(e as Error).message}`);
    }
  }

  private async notifySuggestionDecided(row: AppreciationCertificate, teacherId: string | null) {
    if (!teacherId) return;
    try {
      const teacher = await this.conversations.requireActor(teacherId);
      await this.notifications.schedule({
        dedupeKey: `certificate_suggestion_decided:${row.id}:${teacherId}`,
        templateKey: 'certificate_suggestion_decided',
        eventType: 'certificate_suggestion_decided',
        recipientId: teacherId,
        locale: teacher.locale === 'en' ? 'en' : 'ar',
        variables: { printed_name: row.printedName, state: row.state },
        scheduledAt: new Date(),
      });
    } catch (e) {
      this.log.warn(`certificate ${row.id}: teacher notification failed: ${(e as Error).message}`);
    }
  }

  private teacherDto(r: AppreciationCertificate) {
    return {
      id: r.id,
      state: r.state,
      learnerId: r.learnerId,
      title: r.title,
      achievement: r.achievement,
      achievedOn: r.achievedOn ? isoDate(r.achievedOn) : null,
      grade: r.grade,
      printedName: r.printedName,
      note: r.internalNote,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      declineReason: r.declineReason,
      sentAt: r.sentAt?.toISOString() ?? null,
      deliveredTo: r.conversationId,
    };
  }

  /** Map the database's refusal to a stable code: the triggers have the last word. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new CommError(CommErrorCode.CERTIFICATE_DUPLICATE, 'this certificate is already requested', 409);
      }
      const message = e instanceof Error ? e.message : String(e);
      const reason = /message: "([^"]+)"/.exec(message)?.[1] ?? /ERROR: ([^\n]+)/.exec(message)?.[1] ?? 'the certificate does not allow this';
      if (/42501|insufficient_privilege/.test(message)) throw new CommError(CommErrorCode.CERTIFICATE_DENIED, reason, 403);
      if (/23514|check_violation/.test(message)) throw new CommError(CommErrorCode.CERTIFICATE_STATE, reason, 409);
      if (/appreciation_certificate_no_duplicate|23505/.test(message)) throw new CommError(CommErrorCode.CERTIFICATE_DUPLICATE, 'this certificate is already requested', 409);
      throw e;
    }
  }
}

// ----------------------------------------------------------------------
// Refusals and input
// ----------------------------------------------------------------------

function stamp(l: Loaded, action: string, note: string | null) {
  return { actionSeq: l.row.actionSeq + 1, lastAction: action, lastNote: note, lastActorStaff: l.actor.actorId, lastActorTeacher: null };
}

function refusal(act: CertificateAct, l: Loaded): CommError {
  if (!ACT_STATES[act].includes(l.row.state)) {
    if ((act === CertificateAct.SEND || act === CertificateAct.STORY) && l.row.state === CertificateState.UPLOADED) return notApproved();
    return new CommError(CommErrorCode.CERTIFICATE_STATE, `a ${l.row.state} certificate cannot be ${act.replace(/_/g, ' ')}`, 409);
  }
  if (act === CertificateAct.APPROVE && l.relation.actsAsRequester && l.relation.uploadedCurrent) {
    return new CommError(CommErrorCode.CERTIFICATE_SELF_APPROVAL, 'the person who uploaded a design does not approve it');
  }
  return denied();
}

function denied() {
  return new CommError(CommErrorCode.CERTIFICATE_DENIED, 'you may not do this to this certificate');
}

function notFound() {
  return new CommError(CommErrorCode.CERTIFICATE_NOT_FOUND, 'certificate not found');
}

function consentMissing() {
  return new CommError(CommErrorCode.CERTIFICATE_STORY_CONSENT_MISSING, "record the family's consent before publishing this Story", 409);
}

function notApproved() {
  return new CommError(CommErrorCode.CERTIFICATE_NOT_APPROVED, 'the requester approves the design before it is sent or published', 409);
}

function noGroup(category: string) {
  return new CommError(
    CommErrorCode.CERTIFICATE_STATE,
    category === CertificateCategory.TEACHER
      ? 'the teacher has no supervision conversation to deliver into'
      : "the learner has no live group to deliver the certificate into; open their Student Group first",
    409,
  );
}

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function reasonOf(body: Record<string, unknown>, field: string): string {
  const v = text(body, field, MAX_TEXT, true) as string;
  if (v.length < MIN_REASON) throw invalid(`${field}: say clearly what and why (at least ${MIN_REASON} characters)`);
  return v;
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

function calendarDate(body: Record<string, unknown>, field: string, required: boolean): Date | null {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw invalid(`${field}: a date, YYYY-MM-DD`);
    return null;
  }
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
