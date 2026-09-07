import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService, CallIntent } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { Permission } from '../../platform/rbac/permissions';
import { AUDIT_SERVICE, IDENTITY_SERVICE, MEDIA_TOKEN_ISSUER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import type { MediaTokenIssuer } from './media-token';
import { Actor } from '../../platform/types';
import { ConversationService } from '../conversations/conversation.service';
import { OutboxService } from '../outbox/outbox.service';
import { ReminderService } from '../notifications/reminder.service';
import { RecordingService } from './recording.service';
import { CommEvent } from '../contracts/events';
import {
  ActorKind,
  CallMode,
  CallOutcome,
  CallParticipantState,
  CallStatus,
  CallType,
  ConversationType,
  MessageType,
  Origin,
  Visibility,
} from '../contracts/vocab';
import { CallAction, applyCallAction, type CallSnapshot } from './call-state';

export interface StartCallOptions {
  /**
   * NORMAL (the default) or FOLLOW_UP. Asking for FOLLOW_UP requires
   * `calls.record`; it is checked here and never inferred from anything the
   * client says about itself.
   */
  mode?: string;
  /** CLASS turns this into a class call. Requires a group conversation. */
  type?: string;
}

export interface CallView {
  id: string;
  conversationId: string;
  type: string;
  mode: string;
  status: string;
  outcome: string | null;
  initiatorId: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  ringExpiresAt: string | null;
  durationSeconds: number | null;
  /**
   * Whether a recording exists.
   *
   * FALSE for anyone without `recordings.read` in scope -- not omitted, and not
   * "unknown". A field that appears only for authorized readers is itself a
   * signal: watching which calls grow the field tells an unauthorized reader
   * exactly which calls were recorded, which is the fact being protected.
   */
  hasRecording: boolean;
  participants: Array<{
    actorId: string;
    actorKind: string;
    state: string;
    joinedAt: string | null;
    leftAt: string | null;
  }>;
}

/**
 * Calling.
 *
 * Calls use the SAME AuthorizationService as messaging, deliberately: a rule
 * can never be enforced for chat and forgotten for calls. BR-1 therefore holds
 * for calling by construction, and is additionally enforced by a database
 * trigger on chat.call_participant.
 *
 * ## Phase 5: the lifecycle became server-authoritative
 *
 * Every transition now goes through the pure machine in call-state.ts and is
 * written with a CONDITIONAL update that names the state it expects. Before
 * Phase 5 the transitions were unguarded, which meant:
 *
 *   * accepting a declined, missed or ended call succeeded and resurrected it;
 *   * a retried `end` rewrote the outcome and duration of a call that finished
 *     days earlier -- a client's retry is a writer, and nothing said no;
 *   * MISSED was unreachable, because nothing consulted the clock. A call to an
 *     offline recipient rang in the database for ever.
 *
 * The conditional update matters as much as the machine. Reading the state,
 * deciding, and then writing is a check-then-act race: two devices accepting at
 * once both read RINGING and both write. `updateMany({ where: { status } })`
 * makes the decision and the write one atomic step, and a count of zero means
 * somebody else got there first -- which is re-evaluated rather than assumed to
 * be an error.
 */
@Injectable()
export class CallService {
  private readonly log = new Logger(CallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly conversations: ConversationService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfigService,
    private readonly reminders: ReminderService,
    /**
     * Optional, and injected rather than imported for one reason: RecordingService
     * already depends on ConversationService, and making the dependency mandatory
     * in both directions would be a cycle. A call can always end; stopping a
     * recorder it may not have is best-effort.
     */
    private readonly recordings: RecordingService | undefined,
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
  async start(
    conversationId: string,
    initiatorId: string,
    options: StartCallOptions = {},
  ): Promise<{ callId: string; roomName: string; expiresAt: string; mode: string; type: string }> {
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
      await this.conversations.scopeFor(initiator, conv, now),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const isGroup =
      conv.type === ConversationType.STUDENT_GROUP || conv.type === ConversationType.CLASS_GROUP;

    const type = this.resolveType(options.type, isGroup);
    const mode = await this.resolveMode(initiator, options.mode);

    // Unguessable and server-owned.
    const roomName = `jawwid-${conv.id}-${randomUUID()}`;
    const ringSeconds = await this.config.get('call.ring_timeout_seconds');
    const ringExpiresAt = new Date(now.getTime() + ringSeconds * 1000);

    const callId = await this.prisma.$transaction(async (tx) => {
      // Created in the machine's entry state, then moved to RINGING once the
      // invitees and the invitation event exist. Both happen in this
      // transaction, so `initiated` is never observable -- it is a declared
      // entry point rather than a window.
      const call = await tx.call.create({
        data: {
          conversationId: conv.id,
          familyId: conv.familyId,
          initiatorId: initiator.actorId,
          type,
          mode,
          roomName,
          status: CallStatus.INITIATED,
          ringExpiresAt,
        },
      });

      await tx.callParticipant.createMany({
        data: participantActors.map((a) => ({
          callId: call.id,
          actorId: a.actorId,
          actorKind: a.kind,
          state: CallParticipantState.INVITED,
        })),
      });

      await tx.call.update({
        where: { id: call.id },
        data: { status: CallStatus.RINGING },
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
        payload: { callId: call.id, conversationId: conv.id, type, mode },
      });

      // A recordable call is a decision worth an AUDIT entry, not just an
      // event: it changes what happens to somebody's voice.
      if (mode === CallMode.FOLLOW_UP) {
        await this.audit.audit(tx, {
          actorId: initiator.actorId,
          action: 'call.follow_up_started',
          entity: 'call',
          entityId: call.id,
          after: { mode, conversationId: conv.id },
          reason: 'follow-up call started; this call may be recorded',
        });
      }

      return call.id;
    });

    return { callId, roomName, expiresAt: ringExpiresAt.toISOString(), mode, type };
  }

  /**
   * A teacher opens the class.
   *
   *     Teacher starts class call
   *             ↓
   *     Students / family recipients receive a class-call invitation
   *             ↓
   *     "Teacher is waiting. Please join the class."
   *             ↓
   *     Recipient joins
   *
   * The sentence itself is NOT here. It lives in chat.notification_template in
   * Arabic and English (20260907150000) and is rendered per recipient, in their
   * own locale, at delivery. A literal in this file would freeze the academy's
   * primary language out of its own product.
   *
   * Authorization is the ordinary call authorization -- there is no separate
   * class-call permission model to keep in step. What is additional is the
   * shape: a class call only exists in a group conversation.
   */
  async startClassCall(
    conversationId: string,
    initiatorId: string,
  ): Promise<{ callId: string; roomName: string; expiresAt: string }> {
    const conv = await this.conversations.requireConversation(conversationId);
    if (
      conv.type !== ConversationType.STUDENT_GROUP &&
      conv.type !== ConversationType.CLASS_GROUP
    ) {
      throw new CommError(
        CommErrorCode.CLASS_CALL_REQUIRES_GROUP,
        'a class call may only be started in a student or class group',
        400,
      );
    }

    const started = await this.start(conversationId, initiatorId, { type: CallType.CLASS });
    const initiator = await this.conversations.requireActor(initiatorId);
    const groupName = conv.title ?? 'Jawwid';

    const participants = await this.prisma.callParticipant.findMany({
      where: { callId: started.callId },
      select: { actorId: true, actorKind: true },
    });

    const recipients: Array<{ actorId: string; locale: string; role: string }> = [];
    for (const p of participants) {
      if (p.actorId === initiator.actorId) continue;
      const a = await this.identity.resolveActor(p.actorId);
      if (a && a.isActive) {
        recipients.push({ actorId: a.actorId, locale: a.locale, role: 'participant' });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // The invitation lands in the thread as well as on the lock screen, so
      // the class is in the conversation history even if every push fails.
      await this.systemMessage(tx, conv.id, 'class_call_started', {
        callId: started.callId,
        teacherName: initiator.displayName,
        groupName,
      });

      await this.outbox.enqueue(tx, CommEvent.CLASS_CALL_STARTED, {
        callId: started.callId,
        conversationId: conv.id,
        type: CallType.CLASS,
        initiatorId: initiator.actorId,
        initiatorName: initiator.displayName,
        roomName: started.roomName,
        groupName,
        teacherName: initiator.displayName,
        expiresAt: started.expiresAt,
      });
    });

    // The reminder SCHEDULE is data (chat.notification_rule, event type
    // 'class_call_started'), so "remind after a minute, then after three" is a
    // row rather than a constant. Every instance is keyed
    // (rule, callId, recipient), which is what makes the whole thing idempotent:
    // running this twice converges on the same notifications, not on twice as
    // many.
    await this.reminders.scheduleForEvent('class_call_started', {
      subjectId: started.callId,
      anchorAt: new Date(),
      recipients,
      familyId: conv.familyId,
      conversationId: conv.id,
      variables: { teacher_name: initiator.displayName, group_name: groupName },
    });

    return started;
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
    // A token minted after the invitation lapsed would let somebody join a call
    // the recipient has already been told they missed.
    if (call.ringExpiresAt && call.status === CallStatus.RINGING && call.ringExpiresAt <= now) {
      throw new CommError(
        CommErrorCode.CALL_EXPIRED,
        'the invitation window for this call has closed',
        409,
      );
    }

    const participant = call.participants.find((p) => p.actorId === actor.actorId);
    if (!participant) {
      throw new CommError(
        CommErrorCode.CALL_NOT_A_PARTICIPANT,
        'actor is not a participant of this call',
      );
    }
    // Somebody who already refused this call does not get a key to the room.
    if (participant.state === CallParticipantState.DECLINED) {
      throw new CommError(
        CommErrorCode.CALL_INVALID_TRANSITION,
        'this actor declined the call',
        409,
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
      await this.conversations.scopeFor(actor, conv, now),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    const ttl = await this.tokenTtlSeconds();
    const issued = await this.media.issue({
      roomName: call.roomName,
      identity: actor.actorId,
      name: actor.displayName,
      canPublish: !membership?.isSilent,
      ttlSeconds: ttl,
    });

    return { ...issued, roomName: call.roomName };
  }

  /**
   * Answer.
   *
   * Idempotent for a repeat of the SAME intent (a retried request, a second
   * device) and refused for an impossible one (a call that was declined,
   * missed, cancelled or ended). Those are different answers because they mean
   * different things to the person holding the phone.
   */
  async accept(callId: string, actorId: string): Promise<CallView> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);

    const transition = applyCallAction(snapshot(call), CallAction.ACCEPT);
    if (transition.kind === 'refused') {
      throw new CommError(CommErrorCode.CALL_INVALID_TRANSITION, transition.reason, 409);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.callParticipant.updateMany({
        where: { callId, actorId: actor.actorId },
        data: { state: CallParticipantState.JOINED, joinedAt: now, leftAt: null },
      });

      if (transition.kind === 'transition') {
        // CONDITIONAL on the state the decision was made against. Two devices
        // answering at once both reach here; exactly one update matches, and
        // the loser simply joins an already-active call.
        const moved = await tx.call.updateMany({
          where: { id: callId, status: CallStatus.RINGING },
          data: { status: CallStatus.ACTIVE, answeredAt: now },
        });
        if (moved.count === 0) {
          this.log.debug(`call ${callId} was already answered by another participant`);
        }
      }

      await this.outbox.enqueue(tx, CommEvent.CALL_ACCEPTED, {
        callId,
        actorId: actor.actorId,
      });
      await this.outbox.enqueue(tx, CommEvent.CALL_PARTICIPANT_JOINED, {
        callId,
        actorId: actor.actorId,
      });
    });

    // Joining is the answer to "the teacher is waiting", so the reminders stop
    // -- for THIS person only. Cancelling the whole subject would silence the
    // other students who have not joined yet, which is the opposite of what a
    // class-call reminder is for.
    await this.reminders.cancelForSubjectRecipient(callId, actor.actorId);

    return this.view(callId, actor);
  }

  /**
   * Refuse.
   *
   * A refusal is recorded on the PARTICIPANT. Whether it also ends the call is
   * the machine's decision, and depends on whether anybody else can still
   * answer -- one student declining a class call does not close the class.
   */
  async decline(callId: string, actorId: string): Promise<CallView> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);

    // The INITIATOR is excluded as well as the decliner. The caller is not an
    // invitee who might still answer -- they are the one ringing out -- and
    // counting them as "pending" left a declined 1:1 call ringing for ever,
    // waiting for the caller to answer their own call.
    const tally = tallyExcluding(call, actor.actorId, call.initiatorId);
    const transition = applyCallAction(snapshot(call), CallAction.DECLINE, tally);
    if (transition.kind === 'refused') {
      throw new CommError(CommErrorCode.CALL_INVALID_TRANSITION, transition.reason, 409);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Declining twice writes the same row twice, which is the same row.
      await tx.callParticipant.updateMany({
        where: {
          callId,
          actorId: actor.actorId,
          state: { in: [CallParticipantState.INVITED, CallParticipantState.LEFT] },
        },
        data: { state: CallParticipantState.DECLINED, declinedAt: now, leftAt: now },
      });

      if (transition.kind === 'transition') {
        await this.endCall(tx, call, transition.outcome ?? CallOutcome.DECLINED, actor.actorId, now);
      }

      await this.outbox.enqueue(tx, CommEvent.CALL_DECLINED, { callId, actorId: actor.actorId });
    });

    await this.reminders.cancelForSubjectRecipient(callId, actor.actorId);
    return this.view(callId, actor);
  }

  /**
   * The caller hangs up before anybody answers.
   *
   * A separate verb from `end` because it is a separate fact: the recipient did
   * not fail to pick up, the caller changed their mind. Recording it as MISSED
   * -- which is what happened before Phase 5 -- blames the wrong party in
   * somebody's call history.
   */
  async cancel(callId: string, actorId: string): Promise<CallView> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);

    if (call.initiatorId !== actor.actorId) {
      throw new CommError(
        CommErrorCode.CALL_NOT_INITIATOR,
        'only the actor who started a call may cancel it',
      );
    }

    const transition = applyCallAction(snapshot(call), CallAction.CANCEL);
    if (transition.kind === 'refused') {
      throw new CommError(CommErrorCode.CALL_INVALID_TRANSITION, transition.reason, 409);
    }
    if (transition.kind === 'transition') {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await this.endCall(tx, call, transition.outcome ?? CallOutcome.CANCELLED, actor.actorId, now);
      });
      await this.reminders.cancelForSubject(callId);
    }
    return this.view(callId, actor);
  }

  /**
   * Hang up.
   *
   * `end` on an already-ended call is a NO-OP that returns the call as it
   * stands. It used to rewrite `ended_at`, `outcome` and `duration_seconds`, so
   * a client retrying a request whose response it never saw silently corrupted
   * the record of a finished call.
   */
  async end(callId: string, actorId: string, outcome?: string): Promise<CallView> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);

    const transition = applyCallAction(snapshot(call), CallAction.END);
    if (transition.kind === 'refused') {
      throw new CommError(CommErrorCode.CALL_INVALID_TRANSITION, transition.reason, 409);
    }
    if (transition.kind === 'noop') return this.view(callId, actor);

    // A client may narrow the outcome, never widen it: it can say the call
    // FAILED where the machine assumed it was answered, because only the client
    // knows the media layer broke. It cannot claim a call was answered.
    const resolved =
      outcome === CallOutcome.FAILED ? CallOutcome.FAILED : (transition.outcome ?? CallOutcome.ANSWERED);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.endCall(tx, call, resolved, actor.actorId, now);
    });
    await this.reminders.cancelForSubject(callId);
    return this.view(callId, actor);
  }

  /**
   * The one place a call is written into its terminal state.
   *
   * Guarded on the status the caller decided against, so the sweeper, the
   * caller hanging up and the last invitee declining can all race and exactly
   * one of them writes. The others find `count === 0` and stop -- which is why
   * every terminal path in this service is safe to run twice.
   */
  private async endCall(
    tx: Prisma.TransactionClient,
    call: {
      id: string;
      status: string;
      conversationId: string;
      familyId: string | null;
      answeredAt: Date | null;
      initiatorId: string;
    },
    outcome: string,
    endedBy: string | null,
    now: Date,
  ): Promise<boolean> {
    const duration = call.answeredAt
      ? Math.max(0, Math.round((now.getTime() - call.answeredAt.getTime()) / 1000))
      : 0;

    const written = await tx.call.updateMany({
      where: { id: call.id, status: { in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ACTIVE] } },
      data: {
        status: CallStatus.ENDED,
        endedAt: now,
        outcome,
        durationSeconds: duration,
        endedBy,
      },
    });
    if (written.count === 0) return false;

    // Everyone who never answered is MISSED; everyone who was in the call has
    // LEFT. Two updates rather than one, because they are two different facts
    // and collapsing them is what made the old data unreadable.
    //
    // The INITIATOR is excluded from MISSED. They did not miss this call --
    // they made it -- and recording it otherwise would put an outgoing call in
    // the caller's own missed-call list, and send them a push about it.
    await tx.callParticipant.updateMany({
      where: {
        callId: call.id,
        state: CallParticipantState.INVITED,
        actorId: { not: call.initiatorId },
      },
      data: { state: CallParticipantState.MISSED, leftAt: now },
    });
    await tx.callParticipant.updateMany({
      where: {
        callId: call.id,
        state: CallParticipantState.INVITED,
        actorId: call.initiatorId,
      },
      data: { state: CallParticipantState.LEFT, leftAt: now },
    });
    await tx.callParticipant.updateMany({
      where: { callId: call.id, state: CallParticipantState.JOINED },
      data: { state: CallParticipantState.LEFT, leftAt: now },
    });

    await this.outbox.enqueue(tx, CommEvent.CALL_ENDED, {
      callId: call.id,
      conversationId: call.conversationId,
      outcome,
      durationSeconds: duration,
    });

    await this.audit.event(tx, {
      familyId: call.familyId,
      actorKind: ActorKind.SYSTEM,
      actorId: endedBy,
      type: 'call_ended',
      payload: { callId: call.id, outcome, durationSeconds: duration },
    });

    // The recorder is told to stop AFTER the transaction commits, not inside
    // it: it is a network call to another service, and holding a lock on this
    // row across a third party's latency is how a hung recorder becomes a hung
    // call. Best-effort by design -- Egress also stops when the room empties,
    // so this is the prompt path rather than the only one, and a call must
    // never fail to end because the recorder is unreachable.
    if (this.recordings) {
      const stop = this.recordings.stopForCall(call.id);
      void stop.catch(() => {
        this.log.warn(`could not stop the recorder for call ${call.id}`);
      });
    }

    return true;
  }

  /**
   * Expire calls nobody answered. Called by the sweeper, never by a client.
   *
   * ## Why this cannot be the client's job
   *
   * "The phone stopped ringing" is not an event the server observes. The
   * recipient may be offline, their app may have been killed, the push may have
   * been dropped, and the CALLER may have lost the network too -- and in every
   * one of those cases the call still has to become a missed call, in history,
   * for both people. Leaving it to a client means a call rings for ever
   * whenever the client is the thing that failed, which is precisely when it
   * matters.
   *
   * ## Why running it twice is safe
   *
   * The claim is one conditional UPDATE per call, guarded on the call still
   * being unanswered. Two sweepers, or one sweeper restarted mid-batch, race on
   * that update; one wins and the rest write nothing. There is no lease to
   * leak, because there is nothing in flight -- the transition IS the work.
   */
  async expireRingingCalls(now: Date = new Date()): Promise<number> {
    const batch = await this.config.get('call.missed_sweep_batch');

    const due = await this.prisma.call.findMany({
      where: {
        status: { in: [CallStatus.INITIATED, CallStatus.RINGING] },
        ringExpiresAt: { not: null, lte: now },
      },
      include: { participants: true },
      orderBy: { ringExpiresAt: 'asc' },
      take: typeof batch === 'number' ? batch : 200,
    });

    let expired = 0;
    for (const call of due) {
      const transition = applyCallAction(snapshot(call), CallAction.TIMEOUT);
      if (transition.kind !== 'transition') continue;

      try {
        const won = await this.prisma.$transaction(async (tx) => {
          const ended = await this.endCall(
            tx,
            call,
            transition.outcome ?? CallOutcome.MISSED,
            null,
            now,
          );
          if (!ended) return false;

          const initiator = await this.identity.resolveActor(call.initiatorId);
          await this.outbox.enqueue(tx, CommEvent.CALL_MISSED, {
            callId: call.id,
            conversationId: call.conversationId,
            outcome: CallOutcome.MISSED,
            initiatorId: call.initiatorId,
            initiatorName: initiator?.displayName ?? 'Jawwid',
          });
          return true;
        });

        if (won) {
          expired += 1;
          // The class is over; nobody is still waiting to be reminded.
          await this.reminders.cancelForSubject(call.id);
        }
      } catch (err) {
        // One wedged call must not stop the sweep: the next call in the batch
        // is somebody else's missed call.
        this.log.warn(
          `missed-call sweep could not expire ${call.id}: ` +
            (err instanceof Error ? err.message : 'unknown'),
        );
      }
    }
    return expired;
  }

  /** Call history. Scoped to conversations the actor may read. */
  async history(conversationId: string, actorId: string): Promise<CallView[]> {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);
    const readable = this.authz.canRead(
      actor,
      conv,
      membership,
      await this.conversations.scopeFor(actor, conv),
    );
    if (!readable.allowed) throw new CommError(readable.code, readable.reason);

    const calls = await this.prisma.call.findMany({
      where: { conversationId },
      include: { participants: true, recording: true },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });

    // Whether the reader may even KNOW a recording exists. Resolved once for
    // the page, not per row.
    const maySeeRecordings = this.authz.can(actor, Permission.RECORDINGS_READ).allowed;

    // Explicit field mapping: no phone number exists here and none can appear.
    return calls.map((c) => this.toView(c, maySeeRecordings));
  }

  /** One call, for the client that just acted on it. */
  async get(callId: string, actorId: string): Promise<CallView> {
    const actor = await this.conversations.requireActor(actorId);
    return this.view(callId, actor);
  }

  private async view(callId: string, actor: Actor): Promise<CallView> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { participants: true, recording: true },
    });
    if (!call) throw new CommError(CommErrorCode.CALL_NOT_FOUND, 'call not found', 404);
    return this.toView(call, this.authz.can(actor, Permission.RECORDINGS_READ).allowed);
  }

  private toView(
    c: {
      id: string;
      conversationId: string;
      type: string;
      mode: string;
      status: string;
      outcome: string | null;
      initiatorId: string;
      startedAt: Date;
      answeredAt: Date | null;
      endedAt: Date | null;
      ringExpiresAt: Date | null;
      durationSeconds: number | null;
      recording?: { status: string } | null;
      participants: Array<{
        actorId: string;
        actorKind: string;
        state: string;
        joinedAt: Date | null;
        leftAt: Date | null;
      }>;
    },
    maySeeRecordings: boolean,
  ): CallView {
    return {
      id: c.id,
      conversationId: c.conversationId,
      type: c.type,
      mode: c.mode,
      status: c.status,
      outcome: c.outcome,
      initiatorId: c.initiatorId,
      startedAt: c.startedAt.toISOString(),
      answeredAt: c.answeredAt?.toISOString() ?? null,
      endedAt: c.endedAt?.toISOString() ?? null,
      ringExpiresAt: c.ringExpiresAt?.toISOString() ?? null,
      durationSeconds: c.durationSeconds,
      // A call-history row carrying a recording reference is NOT permission to
      // hear it, and it is not permission to know it exists either.
      hasRecording:
        maySeeRecordings && c.recording != null && c.recording.status === 'available',
      participants: c.participants.map((p) => ({
        actorId: p.actorId,
        actorKind: p.actorKind,
        state: p.state,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * How long a media token lives.
   *
   * ONE SOURCE: the `call.token_ttl_seconds` row in chat.config. That is this
   * system's rule for every threshold (Phase 2 report §36 -- "no number is
   * compiled into a service") and it can be changed without a deploy.
   *
   * ## Why there is no environment-variable fallback here
   *
   * The closure pass added one, and the acceptance audit proved it was
   * UNREACHABLE. `AppConfigService.get` returns the stored row when there is
   * one and its own compile-time default when there is not, so it always
   * yields a finite number -- and the fallback below it could never execute.
   * An operator setting LIVEKIT_TOKEN_TTL_SECONDS=999 still got 120.
   *
   * Deleting it rather than making it reachable is deliberate. Wiring the
   * variable in would give ONE threshold TWO sources of truth, which is the
   * thing the config table exists to prevent, and the precedence between them
   * would be invisible to whoever next changed either.
   *
   * `LIVEKIT_TOKEN_TTL_SECONDS` is therefore NOT read by this application, and
   * `infra/env/manifest.tsv` still marks it required. That divergence is real
   * and is recorded as a production-hardening item in the Phase 5 acceptance
   * report: the infrastructure owner should either seed the config row from it
   * at deploy time or drop it from the manifest. It is not fixed here, because
   * guessing at another domain's deployment contract is how the dead
   * configuration got written in the first place.
   */
  private async tokenTtlSeconds(): Promise<number> {
    return this.config.get('call.token_ttl_seconds');
  }

  private resolveType(requested: string | undefined, isGroup: boolean): string {
    if (requested === CallType.CLASS) {
      if (!isGroup) {
        throw new CommError(
          CommErrorCode.CLASS_CALL_REQUIRES_GROUP,
          'a class call may only be started in a student or class group',
          400,
        );
      }
      return CallType.CLASS;
    }
    return isGroup ? CallType.GROUP : CallType.DIRECT;
  }

  /**
   * Which mode this call runs in.
   *
   * NORMAL unless an actor holding `calls.record` explicitly asks otherwise.
   * The default direction matters: a bug that drops the option silently
   * produces an unrecorded call, never a recorded one.
   */
  private async resolveMode(actor: Actor, requested: string | undefined): Promise<string> {
    if (requested !== CallMode.FOLLOW_UP) return CallMode.NORMAL;
    const decision = this.authz.can(actor, Permission.CALLS_RECORD);
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);
    return CallMode.FOLLOW_UP;
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

  /**
   * A system message, written with the conversation row locked so `seq` cannot
   * be handed out twice.
   *
   * Duplicated from ConversationService's private helper rather than exported
   * from it: that file is owned by the messaging domain and Phase 5 has no
   * business widening its surface to reach one internal helper.
   */
  private async systemMessage(
    tx: Prisma.TransactionClient,
    conversationId: string,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ last_seq: bigint }>>`
      SELECT last_seq FROM chat.conversation WHERE id = ${conversationId}::uuid FOR UPDATE
    `;
    const seq = (locked[0]?.last_seq ?? BigInt(0)) + BigInt(1);

    await tx.message.create({
      data: {
        conversationId,
        authorType: ActorKind.SYSTEM,
        authorId: null,
        type: MessageType.SYSTEM,
        // A structured payload, not a sentence. The client renders it in the
        // reader's language; the server never picks one.
        body: JSON.stringify({ kind, ...payload }),
        visibility: Visibility.CUSTOMER,
        origin: Origin.AUTOMATION,
        seq,
        attachmentsJson: [],
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastSeq: seq, lastActivityAt: new Date() },
    });
  }
}

function snapshot(call: {
  status: string;
  outcome: string | null;
  answeredAt: Date | null;
}): CallSnapshot {
  return { status: call.status, outcome: call.outcome, answeredAt: call.answeredAt };
}

/**
 * How many invitees other than this one can still answer, and how many are in
 * the call.
 *
 * Two exclusions, both necessary. The actor doing the declining, because the
 * question the machine asks is "if THIS person refuses, can the call still
 * connect?". And the initiator, because they are the one ringing out and
 * cannot answer their own call.
 */
function tallyExcluding(
  call: { participants: Array<{ actorId: string; state: string }> },
  actorId: string,
  initiatorId: string,
): { pending: number; joined: number } {
  let pending = 0;
  let joined = 0;
  for (const p of call.participants) {
    if (p.actorId === actorId) continue;
    // The caller is not somebody who might pick up. Counting them as pending is
    // what left a declined 1:1 call ringing, waiting for its own caller.
    if (p.actorId !== initiatorId && p.state === CallParticipantState.INVITED) pending += 1;
    if (p.state === CallParticipantState.JOINED) joined += 1;
  }
  return { pending, joined };
}
