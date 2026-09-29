import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent, CommEventName, room } from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import { ActorKind, StoryState, Visibility } from '../contracts/vocab';

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

      case CommEvent.CALL_INCOMING: {
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        return;
      }

      case CommEvent.STORY_PUBLISHED: {
        // Fanned out to the RESOLVED AUDIENCE and nobody else, one actor room
        // each. Never a broadcast: there is no room that means "everyone", and
        // introducing one for stories would make the fan-out itself a place a
        // publication could leak from.
        const storyId = payload.storyId as string | undefined;
        if (!storyId) return;
        const recipients = await this.storyRecipientIds(storyId);
        await this.realtime.toUsers(recipients, type, payload as never);
        await this.notifyStoryPublished(storyId);
        return;
      }

      case CommEvent.STORY_RETIRED: {
        // Same audience. A client that is showing an expired or deleted story
        // gets told to drop it rather than finding out on its next refetch --
        // and the refetch it then makes is itself audience- and expiry-checked,
        // so this event grants nothing.
        const storyId = payload.storyId as string | undefined;
        if (!storyId) return;
        await this.realtime.toUsers(await this.storyRecipientIds(storyId), type, payload as never);
        return;
      }

      default: {
        if (conversationId) {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
      }
    }
  }

  private async storyRecipientIds(storyId: string): Promise<string[]> {
    const rows = await this.prisma.storyRecipient.findMany({
      where: { storyId },
      select: { actorId: true },
    });
    return rows.map((r) => r.actorId);
  }

  /**
   * One push per recipient per story.
   *
   * The recipient set is read from chat.story_recipient -- the same rows the feed
   * joins against -- so a notification can never reach somebody the story was not
   * published to. The body carries the TITLE only, never the story body and never
   * a media URL: a lock-screen preview is not the place to spend a publication's
   * privacy, and the client refetches the feed (audience- and expiry-checked) to
   * render anything more.
   *
   * Muting: story notifications honour quiet hours through
   * NotificationService.schedule like every other notification. There is no
   * per-story mute, because there is no per-story conversation to hang one on.
   */
  private async notifyStoryPublished(storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, title: true, state: true, expiresAt: true, organizationId: true },
    });
    // Retired between publish and drain: do not announce it.
    if (!story || story.state !== StoryState.PUBLISHED) return;
    if (story.expiresAt && story.expiresAt <= new Date()) return;

    const organization = await this.prisma.organization.findUnique({
      where: { id: story.organizationId },
      select: { displayName: true },
    });

    const recipients = await this.prisma.storyRecipient.findMany({
      where: { storyId },
      select: { actorId: true },
    });

    for (const r of recipients) {
      const actor = await this.identity.resolveActor(r.actorId);
      // An actor deactivated between publish and drain gets nothing.
      if (!actor || !actor.isActive) continue;

      await this.notifications.schedule({
        // One notification per story per recipient, forever.
        dedupeKey: `story_published:${storyId}:${r.actorId}`,
        ruleKey: 'story_published',
        templateKey: 'story_published',
        eventType: 'story_published',
        recipientId: r.actorId,
        locale: actor.locale,
        variables: {
          organization_name: organization?.displayName ?? 'Jawwid',
          story_title: story.title ?? '',
        },
        scheduledAt: new Date(),
      });
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
