import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma.service';
import { IDENTITY_SERVICE, REALTIME_PUBLISHER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import { actorRefKey } from '../../platform/identity.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import { CommEvent, CommEventName, room } from '../contracts/events';
import { NotificationService } from '../notifications/notification.service';
import { statusUpdatesByAuthor } from '../messages/receipt-status';
import { mentionRuleFor } from '../mentions/mention-policy';
import { NotificationPipeline } from '../notifications/notification-pipeline.service';
import { messageAudience } from './message-audience';
import { ActorKind, CallOutcome, CallType, StoryState, Visibility } from '../contracts/vocab';

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
    // PD-34. Optional so a suite that builds a worker by hand (the call and
    // revocation suites) gets exactly the delivery it always had.
    @Optional() private readonly pipeline?: NotificationPipeline,
  ) {}

  async drain(batchSize = 100, now = new Date()): Promise<number> {
    // CLAIM PRECISION (issue #29). `availableAt` is written by Prisma's
    // client-side default and lands up to ONE millisecond after a clock read
    // taken in the same millisecond (measured: 12.7% of inserts on Linux), so a
    // row enqueued and drained within one millisecond failed `<= now` and waited
    // for the next pass -- up to OUTBOX_IDLE_BACKOFF_MS when no wake hint
    // arrived. One millisecond of tolerance claims it now. It cannot claim a row
    // early in any way that matters: a retry's backoff is seconds.
    const claimableUntil = new Date(now.getTime() + 1);
    const batch = await this.prisma.outboxEvent.findMany({
      where: { status: 'pending', availableAt: { lte: claimableUntil } },
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

      /**
       * PD-36: to the mentioned person's own actor room (a summoned non-member
       * is in no thread room, and their chat list must move the row to the top
       * now), and their push. One event per person.
       */
      case CommEvent.MENTION_CREATED: {
        const target = payload.targetActorId as string | undefined;
        if (!target || !conversationId) return;
        await this.realtime.toUsers([target], type, payload as never);
        await this.notifyMention(conversationId, payload);
        return;
      }

      /**
       * PD-35 B5: an escalation case opened, assigned or due tomorrow. No
       * conversation: to the people it is for, by actor room (a signal) and the
       * PD-34 pipeline (a 'task' entry and a generic push). See deliverCase.
       */
      case CommEvent.CASE_OPENED:
      case CommEvent.CASE_ASSIGNED:
      case CommEvent.CASE_DUE_SOON: {
        await this.deliverCase(type, payload);
        return;
      }

      /** PD-36: a summons answered or closed -- Group Info re-reads; so does the target's list. */
      case CommEvent.MENTION_UPDATED: {
        const target = payload.targetActorId as string | undefined;
        if (!conversationId) return;
        await this.realtime.toThread(conversationId, type, payload as never);
        if (target) await this.realtime.toUsers([target], type, payload as never);
        return;
      }

      case CommEvent.MESSAGE_UPDATED: {
        if (!conversationId) return;
        // An edited internal note is announced to staff only, like its creation.
        if (payload.visibility === Visibility.INTERNAL) {
          await this.realtime.toUsers(await this.staffMemberIds(conversationId), type, payload as never);
        } else {
          await this.realtime.toThread(conversationId, type, payload as never);
        }
        return;
      }

      case CommEvent.MEMBERSHIP_CHANGED: {
        if (!conversationId) return;
        // Existing members watching the thread, exactly as before.
        await this.realtime.toThread(conversationId, type, payload as never);
        // And the people just added, who are not in that room yet. Their copy
        // names the conversation only: who else joined is theirs to read from
        // the conversation itself, through the authorized REST path.
        const added = Array.isArray(payload.added)
          ? (payload.added as unknown[]).filter((id): id is string => typeof id === 'string')
          : [];
        if (added.length > 0) {
          await this.realtime.toUsers(added, CommEvent.CONVERSATION_ADDED, { conversationId });
        }
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

      // PD-34: a person's own Notification Center and read state, to their own
      // actor room and nobody else's -- never the conversation room.
      case CommEvent.INBOX_CHANGED: {
        const recipientId = payload.recipientId as string | undefined;
        if (recipientId) await this.realtime.toUsers([recipientId], type, payload as never);
        return;
      }

      case CommEvent.CONVERSATION_READ: {
        const actorId = payload.actorId as string | undefined;
        if (!actorId || !conversationId) return;
        // With the pipeline: withdraw the waiting push, read the entry, and tell
        // the reader's other devices (it emits conversation.read itself).
        if (this.pipeline) {
          const seq = typeof payload.lastReadSeq === 'string' ? BigInt(payload.lastReadSeq) : BigInt(0);
          await this.pipeline.conversationRead(conversationId, actorId, seq);
          return;
        }
        await this.realtime.toUsers([actorId], type, payload as never);
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

      /**
       * PD-37. A seated reader's cursor moved; tell each AUTHOR whose messages
       * it covers what their ticks are now. Never the room: the payload this
       * row carries names the reader, and the ticks are the author's alone.
       * An explicit case so it can never reach the thread fan-out below.
       */
      case CommEvent.RECEIPTS_ADVANCED: {
        if (!conversationId) return;
        const send = this.realtime.toThreadAudience?.bind(this.realtime);
        // Without an audience path the only fallback is the whole room, which
        // is the leak itself: fail, and let the row retry.
        if (!send) throw new Error('this realtime publisher cannot address part of a conversation');
        const byAuthor = await statusUpdatesByAuthor(
          this.prisma,
          conversationId,
          BigInt(payload.fromSeq as string),
          BigInt(payload.toSeq as string),
        );
        // ONE delivery for every author it covers: one pass of the RT-009
        // checks over the room, each author receiving only their own ticks
        // (perActor). The reader's own messages are not changed by their read.
        const perActor: Record<string, { conversationId: string; items: typeof byAuthor extends Map<string, infer I> ? I : never }> = {};
        for (const [authorId, items] of byAuthor) {
          if (authorId !== payload.actorId) perActor[authorId] = { conversationId, items };
        }
        const authors = Object.keys(perActor);
        if (authors.length === 0) return;
        await send(conversationId, CommEvent.MESSAGE_STATUS, { conversationId, items: [] }, { onlyActors: authors, perActor });
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
   * published to. It carries no story content: since 2026-10-17 a story has no
   * title, and the active `story_published` template (20261017120000) says only
   * that a new story is waiting. Never the body, never a media URL: a lock-screen
   * preview is not the place to spend a publication's privacy, and the client
   * refetches the feed (audience-checked) to render anything more.
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

  /**
   * The live staff members, plus (PD-33) the backup covering for any of them --
   * approvals and internal notes go to them; a covering backup decides
   * approvals and reads internal notes on the PD-8 `backup` basis. PD-35: a seat
   * is presence, never charge, so a member row a seat opened (or an effective
   * seat in a 1:1) is not one.
   */
  private async staffMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ actor_id: string }>>`
      SELECT cm.actor_id::text AS actor_id FROM chat.conversation_member cm
       WHERE cm.conversation_id = ${conversationId}::uuid AND cm.left_at IS NULL AND cm.actor_kind = 'staff'
         AND NOT EXISTS (SELECT 1 FROM chat.conversation_seat st WHERE st.member_id = cm.id AND st.left_at IS NULL)`;
    const ids = rows.map((r) => r.actor_id);
    const covers = await this.coversFor(ids);
    return [...new Set([...ids, ...covers.values()])];
  }

  /**
   * PD-33: for each of these staff members who is away under a live cover, the
   * backup covering for them (chat.live_covers -- the cover window AND a live
   * backup link, the same moment access ends).
   */
  private async coversFor(staffIds: readonly string[]): Promise<Map<string, string>> {
    if (staffIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ primary_id: string; backup_id: string }>>`
      SELECT primary_id::text AS primary_id, backup_id::text AS backup_id
        FROM chat.live_covers(now())
       WHERE primary_id = ANY(${[...staffIds]}::uuid[])`;
    return new Map(rows.map((r) => [r.primary_id, r.backup_id]));
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

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { organizationId: true, participants: { select: { actorId: true, actorKind: true } } },
    });
    if (!call) return [];

    // RT-031. A participant row is trusted for WHO, never for WHERE: an actor
    // whose own row is in another organization than the call (a forged or
    // stale row the database guard did not see) is not told about it.
    const actors = await this.identity.resolveActors(
      call.participants.map((p) => ({ actorId: p.actorId, actorKind: p.actorKind })),
    );
    const allowed: string[] = [];
    for (const p of call.participants) {
      const actor = actors.get(actorRefKey({ actorId: p.actorId, actorKind: p.actorKind }));
      if (actor && actor.organizationId === call.organizationId) {
        allowed.push(p.actorId);
      } else {
        this.log.error(`call ${callId}: a participant outside the call's organization was not delivered to`);
      }
    }
    return allowed;
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

    for (const participant of call.participants) {
      if (participant.actorId === call.initiatorId) continue;

      const recipient = await this.identity.resolveActor(participant.actorId);
      if (!recipient || !recipient.isActive) continue;
      // RT-031: never a push across a tenant boundary.
      if (recipient.organizationId !== call.organizationId) continue;

      await this.notifications.scheduleByRule(ruleKey, {
        // One notification per call per recipient, forever. A replayed outbox
        // row converges on the same key and therefore the same notification.
        dedupeKey: `${ruleKey}:${callId}:${participant.actorId}`,
        recipientId: participant.actorId,
        locale: recipient.locale,
        familyId: call.familyId,
        conversationId: call.conversationId,
        // Push privacy (owner decision 2026-10-14): no caller name is stored
        // or rendered -- the templates are generic.
        variables: {},
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


    for (const participant of call.participants) {
      if (participant.actorId === call.initiatorId) continue;
      // Answered it; it was not missed for them.
      if (participant.joinedAt !== null) continue;

      const recipient = await this.identity.resolveActor(participant.actorId);
      if (!recipient || !recipient.isActive) continue;
      if (recipient.organizationId !== call.organizationId) continue; // RT-031

      await this.notifications.scheduleByRule('missed_call', {
        // Keyed on the call, so re-running reconciliation -- or replaying the
        // outbox row -- can never produce a second missed-call notification.
        dedupeKey: `missed_call:${callId}:${participant.actorId}`,
        recipientId: participant.actorId,
        locale: recipient.locale,
        familyId: call.familyId,
        conversationId: call.conversationId,
        // Push privacy (owner decision 2026-10-14): no caller name is stored
        // or rendered -- the templates are generic.
        variables: {},
      });
    }
  }

  /** Fan out a push for a published customer-visible message. */
  private async notifyNewMessage(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (payload.visibility === Visibility.INTERNAL) return;
    // PD-33 / PD-35: an announcement line is seen, not pushed.
    if (payload.silent === true) return;

    const authorId = payload.authorId as string | null;
    // PD-35 seat rules and PD-33 cover substitution, in one place shared with
    // the pipeline's send-time check (message-audience.ts).
    const members = (await messageAudience(this.prisma, conversationId, authorId)).map((actorId) => ({ actorId }));
    // PD-36: someone mentioned in THIS message has the mention push (rule
    // `mention`, through a mute); the message itself still lists in their
    // Notification Center, but is not pushed a second time.
    const mentioned = new Set(
      (
        await this.prisma.messageMention.findMany({
          where: { messageId: payload.messageId as string },
          select: { targetActorId: true },
        })
      ).map((m) => m.targetActorId),
    );

    const state = await this.prisma.conversationParticipantState.findMany({
      where: { conversationId },
    });
    const mutedUntil = new Map(state.map((s) => [s.actorId, s.mutedUntil]));
    const now = new Date();

    // PD-34: the Notification Center entries and coalesced pushes, for the whole
    // audience at once (one batch of reads, not ~20 queries per member). A muted
    // chat still counts in the Center; it is only not pushed.
    if (this.pipeline) {
      await this.pipeline.messagePublishedMany({
        conversationId,
        messageId: payload.messageId as string,
        seq: typeof payload.seq === 'string' ? BigInt(payload.seq) : null,
        recipients: members.map((m) => {
          const muted = mutedUntil.get(m.actorId);
          return { actorId: m.actorId, muted: Boolean(muted && muted > now) || mentioned.has(m.actorId) };
        }),
        now,
      });
      return;
    }

    for (const m of members) {
      if (m.actorId === authorId || mentioned.has(m.actorId)) continue;
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
        // Push privacy (owner decision 2026-10-14): no sender name and no
        // preview are stored or rendered -- the template is generic.
        variables: {},
        scheduledAt: now,
      });
    }
  }

  /**
   * PD-36: the mention push. Lock-screen safe like every message push: no
   * name and no text -- "You were mentioned in a family group" (rule
   * `mention_group`) or "...in a conversation" (`mention`). It BREAKS THROUGH
   * the person's mute for this chat (owner decision 2026-10-26); quiet hours
   * still hold (the rule's respect_quiet_hours). A mention the author took back
   * before this ran (edited or deleted away) sends nothing.
   */
  /**
   * PD-35 B5. Who a case event is for, read LIVE from the case (an owner who no
   * longer fits it -- chat.case_owner_fits -- is not told; B5 R2):
   *
   *   case.opened    told: the owner and the target department's manager
   *   case.assigned  told: the new owner. Signalled: also the previous owner
   *                  and the manager, whose lists change
   *   case.due_soon  told: the owner, or the manager when there is none; never
   *                  for a closed case
   *
   * Never told: the person who did it. "Told" is a PD-34 entry (category 'task',
   * action open_case) with a generic push; every recipient's actor room gets
   * the event itself, ids only, so Escalations refreshes.
   */
  private async deliverCase(type: CommEventName, payload: Record<string, unknown>): Promise<void> {
    const caseId = payload.caseId as string | undefined;
    if (!caseId) return;
    const [c] = await this.prisma.$queryRaw<Array<{ status: string; owner_id: string | null; owner_fits: boolean; manager_id: string | null }>>`
      SELECT c.status, c.owner_id::text AS owner_id, d.manager_id::text AS manager_id,
             (c.owner_id IS NOT NULL AND chat.case_owner_fits(c.owner_id, c.target_department_id, c.teacher_id, c.learner_id)) AS owner_fits
        FROM chat.supervision_case c JOIN chat.department d ON d.id = c.target_department_id
       WHERE c.id = ${caseId}::uuid`;
    if (!c) return;
    const owner = c.owner_fits ? c.owner_id : null;
    const by = (payload.openedBy ?? payload.assignedBy ?? null) as string | null;
    const without = (ids: Array<string | null>) => [...new Set(ids.filter((x): x is string => !!x && x !== by))];

    let told: string[];
    let signalled: string[];
    let dedupe: (recipient: string) => string;
    let ruleKey: 'case_opened' | 'case_assigned' | 'case_due_soon';
    if (type === CommEvent.CASE_OPENED) {
      ruleKey = 'case_opened';
      told = without([owner, c.manager_id]);
      signalled = told;
      dedupe = (r) => `case_opened:${caseId}:${r}`;
    } else if (type === CommEvent.CASE_ASSIGNED) {
      ruleKey = 'case_assigned';
      // The owner the event named -- unless the case has since moved on.
      const named = payload.ownerId as string | null;
      told = named && named === owner ? without([named]) : [];
      // Every list that changed, the assigner's included (they may be the previous owner).
      signalled = [...new Set([owner, payload.previousOwnerId as string | null, c.manager_id].filter((x): x is string => !!x))];
      dedupe = (r) => `case_assigned:${caseId}:${r}:${String(payload.assignedAt ?? '')}`;
    } else {
      if (c.status === 'resolved' || c.status === 'cancelled') return;
      ruleKey = 'case_due_soon';
      told = without([owner ?? c.manager_id]);
      signalled = told;
      dedupe = (r) => `case_due_soon:${caseId}:${String(payload.dueOn ?? '')}:${r}`;
    }

    if (signalled.length > 0) await this.realtime.toUsers(signalled, type, payload as never);
    if (!this.pipeline) return;
    for (const recipientId of told) {
      const recipient = await this.identity.resolveActor(recipientId);
      if (!recipient || !recipient.isActive || recipient.kind !== ActorKind.STAFF) continue;
      await this.pipeline.emit({
        dedupeKey: dedupe(recipientId),
        ruleKey,
        eventType: ruleKey,
        templateKey: ruleKey,
        recipientId,
        locale: recipient.locale,
        priority: 'normal',
        subject: { type: 'supervision_case', id: caseId },
        refs: { caseId },
        scheduledAt: new Date(),
      });
    }
  }

  private async notifyMention(conversationId: string, payload: Record<string, unknown>): Promise<void> {
    const mentionId = payload.mentionId as string;
    const target = payload.targetActorId as string;
    const row = await this.prisma.messageMention.findUnique({ where: { id: mentionId }, select: { state: true } });
    if (!row || row.state === 'removed') return;
    const recipient = await this.identity.resolveActor(target);
    if (!recipient || !recipient.isActive) return;
    const ruleKey = mentionRuleFor(String(payload.conversationType ?? ''));
    // One per message per person: a role and a name reaching the same person are one ping.
    const dedupeKey = `mention:${payload.messageId as string}:${target}`;
    // PD-34 amendment (owner 2026-10-27): with the pipeline, a mention takes the
    // chat quiet hours (the person's own, else the chat default), never the cap.
    if (this.pipeline) {
      // Who mentioned them, by name, for the Center (behind sign-in) -- the push stays generic.
      const by = typeof payload.mentionedBy === 'string' ? (await this.identity.resolveActor(payload.mentionedBy))?.displayName ?? null : null;
      await this.pipeline.mentionPublished({
        ruleKey, recipientId: target, dedupeKey, locale: recipient.locale, conversationId,
        messageId: payload.messageId as string, mentionId, by,
      });
      return;
    }
    await this.notifications.scheduleByRule(ruleKey, {
      recipientId: target,
      dedupeKey,
      locale: recipient.locale,
      conversationId,
      variables: {},
    });
  }
}
