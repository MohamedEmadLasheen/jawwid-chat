import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import {
  CommEvent,
  CommEventName,
  ClassAttendancePayload,
  ClassSessionPayload,
  LearnerScheduleChangedPayload,
} from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import { RecipientResolver } from '../notifications/recipient-resolver.service';
import { PresenceService } from '../realtime/presence.service';
import {
  ClassScheduleService,
  formatDate,
  formatTime,
} from '../schedule/class-schedule.service';
import { ActorKind, CallOutcome, Visibility } from '../contracts/vocab';
import { NotificationType, messageNotificationType } from '../contracts/notifications';

/**
 * Two representations of the same moment, compared as moments.
 *
 * A timestamp that made the round trip through jsonb comes back in Postgres's
 * rendering, which is not JavaScript's. Comparing the strings would make every
 * replayed event look superseded -- a guard that is always on is the same as no
 * recovery path at all.
 */
function sameInstant(a: Date | null | undefined, b: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  const parsed = new Date(b);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() === a.getTime();
}

/**
 * EVENT HANDLER -- the single place a system event becomes a notification.
 *
 * Drains the transactional outbox and, for each event, does two things: fan the
 * event out over realtime, and ask the notification engine to tell whoever needs
 * telling. The mapping from event to notification lives HERE, in one switch, so
 * a feature cannot grow its own private notification behaviour in a controller
 * or -- worse -- in a UI component.
 *
 * Delivery is at-least-once, so every consumer is idempotent: realtime emits are
 * naturally so, and notifications dedupe on dedupe_key. A row is claimed with a
 * conditional update, so two workers never publish the same event twice.
 */
@Injectable()
export class OutboxWorker {
  private readonly log = new Logger(OutboxWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly recipients: RecipientResolver,
    private readonly presence: PresenceService,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    private readonly schedule: ClassScheduleService,
  ) {}

  async drain(batchSize = 100): Promise<number> {
    const now = new Date();
    const batch = await this.prisma.outboxEvent.findMany({
      where: { status: 'pending', availableAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let published = 0;
    for (const event of batch) {
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'pending' },
        data: { status: 'published', publishedAt: now, attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      try {
        await this.publish(event.type as CommEventName, event.payload as Record<string, unknown>);
        published += 1;
      } catch (err) {
        // Return it to the queue with backoff rather than losing it.
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: event.attempts >= 5 ? 'failed' : 'pending',
            lastError: err instanceof Error ? err.message : 'unknown',
            availableAt: new Date(Date.now() + Math.min(2 ** event.attempts * 5_000, 300_000)),
            publishedAt: null,
          },
        });
        this.log.warn(`outbox ${event.id} (${event.type}) failed to publish`);
      }
    }
    return published;
  }

  private async publish(type: CommEventName, payload: Record<string, unknown>): Promise<void> {
    const conversationId = payload.conversationId as string | undefined;

    switch (type) {
      case CommEvent.MESSAGE_CREATED: {
        if (!conversationId) return;
        // Internal notes are broadcast only to staff rooms, never to the
        // conversation room where a parent is listening.
        if (payload.visibility === Visibility.INTERNAL) {
          const staff = await this.staffMemberIds(conversationId);
          await this.realtime.toUsers(staff, type, payload as never);
        } else {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
        await this.notifyNewMessage(conversationId, payload);
        return;
      }

      case CommEvent.APPROVAL_REQUESTED: {
        if (!conversationId) return;
        // Never broadcast to the group: only staff who may decide see it.
        const staff = await this.staffMemberIds(conversationId);
        await this.realtime.toUsers(staff, type, payload as never);
        await this.notifyApprovalRequested(conversationId, payload, staff);
        return;
      }

      case CommEvent.APPROVAL_DECIDED: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        await this.notifyApprovalDecided(conversationId, payload);
        return;
      }

      case CommEvent.CALL_INCOMING: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        await this.notifyIncomingCall(conversationId, payload);
        return;
      }

      case CommEvent.CALL_ENDED: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        await this.notifyCallEnded(conversationId, payload);
        return;
      }

      // -- Classes ----------------------------------------------------------
      // The recovery path for the legacy next_class_at write. The fast path in
      // ClassScheduleService.reschedule has almost always already run; this is
      // what happens when it did not, because the process died between the
      // commit and the notification.
      case CommEvent.LEARNER_SCHEDULE_CHANGED: {
        await this.replayScheduleChange(payload as unknown as LearnerScheduleChangedPayload);
        return;
      }

