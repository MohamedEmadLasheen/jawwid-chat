import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, SUBSCRIPTION_LOCK } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { BillingAccess, OperationsDepartmentRole, SalesDepartmentRole } from '../platform/pd012-policy';
import { canGrantSubscriptionException } from '../platform/subscription-policy';
import type { SubscriptionLockReader } from '../platform/subscription-lock';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { SUBSCRIPTION_PLAN_MONTHS } from '../communication/contracts/vocab';
import { BillingService } from './billing.service';
import { academyToday, childSubscriptions } from './subscription-reads';
import { dateOnly, day, invalid, optionalDate, optionalText, requireDate, requireText } from './validate';

const EXCEPTION_KINDS = ['balance', 'overdue', 'both'] as const;
const MAX_EXCEPTION_DAYS = 90;

/**
 * PD-30: a child's lesson ledger and its exceptions, for staff.
 *
 *   read     billingAccessOf's readers, in scope (PD-17): the ledger, the
 *            balance, the state, every exception and renewal request
 *   ledger   the payment recorders (canRecord): add a subscription, void one
 *   except   the super admin, the Operations Manager and the Sales Manager
 *            only (canGrantSubscriptionException): grant, revoke
 *
 * Every write is audited. The state follows by itself: the database
 * recomputes it in the same transaction (chat.refresh_learner_access).
 */
