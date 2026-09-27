import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Conversation, ConversationMember } from '@prisma/client';
import { PrismaService } from '../../platform/prisma.service';
import { AuthorizationService, CallIntent } from '../../platform/authorization.service';
import type { Decision } from '../../platform/authorization.service';
import { AppConfigService } from '../../platform/app-config.service';
import { CommError, CommErrorCode } from '../../platform/errors';
import { AUDIT_SERVICE, IDENTITY_SERVICE, MEDIA_TOKEN_ISSUER } from '../../platform/tokens';
import type { IdentityService } from '../../platform/identity.service';
import type { AuditService } from '../../platform/audit.service';
import type { MediaTokenIssuer } from './media-token';
import { Actor, SYSTEM_ACTOR } from '../../platform/types';
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
  private readonly log = new Logger(CallService.name);

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

    const { decision, participantActors } = await this.decideInitiate(
      initiator,
      conv,
      membership,
      now,
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
        // roomName is NOT broadcast. It comes back from POST /calls/:id/token
        // with the token that makes it usable; see CallPayload.
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
   * MAY THIS ACTOR START A CALL HERE? The one place that question is answered.
   *
   * Extracted from start() so callCapability() can ask it without a second
   * implementation appearing beside it. Both callers resolve from the same
   * sources -- participants from conversation membership, the family owner from
   * the family, live members from the conversation, the PD-6 pairing from
   * RelationshipService -- and reach the same AuthorizationService.canCall.
   *
   * It RESOLVES and DECIDES; it does not act. What a denial means is the
   * caller's business, which is why start() throws and callCapability()
   * reports.
   */
  private async decideInitiate(
    initiator: Actor,
    conv: Conversation,
    membership: ConversationMember | null,
    now: Date,
  ): Promise<{ decision: Decision; participantActors: Actor[] }> {
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
      // the join path.
      CallIntent.INITIATE,
      // PD-6: the teacher<->parent relationship, resolved from the conversation
      // membership rather than from anything the caller sent.
      await this.conversations.pairingAuthorizedAmong(members),
    );

    return { decision, participantActors };
  }

  /**
   * Whether the caller could start a call here. ADVISORY, for the interface.
   *
   * WHY IT EXISTS. `screens/call.md` section 4 requires the call affordance to
   * render only where the backend authorizes the pairing, and to be ABSENT
   * rather than disabled otherwise -- "the client must never infer it". Since
   * PD-6 the set of authorized pairs is data, and the client cannot derive it:
   * a teacher<->parent conversation existing proves the relationship held when
   * it was CREATED, not that it holds now. Revocation leaves the conversation
   * and denies the call, which is precisely the case an inferred answer gets
   * wrong.
   *
   * IT IS NOT A GRANT. `true` is what the policy says at this instant, and the
   * instant passes -- a relationship can be revoked between this answer and the
   * POST that follows it. start() decides again from scratch and remains the
   * only thing that authorizes a call. Nothing here is cached, for the same
   * reason.
   *
   * NOT AN ORACLE. Read access is established first, through the same canRead
   * the conversation read path uses, and a caller who fails it gets that path's
   * error rather than a capability answer. So this says nothing about a
   * conversation the caller could not already open.
   *
   * The code is a stable COMM.* value and nothing else: no learner, teacher,
   * contact, family or organization id, no relationship detail, no prose. A
   * denial says which rule refused, never who or why.
   */
  async callCapability(
    conversationId: string,
    actorId: string,
  ): Promise<{ canCall: boolean; code: string | null }> {
    const actor = await this.conversations.requireActor(actorId);
    const conv = await this.conversations.requireConversation(conversationId);
    const membership = await this.conversations.membershipOf(conv.id, actor.actorId);

    const readable = this.authz.canRead(actor, conv, membership);
    if (!readable.allowed) throw new CommError(readable.code, readable.reason);

    const { decision } = await this.decideInitiate(actor, conv, membership, new Date());
    return decision.allowed
      ? { canCall: true, code: null }
      : { canCall: false, code: decision.code };
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
    const { call, membership, actor } = await this.authorizeJoin(callId, actorId);

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

  /**
   * Answer a call.
   *
   * AUTHORIZATION runs in full, through the same chain the media token uses --
   * see authorizeJoin(). Before this, accept checked only that the actor's id
   * appeared in call_participant.
   *
   * STATE is decided under a row lock, not from the read above. Two devices
   * answering at once, or an answer racing a decline or an end, must produce
   * one outcome and not a torn one. `SELECT ... FOR UPDATE` on the call row
   * serialises every accept/decline/end for that call, so the checks inside the
   * transaction are made against state nobody can change underneath them. A
   * check-then-update on a stale read is exactly how a call ends up ACTIVE after
   * it was ended.
   *
   * IDEMPOTENT. Answering twice is a retry, not an error: the second call finds
   * itself already joined and does nothing. `joined_at` is written once so the
   * history says when they actually answered, not when they last retried.
   *
   * A BOUNDED RACE, STATED RATHER THAN IMPLIED. Authorization happens before the
   * lock is taken, so a relationship revoked in that window can let an accept
   * through and move the call to ACTIVE. Call-state authorization and media
   * authorization are NOT one atomic transaction, and nothing here should be
   * read as claiming they are.
   *
   * What bounds it: `issueToken` re-resolves the relationship on every media
   * token, so the party whose relationship was revoked gets no audio — the call
   * shows as answered for as long as it takes them to fail to join, and then
   * ends. The exposure is a briefly wrong call record, never media access.
   *
   * Closing it completely would mean holding the relationship read inside the
   * same lock, which means doing identity and relationship resolution inside
   * the locked transaction and lengthening it for every call. That trade has
   * not been made deliberately yet, so it is documented rather than assumed
   * away.
   */
  async accept(callId: string, actorId: string): Promise<void> {
    const { actor, call } = await this.authorizeJoin(callId, actorId);

    await this.prisma.$transaction(async (tx) => {
      const { status } = await this.lockCall(tx, callId);
      if (status === CallStatus.ENDED) {
        throw new CommError(CommErrorCode.CALL_ALREADY_ENDED, 'this call has ended', 409);
      }

      // Re-read under the lock. The participant could have left, or every other
      // participant could have declined, between authorization and here.
      const participants = await tx.callParticipant.findMany({ where: { callId } });
      const mine = participants.find((p) => p.actorId === actor.actorId);
      if (!mine) {
        throw new CommError(
          CommErrorCode.CALL_NOT_A_PARTICIPANT,
          'actor is not a participant of this call',
        );
      }
      if (mine.leftAt !== null) {
        throw new CommError(
          CommErrorCode.CALL_PARTICIPANT_LEFT,
          'this participant has already left the call',
          409,
        );
      }

      // A call every other participant has left has been refused. Answering it
      // would record an answer nobody gave -- and for a direct call, the "other
      // participant" is the whole of the other side.
      //
      // A BACKSTOP SINCE W6, not the primary path. A decline now ends the call
      // itself, so the usual way to reach this state is refused above by the
      // terminal check. It stays because `left_at` is not written only by
      // decline: a direct row write, or a future "leave the call" operation that
      // does not end it, could still empty a ringing call, and answering such a
      // call must not be possible.
      const others = participants.filter((p) => p.actorId !== actor.actorId);
      if (others.length > 0 && others.every((p) => p.leftAt !== null)) {
        throw new CommError(
          CommErrorCode.CALL_ALREADY_DECLINED,
          'every other participant has left this call',
          409,
        );
      }

      if (mine.joinedAt !== null) return; // already answered; a retry, not a fault

      const now = new Date();
      await tx.callParticipant.updateMany({
        where: { callId, actorId: actor.actorId, leftAt: null, joinedAt: null },
        data: { joinedAt: now },
      });

      // RINGING -> ACTIVE happens once, for whoever answers first. A later
      // participant joining an already-active group call is not a transition.
      await tx.call.updateMany({
        where: { id: callId, status: CallStatus.RINGING },
        data: { status: CallStatus.ACTIVE, answeredAt: now },
      });

      // CALL_ACCEPTED, not CALL_PARTICIPANT_JOINED. This is an application-level
      // answer over HTTP; it says nothing about whether the device has reached
      // the media room. participant_joined means media presence and is emitted
      // only by something that has observed it -- a LiveKit webhook, which does
      // not exist yet. See contracts/events.ts.
      //
      // conversationId is what makes this event routable at all: without it the
      // outbox worker had nowhere to send it and dropped it, which is why the
      // caller never learned the call had been answered.
      await this.outbox.enqueue(tx, CommEvent.CALL_ACCEPTED, {
        callId,
        conversationId: call.conversationId,
        actorId: actor.actorId,
      });
    });
  }

  /**
   * Refuse a ringing call. THE CALL ENDS HERE -- W6's one deliberate lifecycle
   * correction, and the only behaviour change in this workstream.
   *
   * WHAT IT USED TO DO, MEASURED RATHER THAN ASSUMED. `decline` marked the
   * participant and left the CALL `ringing`. Nothing ended it, so the
   * ring-timeout sweep collected it seconds later and wrote
   * `outcome = 'missed'`:
   *
   *   decline()          -> {status: ringing, outcome: null}
   *   sweep, 45s later   -> {status: ended,   outcome: missed, duration: 0}
   *
   * Three things were wrong with that. History recorded a call the callee had
   * explicitly REFUSED as one they never saw. `notifyMissedCall` fires on that
   * outcome, so the sweep then pushed a "missed call" notification to the very
   * person who had just declined. And `declined` -- a value the schema defines
   * and the check constraint allows -- was unreachable from the decline
   * endpoint, leaving a vocabulary no code path could produce.
   *
   * WHAT IT DOES NOW
   *
   *   ringing --decline--> ended, outcome = 'declined', duration 0
   *
   * `answered_at` stays null and no `joined_at` is written: refusing is not
   * answering, and history must not be able to claim otherwise.
   *
   * UNCONDITIONAL, AND NOT QUALIFIED BY PARTICIPANT COUNT. A decline ends the
   * call, whoever declines and however many participants the call has. There is
   * no group-call exception here, deliberately: no product source defines one.
   * A W6 draft made the transition conditional on two participants remaining
   * live so that one parent's refusal would not end a Student Group call; that
   * was an inference, the product owner rejected it, and it is gone. If group
   * calls are to survive a refusal, that is a product decision with its own
   * authorization, and it will be a rule written here rather than one guessed.
   *
   * WHAT IT DOES NOT WRITE: a `left_at` for anybody but the decliner. A
   * participant who was still ringing did not leave, and a call becoming
   * terminal is not evidence that they did. `end()` and the ring-timeout sweep
   * stamp every open participant -- that is their existing, documented rule and
   * it is untouched -- but this path does not adopt it, because inventing a
   * departure for somebody who never departed would put a fact in the
   * participant lifecycle that nothing observed. An ended call may therefore
   * carry a participant whose `left_at` is null; terminal state is read from
   * `call.status`, which is what every guard already checks.
   *
   * THE SWEEP CAN NO LONGER TOUCH A DECLINED CALL, and needed no change to stop
   * it: `expireRingingCalls` matches `status = 'ringing'` and a declined call is
   * `ended`. Both orderings are safe because this holds the row lock -- a sweep
   * running concurrently either skips the locked row (`skip locked`) or claims it
   * first, in which case `lockCall` below reads `ended` and this refuses.
   * Exactly one terminal outcome, never two, and never a `missed` written over a
   * `declined`.
   *
   * Same authorization chain as accept: knowing a call id is not permission to
   * decline somebody's call, and a revoked relationship cannot act on it either.
   *
   * Only a RINGING call can be declined. Leaving a call already in progress is
   * `end`, and declining an ended one is refused -- allowing it would write a
   * leave time onto a finished call and make its history wrong.
   */
  async decline(callId: string, actorId: string): Promise<void> {
    const { actor, call } = await this.authorizeJoin(callId, actorId);

    await this.prisma.$transaction(async (tx) => {
      const { status } = await this.lockCall(tx, callId);
      if (status === CallStatus.ENDED) {
        throw new CommError(CommErrorCode.CALL_ALREADY_ENDED, 'this call has ended', 409);
      }
      if (status !== CallStatus.RINGING) {
        throw new CommError(
          CommErrorCode.CALL_NOT_RINGING,
          'this call is no longer ringing and cannot be declined',
          409,
        );
      }

      // Every participant, read under the lock: the decision below is about who
      // is still live, and a stale read of that is how a group call gets hung up
      // on the people still ringing.
      const participants = await tx.callParticipant.findMany({ where: { callId } });
      const mine = participants.find((p) => p.actorId === actor.actorId);
      if (!mine) {
        throw new CommError(
          CommErrorCode.CALL_NOT_A_PARTICIPANT,
          'actor is not a participant of this call',
        );
      }
      // Reachable only in a race: two declines both pass authorizeJoin with
      // left_at null, one wins the lock and writes it, and the loser sees the
      // committed value here. A sequential second decline never reaches this
      // line -- the call is terminal by then and authorizeJoin refuses it with
      // CALL_ALREADY_ENDED. Either way the second decline changes nothing and
      // announces nothing.
      if (mine.leftAt !== null) return;

      const now = new Date();
      await tx.callParticipant.updateMany({
        where: { callId, actorId: actor.actorId, leftAt: null },
        data: { leftAt: now },
      });

      await this.outbox.enqueue(tx, CommEvent.CALL_DECLINED, {
        callId,
        conversationId: call.conversationId,
        actorId: actor.actorId,
      });

      // TERMINAL, in the same transaction as the refusal. The conditional
      // `status: RINGING` is belt-and-braces under a lock we already hold: it
      // means a concurrent transition could not be overwritten even if the lock
      // were removed.
      await tx.call.updateMany({
        where: { id: callId, status: CallStatus.RINGING },
        data: {
          status: CallStatus.ENDED,
          endedAt: now,
          outcome: CallOutcome.DECLINED,
          durationSeconds: 0,
        },
      });

      // NOTHING ELSE IS STAMPED. Only the decliner's `left_at` was written, above.
      // The other participants keep whatever their rows already said: `joined_at`
      // null because nobody answered, and `left_at` null because nobody left.
      // See the note in this method's doc comment.

      // The SAME terminal event every other ending produces, so a client
      // follows one ending and no consumer needs to know decline exists. Both
      // rows are written in this transaction and therefore share `created_at`;
      // their relative delivery order is not a guarantee the outbox makes, and
      // nothing depends on it -- `call.declined` says who refused, `call.ended`
      // says the call is over.
      await this.outbox.enqueue(tx, CommEvent.CALL_ENDED, {
        callId,
        conversationId: call.conversationId,
        outcome: CallOutcome.DECLINED,
        durationSeconds: 0,
      });

      await this.audit.event(tx, {
        familyId: call.familyId,
        actorKind: actor.kind,
        actorId: actor.actorId,
        type: 'call_ended',
        payload: { callId, outcome: CallOutcome.DECLINED, reason: 'declined' },
      });
    });
  }

  /**
   * Take the call row's lock, and read the lifecycle through it.
   *
   * Every accept, decline and end for one call queues here, so the state each
   * one sees is the state it acts on. Without it two concurrent answers both
   * read RINGING and both believe they made the transition.
   *
   * IT RETURNS `answered_at` AS WELL AS `status`, because `end` derives the
   * outcome from it and must derive it from LOCKED state. Reading it before the
   * lock is what let an accept commit in the window and an end still record
   * `missed` for a call that had been answered a millisecond earlier.
   */
  private async lockCall(
    tx: Prisma.TransactionClient,
    callId: string,
  ): Promise<{ status: string; answeredAt: Date | null }> {
    const rows = await tx.$queryRaw<Array<{ status: string; answeredAt: Date | null }>>`
      select status, answered_at as "answeredAt"
        from chat.call where id = ${callId}::uuid for update
    `;
    if (rows.length === 0) {
      throw new CommError(CommErrorCode.CALL_NOT_FOUND, 'call not found', 404);
    }
    return rows[0];
  }

  /**
   * Ends the call and records its outcome.
   *
   * THE OUTCOME IS DERIVED FROM LOCKED STATE, not from the read above.
   * `answered_at` is re-read through the row lock, so an accept that commits
   * between the authorization check and here is seen: the call ends `answered`,
   * with a duration, instead of `missed` with none. Deriving it from a pre-lock
   * read is a lost update in the one field call history is made of.
   *
   * ALREADY ENDED IS A NO-OP, NOT A REWRITE. Before W6 this method had no
   * terminal guard at all -- `requireLiveParticipant` deliberately does not
   * check status -- so an `end` arriving after any other ending overwrote
   * `status`, `ended_at`, `outcome` and `duration_seconds` and enqueued a second
   * `call.ended`. That is a terminal state being mutated, and with decline now
   * terminal it is a live path: a client that declines and then hangs up would
   * have rewritten its own `declined` as `missed`. Hanging up twice is a retry,
   * so it succeeds and changes nothing.
   *
   * THERE IS NO `outcome` PARAMETER, AND THAT IS THE POINT. This used to take
   * one, and the controller forwarded a request field into it, so a participant
   * could POST {"outcome":"answered"} for a call nobody answered -- false history
   * through the front door -- or any other string and turn a check-constraint
   * violation into a 500. A W6 draft kept the parameter for one test's benefit;
   * a production signature that exists for a test is a signature that lies about
   * the contract, so it is gone. The domain API now expresses the locked state
   * machine and nothing else:
   *
   *   ACTIVE  --end--> ended, answered, duration = now - answered_at
   *   RINGING --end--> ended, missed,   duration = 0
   *
   * ENDING STILL NEVER FAILS FOR AUTHORIZATION REASONS. `requireLiveParticipant`
   * is unchanged and deliberately weaker than `authorizeJoin`: a call whose
   * relationship was revoked mid-conversation must still be hangable, or it sits
   * ACTIVE forever. See that method for the full reasoning.
   */
  async end(callId: string, actorId: string): Promise<void> {
    const actor = await this.conversations.requireActor(actorId);
    const call = await this.requireLiveParticipant(callId, actor.actorId);

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockCall(tx, callId);

      // Terminal. Whatever ended it -- a decline, a sweep, another device's
      // hang-up -- owns the outcome, and this does not get to relabel it.
      if (locked.status === CallStatus.ENDED) return;

      const now = new Date();
      const resolved = locked.answeredAt ? CallOutcome.ANSWERED : CallOutcome.MISSED;
      // Duration is measured from `answered_at`, the application answer, and
      // deliberately NOT from `media_joined_at`: accepting is the act being
      // timed, and a slow media join does not shorten the call.
      const duration = locked.answeredAt
        ? Math.max(0, Math.round((now.getTime() - locked.answeredAt.getTime()) / 1000))
        : 0;

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

  /**
   * Expire the calls that have been ringing past the configured timeout.
   *
   * A SERVER-OWNED LIFECYCLE OPERATION. It takes no actor and answers to no
   * request. Nothing about it is influenced by a client: not the call id, not
   * the status, not the outcome, and above all not the time -- the deadline is
   * computed by the database, from the database's clock, against the row's own
   * `started_at`. An API replica with a skewed clock cannot expire a call early
   * or late, because no application clock is consulted.
   *
   * WHY ONE STATEMENT. The claim and the transition are the same UPDATE:
   *
   *   update chat.call set ... where status = 'ringing' and started_at < deadline
   *
   * There is no read, no decision, no later write -- so there is no window in
   * which the state can change underneath a decision already taken. Postgres
   * takes a row lock per matching row and, if another transaction holds it,
   * waits and then RE-EVALUATES the WHERE clause against the committed row. So:
   *
   *   * sweep vs accept -- accept holds the row via `SELECT ... FOR UPDATE`
   *     (see accept()). The sweep blocks, then re-checks, sees `status =
   *     'active'`, and does not match. The call stays answered.
   *   * sweep vs end -- same shape: `status = 'ended'` no longer matches.
   *   * sweep vs decline -- since W6 a decline ends the call, so this is the
   *     same shape again and needed no change here: the row is `ended` with
   *     `outcome = 'declined'` and does not match, which is what stops a
   *     refused call being relabelled `missed`. Both orderings are safe -- the
   *     inner select takes the row `for update skip locked`, so a sweep meeting
   *     a decline in progress skips the row entirely rather than waiting to
   *     overwrite it, and a decline meeting a committed sweep reads `ended` and
   *     refuses.
   *   * sweep vs sweep, on two workers -- the first to take the lock updates the
   *     row; the second re-checks and finds `status = 'ended'`. Exactly one
   *     worker gets the row back from RETURNING, so exactly one enqueues the
   *     terminal event.
   *
   * That last property is what makes it safe to run this on every replica
   * simultaneously, which is the deployment shape: the worker runs from the
   * same image as the API and may be scaled to any number of copies.
   *
   * IDEMPOTENT BY CONSTRUCTION. A second pass over an already-expired call
   * matches nothing -- it is no longer ringing -- so it writes nothing and
   * enqueues nothing. Running the sweep once, a thousand times, or from ten
   * workers at once produces the same database.
   *
   * The terminal event is `call.ended` with `outcome: 'missed'`, enqueued in
   * the same transaction as the transition. A caller therefore learns about a
   * timeout through the event it already handles for every other ending, and no
   * client needs to know that a sweep exists.
   */
  async expireRingingCalls(limit = 200): Promise<number> {
    const timeoutSeconds = await this.config.get('call.ring_timeout_seconds');

    return this.prisma.$transaction(async (tx) => {
      // One statement: claim and transition together. `duration_seconds = 0`
      // because nobody answered -- see the history note in end().
      const expired = await tx.$queryRaw<Array<{ id: string; conversation_id: string; family_id: string | null }>>`
        update chat.call
           set status = 'ended',
               ended_at = now(),
               outcome = 'missed',
               duration_seconds = 0
         where id in (
           select id from chat.call
            where status = 'ringing'
              and started_at < now() - make_interval(secs => ${timeoutSeconds}::double precision)
            order by started_at
            limit ${limit}
            for update skip locked
         )
        returning id, conversation_id, family_id
      `;

      for (const call of expired) {
        // Mirrors end(): a participant who never answered still stops being on
        // the call. `joined_at` is untouched and stays null, so the history says
        // plainly that nobody picked up.
        await tx.callParticipant.updateMany({
          where: { callId: call.id, leftAt: null },
          data: { leftAt: new Date() },
        });

        await this.outbox.enqueue(tx, CommEvent.CALL_ENDED, {
          callId: call.id,
          conversationId: call.conversation_id,
          outcome: CallOutcome.MISSED,
          durationSeconds: 0,
        });

        await this.audit.event(tx, {
          familyId: call.family_id,
          actorKind: SYSTEM_ACTOR.kind,
          actorId: null,
          type: 'call_ended',
          payload: { callId: call.id, outcome: CallOutcome.MISSED, reason: 'ring_timeout' },
        });
      }

      if (expired.length > 0) {
        this.log.log(`ring timeout expired ${expired.length} call(s) after ${timeoutSeconds}s`);
      }
      return expired.length;
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

  /**
   * THE join authorization chain, for every operation that joins or answers a
   * call: `issueToken`, `accept` and `decline`.
   *
   * WHY ONE METHOD. These three used to disagree. `issueToken` ran the full
   * chain; `accept` and `decline` ran `requireLiveParticipant`, which checked
   * only that the actor's id appeared in `call_participant` -- no conversation
   * membership, no communication matrix, no PD-6 relationship. So a parent
   * whose relationship had been revoked could still ANSWER: the call flipped to
   * ACTIVE, `answered_at` was stamped, and `end()` later recorded
   * `outcome = 'answered'` for a call they could never have obtained a token
   * for. No media leaked; the history simply lied.
   *
   * Three call sites sharing one chain is the fix. A future operation that
   * joins a call should call this rather than re-deriving the checks.
   *
   * STARTING A CALL DOES NOT GUARANTEE IT MAY BE ANSWERED. Every check runs
   * again here, against the state as it is now.
   *
   * `left_at` IS CHECKED, and was not before -- by `issueToken` either. A
   * participant row survives leaving, so a participant who declined could still
   * mint a media token. "Is a participant" and "is still on the call" are
   * different questions; this asks the second.
   */
  private async authorizeJoin(callId: string, actorId: string) {
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
    if (participant.leftAt !== null) {
      throw new CommError(
        CommErrorCode.CALL_PARTICIPANT_LEFT,
        'this participant has already left the call',
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
      // PD-2: joining an existing call, which a parent may do. The call was
      // already started by a teacher or an admin.
      CallIntent.JOIN,
      // PD-6. Re-resolved HERE, never inherited from the moment the call was
      // created. A call is not a standing grant: if the learner was reassigned,
      // the contact deactivated or the teacher offboarded in the seconds since
      // `start`, this is refused.
      await this.conversations.pairingAuthorizedAmong(call.participants),
    );
    if (!decision.allowed) throw new CommError(decision.code, decision.reason);

    return { actor, call, participant, conv, membership };
  }

  /**
   * The participant check for ENDING a call. Deliberately weaker than
   * authorizeJoin(), and deliberately still used here.
   *
   * Ending is cleanup, not a new authorization. If a revoked relationship could
   * block `end`, a call whose learner was reassigned mid-conversation could
   * never be hung up and would sit ACTIVE forever -- the stuck-call failure the
   * whole calling effort exists to avoid. PD-6 makes the same choice in the
   * database: the relationship is asserted when a pairing is created, never on
   * a later UPDATE, which is what lets `end` always succeed.
   *
   * So this asks one question -- is the actor on this call at all -- and that is
   * the right question for hanging up. Joining, answering and obtaining media
   * go through authorizeJoin() instead.
   */
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
