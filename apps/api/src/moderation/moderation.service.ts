import { randomUUID } from 'node:crypto';
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
import { MediaUrlSigner } from '../platform/media-url';
import { ActorKind } from '../communication/contracts/vocab';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { MessageService } from '../communication/messages/message.service';
import { OutboxService } from '../communication/outbox/outbox.service';
import { CommEvent } from '../communication/contracts/events';
import { objectKeyBelongsToConversation } from '../communication/attachments/object-key';
import { AccountAdminService } from '../account-admin/account-admin.service';
import {
  UNRESOLVED,
  decisionRow,
  detail,
  evidenceAttachments,
  parseQueueFilter,
  parseResolveInput,
  queueRow,
  staffIdsOf,
  type EvidenceSnapshot,
  type SubjectKind,
} from './dto';
import { personOf, staffNames, subjectNames } from './people';
import { moderationScope, scopeWhere, type ModerationScope } from './moderation-scope';

const QUEUE_LIMIT = 500;
/** Closure plan §4: an evidence attachment's link lives 5 minutes. */
export const ATTACHMENT_URL_TTL_SECONDS = 300;

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4, §5.5): the staff moderation queue.
 *
 *   moderation.view   the queue and one report with its evidence; every read
 *                     of the evidence writes an audit row `report.viewed`, and
 *                     every attachment link `report.attachment_viewed`
 *   moderation.act    take ("I'm on it": open -> in review) and resolve (with
 *                     the answer to the reporter, which closes it)
 *
 * Both keys are checked HERE as well as by PermissionGuard: the guard only
 * logs a legacy account's refusal while PD-40 is in shadow mode, and the
 * evidence is a child-safety record. Never another organization's report (it
 * reads as unknown), never the reporter's identity in any response, never in a
 * support session.
 *
 * WHICH reports: moderation-scope.ts (closure plan 2026-11-06 §3, owner
 * D-2..D-4) -- the Super Admin all; child_safety only the Super Admin and
 * holders of moderation.child_safety; anyone else the reports of their own
 * departments; never a report about oneself. The same rule for the queue (in
 * its `where`, so the limit applies to what the reviewer may see), the detail,
 * take, resolve and the evidence attachments. Out of scope reads as not found.
 *
 * Resolutions (closure plan §4), each in the transaction that closes the
 * report where it can be, audited, and followed by report.answered:
 *   no_action          dismissed, nothing else
 *   message_removed    the message deleted for everyone (MessageService's
 *                      moderation path)
 *   warned             the reported person gets the fixed Code of Conduct
 *                      reminder (`conduct_warning`, sent by the outbox worker
 *                      from an event written here); audit report.subject_warned
 *   account_suspended  the PD-21 suspension (its own rules and transaction,
 *                      before the close; the caller must also hold
 *                      accounts.administer); a note is required
 *   reassigned         a PD-47 task `report_reassignment` for each manager of
 *                      the report's departments (the Super Admin if none, and
 *                      for child_safety); a note is required
 *
 * ENG-04 (report-escalation.service.ts): the 18 h / 24 h sweep (overdue_at,
 * the manager and Super Admin alerts), the PD-47 task and report_answered read
 * what this writes: due_at, status, reason, and the report.answered event.
 */