      case CommEvent.CLASS_SESSION_SCHEDULED:
      case CommEvent.CLASS_SESSION_RESCHEDULED: {
        await this.applySessionReminders(payload as unknown as ClassSessionPayload);
        return;
      }

      case CommEvent.CLASS_SESSION_CANCELLED: {
        const session = payload as unknown as ClassSessionPayload;
        await this.schedule.cancelSessionReminders(session.classSessionId);
        return;
      }

      case CommEvent.CLASS_ATTENDANCE_RECORDED: {
        await this.notifyAttendance(payload as unknown as ClassAttendancePayload);
        return;
      }

      default: {
        if (conversationId) {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
      }
    }
  }

  /**
   * Replay a schedule change, unless the world has moved on.
   *
   * THE HAZARD THIS EXISTS FOR. Change #1 enqueues its event. Change #2 lands,
   * cancels #1's reminders and schedules its own. Then #1's event is finally
   * drained -- and a naive handler would re-notify about a move that has been
   * superseded and, worse, recreate reminders for a class time that no longer
   * exists. The parent would be reminded to be somewhere at 6:00 for a class
   * that is now at 7:00.
   *
   * The guard is a comparison against the CURRENT authoritative value, not a
   * delay or a timestamp heuristic: if the learner's next_class_at is no longer
   * what this event said it became, this event is history and does nothing. A
   * stale replay is a no-op, never a correction.
   */
  private async replayScheduleChange(payload: LearnerScheduleChangedPayload): Promise<void> {
    const learner = await this.prisma.learner.findUnique({
      where: { id: payload.learnerId },
      select: { nextClassAt: true },
    });
    if (!learner) return;

    // Compared as INSTANTS, not as strings. Postgres renders a timestamptz in
    // jsonb as `...T11:42:40.33+00:00` and JavaScript renders the same instant
    // as `...T11:42:40.330Z`; comparing the text would call every event stale
    // and silently disable the recovery path.
    if (!sameInstant(learner.nextClassAt, payload.nextAt)) {
      this.log.debug(`schedule change for ${payload.learnerId} superseded; replay skipped`);
      return;
    }

    await this.schedule.applyScheduleChange(
      payload.learnerId,
      payload.previousAt ? new Date(payload.previousAt) : null,
      payload.nextAt ? new Date(payload.nextAt) : null,
    );
  }

  /**
   * Reminders for a class occurrence, against its current state.
   *
   * The same staleness rule as above, expressed against the occurrence rather
   * than the learner: the session is re-read, and an event describing a time or
   * a status it has since left does nothing. A cancelled session never gets
   * reminders, whatever an older event in the queue says.
   */
  private async applySessionReminders(payload: ClassSessionPayload): Promise<void> {
    const session = await this.prisma.classSession.findUnique({
      where: { id: payload.classSessionId },
      select: { id: true, learnerId: true, startsAt: true, status: true },
    });
    if (!session) return;

    if (session.status !== payload.status || !sameInstant(session.startsAt, payload.startsAt)) {
      this.log.debug(`class session ${payload.classSessionId} superseded; replay skipped`);
      return;
    }
    if (session.status !== 'scheduled' && session.status !== 'rescheduled') return;

    // A move withdraws the old occurrence's reminders before writing the new
    // ones. Both are keyed on the session id, so this is exact -- and the ones
    // for the CURRENT time are kept, because cancelling them would make them
    // unrecreatable: `schedule()` dedupes on the same key and would find the
    // row it had just cancelled.
    await this.schedule.cancelSessionReminders(session.id, session.startsAt);
    await this.schedule.scheduleSessionReminders(session);
  }

  /**
   * One notification, for one outcome.
   *
   * `class_missed` only. `class_attended` is projected and stays silent: "your
   * child attended their class" is the normal case, and announcing the normal
   * case is how a parent learns to dismiss everything.
   *
   * The dedupe key is the occurrence plus the recipient, so a redelivered Core
   * event, a retried outbox row and a second worker all converge on one
   * notification.
   */
  private async notifyAttendance(payload: ClassAttendancePayload): Promise<void> {
    if (payload.outcome !== 'class_missed') return;
    // A redelivery that says exactly what the row already said is not news.
    if (payload.previousOutcome === 'class_missed') return;

    const learner = await this.prisma.learner.findUnique({
      where: { id: payload.learnerId },
      select: { name: true, familyId: true },
    });
    if (!learner) return;

    const startsAt = new Date(payload.startsAt);
    const parents = await this.recipients.forLearner(payload.learnerId);

    for (const parent of parents) {
      const zone = await this.timezoneOf(parent.actorId);
      await this.notifications.schedule({
        dedupeKey: `class_missed:${payload.classSessionId}:${parent.actorId}`,
        type: NotificationType.CLASS_MISSED,
        eventType: 'class_missed',
        recipientId: parent.actorId,
        locale: parent.locale,
        familyId: learner.familyId,
        learnerId: payload.learnerId,
        learnerName: learner.name,
        variables: {
          student_name: learner.name,
          parent_name: parent.displayName,
          class_time: formatTime(startsAt, zone, parent.locale),
          class_date: formatDate(startsAt, zone, parent.locale),
        },
        scheduledAt: new Date(),
      });
    }
  }

  /** The family's zone, never the server's. Mirrors ClassScheduleService. */
  private async timezoneOf(actorId: string): Promise<string> {
    const row = await this.prisma.quietHours.findUnique({
      where: { actorId },
      select: { timezone: true },
    });
    return row?.timezone ?? 'Asia/Riyadh';
  }

  private async staffMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, actorKind: ActorKind.STAFF },
      select: { actorId: true },
    });
    return members.map((m) => m.actorId);
  }

  // -- message.created -> MESSAGE_RECEIVED / VOICE_… / MEDIA_… ---------------

  /**
   * A published, customer-visible message notifies every other member.
   *
   * The notification TYPE follows the message type, so a voice note says "sent
   * you a voice message" rather than the generic line -- a parent scanning a
   * notification centre should be able to tell at a glance whether there is
   * something to listen to.
   *
   * Internal notes notify nobody: they are staff-to-staff and a parent must
   * never learn one exists.
   */
  private async notifyNewMessage(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (payload.visibility === Visibility.INTERNAL) return;

    const type = messageNotificationType(String(payload.type ?? 'text'));
    // A system message is the conversation narrating itself ("Sara joined").
    // Nobody's phone needs to light up for it.
    if (!type) return;

    const authorId = (payload.authorId as string | null) ?? null;
    const messageId = payload.messageId as string;

    const author = authorId ? await this.identity.resolveActor(authorId) : null;
    const members = await this.recipients.forConversation(conversationId, authorId);

    const state = await this.prisma.conversationParticipantState.findMany({
      where: { conversationId },
    });
    const mutedUntil = new Map(state.map((s) => [s.actorId, s.mutedUntil]));
    const now = new Date();

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { familyId: true },
    });

    for (const member of members) {
      const muted = mutedUntil.get(member.actorId);
      const isMuted = Boolean(muted && muted > now);

      // Looking at this exact thread right now? The message is already on
      // screen. Create the notification, skip the push, record why.
      const isViewing = await this.viewing(member.actorId, conversationId);

      await this.notifications.schedule({
        // One notification per message per recipient, forever.
        dedupeKey: `message:${messageId}:${member.actorId}`,
        type,
        eventType: 'message_published',
        ruleKey: 'new_message',
        recipientId: member.actorId,
        locale: member.locale,
        conversationId,
        messageId,
        senderId: authorId,
        familyId: conversation?.familyId ?? member.familyId ?? null,
        // The child, from THIS recipient's point of view. A parent reads
        // "Ahmed's teacher"; the teacher who sent it reads the sender's name.
        learnerId: member.learnerId ?? null,
        learnerName: member.learnerName ?? null,
        variables: { sender_name: author?.displayName ?? 'Jawwid' },
        scheduledAt: now,
        recipientIsActive: isViewing,
        conversationMuted: isMuted,
      });
    }
  }

  // -- calls ----------------------------------------------------------------

  /**
   * An incoming call wakes the callee's devices.
   *
   * The ringing UI is driven by the realtime `call.incoming` event, not by this.
   * This exists for the device that is asleep or backgrounded, where a VoIP push
   * is the only thing that can start a ring at all -- and it is deliberately
   * URGENT and quiet-hours-exempt, because a call that arrives silently is not a
   * call.
   */
  private async notifyIncomingCall(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const callId = payload.callId as string;
    const initiatorId = payload.initiatorId as string | null;
    const initiatorName = (payload.initiatorName as string) ?? 'Jawwid';

    const callees = await this.recipients.forConversation(conversationId, initiatorId);
    const now = new Date();

    for (const callee of callees) {
      await this.notifications.schedule({
        dedupeKey: `incoming_call:${callId}:${callee.actorId}`,
        type: NotificationType.INCOMING_CALL,
        eventType: 'call_started',
        ruleKey: 'incoming_call',
        recipientId: callee.actorId,
        locale: callee.locale,
        conversationId,
        callId,
        senderId: initiatorId,
        familyId: callee.familyId ?? null,
        learnerId: callee.learnerId ?? null,
        learnerName: callee.learnerName ?? null,
        variables: { caller_name: initiatorName },
        scheduledAt: now,
      });
    }
  }

  /**
   * An unanswered call becomes a MISSED_CALL notification.
   *
   * This is the notification that has to survive: the VoIP push disappears the
   * moment the ringing stops, and without a persisted record a parent has no
   * way of knowing the academy tried to reach them about their child. It is
   * essential, never grouped, and stays in the history.
   *
   * Only participants who never joined are notified. Somebody who answered on
   * their phone did not miss the call because their tablet also rang.
   */
  private async notifyCallEnded(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (payload.outcome !== CallOutcome.MISSED) return;

    const callId = payload.callId as string;
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) return;

    const initiator = await this.identity.resolveActor(call.initiatorId);
    const missedBy = call.participants
      .filter((p) => p.actorId !== call.initiatorId && p.joinedAt === null)
      .map((p) => p.actorId);
    if (missedBy.length === 0) return;

    const members = await this.recipients.forConversation(conversationId, call.initiatorId);
    const byActor = new Map(members.map((m) => [m.actorId, m]));
    const now = new Date();

    for (const actorId of missedBy) {
      const member = byActor.get(actorId);
      if (!member) continue;

      await this.notifications.schedule({
        dedupeKey: `missed_call:${callId}:${actorId}`,
        type: NotificationType.MISSED_CALL,
        eventType: 'call_missed',
        ruleKey: 'missed_call',
        recipientId: actorId,
        locale: member.locale,
        conversationId,
        callId,
        senderId: call.initiatorId,
        familyId: call.familyId ?? member.familyId ?? null,
        learnerId: member.learnerId ?? null,
        learnerName: member.learnerName ?? null,
        variables: { caller_name: initiator?.displayName ?? 'Jawwid' },
        scheduledAt: now,
      });
    }
  }

  // -- approvals (staff-facing) ---------------------------------------------

  private async notifyApprovalRequested(
    conversationId: string,
    payload: Record<string, unknown>,
    staffIds: string[],
  ): Promise<void> {
    const approvalId = payload.approvalId as string;
    const messageId = payload.messageId as string;
    const requestedBy = payload.requestedBy as string | null;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { familyId: true, learner: { select: { id: true, name: true } } },
    });
    const now = new Date();

    for (const staffId of staffIds) {
      if (staffId === requestedBy) continue;
      const actor = await this.identity.resolveActor(staffId);
      if (!actor?.isActive) continue;

      await this.notifications.schedule({
        dedupeKey: `approval_requested:${approvalId}:${staffId}`,
        type: NotificationType.APPROVAL_REQUESTED,
        eventType: 'approval_requested',
        ruleKey: 'pending_approval',
        recipientId: staffId,
        locale: actor.locale,
        conversationId,
        messageId,
        senderId: requestedBy,
        familyId: conversation?.familyId ?? null,
        variables: { student_name: conversation?.learner?.name ?? '' },
        scheduledAt: now,
      });
    }
  }

  private async notifyApprovalDecided(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const approvalId = payload.approvalId as string;
    const messageId = payload.messageId as string;

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { authorId: true },
    });
    if (!message?.authorId) return;

    const author = await this.identity.resolveActor(message.authorId);
    if (!author?.isActive) return;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { familyId: true, learner: { select: { id: true, name: true } } },
    });

    await this.notifications.schedule({
      dedupeKey: `approval_decided:${approvalId}:${message.authorId}`,
      type: NotificationType.APPROVAL_DECIDED,
      eventType: 'approval_decided',
      ruleKey: 'approval_decision',
      recipientId: message.authorId,
      locale: author.locale,
      conversationId,
      messageId,
      familyId: conversation?.familyId ?? null,
      variables: {
        decision: String(payload.decision ?? ''),
        student_name: conversation?.learner?.name ?? '',
      },
      scheduledAt: new Date(),
    });
  }

  /**
   * Presence lives in Redis, which the worker may be running without in a
   * degraded deployment. An unavailable Redis must not stop a notification
   * being created -- it only means we cannot prove the parent is already
   * reading, so we push, which is the safe direction to fail in.
   */
  private async viewing(actorId: string, conversationId: string): Promise<boolean> {
    try {
      return await this.presence.isViewing(actorId, conversationId);
    } catch {
      return false;
    }
  }
}
