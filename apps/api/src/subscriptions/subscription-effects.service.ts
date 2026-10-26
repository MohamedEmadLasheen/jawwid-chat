import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Conversation, LearnerAccessEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, SUBSCRIPTION_LOCK } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { SubscriptionLockReader } from '../platform/subscription-lock';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { NotificationService } from '../communication/notifications/notification.service';
import { CardKind } from '../communication/contracts/vocab';
import { LessonService, cancelReminders } from '../lessons/lesson.service';
import { SchedulingService } from '../lessons/scheduling.service';
import { BillingService } from '../billing/billing.service';
import type { CardLanguage } from '../lessons/lesson-card';

type Tx = Prisma.TransactionClient;

/**
 * PD-30: what follows a change of a child's subscription state.
 *
 * The database records the change (chat.learner_access_event, written by
 * chat.refresh_learner_access in the writer's own transaction). This service
 * turns each event into what people see, EXACTLY ONCE: the event row is
 * claimed FOR UPDATE SKIP LOCKED, its cards are posted in the same
 * transaction, and applied_at is set there -- so two workers, or a worker and
 * the API, never announce one change twice, and a crash announces it on the
 * next pass. Events of one child are applied in order.
 *
 *   grace     the family's direct chat (parent + supervisor): "N grace lessons
 *             left"; a push to every active parent. Never the group: the
 *             teacher sees nothing financial.
 *   locked    the group: "the lessons are paused" (no reason); the direct
 *             chat: why, and where to pay; a push to the parents.
 *   unlocked  the group: "the lessons are back on"; a push to the parents.
 *
 * With SUBSCRIPTION_LOCK_ENFORCED off nothing is announced (the events are
 * marked applied): the academy checks balances before any lock bites.
 *
 * HOLDS. A locked child's regular lessons that have not started are
 * suspended by the system (outcome `suspended`, note 'subscription': counted
 * nowhere, owed to no one, no reminders) and chat.learner_access.held stops
 * the materializer. Unlocking clears held and materializes again; the
 * suspended rows do not hold their slot, so the new lessons take their place
 * and nothing is doubled. reconcileHolds() makes held follow (locked AND
 * enforced) -- after each batch of events and on every sweep, so flipping the
 * switch either way takes effect on the next pass.
 */
@Injectable()
export class SubscriptionEffects {
  private readonly log = new Logger(SubscriptionEffects.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly lessons: LessonService,
    private readonly scheduling: SchedulingService,
    private readonly notifications: NotificationService,
    private readonly billing: BillingService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(SUBSCRIPTION_LOCK) private readonly locks: SubscriptionLockReader,
  ) {}

  /** The worker's pass: recompute every child, announce what changed, make the holds follow. */
  async sweep(): Promise<{ refreshed: number; applied: number; held: number; released: number }> {
    const refreshed = await this.refreshAll();
    const applied = await this.applyEvents();
    const { held, released } = await this.reconcileHolds();
    return { refreshed, applied, held, released };
  }

  /** chat.refresh_learner_access for every child, one short transaction each. */
  async refreshAll(): Promise<number> {
    const ids = await this.prisma.learner.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    for (const { id } of ids) {
      await this.prisma.$queryRaw`SELECT chat.refresh_learner_access(${id}::uuid)`;
    }
    return ids.length;
  }

