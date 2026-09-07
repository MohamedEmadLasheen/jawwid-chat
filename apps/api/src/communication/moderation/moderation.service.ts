import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { AUDIT_SERVICE } from '../../platform/tokens';
import type { AuditService, Tx } from '../../platform/audit.service';
import type { Actor } from '../../platform/types';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import {
  ActorKind,
  ApprovalDecision,
  ORGANIZATION_WIDE_STAFF_ROLES,
  ScanStatus,
  StaffRole,
} from '../contracts/vocab';
import { ModerationRuleService } from './moderation-rule.service';
import { scan as runScan, type ModerationScan } from './content-scanner';

export interface ModerationFlagDto {
  ruleId: string | null;
  ruleName: string;
  category: string;
  severity: string;
  matchedExcerpt: string | null;
}

/**
 * The moderation pipeline: scanning on the way in, escalation on the way out.
 *
 * The DECISIONS (approve, reject, edit then send) stay in ApprovalService,
 * which already owned them and already had the authorization, the audit and
 * the realtime wiring right. This class is the two things Phase 6 added that
 * had nowhere to live: running the scanner, and noticing that nobody has
 * decided.
 */
@Injectable()
export class ModerationService {
  private readonly log = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly rules: ModerationRuleService,
    private readonly outbox: OutboxService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------

  /**
   * Scan one body against the organization's enabled rules.
   *
   * Called from inside MessageService.send, BEFORE the transaction opens: the
   * scan is pure computation over rules that were already loaded, and holding a
   * database transaction open across it would put the rule cache's refresh --
   * and any latency in it -- inside the lock that serialises the conversation's
   * sequence numbers.
   */
  async scanBody(actor: Actor, body: string | null): Promise<ModerationScan> {
    const [rules, budgetMs, maxLength] = await Promise.all([
      this.rules.enabledRules(actor.organizationId),
      this.config.get('moderation.scan_budget_ms'),
      this.config.get('communication.message_max_length'),
    ]);
    const result = runScan(body, rules, { budgetMs, maxLength });

    // A rule that could not be evaluated is an operational fault, not a
    // property of the message. The message is held (the scanner said so) AND
    // the fault is logged, because a queue slowly filling with `rule_error`
    // items is something an operator must be able to trace to a cause.
    for (const err of result.errors) {
      this.log.error(
        `moderation rule '${err.ruleName}' (${err.ruleId ?? 'engine'}) could not be applied: ${err.reason}`,
      );
    }
    return result;
  }

  /**
   * Persist why a message was held, inside the caller's transaction.
   *
   * `skipDuplicates` rather than a pre-check: the unique index on
   * (message_id, rule_id) is the real guarantee, and a retried send that
   * reaches here twice must not fail on the second attempt.
   */
  async recordFlags(
    tx: Tx,
    messageId: string,
    result: ModerationScan,
    organizationId?: string,
  ): Promise<void> {
    if (result.matches.length === 0) return;
    await tx.messageModerationFlag.createMany({
      data: result.matches.map((m) => ({
        messageId,
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        category: m.category,
        severity: m.severity,
        matchedExcerpt: m.excerpt,
        ...(organizationId ? { organizationId } : {}),
      })),
      skipDuplicates: true,
    });

    // The event log records that a message was flagged and by which
    // CATEGORIES. Deliberately not the body and not the excerpt: message
    // contents never enter the event log, which is the rule message_sent
    // already follows.
    await this.audit.event(tx, {
      actorKind: ActorKind.SYSTEM,
      actorId: null,
      type: 'message_flagged',
      payload: {
        messageId,
        categories: result.reasons,
        highestSeverity: result.highestSeverity,
        ruleCount: result.matches.length,
      },
    });
  }

