import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService, CallIntent } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE, MEDIA_TOKEN_ISSUER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import type { MediaTokenIssuer } from './media-token';
import { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { CommEvent } from '../contracts/events';
import { CallOutcome, CallStatus, CallType, ConversationType } from '../contracts/vocab';

/**
 * Calling.
 *
 * Calls use the SAME AuthorizationService as messaging, deliberately: a rule
 * can never be enforced for chat and forgotten for calls. BR-1 therefore holds
 * for calling by construction, and is additionally enforced by a database
 * trigger on chat.call_participant.
 *
 * No audio is recorded in MVP.
 */
@Injectable()
export class CallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IdentityService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    @Inject(MEDIA_TOKEN_ISSUER) private readonly media: MediaTokenIssuer,
  ) {}

  /**
   * Start a call in a conversation.
   *
   * The participant set is derived from conversation membership, never from the
   * client. The room name is minted here, so a client cannot name a room and
   * cannot join one it was not authorized into.
   */
  async start(conversationId: string, initiatorId: string): Promise<{ callId: string; roomName: string }> {
    const now = new Date();
    const initiator = await this.conversations.requireActor(initiatorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, initiator.actorId);

    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId: conv.id, leftAt: null },
    });

    const participantActors: Actor[] = [];
    for (const m of members) {
      const a = await this.identity.resolveActor(m.actorId);
      if (a && a.isActive && !m.isSilent) participantActors.push(a);
    }

    const family = conv.familyId
      ? await this.prisma.family.findUnique({
          where: { id: conv.familyId },
          select: { ownerId: true },
        })
      : null;

    const decision = await this.authz.canCall(
      initiator,
      conv,
      membership,
      participantActors,
      now,
      family?.ownerId ?? null,
      // C-4: the call path runs the same admin-presence check as the message
      // path. Calling is never more permissive than messaging.
      await this.conversations.liveMembersOf(conv.id),
      // PD-2: this is the START path. A parent is refused here and allowed on
      // the join path below.
      CallIntent.INITIATE,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const type =
      conv.type === ConversationType.STUDENT_GROUP || conv.type === ConversationType.CLASS_GROUP
        ? CallType.GROUP
        : CallType.DIRECT;

    // Unguessable and server-owned.
    const roomName = `jawwid-${conv.id}-${randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      const call = await tx.call.create({
        data: {
          conversationId: conv.id,
          familyId: conv.familyId,
          initiatorId: initiator.actorId,
          type,
          roomName,
          status: CallStatus.RINGING,
        },
      });

      await tx.callParticipant.createMany({
        data: participantActors.map((a) => ({
          callId: call.id,
          actorId: a.actorId,
          actorKind: a.kind,
        })),
      });

      await this.outbox.enqueue(tx, CommEvent.CALL_INCOMING, {
        callId: call.id,
        conversationId: conv.id,
        type,
        initiatorId: initiator.actorId,
        initiatorName: initiator.displayName,
        roomName,
      });

      await this.audit.event(tx, {
        familyId: conv.familyId,
        actorKind: initiator.kind,
        actorId: initiator.actorId,
        type: 'call_started',
        payload: { callId: call.id, conversationId: conv.id, type },
      });

      return { callId: call.id, roomName };
    });
  }

  /**
   * Issue a media token.
   *
   * Every one of these checks runs before a token exists: the actor is known,
   * the call is live, the actor is a recorded participant, they are still a
   * conversation member, and the communication matrix still permits the call.
   * The token is short-lived and scoped to the one room.
   */
  async issueToken(
    callId: string,
    actorId: string,
  ): Promise<{ token: string; url: string; roomName: string; expiresAt: string }> {
    const now = new Date();
    const actor = await this.conversations.requireActor(actorId);

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) throw new CommError(CommErrorCode.CALL_NOT_FOUND, 'call not found', 404);
    if (call.status === CallStatus.ENDED) {
      throw new CommError(CommErrorCode.CALL_ALREADY_ENDED, 'this call has ended', 409);
    }

    const participant = call.participants.find((p) => p.actorId === actor.actorId);
    if (!participant) {
      throw new CommError(
        CommErrorCode.CALL_NOT_A_PARTICIPANT,
        'actor is not a participant of this call',
      );
    }

    const conv = await this.conversations.requireConversation(call.conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const participantActors: Actor[] = [];
    for (const p of call.participants) {
      const a = await this.identity.resolveActor(p.actorId);
      if (a) participantActors.push(a);
    }

    const family = conv.familyId
      ? await this.prisma.family.findUnique({
          where: { id: conv.familyId },
          select: { ownerId: true },
        })
      : null;

    const decision = await this.authz.canCall(
      actor,
      conv,
      membership,
      participantActors,
      now,
      family?.ownerId ?? null,
      // C-4: the call path runs the same admin-presence check as the message
      // path. Calling is never more permissive than messaging.
      await this.conversations.liveMembersOf(conv.id),
      // PD-2: minting a media token is JOINING an existing call, which a parent
      // may do. The call was already started by a teacher or an admin.
      CallIntent.JOIN,
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const ttl = await this.config.get('call.token_ttl_seconds');
    const issued = await this.media.issue({
      roomName: call.roomName,
      identity: actor.actorId,
      name: actor.displayName,
      canPublish: !membership?.isSilent,
      ttlSeconds: ttl,
    });

    return { ...issued, roomName: call.roomName };
  }

  async accept(callId: string, actorId: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);

    await this.prisma.$transaction(async (tx) => {
      await tx.callParticipant.updateMany({
        where: { callId, actorId: actor.actorId },
        data: { joinedAt: new Date() },
      });
      if (call.status === CallStatus.RINGING) {
        await tx.call.update({
          where: { id: callId },
          data: { status: CallStatus.ACTIVE, answeredAt: new Date() },
        });
      }
      await this.outbox.enqueue(tx, CommEvent.CALL_PARTICIPANT_JOINED, {
        callId,
        actorId: actor.actorId,
      });
    });
  }

  async decline(callId: string, actorId: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    await this.requireLiveParticipant(callId, actor.actorId);

    await this.prisma.$transaction(async (tx) => {
      await tx.callParticipant.updateMany({
        where: { callId, actorId: actor.actorId },
        data: { leftAt: new Date() },
      });
      await this.outbox.enqueue(tx, CommEvent.CALL_DECLINED, { callId, actorId: actor.actorId });
    });
  }

  /** Ends the call and records its outcome. */
  async end(callId: string, actorId: string, outcome?: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);
    const now = new Date();

    const resolved =
      outcome ?? (call.answeredAt ? CallOutcome.ANSWERED : CallOutcome.MISSED);
    const duration = call.answeredAt
      ? Math.max(0, Math.round((now.getTime() - call.answeredAt.getTime()) / 1000))
      : 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.call.update({
        where: { id: callId },
        data: {
          status: CallStatus.ENDED,
          endedAt: now,
          outcome: resolved,
          durationSeconds: duration,
        },
      });
      await tx.callParticipant.updateMany({
        where: { callId, leftAt: null },
        data: { leftAt: now },
      });
      await this.outbox.enqueue(tx, CommEvent.CALL_ENDED, {
        callId,
        conversationId: call.conversationId,
        outcome: resolved,
        durationSeconds: duration,
      });
      await this.audit.event(tx, {
        familyId: call.familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'call_ended',
        payload: { callId, outcome: resolved, durationSeconds: duration },
      });
    });
  }

  /** Call history. Scoped to conversations the actor may read. */
  async history(conversationId: string, actorId: string) {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const readable = this.authz.canRead(actor, conv, membership);
    if (!readable.allowed) throw new CommError(readable.code, readable.reason);

    const calls = await this.prisma.call.findMany({
      where: { conversationId },
      include: { participants: true },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });

    // Explicit field mapping: no phone number exists here and none can appear.
    return calls.map((c) => ({
      id: c.id,
      conversationId: c.conversationId,
      type: c.type,
      status: c.status,
      outcome: c.outcome,
      initiatorId: c.initiatorId,
      startedAt: c.startedAt.toISOString(),
      endedAt: c.endedAt?.toISOString() ?? null,
      durationSeconds: c.durationSeconds,
      participants: c.participants.map((p) => ({
        actorId: p.actorId,
        actorKind: p.actorKind,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
    }));
  }

  private async requireLiveParticipant(callId: string, actorId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true },
    });
    if (!call) throw new CommError(CommErrorCode.CALL_NOT_FOUND, 'call not found', 404);
    if (!call.participants.some((p) => p.actorId === actorId)) {
      throw new CommError(
        CommErrorCode.CALL_NOT_A_PARTICIPANT,
        'actor is not a participant of this call',
      );
    }
    return call;
  }
}