  /** Apply pending events, oldest first, each exactly once. */
  async applyEvents(max = 200): Promise<number> {
    let applied = 0;
    const pushes: Array<() => Promise<void>> = [];
    try {
      while (applied < max) {
        const result = await this.prisma.$transaction(async (tx) => {
          // The oldest pending event of a child whose earlier events are all
          // applied; one another worker holds is skipped, not waited for.
          const claimed = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT e.id::text FROM chat.learner_access_event e
             WHERE e.applied_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM chat.learner_access_event o
                                WHERE o.learner_id = e.learner_id AND o.applied_at IS NULL AND o.at < e.at)
             ORDER BY e.at
             LIMIT 1
             FOR UPDATE SKIP LOCKED`;
          if (claimed.length === 0) return null;
          const event = await tx.learnerAccessEvent.findUniqueOrThrow({ where: { id: claimed[0]!.id } });
          const after = this.locks.enforced ? await this.announce(tx, event) : [];
          await tx.learnerAccessEvent.update({ where: { id: event.id }, data: { appliedAt: new Date() } });
          return after;
        });
        if (result === null) break;
        // Only once its transaction committed: a rolled-back event is announced by the next pass.
        pushes.push(...result);
        applied += 1;
      }
    } finally {
      // A push is a courtesy; it never undoes the cards.
      for (const push of pushes) await push().catch((e) => this.log.error(`subscription push failed: ${(e as Error).name}`));
    }
    return applied;
  }

  /** held := locked AND enforced, for every child where that is not so yet. */
  async reconcileHolds(): Promise<{ held: number; released: number }> {
    // chat.learner_lesson_lock is the one answer to "is this child locked"
    // (PD-30 <-> PD-31 interface): the hold follows it, and the switch.
    const enforced = this.locks.enforced;
    const toHold = enforced
      ? await this.prisma.$queryRaw<Array<{ learnerId: string }>>`
          SELECT learner_id::text AS "learnerId" FROM chat.learner_access
           WHERE NOT held AND chat.learner_lesson_lock(learner_id) IS NOT NULL`
      : [];
    const toRelease = await this.prisma.$queryRaw<Array<{ learnerId: string }>>`
      SELECT learner_id::text AS "learnerId" FROM chat.learner_access
       WHERE held AND (${!enforced} OR chat.learner_lesson_lock(learner_id) IS NULL)`;
    let held = 0;
    for (const { learnerId } of toHold) if (await this.hold(learnerId)) held += 1;
    let released = 0;
    for (const { learnerId } of toRelease) if (await this.release(learnerId)) released += 1;
    if (released > 0) await this.scheduling.materialize();
    return { held, released };
  }

  /**
   * A parent's "please renew" from a locked banner, for a child with nothing
   * to pay yet. At most once per child per academy day (the database's
   * unique key). The supervisor reads it in the family's direct chat and on
   * Payments > Renewal requests; the Sales department gets a push.
   */
  async requestRenewal(actorId: string, learnerId: string) {
    const { contact } = await this.billing.requireParent(actorId);
    if (!isUuid(learnerId)) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'child not found');
    const learner = await this.prisma.learner.findFirst({
      where: { id: learnerId.toLowerCase(), familyId: contact.familyId },
      select: { id: true, name: true, familyId: true, organizationId: true },
    });
    if (!learner) throw new CommError(CommErrorCode.BILLING_NOT_FOUND, 'child not found');
    const created = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO chat.renewal_request (learner_id, organization_id, family_id, requested_by, requested_on)
        VALUES (${learner.id}::uuid, ${learner.organizationId}::uuid, ${learner.familyId}::uuid, ${contact.id}::uuid, chat.pd030_today())
        ON CONFLICT (learner_id, requested_on) DO NOTHING
        RETURNING id::text`;
      if (rows.length === 0) return null;
      await this.audit.audit(tx, {
        action: 'subscription.renewal_requested',
        entity: 'learner',
        entityId: learner.id,
        after: { renewalRequestId: rows[0]!.id, contactId: contact.id },
        reason: 'a parent asked to renew',
      });
      const direct = await this.familyDirect(tx, learner.familyId);
      if (direct) {
        await this.lessons.postCardInto(
          tx, direct, null, null, CardKind.RENEWAL_REQUESTED,
          { learnerId: learner.id, learnerName: learner.name }, await this.familyLanguage(learner.familyId),
        );
      }
      return rows[0]!.id;
    });
    if (!created) throw new CommError(CommErrorCode.SUBSCRIPTION_STATE, 'a renewal was already requested today', 409);
    await this.notifySales(created, learner).catch((e) => this.log.error(`renewal push failed: ${(e as Error).name}`));
    return { requested: true };
  }

  // ------------------------------------------------------------------

  /** The cards for one event, in its transaction; the pushes it returns go out after. */
  private async announce(tx: Tx, ev: LearnerAccessEvent): Promise<Array<() => Promise<void>>> {
    const learner = await tx.learner.findUnique({ where: { id: ev.learnerId }, select: { id: true, name: true, familyId: true } });
    if (!learner) return [];
    const lang = await this.familyLanguage(learner.familyId);
    const subject = { learnerId: learner.id, learnerName: learner.name };
    const wasLocked = ev.fromState === 'locked';
    const isLocked = ev.toState === 'locked';
    const direct = await this.familyDirect(tx, learner.familyId);

    if (isLocked) {
      const instalment = ev.overdueInstalmentId
        ? await tx.familyInstalment.findUnique({ where: { id: ev.overdueInstalmentId }, select: { label: true } })
        : null;
      const why = {
        ...subject,
        reasons: ev.reasons,
        ...(ev.overdueDueOn
          ? { instalmentLabel: instalment?.label ?? '', overdueSince: nextDay(ev.overdueDueOn) }
          : {}),
      };
      if (!wasLocked) {
        for (const group of await this.groupsOf(tx, learner.id)) {
          await this.lessons.postCardInto(tx, group, null, null, CardKind.LESSONS_PAUSED, subject, lang);
        }
      }
      if (direct) await this.lessons.postCardInto(tx, direct, null, null, CardKind.SUBSCRIPTION_LOCKED, why, lang);
      return [() => this.pushParents(ev, learner, 'subscription_locked', { reason: reasonText(ev.reasons, lang) })];
    }
    if (wasLocked) {
      for (const group of await this.groupsOf(tx, learner.id)) {
        await this.lessons.postCardInto(tx, group, null, null, CardKind.SUBSCRIPTION_UNLOCKED, subject, lang);
      }
      return [() => this.pushParents(ev, learner, 'subscription_unlocked', {})];
    }
    if (ev.toState === 'grace' && ev.graceLeft !== null && ev.graceLeft > 0) {
      if (direct) {
        await this.lessons.postCardInto(tx, direct, null, null, CardKind.SUBSCRIPTION_GRACE, { ...subject, graceLeft: ev.graceLeft }, lang);
      }
      return [() => this.pushParents(ev, learner, 'subscription_grace', { grace_left: String(ev.graceLeft) })];
    }
    return [];
  }

  /** Suspend the child's regular lessons that have not started; stop the materializer. */
  private async hold(learnerId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ state: string; held: boolean }>>`
        SELECT state, held FROM chat.learner_access WHERE learner_id = ${learnerId}::uuid FOR UPDATE`;
      if (!rows[0] || rows[0].held || !this.locks.enforced || (await this.locks.lockOf(learnerId)) === null) return false;
      const lessons = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE chat.lesson
           SET outcome = 'suspended', outcome_note = 'subscription', outcome_by_kind = 'system', outcome_by = NULL
         WHERE learner_id = ${learnerId}::uuid AND kind = 'regular' AND outcome IS NULL AND starts_at > now()
        RETURNING id::text`;
      for (const l of lessons) await cancelReminders(tx, l.id);
      await tx.learnerAccess.update({ where: { learnerId }, data: { held: true } });
      await this.audit.audit(tx, {
        action: 'subscription.lessons_held',
        entity: 'learner',
        entityId: learnerId,
        after: { suspended: lessons.length },
        reason: 'group locked for payment (PD-30)',
      });
      return true;
    });
  }

  private async release(learnerId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ state: string; held: boolean }>>`
        SELECT state, held FROM chat.learner_access WHERE learner_id = ${learnerId}::uuid FOR UPDATE`;
      if (!rows[0] || !rows[0].held || (this.locks.enforced && (await this.locks.lockOf(learnerId)) !== null)) return false;
      await tx.learnerAccess.update({ where: { learnerId }, data: { held: false } });
      await this.audit.audit(tx, {
        action: 'subscription.lessons_released',
        entity: 'learner',
        entityId: learnerId,
        reason: rows[0].state === 'locked' ? 'enforcement switched off (PD-30)' : 'group unlocked (PD-30)',
      });
      return true;
    });
  }

  /** The family and student groups a child is in (PD-15's family group, PD-11's student group). */
  private async groupsOf(tx: Tx, learnerId: string): Promise<Conversation[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text FROM chat.conversation c
       WHERE c.archived_at IS NULL
         AND ((c.type = 'student_group' AND c.learner_id = ${learnerId}::uuid)
           OR (c.type = 'family_group' AND EXISTS (
                 SELECT 1 FROM chat.conversation_learner cl
                  WHERE cl.conversation_id = c.id AND cl.learner_id = ${learnerId}::uuid)))
       ORDER BY c.created_at`;
    if (rows.length === 0) return [];
    return tx.conversation.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
  }

