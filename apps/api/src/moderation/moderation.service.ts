import { Inject, Injectable } from '@nestjs/common';
import type { ContentReport, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { currentImpersonationId } from '../platform/request-context';
import { PermissionService } from '../platform/permissions/permission.service';
import type { PermissionKey } from '../platform/permissions/catalogue';
import { ActorKind } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { MessageService } from '../communication/messages/message.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { AccountAdminService } from '../account-admin/account-admin.service';
import {
  UNRESOLVED,
  decisionRow,
  detail,
  parseQueueFilter,
  parseResolveInput,
  queueRow,
  staffIdsOf,
  type SubjectKind,
} from './dto';
import { personOf, staffNames } from './people';

const QUEUE_LIMIT = 500;

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4, §5.5): the staff moderation queue.
 *
 *   moderation.view   the queue and one report with its evidence; every read
 *                     of the evidence writes an audit row `report.viewed`
 *   moderation.act    take ("I'm on it": open -> in review) and resolve (with
 *                     the answer to the reporter, which closes it)
 *
 * Both keys are checked HERE as well as by PermissionGuard: the guard only
 * logs a legacy account's refusal while PD-40 is in shadow mode, and the
 * evidence is a child-safety record. Never another organization's report (it
 * reads as unknown), never the reporter's identity in any response, never in a
 * support session.
 *
 * Resolutions: `message_removed` deletes the message for everyone through
 * MessageService's moderation path, in the transaction that closes the
 * report; `account_suspended` suspends the reported person's account through
 * the PD-21 administration (its own rules, and the caller must also hold
 * accounts.administer); `warned` and `reassigned` are recorded, the act itself
 * done in the existing tools; `no_action` dismisses.
 *
 * TODO(ENG-04): the 36 h / 48 h sweep (overdue_at, the manager and Super Admin
 * alerts) and report_answered read what this writes: due_at, overdue_at,
 * priority, reporter_answered_at, and the report.created / report.answered events.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly permissions: PermissionService,
    private readonly messages: MessageService,
    private readonly accounts: AccountAdminService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** The queue: unresolved first, urgent first, then by dueAt (the time left). */
  async list(actorId: string, query: { status?: string; priority?: string; overdue?: string }) {
    const actor = await this.requireStaff(actorId, 'moderation.view');
    const filter = parseQueueFilter(query);
    const now = new Date();
    const overdue: Prisma.ContentReportWhereInput = {
      status: { in: [...UNRESOLVED] },
      OR: [{ overdueAt: { not: null } }, { dueAt: { lte: now } }],
    };
    const base: Prisma.ContentReportWhereInput = {
      organizationId: actor.organizationId as string,
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.overdue === true ? overdue : {}),
      ...(filter.overdue === false ? { NOT: overdue } : {}),
    };
    // 'urgent' sorts after 'normal', so descending puts it first.
    const orderBy: Prisma.ContentReportOrderByWithRelationInput[] = [{ priority: 'desc' }, { dueAt: 'asc' }, { id: 'asc' }];
    const rows: ContentReport[] = [];
    const statuses = filter.status ? [[filter.status]] : [[...UNRESOLVED], ['actioned', 'dismissed']];
    for (const status of statuses) {
      if (rows.length >= QUEUE_LIMIT) break;
      rows.push(
        ...(await this.prisma.contentReport.findMany({
          where: { AND: [base, { status: { in: status } }] },
          orderBy,
          take: QUEUE_LIMIT - rows.length,
        })),
      );
    }
    const names = await staffNames(this.prisma, staffIdsOf(rows));
    return rows.map((r) => queueRow(r, names));
  }

  /** One report with its evidence. Audited as `report.viewed`, with no content. */
  async detail(actorId: string, id: string) {
    const actor = await this.requireStaff(actorId, 'moderation.view');
    const report = await this.requireReport(this.prisma, actor, id);
    const [names, message, subject] = await Promise.all([
      staffNames(this.prisma, staffIdsOf([report])),
      report.messageId ? this.prisma.message.findUnique({ where: { id: report.messageId }, select: { deletedAt: true, deletedForAll: true } }) : null,
      personOf(this.prisma, report.subjectKind as SubjectKind, report.subjectId),
    ]);
    await this.prisma.$transaction((tx) =>
      this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'report.viewed',
        entity: 'content_report',
        entityId: report.id,
        reason: 'moderation: report evidence viewed',
      }),
    );
    return detail(report, names, {
      deletedAt: message?.deletedForAll ? (message.deletedAt ?? new Date(0)) : null,
      subjectName: subject?.name ?? null,
    });
  }

  /** open -> in review, taken by the caller. Again by the taker: 200. By someone else: 409. Closed: 409. */
  async take(actorId: string, id: string, idempotencyKey: string | null) {
    const actor = await this.requireStaff(actorId, 'moderation.act');
    const row = await this.prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, actor, id);
      if (!UNRESOLVED.includes(report.status as (typeof UNRESOLVED)[number])) throw closed();
      if (report.takenBy === actor.actorId) return report;
      if (report.takenBy) throw new CommError(CommErrorCode.REPORT_ALREADY_TAKEN, 'another staff member has already taken this report', 409);
      const taken = await tx.contentReport.update({
        where: { id: report.id },
        data: { takenBy: actor.actorId, takenAt: new Date(), status: 'in_review' },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'report.taken',
        entity: 'content_report',
        entityId: report.id,
        before: { status: report.status },
        after: { status: 'in_review', ...(idempotencyKey ? { idempotencyKey } : {}) },
        reason: 'moderation: report taken for review',
      });
      return taken;
    });
    return decisionRow(row, await staffNames(this.prisma, staffIdsOf([row])));
  }

  /**
   * `{resolution, note?, answer}`: closes the report with the answer to the
   * reporter. A closed report is 409, unless this is the same caller's
   * request replayed under the same Idempotency-Key (200, the same answer).
   */
  async resolve(actorId: string, accountId: string | undefined, id: string, body: Record<string, unknown>, idempotencyKey: string | null) {
    const actor = await this.requireStaff(actorId, 'moderation.act');
    const input = parseResolveInput(body);
    const current = await this.requireReport(this.prisma, actor, id);
    if (!UNRESOLVED.includes(current.status as (typeof UNRESOLVED)[number])) {
      return this.replayOrClosed(actor, current, idempotencyKey);
    }
    if (input.resolution === 'message_removed' && (current.targetKind !== 'message' || !current.messageId)) {
      throw new CommError(CommErrorCode.VALIDATION, 'resolution: message_removed is for a report of a message', 400);
    }
    if (input.resolution === 'account_suspended') await this.suspendSubject(actor, accountId, current);

    const row = await this.prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, actor, id);
      if (!UNRESOLVED.includes(report.status as (typeof UNRESOLVED)[number])) throw closed();
      if (input.resolution === 'message_removed') {
        await this.messages.removeForModeration(tx, {
          messageId: report.messageId as string,
          organizationId: report.organizationId,
          moderatorId: actor.actorId,
          reportId: report.id,
        });
      }
      const now = new Date();
      const status = input.resolution === 'no_action' ? 'dismissed' : 'actioned';
      const resolved = await tx.contentReport.update({
        where: { id: report.id },
        data: {
          status,
          resolution: input.resolution,
          resolutionNote: input.note,
          resolvedBy: actor.actorId,
          resolvedAt: now,
          answerText: input.answer,
          reporterAnsweredAt: now,
          // Resolved without being taken first: the resolver handled it.
          ...(report.takenBy ? {} : { takenBy: actor.actorId, takenAt: now }),
        },
      });
      // The decision, never the words: no note, no answer in the trail.
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'report.resolved',
        entity: 'content_report',
        entityId: report.id,
        before: { status: report.status },
        after: { status, resolution: input.resolution, ...(idempotencyKey ? { idempotencyKey } : {}) },
        reason: `moderation: report ${input.resolution}`,
      });
      await this.outbox.enqueue(tx, CommEvent.REPORT_ANSWERED, { organizationId: report.organizationId, reportId: report.id });
      return resolved;
    });
    return decisionRow(row, await staffNames(this.prisma, staffIdsOf([row])));
  }

  // ------------------------------------------------------------------

  /** Live staff of an organization, in their own session, holding the key. */
  private async requireStaff(actorId: string, key: PermissionKey): Promise<Actor> {
    if (currentImpersonationId()) {
      throw new CommError(CommErrorCode.SUPPORT_SESSION_FORBIDDEN, 'reports are moderated by staff in their own session');
    }
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId || !(await this.permissions.has(actor, key))) {
      throw new CommError(CommErrorCode.PERMISSION_DENIED, `this account does not hold ${key}`);
    }
    return actor;
  }

  private async requireReport(db: PrismaService | Prisma.TransactionClient, actor: Actor, id: string): Promise<ContentReport> {
    if (!isUuid(id)) throw notFound();
    const report = await db.contentReport.findFirst({ where: { id: id.toLowerCase(), organizationId: actor.organizationId as string } });
    if (!report) throw notFound();
    return report;
  }

  /** The report, locked for this transaction: two decisions on it are taken one after the other. */
  private async lockReport(tx: Prisma.TransactionClient, actor: Actor, id: string): Promise<ContentReport> {
    if (!isUuid(id)) throw notFound();
    await tx.$queryRaw`SELECT id FROM chat.content_report
                        WHERE id = ${id.toLowerCase()}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE`;
    return this.requireReport(tx, actor, id);
  }

  private async replayOrClosed(actor: Actor, report: ContentReport, idempotencyKey: string | null) {
    if (idempotencyKey !== null && report.resolvedBy === actor.actorId) {
      const same = await this.prisma.auditLog.findFirst({
        where: {
          action: 'report.resolved',
          entity: 'content_report',
          entityId: report.id,
          actorId: actor.actorId,
          after: { path: ['idempotencyKey'], equals: idempotencyKey },
        },
        select: { id: true },
      });
      if (same) return decisionRow(report, await staffNames(this.prisma, staffIdsOf([report])));
    }
    throw closed();
  }

  /**
   * `account_suspended`: the PD-21 suspension of the reported person's
   * account, decided by its own rules (who administers which accounts; never
   * the super admin's or one's own). The caller must hold accounts.administer
   * too: moderation.act never widens what an account may administer. Done
   * before the report closes; suspending is idempotent, so a retry after a
   * failed close changes nothing more.
   */
  private async suspendSubject(actor: Actor, accountId: string | undefined, report: ContentReport) {
    if (!(await this.permissions.has(actor, 'accounts.administer'))) {
      throw new CommError(CommErrorCode.PERMISSION_DENIED, 'suspending an account needs accounts.administer');
    }
    const subject = await personOf(this.prisma, report.subjectKind as SubjectKind, report.subjectId);
    if (!subject?.accountId) throw new CommError(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, 'the reported person has no account to suspend');
    const own = accountId ?? (await this.prisma.staff.findUnique({ where: { id: actor.actorId }, select: { accountId: true } }))?.accountId;
    if (!own) throw new CommError(CommErrorCode.PERMISSION_DENIED, 'this staff account cannot suspend accounts');
    await this.accounts.suspend(actor, own, subject.accountId, { reason: `suspended after report ${report.id}` });
  }
}

function notFound(): CommError {
  return new CommError(CommErrorCode.REPORT_NOT_FOUND, 'report not found', 404);
}

function closed(): CommError {
  return new CommError(CommErrorCode.REPORT_CLOSED, 'this report is closed', 409);
}