@Injectable()
export class ModerationService {
  private readonly signer = new MediaUrlSigner();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly permissions: PermissionService,
    private readonly messages: MessageService,
    private readonly accounts: AccountAdminService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** The queue: unresolved first, urgent first, then by dueAt (the time left). Only the caller's scope. */
  async list(actorId: string, query: { status?: string; priority?: string; overdue?: string }) {
    const actor = await this.requireStaff(actorId, 'moderation.view');
    const filter = parseQueueFilter(query);
    const scope = await this.scopeOf(actor);
    const now = new Date();
    const overdue: Prisma.ContentReportWhereInput = {
      status: { in: [...UNRESOLVED] },
      OR: [{ overdueAt: { not: null } }, { dueAt: { lte: now } }],
    };
    const base: Prisma.ContentReportWhereInput = {
      AND: [
        scopeWhere(scope),
        {
          ...(filter.priority ? { priority: filter.priority } : {}),
          ...(filter.overdue === true ? overdue : {}),
          ...(filter.overdue === false ? { NOT: overdue } : {}),
        },
      ],
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
    const [names, subjects] = await Promise.all([staffNames(this.prisma, staffIdsOf(rows)), subjectNames(this.prisma, rows)]);
    return rows.map((r) => queueRow(r, names, subjects));
  }

  /** One report with its evidence. Audited as `report.viewed`, with no content. */
  async detail(actorId: string, id: string) {
    const actor = await this.requireStaff(actorId, 'moderation.view');
    const report = await this.requireReport(this.prisma, await this.scopeOf(actor), id);
    const [names, message, subjects, canAct] = await Promise.all([
      staffNames(this.prisma, staffIdsOf([report])),
      report.messageId ? this.prisma.message.findUnique({ where: { id: report.messageId }, select: { deletedAt: true, deletedForAll: true } }) : null,
      subjectNames(this.prisma, [report]),
      this.permissions.has(actor, 'moderation.act'),
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
    return detail(report, names, subjects, {
      deletedAt: message?.deletedForAll ? (message.deletedAt ?? new Date(0)) : null,
      canAct,
    });
  }

  /**
   * Closure plan §4: a signed link to one evidence attachment, minted for this
   * staff member, valid 5 minutes. Audited `report.attachment_viewed` (the
   * index; never the content or the object key). The bytes are served by
   * GET /media/report-evidence/:id, which re-checks THIS scope on every request
   * (authorizeEvidenceRead) -- not the message's read rules, which stay as
   * they are: the evidence outlives the message's deletion.
   */
  async attachmentUrl(actorId: string, id: string, index: string) {
    const actor = await this.requireStaff(actorId, 'moderation.view');
    const report = await this.requireReport(this.prisma, await this.scopeOf(actor), id);
    const at = evidenceIndex(report, index);
    if (!evidenceKey(report, at)) throw attachmentNotFound();
    const now = Date.now();
    const url = this.signer.url('report-evidence', `${report.id}.${at}`, 'o', actor.actorId, ATTACHMENT_URL_TTL_SECONDS, now);
    await this.prisma.$transaction((tx) =>
      this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'report.attachment_viewed',
        entity: 'content_report',
        entityId: report.id,
        after: { index: at },
        reason: 'moderation: evidence attachment link issued',
      }),
    );
    const expiresAt = new Date((Math.floor(now / 1000) + ATTACHMENT_URL_TTL_SECONDS) * 1000);
    return { url, expiresAt: expiresAt.toISOString() };
  }

  /**
   * RT-037's access-time decision for a `report-evidence` link (the media
   * route checks the signature and the reader's liveness first). The reader
   * must still be active staff holding moderation.view with the report in
   * their scope NOW. Every refusal reads as absent.
   */
  async authorizeEvidenceRead(evidenceId: string, actorId: string): Promise<{ objectKey: string }> {
    const dot = evidenceId.lastIndexOf('.');
    if (dot < 0) throw attachmentNotFound();
    const id = evidenceId.slice(0, dot);
    const index = evidenceId.slice(dot + 1);
    const actor = await this.conversations.requireActor(actorId).catch(() => null);
    if (!actor || actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId || !(await this.permissions.has(actor, 'moderation.view'))) {
      throw attachmentNotFound();
    }
    const report = await this.requireReport(this.prisma, await this.scopeOf(actor), id).catch(() => null);
    if (!report) throw attachmentNotFound();
    const key = evidenceKey(report, evidenceIndex(report, index));
    if (!key) throw attachmentNotFound();
    return { objectKey: key };
  }

  /** open -> in review, taken by the caller. Again by the taker: 200. By someone else: 409. Closed: 409. */
  async take(actorId: string, id: string, idempotencyKey: string | null) {
    const actor = await this.requireStaff(actorId, 'moderation.act');
    const scope = await this.scopeOf(actor);
    const row = await this.prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, scope, id);
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
    return this.decision(row);
  }