  /** The flags on a set of messages, for the queue. One query, never N. */
  async flagsFor(messageIds: readonly string[]): Promise<Map<string, ModerationFlagDto[]>> {
    const byMessage = new Map<string, ModerationFlagDto[]>();
    if (messageIds.length === 0) return byMessage;

    const rows = await this.prisma.messageModerationFlag.findMany({
      where: { messageId: { in: [...messageIds] } },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) {
      const list = byMessage.get(r.messageId) ?? [];
      list.push({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        category: r.category,
        severity: r.severity,
        matchedExcerpt: r.matchedExcerpt,
      });
      byMessage.set(r.messageId, list);
    }
    return byMessage;
  }

  // -------------------------------------------------------------------
  // Escalation
  // -------------------------------------------------------------------

  /**
   * Raise every pending item older than the configured threshold to a manager.
   *
   * ## What escalation is, and what it is emphatically not
   *
   * It moves ACCOUNTABILITY and VISIBILITY. It does not send the message, it
   * does not reject it, it does not expire it and it does not change who owns
   * the family. 20260905093000 says a pending message stays pending until a
   * human decides, and that stays true: escalation changes WHICH human is
   * being waited on, and makes the wait visible on the Command Center.
   *
   * This closes finding ES-1 in docs/product-operations/escalation-model.md --
   * "escalation exists today as a label on a message and an audit row; it does
   * not notify anyone and does not appear on any surface a manager reads" --
   * for the moderation case: the row names a manager, the notification reaches
   * them, and the Command Center counts them.
   *
   * ## Idempotent and concurrency-safe, like every other sweep here
   *
   * The claim is a conditional UPDATE guarded on `escalated_at is null`, so two
   * workers, a restart, or a sweep overlapping its own previous run all
   * converge: one writer wins each row and the rest write nothing. There is no
   * lease to leak because there is nothing in flight -- the transition IS the
   * work. (CallSweeper's doc comment explains the same property at length.)
   */
  async escalateOverdue(now: Date = new Date()): Promise<number> {
    const [hours, batch] = await Promise.all([
      this.config.get('moderation.escalation_hours'),
      this.config.get('moderation.escalation_sweep_batch'),
    ]);
    const cutoff = new Date(now.getTime() - hours * 3_600_000);

    const due = await this.prisma.messageApproval.findMany({
      where: {
        decision: ApprovalDecision.PENDING,
        escalatedAt: null,
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: batch,
      include: { conversation: { select: { organizationId: true, familyId: true } } },
    });
    if (due.length === 0) return 0;

    // Managers are resolved once per organization rather than per item: a
    // sweep of 200 items in one academy must not be 200 identical queries.
    const managersByOrg = new Map<string, string | null>();
    let escalated = 0;

    for (const item of due) {
      const orgId = item.conversation.organizationId;
      if (!managersByOrg.has(orgId)) {
        managersByOrg.set(orgId, await this.findManager(orgId));
      }
      const managerId = managersByOrg.get(orgId) ?? null;

      // NO MANAGER, NO ESCALATION -- and the item stays pending and unescalated
      // so the next sweep tries again. Stamping `escalated_at` with a null
      // target is refused by the database anyway (approval_escalation_has_target),
      // and marking it escalated-to-nobody would be the dead end the approvals
      // design explicitly forbids: "a pending message with no reachable
      // approver is a dead end".
      if (!managerId) {
        this.log.warn(
          `approval ${item.id} is overdue but its organization has no active manager to escalate to`,
        );
        continue;
      }

      const claimed = await this.prisma.$transaction(async (tx) => {
        // THE CLAIM. `escalatedAt: null` in the WHERE is what makes two
        // concurrent sweeps safe: the loser updates zero rows.
        const { count } = await tx.messageApproval.updateMany({
          where: { id: item.id, decision: ApprovalDecision.PENDING, escalatedAt: null },
          data: { escalatedAt: now, escalatedTo: managerId },
        });
        if (count === 0) return false;

        await this.outbox.enqueue(tx, CommEvent.MODERATION_ESCALATED, {
          conversationId: item.conversationId,
          messageId: item.messageId,
          approvalId: item.id,
          escalatedTo: managerId,
          highestSeverity: item.highestSeverity,
          pendingSinceMs: now.getTime() - item.createdAt.getTime(),
        });

        await this.audit.audit(tx, {
          actorId: null,
          action: 'moderation.escalated',
          entity: 'message',
          entityId: item.messageId,
          after: { approvalId: item.id, escalatedTo: managerId },
          reason: `pending for more than ${hours}h with no decision`,
        });

        await this.audit.event(tx, {
          familyId: item.conversation.familyId,
          actorKind: ActorKind.SYSTEM,
          actorId: null,
          type: 'moderation_escalated',
          payload: {
            approvalId: item.id,
            messageId: item.messageId,
            escalatedTo: managerId,
            thresholdHours: hours,
          },
        });
        return true;
      });

      if (claimed) escalated++;
    }

    if (escalated > 0) {
      this.log.log(`escalated ${escalated} moderation items pending for more than ${hours}h`);
    }
    return escalated;
  }

  /**
   * Who an overdue item goes to.
   *
   * A manager, then a super_admin -- the two organization-wide roles, which are
   * the only ones guaranteed to have the family in scope whoever it belongs to.
   * Escalating to another supervisor would frequently escalate to somebody who
   * cannot open the conversation.
   */
  private async findManager(organizationId: string): Promise<string | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        organizationId,
        isActive: true,
        leftAt: null,
        department: null,
        role: { in: [...ORGANIZATION_WIDE_STAFF_ROLES] },
      },
      // Manager before super_admin: the super_admin is the organization's
      // owner and is not the person who should be reading a moderation queue
      // if there is a manager who should.
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    if (!staff) return null;
    // `role: asc` puts 'manager' before 'super_admin' alphabetically, which is
    // the order wanted -- asserted here rather than assumed, so a future role
    // name cannot silently change who gets escalations.
    return staff.role === StaffRole.MANAGER || staff.role === StaffRole.SUPER_ADMIN
      ? staff.id
      : null;
  }
}

export { ScanStatus };