@Injectable()
export class SubscriptionLedger {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly billing: BillingService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(SUBSCRIPTION_LOCK) private readonly locks: SubscriptionLockReader,
  ) {}

  /** The child's ledger, state, exceptions and renewal requests. */
  async view(actorId: string, learnerId: string) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const learner = await this.requireLearner(actor, access, learnerId);
    return this.present(actor, learner);
  }

  /** { lessonsIncluded, planMonths?, startsOn?, note? } -- the payment recorders. */
  async add(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    const learner = await this.requireLearner(actor, access, learnerId);
    const lessonsIncluded = lessonsField(body.lessonsIncluded);
    const planMonths = planMonthsField(body.planMonths);
    const startsOn = optionalDate('startsOn', body.startsOn) ?? (await academyToday(this.prisma));
    const note = optionalText('note', body.note, 500);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const row = await tx.learnerSubscription.create({
        data: {
          organizationId: learner.organizationId,
          learnerId: learner.id,
          familyId: learner.familyId,
          planMonths,
          lessonsIncluded,
          startsOn: dateOnly(startsOn),
          source: 'staff',
          note,
          createdBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'subscription.added',
        entity: 'learner',
        entityId: learner.id,
        after: { subscriptionId: row.id, planMonths, lessonsIncluded, startsOn },
        reason: note ?? 'subscription added',
      });
    });
    return this.present(actor, learner);
  }

  /** { reason } -- final. */
  async void(actorId: string, subscriptionId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.billing.requireRecorder(actorId);
    if (!isUuid(subscriptionId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'subscription not found');
    const row = await this.prisma.learnerSubscription.findUnique({ where: { id: subscriptionId.toLowerCase() } });
    if (!row || row.organizationId !== actor.organizationId) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'subscription not found');
    const learner = await this.requireLearner(actor, access, row.learnerId);
    if (row.voidedAt) throw new CommError(CommErrorCode.SUBSCRIPTION_STATE, 'this subscription is already voided', 409);
    const reason = requireText('reason', body.reason, 500);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await tx.learnerSubscription.update({
        where: { id: row.id },
        data: { voidedAt: new Date(), voidedBy: actor.actorId, voidReason: reason },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'subscription.voided',
        entity: 'learner',
        entityId: row.learnerId,
        before: { subscriptionId: row.id, lessonsIncluded: row.lessonsIncluded, startsOn: day(row.startsOn), source: row.source },
        reason,
      });
    });
    return this.present(actor, learner);
  }

  /** { kind: balance | overdue | both, reason, validUntil } -- the three roles only. */
  async grantException(actorId: string, learnerId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireGrantor(actorId);
    const learner = await this.requireLearner(actor, access, learnerId);
    const kind = body.kind;
    if (typeof kind !== 'string' || !(EXCEPTION_KINDS as readonly string[]).includes(kind)) {
      throw invalid(`kind: ${EXCEPTION_KINDS.join(' | ')}`);
    }
    const reason = requireText('reason', body.reason, 500);
    const validUntil = requireDate('validUntil', body.validUntil);
    const today = await academyToday(this.prisma);
    const latest = day(new Date(dateOnly(today).getTime() + MAX_EXCEPTION_DAYS * 86_400_000));
    if (validUntil < today || validUntil > latest) {
      throw invalid(`validUntil: from today to ${MAX_EXCEPTION_DAYS} days ahead (${latest})`);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      const row = await tx.subscriptionException.create({
        data: {
          organizationId: learner.organizationId,
          learnerId: learner.id,
          familyId: learner.familyId,
          kind,
          reason,
          validUntil: dateOnly(validUntil),
          grantedBy: actor.actorId,
        },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'subscription_exception.granted',
        entity: 'learner',
        entityId: learner.id,
        after: { exceptionId: row.id, kind, validUntil },
        reason,
      });
    });
    return this.present(actor, learner);
  }

  /** { reason } -- the three roles only; final. */
  async revokeException(actorId: string, exceptionId: string, body: Record<string, unknown>) {
    const { actor, access } = await this.requireGrantor(actorId);
    if (!isUuid(exceptionId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'exception not found');
    const row = await this.prisma.subscriptionException.findUnique({ where: { id: exceptionId.toLowerCase() } });
    if (!row || row.organizationId !== actor.organizationId) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'exception not found');
    const learner = await this.requireLearner(actor, access, row.learnerId);
    if (row.revokedAt) throw new CommError(CommErrorCode.SUBSCRIPTION_STATE, 'this exception is already revoked', 409);
    const reason = requireText('reason', body.reason, 500);
    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      await tx.subscriptionException.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), revokedBy: actor.actorId, revokeReason: reason },
      });
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'subscription_exception.revoked',
        entity: 'learner',
        entityId: row.learnerId,
        before: { exceptionId: row.id, kind: row.kind, validUntil: day(row.validUntil) },
        reason,
      });
    });
    return this.present(actor, learner);
  }

  /** Parents' "please renew" requests in the viewer's scope, newest first (30 days). */
  async renewalRequests(actorId: string) {
    const { actor, access } = await this.billing.requireReader(actorId);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; learner_id: string; learner_name: string; family_id: string; parent_name: string; requested_at: Date; renewed: boolean }>
    >`
      SELECT r.id::text, r.learner_id::text, l.name AS learner_name, r.family_id::text, c.name AS parent_name, r.requested_at,
             EXISTS (SELECT 1 FROM chat.learner_subscription s
                      WHERE s.learner_id = r.learner_id AND s.voided_at IS NULL AND s.created_at > r.requested_at) AS renewed
        FROM chat.renewal_request r
        JOIN chat.learner l ON l.id = r.learner_id
        JOIN chat.contact c ON c.id = r.requested_by
       WHERE r.organization_id = ${actor.organizationId as string}::uuid
         AND r.requested_at > now() - interval '30 days'
         AND (${access.scope !== 'reach'} OR chat.staff_reaches_family(${actor.actorId}::uuid, r.family_id) IS NOT NULL)
       ORDER BY r.requested_at DESC
       LIMIT 200`;
    return {
      requests: rows.map((r) => ({
        id: r.id,
        child: { id: r.learner_id, name: r.learner_name },
        familyId: r.family_id,
        parentName: r.parent_name,
        requestedAt: r.requested_at.toISOString(),
        renewed: r.renewed,
      })),
    };
  }

  // ------------------------------------------------------------------

  private async present(actor: Actor, learner: { id: string; familyId: string }) {
    const [standing] = await childSubscriptions(this.prisma, learner.familyId, [learner.id]);
    const [ledger, exceptions, renewals, grant] = await Promise.all([
      this.prisma.learnerSubscription.findMany({ where: { learnerId: learner.id }, orderBy: [{ startsOn: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.subscriptionException.findMany({ where: { learnerId: learner.id }, orderBy: { grantedAt: 'desc' } }),
      this.prisma.renewalRequest.findMany({ where: { learnerId: learner.id }, orderBy: { requestedAt: 'desc' }, take: 10 }),
      this.canGrant(actor),
    ]);
    const today = await academyToday(this.prisma);
    const names = await this.staffNames(actor.organizationId as string, [
      ...ledger.flatMap((r) => [r.createdBy, r.voidedBy]),
      ...exceptions.flatMap((e) => [e.grantedBy, e.revokedBy]),
    ]);
    const person = (id: string | null) => (id ? { id, name: names.get(id) ?? '' } : null);
    return {
      enforced: this.locks.enforced,
      canRecord: (await this.billing.accessOf(actor)).canRecord,
      canGrantException: grant,
      standing,
      subscriptions: ledger.map((r) => ({
        id: r.id,
        planMonths: r.planMonths,
        lessonsIncluded: r.lessonsIncluded,
        startsOn: day(r.startsOn),
        source: r.source,
        requestId: r.requestId,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        createdBy: person(r.createdBy),
        voided: r.voidedAt ? { at: r.voidedAt.toISOString(), by: person(r.voidedBy), reason: r.voidReason } : null,
      })),
      exceptions: exceptions.map((e) => ({
        id: e.id,
        kind: e.kind,
        reason: e.reason,
        validUntil: day(e.validUntil),
        active: e.revokedAt === null && day(e.validUntil) >= today,
        grantedAt: e.grantedAt.toISOString(),
        grantedBy: person(e.grantedBy),
        revoked: e.revokedAt ? { at: e.revokedAt.toISOString(), by: person(e.revokedBy), reason: e.revokeReason } : null,
      })),
      renewalRequests: renewals.map((r) => ({ id: r.id, requestedAt: r.requestedAt.toISOString() })),
    };
  }

  private async requireLearner(actor: Actor, access: BillingAccess, learnerId: string) {
    if (!isUuid(learnerId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'child not found');
    const learner = await this.prisma.learner.findFirst({
      where: { id: learnerId.toLowerCase(), organizationId: actor.organizationId as string },
      select: { id: true, familyId: true, organizationId: true, name: true },
    });
    if (!learner) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'child not found');
    await this.billing.requireFamily(actor, access, learner.familyId);
    return learner;
  }

  private async requireGrantor(actorId: string) {
    const { actor, access } = await this.billing.requireReader(actorId);
    if (!(await this.canGrant(actor))) {
      throw new CommError(
        CommErrorCode.SUBSCRIPTION_DENIED,
        'exceptions are granted by the super admin, the Operations Manager or the Sales Manager',
      );
    }
    return { actor, access };
  }

  private async canGrant(actor: Actor): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ops: OperationsDepartmentRole; sales: SalesDepartmentRole }[]>`
      SELECT chat.operations_department_role(${actor.actorId}::uuid) AS ops,
             chat.sales_department_role(${actor.actorId}::uuid) AS sales`;
    return canGrantSubscriptionException(actor, rows[0]?.ops ?? null, rows[0]?.sales ?? null);
  }

  private async staffNames(org: string, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => x !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.staff.findMany({ where: { id: { in: unique }, organizationId: org }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function lessonsField(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 500) throw invalid('lessonsIncluded: an integer from 1 to 500');
  return v;
}

function planMonthsField(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (!(SUBSCRIPTION_PLAN_MONTHS as readonly unknown[]).includes(v)) throw invalid('planMonths: 1, 3, 6 or 12');
  return v as number;
}
