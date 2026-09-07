import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type AttentionFlag } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AppConfigService } from '../../platform/app-config.service';
import { Permission } from '../../platform/rbac/permissions';
import { CommError, CommErrorCode } from '../../platform/errors';
import { IDENTITY_SERVICE, AUDIT_SERVICE } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import { ALL_FAMILIES, ScopeService } from '../../platform/scope.service';
import { IdentityAwareService } from '../identity-aware.service';
import { RiskDetectionService, type DetectedRisk } from './risk-detection.service';

/**
 * Attention flags: raising them, and letting a human resolve them.
 *
 * ## What this class cannot do
 *
 * It writes to chat.attention_flag and to the audit log. It does not cancel a
 * subscription, suspend a learner, reassign a supervisor, alter billing, send a
 * message or change any account state -- and it holds no dependency that could
 * (Phase 7 §18). Detecting cancellation intent puts a card in a manager's
 * queue. What happens next is theirs.
 */
@Injectable()
export class AttentionService extends IdentityAwareService {
  private readonly log = new Logger(AttentionService.name);

  constructor(
    prisma: PrismaService,
    @Inject(IDENTITY_SERVICE) identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly detection: RiskDetectionService,
    private readonly config: AppConfigService,
  ) {
    super(prisma, identity);
  }

  /**
   * Examine one conversation and raise whatever it warrants.
   *
   * Deterministic first and unconditionally, so the unanswered-messages flag
   * appears whether or not the assistant is configured. The classifier is
   * additive.
   */
  async assess(conversationId: string, now = new Date()): Promise<AttentionFlag[]> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, familyId: true, lastSeq: true },
    });
    if (!conv) return [];

    const risks: DetectedRisk[] = [];

    const unanswered = await this.detection.detectUnanswered(conversationId, now);
    if (unanswered) risks.push(unanswered);

    try {
      risks.push(...(await this.detection.classify(conversationId)));
    } catch (error) {
      // A classifier failure must not lose the deterministic finding that was
      // already computed. The whole point of doing arithmetic in SQL is that it
      // survives the model being unavailable.
      this.log.warn(
        `classification failed for ${conversationId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    const raised: AttentionFlag[] = [];
    for (const risk of risks) {
      const flag = await this.raise(conv.id, conv.familyId, conv.lastSeq ?? BigInt(0), risk);
      if (flag) raised.push(flag);
    }
    return raised;
  }

  /**
   * Raise one flag, at most once.
   *
   * Idempotency is the partial unique index on (conversation_id, risk_type)
   * WHERE status in (open, acknowledged), and this method's job is to expect
   * the conflict rather than to avoid it. A pre-flight `findFirst` would be a
   * check-then-act race, and the sweep runs on several replicas at once, so
   * losing that race is the normal case. The database decides; a P2002 means
   * somebody else already raised it, which is a success.
   */
  private async raise(
    conversationId: string,
    familyId: string | null,
    upToSeq: bigint,
    risk: DetectedRisk,
  ): Promise<AttentionFlag | null> {
    try {
      return await this.prisma.attentionFlag.create({
        data: {
          conversationId,
          familyId,
          riskType: risk.type,
          severity: risk.severity,
          confidence: risk.confidence,
          reason: risk.reason,
          detectedBy: risk.detectedBy,
          detectedUpToSeq: upToSeq,
          status: 'open',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /** The Manager Command Center queue, narrowed to what this actor may see. */
  async queue(
    actorId: string,
    filter: { riskType?: string; severity?: string } = {},
  ): Promise<AttentionFlag[]> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.ATTENTION_READ);

    // Scope, server-side. A supervisor sees flags on their families; an
    // organization-wide role sees the organization's. The same ScopeService
    // every other surface uses, so a reassignment takes effect here on the next
    // request with nothing to invalidate.
    //
    // ALL_FAMILIES is a PREDICATE, not a list: materialising it would be wrong
    // the moment a family is created mid-request, so it becomes no clause at
    // all and the organization isolation policy does the narrowing.
    const scope = await this.scope.visibleFamilies(actor);

    return this.prisma.attentionFlag.findMany({
      where: {
        status: { in: ['open', 'acknowledged'] },
        riskType: filter.riskType,
        severity: filter.severity,
        ...(scope === ALL_FAMILIES ? {} : { familyId: { in: [...scope] } }),
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async acknowledge(actorId: string, flagId: string): Promise<AttentionFlag> {
    return this.transition(actorId, flagId, 'acknowledged', null);
  }

  /** Handled. */
  async resolve(actorId: string, flagId: string, note: string): Promise<AttentionFlag> {
    return this.transition(actorId, flagId, 'resolved', note);
  }

  /**
   * Not a real risk.
   *
   * Distinct from `resolve` on purpose: the dismissal rate per risk_type is the
   * measurement that says whether the classifier is worth running (§44). Losing
   * that distinction would leave "the model is wrong a third of the time"
   * invisible.
   */
  async dismiss(actorId: string, flagId: string, note: string): Promise<AttentionFlag> {
    return this.transition(actorId, flagId, 'dismissed', note);
  }

  private async transition(
    actorId: string,
    flagId: string,
    status: string,
    note: string | null,
  ): Promise<AttentionFlag> {
    const actor = await this.requireStaff(actorId);
    this.require(actor, Permission.ATTENTION_RESOLVE);

    const flag = await this.prisma.attentionFlag.findUnique({ where: { id: flagId } });
    if (!flag) {
      throw new CommError(CommErrorCode.ATTENTION_FLAG_NOT_FOUND, 'no such flag', 404);
    }

    // Scope again, on the write path. A flag id is a uuid somebody could have
    // seen elsewhere, and reading the queue is not the only way to reach here.
    if (!(await this.scope.canAccessFamily(actor, flag.familyId))) {
      // Same code as "does not exist", so a flag id cannot be used to probe
      // which other supervisors' families are at risk.
      throw new CommError(CommErrorCode.ATTENTION_FLAG_NOT_FOUND, 'no such flag', 404);
    }

    const terminal = status !== 'acknowledged';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.attentionFlag.update({
        where: { id: flagId },
        data: {
          status,
          resolutionNote: note,
          ...(terminal ? { resolvedBy: actor.actorId, resolvedAt: new Date() } : {}),
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: `attention_flag.${status}`,
        entity: 'attention_flag',
        entityId: flagId,
        before: { status: flag.status },
        after: { status, riskType: flag.riskType },
        reason: note ?? `flag ${status}`,
      });
      return updated;
    });
  }
}
