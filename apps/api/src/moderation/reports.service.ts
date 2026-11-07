import { Inject, Injectable } from '@nestjs/common';
import type { ContentReport, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { SYSTEM_ACTOR } from '../platform/types';
import { currentImpersonationId } from '../platform/request-context';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { MessageService } from '../communication/messages/message.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import {
  SUBJECT_KINDS,
  UNRESOLVED,
  bodyDigest,
  forReporter,
  parseReportInput,
  receipt,
  requestDigest,
  type EvidenceSnapshot,
  type ReportInput,
  type SubjectKind,
} from './dto';
import { isProtectedSubject, personOf, type Person } from './people';
import { reportDepartments } from './departments';

/** Compiled default for chat.config `report.limit.per_reporter_hour` (20261104100000 seeds the same). */
export const REPORT_LIMIT_DEFAULT = 10;
const LIMIT_KEY = 'report.limit.per_reporter_hour';
/** Owner D-1 (2026-11-06): 24 hours. The database sets the same clock; this only satisfies the type. */
export const DUE_MS = 24 * 3_600_000;
const MINE_LIMIT = 200;
/** How many of a person's conversations a staff reporter's read access is checked against. */
const STAFF_SHARED_CANDIDATES = 200;

export interface FiledReport {
  /** 201 for a new report (or the replay of the request that made it), 200 for the open one it folded into. */
  status: 200 | 201;
  body: ReturnType<typeof receipt>;
}

