import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent, CommEventName, room } from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import {
  ActorKind,
  CallOutcome,
  CallType,
  StoryState,
  Visibility,
} from '../contracts/vocab';

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
       * THE CALL LIFECYCLE GOES TO THE PARTICIPANTS, not to the conversation.
       *
       * It used to go to `conversation:<id>`, and that was wrong in two
       * directions at once (W8-W0b):
       *
       * TOO NARROW. A socket is only in a conversation room after it has sent
       * `conversation.subscribe`, and a client cannot subscribe to a call it
       * does not yet know exists. A phone that was asleep, backgrounded or
       * terminated has subscribed to nothing, so the one event that has to
       * reach it -- `call.incoming` -- was the one it could not receive.
       *
       * TOO BROAD. The conversation room is every member who passed `canRead`,
       * and `CallService.start` deliberately excludes SILENT members from a
       * call's participants. A silent member was therefore told about a call
       * they were not part of and could not join.
       *
       * So the recipients are the call's own participant rows -- the set the
       * server derived when it authorized the call, under PD-6, PD-2 and C-4 --
       * and each one is reached in its own actor room, which
       * `RealtimeGateway.handleConnection` joins from the RESOLVED actor. A
       * forged handshake cannot put a socket in someone else's actor room, so
       * no client can name its own audience here or anywhere downstream.
       *
       * Media presence is NOT part of this. `participant_joined` /
       * `participant_left` say what LiveKit observed, they are only meaningful
       * to a client already in the call, and they keep the conversation-room
       * routing they have always had.
       */
      case CommEvent.CALL_INCOMING:
      case CommEvent.CALL_ACCEPTED:
      case CommEvent.CALL_DECLINED:
      case CommEvent.CALL_ENDED: {
        // Push, for the two lifecycle moments that have a seeded rule. A socket
        // only reaches a client that is already connected; these are how a call
        // reaches a phone in someone's pocket.
        if (type === CommEvent.CALL_INCOMING) await this.notifyIncomingCall(payload);
        if (type === CommEvent.CALL_ENDED) await this.notifyMissedCall(payload);

        const participants = await this.callParticipantIds(payload);
        if (participants.length === 0) {
          // Unroutable, and said out loud. This is the shape of the defect that
          // hid here for so long: CALL_ACCEPTED and CALL_DECLINED carried no
          // conversationId, fell through to `default`, and were discarded
          // without a trace while the outbox row was marked `published`.
          this.log.error(
            `${type} resolved no call participants and was NOT delivered`,
          );
          return;
        }
        await this.realtime.toUsers(participants, type, payload as never);
        return;
      }

      case CommEvent.CALL_PARTICIPANT_JOINED:
      case CommEvent.CALL_PARTICIPANT_LEFT: {
        // Media presence, unchanged: the conversation room, exactly as before.
        if (!conversationId) {
          this.log.error(
            `${type} has no conversationId and cannot be routed; it was NOT delivered`,
          );
          return;
        }
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
          return;
        }
        // Some events legitimately have no conversation -- presence is about an
        // actor, a notification about a recipient. They are not delivered by
        // this branch, and saying so is better than a silent `return`.
        this.log.debug(`${type} has no conversationId; no conversation fan-out`);
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

  /**
   * WHO MAY RECEIVE A CALL EVENT. The single source of that answer.
   *
   * It reads `chat.call_participant` for the call the event names, and nothing
   * else. Not the payload's `conversationId`, not conversation membership, not
   * anything a client sent: those rows were written by `CallService.start`
   * from live, active, NON-SILENT members after the relationship predicate
   * (PD-6), PD-2 and C-4 had all been satisfied. Reusing them inherits that
   * decision instead of re-deriving it, which is the only way the two can
   * never drift apart.
   *
   * A call that cannot be found yields nobody, and the caller logs and drops
   * the event. Delivering to a conversation because a call row is missing
   * would be exactly the widening this exists to prevent.
   *
   * The INITIATOR IS INCLUDED. They are a participant row like any other, and
   * they are the one who most needs `call.accepted` and `call.ended` -- the
   * caller has to learn the outcome. (Push is different: `notifyIncomingCall`
   * skips them, because a person does not need telling they are calling.)
   */
  private async callParticipantIds(
    payload: Record<string, unknown>,
  ): Promise<string[]> {
    const callId = payload.callId;
    if (typeof callId !== 'string' || callId.length === 0) return [];

    const participants = await this.prisma.callParticipant.findMany({
      where: { callId },
      select: { actorId: true },
    });
    return participants.map((p) => p.actorId);
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
