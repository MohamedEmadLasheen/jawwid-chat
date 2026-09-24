import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent, CommEventName, room } from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import { ActorKind, Visibility } from '../contracts/vocab';

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