  /**
   * `{resolution, note?, answer}`: closes the report with the answer to the
   * reporter. A closed report is 409, unless this is the same caller's
   * request replayed under the same Idempotency-Key (200, the same answer).
   */
  async resolve(actorId: string, accountId: string | undefined, id: string, body: Record<string, unknown>, idempotencyKey: string | null) {
    const actor = await this.requireStaff(actorId, 'moderation.act');
    const input = parseResolveInput(body);
    const scope = await this.scopeOf(actor);
    const current = await this.requireReport(this.prisma, scope, id);
    if (!UNRESOLVED.includes(current.status as (typeof UNRESOLVED)[number])) {
      return this.replayOrClosed(actor, current, idempotencyKey);
    }
    if (input.resolution === 'message_removed' && (current.targetKind !== 'message' || !current.messageId)) {
      throw new CommError(CommErrorCode.VALIDATION, 'resolution: message_removed is for a report of a message', 400);
    }
    if (input.resolution === 'account_suspended') await this.suspendSubject(actor, accountId, current);

    const row = await this.prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, scope, id);
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
      if (input.resolution === 'warned') await this.warnSubject(tx, actor, resolved);
      if (input.resolution === 'reassigned') await this.raiseReassignment(tx, actor, resolved);
      await this.outbox.enqueue(tx, CommEvent.REPORT_ANSWERED, { organizationId: report.organizationId, reportId: report.id });
      return resolved;
    });
    return this.decision(row);
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

  /** Closure plan §3: which reports this reviewer reaches (moderation-scope.ts). */
  private scopeOf(actor: Actor): Promise<ModerationScope> {
    return moderationScope(this.prisma, this.permissions, actor);
  }

  /** The report when it is in the caller's scope; anything else reads as not found. */
  private async requireReport(db: PrismaService | Prisma.TransactionClient, scope: ModerationScope, id: string): Promise<ContentReport> {
    if (!isUuid(id)) throw notFound();
    const report = await db.contentReport.findFirst({ where: { AND: [scopeWhere(scope), { id: id.toLowerCase() }] } });
    if (!report) throw notFound();
    return report;
  }

  /** The report, locked for this transaction: two decisions on it are taken one after the other. */
  private async lockReport(tx: Prisma.TransactionClient, scope: ModerationScope, id: string): Promise<ContentReport> {
    if (!isUuid(id)) throw notFound();
    await tx.$queryRaw`SELECT id FROM chat.content_report
                        WHERE id = ${id.toLowerCase()}::uuid AND organization_id = ${scope.organizationId}::uuid FOR UPDATE`;
    return this.requireReport(tx, scope, id);
  }

  private async decision(row: ContentReport) {
    const [names, subjects] = await Promise.all([staffNames(this.prisma, staffIdsOf([row])), subjectNames(this.prisma, [row])]);
    return decisionRow(row, names, subjects);
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
      if (same) return this.decision(report);
    }
    throw closed();
  }

  /**
   * `warned` (closure plan §4): an event the outbox worker turns into the
   * reported person's `conduct_warning` notification -- a fixed Code of
   * Conduct reminder. The event names the person and a warning id of its own,
   * never the report; the audit row links the two, for staff.
   */
  private async warnSubject(tx: Prisma.TransactionClient, actor: Actor, report: ContentReport): Promise<void> {
    const warningId = randomUUID();
    await this.audit.audit(tx, {
      actorId: actor.actorId,
      action: 'report.subject_warned',
      entity: 'content_report',
      entityId: report.id,
      after: { subjectKind: report.subjectKind, subjectId: report.subjectId, warningId },
      reason: 'moderation: the reported person was sent the Code of Conduct reminder',
    });
    await this.outbox.enqueue(tx, CommEvent.CONDUCT_WARNING, {
      organizationId: report.organizationId,
      warningId,
      recipientKind: report.subjectKind as SubjectKind,
      recipientId: report.subjectId,
    });
  }

  /**
   * `reassigned` (closure plan §4): a PD-47 task `report_reassignment` for each
   * manager of the report's departments -- the Super Admin when there is none,
   * and for child_safety (D-4: no department sees it). The task reads the
   * report's id and the note (chat.work_task_raise_report_reassignment,
   * 20261106100000). The reassignment itself is done in the supervision tools.
   */
  private async raiseReassignment(tx: Prisma.TransactionClient, actor: Actor, report: ContentReport): Promise<void> {
    const [row] = await tx.$queryRaw<Array<{ raised: number }>>`
      SELECT chat.work_task_raise_report_reassignment(${report.id}::uuid) AS raised`;
    await this.audit.audit(tx, {
      actorId: actor.actorId,
      action: 'report.reassignment_raised',
      entity: 'content_report',
      entityId: report.id,
      after: { tasks: row?.raised ?? 0 },
      reason: 'moderation: follow-up tasks raised for the responsible managers',
    });
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

/** `:index` of the snapshot's attachments, or 404. */
function evidenceIndex(report: ContentReport, index: string): number {
  const at = /^(0|[1-9][0-9]{0,3})$/.test(index) ? Number(index) : -1;
  if (at < 0 || at >= evidenceAttachments(report).length) throw attachmentNotFound();
  return at;
}

/** The object key the snapshot kept, only inside its own conversation's namespace (a key is a name, not a capability). */
function evidenceKey(report: ContentReport, at: number): string | null {
  const key = ((report.evidence ?? {}) as EvidenceSnapshot).attachments?.[at]?.objectKey;
  return key && report.conversationId && objectKeyBelongsToConversation(report.conversationId, key) ? key : null;
}

function attachmentNotFound(): CommError {
  return new CommError(CommErrorCode.REPORT_ATTACHMENT_NOT_FOUND, 'this report has no attachment at that index', 404);
}

function notFound(): CommError {
  return new CommError(CommErrorCode.REPORT_NOT_FOUND, 'report not found', 404);
}

function closed(): CommError {
  return new CommError(CommErrorCode.REPORT_CLOSED, 'this report is closed', 409);
}
