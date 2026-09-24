import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent, CommEventName, room } from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import { ActorKind, CallOutcome, CallType, Visibility } from '../contracts/vocab';

/**
 * Drains the transactional outbox.
 *
 * Delivery is at-least-once, so every consumer is idempotent: realtime emits
 * are naturally so, and notifications dedupe on dedupe_key. A row is claimed
 * with a conditional update, so two workers never publish the same event twice.
 */
@Injectable()
export class OutboxWorker {
  private readonly log = new Logger(OutboxWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
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
        return;
      }

      case CommEvent.APPROVAL_DECIDED: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        return;
      }

      /**
       * Every call event routes to the conversation room, which is exactly the
       * set of actors AuthorizationService let subscribe -- so the caller and
       * the callee receive it and nobody else does. Routing is decided here,
       * from server-derived fields; no client picks its audience.
       *
       * Listed explicitly rather than left to `default` on purpose. These four
       * are the lifecycle a client follows to render a call, and the two that
       * mattered most -- accepted and declined -- were the ones being dropped.
       * An explicit case makes the routing of a call event a decision somebody
       * made rather than a fall-through.
       */
      case CommEvent.CALL_INCOMING:
      case CommEvent.CALL_ACCEPTED:
      case CommEvent.CALL_DECLINED:
      case CommEvent.CALL_ENDED:
      case CommEvent.CALL_PARTICIPANT_JOINED:
      case CommEvent.CALL_PARTICIPANT_LEFT: {
        // Push, for the two lifecycle moments that have a seeded rule. A socket
        // only reaches a client that is already connected; these are how a call
        // reaches a phone in someone's pocket.
        if (type === CommEvent.CALL_INCOMING) await this.notifyIncomingCall(payload);
        if (type === CommEvent.CALL_ENDED) await this.notifyMissedCall(payload);

        if (!conversationId) {
          // Unroutable. This is the shape of the defect that hid here for so
          // long: CALL_ACCEPTED and CALL_DECLINED carried no conversationId,
          // fell through to `default`, and were discarded without a trace while
          // the outbox row was marked `published`. Now it is loud.
          this.log.error(
            `${type} has no conversationId and cannot be routed; it was NOT delivered`,
          );
          return;
        }
        await this.realtime.toThread(conversationId, type, payload as never);
        return;
      }

      default: {
        if (conversationId) {
          await this.realtime.toThread(conversationId, type, payload as never);
          return;
        }
        // Some events legitimately have no conversation -- presence is about an
        // actor, a notification about a recipient. They are not delivered by
        // this branch, and saying so is better than a silent `return`.
        this.log.debug(`${type} has no conversationId; no conversation fan-out`);
      }
    }
  }

  private async staffMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, actorKind: ActorKind.STAFF },
      select: { actorId: true },
    });
    return members.map((m) => m.actorId);
  }

  /**
   * Notify the people being called.
   *
   * RECIPIENTS COME FROM THE CALL, not from the event payload and never from a
   * client. The participant set was derived from conversation membership when
   * the call was authorized (CallService.start), so consuming it here inherits
   * that decision rather than re-deriving it -- and in particular the PD-6
   * relationship check that produced it. A revoked relationship cannot create a
   * call, so it cannot create this notification either.
   *
   * The initiator is excluded. They know they are calling.
   */
  private async notifyIncomingCall(payload: Record<string, unknown>): Promise<void> {
    const callId = payload.callId as string | undefined;
    if (!callId) return;

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) return;

    // A direct call rings its callee; a group call announces itself to the
    // group. The rules differ in template, priority and quiet-hours treatment,
    // and the rule rows say which -- this only picks between them.
    const ruleKey = call.type === CallType.GROUP ? 'group_call_started' : 'incoming_call';
    const initiator = await this.identity.resolveActor(call.initiatorId);

    for (const participant of call.participants) {
      if (participant.actorId === call.initiatorId) continue;

      const recipient = await this.identity.resolveActor(participant.actorId);
      if (!recipient || !recipient.isActive) continue;

      await this.notifications.scheduleByRule(ruleKey, {
        // One notification per call per recipient, forever. A replayed outbox
        // row converges on the same key and therefore the same notification.
        dedupeKey: `${ruleKey}:${callId}:${participant.actorId}`,
        recipientId: participant.actorId,
        locale: recipient.locale,
        familyId: call.familyId,
        conversationId: call.conversationId,
        variables: { caller_name: initiator?.displayName ?? 'Jawwid' },
      });
    }
  }

  /**
   * Notify the people who missed a call.
   *
   * Driven by the SAME `call.ended` event every other ending produces, filtered
   * on its outcome -- Phase 11 deliberately added no timeout-specific event, so
   * there is nothing else to listen to and no second lifecycle to keep in step.
   *
   * Only participants who never answered are notified, and never the initiator:
   * a caller whose call went unanswered does not need telling.
   */
  private async notifyMissedCall(payload: Record<string, unknown>): Promise<void> {
    if (payload.outcome !== CallOutcome.MISSED) return;

    const callId = payload.callId as string | undefined;
    if (!callId) return;

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) return;

    const initiator = await this.identity.resolveActor(call.initiatorId);

    for (const participant of call.participants) {
      if (participant.actorId === call.initiatorId) continue;
      // Answered it; it was not missed for them.
      if (participant.joinedAt !== null) continue;

      const recipient = await this.identity.resolveActor(participant.actorId);
      if (!recipient || !recipient.isActive) continue;

      await this.notifications.scheduleByRule('missed_call', {
        // Keyed on the call, so re-running reconciliation -- or replaying the
        // outbox row -- can never produce a second missed-call notification.
        dedupeKey: `missed_call:${callId}:${participant.actorId}`,
        recipientId: participant.actorId,
        locale: recipient.locale,
        familyId: call.familyId,
        conversationId: call.conversationId,
        variables: { caller_name: initiator?.displayName ?? 'Jawwid' },
      });
    }
  }

  /** Fan out a push for a published customer-visible message. */
  private async notifyNewMessage(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (payload.visibility === Visibility.INTERNAL) return;

    const authorId = payload.authorId as string | null;
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
    });
    const author = authorId ? await this.identity.resolveActor(authorId) : null;

    const state = await this.prisma.conversationParticipantState.findMany({
      where: { conversationId },
    });
    const mutedUntil = new Map(state.map((s) => [s.actorId, s.mutedUntil]));
    const now = new Date();

    for (const m of members) {
      if (m.actorId === authorId) continue;
      const muted = mutedUntil.get(m.actorId);
      if (muted && muted > now) continue;

      const recipient = await this.identity.resolveActor(m.actorId);
      if (!recipient || !recipient.isActive) continue;

      await this.notifications.schedule({
        // One notification per message per recipient, forever.
        dedupeKey: `new_message:${payload.messageId as string}:${m.actorId}`,
        ruleKey: 'new_message',
        templateKey: 'new_message',
        eventType: 'message_published',
        recipientId: m.actorId,
        locale: recipient.locale,
        conversationId,
        variables: {
          sender_name: author?.displayName ?? 'Jawwid',
          preview: '',
        },
        scheduledAt: now,
      });
    }
  }
}