interface Target {
  targetKind: 'message' | 'person';
  messageId: string | null;
  conversationId: string;
  subject: Person;
  evidence: EvidenceSnapshot;
}

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4, §5.5): filing a report, and the
 * reporter's own list.
 *
 *   who      any signed-in parent, teacher or staff member, in their own
 *            session -- never a support session (§5.5 rule 4) -- with an account
 *   what     someone else's message they can read NOW (the read rules of
 *            MessageService.list), or a person they share a conversation with
 *            (§5.5 rule 5); never a system or card message, never the
 *            official account, a manager or the Super Admin
 *   once     one unresolved report per reporter and target: a duplicate
 *            answers the open one (200); a child_safety duplicate raises it to
 *            child_safety / urgent (the database allows that one change)
 *   limit    `report.limit.per_reporter_hour` per rolling hour, counted from
 *            chat.content_report in the database's clock (as PD-32 counts
 *            feedback); a duplicate is not counted
 *
 * The reported person is never told (§5.5 rule 1): nothing here writes to a
 * conversation, and the event carries no conversation. The reporter's words
 * and the evidence never reach the audit trail or the logs (§5.5 rule 7).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async file(actorId: string, body: Record<string, unknown>, idempotencyKey: string | null): Promise<FiledReport> {
    const { actor, accountId } = await this.requireReporter(actorId);
    const input = parseReportInput(body);
    const target = input.targetKind === 'message' ? await this.messageTarget(actor, input.messageId) : await this.personTarget(actor, input.subject);
    const organizationId = actor.organizationId as string;
    const reporterKind = actor.kind as SubjectKind;

    return this.prisma.$transaction(async (tx) => {
      // One reporter's submissions are taken one after the other, so the
      // duplicate check, the count and the key lookup each see the last insert.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`report:${reporterKind}:${actor.actorId}`}, 0))`;

      const request = idempotencyKey === null ? null : requestDigest(reporterKind, actor.actorId, idempotencyKey);
      if (request !== null) {
        const earlier = await this.replayed(tx, request, input);
        if (earlier) return { status: 201 as const, body: receipt(earlier) };
      }

      const open = await tx.contentReport.findFirst({
        where: {
          reporterKind,
          reporterId: actor.actorId,
          targetKind: target.targetKind,
          subjectKind: target.subject.kind,
          subjectId: target.subject.id,
          messageId: target.messageId,
          status: { in: [...UNRESOLVED] },
        },
      });
      if (open) return { status: 200 as const, body: receipt(await this.fold(tx, open, input)) };

      await this.withinLimit(tx, reporterKind, actor.actorId);
      // D-3: whose queue it is in, decided now and never changed (closure plan §3).
      const departmentIds = await reportDepartments(tx, { kind: target.subject.kind, id: target.subject.id });

      const created = await tx.contentReport.create({
        data: {
          organizationId,
          reporterKind,
          reporterId: actor.actorId,
          reporterAccountId: accountId,
          targetKind: target.targetKind,
          messageId: target.messageId,
          conversationId: target.conversationId,
          subjectKind: target.subject.kind,
          subjectId: target.subject.id,
          reason: input.reason,
          note: input.note,
          evidence: target.evidence as Prisma.InputJsonValue,
          departmentIds,
          // The database sets the clock and the priority (guard_content_report); these only satisfy the type.
          dueAt: new Date(Date.now() + DUE_MS),
        },
      });
      // actorId null: the trail names staff, and must never name the reporter.
      // No note, no evidence: the trail is read more widely than the reports.
      await this.audit.audit(tx, {
        actorId: null,
        action: 'report.filed',
        entity: 'content_report',
        entityId: created.id,
        after: {
          targetKind: created.targetKind,
          reason: created.reason,
          priority: created.priority,
          ...(request !== null ? { request, requestBody: bodyDigest(input) } : {}),
        },
        reason: 'report filed',
      });
      await this.outbox.enqueue(tx, CommEvent.REPORT_CREATED, {
        organizationId,
        reportId: created.id,
        priority: created.priority as 'urgent' | 'normal',
        change: 'created',
      });
      return { status: 201 as const, body: receipt(created) };
    });
  }

  /** GET /me/reports: the caller's own reports, newest first. Status and the answer only. */
  async mine(actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    if (!(SUBJECT_KINDS as readonly string[]).includes(actor.kind)) return [];
    const rows = await this.prisma.contentReport.findMany({
      where: { reporterKind: actor.kind, reporterId: actor.actorId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MINE_LIMIT,
    });
    return rows.map(forReporter);
  }

  // ------------------------------------------------------------------

  /** A live parent, teacher or staff member in their own session, with an account. */
  private async requireReporter(actorId: string): Promise<{ actor: Actor; accountId: string }> {
    // §5.5 rule 4. The interceptor refuses the route first; this holds without it.
    if (currentImpersonationId()) {
      throw new CommError(CommErrorCode.SUPPORT_SESSION_FORBIDDEN, 'a report is filed by the person themself, never in a support session');
    }
    const actor = await this.conversations.requireActor(actorId);
    if (!actor.isActive || !actor.organizationId || !(SUBJECT_KINDS as readonly string[]).includes(actor.kind)) {
      throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account cannot file a report');
    }
    const self = await personOf(this.prisma, actor.kind as SubjectKind, actor.actorId);
    if (!self?.accountId || !self.isActive) throw new CommError(CommErrorCode.ACTOR_INACTIVE, 'this account cannot file a report');
    return { actor, accountId: self.accountId };
  }

  /** §5.5 rule 5: a message the reporter can read now, by someone else, of a person. */
  private async messageTarget(actor: Actor, messageId: string): Promise<Target> {
    const readable = await this.messages.readableNow(messageId, actor.actorId);
    if (!readable || readable.message.organizationId !== actor.organizationId) throw notVisible();
    const { message } = readable;
    if (message.authorId === actor.actorId && message.authorType === actor.kind) {
      throw new CommError(CommErrorCode.REPORT_SELF, 'you cannot report your own message', 400);
    }
    if (message.type === 'system' || message.type === 'card' || !message.authorId || !(SUBJECT_KINDS as readonly string[]).includes(message.authorType)) {
      throw notReportable('this message is the academy\'s and cannot be reported');
    }
    const author = await personOf(this.prisma, message.authorType as SubjectKind, message.authorId);
    if (!author || author.organizationId !== actor.organizationId) throw notReportable('this message cannot be reported');
    if (isProtectedSubject(author)) throw notReportable('messages from the academy\'s management cannot be reported');
    return {
      targetKind: 'message',
      messageId: message.id,
      conversationId: readable.conv.id,
      subject: author,
      evidence: {
        type: message.type,
        body: message.body,
        attachments: message.attachments.map((a) => ({
          kind: a.kind,
          objectKey: a.objectKey,
          mimeType: a.mimeType,
          byteSize: a.byteSize,
          name: a.originalName,
        })),
        author: { kind: author.kind, id: author.id, name: author.name },
        sentAt: message.createdAt.toISOString(),
        editedAt: message.editedAt?.toISOString() ?? null,
        forwarded: message.forwarded,
      },
    };
  }

  /** §5.5 rule 5: a person the reporter shares a conversation with. */
  private async personTarget(actor: Actor, subject: { kind: string; id: string }): Promise<Target> {
    if (subject.kind === SYSTEM_ACTOR.kind || subject.id === SYSTEM_ACTOR.actorId) {
      throw notReportable('the academy\'s official account cannot be reported');
    }
    if (!(SUBJECT_KINDS as readonly string[]).includes(subject.kind)) {
      throw new CommError(CommErrorCode.VALIDATION, `subject.kind: must be one of ${SUBJECT_KINDS.join(', ')}`, 400);
    }
    const kind = subject.kind as SubjectKind;
    if (!isUuid(subject.id)) throw notVisible();
    const id = subject.id.toLowerCase();
    if (kind === actor.kind && id === actor.actorId) throw new CommError(CommErrorCode.REPORT_SELF, 'you cannot report yourself', 400);
    const person = await personOf(this.prisma, kind, id);
    if (!person || person.organizationId !== actor.organizationId) throw notVisible();
    const conversationId = await this.sharedConversation(actor, person);
    if (!conversationId) throw notVisible();
    if (isProtectedSubject(person)) throw notReportable('the academy\'s management cannot be reported');
    return {
      targetKind: 'person',
      messageId: null,
      conversationId,
      subject: person,
      evidence: { author: { kind: person.kind, id: person.id, name: person.name } },
    };
  }

  /**
   * A conversation of the organization where the subject is a live member and
   * the reporter may read: first one both are live members of; for staff, who
   * read by scope as well as by membership, then one of the subject's that the
   * read rules let them read.
   */
  private async sharedConversation(actor: Actor, person: Person): Promise<string | null> {
    const both = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text AS id
        FROM chat.conversation_member mine
        JOIN chat.conversation_member theirs
          ON theirs.conversation_id = mine.conversation_id AND theirs.left_at IS NULL
         AND theirs.actor_kind = ${person.kind} AND theirs.actor_id = ${person.id}::uuid
        JOIN chat.conversation c ON c.id = mine.conversation_id AND c.organization_id = ${person.organizationId}::uuid
       WHERE mine.actor_id = ${actor.actorId}::uuid AND mine.left_at IS NULL AND mine.actor_kind = ${actor.kind}
       ORDER BY c.created_at DESC
       LIMIT 1`;
    if (both[0]) return both[0].id;
    if (actor.kind !== 'staff') return null;
    const theirs = await this.prisma.conversationMember.findMany({
      where: { actorKind: person.kind, actorId: person.id, leftAt: null, conversation: { organizationId: person.organizationId } },
      select: { conversationId: true },
      orderBy: { joinedAt: 'desc' },
      take: STAFF_SHARED_CANDIDATES,
    });
    for (const { conversationId } of theirs) {
      const conv = await this.conversations.requireConversation(conversationId);
      const decision = await this.conversations.canReadResolved(actor, conv, await this.conversations.membershipOf(conv.id, actor.actorId));
      if (decision.allowed) return conv.id;
    }
    return null;
  }

  /** The report a key already made, when the key is this reporter's and the body the same. */
  private async replayed(tx: Prisma.TransactionClient, request: string, input: ReportInput): Promise<ContentReport | null> {
    const row = await tx.auditLog.findFirst({
      where: { action: 'report.filed', entity: 'content_report', after: { path: ['request'], equals: request } },
      select: { entityId: true, after: true },
    });
    if (!row) return null;
    if ((row.after as { requestBody?: string } | null)?.requestBody !== bodyDigest(input)) {
      throw new CommError(CommErrorCode.REPORT_KEY_REUSED, 'this Idempotency-Key was used for another report; use a new key', 409);
    }
    return tx.contentReport.findUnique({ where: { id: row.entityId } });
  }

  /** A duplicate: the open report, raised to child_safety when the new one is (the one change the database allows). */
  private async fold(tx: Prisma.TransactionClient, open: ContentReport, input: ReportInput): Promise<ContentReport> {
    if (input.reason !== 'child_safety' || open.reason === 'child_safety') return open;
    const raised = await tx.contentReport.update({ where: { id: open.id }, data: { reason: 'child_safety', priority: 'urgent' } });
    await this.audit.audit(tx, {
      actorId: null,
      action: 'report.raised',
      entity: 'content_report',
      entityId: open.id,
      before: { reason: open.reason, priority: open.priority },
      after: { reason: 'child_safety', priority: 'urgent' },
      reason: 'a child_safety report of the same target raised the open report',
    });
    await this.outbox.enqueue(tx, CommEvent.REPORT_CREATED, {
      organizationId: open.organizationId,
      reportId: open.id,
      priority: 'urgent',
      change: 'raised',
    });
    return raised;
  }

  /** The rolling hour, in the database's clock (created_at is the database's own). */
  private async withinLimit(tx: Prisma.TransactionClient, reporterKind: string, reporterId: string): Promise<void> {
    const limit = await this.limit(tx);
    const [row] = await tx.$queryRaw<Array<{ n: number; wait: number | null }>>`
      SELECT count(*)::int AS n,
             ceil(extract(epoch FROM (min(created_at) + interval '1 hour' - now())))::int AS wait
        FROM chat.content_report
       WHERE reporter_kind = ${reporterKind} AND reporter_id = ${reporterId}::uuid
         AND created_at > now() - interval '1 hour'`;
    if ((row?.n ?? 0) >= limit) {
      throw new AuthError(AuthErrorCode.RATE_LIMITED, Math.min(3600, Math.max(1, row?.wait ?? 3600)));
    }
  }

  private async limit(tx: Prisma.TransactionClient): Promise<number> {
    const row = await tx.config.findUnique({ where: { key: LIMIT_KEY } });
    const n = row?.value;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : REPORT_LIMIT_DEFAULT;
  }
}

function notVisible(): CommError {
  return new CommError(CommErrorCode.REPORT_TARGET_NOT_VISIBLE, 'nothing to report here', 404);
}

function notReportable(message: string): CommError {
  return new CommError(CommErrorCode.REPORT_NOT_REPORTABLE, message, 400);
}
