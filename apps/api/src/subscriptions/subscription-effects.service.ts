import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Conversation, Prisma } from '@prisma/client';
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
 *   grace     the family's direct chat with its supervisor (chosen by who is
 *             in it, never a teacher): "N grace lessons left". Never the
 *             group: the teacher sees nothing financial.
 *   locked    the group: "the lessons are paused" (no reason); the direct
 *             chat: why, and where to pay.
 *   unlocked  the group: "the lessons are back on".
 *   Each also pushes to every active parent and to the child's supervisor.
 *
 * With SUBSCRIPTION_LOCK_ENFORCED off nothing is announced (the events are
 * marked applied): the academy checks balances before any lock bites. The
 * first pass that sees it on announces the children already in grace or
 * locked (startEnforcementIfFirst).
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
    // The first pass that sees enforcement on announces every child already
    // in grace or locked -- and holds nothing: holds start on the next pass.
    if (await this.startEnforcementIfFirst()) return { refreshed, applied: 0, held: 0, released: 0 };
    const applied = await this.applyEvents();
    const { held, released } = await this.reconcileHolds();
    return { refreshed, applied, held, released };
  }

  /**
   * SWITCH-ON (department head, 2026-10-26). The first time any process sees
   * SUBSCRIPTION_LOCK_ENFORCED on, it records -- once, whoever wins the insert
   * -- `subscription.enforced_since` and go-live (`subscription.overdue_from`
   * = that academy day: only instalments due from then lock), marks the
   * changes recorded while it was off as applied (they are superseded), and
   * tells every family whose child is ALREADY in grace or locked: the same
   * cards and pushes a change would have sent. `subscription.announced_at`
   * then lets holds begin, from the next pass. True when this call did it.
   */
  async startEnforcementIfFirst(): Promise<boolean> {
    if (!this.locks.enforced) return false;
    const won = await this.prisma.$queryRaw<Array<{ key: string }>>`
      INSERT INTO chat.config (key, value, description)
      VALUES ('subscription.enforced_since', to_jsonb(now()::text), 'PD-30: when the payment lock was first enforced.')
      ON CONFLICT (key) DO NOTHING
      RETURNING key`;
    if (won.length === 0) return false;
    await this.prisma.$executeRaw`
      INSERT INTO chat.config (key, value, description)
      VALUES ('subscription.overdue_from', to_jsonb(chat.pd030_today()::text),
              'PD-30: instalments due on or after this day lock a group when overdue (go-live = first enforced day).')
      ON CONFLICT (key) DO NOTHING`;
    const goLive = (await this.prisma.$queryRaw<Array<{ d: string | null }>>`SELECT chat.pd030_overdue_from()::text AS d`)[0]?.d;
    this.log.warn(`PD-30 payment lock enforced for the first time; go-live for overdue instalments = ${goLive}`);
    await this.prisma.learnerAccessEvent.updateMany({ where: { appliedAt: null }, data: { appliedAt: new Date() } });
    await this.refreshAll();
    const current = await this.prisma.learnerAccess.findMany({
      where: { state: { in: ['grace', 'locked'] } },
      orderBy: { learnerId: 'asc' },
    });
    const pushes: Array<() => Promise<void>> = [];
    for (const a of current) {
      pushes.push(...(await this.prisma.$transaction((tx) =>
        this.announceChange(tx, `start:${a.learnerId}`, {
          learnerId: a.learnerId,
          fromState: 'open',
          toState: a.state,
          reasons: a.reasons,
          graceLeft: a.graceLeft,
          overdueInstalmentId: a.overdueInstalmentId,
          overdueDueOn: a.overdueDueOn,
        }),
      )));
    }
    await this.prisma.$executeRaw`
      INSERT INTO chat.config (key, value, description)
      VALUES ('subscription.announced_at', to_jsonb(now()::text), 'PD-30: switch-on announcements done; holds may begin.')
      ON CONFLICT (key) DO NOTHING`;
    for (const push of pushes) await push().catch((e) => this.log.error(`subscription push failed: ${(e as Error).name}`));
    return true;
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
          const after = this.locks.enforced ? await this.announceChange(tx, event.id, event) : [];
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
    // No hold before the switch-on announcements are out (startEnforcementIfFirst).
    const announced =
      (await this.prisma.config.findUnique({ where: { key: 'subscription.announced_at' }, select: { key: true } })) !== null;
    const enforced = this.locks.enforced;
    const toHold = enforced && announced
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
      const direct = await this.familyDirect(tx, learner.id);
      if (direct) {
        await this.lessons.postCardInto(
          tx, direct, null, null, CardKind.RENEWAL_REQUESTED,
          { learnerId: learner.id, learnerName: learner.name }, await this.familyLanguage(learner.familyId),
        );
      }
      return rows[0]!.id;
    });
    if (!created) throw new CommError(CommErrorCode.SUBSCRIPTION_STATE, 'a renewal was already requested today', 409);
    // PD-47 PR-4 (owner Q-F6): no push to every Sales member. The request raises
    // its renewal task for the family's one Sales owner (else the Sales manager),
    // and that task's assignment is their notice (OutboxWorker.deliverTask).
    return { requested: true };
  }

  // ------------------------------------------------------------------

  /**
   * The cards for one change, in its transaction; the pushes it returns go out
   * after. Financial words (grace, why it is locked, where to pay) go only to
   * the family's direct chat with its supervisor; the group -- the teacher
   * reads it -- hears only "paused" / "back on".
   */
  private async announceChange(tx: Tx, dedupe: string, ev: Change): Promise<Array<() => Promise<void>>> {
    const learner = await tx.learner.findUnique({ where: { id: ev.learnerId }, select: { id: true, name: true, familyId: true } });
    if (!learner) return [];
    const lang = await this.familyLanguage(learner.familyId);
    const subject = { learnerId: learner.id, learnerName: learner.name };
    const wasLocked = ev.fromState === 'locked';
    const isLocked = ev.toState === 'locked';
    const direct = await this.familyDirect(tx, learner.id);

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
      return [() => this.pushFamily(dedupe, learner, 'subscription_locked', { reason: reasonText(ev.reasons, lang) })];
    }
    if (wasLocked) {
      for (const group of await this.groupsOf(tx, learner.id)) {
        await this.lessons.postCardInto(tx, group, null, null, CardKind.SUBSCRIPTION_UNLOCKED, subject, lang);
      }
      return [() => this.pushFamily(dedupe, learner, 'subscription_unlocked', {})];
    }
    if (ev.toState === 'grace' && ev.graceLeft !== null && ev.graceLeft > 0) {
      if (direct) {
        await this.lessons.postCardInto(tx, direct, null, null, CardKind.SUBSCRIPTION_GRACE, { ...subject, graceLeft: ev.graceLeft }, lang);
      }
      return [() => this.pushFamily(dedupe, learner, 'subscription_grace', { grace_left: String(ev.graceLeft) })];
    }
    return [];
  }

  /** Suspend the child's regular lessons that have not started; stop the materializer. */
  private async hold(learnerId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ state: string; held: boolean }>>`
        SELECT state, held FROM chat.learner_access WHERE learner_id = ${learnerId}::uuid FOR UPDATE`;
      if (!rows[0] || rows[0].held || !this.locks.enforced || (await lockOf(tx, learnerId)) === null) return false;
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
      if (!rows[0] || !rows[0].held || (this.locks.enforced && (await lockOf(tx, learnerId)) !== null)) return false;
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
                  WHERE cl.conversation_id = c.id AND cl.learner_id = ${learnerId}::uuid))
           -- A family group with no child rows is about every child of its family.
           OR (c.type = 'family_group'
               AND c.family_id = (SELECT l.family_id FROM chat.learner l WHERE l.id = ${learnerId}::uuid)
               AND NOT EXISTS (SELECT 1 FROM chat.conversation_learner cl WHERE cl.conversation_id = c.id)))
       ORDER BY c.created_at`;
    if (rows.length === 0) return [];
    return tx.conversation.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
  }

  /**
   * PD-4: the family's direct chat with the child's CURRENT supervisor, chosen
   * by who is in it -- a parent of the family and that supervisor, and no
   * teacher -- never by "the newest direct of the family": a legacy PD-6
   * teacher<->parent direct must never receive a financial card. None when
   * the child has no supervisor or no such chat.
   */
  private async familyDirect(tx: Tx, learnerId: string): Promise<Conversation | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id::text FROM chat.conversation c
        JOIN chat.learner l ON l.id = ${learnerId}::uuid AND c.family_id = l.family_id
        JOIN chat.learner_supervision ls ON ls.learner_id = l.id
       WHERE c.type = 'direct' AND c.archived_at IS NULL
         AND EXISTS (SELECT 1 FROM chat.conversation_member m
                      WHERE m.conversation_id = c.id AND m.left_at IS NULL AND m.actor_id = ls.supervisor_id)
         AND EXISTS (SELECT 1 FROM chat.conversation_member m JOIN chat.contact ct ON ct.id = m.actor_id
                      WHERE m.conversation_id = c.id AND m.left_at IS NULL AND ct.family_id = l.family_id)
         AND NOT EXISTS (SELECT 1 FROM chat.conversation_member m
                          WHERE m.conversation_id = c.id AND m.actor_kind = 'teacher')
       ORDER BY c.last_activity_at DESC
       LIMIT 1`;
    return rows[0] ? tx.conversation.findUnique({ where: { id: rows[0].id } }) : null;
  }

  private async familyLanguage(familyId: string): Promise<CardLanguage> {
    const family = await this.prisma.family.findUnique({ where: { id: familyId }, select: { language: true } });
    return family?.language === 'en' ? 'en' : 'ar';
  }

  /** A push to every active parent of the family and to the child's supervisor. */
  private async pushFamily(
    dedupe: string,
    learner: { id: string; name: string; familyId: string },
    templateKey: string,
    variables: Record<string, string>,
  ): Promise<void> {
    const parents = await this.prisma.contact.findMany({
      where: { familyId: learner.familyId, isActive: true },
      select: { id: true },
    });
    const supervisor = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT supervisor_id::text AS id FROM chat.learner_supervision WHERE learner_id = ${learner.id}::uuid AND supervisor_id IS NOT NULL`;
    const lang = await this.familyLanguage(learner.familyId);
    for (const p of [...parents, ...supervisor]) {
      await this.notifications.schedule({
        dedupeKey: `${templateKey}:${dedupe}:${p.id}`,
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

/** One change of a child's state: a recorded event, or a switch-on announcement. */
interface Change {
  learnerId: string;
  fromState: string;
  toState: string;
  reasons: string[];
  graceLeft: number | null;
  overdueInstalmentId: string | null;
  overdueDueOn: Date | null;
}

async function lockOf(tx: Tx, learnerId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ lock: string | null }>>`SELECT chat.learner_lesson_lock(${learnerId}::uuid) AS lock`;
  return rows[0]?.lock ?? null;
}