  /** PD-4: the family's direct chat with its supervisor -- never locked. */
  private async familyDirect(tx: Tx, familyId: string): Promise<Conversation | null> {
    return tx.conversation.findFirst({
      where: { familyId, type: 'direct', archivedAt: null },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  private async familyLanguage(familyId: string): Promise<CardLanguage> {
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { language: true } });
    return family?.language === 'en' ? 'en' : 'ar';
  }

  private async pushParents(
    ev: LearnerAccessEvent,
    learner: { id: string; name: string; familyId: string },
    templateKey: string,
    variables: Record<string, string>,
  ): Promise<void> {
    const parents = await this.prisma.contact.findMany({
      where: { familyId: learner.familyId, isActive: true },
      select: { id: true },
    });
    const lang = await this.familyLanguage(learner.familyId);
    for (const p of parents) {
      await this.notifications.schedule({
        dedupeKey: `${templateKey}:${ev.id}:${p.id}`,
        templateKey,
        eventType: templateKey,
        recipientId: p.id,
        locale: lang,
        priority: 'normal',
        familyId: learner.familyId,
        variables: { learner: learner.name, ...variables },
        scheduledAt: new Date(),
      });
    }
  }

  private async notifySales(renewalId: string, learner: { id: string; name: string; organizationId: string }): Promise<void> {
    const sales = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id::text FROM chat.staff s
       WHERE s.organization_id = ${learner.organizationId}::uuid AND s.is_active AND s.left_at IS NULL
         AND chat.sales_department_role(s.id) IS NOT NULL`;
    for (const s of sales) {
      await this.notifications.schedule({
        dedupeKey: `subscription_renewal_requested:${renewalId}:${s.id}`,
        templateKey: 'subscription_renewal_requested',
        eventType: 'subscription_renewal_requested',
        recipientId: s.id,
        priority: 'normal',
        variables: { learner: learner.name },
        scheduledAt: new Date(),
      });
    }
  }
}

function nextDay(d: Date): string {
  return new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
}

function reasonText(reasons: string[], lang: CardLanguage): string {
  const ar = lang === 'ar';
  const parts: string[] = [];
  if (reasons.includes('balance')) parts.push(ar ? 'انتهت حصص الاشتراك' : 'the subscription\'s lessons are used up');
  if (reasons.includes('overdue')) parts.push(ar ? 'قسط متأخر' : 'an instalment is overdue');
  return parts.join(ar ? '، ' : ', ');
}
